import { useCallback, useEffect, useMemo } from 'react';
import { AwsTopologyDiagram, type NodeDuration } from './AwsTopologyDiagram';
import { AwsFlowFeed, type FeedRow } from './AwsFlowFeed';
import { useArchitectureDrawer } from '../context/architecture-drawer-context';
import { useArchitectureMode, type ArchitectureMode } from '../hooks/use-architecture-mode';
import { useLiveArchitecture } from '../hooks/use-live-architecture';
import { useFlowPlayback } from '../hooks/use-flow-playback';
import { PANEL_SLIDE_MS } from '../hooks/use-inspector-focus';
import {
  DEFAULT_DEMO_FLOW_ID,
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

/** Total height the drawer occupies when open, bar included. */
export const DRAWER_HEIGHT = 424;
/**
 * The bar's height.
 *
 * It is not a *reopen* bar any more: it is on screen in both states, spanning the
 * full width of the window, and the panel rises above it rather than in place of
 * it. Two reasons, both from watching it on stage. The bar used to slide out and
 * hand its 34px strip to a cream panel, so the foot of the window changed colour
 * every time the drawer moved — a flicker exactly where the eye was already
 * heading. And with the bar gone while open, the only way back down was the small
 * `Hide ▾` in the panel's top-right corner, on the opposite side of the screen
 * from the control that opened it.
 */
export const REOPEN_BAR_HEIGHT = 34;
/** The panel's own height: whatever the drawer occupies, less the bar below it. */
export const DRAWER_PANEL_HEIGHT = DRAWER_HEIGHT - REOPEN_BAR_HEIGHT;

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
 * ancestor, and `AppWindow` renders it into a full-width strip pinned to the foot
 * of the window frame. That is why there is no left inset constant: the strip's
 * own position supplies it, so a change to the window's column template cannot
 * leave a hardcoded number behind.
 *
 * Window-level rather than per-column, because the bar has to be one unbroken
 * line across the whole bottom edge. Anchored inside the chat/brief tracks it
 * started somewhere in the middle of the frame, stopping short of the icon rail
 * and the conversation list, and read as a panel that had lost its left end. The
 * window makes room for the whole strip (`bottomInset`), so nothing above it is
 * covered — the rail's ⚙ and the foot of the conversation list included.
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
  /**
   * The bar's name while the panel is up.
   *
   * Distinct from `hide` on purpose: the panel keeps its own `Hide ▾`, and two
   * buttons with one accessible name is an ambiguous query for a screen reader
   * user and for `getByRole` alike.
   */
  collapse: 'Collapse the architecture drawer',
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
} as const;

const drawerStyle: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  // Above the bar, not over it: the bar stays put in both states.
  bottom: REOPEN_BAR_HEIGHT,
  height: DRAWER_PANEL_HEIGHT,
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
 * The bar's state, as a zoom-in / zoom-out lens.
 *
 * A magnifier with a ⊕ in it reads as "there is more to look at here" in a way a
 * bare chevron does not, and the sign is the whole of the open/closed signal —
 * nothing else about the bar changes between states. Drawn rather than a glyph so
 * the stroke weight matches the label beside it at any size, and it matches the
 * magnifier on the sidebar's `ArchitectureToggle`, which opens the same drawer.
 */
function ZoomIcon({ sign }: { sign: 'plus' | 'minus' }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
      data-testid="architecture-bar-sign"
      data-sign={sign}
      style={{ flexShrink: 0 }}
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.6 15.6 4.4 4.4" />
      <path d="M7.5 10.5h6" />
      {sign === 'plus' && <path d="M10.5 7.5v6" />}
    </svg>
  );
}

function ModeSwitch({
  mode,
  onChange,
}: {
  mode: ArchitectureMode;
  onChange: (mode: ArchitectureMode) => void;
}) {
  const tab = (value: ArchitectureMode, label: string) => {
    const on = mode === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => onChange(value)}
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
        {label}
      </button>
    );
  };

  return (
    <div style={{ display: 'flex', gap: 4, marginLeft: 14 }} role="group" aria-label="Data source">
      {tab('live', DRAWER_COPY.liveMode)}
      {tab('demo', DRAWER_COPY.demoMode)}
    </div>
  );
}

export function LiveArchitectureDrawer() {
  const { isOpen, isMounted, toggle, close } = useArchitectureDrawer();
  const { mode, setMode } = useArchitectureMode();
  const live = useLiveArchitecture();

  const flow = demoFlow(DEFAULT_DEMO_FLOW_ID);
  const dwellMsForStep = useCallback(
    (index: number) => demoStepDwellMs(flow.steps[index]),
    [flow.steps],
  );
  const playback = useFlowPlayback({ stepCount: flow.steps.length, dwellMsForStep });

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 20px 10px' }}>
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

            <ModeSwitch mode={mode} onChange={setMode} />

            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
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
            <AwsTopologyDiagram {...diagram} />
            <AwsFlowFeed
              rows={rows}
              summary={summary}
              heading={isDemo ? DRAWER_COPY.demoHeading : DRAWER_COPY.liveHeading}
              emptyMessage={isDemo ? undefined : DRAWER_COPY.liveEmpty}
            />
          </div>
        </section>
      )}

      {/* The one fixture of the drawer: on screen in both states, the same colour
          in both states, and the control that opens and closes the panel. Also a
          reminder of which step it is holding. */}
      <button
        type="button"
        onClick={toggle}
        aria-label={isOpen ? DRAWER_COPY.collapse : DRAWER_COPY.reopen}
        aria-expanded={isOpen}
        data-testid="architecture-reopen-bar"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: REOPEN_BAR_HEIGHT,
          // One flat moss ground, unconditionally. Nothing here reads `isOpen`:
          // the bar changing colour under the cursor as the panel moved was the
          // flicker this replaces, so open, closed and hovered all look the same
          // and the ⊕/⊖ carries the state instead.
          background: colors.mossGradient,
          color: colors.onMoss,
          borderTop: `1px solid ${colors.onMossHairline}`,
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '0 20px',
          fontSize: typography.px.label,
          cursor: 'pointer',
          zIndex: 6,
          border: 'none',
          textAlign: 'left',
          fontFamily: typography.bodyFontFamily,
        }}
      >
        <ZoomIcon sign={isOpen ? 'minus' : 'plus'} />
        <span
          aria-hidden="true"
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: colors.jade,
            flexShrink: 0,
          }}
        />
        {DRAWER_COPY.title}
        <b style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{stepReadout}</b>
      </button>
    </>
  );
}

/** Latest measured duration per node, from the live beats that carried one. */
function liveDurations(
  beats: readonly { key: string; to: AwsNodeId; durationMs?: number; ok?: boolean }[],
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
