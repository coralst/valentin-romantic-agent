import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import React, { useEffect } from 'react';
import { ChatProvider, useChatContext } from '../../context/chat-context';
import { PreferencesProvider, usePreferencesContext } from '../../context/preferences-context';
import { GuidedIntro } from '../GuidedIntro';
import { GUIDED_INTRO_BEATS } from '../../demo/guided-intro-script';
import { FIRST_REPLY_TIMEOUT_MS } from '../../demo/use-guided-intro';
import { dispatchServerEvent } from '../../hooks/use-websocket';
import { publishInboundWsEvent, resetWsObservers } from '../../utils/ws-event-observer';
import type { PreferencesAction } from '../../hooks/use-preferences-state';
import type { ChatAction } from '../../hooks/use-chat-state';
import type { ChatMessage } from '../../../shared/interfaces/message';

/**
 * The intro, driven through the component that owns it.
 *
 * Tested from here rather than through `renderHook` on `useGuidedIntro`: the two
 * things most likely to break are the live-then-scripted handover and the wiring
 * of the payoff, and both are only visible where the buttons and the transcript
 * are. The pure half of the machinery has its own tests in
 * `demo/__tests__/guided-intro-script.test.ts`.
 */

const SESSION = 's-intro';

const sendMessage = vi.fn();
const socket = { connectionStatus: 'connected' as 'connected' | 'disconnected' };

vi.mock('../../context/websocket-context', () => ({
  useWebSocketContext: () => ({
    sendMessage,
    connectionStatus: socket.connectionStatus,
    lastError: null,
  }),
}));

const seedDemoSession = vi.fn();
const fetchSessionPreferences = vi.fn();

vi.mock('../../utils/demo-session-api', () => ({
  seedDemoSession: (...args: unknown[]) => seedDemoSession(...args),
  fetchSessionPreferences: (...args: unknown[]) => fetchSessionPreferences(...args),
}));

/** Gives the transcript a session id, which is what `start` requires. */
function Session({ id = SESSION }: { id?: string }) {
  const { dispatch } = useChatContext();
  useEffect(() => {
    dispatch({ type: 'SWITCH_SESSION', sessionId: id, messages: [] });
  }, [dispatch, id]);
  return null;
}

/**
 * Captures the two dispatchers, so a test can deliver a reply the way the socket
 * does — `use-websocket` both publishes to the observer *and* runs
 * `dispatchServerEvent`, and the intro's advance depends on the first while the
 * transcript depends on the second.
 */
let dispatchers: {
  chat: React.Dispatch<ChatAction>;
  preferences: React.Dispatch<PreferencesAction>;
} | null = null;

/** Reads the transcript out, since `MessageHistory` is not mounted here. */
function Transcript() {
  const { state, dispatch } = useChatContext();
  const { dispatch: preferencesDispatch } = usePreferencesContext();
  dispatchers = { chat: dispatch, preferences: preferencesDispatch };
  return (
    <ul data-testid="transcript">
      {state.messages.map((message) => (
        <li key={message.id} data-sender={message.sender}>
          {message.content}
        </li>
      ))}
    </ul>
  );
}

function renderIntro() {
  return render(
    <ChatProvider>
      <PreferencesProvider>
        <Session />
        <GuidedIntro />
        <Transcript />
      </PreferencesProvider>
    </ChatProvider>,
  );
}

/**
 * `fireEvent`, not `userEvent`.
 *
 * `userEvent` awaits real timers between its synthetic events, which deadlocks
 * against the fake clock this whole file runs on — every click times out at 5s
 * even with `advanceTimers` wired up. These are plain buttons with plain
 * handlers; there is no pointer sequence worth simulating.
 */
function click(testId: string) {
  act(() => {
    fireEvent.click(screen.getByTestId(testId));
  });
}

/** Push time forward inside `act`, so React flushes what the timers dispatched. */
async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

/**
 * Let pending promises settle.
 *
 * `waitFor` and `findBy*` are unusable here: they poll on a timer, and the clock
 * they would poll against is the fake one this file controls. Flushing
 * microtasks explicitly is both shorter and exact.
 */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** A reply as the server would send it, for the beat currently in flight. */
function agentReply(beatIndex: number): ChatMessage {
  return {
    id: `real-${beatIndex}`,
    sessionId: SESSION,
    sender: 'agent',
    content: GUIDED_INTRO_BEATS[beatIndex].reply,
    timestamp: new Date(1770000000000 + beatIndex * 1000).toISOString(),
  };
}

