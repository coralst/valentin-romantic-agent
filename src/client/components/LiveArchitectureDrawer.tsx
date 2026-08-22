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
import { barFeather, barGround, resolveBarTheme } from '../design-system/bar-themes';

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
 * The lens, and how far it travels.
 *
 * The magnifier is the drawer's handle, so it rides with the drawer: it rests in
 * the bar while the panel is down and travels up to sit beside the panel's title
 * while it is up, on the same easing and the same duration as the panel itself.
 * Two things fall out of that. The gesture reads as one object moving rather than
 * a bar with a symbol that flips underneath it, and the control that closes the
 * drawer is wherever the eye already is — next to the heading, not diagonally
 * across the frame in the corner.
 *
 * `LENS_OPEN_BOTTOM` lands it on the panel title's optical centre; the header
 * carries `HEADER_INSET` of left padding so the risen lens has that space to land
 * in rather than sitting on the words.
 */
const LENS_SIZE = 26;
const LENS_LEFT = 14;
/** Vertically centred in the bar. */
const LENS_RESTING_BOTTOM = (REOPEN_BAR_HEIGHT - LENS_SIZE) / 2;
const LENS_OPEN_BOTTOM = DRAWER_HEIGHT - 38;
const LENS_TRAVEL = LENS_OPEN_BOTTOM - LENS_RESTING_BOTTOM;
/** Left padding on the bar and the panel header: clears the lens in both places. */
const HEADER_INSET = LENS_LEFT + LENS_SIZE + 6;

/**
 * Height of the soft edge above the bar.
 *
 * A 1px hairline ruled the window in two right where the eye travels between the
 * chat and the diagram. Feathering the ground upward instead lets the bar sit
 * *under* whatever is above it, which is what it does structurally anyway.
 */
const BAR_FEATHER_HEIGHT = 16;

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
  // Soft top edge rather than a drawn rule: a translucent hairline over a wide,
  // low shadow, so the panel arrives out of the page instead of being taped onto it.
  borderTop: '1px solid rgba(229, 217, 210, 0.5)',
  boxShadow: '0 -20px 44px rgba(42, 34, 38, 0.14)',
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
 * nothing else about the bar changes between states. It rides up with the panel
 * (see `LENS_TRAVEL`), so the ⊕ becoming a ⊖ happens *while* it moves. Drawn
 * rather than a glyph so
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
  // Read once per mount: the candidate is chosen from the URL, and re-reading it
  // mid-session would repaint the bar under whoever is presenting.
  const theme = useMemo(() => resolveBarTheme(), []);
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              // Left inset leaves the landing space the lens rises into.
              padding: `14px 20px 10px ${HEADER_INSET}px`,
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

      {/* The bar's soft top edge: its own ground, fading upward into nothing.
          Below the panel, so an open drawer covers it rather than smudging it. */}
      <div
        aria-hidden="true"
        data-testid="architecture-bar-feather"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: REOPEN_BAR_HEIGHT,
          height: BAR_FEATHER_HEIGHT,
          background: barFeather(theme),
          pointerEvents: 'none',
          zIndex: 4,
        }}
      />

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
          // One ground, unconditionally. Nothing here reads `isOpen`: the bar
          // changing colour under the cursor as the panel moved was the flicker
          // this replaces, so open, closed and hovered all look the same and the
          // travelling ⊕/⊖ lens carries the state instead. Just short of opaque
          // over a blur, so the window reads through it and the bar looks like
          // frosted glass laid on the frame rather than a strip pasted over it.
          background: barGround(theme),
          backdropFilter: 'blur(14px) saturate(1.08)',
          WebkitBackdropFilter: 'blur(14px) saturate(1.08)',
          color: theme.copy,
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          // Left inset clears the resting lens, which is a sibling rather than a child.
          padding: `0 20px 0 ${HEADER_INSET}px`,
          fontSize: typography.px.label,
          cursor: 'pointer',
          zIndex: 6,
          border: 'none',
          textAlign: 'left',
          fontFamily: typography.bodyFontFamily,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: theme.pip,
            flexShrink: 0,
          }}
        />
        {DRAWER_COPY.title}
        <b style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{stepReadout}</b>
      </button>

      {/* The handle, riding the drawer. Deliberately not a second button: the bar
          behind it already carries the accessible name and the keyboard focus, and
          two buttons for one action is an ambiguous query for a screen reader user
          and for `getByRole` alike. This is the mouse target that follows the
          panel, hidden from assistive tech, and it sits above the panel so it stays
          clickable once it has landed on the header. */}
      <span
        aria-hidden="true"
        onClick={toggle}
        data-testid="architecture-bar-lens"
        style={{
          position: 'absolute',
          left: LENS_LEFT,
          bottom: LENS_RESTING_BOTTOM,
          width: LENS_SIZE,
          height: LENS_SIZE,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          // Dark ground below, cream panel header above: the lens re-inks itself
          // over the same interval it travels, so it never sits invisible.
          color: isOpen ? colors.ink : theme.copy,
          cursor: 'pointer',
          zIndex: 7,
          transform: isOpen ? `translateY(-${LENS_TRAVEL}px)` : 'translateY(0)',
          transition: `transform ${PANEL_SLIDE_MS}ms cubic-bezier(0.4, 0, 0.2, 1), color ${PANEL_SLIDE_MS}ms ease`,
        }}
      >
        <ZoomIcon sign={isOpen ? 'minus' : 'plus'} />
      </span>
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
