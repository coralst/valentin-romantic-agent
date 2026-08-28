import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IntegrationsProvider } from '../../context/integrations-context';
import { IntegrationsPanel } from '../IntegrationsPanel';
import { INTEGRATION_CATALOGUE } from '../../utils/integration-catalogue';
import { INTEGRATIONS_STORAGE_KEY } from '../../hooks/use-integrations-store';
import { MOBILE_STRIP_HEIGHT } from '../AppWindow';
import { layout } from '../../design-system/tokens';

function renderPanel({ isMobile = false, onClose = () => {} } = {}) {
  return render(
    <IntegrationsProvider>
      <IntegrationsPanel isMobile={isMobile} onClose={onClose} />
    </IntegrationsProvider>,
  );
}

/** Walk the whole grant flow for a service: node → sheet → allow. */
async function connect(user: ReturnType<typeof userEvent.setup>, id: string) {
  await user.click(screen.getByTestId(`integration-node-${id}`));
  await user.click(screen.getByTestId('integration-confirm-button'));
}

describe('IntegrationsPanel', () => {
  beforeEach(() => localStorage.clear());

  it('draws the hub, one node per service and one edge each', () => {
    renderPanel();
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
  it('spreads the nodes out rather than stacking them at the origin', () => {
    renderPanel();
    const tops = INTEGRATION_CATALOGUE.map(
      (s) => screen.getByTestId(`integration-node-${s.id}`).style.top,
    );
    expect(new Set(tops).size).toBe(INTEGRATION_CATALOGUE.length);
    expect(tops).not.toContain('0px');
  });

  it('starts with nothing connected, and says so honestly', () => {
    renderPanel();
    expect(screen.getByTestId('integrations-connected-count')).toHaveTextContent('0 connected');
    for (const service of INTEGRATION_CATALOGUE) {
      expect(screen.getByTestId(`integration-node-${service.id}`)).toHaveAttribute(
        'data-connected',
        'false',
      );
    }
  });

  /* The one claim the surface must never make silently. */
  it('states that no provider is contacted', () => {
    renderPanel();
    expect(screen.getByText(/no\s+provider is contacted/i)).toBeInTheDocument();
  });

  describe('granting reach', () => {
    it('asks for consent before connecting anything', async () => {
      const user = userEvent.setup();
      renderPanel();

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
      renderPanel();

      await user.click(screen.getByTestId('integration-node-flowers'));
      const scopes = screen.getByTestId('integration-scopes');
      for (const scope of INTEGRATION_CATALOGUE.find((s) => s.id === 'flowers')!.scopes) {
        expect(scopes).toHaveTextContent(scope.label);
      }
    });

    it('connects, counts and lights the edge once consent is given', async () => {
      const user = userEvent.setup();
      renderPanel();

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
      renderPanel();

      await user.click(screen.getByTestId('integration-node-flowers'));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByTestId('integration-consent-sheet')).not.toBeInTheDocument();
      expect(screen.getByTestId('integrations-connected-count')).toHaveTextContent('0 connected');
    });

    it('takes the reach away again on disconnect', async () => {
      const user = userEvent.setup();
      renderPanel();

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
      const { unmount } = renderPanel();
      await connect(user, 'flowers');
      unmount();

      renderPanel();
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
      renderPanel();

      await user.click(screen.getByTestId('integration-node-flowers'));
      // The catalogue's default for flowers, echoed next to the slider.
      expect(screen.getByTestId('integration-cap-slider')).toHaveValue('80');
      expect(screen.getByTestId('integration-cap-value')).toHaveTextContent('$80');

      await user.click(screen.getByTestId('integration-confirm-button'));
      expect(screen.getByTestId('integration-node-flowers')).toHaveTextContent('up to $80');
    });

    it('offers no cap on a service that cannot spend', async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByTestId('integration-node-music'));
      expect(screen.queryByTestId('integration-cap-slider')).not.toBeInTheDocument();
    });

    it('reads the cap back when the grant is revisited', async () => {
      const user = userEvent.setup();
      renderPanel();

      await connect(user, 'travel');
      await user.click(screen.getByTestId('integration-node-travel'));
      expect(screen.getByTestId('integration-cap-value')).toHaveTextContent('$400');
    });
  });

  describe('dismissal', () => {
    it('closes on the close button', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      renderPanel({ onClose });

      await user.click(screen.getByTestId('integrations-close-button'));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('closes on Escape', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      renderPanel({ onClose });

      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledOnce();
    });

    /* One Escape should dismiss one layer, not the sheet and the panel together. */
    it('lets Escape dismiss the consent sheet without closing the panel', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      renderPanel({ onClose });

      await user.click(screen.getByTestId('integration-node-flowers'));
      await user.keyboard('{Escape}');

      expect(screen.queryByTestId('integration-consent-sheet')).not.toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('on mobile', () => {
    it('falls back to cards, because a 375px fan is illegible', () => {
      renderPanel({ isMobile: true });
      expect(screen.queryByTestId('integrations-canvas')).not.toBeInTheDocument();
      expect(screen.getByTestId('integrations-list')).toBeInTheDocument();
      for (const service of INTEGRATION_CATALOGUE) {
        expect(screen.getByTestId(`integration-card-${service.id}`)).toBeInTheDocument();
      }
    });

    it('runs the same consent flow from a card', async () => {
      const user = userEvent.setup();
      renderPanel({ isMobile: true });

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
    renderPanel();

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
    it('is an absolute overlay that starts after the desktop rail', () => {
      renderPanel();
      const panel = screen.getByTestId('integrations-panel');
      expect(panel.style.position).toBe('absolute');
      expect(panel.style.left).toBe(`${layout.iconRailWidth}px`);
      expect(panel.style.top).toBe('0px');
      expect(panel.style.gridColumn).toBe('');
    });

    it('starts below the mobile claret strip instead', () => {
      renderPanel({ isMobile: true });
      const panel = screen.getByTestId('integrations-panel');
      expect(panel.style.top).toBe(`${MOBILE_STRIP_HEIGHT}px`);
      expect(panel.style.left).toBe('0px');
    });
  });

  it('keeps the storage key stable, so grants are not silently orphaned', () => {
    expect(INTEGRATIONS_STORAGE_KEY).toBe('valentin_integrations_v1');
  });
});
