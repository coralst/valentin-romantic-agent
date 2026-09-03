import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IntegrationsProvider } from '../../context/integrations-context';
import {
  IntegrationsPanel,
  nodeLayout,
  connectionLabel,
  readinessLabel,
} from '../IntegrationsPanel';
import {
  INTEGRATION_CATALOGUE,
  type IntegrationService,
} from '../../utils/integration-catalogue';
import type { IntegrationReadiness } from '../../hooks/use-integration-readiness';
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

  /*
   * The narrower claim is the load-bearing one. "Contacts nobody" is true of the
   * aspirational rows and false of the credentialled ones — a visitor who reads the
   * old blanket version and then pastes a Google secret has been told the opposite
   * of what happens. So this asserts the promise is scoped to the unbuilt rows, and
   * that the panel says out loud that supplying a key reaches the provider.
   */
  it('scopes "contacts nobody" to the unbuilt rows, not to everything non-live', async () => {
    await renderPanel();
    expect(screen.getByText(/not built yet contact nobody at all/i)).toBeInTheDocument();
    expect(screen.getByText(/supply one and it reaches the provider too/i)).toBeInTheDocument();
  });

  describe('granting reach', () => {
    it('asks for consent before connecting anything', async () => {
      const user = userEvent.setup();
      await renderPanel();

      await user.click(screen.getByTestId('integration-node-wolt'));
      expect(screen.getByTestId('integration-consent-sheet')).toBeInTheDocument();
      // Still not connected — the sheet is the grant, the click is only the ask.
      expect(screen.getByTestId('integration-node-wolt')).toHaveAttribute(
        'data-connected',
        'false',
      );
      expect(screen.getByTestId('integrations-connected-count')).toHaveTextContent('0 connected');
    });

    it('lists every scope the service asks for', async () => {
      const user = userEvent.setup();
      await renderPanel();

      await user.click(screen.getByTestId('integration-node-wolt'));
      const scopes = screen.getByTestId('integration-scopes');
      for (const scope of INTEGRATION_CATALOGUE.find((s) => s.id === 'wolt')!.scopes) {
        expect(scopes).toHaveTextContent(scope.label);
      }
    });

    it('connects, counts and lights the edge once consent is given', async () => {
      const user = userEvent.setup();
      await renderPanel();

      await connect(user, 'wolt');

      expect(screen.queryByTestId('integration-consent-sheet')).not.toBeInTheDocument();
      expect(screen.getByTestId('integration-node-wolt')).toHaveAttribute(
        'data-connected',
        'true',
      );
      expect(screen.getByTestId('integration-edge-wolt')).toHaveAttribute(
        'data-connected',
        'true',
      );
      expect(screen.getByTestId('integrations-connected-count')).toHaveTextContent('1 connected');
    });

    it('leaves nothing connected when the sheet is cancelled', async () => {
      const user = userEvent.setup();
      await renderPanel();

      await user.click(screen.getByTestId('integration-node-wolt'));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByTestId('integration-consent-sheet')).not.toBeInTheDocument();
      expect(screen.getByTestId('integrations-connected-count')).toHaveTextContent('0 connected');
    });

    it('takes the reach away again on disconnect', async () => {
      const user = userEvent.setup();
      await renderPanel();

      await connect(user, 'wolt');
      await user.click(screen.getByTestId('integration-node-wolt'));
      await user.click(screen.getByTestId('integration-disconnect-button'));

      expect(screen.getByTestId('integration-node-wolt')).toHaveAttribute(
        'data-connected',
        'false',
      );
      expect(screen.getByTestId('integrations-connected-count')).toHaveTextContent('0 connected');
    });

    it('survives a remount, because a grant is not a session detail', async () => {
      const user = userEvent.setup();
      const { unmount } = await renderPanel();
      await connect(user, 'wolt');
      unmount();

      await renderPanel();
      expect(screen.getByTestId('integration-node-wolt')).toHaveAttribute(
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

      /*
       * Amadeus, not Wolt. The Wolt row used to stand here, back when the catalogue
       * claimed Valentin could "place an order" for $80 — he never could, because
       * the Wolt handoff ends at the shop's own page. Amadeus is the real example: a
       * hold is money moving.
       */
      await user.click(screen.getByTestId('integration-node-amadeus'));
      // The catalogue's default for Amadeus, echoed next to the slider.
      expect(screen.getByTestId('integration-cap-slider')).toHaveValue('400');
      expect(screen.getByTestId('integration-cap-value')).toHaveTextContent('$400');

      await user.click(screen.getByTestId('integration-confirm-button'));
      expect(screen.getByTestId('integration-node-amadeus')).toHaveTextContent('up to $400');
    });

    it('offers no cap on a service that cannot spend', async () => {
      const user = userEvent.setup();
      await renderPanel();

      await user.click(screen.getByTestId('integration-node-spotify'));
      expect(screen.queryByTestId('integration-cap-slider')).not.toBeInTheDocument();
    });

    it('reads the cap back when the grant is revisited', async () => {
      const user = userEvent.setup();
      await renderPanel();

      await connect(user, 'amadeus');
      await user.click(screen.getByTestId('integration-node-amadeus'));
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

      await user.click(screen.getByTestId('integration-node-wolt'));
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

      await user.click(screen.getByTestId('integration-card-wolt'));
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

    await connect(user, 'wolt');
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
      const badge = await screen.findByTestId('integration-readiness-ontopo');
      expect(badge).toHaveAttribute('data-readiness', 'ready');
      expect(badge).toHaveTextContent('live');
    });

    it('says a built-but-keyless capability needs credentials, and badges no row unbuilt', async () => {
      await renderPanel();
      /*
       * This test has been chasing a moving target, and the moves are the point.
       *
       * It asserted `flowers` was "not built yet" until Wolt landed, then `music`
       * until Spotify landed, then `rides` until that row was deleted, then Spotify
       * again for one release — written against a `main` that could not see the
       * Spotify branch. Every version badged working code as a drawing.
       *
       * There is no honest example left: every catalogue row is backed. So the
       * assertion inverts. What the panel must show is "needs credentials" — real code
       * waiting on a key, which looks identical on screen to "not built yet" and is a
       * completely different claim — and no row anywhere may say "not built yet",
       * because none of them is. `readinessLabel` covers the aspirational branch
       * directly for the day a genuinely unbuilt row is added.
       */
      const amadeus = await screen.findByTestId('integration-readiness-amadeus');
      expect(amadeus).toHaveAttribute('data-readiness', 'unconfigured');
      expect(amadeus).toHaveTextContent('needs credentials');

      const spotify = screen.getByTestId('integration-readiness-spotify');
      expect(spotify).toHaveAttribute('data-readiness', 'unconfigured');

      for (const service of INTEGRATION_CATALOGUE) {
        const badge = screen.queryByTestId(`integration-readiness-${service.id}`);
        expect(badge).not.toHaveAttribute('data-readiness', 'aspirational');
      }
    });

    it('badges Gmail and WhatsApp separately when only Gmail is configured', async () => {
      /*
       * The realistic deployment, and what splitting the old Messages row bought.
       * Gmail needs one refresh token; WhatsApp needs a Meta business number and
       * template review, which lands days later.
       *
       * This used to assert `partial` — "live via Gmail" on one combined row —
       * because a single row had to summarise two unequal services, and that summary
       * was the least bad of three wrong answers ("not configured" said email was
       * broken, "live" promised a nudge that could not be sent). With one row per
       * provider there is nothing to summarise: each badge states its own truth, and
       * the visitor is told exactly which account still needs work.
       */
      serverReports({ hebcal: true, ontopo: true, gmail: true });
      await renderPanel();

      const gmail = await screen.findByTestId('integration-readiness-gmail');
      expect(gmail).toHaveAttribute('data-readiness', 'ready');
      expect(gmail).toHaveTextContent('live');

      const whatsapp = screen.getByTestId('integration-readiness-whatsapp');
      expect(whatsapp).toHaveAttribute('data-readiness', 'unconfigured');
      expect(whatsapp).toHaveTextContent('needs credentials');
    });

    it('claims nothing at all when the server cannot be reached', async () => {
      api.get.mockRejectedValue(new Error('offline'));
      await renderPanel();
      // Let the rejected fetch settle, so this is the state after the failure rather
      // than the state before it.
      await act(async () => {});

      /*
       * Deliberately no badge rather than a guess in either direction: claiming "live"
       * would promise reach the panel cannot verify, and claiming "needs credentials"
       * would call a working deployment broken.
       *
       * This used to make an exception for the unbuilt rows, whose badge is true
       * without asking anyone. With every row backed there is no such row left, so the
       * expectation is now uniform — every badge is withheld.
       */
      for (const service of INTEGRATION_CATALOGUE) {
        expect(
          screen.queryByTestId(`integration-readiness-${service.id}`),
        ).not.toBeInTheDocument();
      }
    });

    it('shows the same badges on a mobile card', async () => {
      await renderPanel({ isMobile: true });
      const badge = await screen.findByTestId('integration-readiness-hebcal');
      expect(badge).toHaveAttribute('data-readiness', 'ready');
    });
  });

  it('keeps the storage key stable, so grants are not silently orphaned', () => {
    expect(INTEGRATIONS_STORAGE_KEY).toBe('valentin_integrations_v1');
  });
});

