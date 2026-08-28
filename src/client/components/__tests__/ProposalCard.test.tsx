import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProposalCard, formatRemaining } from '../ProposalCard';
import type { ActionProposalPayload } from '../../../shared/interfaces/ws-events';

/**
 * The card that turns a proposal into an action.
 *
 * The assertions that matter are the ones about *not* acting: that an expired
 * card cannot be confirmed, that an unreadable expiry counts as expired, and that
 * a resolved card no longer offers a button. Everything the tools were written to
 * guarantee — nothing booked, nothing sent, until a human says yes — is only true
 * if this component holds that line too.
 */

const NOW = new Date('2026-09-05T18:00:00Z').getTime();

function makeProposal(over: Partial<ActionProposalPayload> = {}): ActionProposalPayload {
  return {
    sessionId: 'session-1',
    proposalId: 'p1',
    service: 'ontopo',
    title: 'Table for two at Ha-Salon',
    summary: 'Saturday 5 September at 20:00.\nNothing is booked until you confirm.',
    expiresAt: new Date(NOW + 5 * 60 * 1000).toISOString(),
    ...over,
  };
}

let onConfirm: ReturnType<typeof vi.fn>;
let onDismiss: ReturnType<typeof vi.fn>;

beforeEach(() => {
  onConfirm = vi.fn();
  onDismiss = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderCard(
  props: Partial<React.ComponentProps<typeof ProposalCard>> = {},
): void {
  render(
    <ProposalCard
      proposal={makeProposal()}
      status="open"
      onConfirm={onConfirm}
      onDismiss={onDismiss}
      now={NOW}
      {...props}
    />,
  );
}

describe('formatRemaining', () => {
  it('pads the seconds so the width does not jitter as it counts down', () => {
    expect(formatRemaining(4 * 60_000 + 5_000)).toBe('4m 05s');
    expect(formatRemaining(45_000)).toBe('45s');
  });

  it('says expired at and below zero', () => {
    expect(formatRemaining(0)).toBe('expired');
    expect(formatRemaining(-1)).toBe('expired');
  });
});

describe('ProposalCard', () => {
  it('shows what will happen and who would carry it out', () => {
    renderCard();

    expect(screen.getByText('Table for two at Ha-Salon')).toBeInTheDocument();
    expect(screen.getByText(/Nothing is booked until you confirm/)).toBeInTheDocument();
    expect(screen.getByText(/ontopo/)).toBeInTheDocument();
  });

  it('counts down to the expiry', () => {
    renderCard();
    expect(screen.getByTestId('proposal-countdown')).toHaveTextContent('expires in 5m 00s');
  });

  it('confirms with the proposal id when pressed', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledWith('p1');
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses without confirming', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onDismiss).toHaveBeenCalledWith('p1');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('refuses to confirm an expired proposal, and says why', async () => {
    const user = userEvent.setup();
    renderCard({ proposal: makeProposal({ expiresAt: new Date(NOW - 1000).toISOString() }) });

    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    // Fails closed *out loud*. A greyed-out button with no explanation reads as a
    // bug; the offer behind it really is gone.
    expect(screen.getByText(/This offer has expired/)).toBeInTheDocument();
    expect(screen.getByText(/nothing was booked or sent/)).toBeInTheDocument();
  });

  it('treats an unparseable expiry as expired rather than as forever', () => {
    renderCard({ proposal: makeProposal({ expiresAt: 'not a date' }) });

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(screen.getByTestId('proposal-countdown')).toHaveTextContent('expired');
  });

  it('offers no buttons once it has been answered', () => {
    renderCard({ status: 'confirmed' });

    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    expect(screen.getByTestId('proposal-resolved')).toHaveTextContent(
      'Valentin is carrying this out',
    );
  });

  it('says a dismissed proposal can be asked for again', () => {
    renderCard({ status: 'dismissed' });

    expect(screen.getByTestId('proposal-resolved')).toHaveTextContent('Ask again');
    expect(screen.queryByTestId('proposal-countdown')).not.toBeInTheDocument();
  });

  it('links out only when the provider owns the last step', () => {
    renderCard();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    render(
      <ProposalCard
        proposal={makeProposal({ proposalId: 'p2', url: 'https://s1.ontopo.com/checkout/abc' })}
        status="open"
        onConfirm={onConfirm}
        onDismiss={onDismiss}
        now={NOW}
      />,
    );
    const link = screen.getByRole('link', { name: /Open in ontopo/ });
    expect(link).toHaveAttribute('href', 'https://s1.ontopo.com/checkout/abc');
    // A checkout page is a different site; opening it over the conversation
    // would lose the transcript the user is reading.
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('keeps counting down on its own clock when none is injected', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    render(
      <ProposalCard
        proposal={makeProposal({ expiresAt: new Date(NOW + 3000).toISOString() })}
        status="open"
        onConfirm={onConfirm}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByTestId('proposal-countdown')).toHaveTextContent('expires in 3s');

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    // Reaching the expiry on screen, with no click, must disable the button —
    // this is the case a countdown exists to catch.
    expect(screen.getByTestId('proposal-countdown')).toHaveTextContent('expired');
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });
});
