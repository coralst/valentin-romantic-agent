import { config } from '../../config';

/**
 * Transport for the one Google account this build acts as.
 *
 * ## The identity model, stated plainly
 *
 * There is no per-user OAuth here. One refresh token sits in the environment and
 * Calendar and Gmail both act as whoever owns it. Every session sees the same
 * calendar and sends mail from the same address, so this is a demo account and
 * must stay one — pointing `GOOGLE_REFRESH_TOKEN` at a real person's account
 * makes every visitor a reader of their diary.
 *
 * That limitation is deliberate and is part of what this build is *for*: proper
 * multi-user identity is one of the three things Version A is meant to lack, and
 * papering over it here would hide the comparison rather than make it.
 *
 * ## Auth
 *
 * `POST https://oauth2.googleapis.com/token` with `grant_type=refresh_token`
 * returns a bearer token good for an hour. Cached in this module and refreshed
 * early by {@link TOKEN_SKEW_MS}. Refresh tokens do not expire on their own but
 * they *are* revoked — by a password change, by six months of disuse, by the user
 * clicking Remove Access. When that happens the token call returns
 * `400 invalid_grant`, which surfaces here as `null` and reaches the user as
 * "I can't get to your calendar", not a stack trace.
 *
 * ## Scopes
 *
 * `calendar.events` and `gmail.send`, and nothing more. Notably *not*
 * `gmail.readonly`: Valentin has no reason to read anyone's mail, and a token
 * that cannot read the inbox cannot leak it. `gmail.send` is also the narrowest
 * scope that can send — `gmail.compose` would additionally allow creating and
 * deleting drafts.
 *
 * Like Amadeus and unlike Ontopo, this follows published documentation rather
 * than observation, and has not been exercised against a live account from this
 * repo. The request shapes are documented-correct.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1';

/** Google access tokens last an hour; refresh a minute early. */
const TOKEN_SKEW_MS = 60 * 1000;

const TIMEOUT_MS = 10_000;

/** How long a proposed email or calendar entry stays confirmable. */
export const GOOGLE_PROPOSAL_TTL_MS = 10 * 60 * 1000;

/**
 * The scopes this build asks for, recorded so the value is checkable.
 *
 * Not sent anywhere — a refresh token already carries its grant. This exists so
 * that whoever mints the token knows exactly what to tick, and so that widening
 * it later is a visible diff rather than a quiet change of blast radius.
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.send',
] as const;

export interface CalendarEvent {
  id: string;
  summary: string;
  /** `YYYY-MM-DD` for an all-day entry, an ISO timestamp otherwise. */
  start: string;
  /** True when Google returned a `date` rather than a `dateTime`. */
  allDay: boolean;
  location?: string;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

/** Drop the cached token. For tests. */
export function resetGoogleTokenCache(): void {
  tokenCache = null;
}

/**
 * A bearer token for the configured account, from cache when still good.
 *
 * Returns `null` for both "not configured" and "Google refused", because the
 * caller says the same thing to the user either way and the distinction is only
 * useful in a log.
 */
export async function googleAccessToken(): Promise<string | null> {
  const { googleClientId, googleClientSecret, googleRefreshToken } = config.integrations;
  if (!googleClientId || !googleClientSecret || !googleRefreshToken) return null;

  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: googleClientId,
      client_secret: googleClientSecret,
      refresh_token: googleRefreshToken,
    }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // `400 invalid_grant` lands here. It means the refresh token was revoked and no
  // amount of retrying will help — a human has to mint a new one.
  if (!response.ok) return null;

  const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof body.access_token !== 'string') return null;

  const ttlSeconds = typeof body.expires_in === 'number' ? body.expires_in : 3599;
  tokenCache = {
    token: body.access_token,
    expiresAt: Date.now() + ttlSeconds * 1000 - TOKEN_SKEW_MS,
  };
  return tokenCache.token;
}

/** Call a Google endpoint. Returns `null` on any fault; never throws for a 4xx. */
async function call(
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<Record<string, unknown> | null> {
  const token = await googleAccessToken();
  if (!token) return null;

  const response = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return null;

  const parsed: unknown = await response.json();
  return typeof parsed === 'object' && parsed !== null
    ? (parsed as Record<string, unknown>)
    : null;
}

function readEvent(raw: unknown): CalendarEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as {
    id?: unknown;
    summary?: unknown;
    location?: unknown;
    start?: { date?: unknown; dateTime?: unknown };
  };
  if (typeof record.id !== 'string') return null;

  const date = record.start?.date;
  const dateTime = record.start?.dateTime;
  const start = typeof dateTime === 'string' ? dateTime : typeof date === 'string' ? date : '';
  if (start === '') return null;

  return {
    id: record.id,
    // An untitled event is legal in Google's model and reads badly everywhere
    // else, so it gets a name here rather than an empty string downstream.
    summary: typeof record.summary === 'string' && record.summary ? record.summary : '(untitled)',
    start,
    allDay: typeof date === 'string',
    location: typeof record.location === 'string' ? record.location : undefined,
  };
}

