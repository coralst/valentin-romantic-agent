import { describe, it, expect, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ValentinInspector } from '../ValentinInspector';
import {
  publishInboundWsEvent,
  resetWsObservers,
} from '../../utils/ws-event-observer';
import { ARCHITECTURE_NODES } from '../../utils/inspector-architecture';
import type { ServerEvent } from '../../../shared/interfaces/ws-events';
import type { PreferenceWithHistory } from '../../../shared/interfaces/preference';

function makePreference(
  overrides: Partial<PreferenceWithHistory> = {},
): PreferenceWithHistory {
  return {
    id: 'pref-1',
    sessionId: 'sess-1',
    category: 'food',
    key: 'cuisine',
    value: 'Italian',
    confidence: 0.9,
    sourceMessageId: 'msg-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
    ...overrides,
  };
}

function makePreferenceUpdate(
  preference: PreferenceWithHistory = makePreference(),
): ServerEvent {
  return {
    type: 'preference_update',
    payload: { preference, isNew: true },
    timestamp: new Date().toISOString(),
  };
}

/** Open the panel via the toggle, as a user would. */
async function openInspector(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open architecture inspector' }));
}

describe('ValentinInspector', () => {
  afterEach(() => {
    resetWsObservers();
  });

  describe('closed by default', () => {
    it('renders the toggle button', () => {
      render(<ValentinInspector />);
      expect(
        screen.getByRole('button', { name: 'Open architecture inspector' }),
      ).toBeInTheDocument();
    });

    it('does not render the panel', () => {
      render(<ValentinInspector />);
      expect(screen.queryByTestId('inspector-panel')).not.toBeInTheDocument();
    });

    it('marks the toggle as not expanded', () => {
      render(<ValentinInspector />);
      expect(
        screen.getByRole('button', { name: 'Open architecture inspector' }),
      ).toHaveAttribute('aria-expanded', 'false');
    });

    it('uses an explicit button type', () => {
      render(<ValentinInspector />);
      expect(
        screen.getByRole('button', { name: 'Open architecture inspector' }),
      ).toHaveAttribute('type', 'button');
    });
  });

  describe('opening', () => {
    it('opens the panel when the toggle is clicked', async () => {
      const user = userEvent.setup();
      render(<ValentinInspector />);
      await openInspector(user);
      expect(screen.getByTestId('inspector-panel')).toBeInTheDocument();
    });

    it('exposes the panel as a labelled complementary region, not a dialog', async () => {
      const user = userEvent.setup();
      render(<ValentinInspector />);
      await openInspector(user);
      expect(
        screen.getByRole('complementary', { name: 'Live Architecture' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('is not modal', async () => {
      const user = userEvent.setup();
      render(<ValentinInspector />);
      await openInspector(user);
      expect(screen.getByTestId('inspector-panel')).not.toHaveAttribute('aria-modal');
    });

    it('marks the toggle as expanded once open', async () => {
      const user = userEvent.setup();
      render(<ValentinInspector />);
      await openInspector(user);
      expect(
        screen.getByRole('button', { name: 'Close architecture inspector' }),
      ).toHaveAttribute('aria-expanded', 'true');
    });

    it('does not steal focus when opened', async () => {
      const user = userEvent.setup();
      render(<ValentinInspector />);
      await openInspector(user);
      // Focus stays on the toggle the user activated — nothing inside the
      // panel grabs it, so a composer elsewhere on the page keeps its focus.
      expect(screen.getByTestId('inspector-close')).not.toHaveFocus();
    });

    it('renders every architecture node', async () => {
      const user = userEvent.setup();
      render(<ValentinInspector />);
      await openInspector(user);
      for (const node of ARCHITECTURE_NODES) {
        expect(screen.getByTestId(`inspector-node-${node.id}`)).toBeInTheDocument();
      }
    });

    it('shows the empty feed message before any events arrive', async () => {
      const user = userEvent.setup();
      render(<ValentinInspector />);
      await openInspector(user);
      expect(screen.getByTestId('inspector-feed-empty')).toBeInTheDocument();
    });
  });

  describe('live events', () => {
    it('shows an arriving preference_update in the feed', async () => {
      const user = userEvent.setup();
      render(<ValentinInspector />);
      await openInspector(user);

      act(() => {
        publishInboundWsEvent(makePreferenceUpdate());
      });

      const items = screen.getAllByTestId('inspector-feed-item');
      expect(items).toHaveLength(1);
      expect(items[0]).toHaveAttribute('data-event-type', 'preference_update');
    });

    it('shows the preference value in the feed detail', async () => {
      const user = userEvent.setup();
      render(<ValentinInspector />);
      await openInspector(user);

      act(() => {
        publishInboundWsEvent(
          makePreferenceUpdate(makePreference({ value: 'Peonies', category: 'gifts' })),
        );
      });

      expect(screen.getByText(/Peonies/)).toBeInTheDocument();
    });

    it('replaces the empty state once an event arrives', async () => {
      const user = userEvent.setup();
      render(<ValentinInspector />);
      await openInspector(user);

      act(() => {
        publishInboundWsEvent(makePreferenceUpdate());
      });

      expect(screen.queryByTestId('inspector-feed-empty')).not.toBeInTheDocument();
    });

    it('highlights the nodes a preference_update travelled through', async () => {
      const user = userEvent.setup();
      render(<ValentinInspector />);
      await openInspector(user);

      act(() => {
        publishInboundWsEvent(makePreferenceUpdate());
      });

      expect(screen.getByTestId('inspector-node-store')).toHaveAttribute('data-active', 'true');
      expect(
        screen.getByTestId('inspector-node-preferenceExtractor'),
      ).toHaveAttribute('data-active', 'true');
    });

    it('leaves unrelated nodes unhighlighted', async () => {
      const user = userEvent.setup();
      render(<ValentinInspector />);
      await openInspector(user);

      act(() => {
        publishInboundWsEvent(makePreferenceUpdate());
      });

      expect(screen.getByTestId('inspector-node-bedrockClient')).toHaveAttribute(
        'data-active',
        'false',
      );
    });

    it('clears the feed when Clear feed is pressed', async () => {
      const user = userEvent.setup();
      render(<ValentinInspector />);
      await openInspector(user);

      act(() => {
        publishInboundWsEvent(makePreferenceUpdate());
      });
      expect(screen.getAllByTestId('inspector-feed-item')).toHaveLength(1);

      await user.click(screen.getByRole('button', { name: 'Clear feed' }));
      expect(screen.queryAllByTestId('inspector-feed-item')).toHaveLength(0);
    });
  });

  describe('closing', () => {
    it('closes when Escape is pressed', async () => {
      const user = userEvent.setup();
      render(<ValentinInspector />);
      await openInspector(user);
      expect(screen.getByTestId('inspector-panel')).toBeInTheDocument();

      await user.keyboard('{Escape}');
      expect(screen.queryByTestId('inspector-panel')).not.toBeInTheDocument();
    });

    it('returns focus to the toggle after Escape', async () => {
      const user = userEvent.setup();
      render(<ValentinInspector />);
      await openInspector(user);

      await user.keyboard('{Escape}');
      expect(
        screen.getByRole('button', { name: 'Open architecture inspector' }),
      ).toHaveFocus();
    });

    it('closes when the toggle is pressed again', async () => {
      const user = userEvent.setup();
      render(<ValentinInspector />);
      await openInspector(user);

      await user.click(screen.getByRole('button', { name: 'Close architecture inspector' }));
      expect(screen.queryByTestId('inspector-panel')).not.toBeInTheDocument();
    });

    it('closes when the close button is clicked', async () => {
      const user = userEvent.setup();
      render(<ValentinInspector />);
      await openInspector(user);

      await user.click(screen.getByTestId('inspector-close'));
      expect(screen.queryByTestId('inspector-panel')).not.toBeInTheDocument();
    });

    it('returns focus to the toggle after the close button is clicked', async () => {
      const user = userEvent.setup();
      render(<ValentinInspector />);
      await openInspector(user);

      await user.click(screen.getByTestId('inspector-close'));
      expect(
        screen.getByRole('button', { name: 'Open architecture inspector' }),
      ).toHaveFocus();
    });

    it('can be reopened after closing', async () => {
      const user = userEvent.setup();
      render(<ValentinInspector />);
      await openInspector(user);
      await user.keyboard('{Escape}');
      await openInspector(user);
      expect(screen.getByTestId('inspector-panel')).toBeInTheDocument();
    });
  });

  /**
   * The heart of the demo: Coral types into the composer while the Inspector is
   * open. These guard the non-modal contract — nothing may block or trap.
   */
  describe('non-modal coexistence with the page', () => {
    /** Render the Inspector beside a stand-in composer. */
    function renderWithComposer() {
      return render(
        <div>
          <ValentinInspector />
          <input aria-label="Type a message" />
        </div>,
      );
    }

    it('renders no backdrop that could block the page', async () => {
      const user = userEvent.setup();
      renderWithComposer();
      await openInspector(user);
      expect(screen.queryByTestId('inspector-overlay')).not.toBeInTheDocument();
    });

    it('leaves the composer reachable while the panel is open', async () => {
      const user = userEvent.setup();
      renderWithComposer();
      await openInspector(user);

      const composer = screen.getByLabelText('Type a message');
      await user.click(composer);
      expect(composer).toHaveFocus();
    });

    it('leaves the composer typable while the panel is open', async () => {
      const user = userEvent.setup();
      renderWithComposer();
      await openInspector(user);

      const composer = screen.getByLabelText('Type a message');
      await user.click(composer);
      await user.type(composer, 'She loves peonies');

      expect(composer).toHaveValue('She loves peonies');
      // The panel is still open — no toggling required to type.
      expect(screen.getByTestId('inspector-panel')).toBeInTheDocument();
    });

    it('does not trap focus inside the panel', async () => {
      const user = userEvent.setup();
      renderWithComposer();
      await openInspector(user);

      // Tab forward from the close button: focus must escape the panel and
      // reach the composer rather than cycling within the panel.
      screen.getByTestId('inspector-close').focus();
      await user.tab();
      await user.tab();

      expect(screen.getByTestId('inspector-panel')).toBeInTheDocument();
      expect(screen.getByLabelText('Type a message')).toHaveFocus();
    });

    it('keeps composer focus when an event arrives', async () => {
      const user = userEvent.setup();
      renderWithComposer();
      await openInspector(user);

      const composer = screen.getByLabelText('Type a message');
      await user.click(composer);

      act(() => {
        publishInboundWsEvent(makePreferenceUpdate());
      });

      // A live event must never yank focus away mid-sentence.
      expect(composer).toHaveFocus();
      expect(screen.getAllByTestId('inspector-feed-item')).toHaveLength(1);
    });

    it('closes on Escape even while the composer has focus', async () => {
      const user = userEvent.setup();
      renderWithComposer();
      await openInspector(user);

      const composer = screen.getByLabelText('Type a message');
      await user.click(composer);
      await user.keyboard('{Escape}');

      expect(screen.queryByTestId('inspector-panel')).not.toBeInTheDocument();
    });
  });
});
