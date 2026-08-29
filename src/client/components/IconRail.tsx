import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  colors,
  radii,
  layout,
  typography,
  insets,
  spacing,
  animation,
} from '../design-system/tokens';
import { DemoToolbar } from './DemoToolbar';
import { UserChip } from './UserChip';
import { useOptionalAuthContext } from '../context/auth-context';
import { useIntegrations } from '../context/integrations-context';
import {
  ENGINE_COPY,
  ENGINE_OPTIONS,
  useArchitectureEngineContext,
} from '../context/architecture-engine-context';

/** Which of the rail's view buttons is currently the active surface. */
export type RailView = 'chat' | 'profile';

interface IconRailProps {
  /** 'column' is the 76px desktop rail; 'row' is the 56px mobile top strip. */
  orientation: 'column' | 'row';
  /**
   * The surface currently on screen, so the ◆ can report `aria-pressed`. On
   * desktop both surfaces are visible at once, so pass `null` and it claims
   * nothing.
   */
  activeView: RailView | null;
  onViewChange?: (view: RailView) => void;
  /**
   * What the crest does: land on the conversation, from any surface.
   *
   * Optional only so the rail can still be rendered on its own in unit tests; it
   * must be passed by *both* the mobile strip and the desktop rail — passing it
   * to one of the two is precisely how the ◆ came to be inert on desktop.
   */
  onGoHome?: () => void;
  /**
   * What the ☰ does. On mobile it raises the history overlay; on desktop, where
   * the list is a permanent column, it collapses and restores that column.
   */
  onOpenSessions: () => void;
  /**
   * Whether the conversation list is currently showing, when the caller treats
   * the ☰ as a two-way toggle.
   *
   * Left `undefined` by the mobile strip, where the ☰ only ever opens the
   * overlay — and where the accessible name is therefore still the one-way
   * "Open session history" that `IconRail.test.tsx` and the e2e specs query.
   */
  isSessionsOpen?: boolean;
  /**
   * Raises the integrations panel. Optional so the rail still renders standalone
   * in unit tests; the button is always drawn, because a rail whose composition
   * depends on its props is a rail that shifts under the cursor between surfaces.
   */
  onOpenIntegrations?: () => void;
  /** Whether that panel is the surface on screen, so the button can light up. */
  isIntegrationsOpen?: boolean;
}

const INACTIVE_ICON_COLOR = 'rgba(255, 253, 251, 0.6)';
const ACTIVE_ICON_BACKGROUND = 'rgba(255, 253, 251, 0.16)';

function getRailStyle(orientation: 'column' | 'row'): React.CSSProperties {
  const isRow = orientation === 'row';
  return {
    backgroundColor: colors.claret,
    display: 'flex',
    flexDirection: isRow ? 'row' : 'column',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
    minHeight: 0,
    ...(isRow
      ? { padding: `0 ${insets.tight}px` }
      : { padding: `${spacing.sm}px 0 ${insets.snug}px`, overflowY: 'auto' }),
  };
}

/**
 * The crest is a button, not decoration: people click a logo expecting to be
 * taken home, and this one is the only mark in the rail.
 *
 * Visually unchanged from the div it replaced — `border: none`, `padding: 0` and
 * an explicit background are what stop the user agent's button styling from
 * squaring the circle and greying the art.
 */
function getCrestStyle(orientation: 'column' | 'row'): React.CSSProperties {
  const size = orientation === 'row' ? 34 : layout.crestSize;
  return {
    width: size,
    height: size,
    borderRadius: radii.pill,
    overflow: 'hidden',
    backgroundColor: colors.porcelain,
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    // A default focus ring is drawn on the *border box*, which on a circular
    // control reads as a square around the crest. Offset it and it follows the
    // pill instead; gold because that is the app's other accent and it survives
    // against both the claret rail and the porcelain disc.
    outlineOffset: 3,
    outlineColor: colors.gold,
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.22)',
    // The crest sits apart from the button cluster on the vertical rail; on the
    // horizontal strip the shared 8px gap is already enough.
    marginBottom: orientation === 'column' ? 12 : 0,
  };
}

