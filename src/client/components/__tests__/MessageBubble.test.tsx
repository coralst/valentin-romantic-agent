import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import fc from 'fast-check';
import { MessageBubble } from '../MessageBubble';
import type { ChatMessage } from '../../../shared/interfaces/message';

/** Arbitrary that produces a valid ISO timestamp string */
const isoTimestampArb = fc
  .integer({ min: 0, max: 4_102_444_800_000 }) // 0 to ~2100-01-01
  .map((ms) => new Date(ms).toISOString());

describe('MessageBubble', () => {
  /**
   * Property 12: Message styling differs by sender
   * For any ChatMessage, CSS class when sender==='agent' differs from sender==='user'.
   * **Validates: Requirements 5.4**
   */
  it('applies distinct styling for agent vs user messages (Property 12)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.uuid(),
        fc.uuid(),
        isoTimestampArb,
        (content, id, sessionId, timestamp) => {
          const baseMsg = { id, sessionId, content, timestamp };

          const agentMsg: ChatMessage = { ...baseMsg, sender: 'agent' };
          const userMsg: ChatMessage = { ...baseMsg, sender: 'user' };

          const { unmount: unmount1 } = render(<MessageBubble message={agentMsg} />);
          const agentBubble = screen.getByTestId('message-bubble');
          const agentSender = agentBubble.getAttribute('data-sender');
          unmount1();

          const { unmount: unmount2 } = render(<MessageBubble message={userMsg} />);
          const userBubble = screen.getByTestId('message-bubble');
          const userSender = userBubble.getAttribute('data-sender');
          unmount2();

          expect(agentSender).toBe('agent');
          expect(userSender).toBe('user');
          expect(agentSender).not.toBe(userSender);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('renders agent message with avatar', () => {
    const msg: ChatMessage = {
      id: '1',
      sessionId: 's1',
      sender: 'agent',
      content: 'Hello!',
      timestamp: new Date().toISOString(),
    };
    render(<MessageBubble message={msg} />);
    const bubble = screen.getByTestId('message-bubble');
    expect(bubble.getAttribute('data-sender')).toBe('agent');
    expect(bubble.textContent).toContain('V');
    expect(bubble.textContent).toContain('Hello!');
  });

  it('renders user message without avatar', () => {
    const msg: ChatMessage = {
      id: '2',
      sessionId: 's1',
      sender: 'user',
      content: 'Hi there',
      timestamp: new Date().toISOString(),
    };
    render(<MessageBubble message={msg} />);
    const bubble = screen.getByTestId('message-bubble');
    expect(bubble.getAttribute('data-sender')).toBe('user');
    expect(bubble.textContent).not.toContain('V');
    expect(bubble.textContent).toContain('Hi there');
  });

  it('exposes full agent message content even when animating (a11y, no regression)', () => {
    const msg: ChatMessage = {
      id: '3',
      sessionId: 's1',
      sender: 'agent',
      content: 'This should be fully readable by screen readers',
      timestamp: new Date().toISOString(),
    };
    // Animated: the visually-hidden span must still carry the complete text.
    render(<MessageBubble message={msg} animate />);
    const bubble = screen.getByTestId('message-bubble');
    expect(bubble.textContent).toContain(
      'This should be fully readable by screen readers',
    );
  });
});
