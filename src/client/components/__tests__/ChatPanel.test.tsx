import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ChatProvider } from '../../context/chat-context';
import { PreferencesProvider } from '../../context/preferences-context';
import { ChatPanel } from '../ChatPanel';
import { ConnectionBanner } from '../ConnectionBanner';
import { MessageInput } from '../MessageInput';

// Mock the websocket-context module so ChatPanel can import useWebSocketContext
vi.mock('../../context/websocket-context', () => ({
  useWebSocketContext: () => ({
    sendMessage: () => {},
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

describe('ChatPanel', () => {
  it('renders chat panel with input', () => {
    renderWithProviders(<ChatPanel />);
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    expect(screen.getByLabelText('Type a message')).toBeInTheDocument();
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