const crestImageStyle: React.CSSProperties = {
  width: '120%',
  height: '120%',
  objectFit: 'cover',
};

function getIconButtonStyle(isActive: boolean): React.CSSProperties {
  return {
    width: layout.iconButtonSize,
    height: layout.iconButtonSize,
    flexShrink: 0,
    borderRadius: radii.icon,
    border: 'none',
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
    fontFamily: typography.bodyFontFamily,
    fontSize: typography.px.control,
    lineHeight: 1,
    backgroundColor: isActive ? ACTIVE_ICON_BACKGROUND : 'transparent',
    color: isActive ? '#FFFFFF' : INACTIVE_ICON_COLOR,
    transition: `background-color ${animation.durations.fast}ms ${animation.easing.easeInOut}`,
  };
}

const spacerStyle: React.CSSProperties = { flex: 1 };

/**
 * The band labels — "talk", "know", "act" — above each group of rail buttons.
 *
 * The rail's glyphs are a diamond, a heart, a hamburger and now a fan-out mark:
 * legible once you know the app, opaque on first sight, and this is the first
 * thing a visitor looks at. Three words say what the agent is made of — it talks,
 * it knows her, it acts — and they cost four lines of chrome to say it.
 *
 * `aria-hidden` because they are a visual grouping only: every button already
 * carries its own accessible name, and a screen reader announcing "talk" before
 * "Conversation" would be reading the furniture. The column is the only
 * orientation that gets them; the 56px mobile strip has no vertical room.
 */
const bandLabelStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.micro,
  fontWeight: typography.weights.semibold,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'rgba(255, 253, 251, 0.42)',
  marginTop: 6,
  flexShrink: 0,
};

/**
 * The count of connected services, sat on the integrations button.
 *
 * Gold rather than claret-on-claret: the rail is claret, so the badge needs the
 * app's other accent to read at 16px. It carries no accessible name of its own —
 * the button's `aria-label` already spells the count out in words.
 */
const badgeStyle: React.CSSProperties = {
  position: 'absolute',
  top: 2,
  right: 2,
  minWidth: 16,
  height: 16,
  padding: '0 4px',
  borderRadius: radii.pill,
  backgroundColor: colors.gold,
  color: colors.onGold,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.micro,
  fontWeight: typography.weights.semibold,
  display: 'grid',
  placeItems: 'center',
  lineHeight: 1,
};

/** The button the badge is pinned to has to be the positioning context. */
const badgeHostStyle: React.CSSProperties = { position: 'relative' };

/**
 * The fan-out mark: one node branching to three.
 *
 * Drawn rather than borrowed from a glyph, because the rail's other marks are
 * single characters and no character in the fonts we ship says "one agent, many
 * hands". `currentColor` keeps it in step with the button's active/inactive state.
 */
function FanOutMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="5" cy="12" r="2.4" />
      <circle cx="19" cy="5" r="2.2" />
      <circle cx="19" cy="12" r="2.2" />
      <circle cx="19" cy="19" r="2.2" />
      <path d="M7.4 12h9.4M7.2 11.2 16.9 5.6M7.2 12.8l9.7 5.6" />
    </svg>
  );
}

/**
 * The engine switch's frame.
 *
 * It sits at the foot of the rail, immediately above the ⚙, because that is the
 * pair a presenter reaches for mid-sentence: settings and "now show me the other
 * architecture". It used to live in the drawer's header, which put it off screen
 * whenever the drawer was closed — and the whole point of the comparison is being
 * able to switch engines while talking about something else.
 *
 * Stacked on the desktop rail, side by side on the mobile strip: the rail's own
 * axis, so it reads as part of the rail rather than as a widget dropped into it.
 */
function getEngineSwitchStyle(orientation: 'column' | 'row'): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: orientation === 'column' ? 'column' : 'row',
    gap: 2,
    padding: 2,
    flexShrink: 0,
    borderRadius: radii.icon,
    // A shade darker than the active option, so the frame reads as the trough the
    // selection sits in rather than as a third, half-lit choice.
    backgroundColor: 'rgba(255, 253, 251, 0.08)',
    marginBottom: orientation === 'column' ? spacing.xs : 0,
  };
}

