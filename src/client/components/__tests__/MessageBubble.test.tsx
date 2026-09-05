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

  it('renders agent message with the crest avatar', () => {
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
    // The avatar is the crest image, not a lettermark — assert on the image.
    expect(screen.getByRole('img', { name: 'Valentin' })).toBeInTheDocument();
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
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(bubble.textContent).toContain('Hi there');
  });

  /**
   * The tail corner is the design's sender cue: the tight 8px corner sits on the
   * side the message comes from, so the two radii must not be interchangeable.
   */
  it('mirrors the bubble tail corner by sender (geometry)', () => {
    const base = { id: '4', sessionId: 's1', content: 'x', timestamp: new Date().toISOString() };

    const { unmount } = render(<MessageBubble message={{ ...base, sender: 'agent' }} />);
    // The bubble is the element after the avatar in the agent row.
    const agentRadius = getComputedStyle(
      screen.getByTestId('message-bubble').children[1] as HTMLElement,
    ).borderRadius;
    unmount();

    render(<MessageBubble message={{ ...base, sender: 'user' }} />);
    const userRadius = getComputedStyle(
      screen.getByTestId('message-bubble').children[0] as HTMLElement,
    ).borderRadius;

    // Agent: tight corner top-left. User: tight corner top-right.
    expect(agentRadius).toBe('8px 26px 26px 26px');
    expect(userRadius).toBe('26px 8px 26px 26px');
    expect(agentRadius).not.toBe(userRadius);
  });

  it('never renders a square corner on either sender (no sharp corners)', () => {
    const base = { id: '5', sessionId: 's1', content: 'y', timestamp: new Date().toISOString() };

    for (const sender of ['agent', 'user'] as const) {
      const { unmount } = render(<MessageBubble message={{ ...base, sender }} />);
      const row = screen.getByTestId('message-bubble');
      const bubble = (sender === 'agent' ? row.children[1] : row.children[0]) as HTMLElement;
      const radii = getComputedStyle(bubble).borderRadius.split(' ');
      for (const corner of radii) {
        expect(parseFloat(corner)).toBeGreaterThan(0);
      }
      unmount();
    }
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

  /**
   * THE USER'S REPRO: "go to another chat and then back to the original chat it
   * 'write again' the last messages."
   *
   * Nothing was duplicated — the last agent message was re-typed. `animate` is
   * true for whichever agent message is last, which is right for a reply that has
   * just arrived and wrong for one being restored, and a session switch unmounts
   * and remounts the transcript. The reveal must therefore happen once per
   * message, not once per mount.
   */
  describe('reveal runs once per message', () => {
    /** The presentational span — the one the typewriter drives. */
    function revealed(): string {
      const bubble = screen.getByTestId('message-bubble');
      return bubble.querySelector('[aria-hidden="true"]')?.textContent ?? '';
    }

    it('renders in full on a remount instead of typing itself out again', () => {
      const msg: ChatMessage = {
        id: 'reveal-once',
        sessionId: 's1',
        sender: 'agent',
        content: 'A reply long enough that a re-type would be unmistakable.',
        timestamp: new Date().toISOString(),
      };

      // First arrival: the reveal starts from nothing.
      const first = render(<MessageBubble message={msg} animate />);
      expect(revealed()).toBe('');
      first.unmount();

      // Coming back to the conversation. Same message, same `animate`.
      render(<MessageBubble message={msg} animate />);
      expect(revealed()).toBe(msg.content);
    });

    /**
     * A hydrated message is told not to animate, and its age is no longer part of
     * the decision — `MessageHistory` answers "did this arrive or was it loaded?"
     * from `ChatState.liveMessageIds`. A seconds-old timestamp used to be enough
     * to trigger the reveal on its own, which is what made the replay
     * intermittent; the bubble must obey `animate` and nothing else.
     */
    it('renders a not-animating message in full however fresh its timestamp is', () => {
      const msg: ChatMessage = {
        id: 'restored',
        sessionId: 's1',
        sender: 'agent',
        content: 'Said a moment ago, but loaded rather than delivered.',
        timestamp: new Date().toISOString(),
      };

      render(<MessageBubble message={msg} animate={false} />);

      expect(revealed()).toBe(msg.content);
    });

    it('still animates a message it has not shown before', () => {
      const base = {
        sessionId: 's1',
        sender: 'agent' as const,
        content: 'Something new.',
        timestamp: new Date().toISOString(),
      };

      const first = render(<MessageBubble message={{ ...base, id: 'seen' }} animate />);
      first.unmount();

      render(<MessageBubble message={{ ...base, id: 'unseen' }} animate />);
      expect(revealed()).toBe('');
    });
  });

  /**
   * The regression that made every emailed share link fail: a base64url token
   * carries `_` characters, and the `_..._` emphasis rule italicised the middle of
   * the URL and deleted the underscores. It still looked like a link.
   */
  describe('URLs in message text', () => {
    const shareUrl =
      'https://d26dwovftfq9oe.cloudfront.net/?share=eyJ1c2VySWQiOiJhIn0.l_QyJ_9-abc';

    const bubbleFor = (content: string) => {
      render(
        <MessageBubble
          message={{
            id: `m-${Math.random()}`,
            sessionId: 's1',
            sender: 'agent',
            content,
            timestamp: new Date().toISOString(),
          }}
        />,
      );
      return screen.getByTestId('message-bubble');
    };

    it('keeps every character of a URL containing underscores', () => {
      expect(bubbleFor(`Here it is: ${shareUrl}`).textContent).toContain(shareUrl);
    });

    it('renders it as a clickable link to exactly that URL', () => {
      const anchor = bubbleFor(`Here it is: ${shareUrl}`).querySelector('a');
      expect(anchor?.getAttribute('href')).toBe(shareUrl);
    });

    it('does not italicise inside a URL', () => {
      expect(bubbleFor(shareUrl).querySelector('em')).toBeNull();
    });

    it('leaves a trailing full stop out of the link', () => {
      const anchor = bubbleFor(`Open ${shareUrl}.`).querySelector('a');
      expect(anchor?.getAttribute('href')).toBe(shareUrl);
    });

    it('still emphasises prose around the URL', () => {
      const bubble = bubbleFor(`*Read this* at ${shareUrl}`);
      expect(bubble.querySelector('em')?.textContent).toBe('Read this');
      expect(bubble.querySelector('a')?.getAttribute('href')).toBe(shareUrl);
    });

    it('still emphasises an ordinary underscored phrase with no URL', () => {
      expect(bubbleFor('that was _lovely_').querySelector('em')?.textContent).toBe('lovely');
    });
  });
});
