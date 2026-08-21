import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  colors,
  spacing,
  typography,
  shadows,
  borderRadius,
  animation,
} from '../design-system/tokens';
import { prefersReducedMotion } from '../utils/motion-preference';
import {
  ARCHITECTURE_NODES,
  type ArchitectureNode,
  type ArchitectureNodeId,
  type ArchitectureTier,
} from '../utils/inspector-architecture';
import {
  useInspectorEvents,
  type InspectorEvent,
} from '../hooks/use-inspector-events';
import {
  useIsWideEnoughToDock,
  useReservedEdgeSpace,
} from '../hooks/use-docked-panel';

/**
 * Copy for the Inspector chrome. Kept together so the panel can be retuned
 * for a different talk framing with a one-line edit (see also
 * `inspector-architecture.ts` for the node labels).
 */
const COPY = {
  toggleText: 'Inspector',
  toggleLabel: 'Open architecture inspector',
  toggleCloseLabel: 'Close architecture inspector',
  // Distinct from the toggle's label so the two controls are unambiguous to
  // assistive tech and to tests querying by accessible name.
  closeLabel: 'Dismiss architecture inspector',
  title: 'Live Architecture',
  subtitle: 'Real events, as they happen',
  feedHeading: 'Event feed',
  emptyFeed: 'Waiting for events — send a message to see the system light up.',
  clearLabel: 'Clear feed',
} as const;

const PANEL_WIDTH = 600;

/** Tiers in render order, with the row heading shown beside each. */
const TIER_ORDER: readonly { tier: ArchitectureTier; heading: string }[] = [
  { tier: 'edge', heading: 'Client' },
  { tier: 'transport', heading: 'Transport' },
  { tier: 'reasoning', heading: 'Reasoning' },
  { tier: 'state', heading: 'State' },
];

/**
 * Mirrors `DemoToolbar`'s `secondaryButtonStyle` so the toggle reads as a peer
 * of the Load / Reset controls it sits beside.
 */
const toggleButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: `6px ${spacing.sm}px`,
  borderRadius: borderRadius.full,
  backgroundColor: colors.surface,
  color: colors.softBurgundy,
  border: `1px solid ${colors.border}`,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.semibold,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: `opacity ${animation.durations.fast}ms ${animation.easing.easeInOut}`,
};

const toggleActiveStyle: React.CSSProperties = {
  ...toggleButtonStyle,
  backgroundColor: colors.blush,
  border: `1px solid ${colors.softBurgundy}`,
};

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: PANEL_WIDTH,
  maxWidth: '100vw',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: colors.cream,
  borderLeft: `1px solid ${colors.border}`,
  boxShadow: shadows.cardHover,
  zIndex: 200,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: spacing.sm,
  padding: `${spacing.sm}px ${spacing.md}px`,
  borderBottom: `1px solid ${colors.border}`,
  background: colors.headerGradient,
};

const titleStyle: React.CSSProperties = {
  fontFamily: typography.headingFontFamily,
  fontSize: typography.sizes.xl,
  fontWeight: typography.weights.bold,
  color: colors.deepPlum,
  letterSpacing: '-0.01em',
};

const subtitleStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.sizes.sm,
  color: colors.textSecondary,
  marginTop: 2,
};

const closeButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  flexShrink: 0,
  border: `1px solid ${colors.border}`,
  borderRadius: borderRadius.sm,
  backgroundColor: colors.surface,
  cursor: 'pointer',
  fontSize: typography.sizes.md,
  color: colors.text,
};

const diagramStyle: React.CSSProperties = {
  padding: `${spacing.sm}px ${spacing.md}px`,
  display: 'flex',
  flexDirection: 'column',
  gap: spacing.xs,
  borderBottom: `1px solid ${colors.border}`,
};

const tierRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing.xs,
};

const tierHeadingStyle: React.CSSProperties = {
  width: 76,
  flexShrink: 0,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.semibold,
  color: colors.warmTaupe,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const tierNodesStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  gap: spacing.xs,
  flexWrap: 'wrap',
};

const connectorStyle: React.CSSProperties = {
  marginLeft: 76 + spacing.xs,
  width: 2,
  height: spacing.xs,
  backgroundColor: colors.border,
};

const nodeBaseStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: `${spacing.xs + 2}px ${spacing.xs + 2}px`,
  border: `2px solid ${colors.border}`,
  borderRadius: borderRadius.md,
  backgroundColor: colors.surface,
  fontFamily: typography.bodyFontFamily,
};

const nodeActiveStyle: React.CSSProperties = {
  ...nodeBaseStyle,
  border: `2px solid ${colors.softBurgundy}`,
  backgroundColor: colors.blush,
  boxShadow: shadows.cardHover,
};

