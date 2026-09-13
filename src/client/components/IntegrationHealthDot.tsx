import { colors, radii } from '../design-system/tokens';
import type { CapabilityReadiness, ReadinessState } from '../hooks/use-integration-readiness';

/**
 * The one-glance health badge that sits on a provider's mark in the reach panel.
 *
 * The panel already said all of this in words — "live", "needs credentials", "not
 * built yet" — and the words are staying, because they carry the *reason* and a
 * colour cannot. What the words did not do is survive a glance: a visitor scanning
 * ten rows for "what works right now" was reading ten captions in two shades of
 * grey. Green and red answer that question before the caption is read, and the
 * caption is still there for the question it raises.
 *
 * **Colour is never the only channel.** The dot is `aria-hidden` and carries a
 * `title`; the readiness badge beside it is the accessible copy, and the row's own
 * `aria-label` already names its state. Nothing here is the sole carrier of
 * anything — which is the only way a red/green pair is allowed on a surface that
 * has to work for the ~8% of men who cannot tell them apart.
 *
 * **What green does and does not claim.** Green means the server reports
 * credentials in place and the tool registered — the same thing
 * `GET /api/integrations` means, and no more. It is not a probe: `ontopo` and
 * `wolt` report ready unconditionally, and a revoked Google refresh token keeps
 * reporting ready. `IntegrationStatusStrip`'s `CAVEAT` spells that gap out and the
 * same sentence is this dot's tooltip suffix, because a green light that silently
 * meant "probably" would be the most expensive kind of wrong here.
 */

/** What the dot is willing to say. Three states, because "can't tell" is real. */
export type IntegrationHealth =
  /** Credentials are in place and the tool is registered. */
  | 'live'
  /** Not reachable: no credentials, nothing built yet, or readiness itself failed. */
  | 'problem'
  /** Readiness has not arrived. Never coloured as either. */
  | 'unknown';

/**
 * Fold a capability's readiness into a dot colour.
 *
 * Exported and tested directly: this is where "green" is defined, and the whole
 * value of the dot is that the definition cannot drift quietly.
 *
 * `unavailable` readiness is a `problem` rather than `unknown` on purpose — the
 * panel could not reach its own server, which is a fault the visitor can see the
 * consequences of even though this client cannot name it. Only the moment before
 * the first response lands is `unknown`.
 */
export function integrationHealth(
  reach: CapabilityReadiness,
  state: ReadinessState,
): IntegrationHealth {
  if (reach === 'ready' || reach === 'partial') return 'live';
  if (reach === 'unknown') return state === 'unavailable' ? 'problem' : 'unknown';
  return 'problem';
}

/** The tooltip, which is also what the fold means in a sentence. */
export function healthSentence(name: string, health: IntegrationHealth): string {
  switch (health) {
    case 'live':
      return `${name} — live: this deployment holds credentials. A call can still fail if they have been revoked.`;
    case 'problem':
      return `${name} — not reachable: no credentials on this deployment, or its status could not be read.`;
    case 'unknown':
      return `${name} — checking…`;
  }
}

function dotColor(health: IntegrationHealth): string {
  switch (health) {
    case 'live':
      return colors.success;
    case 'problem':
      return colors.error;
    // Hollow rather than grey-filled: a filled grey dot reads as a third verdict,
    // and this state has no verdict yet.
    case 'unknown':
      return colors.porcelain;
  }
}

/**
 * Wraps a mark so the dot can hang off its corner.
 *
 * The tile itself is `brandTileStyle`, which is the design system's and sets no
 * `position` — so the badge needs its own positioned parent rather than a change
 * to a shared token used by every other tile in the app.
 */
export const healthAnchorStyle: React.CSSProperties = {
  position: 'relative',
  display: 'grid',
  placeItems: 'center',
  flexShrink: 0,
};

interface IntegrationHealthDotProps {
  health: IntegrationHealth;
  /** Provider name, for the tooltip. */
  name: string;
  /** Corner badge on a mark (default), or an inline pip in a line of text. */
  placement?: 'corner' | 'inline';
  /** Test hook, so a row's dot can be found by service id. */
  testId?: string;
}

export function IntegrationHealthDot({
  health,
  name,
  placement = 'corner',
  testId,
}: IntegrationHealthDotProps) {
  const hollow = health === 'unknown';
  return (
    <span
      aria-hidden="true"
      title={healthSentence(name, health)}
      data-testid={testId}
      data-health={health}
      style={{
        ...(placement === 'corner'
          ? { position: 'absolute', right: -3, bottom: -3 }
          : { display: 'inline-block', verticalAlign: 'middle', marginRight: 5 }),
        width: 9,
        height: 9,
        borderRadius: radii.pill,
        backgroundColor: dotColor(health),
        // The porcelain ring is what keeps a red dot from muddying into the mark's
        // own border; on the hollow state the ring *is* the dot.
        border: `${hollow ? 1.5 : 2}px solid ${hollow ? colors.inkFaint : colors.porcelain}`,
        boxSizing: 'border-box',
      }}
    />
  );
}
