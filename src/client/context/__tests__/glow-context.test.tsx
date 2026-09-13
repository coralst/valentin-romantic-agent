import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { GlowProvider, useGlow } from '../glow-context';
import { GLOW_ATTRIBUTE } from '../../hooks/use-glow-painter';
import type { GlowTarget } from '../../utils/glow-target';

const REPLY: GlowTarget = { kind: 'message', messageId: 'message-9' };
const FACT: GlowTarget = {
  kind: 'preference',
  preferenceId: 'pref-1',
  sourceMessageId: 'message-7',
};

/**
 * Stands in for the drawer's feed: two rows that can be pinned and previewed,
 * mounted as a sibling of the markup they light up — the arrangement the real app
 * has, where the feed is in the window's footer and its targets are inside it.
 */
function Feed() {
  const { pinnedKey, togglePin, preview } = useGlow();

  return (
    <div>
      <span data-testid="pinned">{pinnedKey ?? 'none'}</span>
      <button
        data-testid="row-reply"
        onClick={() => togglePin({ key: 'row-reply', targets: [REPLY] })}
        onMouseEnter={() => preview({ key: 'row-reply', targets: [REPLY] })}
        onMouseLeave={() => preview(null)}
      >
        writes a reply
      </button>
      <button
        data-testid="row-fact"
        onClick={() => togglePin({ key: 'row-fact', targets: [FACT] })}
        onMouseEnter={() => preview({ key: 'row-fact', targets: [FACT] })}
        onMouseLeave={() => preview(null)}
      >
        learns something new
      </button>
    </div>
  );
}

function renderApp() {
  return render(
    <GlowProvider>
      <Feed />
      <div data-message-id="message-9">the reply</div>
      <div data-noted-for="message-7">Noted · Chinese food</div>
    </GlowProvider>,
  );
}

const reply = () => screen.getByText('the reply');
const badge = () => screen.getByText('Noted · Chinese food');

describe('GlowProvider', () => {
  it('lights nothing until something is pointed at', () => {
    renderApp();

    expect(reply()).not.toHaveAttribute(GLOW_ATTRIBUTE);
    expect(screen.getByTestId('pinned')).toHaveTextContent('none');
  });

  it('holds a glow on when a row is clicked', async () => {
    renderApp();

    await userEvent.click(screen.getByTestId('row-reply'));

    expect(reply()).toHaveAttribute(GLOW_ATTRIBUTE, 'pin');
    expect(screen.getByTestId('pinned')).toHaveTextContent('row-reply');
  });

  it('lets go when the same row is clicked again, and keeps the hover it is under', async () => {
    renderApp();

    await userEvent.click(screen.getByTestId('row-reply'));
    await userEvent.click(screen.getByTestId('row-reply'));

    expect(screen.getByTestId('pinned')).toHaveTextContent('none');
    /*
     * Still ringed, and correctly so: un-pinning does not move the pointer, which
     * is on the row that was just clicked. Demoting to a preview is what the
     * pointer is asking for, and moving away clears it.
     */
    expect(reply()).toHaveAttribute(GLOW_ATTRIBUTE, 'preview');

    await userEvent.unhover(screen.getByTestId('row-reply'));

    expect(reply()).not.toHaveAttribute(GLOW_ATTRIBUTE);
  });

  it('moves the glow rather than accumulating one per row', async () => {
    renderApp();

    await userEvent.click(screen.getByTestId('row-reply'));
    await userEvent.click(screen.getByTestId('row-fact'));

    expect(reply()).not.toHaveAttribute(GLOW_ATTRIBUTE);
    expect(badge()).toHaveAttribute(GLOW_ATTRIBUTE, 'pin');
  });

  it('shows a hovered row as a still ring, not a pulse', async () => {
    renderApp();

    await userEvent.hover(screen.getByTestId('row-reply'));

    expect(reply()).toHaveAttribute(GLOW_ATTRIBUTE, 'preview');
    // A hover commits to nothing.
    expect(screen.getByTestId('pinned')).toHaveTextContent('none');
  });

  it('falls back to the pinned row when the pointer leaves another one', async () => {
    renderApp();

    await userEvent.click(screen.getByTestId('row-reply'));
    await userEvent.hover(screen.getByTestId('row-fact'));

    expect(badge()).toHaveAttribute(GLOW_ATTRIBUTE, 'preview');
    expect(reply()).not.toHaveAttribute(GLOW_ATTRIBUTE);

    await userEvent.unhover(screen.getByTestId('row-fact'));

    expect(badge()).not.toHaveAttribute(GLOW_ATTRIBUTE);
    expect(reply()).toHaveAttribute(GLOW_ATTRIBUTE, 'pin');
  });

  it('does not demote the pinned row to a preview when the pointer returns to it', async () => {
    // Otherwise moving back onto the row you just clicked stops the pulse, which
    // reads as having lost the selection.
    renderApp();

    await userEvent.click(screen.getByTestId('row-reply'));
    await userEvent.hover(screen.getByTestId('row-reply'));

    expect(reply()).toHaveAttribute(GLOW_ATTRIBUTE, 'pin');
  });
});

describe('useGlow without a provider', () => {
  it('is inert rather than throwing, so a component can be tested on its own', async () => {
    render(<Feed />);

    await userEvent.click(screen.getByTestId('row-reply'));

    expect(screen.getByTestId('pinned')).toHaveTextContent('none');
  });
});
