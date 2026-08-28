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
  | 'whatsapp';

/** Every id, for iteration. Same order the tool registry registers them in. */
export const INTEGRATION_IDS: readonly IntegrationId[] = [
  'hebcal',
  'ontopo',
  'amadeus',
  'google-calendar',
  'gmail',
  'whatsapp',
] as const;

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
};
