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
 */

/** The services whose credentials can be handed over from inside the app. */
export type ConnectableId = 'amadeus' | 'whatsapp' | 'google' | 'spotify';

/**
 * Which connect flow backs an integration id.
 *
 * Calendar and Gmail both map to `google` because they share one refresh token:
 * signing in once configures both, and offering two identical buttons would
 * suggest otherwise. Returns null for the two that need nothing.
 */
export function connectableFor(id: IntegrationId): ConnectableId | null {
  switch (id) {
    case 'amadeus':
      return 'amadeus';
    case 'whatsapp':
      return 'whatsapp';
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
  amadeus: {
    id: 'amadeus',
    provider: 'Amadeus',
    fields: [
      { name: 'clientId', label: 'API key', secret: false },
      { name: 'clientSecret', label: 'API secret', secret: true },
    ],
    where:
      'Amadeus for Developers → My Self-Service Workspace → your app. The free test keys are enough.',
    href: 'https://developers.amadeus.com/my-apps',
    caution:
      'This build talks to the Amadeus test sandbox, so hotel and activity results are representative rather than bookable. Pointing it at production is a deliberate change, because those endpoints spend real money.',
  },
  spotify: {
    id: 'spotify',
    provider: 'Spotify',
    fields: [
      { name: 'clientId', label: 'Client ID', secret: false },
      { name: 'clientSecret', label: 'Client secret', secret: true },
      {
        name: 'refreshToken',
        label: 'Refresh token (optional)',
        secret: true,
        placeholder: 'only needed to save playlists',
      },
    ],
    where:
      'Spotify Developer Dashboard → Create app. The client ID and secret are on the app\'s settings page, and are enough for Valentin to search the catalogue.',
    href: 'https://developer.spotify.com/dashboard',
    caution:
      'Without a refresh token he can choose the songs but not save them: confirming a playlist hands you the tracks as links instead. A refresh token is minted once by authorising your own account for the playlist-modify-private scope, and whatever account you use is the library every playlist lands in — so use a spare one, not your main.',
  },
  whatsapp: {
    id: 'whatsapp',
    provider: 'WhatsApp',
    fields: [
      { name: 'phoneNumberId', label: 'Phone number ID', secret: false },
      { name: 'token', label: 'Access token', secret: true },
    ],
    where:
      'Meta for Developers → your app → WhatsApp → API Setup. Both values are on that page.',
    href: 'https://developers.facebook.com/apps',
    caution:
      'A message sent outside a 24-hour reply window has to use a template Meta has approved, and that review takes days. Until one is approved, connecting proves the credentials work but a nudge will be refused.',
  },
};
