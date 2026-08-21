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

    it('exposes the panel as a labelled modal dialog', async () => {
      const user = userEvent.setup();
      render(<ValentinInspector />);
      await openInspector(user);
      const panel = screen.getByRole('dialog', { name: 'Live Architecture' });
      expect(panel).toHaveAttribute('aria-modal', 'true');
    });

    it('marks the toggle as expanded once open', async () => {
      const user = userEvent.setup();
      render(<ValentinInspector />);
      await openInspector(user);
      expect(
        screen.getByRole('button', { name: 'Open architecture inspector' }),
      ).toHaveAttribute('aria-expanded', 'true');
    });

    it('moves focus to the close button when opened', async () => {
      const user = userEvent.setup();
      render(<ValentinInspector />);
      await openInspector(user);
      expect(screen.getByTestId('inspector-close')).toHaveFocus();
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
});