const nodeLabelStyle: React.CSSProperties = {
  fontSize: typography.sizes.base,
  fontWeight: typography.weights.semibold,
  color: colors.text,
  lineHeight: typography.lineHeights.tight,
  // Component names must never truncate — they are the point of the diagram.
  overflowWrap: 'break-word',
};

const nodeCaptionStyle: React.CSSProperties = {
  fontSize: typography.sizes.xs,
  color: colors.textSecondary,
  marginTop: 2,
  lineHeight: typography.lineHeights.tight,
  overflowWrap: 'break-word',
};

const feedSectionStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
};

const feedHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: spacing.xs,
  padding: `${spacing.xs}px ${spacing.md}px`,
};

const feedHeadingStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.semibold,
  color: colors.textSecondary,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const clearButtonStyle: React.CSSProperties = {
  padding: `4px ${spacing.xs}px`,
  border: `1px solid ${colors.border}`,
  borderRadius: borderRadius.sm,
  backgroundColor: colors.surface,
  cursor: 'pointer',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.medium,
  color: colors.textSecondary,
};

const feedListStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: `0 ${spacing.md}px ${spacing.sm}px`,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  listStyle: 'none',
};

const feedItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: spacing.xs,
  padding: `${spacing.xs}px ${spacing.xs + 2}px`,
  border: `1px solid ${colors.borderSubtle}`,
  borderRadius: borderRadius.sm,
  backgroundColor: colors.surface,
  fontFamily: typography.bodyFontFamily,
};

const feedTimeStyle: React.CSSProperties = {
  flexShrink: 0,
  fontSize: typography.sizes.xs,
  color: colors.warmTaupe,
  fontVariantNumeric: 'tabular-nums',
};

const feedLabelStyle: React.CSSProperties = {
  flexShrink: 0,
  fontSize: typography.sizes.base,
  fontWeight: typography.weights.semibold,
  color: colors.deepPlum,
};

