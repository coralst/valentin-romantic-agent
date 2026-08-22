import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatAction } from '../hooks/use-chat-state';
import type { PreferencesAction } from '../hooks/use-preferences-state';
import { dispatchServerEvent } from '../hooks/use-websocket';
import { publishInboundWsEvent, subscribeToWsEvents } from '../utils/ws-event-observer';
import { prefersReducedMotion } from '../utils/motion-preference';
import type { ServerEvent } from '../../shared/interfaces/ws-events';
import {
  BEAT_TIMESTAMP_SPAN_MS,
  GUIDED_INTRO_BEATS,
  buildBeatEvents,
} from './guided-intro-script';

/**
 * Plays the three-beat introduction, over the real socket when it answers and
 * from the local script when it does not.
 *
 * **Why this is not built on `use-flow-playback`.** That hook is index-driven and
 * renders cumulatively — its own docs say rendering must be a pure function of
 * `0..index`, which is what makes stepping backwards exact. The chat reducers are
 * the opposite: `SEND_MESSAGE` and `RECEIVE_MESSAGE` *append*. Driving appends
 * from an index means a backward step appends a second copy of every message. It
 * also autoplays on a timer, which would race the live reply it is supposed to be
 * waiting for. So this is a forward-only player: beats advance when the reply
 * they asked for arrives, or when it demonstrably will not.
 *
 * **Why the fallback is invisible.** It does not render anything of its own. It
 * synthesises the `ServerEvent`s the server would have sent and pushes them
 * through `dispatchServerEvent` — the same pure function the socket's `onmessage`
 * calls — and through `publishInboundWsEvent`, which is what moves the
 * architecture drawer out of `demo` mode. Every downstream behaviour (typing
 * indicator, transcript, `LearnedChip`, the profile highlight flash, the drawer)
 * is reached by the identical code path.
 */

export type GuidedIntroPhase = 'idle' | 'running' | 'complete';

/** Where the current run's events are coming from. */
export type GuidedIntroSource = 'live' | 'scripted';

/**
 * How long to wait for a real reply before giving up on the backend.
 *
 * Eight seconds is the agreed budget. A cold Bedrock call plus extraction runs
 * well under it; anything longer is a failure the room can already see.
 */
export const FIRST_REPLY_TIMEOUT_MS = 8000;

/** Pause between a beat finishing and the next prompt being sent. */
const BEAT_GAP_MS = 1400;

/**
 * Playback speed for scripted events, relative to their scripted offsets.
 *
 * The script's offsets span 3s per beat, which is roughly what the real thing
 * takes — so 1 is deliberate, not a placeholder. It exists as a named constant
 * because the reduced-motion path sets it to 0.
 */
const SCRIPT_SPEED = 1;

export interface UseGuidedIntroOptions {
  sessionId: string | null;
  /** The live socket's send. Called only while the source is `live`. */
  sendMessage: (content: string) => void;
  chatDispatch: React.Dispatch<ChatAction>;
  preferencesDispatch: React.Dispatch<PreferencesAction>;
  connectionStatus: 'connected' | 'reconnecting' | 'disconnected';
  /** Overridable for tests. */
  firstReplyTimeoutMs?: number;
  /** Overridable for tests, so a run is not anchored to wall-clock time. */
  now?: () => number;
}

export interface UseGuidedIntroResult {
  phase: GuidedIntroPhase;
  source: GuidedIntroSource;
  /** Index of the beat in flight, or -1 before the first one. */
  beatIndex: number;
  beatCount: number;
  /** Begin. A no-op if already running, or if there is no session yet. */
  start: () => void;
  /**
   * Abandon the run and let the visitor take over the conversation. Leaves
   * everything already on screen in place — nothing is rewound.
   */
  stop: () => void;
}

