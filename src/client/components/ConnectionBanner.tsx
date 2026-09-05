import type { ConnectionStatus } from '../hooks/use-chat-state';
import { colors, spacing, typography, borderRadius } from '../design-system/tokens';

interface ConnectionBannerProps {
  status: ConnectionStatus;
}

const bannerStyle: React.CSSProperties = {
  padding: `${spacing.xs}px ${spacing.sm}px`,
  textAlign: 'center',
  fontSize: typography.sizes.sm,
  fontWeight: typography.weights.medium,
  margin: `${spacing.xs}px ${spacing.sm}px 0`,
  borderRadius: borderRadius.md,
};

/**
 * The two states worth interrupting someone about.
 *
 * `connecting` is not one of them — see `ConnectionStatus`. A banner shown while
 * the first socket is still opening is a false alarm every single load, and it was
 * red, which is the strongest thing this UI can say.
 */
type AnnouncedStatus = Exclude<ConnectionStatus, 'connected' | 'connecting'>;

const messages: Record<AnnouncedStatus, string> = {
  reconnecting: 'Reconnecting to Valentin…',
  disconnected: 'Connection lost. Please check your network.',
};

const bannerColors: Record<AnnouncedStatus, string> = {
  reconnecting: colors.champagne,
  disconnected: colors.error,
};

const textColors: Record<AnnouncedStatus, string> = {
  reconnecting: colors.text,
  disconnected: colors.textOnAccent,
};

export function ConnectionBanner({ status }: ConnectionBannerProps) {
  if (status === 'connected' || status === 'connecting') return null;

  return (
    <div
      role="alert"
      style={{
        ...bannerStyle,
        backgroundColor: bannerColors[status],
        color: textColors[status],
      }}
      data-testid="connection-banner"
    >
      {messages[status]}
    </div>
  );
}
