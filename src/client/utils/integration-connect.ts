import type { IntegrationId } from '../../shared/interfaces/integrations';

/**
 * What each provider needs before this deployment can reach it, and where a
 * human gets it.
 *
 * This is the *deployment's* side of the panel, not the visitor's. The consent
 * sheet's scope list is about what Valentin may do on someone's behalf; this is
 * about whether the server holds a credential at all. Both have to be true, and
 * the panel has always been careful to keep them separate — see the note on
 * {@link useIntegrationReadiness}.
 *
 * Hebcal and Ontopo appear nowhere here on purpose. Hebcal is arithmetic in
 * process and Ontopo's availability endpoints need no authentication, so they
 * are live on every deployment and have nothing to connect. A recipe for them
 * would be a form that does nothing.
 *
 * Amadeus and WhatsApp used to have recipes here and no longer do, for the same
 * reason their catalogue rows went: a form that hands over credentials for a row
 * the panel does not offer is unreachable code that only looks like a feature.
 * The server integrations still exist — see `src/server/integrations` — so
 * restoring either is a catalogue row plus a recipe, not a rewrite.
 */

/** The services whose credentials can be handed over from inside the app. */
export type ConnectableId = 'google' | 'spotify';

/**
 * Which connect flow backs an integration id.
 *
 * Calendar and Gmail both map to `google` because they share one refresh token:
 * signing in once configures both, and offering two identical buttons would
 * suggest otherwise. Returns null for everything the panel cannot connect.
 */
export function connectableFor(id: IntegrationId): ConnectableId | null {
  switch (id) {
    case 'spotify':
      return 'spotify';
    case 'google-calendar':
    case 'gmail':
      return 'google';
    default:
      return null;
  }
}

export interface ConnectField {
  /** The key the server reads off the request body. */
  name: string;
  label: string;
  /**
   * True for anything that is itself a secret.
   *
   * Drives `type="password"`, which matters more than it looks: this panel gets
   * projected, and an API secret rendered in plain text on a wall is disclosed
   * whether or not anyone meant to.
   */
  secret: boolean;
  placeholder?: string;
}

export interface ConnectRecipe {
  id: ConnectableId;
  /** Provider name as a human says it. */
  provider: string;
  fields: readonly ConnectField[];
  /** Where to go to obtain these, in one sentence. */
  where: string;
  /** Link to the page that issues them. */
  href: string;
  /**
   * True when submitting the form is only step one.
   *
   * Google is the only one: a client id and secret cannot be verified without a
   * person approving scopes in a browser, so saving them is followed by a popup.
   * The button label has to say so, or the visitor thinks they are finished.
   */
  needsConsent?: boolean;
  /** Extra caution shown under the form, when there is something worth saying. */
  caution?: string;
}

export const CONNECT_RECIPES: Record<ConnectableId, ConnectRecipe> = {
  google: {
    id: 'google',
    provider: 'Google',
    fields: [
      {
        name: 'clientId',
        label: 'OAuth client ID',
        secret: false,
        placeholder: '…apps.googleusercontent.com',
      },
      { name: 'clientSecret', label: 'OAuth client secret', secret: true },
    ],
    where:
      'Google Cloud console → APIs & Services → Credentials → Create OAuth client ID (Web application). Enable the Calendar and Gmail APIs, and add this server\'s /api/integrations/google/callback as an authorised redirect URI.',
    href: 'https://console.cloud.google.com/apis/credentials',
    needsConsent: true,
    caution:
      'You will be asked to approve two scopes: read your calendar events, and send mail as you. Valentin never reads your inbox — sending is all it asks for, and every message still waits for you to press Confirm.',
  },
  spotify: {
    id: 'spotify',
    provider: 'Spotify',
    fields: [
      { name: 'clientId', label: 'Client ID', secret: false },
      { name: 'clientSecret', label: 'Client secret', secret: true },
    ],
    where:
      'Spotify Developer Dashboard → Create app. Copy the client ID and secret from its settings, and register this server\'s /api/integrations/spotify/callback as a Redirect URI on the same page.',
    href: 'https://developer.spotify.com/dashboard',
    /*
     * Consent, like Google — but for a different half of the capability.
     *
     * The id and secret are verified by the connect POST and buy catalogue
     * search on their own. What they cannot do is write to a library, so the
     * popup that follows is what upgrades "here are the songs as links" into a
     * saved playlist. Declining it leaves a working search rather than nothing,
     * and the hook's copy says so.
     */
    needsConsent: true,
    caution:
      'Signing in asks for one scope — playlist-modify-private — and nothing else: he cannot read your listening history, and every playlist he makes is private. Whatever account you approve is the library the playlists land in, so use a spare rather than your main. Skip the sign-in and he can still choose the songs; he just hands them to you as links instead of saving them.',
  },
};