export function useGuidedIntro({
  sessionId,
  sendMessage,
  chatDispatch,
  preferencesDispatch,
  connectionStatus,
  firstReplyTimeoutMs = FIRST_REPLY_TIMEOUT_MS,
  now = () => Date.now(),
}: UseGuidedIntroOptions): UseGuidedIntroResult {
  const [phase, setPhase] = useState<GuidedIntroPhase>('idle');
  const [source, setSource] = useState<GuidedIntroSource>('live');
  const [beatIndex, setBeatIndex] = useState(-1);

  /**
   * Everything the player needs to make a decision, held in refs.
   *
   * The alternative is naming them in the effect deps, which would restart the
   * run whenever the transcript changed — i.e. on every beat.
   */
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const startedAtRef = useRef(0);
  const sourceRef = useRef<GuidedIntroSource>('live');
  const beatRef = useRef(-1);
  const runningRef = useRef(false);
  const sessionIdRef = useRef<string | null>(sessionId);
  sessionIdRef.current = sessionId;
  const awaitingReplyRef = useRef(false);

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) clearTimeout(timer);
    timersRef.current = [];
  }, []);

  const schedule = useCallback((fn: () => void, delayMs: number) => {
    // Reduced motion collapses the pacing but keeps the ordering: the events
    // still arrive in sequence, just without the dwell between them.
    const delay = prefersReducedMotion() ? 0 : delayMs;
    timersRef.current.push(setTimeout(fn, delay));
  }, []);

  const stop = useCallback(() => {
    runningRef.current = false;
    awaitingReplyRef.current = false;
    clearTimers();
    setPhase((current) => (current === 'running' ? 'complete' : current));
  }, [clearTimers]);

  /** Feed one synthesised event down the real path. */
  const emitScripted = useCallback(
    (event: ServerEvent) => {
      publishInboundWsEvent(event);
      dispatchServerEvent(event, chatDispatch, preferencesDispatch);
    },
    [chatDispatch, preferencesDispatch],
  );

  // Declared before `playBeat` needs it and assigned after, because the two call
  // each other: a beat finishing starts the next one.
  const playBeatRef = useRef<(index: number) => void>(() => {});

  const finishBeat = useCallback(
    (index: number) => {
      awaitingReplyRef.current = false;
      if (!runningRef.current) return;

      if (index + 1 >= GUIDED_INTRO_BEATS.length) {
        runningRef.current = false;
        setPhase('complete');
        return;
      }

      schedule(() => playBeatRef.current(index + 1), BEAT_GAP_MS);
    },
    [schedule],
  );

  const playBeat = useCallback(
    (index: number) => {
      const session = sessionIdRef.current;
      if (!runningRef.current || !session) return;

      const beat = GUIDED_INTRO_BEATS[index];
      const built = buildBeatEvents(beat, {
        sessionId: session,
        beatIndex: index,
        startedAtMs: startedAtRef.current,
      });

      beatRef.current = index;
      setBeatIndex(index);

      // The visitor's turn is dispatched locally either way — `sendMessage` puts
      // the frame on the wire but never echoes it into the transcript, exactly as
      // `ChatPanel` does when someone types.
      chatDispatch({ type: 'SEND_MESSAGE', message: built.userMessage });

      if (sourceRef.current === 'live' && connectionStatus === 'connected') {
        awaitingReplyRef.current = true;
        sendMessage(beat.prompt);

        // The whole backup requirement in one timer: if no reply lands, stop
        // waiting and play this same beat from the script.
        schedule(() => {
          if (!awaitingReplyRef.current || !runningRef.current) return;
          sourceRef.current = 'scripted';
          setSource('scripted');
          playScripted(index, built.events);
        }, firstReplyTimeoutMs);
        return;
      }

      sourceRef.current = 'scripted';
      setSource('scripted');
      playScripted(index, built.events);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- playScripted is defined below and stable
    [chatDispatch, connectionStatus, firstReplyTimeoutMs, schedule, sendMessage],
  );

  /**
   * Replay a beat's synthesised events on their own scripted clock.
   *
   * Only the server's half. The visitor's turn is always dispatched by `playBeat`
   * before either source is chosen — so by the time a live attempt times out, it
   * is already on screen, and re-sending it here would show it twice.
   */
  const playScripted = useCallback(
    (index: number, events: readonly ServerEvent[]) => {
      awaitingReplyRef.current = false;
      const base = startedAtRef.current + index * BEAT_TIMESTAMP_SPAN_MS;

      let last = 0;
      for (const event of events) {
        const offset = Math.max(0, Date.parse(event.timestamp) - base);
        last = offset;
        schedule(() => emitScripted(event), offset * SCRIPT_SPEED);
      }

      schedule(() => finishBeat(index), last * SCRIPT_SPEED + 200);
    },
    [emitScripted, finishBeat, schedule],
  );

  playBeatRef.current = playBeat;

  /**
   * Advance on a real reply.
   *
   * Subscribing to the observer rather than watching chat state: the transcript
   * is appended to by both sources, so "did the *server* answer" is not a
   * question the state can answer. The observer sees the wire.
   */
  useEffect(() => {
    return subscribeToWsEvents(({ direction, event }) => {
      if (direction !== 'inbound' || !awaitingReplyRef.current) return;
      if (event.type !== 'agent_message') return;
      if (event.payload.message.sessionId !== sessionIdRef.current) return;

      // The reply arrived, so the backend is alive. Cancel the fallback timer for
      // this beat and move on once the extraction has had a moment to land.
      clearTimers();
      finishBeat(beatRef.current);
    });
  }, [clearTimers, finishBeat]);

  /** A socket that drops mid-run hands the rest of the intro to the script. */
  useEffect(() => {
    if (!runningRef.current || connectionStatus === 'connected') return;
    if (!awaitingReplyRef.current) return;

    const session = sessionIdRef.current;
    if (!session) return;

    clearTimers();
    sourceRef.current = 'scripted';
    setSource('scripted');
    const built = buildBeatEvents(GUIDED_INTRO_BEATS[beatRef.current], {
      sessionId: session,
      beatIndex: beatRef.current,
      startedAtMs: startedAtRef.current,
    });
    playScripted(beatRef.current, built.events);
  }, [clearTimers, connectionStatus, playScripted]);

  useEffect(() => clearTimers, [clearTimers]);

  const start = useCallback(() => {
    if (runningRef.current || !sessionIdRef.current) return;

    clearTimers();
    runningRef.current = true;
    startedAtRef.current = now();
    sourceRef.current = 'live';
    setSource('live');
    setPhase('running');
    playBeatRef.current(0);
  }, [clearTimers, now]);

  return {
    phase,
    source,
    beatIndex,
    beatCount: GUIDED_INTRO_BEATS.length,
    start,
    stop,
  };
}
