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

const messages: Record<Exclude<ConnectionStatus, 'connected'>, string> = {
  reconnecting: 'Reconnecting to Valentin…',
  disconnected: 'Connection lost. Please check your network.',
};

const bannerColors: Record<Exclude<ConnectionStatus, 'connected'>, string> = {
  reconnecting: colors.champagne,
  disconnected: colors.error,
};

const textColors: Record<Exclude<ConnectionStatus, 'connected'>, string> = {
  reconnecting: colors.text,
  disconnected: colors.textOnAccent,
};

export function ConnectionBanner({ status }: ConnectionBannerProps) {
  if (status === 'connected') return null;

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
