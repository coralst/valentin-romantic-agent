import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ChatProvider, useChatContext } from '../../context/chat-context';
import type { ActionProposalPayload } from '../../../shared/interfaces/ws-events';
import { PreferencesProvider } from '../../context/preferences-context';
import { ChatPanel } from '../ChatPanel';
import { ConnectionBanner } from '../ConnectionBanner';
import { MessageInput } from '../MessageInput';

/** Hoisted so the module mock below and the assertions share one spy. */
const ws = vi.hoisted(() => ({ confirmAction: vi.fn(), sendMessage: vi.fn() }));

// Mock the websocket-context module so ChatPanel can import useWebSocketContext
vi.mock('../../context/websocket-context', () => ({
  useWebSocketContext: () => ({
    sendMessage: ws.sendMessage,
    confirmAction: ws.confirmAction,
    connectionStatus: 'connected' as const,
    lastError: null,
  }),
}));

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ChatProvider>
      <PreferencesProvider>{ui}</PreferencesProvider>
    </ChatProvider>,
  );
}

/**
 * Pushes a proposal into chat state the way the socket would, so the whole
 * propose→confirm path can be exercised through the real components.
 */
function ProposalSeed({ proposal }: { proposal: ActionProposalPayload }) {
  const { dispatch } = useChatContext();
  React.useEffect(() => {
    dispatch({ type: 'RECEIVE_PROPOSAL', proposal });
  }, [dispatch, proposal]);
  return null;
}

describe('ChatPanel', () => {
  it('renders chat panel with input', () => {
    renderWithProviders(<ChatPanel />);
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    expect(screen.getByLabelText('Type a message')).toBeInTheDocument();
  });

  it('sends a confirm_action when a proposal is confirmed, once', async () => {
    const user = userEvent.setup();
    ws.confirmAction.mockClear();
    const proposal: ActionProposalPayload = {
      sessionId: '',
      proposalId: 'prop-1',
      service: 'ontopo',
      title: 'Table for two at Ha-Salon',
      summary: 'Saturday at 20:00. Nothing is booked until you confirm.',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };

    renderWithProviders(
      <>
        <ProposalSeed proposal={proposal} />
        <ChatPanel />
      </>,
    );

    expect(screen.getByText('Table for two at Ha-Salon')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(ws.confirmAction).toHaveBeenCalledWith('prop-1');

    /*
     * The button is gone rather than merely disabled, so it cannot be pressed
     * twice while the tool runs. Ontopo and Gmail are both round trips of a few
     * seconds, which is long enough for a second click.
     */
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    expect(screen.getByTestId('proposal-resolved')).toBeInTheDocument();
  });

  it('keeps a dismissal local — nothing goes to the server', async () => {
    const user = userEvent.setup();
    ws.confirmAction.mockClear();
    const proposal: ActionProposalPayload = {
      sessionId: '',
      proposalId: 'prop-2',
      service: 'gmail',
      title: 'Email to Noa',
      summary: 'A short note about Saturday.',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };

    renderWithProviders(
      <>
        <ProposalSeed proposal={proposal} />
        <ChatPanel />
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(ws.confirmAction).not.toHaveBeenCalled();
    expect(screen.getByTestId('proposal-resolved')).toHaveTextContent('Ask again');
  });
});

describe('MessageInput', () => {
  it('clears input after submit', async () => {
    const user = userEvent.setup();
    let currentValue = 'Hello';
    let submitted = false;

    const { rerender } = render(
      <MessageInput
        value={currentValue}
        onChange={(v) => { currentValue = v; }}
        onSubmit={() => {
          submitted = true;
          currentValue = '';
        }}
      />,
    );

    await user.click(screen.getByLabelText('Send message'));
    expect(submitted).toBe(true);
    expect(currentValue).toBe('');

    rerender(
      <MessageInput
        value={currentValue}
        onChange={(v) => { currentValue = v; }}
        onSubmit={() => {}}
      />,
    );

    const input = screen.getByLabelText('Type a message') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('disables send button when input is empty', () => {
    render(
      <MessageInput value="" onChange={() => {}} onSubmit={() => {}} />,
    );
    const button = screen.getByLabelText('Send message');
    expect(button).toBeDisabled();
  });
});

describe('ConnectionBanner', () => {
  it('shows banner on disconnect', () => {
    render(<ConnectionBanner status="disconnected" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Connection lost. Please check your network.')).toBeInTheDocument();
  });

  it('shows banner on reconnecting', () => {
    render(<ConnectionBanner status="reconnecting" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Reconnecting to Valentin…')).toBeInTheDocument();
  });

  it('returns null when connected', () => {
    const { container } = render(<ConnectionBanner status="connected" />);
    expect(container.innerHTML).toBe('');
  });
});
