import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IntegrationsProvider } from '../../context/integrations-context';
import { IntegrationsPanel } from '../IntegrationsPanel';
import { INTEGRATION_CATALOGUE } from '../../utils/integration-catalogue';
import {
  INTEGRATION_IDS,
  INTEGRATION_LABELS,
} from '../../../shared/interfaces/integrations';
import { INTEGRATIONS_STORAGE_KEY } from '../../hooks/use-integrations-store';
import { MOBILE_STRIP_HEIGHT } from '../AppWindow';
import { layout } from '../../design-system/tokens';

/**
 * The panel now asks the server which integrations are configured. Hoisted so the
 * module mock and the per-test setup share one spy.
 */
const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../../utils/api-client', () => ({
  apiGetJson: (path: string) => api.get(path),
}));

/** Answer `GET /api/integrations` with exactly these services configured. */
function serverReports(configured: Partial<Record<string, boolean>>) {
  api.get.mockResolvedValue({
    integrations: INTEGRATION_IDS.map((id) => ({
      id,
      label: INTEGRATION_LABELS[id],
      configured: configured[id] ?? false,
    })),
  });
}

/**
 * Render and let the readiness fetch land.
 *
 * Async because mounting the panel starts `GET /api/integrations`, and its
 * resolution is a state update. Flushing it inside `act` here means every test
 * begins from a settled panel — otherwise the update arrives at whatever moment
 * the microtask queue drains, warns about being outside `act`, and can land after
 * the test has already asserted.
 */
async function renderPanel({ isMobile = false, onClose = () => {} } = {}) {
  const result = render(
    <IntegrationsProvider>
      <IntegrationsPanel isMobile={isMobile} onClose={onClose} />
    </IntegrationsProvider>,
  );
  await act(async () => {});
  return result;
}

/** Walk the whole grant flow for a service: node → sheet → allow. */
async function connect(user: ReturnType<typeof userEvent.setup>, id: string) {
  await user.click(screen.getByTestId(`integration-node-${id}`));
  await user.click(screen.getByTestId('integration-confirm-button'));
}

