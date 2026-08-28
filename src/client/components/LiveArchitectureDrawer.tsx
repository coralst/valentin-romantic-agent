import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AwsTopologyDiagram, type NodeDuration } from './AwsTopologyDiagram';
import { AwsFlowFeed, REPLAY_COPY, type FeedGroup, type FeedRow } from './AwsFlowFeed';
import { useArchitectureDrawer } from '../context/architecture-drawer-context';
import { useArchitectureMode, type ArchitectureMode } from '../hooks/use-architecture-mode';
import { useLiveArchitecture } from '../hooks/use-live-architecture';
import { ENGINE_COPY, useArchitectureEngineContext } from '../context/architecture-engine-context';
import { useFlowPlayback } from '../hooks/use-flow-playback';
import { useFlowTraversal } from '../hooks/use-flow-traversal';
import { PANEL_SLIDE_MS } from '../hooks/use-inspector-focus';
import {
  defaultDemoFlowIdFor,
  demoFlow,
  demoStepDwellMs,
  frameForStep,
  stepLegCount,
  type FlowBeat,
} from '../utils/aws-demo-flows';
import type { AwsNodeId } from '../utils/aws-architecture';
import { colors, typography } from '../design-system/tokens';

/**
 * The Live Architecture drawer.
 *
 * Rises from the bottom over the chat and the profile without covering either,
 * which is the whole argument for this shape: when `preference_update` lands you
 * can point at the DynamoDB node lighting up *and* at the new row appearing in
 * her profile in the same breath.
 *
 * Deliberately NOT a dialog. It is `role="complementary"`, has no backdrop, no
 * `aria-modal`, no focus trap, and does not steal focus when it opens — the
 * composer must stay typable while the diagram is up, because on stage the whole
 * point is to send a message and watch it travel.
 */

/** Drawer height. Leaves roughly three messages of chat visible above it. */
export const DRAWER_HEIGHT = 424;
/** The collapsed bar's height, which stays on screen as the way back in. */
export const REOPEN_BAR_HEIGHT = 34;

/**
 * Vertical space the layout must reserve so the drawer does not cover the
 * composer.
 *
 * Lives here, next to the heights themselves, so the layout cannot drift out of
 * agreement with the drawer it is making room for. Open reserves the full
 * drawer; closed reserves just the reopen bar, which is always on screen.
 */
export function reservedDrawerSpace(isOpen: boolean): number {
  return isOpen ? DRAWER_HEIGHT : REOPEN_BAR_HEIGHT;
}

/**
 * The drawer positions itself absolutely against its nearest positioned
 * ancestor, and `AppLayout` gives it a wrapper spanning exactly the grid tracks
 * it should cover — columns 3-4 in the chat shell, column 2 on the dossier. That
 * is why there is no left inset constant: the wrapper's own position supplies it,
 * so a change to the window's column template cannot leave a hardcoded number
 * behind.
 *
 * It must NOT be `position: fixed`, and it must not portal to `document.body`.
 * The old inspector portalled out to escape the app header's `backdrop-filter`,
 * which made it a containing block for fixed descendants. That header is gone,
 * but the conclusion now points the other way: the app window sets
 * `overflow: hidden` to keep its 34px radius crisp, and that clip is exactly what
 * keeps this drawer's bottom corners inside the frame. Portalling out or going
 * fixed would put a square-cornered panel over the window's rounded edge.
 */