/*
 * The fan used to stop scaling and leave the right 40% of a wide panel empty.
 *
 * `hubX` is proportional to the canvas width but the card column was a flat
 * `hubX + 300`, so past roughly 1100px the `Math.min` clamp stopped binding and the
 * cards simply stopped moving outward: on a 1440px window everything ended at
 * x≈862 with ~578px of nothing beside it.
 */
describe('IntegrationsPanel — the fan uses the width it is given', () => {
  // One node per catalogue row: eight, since Flower delivery and Groceries & gifts
  // became the single Wolt row and Ride booking was dropped.
  const COUNT = INTEGRATION_CATALOGUE.length;
  /** Right edge of the widest card, which is the one that bulges furthest out. */
  const rightmostEdge = (width: number, height = 560) => {
    const centres = Array.from({ length: COUNT }, (_, i) => nodeLayout(i, COUNT, width, height).x);
    return Math.max(...centres) + NODE_WIDTH_FOR_TEST / 2;
  };
  const NODE_WIDTH_FOR_TEST = 190;

  it('reaches further across a wider canvas', () => {
    expect(rightmostEdge(1336)).toBeGreaterThan(rightmostEdge(900));
  });

  it('leaves no more than a sensible margin on the widest canvas the shell allows', () => {
    // `layout.windowMaxWidth` is 1440, less the 28px linen margin and the 76px rail.
    // The old geometry left ~43% of this empty; a quarter is a composition, not a gap.
    const width = 1336;
    const slack = width - rightmostEdge(width);
    expect(slack).toBeLessThan(width * 0.25);
  });

  it('keeps the cards inside the canvas at every width', () => {
    for (const width of [600, 860, 1024, 1336, 1900]) {
      expect(rightmostEdge(width)).toBeLessThanOrEqual(width);
    }
  });

  it('keeps the hub clear of the cards on a narrow canvas', () => {
    // The clamp protecting a narrow window must not fold the column onto the hub.
    const { hubX, x } = nodeLayout(0, COUNT, 600, 560);
    expect(x - NODE_WIDTH_FOR_TEST / 2).toBeGreaterThan(hubX);
  });
});