describe('IntegrationsPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    api.get.mockReset();
    // Hebcal and Ontopo need no secret, so this is what an untouched deployment
    // actually reports — the default the other tests run against.
    serverReports({ hebcal: true, ontopo: true });
  });

  it('draws the hub, one node per service and one edge each', async () => {
    await renderPanel();
    expect(screen.getByTestId('integrations-hub')).toBeInTheDocument();
    for (const service of INTEGRATION_CATALOGUE) {
      expect(screen.getByTestId(`integration-node-${service.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`integration-edge-${service.id}`)).toBeInTheDocument();
    }
  });

  /*
   * jsdom performs no layout, so the fallback canvas size is what the geometry
   * runs against. Asserting the nodes are not all stacked on the hub is what
   * catches a regression to width/height 0 — the failure mode that would render
   * the fan as a single pile in a browser mid-resize too.
   */
  it('spreads the nodes out rather than stacking them at the origin', async () => {
    await renderPanel();
    const tops = INTEGRATION_CATALOGUE.map(
      (s) => screen.getByTestId(`integration-node-${s.id}`).style.top,
    );
    expect(new Set(tops).size).toBe(INTEGRATION_CATALOGUE.length);
    expect(tops).not.toContain('0px');
  });

  it('starts with nothing connected, and says so honestly', async () => {
    await renderPanel();
    expect(screen.getByTestId('integrations-connected-count')).toHaveTextContent('0 connected');
    for (const service of INTEGRATION_CATALOGUE) {
      expect(screen.getByTestId(`integration-node-${service.id}`)).toHaveAttribute(
        'data-connected',
        'false',
      );
    }
  });

  /*
   * The two claims the surface must never make silently.
   *
   * This used to assert the flat "no provider is contacted", which was true of
   * every row when it was written and is now true of only the unbuilt ones. The
   * honest pair is: nothing acts unattended, and the capabilities that are still
   * drawings contact nobody.
   */
  it('promises that nothing is booked or sent without a confirmation', async () => {
    await renderPanel();
    expect(screen.getByText(/never booked or sent unattended|proposes, and you press Confirm/i))
      .toBeInTheDocument();
  });

  it('still says the unbuilt capabilities contact nobody', async () => {
    await renderPanel();
    expect(screen.getByText(/not built yet.*contacts nobody/i)).toBeInTheDocument();
  });

  describe('granting reach', () => {
    it('asks for consent before connecting anything', async () => {
      const user = userEvent.setup();
      await renderPanel();

      await user.click(screen.getByTestId('integration-node-flowers'));
      expect(screen.getByTestId('integration-consent-sheet')).toBeInTheDocument();
      // Still not connected — the sheet is the grant, the click is only the ask.
      expect(screen.getByTestId('integration-node-flowers')).toHaveAttribute(
        'data-connected',
        'false',
      );
      expect(screen.getByTestId('integrations-connected-count')).toHaveTextContent('0 connected');
    });

    it('lists every scope the service asks for', async () => {
      const user = userEvent.setup();
      await renderPanel();

      await user.click(screen.getByTestId('integration-node-flowers'));
      const scopes = screen.getByTestId('integration-scopes');
      for (const scope of INTEGRATION_CATALOGUE.find((s) => s.id === 'flowers')!.scopes) {
        expect(scopes).toHaveTextContent(scope.label);
      }
    });

    it('connects, counts and lights the edge once consent is given', async () => {
      const user = userEvent.setup();
      await renderPanel();

      await connect(user, 'flowers');

      expect(screen.queryByTestId('integration-consent-sheet')).not.toBeInTheDocument();
      expect(screen.getByTestId('integration-node-flowers')).toHaveAttribute(
        'data-connected',
        'true',
      );
      expect(screen.getByTestId('integration-edge-flowers')).toHaveAttribute(
        'data-connected',
        'true',
      );
      expect(screen.getByTestId('integrations-connected-count')).toHaveTextContent('1 connected');
    });

    it('leaves nothing connected when the sheet is cancelled', async () => {
      const user = userEvent.setup();
      await renderPanel();

      await user.click(screen.getByTestId('integration-node-flowers'));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByTestId('integration-consent-sheet')).not.toBeInTheDocument();
      expect(screen.getByTestId('integrations-connected-count')).toHaveTextContent('0 connected');
    });

    it('takes the reach away again on disconnect', async () => {
      const user = userEvent.setup();
      await renderPanel();

      await connect(user, 'flowers');
      await user.click(screen.getByTestId('integration-node-flowers'));
      await user.click(screen.getByTestId('integration-disconnect-button'));

      expect(screen.getByTestId('integration-node-flowers')).toHaveAttribute(
        'data-connected',
        'false',
      );
      expect(screen.getByTestId('integrations-connected-count')).toHaveTextContent('0 connected');
    });

    it('survives a remount, because a grant is not a session detail', async () => {
      const user = userEvent.setup();
      const { unmount } = await renderPanel();
      await connect(user, 'flowers');
      unmount();

      await renderPanel();
      expect(screen.getByTestId('integration-node-flowers')).toHaveAttribute(
        'data-connected',
        'true',
      );
    });
  });

  /*
   * The cap is the difference between "he can act" and "he can spend": it must
   * appear exactly where money can move and nowhere else.
   */
  describe('the spend cap', () => {
    it('offers a cap on a service that can spend, and shows it on the node', async () => {
      const user = userEvent.setup();
      await renderPanel();

      await user.click(screen.getByTestId('integration-node-flowers'));
      // The catalogue's default for flowers, echoed next to the slider.
      expect(screen.getByTestId('integration-cap-slider')).toHaveValue('80');
      expect(screen.getByTestId('integration-cap-value')).toHaveTextContent('$80');

      await user.click(screen.getByTestId('integration-confirm-button'));
      expect(screen.getByTestId('integration-node-flowers')).toHaveTextContent('up to $80');
    });

    it('offers no cap on a service that cannot spend', async () => {
      const user = userEvent.setup();
      await renderPanel();

      await user.click(screen.getByTestId('integration-node-music'));
      expect(screen.queryByTestId('integration-cap-slider')).not.toBeInTheDocument();
    });

    it('reads the cap back when the grant is revisited', async () => {
      const user = userEvent.setup();
      await renderPanel();

      await connect(user, 'travel');
      await user.click(screen.getByTestId('integration-node-travel'));
      expect(screen.getByTestId('integration-cap-value')).toHaveTextContent('$400');
    });
  });

  describe('dismissal', () => {
    it('closes on the close button', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      await renderPanel({ onClose });

      await user.click(screen.getByTestId('integrations-close-button'));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('closes on Escape', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      await renderPanel({ onClose });

      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledOnce();
    });

    /* One Escape should dismiss one layer, not the sheet and the panel together. */
    it('lets Escape dismiss the consent sheet without closing the panel', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      await renderPanel({ onClose });

      await user.click(screen.getByTestId('integration-node-flowers'));
      await user.keyboard('{Escape}');

      expect(screen.queryByTestId('integration-consent-sheet')).not.toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('on mobile', () => {
    it('falls back to cards, because a 375px fan is illegible', async () => {
      await renderPanel({ isMobile: true });
      expect(screen.queryByTestId('integrations-canvas')).not.toBeInTheDocument();
      expect(screen.getByTestId('integrations-list')).toBeInTheDocument();
      for (const service of INTEGRATION_CATALOGUE) {
        expect(screen.getByTestId(`integration-card-${service.id}`)).toBeInTheDocument();
      }
    });

    it('runs the same consent flow from a card', async () => {
      const user = userEvent.setup();
      await renderPanel({ isMobile: true });

      await user.click(screen.getByTestId('integration-card-flowers'));
      await user.click(screen.getByTestId('integration-confirm-button'));
      expect(screen.getByTestId('integrations-connected-count')).toHaveTextContent('1 connected');
    });
  });

  it('admits it when the browser will not keep the grant', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    const user = userEvent.setup();
    await renderPanel();

    await connect(user, 'flowers');
    expect(screen.getByTestId('integrations-storage-error')).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  /*
   * The first version of this spanned grid tracks 2–4, which makes grid
   * auto-placement skip those cells and bumps the conversation list and the
   * mobile content region into an implicit row below the window — the panel then
   * collapsed to its content height. jsdom does no layout, so what is assertable
   * is the contract that replaced it: an absolute overlay offset past the rail.
   */
  describe('placement', () => {
    it('is an absolute overlay that starts after the desktop rail', async () => {
      await renderPanel();
      const panel = screen.getByTestId('integrations-panel');
      expect(panel.style.position).toBe('absolute');
      expect(panel.style.left).toBe(`${layout.iconRailWidth}px`);
      expect(panel.style.top).toBe('0px');
      expect(panel.style.gridColumn).toBe('');
    });

    it('starts below the mobile claret strip instead', async () => {
      await renderPanel({ isMobile: true });
      const panel = screen.getByTestId('integrations-panel');
      expect(panel.style.top).toBe(`${MOBILE_STRIP_HEIGHT}px`);
      expect(panel.style.left).toBe('0px');
    });
  });

  /*
   * Readiness is the server's answer and a grant is the visitor's, and the panel's
   * job is to not conflate them. These are the four states, plus the one that
   * matters most in practice.
   */
  describe('what the server says is ready', () => {
    it('marks a capability live when its backing service is configured', async () => {
      await renderPanel();
      const badge = await screen.findByTestId('integration-readiness-dining');
      expect(badge).toHaveAttribute('data-readiness', 'ready');
      expect(badge).toHaveTextContent('live');
    });

    it('says an unbuilt capability is not built yet, not merely unconfigured', async () => {
      await renderPanel();
      /*
       * The distinction the visitor cannot see by looking: flowers is a drawing,
       * whereas travel is real code waiting on an Amadeus key. Both are dark, and
       * conflating them either overpromises or slanders working code.
       */
      const flowers = await screen.findByTestId('integration-readiness-flowers');
      expect(flowers).toHaveAttribute('data-readiness', 'aspirational');
      expect(flowers).toHaveTextContent('not built yet');

      const travel = screen.getByTestId('integration-readiness-travel');
      expect(travel).toHaveAttribute('data-readiness', 'unconfigured');
      expect(travel).toHaveTextContent('needs credentials');
    });

    it('names the half that works when Gmail is configured and WhatsApp is not', async () => {
      /*
       * The realistic deployment, and the reason `partial` exists at all. Gmail
       * needs one refresh token; WhatsApp needs a Meta business number and
       * template review, which lands days later. "Not configured" would tell the
       * visitor email is broken, and "live" would promise a nudge that cannot be
       * sent — so it names Gmail.
       */
      serverReports({ hebcal: true, ontopo: true, gmail: true });
      await renderPanel();

      const badge = await screen.findByTestId('integration-readiness-messages');
      expect(badge).toHaveAttribute('data-readiness', 'partial');
      expect(badge).toHaveTextContent('live via Gmail');
    });

    it('claims nothing at all when the server cannot be reached', async () => {
      api.get.mockRejectedValue(new Error('offline'));
      await renderPanel();

      // Deliberately no badge rather than a guess in either direction. The
      // aspirational rows still show theirs — those need no server to be true.
      await screen.findByTestId('integration-readiness-flowers');
      expect(screen.queryByTestId('integration-readiness-dining')).not.toBeInTheDocument();
      expect(screen.queryByTestId('integration-readiness-messages')).not.toBeInTheDocument();
    });

    it('shows the same badges on a mobile card', async () => {
      await renderPanel({ isMobile: true });
      const badge = await screen.findByTestId('integration-readiness-occasions');
      expect(badge).toHaveAttribute('data-readiness', 'ready');
    });
  });

  it('keeps the storage key stable, so grants are not silently orphaned', () => {
    expect(INTEGRATIONS_STORAGE_KEY).toBe('valentin_integrations_v1');
  });
});
