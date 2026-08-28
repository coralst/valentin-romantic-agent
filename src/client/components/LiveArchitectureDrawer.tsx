import { useCallback, useEffect, useMemo } from 'react';
import { AwsTopologyDiagram, type NodeDuration } from './AwsTopologyDiagram';
import { AwsFlowFeed, type FeedRow } from './AwsFlowFeed';
import { useArchitectureDrawer } from '../context/architecture-drawer-context';
import { useArchitectureMode, type ArchitectureMode } from '../hooks/use-architecture-mode';
import { useLiveArchitecture } from '../hooks/use-live-architecture';
import { ENGINE_COPY, useArchitectureEngineContext } from '../context/architecture-engine-context';
import { useFlowPlayback } from '../hooks/use-flow-playback';
import { PANEL_SLIDE_MS } from '../hooks/use-inspector-focus';
import {
  defaultDemoFlowIdFor,
  demoFlow,
  demoStepDwellMs,
  frameForStep,
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
  const dwellMsForStep = useCallback(
    (index: number) => demoStepDwellMs(flow.steps[index]),
    [flow.steps],
  );
  const playback = useFlowPlayback({
    stepCount: flow.steps.length,
    dwellMsForStep,
  });

  const isDemo = mode === 'demo';

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

  // Switching engines starts both sources over. Beats recorded on the other engine
  // name that engine's nodes, so keeping them would leave the feed describing hops
  // the diagram is currently shading out.
  const clearLive = live.clear;
  const restart = playback.restart;
  useEffect(() => {
    clearLive();
    restart();
  }, [engine, clearLive, restart]);

  const demoFrame = useMemo(
    () => frameForStep(flow.steps, playback.index),
    [flow.steps, playback.index],
  );

  /** Diagram props, from whichever source is selected. */
  const diagram = isDemo
    ? {
        litNode: demoFrame.litNode,
        litIsResponse: demoFrame.litIsResponse,
        passNodes: demoFrame.passNodes,
        doneNodes: demoFrame.doneNodes,
        activeHops: demoFrame.activeHops,
        durations: demoFrame.durations as Readonly<Partial<Record<AwsNodeId, NodeDuration>>>,
      }
    : {
        litNode: live.litNode,
        litIsResponse: live.litIsResponse,
        passNodes: live.passNodes,
        doneNodes: live.doneNodes,
        activeHops: live.activeHops,
        durations: liveDurations(live.beats, live.currentBeat?.key),
      };

  const rows: readonly FeedRow[] = isDemo
    ? flow.steps.slice(0, playback.index + 1).map((step, index) => ({
        key: `${flow.id}-${index}`,
        service: step.service,
        operation: step.operation,
        detail: step.detail,
        durationLabel: step.durationMs === undefined ? '—' : `${step.durationMs} ms`,
        category: step.category,
        actor: step.actor,
        action: step.action,
        isCurrent: index === playback.index,
      }))
    : live.beats.map((beat) => ({
        key: beat.key,
        service: beat.service,
        operation: beat.operation,
        detail: beat.detail,
        durationLabel: beat.durationMs === undefined ? '—' : `${beat.durationMs} ms`,
        category: beat.category,
        actor: beat.actor,
        action: beat.action,
        isCurrent: beat.key === live.currentBeat?.key,
      }));

  const summary = isDemo
    ? DRAWER_COPY.demoNote
    : `${live.spanCount} span${live.spanCount === 1 ? '' : 's'} · ${live.modelCallCount} model call${live.modelCallCount === 1 ? '' : 's'}`;

  // The step readout the reopen bar shows. Computed here rather than interpolated
  // once, so it stays truthful while the drawer is down — the mockup baked it in
  // at render and it never updated again.
  const stepReadout = isDemo
    ? `Step ${Math.max(playback.index, 0) + 1} of ${flow.steps.length}`
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
            {!isDemo && <ServingChip serving={servingEngine} isDowngraded={isDowngraded} />}

            <div
              style={{
                marginLeft: 'auto',
                display: 'flex',
                gap: 6,
                alignItems: 'center',
              }}
            >
              {/* Step controls belong to demo mode only: live traffic cannot be
                  rewound, and a disabled ◀ beside real events invites the
                  question of why it does nothing. */}
              {isDemo && (
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
              heading={isDemo ? DRAWER_COPY.demoHeading : DRAWER_COPY.liveHeading}
              emptyMessage={isDemo ? undefined : DRAWER_COPY.liveEmpty}
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