/**
 * One engine option.
 *
 * Deliberately the rail's own active idiom — translucent white behind white text —
 * and not the drawer's porcelain pills. The rail is claret; a porcelain segmented
 * control here would look like a piece of the drawer had come loose.
 *
 * Uppercase at 8.5px is what makes two words fit a 76px column. Both labels are
 * nine characters, which is a small piece of luck worth keeping: the two options
 * are the same width, so the selection moves without the frame resizing.
 */
function getEngineOptionStyle(isActive: boolean): React.CSSProperties {
  return {
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    padding: '4px 3px',
    fontFamily: typography.bodyFontFamily,
    fontSize: 8.5,
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    backgroundColor: isActive ? ACTIVE_ICON_BACKGROUND : 'transparent',
    color: isActive ? '#FFFFFF' : INACTIVE_ICON_COLOR,
    transition: `background-color ${animation.durations.fast}ms ${animation.easing.easeInOut}`,
  };
}

const popoverWrapperStyle: React.CSSProperties = {
  position: 'relative',
  flexShrink: 0,
};

/**
 * The demo popover. It is anchored to the ⚙ button rather than laid out inline
 * because the rail is only 76px wide and the toolbar's controls are ~360px.
 *
 * It is `position: fixed` and portalled to the body because the app window
 * clips its children (`overflow: hidden`, to keep the 34px radius crisp) — an
 * absolutely positioned popover inside the rail is sliced off at the window
 * edge. Coordinates come from the gear's own bounding box.
 */
function getPopoverStyle(orientation: 'column' | 'row', anchor: DOMRect): React.CSSProperties {
  return {
    position: 'fixed',
    zIndex: 200,
    backgroundColor: colors.porcelain,
    borderRadius: radii.panel,
    padding: insets.snug,
    // The inset hairline is the first layer: on porcelain over porcelain the drop
    // shadows alone leave the menu's own edge undefined.
    boxShadow:
      'inset 0 0 0 1px rgba(229, 217, 210, 0.9), 0 4px 12px rgba(42, 34, 38, 0.08), 0 24px 56px rgba(42, 34, 38, 0.18)',
    ...(orientation === 'column'
      ? {
          // Beside the gear, bottom-aligned to it — but never so tall that it
          // runs off the top of the viewport. The gear sits at the foot of the
          // rail, so the menu grows upwards; on a short window that is the only
          // edge it can escape through.
          left: anchor.right + 10,
          bottom: Math.min(
            window.innerHeight - anchor.bottom,
            Math.max(insets.tight, window.innerHeight - POPOVER_MAX_HEIGHT),
          ),
          maxHeight: POPOVER_MAX_HEIGHT,
        }
      : // Below the strip, right-aligned to the gear.
        { top: anchor.bottom + 10, right: window.innerWidth - anchor.right }),
  };
}

/**
 * Roughly what the menu needs: two labelled groups, four controls and a status
 * line. Used only to keep the bottom-anchored menu from growing off the top of a
 * short viewport, so an approximation is the right kind of value here.
 */
const POPOVER_MAX_HEIGHT = 320;

/** One column, so every control is the same width. */
const menuStyle: React.CSSProperties = {
  width: layout.menuWidth,
  display: 'flex',
  flexDirection: 'column',
  gap: insets.tight,
  minWidth: 0,
};

const menuGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minWidth: 0,
};

/** "Who you are" / "what the demo can do" — the same eyebrow the cards use. */
const menuGroupLabelStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.eyebrow,
  fontWeight: typography.weights.semibold,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: colors.inkFaint,
};

/** The gradient hairline, so the rule fades out rather than butting the padding. */
const menuDividerStyle: React.CSSProperties = {
  height: 1,
  border: 'none',
  margin: 0,
  background: colors.hairlineGradient,
};