/*
 * A grant is not a connection.
 *
 * Reported from the running app: "Restaurant booking — Connected" and "Calendar —
 * Connected" with a rail badge of 2, for a browser whose grants were left in
 * `localStorage` by an earlier session. The Calendar row read "Connected" on one line
 * and "needs credentials" on the next, which cannot both be true.
 */
describe('connectionLabel — the two facts kept apart', () => {
  it('says Connected only when the deployment can reach it', () => {
    expect(connectionLabel(true, 'ready')).toBe('Connected');
  });

  it('says Allowed for a grant the deployment cannot honour', () => {
    expect(connectionLabel(true, 'unconfigured')).toBe('Allowed');
    expect(connectionLabel(true, 'aspirational')).toBe('Allowed');
    expect(connectionLabel(true, 'partial')).toBe('Allowed');
  });

  it('never claims a connection while readiness is still unknown', () => {
    // Guessing "Connected" here is the overclaim; guessing the opposite would call a
    // working service broken.
    expect(connectionLabel(true, 'unknown')).toBe('Allowed');
  });

  it('reads the spend cap back whatever the reach', () => {
    expect(connectionLabel(true, 'ready', 80)).toBe('Connected · up to $80');
    expect(connectionLabel(true, 'aspirational', 80)).toBe('Allowed · up to $80');
  });

  it('ignores an absent or zero cap rather than printing "$0"', () => {
    expect(connectionLabel(true, 'ready', null)).toBe('Connected');
    expect(connectionLabel(true, 'ready', undefined)).toBe('Connected');
    expect(connectionLabel(true, 'ready', 0)).toBe('Connected');
  });

  it('says nothing about a grant that was never given', () => {
    for (const reach of ['ready', 'partial', 'unconfigured', 'aspirational', 'unknown'] as const) {
      expect(connectionLabel(false, reach)).toBe('Not connected');
    }
  });

  it('never repeats what the readiness badge already says', () => {
    // An earlier version produced "Allowed · not built yet" directly above a badge
    // reading "not built yet".
    for (const reach of ['unconfigured', 'aspirational', 'unknown'] as const) {
      expect(connectionLabel(true, reach)).not.toMatch(/credential|built|checking/i);
    }
  });
});