function replyOverTheWire(beatIndex: number) {
  const event = {
    type: 'agent_message' as const,
    payload: { message: agentReply(beatIndex) },
    timestamp: new Date(1770000000000 + beatIndex * 1000).toISOString(),
  };
  publishInboundWsEvent(event);
  if (dispatchers) {
    dispatchServerEvent(event, dispatchers.chat, dispatchers.preferences);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  resetWsObservers();
  dispatchers = null;
  socket.connectionStatus = 'connected';
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('before it starts', () => {
  it('invites the visitor in', () => {
    renderIntro();

    expect(screen.getByTestId('guided-intro-start')).toBeEnabled();
  });

  /**
   * The server greets on every connect, so a non-empty transcript is the normal
   * state — only a turn from the visitor means they have taken over.
   */
  it('stays out of the way once the visitor has spoken', () => {
    render(
      <ChatProvider>
        <PreferencesProvider>
          <Spoken />
          <GuidedIntro />
        </PreferencesProvider>
      </ChatProvider>,
    );

    expect(screen.queryByTestId('guided-intro')).toBeNull();
  });

  it('ignores the server greeting, which is on screen before anyone clicks', () => {
    render(
      <ChatProvider>
        <PreferencesProvider>
          <Greeted />
          <GuidedIntro />
        </PreferencesProvider>
      </ChatProvider>,
    );

    expect(screen.getByTestId('guided-intro-start')).toBeInTheDocument();
  });
});

/** A transcript with a turn from the visitor in it. */
function Spoken() {
  const { dispatch } = useChatContext();
  useEffect(() => {
    dispatch({
      type: 'SWITCH_SESSION',
      sessionId: SESSION,
      messages: [
        {
          id: 'mine',
          sessionId: SESSION,
          sender: 'user',
          content: 'Her name is Ada.',
          timestamp: '2026-02-14T18:00:00.000Z',
        },
      ],
    });
  }, [dispatch]);
  return null;
}

/** A transcript holding only the server's welcome. */
function Greeted() {
  const { dispatch } = useChatContext();
  useEffect(() => {
    dispatch({
      type: 'SWITCH_SESSION',
      sessionId: SESSION,
      messages: [
        {
          id: 'welcome',
          sessionId: SESSION,
          sender: 'agent',
          content: 'Tell me about her.',
          timestamp: '2026-02-14T18:00:00.000Z',
        },
      ],
    });
  }, [dispatch]);
  return null;
}

describe('over a live socket', () => {
  it('sends the first prompt and waits for the real answer', async () => {
    renderIntro();

    click('guided-intro-start');

    expect(sendMessage).toHaveBeenCalledWith(GUIDED_INTRO_BEATS[0].prompt);
    expect(screen.getByTestId('guided-intro-progress').textContent).toBe(
      'Listening to Valentin as he answers.',
    );
  });

  /**
   * `sendMessage` never echoes the visitor's turn back — `ChatPanel` dispatches it
   * itself. Any other sender has to do the same or the prompt is never seen.
   */
  it('puts the visitor’s turn in the transcript itself', async () => {
    renderIntro();

    click('guided-intro-start');

    expect(screen.getByTestId('transcript').textContent).toContain(
      GUIDED_INTRO_BEATS[0].prompt,
    );
  });

  it('advances on the real reply rather than on a timer', async () => {
    renderIntro();
    click('guided-intro-start');

    act(() => replyOverTheWire(0));
    await tick(2000);

    expect(sendMessage).toHaveBeenCalledWith(GUIDED_INTRO_BEATS[1].prompt);
    // Still live: the backend answered, so nothing was faked.
    expect(screen.getByTestId('guided-intro-progress').textContent).toBe(
      'Listening to Valentin as he answers.',
    );
  });

  it('does not synthesise a reply the server already gave', async () => {
    renderIntro();
    click('guided-intro-start');

    act(() => replyOverTheWire(0));
    await tick(3000);

    const replies = screen
      .getByTestId('transcript')
      .textContent?.split(GUIDED_INTRO_BEATS[0].reply).length;
    expect(replies).toBe(2); // one split point → the reply appears exactly once
  });

  it('reaches the payoff after the third answer', async () => {
    renderIntro();
    click('guided-intro-start');

    for (let beat = 0; beat < GUIDED_INTRO_BEATS.length; beat += 1) {
      act(() => replyOverTheWire(beat));
      await tick(2000);
    }

    expect(screen.getByTestId('guided-intro-payoff')).toBeInTheDocument();
  });
});

describe('when the backend does not answer', () => {
  /** The entire backup requirement. */
  it('plays the beat from the script after the timeout', async () => {
    renderIntro();
    click('guided-intro-start');

    await tick(FIRST_REPLY_TIMEOUT_MS + 4000);

    expect(screen.getByTestId('transcript').textContent).toContain(
      GUIDED_INTRO_BEATS[0].reply,
    );
    expect(screen.getByTestId('guided-intro-progress').textContent).toBe(
      'Playing the rehearsed answers.',
    );
  });

  it('does not go back to the socket once it has fallen back', async () => {
    renderIntro();
    click('guided-intro-start');
    await tick(FIRST_REPLY_TIMEOUT_MS + 6000);

    const callsAfterFallback = sendMessage.mock.calls.length;
    await tick(20000);

    expect(sendMessage.mock.calls.length).toBe(callsAfterFallback);
  });

  it('runs the whole intro from the script and offers the payoff', async () => {
    renderIntro();
    click('guided-intro-start');

    await tick(FIRST_REPLY_TIMEOUT_MS + 30000);

    expect(screen.getByTestId('guided-intro-payoff')).toBeInTheDocument();
    for (const beat of GUIDED_INTRO_BEATS) {
      expect(screen.getByTestId('transcript').textContent).toContain(beat.reply);
    }
  });

  it('never touches the socket at all when it is already down', async () => {
    socket.connectionStatus = 'disconnected';
    renderIntro();

    click('guided-intro-start');
    await tick(6000);

    expect(sendMessage).not.toHaveBeenCalled();
    expect(screen.getByTestId('transcript').textContent).toContain(
      GUIDED_INTRO_BEATS[0].reply,
    );
  });
});

describe('the skip', () => {
  it('leaves what is already on screen and stops sending', async () => {
    renderIntro();
        click('guided-intro-start');
    click('guided-intro-skip');

    const sentBySkip = sendMessage.mock.calls.length;
    await tick(30000);

    expect(sendMessage.mock.calls.length).toBe(sentBySkip);
    expect(screen.getByTestId('transcript').textContent).toContain(
      GUIDED_INTRO_BEATS[0].prompt,
    );
  });
});

describe('the payoff', () => {
  async function reachThePayoff() {
    renderIntro();
    click('guided-intro-start');
    await tick(FIRST_REPLY_TIMEOUT_MS + 30000);
    expect(screen.getByTestId('guided-intro-payoff')).toBeInTheDocument();
  }

  it('asks the server for Samantha, not for whatever its default is', async () => {
    seedDemoSession.mockResolvedValue({ sessionId: 'seeded', preferenceCount: 18 });
    fetchSessionPreferences.mockResolvedValue([]);
    await reachThePayoff();

    click('guided-intro-payoff');

    await flush();

    expect(seedDemoSession).toHaveBeenCalledWith('samantha');
    expect(fetchSessionPreferences).toHaveBeenCalledWith('seeded');
  });

  /**
   * The three answers the room just watched land are the reason the full profile
   * lands well. Losing them would leave a profile with no story behind it.
   */
  it('keeps the intro transcript', async () => {
    seedDemoSession.mockResolvedValue({ sessionId: 'seeded', preferenceCount: 18 });
    fetchSessionPreferences.mockResolvedValue([]);
    await reachThePayoff();

    click('guided-intro-payoff');

    await flush();

    expect(fetchSessionPreferences).toHaveBeenCalled();
    expect(screen.getByTestId('transcript').textContent).toContain(
      GUIDED_INTRO_BEATS[0].prompt,
    );
  });

  it('says so without wiping the screen when the seed fails', async () => {
    seedDemoSession.mockRejectedValue(new Error('offline'));
    await reachThePayoff();

    click('guided-intro-payoff');

    await flush();

    expect(screen.getByTestId('guided-intro-error').textContent).toContain(
      'still real',
    );
    expect(screen.getByTestId('transcript').textContent).toContain(
      GUIDED_INTRO_BEATS[2].reply,
    );
  });
});
