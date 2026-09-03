/**
 * Which outside services this build can actually reach, named once.
 *
 * The union lives in `shared` rather than beside the tools because three
 * unrelated places have to agree on the spelling: the server registers tools
 * under these ids, `logRecordToSpan` turns `integration.<id>` logs into spans the
 * Inspector draws, and the browser asks `GET /api/integrations` which of them are
 * configured. A private union on the server plus a hand-typed string in the client
 * is how the sidebar ends up quietly dark for a service that is working fine.
 *
 * These are *services*, not capabilities. The capability grid the visitor sees
 * ("Restaurant booking", "Travel") is `src/client/utils/integration-catalogue.ts`,
 * and one capability may be backed by more than one of these — Messages is both
 * Gmail and WhatsApp.
 */
export type IntegrationId =
  | 'hebcal'
  | 'ontopo'
  | 'amadeus'
  | 'google-calendar'
  | 'gmail'
  | 'whatsapp'
  | 'wolt'
  | 'spotify'
  | 'events'
  /**
   * The headless browser itself, which is a dependency rather than a destination.
   *
   * It earns an id because the panel draws it as a node and because it has its own
   * readiness — Chromium may simply not be installed — but nothing is "booked on
   * the browser". Every id whose {@link INTEGRATION_TRANSPORT} is `'browser'` is
   * unreachable when this one is not ready, which is a failure mode none of the
   * direct integrations have and the reason it is modelled at all.
   */
  | 'browser';

/** Every id, for iteration. Same order the tool registry registers them in. */
export const INTEGRATION_IDS: readonly IntegrationId[] = [
  'hebcal',
  'ontopo',
  'amadeus',
  'google-calendar',
  'gmail',
  'whatsapp',
  'browser',
  'wolt',
  'spotify',
  'events',
] as const;

/**
 * How Valentin reaches a service: straight over HTTP, or by driving a browser.
 *
 * This is the axis the panel's relay layout is drawn from, and it is a real
 * engineering distinction rather than a presentational one:
 *
 * - `direct` is an HTTP client against a documented (or at least stable) endpoint.
 *   It fails cleanly, costs milliseconds, and needs nothing installed.
 * - `browser` means there is no usable API and we drive a real page. It is an order
 *   of magnitude slower, breaks when a site changes its markup, and depends on a
 *   Chromium binary being present. Telling a visitor which of their capabilities
 *   rest on that is the honest thing to do — those are the ones that will break
 *   first, and they will break for reasons nobody controls.
 *
 * It is also the demo's whole argument. A hand-rolled browser tier is brittle in
 * ways a managed one is not, and drawing the dependency makes that visible instead
 * of merely assertable.
 */
export type IntegrationTransport = 'direct' | 'browser';

export const INTEGRATION_TRANSPORT: Record<IntegrationId, IntegrationTransport> = {
  hebcal: 'direct',
  // Availability and checkout are a real (undocumented) JSON API. Only
  // *discovery* needs a browser, and that is the `events`-style scrape below —
  // see `ontopo/discovery.ts` for why the two halves differ.
  ontopo: 'direct',
  amadeus: 'direct',
  'google-calendar': 'direct',
  gmail: 'direct',
  whatsapp: 'direct',
  // Wolt's consumer API answers lat/lon queries without auth, so the catalogue is
  // direct. Completing an order is not, but that is a handoff to Wolt's own
  // checkout rather than something Valentin drives.
  wolt: 'direct',
  // Spotify publishes a real, documented Web API, so both halves are direct: the
  // catalogue search that picks the tracks and the playlist write that saves them.
  spotify: 'direct',
  events: 'browser',
  browser: 'browser',
};

/**
 * The body of `GET /api/integrations`.
 *
 * Booleans and labels only. It must never echo a credential, not even a masked
 * one — the whole reason the endpoint exists is so the UI can say "not
 * configured" instead of pretending a service is ready, and that needs no secret.
 */
export interface IntegrationStatus {
  id: IntegrationId;
  /** Human name for the provider, e.g. 'Google Calendar'. */
  label: string;
  /**
   * Whether this process has what it needs to call the service. False means the
   * tools are not even registered, so the model cannot try and fail.
   */
  configured: boolean;
  /**
   * Whether reaching it needs the browser.
   *
   * Sent rather than looked up client-side so the drawing follows the deployment.
   * A browser-backed capability on a container with no Chromium is unreachable, and
   * the panel should be able to say that from one response rather than inferring it
   * from a table compiled into the bundle.
   */
  transport: IntegrationTransport;
}

export interface IntegrationStatusResponse {
  integrations: IntegrationStatus[];
}

/**
 * The provider name to show a human, keyed by id.
 *
 * Here rather than in the client because the endpoint sends it: the browser should
 * not have to keep its own table of six strings in sync with a union it already
 * imports, and an id with no label would otherwise render as `google-calendar`.
 */
export const INTEGRATION_LABELS: Record<IntegrationId, string> = {
  hebcal: 'Hebrew calendar',
  ontopo: 'Ontopo',
  amadeus: 'Amadeus',
  'google-calendar': 'Google Calendar',
  gmail: 'Gmail',
  whatsapp: 'WhatsApp',
  wolt: 'Wolt',
  spotify: 'Spotify',
  events: 'Event listings',
  // Named for what it is rather than for Playwright: the visitor is being told
  // that a real browser is involved, not which library drives it.
  browser: 'Headless browser',
};

/** The ids reached by driving a page, for the panel's relay layout. */
export const BROWSER_BACKED_IDS: readonly IntegrationId[] = INTEGRATION_IDS.filter(
  (id) => INTEGRATION_TRANSPORT[id] === 'browser' && id !== 'browser',
);