export interface EventSearchQuery {
  /** ISO timestamp; the earliest event to return. */
  timeMin: string;
  /** ISO timestamp; the latest. */
  timeMax: string;
  /** Google's free-text filter, matched across title, description and location. */
  q?: string;
  limit?: number;
}

/**
 * Events from the primary calendar in a window.
 *
 * `singleEvents=true` matters more than it looks: without it a recurring
 * anniversary comes back as one master entry with a recurrence rule, and the
 * next actual occurrence has to be computed by hand. With it, Google expands the
 * series and returns the instance that falls in the window — which is the only
 * thing this app ever wants to know.
 */
export async function listEvents(query: EventSearchQuery): Promise<CalendarEvent[] | null> {
  const url = new URL(`${CALENDAR_BASE}/calendars/primary/events`);
  url.searchParams.set('timeMin', query.timeMin);
  url.searchParams.set('timeMax', query.timeMax);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', String(query.limit ?? 25));
  if (query.q) url.searchParams.set('q', query.q);

  const body = await call(url.toString());
  if (!body) return null;

  const items = Array.isArray(body.items) ? body.items : [];
  return items
    .map(readEvent)
    .filter((event): event is CalendarEvent => event !== null)
    .slice(0, query.limit ?? 25);
}

export interface NewEvent {
  summary: string;
  description?: string;
  location?: string;
  /** ISO timestamp with an offset, or `YYYY-MM-DD` for an all-day entry. */
  start: string;
  end: string;
  allDay: boolean;
  /** IANA zone. Israel unless told otherwise, since that is where this lives. */
  timeZone?: string;
}

export interface CreatedEvent {
  id: string;
  /** Google's own link to the entry, for the confirmation message. */
  htmlLink?: string;
}

/** Write one event to the primary calendar. Returns `null` if Google refused. */
export async function insertEvent(event: NewEvent): Promise<CreatedEvent | null> {
  const timeZone = event.timeZone ?? 'Asia/Jerusalem';
  const body = await call(`${CALENDAR_BASE}/calendars/primary/events`, {
    method: 'POST',
    body: {
      summary: event.summary,
      description: event.description,
      location: event.location,
      // Google's schema is `date` xor `dateTime`; sending both is an error, which
      // is why `allDay` is carried explicitly rather than sniffed from the string.
      start: event.allDay ? { date: event.start } : { dateTime: event.start, timeZone },
      end: event.allDay ? { date: event.end } : { dateTime: event.end, timeZone },
    },
  });
  if (!body || typeof body.id !== 'string') return null;

  return {
    id: body.id,
    htmlLink: typeof body.htmlLink === 'string' ? body.htmlLink : undefined,
  };
}

/**
 * RFC 2047 encoded-word, so a Hebrew subject line survives the wire.
 *
 * A raw UTF-8 subject in a MIME header is not legal and clients render it as
 * mojibake. This is not a hypothetical here — half the plausible subject lines in
 * this app are Hebrew.
 */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/**
 * Build the RFC 822 message Gmail wants, base64url encoded.
 *
 * Exported for the tests, which assert the encoding rather than trusting it —
 * the base64url alphabet (`-_`, no padding) is the detail most likely to be got
 * wrong, and Gmail's failure for a plain-base64 body is an opaque 400.
 */
export function buildRawMessage(input: {
  to: string;
  subject: string;
  body: string;
}): string {
  const message = [
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(input.body, 'utf8').toString('base64'),
  ].join('\r\n');

  return Buffer.from(message, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export interface SentMessage {
  id: string;
  threadId?: string;
}

/**
 * Send one message as the configured account.
 *
 * The only genuinely irreversible thing in this whole integration layer: a
 * reservation link can be ignored and a calendar entry deleted, but a sent email
 * is sent. Which is why nothing calls this outside a `confirm` handler.
 */
export async function sendMessage(input: {
  to: string;
  subject: string;
  body: string;
}): Promise<SentMessage | null> {
  const body = await call(`${GMAIL_BASE}/users/me/messages/send`, {
    method: 'POST',
    body: { raw: buildRawMessage(input) },
  });
  if (!body || typeof body.id !== 'string') return null;

  return {
    id: body.id,
    threadId: typeof body.threadId === 'string' ? body.threadId : undefined,
  };
}