export const DRAWER_COPY = {
  title: 'Live Architecture',
  subtitle: 'Real AWS resources · us-east-1 · measured per request',
  hide: 'Hide the architecture drawer',
  reopen: 'Show the architecture drawer',
  liveMode: 'Live',
  demoMode: 'Demo',
  next: 'Next step',
  previous: 'Previous step',
  restart: 'Restart flow',
  liveHeading: 'Live flow',
  demoHeading: 'Demo flow',
  /** Heading while a chosen action is being replayed, in either mode. */
  replayHeading: 'Replay',
  /** Leaves the replay and hands the drawer back to live or demo. */
  exitReplay: 'Stop replaying',
  liveEmpty: 'Waiting for traffic. Send a message and it will appear here.',
  /** Says out loud that demo durations are authored, so nobody reads them as measured. */
  demoNote: 'Scripted walkthrough · representative durations',
  /** Prefix for the chip naming the engine that actually answered. */
  serving: 'Serving',
  /** Shown while `/api/config` on the selected route has not answered yet. */
  servingUnknown: 'Checking engine…',
} as const;

/**
 * The chip that names the engine actually answering.
 *
 * Here rather than beside the switch in the rail, and load-bearing rather than
 * decorative. Selecting AgentCore points the socket at `/ws/agentcore`, but a
 * deployment without the AgentCore wiring accepts that socket and answers on engine
 * A anyway — deliberately, because the alternative is an outage (see
 * `server/agent/engine.ts`). Locally there is only ever one process, so that
 * downgrade is the *normal* case on a laptop. Without this chip the drawer would
 * show AgentCore's diagram over engine A's spans and every number under it would be
 * attributed to the wrong architecture.
 */
function ServingChip({
  serving,
  isDowngraded,
}: {
  serving: 'valentin' | 'agentcore' | null;
  isDowngraded: boolean;
}) {
  const label =
    serving === null
      ? DRAWER_COPY.servingUnknown
      : `${DRAWER_COPY.serving}: ${ENGINE_COPY[serving]}`;

  return (
    <span
      data-testid="architecture-serving-chip"
      data-serving={serving ?? 'unknown'}
      data-downgraded={isDowngraded ? 'true' : 'false'}
      // The mismatch is the only state worth a colour, because it is the only one
      // that contradicts what the rest of the panel is showing.
      title={isDowngraded ? 'The selected engine is not reachable on this deployment' : undefined}
      style={{
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        padding: '4px 8px',
        borderRadius: 6,
        marginLeft: 10,
        whiteSpace: 'nowrap',
        border: `1px solid ${isDowngraded ? '#E0B7A0' : '#E5D9D2'}`,
        background: isDowngraded ? '#FBEDE4' : colors.surface,
        color: isDowngraded ? '#9A5A2B' : '#756A70',
      }}
    >
      {label}
    </span>
  );
}

/** One step of a replayed action, and the key the feed knows it by. */
interface FeedEntry {
  key: string;
  beat: FlowBeat;
}

interface ReplaySelection {
  /** The feed group's id, so the chosen row stays highlighted while it plays. */
  id: string;
  /** `User sends a message in chat` — the action, as the feed captions it. */
  label: string;
  entries: readonly FeedEntry[];
}

/**
 * Names the action being replayed, and the way out of it.
 *
 * Sits where the serving chip sits, and replaces it, because during a replay the
 * question "which engine is answering" has no present tense: nothing is being
 * answered. What matters instead is that these numbers are a recording.
 */
function ReplayChip({ label, onExit }: { label: string; onExit: () => void }) {
  return (
    <span
      data-testid="architecture-replay-chip"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        padding: '4px 6px 4px 8px',
        borderRadius: 6,
        marginLeft: 10,
        whiteSpace: 'nowrap',
        border: '1px solid #E0C3CB',
        background: '#FCF1F3',
        color: '#8C2F45',
      }}
    >
      {`${REPLAY_COPY.replaying}: ${label}`}
      <button
        type="button"
        onClick={onExit}
        aria-label={DRAWER_COPY.exitReplay}
        style={{
          border: 'none',
          background: 'none',
          padding: '0 2px',
          fontSize: 11,
          lineHeight: 1,
          color: '#8C2F45',
          cursor: 'pointer',
          fontFamily: typography.bodyFontFamily,
        }}
      >
        ✕
      </button>
    </span>
  );
}

