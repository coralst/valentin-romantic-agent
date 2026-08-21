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

/**
 * Copy for the Inspector chrome. Kept together so the panel can be retuned
 * for a different talk framing with a one-line edit (see also
 * `inspector-architecture.ts` for the node labels).
 */
const COPY = {
  toggleLabel: 'Open architecture inspector',
  closeLabel: 'Close architecture inspector',
  title: 'Live Architecture',
  subtitle: 'Real events, as they happen',
  feedHeading: 'Event feed',
  emptyFeed: 'Waiting for events — send a message to see the system light up.',
  clearLabel: 'Clear feed',
} as const;

const PANEL_WIDTH = 520;

/** Tiers in render order, with the row heading shown beside each. */
const TIER_ORDER: readonly { tier: ArchitectureTier; heading: string }[] = [
  { tier: 'edge', heading: 'Client' },
  { tier: 'transport', heading: 'Transport' },
  { tier: 'reasoning', heading: 'Reasoning' },
  { tier: 'state', heading: 'State' },
];

const toggleButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  width: 36,
  height: 36,
  border: `1px solid ${colors.border}`,
  borderRadius: borderRadius.sm,
  backgroundColor: colors.surface,
  cursor: 'pointer',
  fontSize: typography.sizes.md,
  color: colors.softBurgundy,
  transition: `background-color ${animation.durations.fast}ms ${animation.easing.easeInOut}`,
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 200,
  display: 'flex',
  justifyContent: 'flex-end',
};

const backdropStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(45, 32, 36, 0.45)',
};

const panelStyle: React.CSSProperties = {
  position: 'relative',
  width: PANEL_WIDTH,
  maxWidth: '100vw',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: colors.cream,
  borderLeft: `1px solid ${colors.border}`,
  boxShadow: shadows.cardHover,
  zIndex: 201,
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
  minWidth: 120,
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
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const nodeCaptionStyle: React.CSSProperties = {
  fontSize: typography.sizes.xs,
  color: colors.textSecondary,
  marginTop: 1,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
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
  onOpen: () => void;
  /** Whether the panel is currently open — reflected to assistive tech. */
  isOpen?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

/**
 * The icon that opens the Inspector. Exported separately so a host toolbar
 * (e.g. `DemoToolbar`) can mount it with a one-line insertion.
 */
export function InspectorToggle({ onOpen, isOpen = false, ref }: InspectorToggleProps) {
  return (
    <button
      ref={ref}
      type="button"
      style={toggleButtonStyle}
      onClick={onOpen}
      aria-label={COPY.toggleLabel}
      aria-expanded={isOpen}
      title={COPY.toggleLabel}
      data-testid="inspector-toggle"
    >
      <span aria-hidden="true">&#9673;</span>
    </button>
  );
}

/** Props for a single architecture node box. */
interface ArchitectureNodeBoxProps {
  node: ArchitectureNode;
  isActive: boolean;
}

function ArchitectureNodeBox({ node, isActive }: ArchitectureNodeBoxProps) {
  return (
    <div
      style={isActive ? nodeActiveStyle : nodeBaseStyle}
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
 * The slide-over panel body. Rendered only while open, mirroring the
 * `SessionSidebar` mobile-overlay idiom (fixed overlay + backdrop + panel).
 */
export function ValentinInspectorPanel({ onClose }: ValentinInspectorPanelProps) {
  const { events, activeNodes, clear } = useInspectorEvents();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Escape closes the panel.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Move focus into the panel so keyboard users land somewhere sensible.
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  const transition = useMemo(
    () =>
      prefersReducedMotion()
        ? undefined
        : `transform ${animation.durations.normal}ms ${animation.easing.easeOut}`,
    [],
  );

  return (
    <div style={overlayStyle} data-testid="inspector-overlay">
      <div style={backdropStyle} onClick={onClose} aria-hidden="true" />
      <aside
        style={{ ...panelStyle, transition }}
        role="dialog"
        aria-modal="true"
        aria-label={COPY.title}
        data-testid="inspector-panel"
      >
        <div style={headerStyle}>
          <div>
            <h2 style={titleStyle}>{COPY.title}</h2>
            <p style={subtitleStyle}>{COPY.subtitle}</p>
          </div>
          <button
            ref={closeButtonRef}
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
    </div>
  );
}

/**
 * The Valentin Inspector — a toggle plus the slide-over panel it opens.
 *
 * Self-contained: mount this anywhere (it is designed to sit inside a host
 * toolbar) and it owns its own open/closed state and focus restoration.
 */
export function ValentinInspector() {
  const [isOpen, setIsOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    // Return focus to the toggle that opened the panel.
    toggleRef.current?.focus();
  }, []);

  return (
    <>
      <InspectorToggle ref={toggleRef} isOpen={isOpen} onOpen={() => setIsOpen(true)} />
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