/*
 * The two badge states no catalogue row can reach any more.
 *
 * `aspirational` became unreachable when Spotify landed and `partial` when the
 * Messages row split, and both were previously covered only through a rendered row.
 * Deleting the coverage along with the rows would mean the day someone adds an
 * unbuilt row — or a row genuinely spanning two providers — the honest badge is
 * untested at exactly the moment it starts mattering again.
 *
 * Tested against the function rather than by stubbing the catalogue: a fake row
 * injected into a rendered panel would prove the fake works, and this is the same
 * assertion without the fiction.
 */
describe('readinessLabel — the states nothing currently reaches', () => {
  const row = INTEGRATION_CATALOGUE[0];
  const nothingConfigured: IntegrationReadiness = { state: 'loaded', configured: {} };

  it('says not built yet for a row with nothing behind it', () => {
    const unbacked: IntegrationService = { ...row, backing: undefined };
    expect(readinessLabel('aspirational', unbacked, nothingConfigured)).toBe('not built yet');
  });

  it('names the service that works when a row spans two and one is configured', () => {
    const spanning: IntegrationService = { ...row, backing: ['gmail', 'whatsapp'] };
    const gmailOnly: IntegrationReadiness = {
      state: 'loaded',
      configured: { gmail: true, whatsapp: false },
    };

    expect(readinessLabel('partial', spanning, gmailOnly)).toBe('live via Gmail');
  });

  it('says nothing at all while readiness is unknown', () => {
    // Not a hedge like "checking…": no badge is quieter than a badge with no content,
    // and this is the state that exists only until the fetch lands.
    expect(readinessLabel('unknown', row, nothingConfigured)).toBeNull();
  });
});