const drawerStyle: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  height: DRAWER_HEIGHT,
  background: '#FAF4F0',
  borderTop: '1px solid #E5D9D2',
  boxShadow: '0 -14px 34px rgba(42, 34, 38, 0.11)',
  display: 'flex',
  flexDirection: 'column',
  zIndex: 5,
  transition: `transform ${PANEL_SLIDE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
  fontFamily: typography.bodyFontFamily,
};

const buttonStyle: React.CSSProperties = {
  background: colors.surface,
  border: '1px solid #E5D9D2',
  borderRadius: 8,
  padding: '6px 11px',
  fontSize: 11,
  fontWeight: 700,
  color: '#2A2226',
  cursor: 'pointer',
  fontFamily: typography.bodyFontFamily,
};

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: '#8C2F45',
  borderColor: '#8C2F45',
  color: colors.textOnAccent,
};

const ghostButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: 'none',
  borderColor: 'transparent',
  color: '#756A70',
};

/**
 * A two-option segmented control.
 *
 * Generic over the value because the header now carries two of them — the data
 * source and the engine — and two hand-rolled copies would drift apart on the
 * first styling change, which on a projector is immediately visible.
 */
function SegmentedSwitch<T extends string>({
  value,
  options,
  onChange,
  label,
  testId,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  testId?: string;
}) {
  return (
    <div
      style={{ display: 'flex', gap: 4, marginLeft: 14 }}
      role="group"
      aria-label={label}
      data-testid={testId}
    >
      {options.map((option) => {
        const on = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={on}
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              padding: '5px 11px',
              borderRadius: 7,
              border: `1px solid ${on ? '#E5D9D2' : 'transparent'}`,
              background: on ? colors.surface : 'none',
              color: on ? '#8C2F45' : '#A3959C',
              cursor: 'pointer',
              fontFamily: typography.bodyFontFamily,
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

const MODE_OPTIONS: readonly { value: ArchitectureMode; label: string }[] = [
  { value: 'live', label: DRAWER_COPY.liveMode },
  { value: 'demo', label: DRAWER_COPY.demoMode },
];

export function LiveArchitectureDrawer() {
  const { isOpen, isMounted, open, close } = useArchitectureDrawer();
  const { mode, setMode } = useArchitectureMode();
  // The switch itself lives in the icon rail, next to the other things a presenter
  // reaches for mid-sentence; the drawer only reads the choice.
  const { engine, servingEngine, isDowngraded } = useArchitectureEngineContext();
  const live = useLiveArchitecture(true, engine);

  const flow = demoFlow(defaultDemoFlowIdFor(engine));
  const isDemo = mode === 'demo';

  /**
   * The user action being replayed, if any.
   *
   * Replay is a third source alongside live and demo, not a mode you switch into,
   * and that is deliberate: the action worth replaying is usually one that just
   * happened for real, so it has to be reachable from live mode without throwing
   * away the live feed to get there. Its beats are carried in the selection rather
   * than looked up again later — live beats age out at `LIVE_BEAT_LIMIT`, and a
   * replay that lost its steps halfway through would be worse than no replay.
   */
  const [replay, setReplay] = useState<ReplaySelection | null>(null);
  const isReplaying = replay !== null;

  /**
   * Everything the feed lists — the whole flow, or every live beat.
   *
   * Deliberately NOT narrowed to the replay. Narrowing it left exactly one caption
   * on screen, the one already playing, so switching to a different action meant
   * leaving the replay first. The replay narrows what *plays*; the log stays a log,
   * and the feed folds the actions you did not pick.
   */
  const entries: readonly FeedEntry[] = useMemo(() => {
    if (isDemo) {
      // The whole script, not `0..index`. The feed used to reveal itself one row at
      // a time, which reads well but leaves nothing to choose from: on a paused
      // flow at step 0 there is exactly one action in the list. Being able to pick
      // an action out of the log and replay it is worth more than the reveal.
      return flow.steps.map((step, index) => ({ key: `${flow.id}-${index}`, beat: step }));
    }
    return live.beats.map((beat) => ({ key: beat.key, beat }));
  }, [isDemo, flow, live.beats]);

  /** Playback walks the replayed action when there is one, the script otherwise. */
  const playbackSteps: readonly FlowBeat[] = useMemo(
    () => (replay ? replay.entries.map((entry) => entry.beat) : flow.steps),
    [replay, flow.steps],
  );

  const dwellMsForStep = useCallback(
    (index: number) => demoStepDwellMs(playbackSteps[index]),
    [playbackSteps],
  );
  const playback = useFlowPlayback({
    stepCount: playbackSteps.length,
    dwellMsForStep,
  });

  /**
   * Which beat inside the current step the traffic has reached.
   *
   * The step is the presenter's unit — Next moves a step — and this is the
   * animation underneath it, so one hop lights at a time instead of a step's whole
   * route arriving at once.
   */
  const legIndex = useFlowTraversal({
    legCount: stepLegCount(playbackSteps[playback.index]),
    resetKey: `${replay?.id ?? flow.id}-${playback.index}`,
  });

  // Escape closes it. Bound on the document rather than the drawer because focus
  // is deliberately left in the composer — a handler on the panel would never
  // fire, which is the failure this replaces.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, close]);

  /*
   * Switching engines starts everything over. Beats recorded on the other engine
   * name that engine's nodes, so keeping them would leave the feed describing hops
   * the diagram is currently shading out — and a replay of them would animate a
   * route through boxes that are now greyed.
   *
   * Held in a ref rather than listed as dependencies, and that is load-bearing:
   * `playback.restart` is rebuilt whenever `stepCount` changes, and starting a replay
   * changes `stepCount`. Depending on it directly made this effect re-run on the very
   * render that set the replay, so `setReplay(null)` cancelled the replay a click had
   * just asked for — every selection appeared to do nothing at all.
   */
  const resetSources = useRef<() => void>(() => {});
  resetSources.current = () => {
    live.clear();
    playback.restart();
    setReplay(null);
  };
  useEffect(() => {
    resetSources.current();
  }, [engine]);

  // Picking an action starts it from the top and plays it. Choosing "replay" and
  // then having to press Next would not be a replay.
  const goTo = playback.goTo;
  const play = playback.play;
  useEffect(() => {
    if (!replay) return;
    goTo(0);
    play();
  }, [replay, goTo, play]);

  /** The scripted/replayed frame: cumulative to the step, sequential within it. */
  const stepFrame = useMemo(
    () => frameForStep(playbackSteps, playback.index, legIndex),
    [playbackSteps, playback.index, legIndex],
  );

  /**
   * Diagram props, from whichever source is driving.
   *
   * Replay wins over the mode switch: a replay is on screen because someone asked
   * for it, and live traffic arriving underneath must not shove it aside.
   */
  const diagram =
    isDemo || isReplaying
      ? {
          litNode: stepFrame.litNode,
          litIsResponse: stepFrame.litIsResponse,
          doneNodes: stepFrame.doneNodes,
          activeHops: stepFrame.activeHops,
          durations: stepFrame.durations as Readonly<Partial<Record<AwsNodeId, NodeDuration>>>,
        }
      : {
          litNode: live.litNode,
          litIsResponse: live.litIsResponse,
          doneNodes: live.doneNodes,
          activeHops: live.activeHops,
          durations: liveDurations(live.beats, live.currentBeat?.key),
        };

  /**
   * The row the diagram is currently showing, by key.
   *
   * Three different questions, one answer: while replaying it is the replay's own
   * step (which is a row somewhere inside the full list, not at `playback.index` of
   * it); in demo mode it is the script's current step; live, it is the beat still
   * inside its highlight window.
   */
  const currentRowKey = isReplaying
    ? replay.entries[playback.index]?.key
    : isDemo
      ? entries[playback.index]?.key
      : live.currentBeat?.key;

  const rows: readonly FeedRow[] = entries.map((entry) => ({
    key: entry.key,
    service: entry.beat.service,
    operation: entry.beat.operation,
    detail: entry.beat.detail,
    durationLabel: entry.beat.durationMs === undefined ? '—' : `${entry.beat.durationMs} ms`,
    category: entry.beat.category,
    actor: entry.beat.actor,
    action: entry.beat.action,
    isCurrent: entry.key === currentRowKey,
  }));

  /**
   * Replay the chosen action, or step out of a replay by choosing it again.
   *
   * The group's own rows are the steps, so this works identically over a scripted
   * flow and over beats that really happened — which is the reason `LiveBeat` and
   * `ResolvedDemoStep` were made to share a shape.
   */
  const selectGroup = useCallback(
    (group: FeedGroup) => {
      if (replay?.id === group.id) {
        setReplay(null);
        return;
      }
      const byKey = new Map(entries.map((entry) => [entry.key, entry]));
      const chosen = group.rows
        .map((row) => byKey.get(row.key))
        .filter((entry): entry is FeedEntry => entry !== undefined);
      if (chosen.length === 0) return;

      setReplay({ id: group.id, label: `${group.actor} ${group.action}`, entries: chosen });
    },
    [entries, replay?.id],
  );

  const exitReplay = useCallback(() => setReplay(null), []);

  const summary = isReplaying
    ? `${REPLAY_COPY.replaying} · ${replay.entries.length} step${replay.entries.length === 1 ? '' : 's'}`
    : isDemo
      ? DRAWER_COPY.demoNote
      : `${live.spanCount} span${live.spanCount === 1 ? '' : 's'} · ${live.modelCallCount} model call${live.modelCallCount === 1 ? '' : 's'}`;

  // The step readout the reopen bar shows. Computed here rather than interpolated
  // once, so it stays truthful while the drawer is down — the mockup baked it in
  // at render and it never updated again.
  const stepReadout =
    isDemo || isReplaying
      ? `Step ${Math.max(playback.index, 0) + 1} of ${playbackSteps.length}`
      : `${live.beats.length} event${live.beats.length === 1 ? '' : 's'}`;

  return (
    <>
      {isMounted && (
        <section
          // Not a dialog: no modality, no backdrop, no focus trap. The composer
          // has to stay usable while this is on screen.
          role="complementary"
          aria-label={DRAWER_COPY.title}
          data-testid="architecture-drawer"
          data-open={isOpen ? 'true' : 'false'}
          style={{
            ...drawerStyle,
            transform: isOpen ? 'translateY(0)' : 'translateY(100%)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              padding: '14px 20px 10px',
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: typography.headingFontFamily,
                  fontSize: 17,
                  color: '#2A2226',
                }}
              >
                {DRAWER_COPY.title}
              </div>
              <div style={{ fontSize: 10, color: '#A3959C', marginTop: 1 }}>
                {DRAWER_COPY.subtitle}
              </div>
            </div>

            <SegmentedSwitch
              value={mode}
              options={MODE_OPTIONS}
              onChange={setMode}
              label="Data source"
            />

            {/* Only in live mode: a scripted walkthrough is not being answered by
                any engine, so naming one there would be a claim about nothing. */}
            {!isDemo && !isReplaying && (
              <ServingChip serving={servingEngine} isDowngraded={isDowngraded} />
            )}

            {/* What is on screen, when it is neither the live feed nor the script.
                Without it a replayed conversation in live mode is indistinguishable
                from traffic happening now. */}
            {replay && <ReplayChip label={replay.label} onExit={exitReplay} />}

            <div
              style={{
                marginLeft: 'auto',
                display: 'flex',
                gap: 6,
                alignItems: 'center',
              }}
            >
              {/* Step controls belong to whatever can actually be stepped: the
                  script, or a replay. Live traffic cannot be rewound, and a
                  disabled ◀ beside real events invites the question of why it does
                  nothing — which is exactly why replaying an action gets them
                  back even though the mode switch still says Live. */}
              {(isDemo || isReplaying) && (
                <>
                  <button
                    type="button"
                    style={buttonStyle}
                    onClick={playback.previous}
                    disabled={playback.index <= 0}
                    aria-label={DRAWER_COPY.previous}
                  >
                    ◀
                  </button>
                  <button
                    type="button"
                    style={primaryButtonStyle}
                    onClick={playback.next}
                    disabled={playback.isComplete}
                    aria-label={DRAWER_COPY.next}
                  >
                    {DRAWER_COPY.next} ▶
                  </button>
                  <button
                    type="button"
                    style={ghostButtonStyle}
                    onClick={playback.restart}
                    aria-label={DRAWER_COPY.restart}
                  >
                    ↺
                  </button>
                  <span
                    data-testid="architecture-step-count"
                    style={{
                      fontSize: 10.5,
                      color: '#756A70',
                      fontVariantNumeric: 'tabular-nums',
                      minWidth: 74,
                      textAlign: 'right',
                    }}
                  >
                    {stepReadout}
                  </span>
                </>
              )}
              <button
                type="button"
                style={ghostButtonStyle}
                onClick={close}
                aria-label={DRAWER_COPY.hide}
              >
                Hide ▾
              </button>
            </div>
          </div>

          <div
            style={{
              flex: 1,
              display: 'flex',
              gap: 20,
              padding: '0 20px 18px',
              minHeight: 0,
              overflowX: 'auto',
            }}
          >
            <AwsTopologyDiagram {...diagram} engine={engine} />
            <AwsFlowFeed
              rows={rows}
              summary={summary}
              heading={
                isReplaying
                  ? DRAWER_COPY.replayHeading
                  : isDemo
                    ? DRAWER_COPY.demoHeading
                    : DRAWER_COPY.liveHeading
              }
              emptyMessage={isDemo ? undefined : DRAWER_COPY.liveEmpty}
              onSelectGroup={selectGroup}
              selectedGroupId={replay?.id ?? null}
            />
          </div>
        </section>
      )}

      {/* The bar left behind when the drawer is down: the affordance that says it
          can come back, and a reminder of which step it is holding. */}
      <button
        type="button"
        onClick={open}
        aria-label={DRAWER_COPY.reopen}
        data-testid="architecture-reopen-bar"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: REOPEN_BAR_HEIGHT,
          background: '#2A2226',
          color: colors.textOnAccent,
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '0 20px',
          fontSize: 11,
          cursor: 'pointer',
          zIndex: 6,
          border: 'none',
          textAlign: 'left',
          fontFamily: typography.bodyFontFamily,
          transform: isOpen ? 'translateY(100%)' : 'translateY(0)',
          transition: `transform ${PANEL_SLIDE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: '#0E9B84',
            flexShrink: 0,
          }}
        />
        {DRAWER_COPY.title}
        <b style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{stepReadout}</b>
        <span aria-hidden="true" style={{ marginLeft: 'auto', fontSize: 13 }}>
          ▴
        </span>
      </button>
    </>
  );
}

/** Latest measured duration per node, from the live beats that carried one. */
function liveDurations(
  beats: readonly {
    key: string;
    to: AwsNodeId;
    durationMs?: number;
    ok?: boolean;
  }[],
  currentKey: string | undefined,
): Readonly<Partial<Record<AwsNodeId, NodeDuration>>> {
  const durations: Partial<Record<AwsNodeId, NodeDuration>> = {};

  for (const beat of beats) {
    if (beat.durationMs === undefined) continue;
    durations[beat.to] = {
      label: `${beat.durationMs} ms`,
      ok: beat.ok === true,
      current: beat.key === currentKey,
    };
  }

  return durations;
}
