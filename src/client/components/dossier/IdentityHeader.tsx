import { colors, insets, layout, radii, typography } from '../../design-system/tokens';
import { PartnerAvatar } from '../PartnerAvatar';
import { CARD_HAIRLINE } from './board-tones';

interface IdentityHeaderProps {
  /** Her name, or null before it is known. */
  name: string | null;
  /** The line under it — birthday, age bucket — already joined by the caller. */
  subtitle: string | null;
  filled: number;
  total: number;
  /** Clears the dossier. Focus returns to the rail's ♥ — see `view-context`. */
  onBack: () => void;
  /** Drops "what's missing" into the composer. */
  onAskAll: () => void;
}

/**
 * `flex: none` is what pins this header.
 *
 * The shell is a column flexbox whose second child is the scrolling board. Left
 * to `flex: auto` this header would shrink as the board grew and her name would
 * be scrolled off, which defeats the point of it: you must always know whose
 * dossier you are looking at (`full-profile.html:237`).
 */
const headerStyle: React.CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 15,
  padding: `15px ${insets.roomy}px 14px`,
  borderBottom: CARD_HAIRLINE,
  background: colors.porcelain,
  minWidth: 0,
};

/** Mobile: the meter and the CTA cannot share a 375px row with the name. */
const mobileHeaderStyle: React.CSSProperties = {
  ...headerStyle,
  flexWrap: 'wrap',
  gap: 12,
  padding: `13px ${insets.tight}px 12px`,
};

const backStyle: React.CSSProperties = {
  width: layout.backButtonSize,
  height: layout.backButtonSize,
  borderRadius: radii.pill,
  border: 'none',
  cursor: 'pointer',
  flex: 'none',
  display: 'grid',
  placeItems: 'center',
  background: colors.sand,
  color: colors.inkMuted,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.bodyLarge,
  lineHeight: 1,
};

const identityStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const nameStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: typography.headingFontFamily,
  fontSize: typography.px.display,
  fontWeight: typography.weights.normal,
  lineHeight: 1.1,
  color: colors.ink,
};

const subtitleStyle: React.CSSProperties = {
  margin: '2px 0 0',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.small,
  color: colors.inkMuted,
};

const meterStyle: React.CSSProperties = {
  flex: 'none',
  width: layout.meterWidth,
};

/** Mobile: the meter takes the full row under the name rather than a fixed 176px. */
const mobileMeterStyle: React.CSSProperties = {
  flex: '1 0 100%',
  width: 'auto',
};

const meterRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 8,
};

/**
 * "How well I know her", not "profile completeness".
 *
 * Stated as a fact about the relationship rather than as a form metric — the
 * mockup calls this out at `full-profile.html:51`. Same reasoning as the rail's
 * `TallyFooter`, and the same discrete ticks, so "5 of 18" reads as five things
 * known rather than as 28% of a chore.
 */
const meterLabelStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.eyebrow,
  fontWeight: typography.weights.medium,
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  color: colors.inkFaint,
};

const meterCountStyle: React.CSSProperties = {
  flex: 'none',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.small,
  fontWeight: typography.weights.medium,
  color: colors.claret,
  whiteSpace: 'nowrap',
};

const ticksStyle: React.CSSProperties = {
  display: 'flex',
  gap: 3,
  marginTop: 7,
};

const tickStyle: React.CSSProperties = {
  flex: 1,
  height: 5,
  borderRadius: radii.pill,
  background: colors.linenShade,
};

const tickOnStyle: React.CSSProperties = {
  ...tickStyle,
  background: colors.meterGradient,
};

const askAllStyle: React.CSSProperties = {
  flex: 'none',
  border: 'none',
  cursor: 'pointer',
  borderRadius: radii.pill,
  padding: '11px 17px',
  background: colors.claret,
  color: colors.textOnAccent,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.smallLoose,
  fontWeight: typography.weights.medium,
  boxShadow: '0 6px 16px rgba(140, 47, 69, 0.26)',
  whiteSpace: 'nowrap',
};

interface IdentityHeaderExtraProps {
  isMobile?: boolean;
}

/**
 * The dossier's pinned header: back out, who she is, how much is known, and the
 * one button that turns the gaps into a conversation.
 *
 * The portrait is `PartnerAvatar` at 50px rather than a second photo control, so
 * the upload/validation logic has exactly one home.
 */
export function IdentityHeader({
  name,
  subtitle,
  filled,
  total,
  onBack,
  onAskAll,
  isMobile = false,
}: IdentityHeaderProps & IdentityHeaderExtraProps) {
  return (
    <header
      style={isMobile ? mobileHeaderStyle : headerStyle}
      data-testid="dossier-identity"
    >
      <button
        type="button"
        style={backStyle}
        onClick={onBack}
        aria-label="Back to the conversation"
        data-testid="dossier-back"
      >
        &#8592;
      </button>

      <PartnerAvatar partnerName={name} size={layout.headerFaceSize} />

      <div style={identityStyle}>
        <h1 style={nameStyle}>{name ?? 'Her dossier'}</h1>
        {subtitle && <p style={subtitleStyle}>{subtitle}</p>}
      </div>

      <div style={isMobile ? { ...meterStyle, ...mobileMeterStyle } : meterStyle}>
        <div style={meterRowStyle}>
          <span style={meterLabelStyle}>How well I know her</span>
          <b style={meterCountStyle}>
            {filled} of {total}
          </b>
        </div>
        <div
          style={ticksStyle}
          role="progressbar"
          aria-valuenow={filled}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label={`${filled} of ${total} fields known`}
        >
          {Array.from({ length: total }, (_, index) => (
            <i key={index} style={index < filled ? tickOnStyle : tickStyle} />
          ))}
        </div>
      </div>

      <button
        type="button"
        style={askAllStyle}
        onClick={onAskAll}
        data-testid="dossier-ask-all"
      >
        Ask me what&rsquo;s missing
      </button>
    </header>
  );
}