/**
 * Column 1 of the window: Valentin's crest, the view switches, and the demo
 * controls behind a gear.
 *
 * On mobile this same component renders as a horizontal claret strip. It is the
 * only chrome above the content there, so it also carries the brand and the
 * demo controls that used to live in the deleted app header.
 */
export function IconRail({
  orientation,
  activeView,
  onViewChange,
  onGoHome,
  onOpenSessions,
  isSessionsOpen,
  onOpenIntegrations,
  isIntegrationsOpen = false,
}: IconRailProps) {
  /*
   * The same condition `UserChip` guards itself with, asked again here.
   *
   * Not a duplication to remove: the "Signed in as" heading and the divider
   * belong to the *menu*, not to the chip, so a chip that renders nothing (no
   * AuthProvider, as in the component tests) must not leave them stranded above
   * an empty group. The chip keeps its own guard because it is also the thing
   * that knows what "signed in" means.
   */
  const auth = useOptionalAuthContext();
  const hasIdentity = auth?.status === 'signed-in';

  const [isDemoOpen, setDemoOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const gearRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const measureAnchor = useCallback(() => {
    const rect = gearRef.current?.getBoundingClientRect();
    if (rect) setAnchor(rect);
  }, []);

  // Measure before paint so the popover never renders at a stale position.
  useLayoutEffect(() => {
    if (isDemoOpen) measureAnchor();
  }, [isDemoOpen, measureAnchor]);

  // Keep the popover glued to the gear if the viewport changes under it.
  useEffect(() => {
    if (!isDemoOpen) return;
    window.addEventListener('resize', measureAnchor);
    return () => window.removeEventListener('resize', measureAnchor);
  }, [isDemoOpen, measureAnchor]);

  // Dismiss the popover on outside click or Escape, the way a menu should.
  useEffect(() => {
    if (!isDemoOpen) return;

    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      // The popover is portalled out of the rail, so it is not a DOM descendant
      // of the wrapper — check it separately or clicking it would dismiss it.
      const insideGear = wrapperRef.current?.contains(target) ?? false;
      const insidePopover = popoverRef.current?.contains(target) ?? false;
      if (!insideGear && !insidePopover) setDemoOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDemoOpen(false);
    };

    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isDemoOpen]);

  /*
   * `aria-pressed` is only meaningful where exactly one surface is on screen.
   *
   * That is the mobile strip, where `activeView` names the visible panel. On
   * desktop chat and brief share the window, `activeView` is `null`, and the ◆
   * claims nothing — which is what `IconRail.test.tsx` asserts.
   */
  const { engine, setEngine } = useArchitectureEngineContext();
  const isChatActive = activeView === 'chat';
  const hasSurfaceState = activeView !== null;

  const { connectedCount } = useIntegrations();
  const isColumn = orientation === 'column';
  /** A band label, or nothing at all on the mobile strip. */
  const band = (label: string) =>
    isColumn ? (
      <span style={bandLabelStyle} aria-hidden="true">
        {label}
      </span>
    ) : null;

  return (
    <nav
      style={getRailStyle(orientation)}
      data-testid="icon-rail"
      data-orientation={orientation}
      aria-label="Valentin"
    >
      {/* The name is "Valentin home" rather than "Back to the conversation"
          because the dossier's ← already owns the latter, and two controls
          answering to one name in the same view is exactly the ambiguity a
          screen reader cannot resolve. */}
      <button
        type="button"
        style={getCrestStyle(orientation)}
        onClick={onGoHome}
        aria-label="Valentin home"
        data-testid="rail-home-button"
      >
        {/* The alt text is queried by the onboarding e2e spec, so it stays on the
            image even though the button now carries the accessible name. */}
        <img src="/logo.png" alt="Valentin logo" style={crestImageStyle} />
      </button>

      {band('talk')}

      <button
        type="button"
        style={getIconButtonStyle(isChatActive)}
        aria-label="Conversation"
        aria-pressed={hasSurfaceState ? isChatActive : undefined}
        onClick={() => onViewChange?.('chat')}
        data-testid="rail-chat-button"
      >
        &#9670;
      </button>

      {/*
        There is deliberately no ♥ here, and so deliberately no "know" band for
        one to sit under.
        Her profile is reached by clicking *her* — the portrait at the top of the
        brief (`brief/WhoHeader.tsx`), and the brief's "Full profile →" link.
        A heart in the rail was a second, abstract door to the same place, and the
        one thing on screen that a heart could plausibly mean in this app is the
        person, not a navigation target.
      */}

      {/*
        A two-way toggle wherever the caller treats it as one, and it says so.
        "Open session history" would be a lie half the time on desktop, where the
        list is a column that this button hides and restores; but it stays the
        name on mobile, where the ☰ only opens an overlay and where the e2e specs
        and `IconRail.test.tsx` query that exact string.

        It sits under "talk" rather than in its old slot below the ♥: the bands
        group by what the button is for, and the conversation list is part of
        talking to him, not part of knowing her.
      */}
      <button
        type="button"
        style={getIconButtonStyle(isSessionsOpen === false)}
        aria-label={
          isSessionsOpen === undefined
            ? 'Open session history'
            : isSessionsOpen
              ? 'Hide the conversation list'
              : 'Show the conversation list'
        }
        aria-expanded={isSessionsOpen}
        onClick={onOpenSessions}
        data-testid="sidebar-menu-button"
      >
        &#9776;
      </button>

      {band('act')}

      {/* The badge is the advertisement: a rail icon with "3" on it is the only
          thing on the chat surface that says the agent has hands at all. */}
      <button
        type="button"
        style={{ ...getIconButtonStyle(isIntegrationsOpen), ...badgeHostStyle }}
        aria-label={
          connectedCount > 0
            ? `Integrations, ${connectedCount} connected`
            : 'Integrations'
        }
        aria-expanded={isIntegrationsOpen}
        onClick={onOpenIntegrations}
        data-testid="rail-integrations-button"
      >
        <FanOutMark />
        {connectedCount > 0 && (
          <span style={badgeStyle} aria-hidden="true" data-testid="rail-integrations-badge">
            {connectedCount}
          </span>
        )}
      </button>

      <div style={spacerStyle} />

      {/* `role="group"` rather than a radiogroup: two buttons that each report
          `aria-pressed` is the same pattern the drawer's data-source switch uses,
          and it keeps both options reachable with one Tab each. */}
      <div
        role="group"
        aria-label={ENGINE_COPY.group}
        style={getEngineSwitchStyle(orientation)}
        data-testid="rail-engine-switch"
      >
        {ENGINE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            style={getEngineOptionStyle(engine === option.value)}
            aria-pressed={engine === option.value}
            onClick={() => setEngine(option.value)}
            data-testid={`rail-engine-${option.value}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div style={popoverWrapperStyle} ref={wrapperRef}>
        <button
          ref={gearRef}
          type="button"
          style={getIconButtonStyle(isDemoOpen)}
          aria-label="Demo controls"
          aria-expanded={isDemoOpen}
          onClick={() => setDemoOpen((open) => !open)}
          data-testid="rail-demo-button"
        >
          &#9881;
        </button>
        {isDemoOpen &&
          anchor &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              ref={popoverRef}
              style={getPopoverStyle(orientation, anchor)}
              data-testid="rail-demo-popover"
            >
              {/* Who you are sits above the demo controls: the rail has no
                  header to hang it off, and "account" and "demo" belong to the
                  same cluster from the audience's point of view. Two labelled
                  groups rather than one flat stack, because "sign out" and
                  "reset the rehearsal" are very different mistakes to make. */}
              <div style={menuStyle}>
                {hasIdentity && (
                  <>
                    <div style={menuGroupStyle}>
                      <span style={menuGroupLabelStyle}>Signed in as</span>
                      <UserChip />
                    </div>
                    <hr style={menuDividerStyle} />
                  </>
                )}
                <div style={menuGroupStyle}>
                  <span style={menuGroupLabelStyle}>Demo controls</span>
                  <DemoToolbar />
                </div>
              </div>
            </div>,
            document.body,
          )}
      </div>
    </nav>
  );
}