const feedDetailStyle: React.CSSProperties = {
  fontSize: typography.sizes.sm,
  color: colors.textSecondary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const emptyFeedStyle: React.CSSProperties = {
  padding: `${spacing.md}px ${spacing.md}px`,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.sizes.base,
  color: colors.textSecondary,
  lineHeight: typography.lineHeights.normal,
};

/** Props for the Inspector toggle button. */
export interface InspectorToggleProps {
  onToggle: () => void;
  /** Whether the panel is currently open — reflected to assistive tech. */
  isOpen?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

/**
 * The button that opens and closes the Inspector. Exported separately so a
 * host toolbar can drive the open state itself if it prefers.
 */
export function InspectorToggle({ onToggle, isOpen = false, ref }: InspectorToggleProps) {
  const label = isOpen ? COPY.toggleCloseLabel : COPY.toggleLabel;
  return (
    <button
      ref={ref}
      type="button"
      style={isOpen ? toggleActiveStyle : toggleButtonStyle}
      onClick={onToggle}
      aria-label={label}
      aria-expanded={isOpen}
      title={label}
      data-testid="inspector-toggle"
    >
      <span aria-hidden="true">&#9673;</span>
      <span>{COPY.toggleText}</span>
    </button>
  );
}

/** Props for a single architecture node box. */
interface ArchitectureNodeBoxProps {
  node: ArchitectureNode;
  isActive: boolean;
  /** Transition applied as the highlight settles; omitted for reduced motion. */
  transition?: string;
}

function ArchitectureNodeBox({ node, isActive, transition }: ArchitectureNodeBoxProps) {
  return (
    <div
      style={{ ...(isActive ? nodeActiveStyle : nodeBaseStyle), transition }}
      data-testid={`inspector-node-${node.id}`}
      data-active={isActive ? 'true' : 'false'}
    >
      <div style={nodeLabelStyle}>{node.label}</div>
      <div style={nodeCaptionStyle}>{node.caption}</div>
    </div>
  );
}

/** Props for the architecture diagram. */
interface ArchitectureDiagramProps {
  activeNodes: ReadonlySet<ArchitectureNodeId>;
}

function ArchitectureDiagram({ activeNodes }: ArchitectureDiagramProps) {
  const transition = useMemo(
    () =>
      prefersReducedMotion()
        ? undefined
        : `background-color ${animation.durations.slow}ms ${animation.easing.easeOut}, border-color ${animation.durations.slow}ms ${animation.easing.easeOut}, box-shadow ${animation.durations.slow}ms ${animation.easing.easeOut}`,
    [],
  );


  return (
    <div style={diagramStyle} data-testid="inspector-diagram">
      {TIER_ORDER.map(({ tier, heading }, index) => (
        <div key={tier}>
          {index > 0 && <div style={connectorStyle} aria-hidden="true" />}
          <div style={tierRowStyle}>
            <span style={tierHeadingStyle}>{heading}</span>
            <div style={tierNodesStyle}>
              {ARCHITECTURE_NODES.filter((node) => node.tier === tier).map((node) => (
                <ArchitectureNodeBox
                  key={node.id}
                  node={node}
                  isActive={activeNodes.has(node.id)}
                  transition={transition}
                />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Props for a single feed row. */
interface EventFeedItemProps {
  event: InspectorEvent;
}

function EventFeedItem({ event }: EventFeedItemProps) {
  return (
    <li style={feedItemStyle} data-testid="inspector-feed-item" data-event-type={event.type}>
      <span style={feedTimeStyle}>{formatTime(event.timestamp)}</span>
      <span style={feedLabelStyle}>{event.label}</span>
      {event.detail && <span style={feedDetailStyle}>{event.detail}</span>}
    </li>
  );
}

/** Props for the event feed. */
interface EventFeedProps {
  events: readonly InspectorEvent[];
  onClear: () => void;
}

function EventFeed({ events, onClear }: EventFeedProps) {
  return (
    <section style={feedSectionStyle} aria-label={COPY.feedHeading}>
      <div style={feedHeaderStyle}>
        <h3 style={feedHeadingStyle}>{COPY.feedHeading}</h3>
        <button type="button" style={clearButtonStyle} onClick={onClear}>
          {COPY.clearLabel}
        </button>
      </div>
      {events.length === 0 ? (
        <p style={emptyFeedStyle} data-testid="inspector-feed-empty">
          {COPY.emptyFeed}
        </p>
      ) : (
        <ul style={feedListStyle} data-testid="inspector-feed">
          {events.map((event) => (
            <EventFeedItem key={event.id} event={event} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Props for the Inspector panel. */
export interface ValentinInspectorPanelProps {
  onClose: () => void;
}

/**
 * The panel body — a **non-modal** complementary region.
 *
 * Deliberately not a modal dialog: Coral types into the chat composer while
 * watching nodes light up, so the panel must never trap focus, steal focus on
 * open, or block the rest of the app behind a backdrop. On viewports wide
 * enough it docks beside the app (reserving edge space); on narrower ones it
 * overlays, mirroring `SessionSidebar`'s responsive split.
 */
export function ValentinInspectorPanel({ onClose }: ValentinInspectorPanelProps) {
  const { events, activeNodes, clear } = useInspectorEvents();
  const isDocked = useIsWideEnoughToDock();

  // Dock by reserving edge space, so the chat stays visible and usable.
  useReservedEdgeSpace(PANEL_WIDTH, isDocked);

  // Escape closes the panel, from anywhere — including the composer.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const transition = useMemo(
    () =>
      prefersReducedMotion()
        ? undefined
        : `transform ${animation.durations.normal}ms ${animation.easing.easeOut}`,
    [],
  );

  return (
    <aside
      style={{ ...panelStyle, transition }}
      role="complementary"
      aria-label={COPY.title}
      data-testid="inspector-panel"
      data-docked={isDocked ? 'true' : 'false'}
    >
      <div style={headerStyle}>
        <div>
          <h2 style={titleStyle}>{COPY.title}</h2>
          <p style={subtitleStyle}>{COPY.subtitle}</p>
        </div>
        <button
          type="button"
          style={closeButtonStyle}
          onClick={onClose}
          aria-label={COPY.closeLabel}
          data-testid="inspector-close"
        >
          &times;
        </button>
      </div>
      <ArchitectureDiagram activeNodes={activeNodes} />
      <EventFeed events={events} onClear={clear} />
    </aside>
  );
}

/**
 * The Valentin Inspector — a toggle plus the non-modal panel it opens.
 *
 * Self-contained: mount this anywhere (it is designed to sit inside a host
 * toolbar) and it owns its own open/closed state.
 *
 * Focus is deliberately never moved when the panel *opens* — Coral will be
 * typing in the composer with the panel open, so stealing focus would break
 * the demo. Focus returns to the toggle only when the panel is explicitly
 * closed, so keyboard users are not stranded on a removed element.
 */
export function ValentinInspector() {
  const [isOpen, setIsOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    toggleRef.current?.focus();
  }, []);

  const handleToggle = useCallback(() => {
    if (isOpen) {
      handleClose();
      return;
    }
    setIsOpen(true);
  }, [isOpen, handleClose]);

  return (
    <>
      <InspectorToggle ref={toggleRef} isOpen={isOpen} onToggle={handleToggle} />
      {isOpen && <ValentinInspectorPanel onClose={handleClose} />}
    </>
  );
}

/** Format an ISO timestamp as a projector-legible wall clock time. */
function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString('en-GB', { hour12: false });
}
