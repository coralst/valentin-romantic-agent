import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../../config';
import {
  GOOGLE_SCOPES,
  buildRawMessage,
  googleAccessToken,
  insertEvent,
  listEvents,
  resetGoogleTokenCache,
  sendMessage,
} from '../client';
import {
  findOccasionsTool,
  gmailTools,
  googleCalendarTools,
  proposeCalendarEventTool,
  proposeEmailTool,
} from '../tools';

/**
 * Google, with `fetch` stubbed.
 *
 * The assertions that matter most here are the negative ones: that no calendar
 * write and no send happens before a `confirm`, and that the body which leaves
 * the account is byte-for-byte the body the user was shown. Those are the two
 * properties that make a propose/confirm design worth anything, and they are
 * invisible in the happy path.
 */

const TOKEN_URL = 'oauth2.googleapis.com/token';
const EVENTS_URL = '/calendars/primary/events';
const SEND_URL = '/users/me/messages/send';

interface Call {
  url: string;
  method: string;
  body: string | null;
  headers: Record<string, string>;
}

let calls: Call[] = [];

function stubFetch(responder: (url: string, method: string) => unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({
        url,
        method,
        body: typeof init?.body === 'string' ? init.body : null,
        headers: (init?.headers ?? {}) as Record<string, string>,
      });

      const payload = responder(url, method);
      if (payload === undefined) {
        return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) };
      }
      return { ok: true, status: 200, json: async () => payload };
    }),
  );
}

const TOKEN_OK = { access_token: 'ya29.fake', expires_in: 3599 };

const EVENT_LIST = {
  items: [
    {
      id: 'ev-1',
      summary: 'Our anniversary',
      start: { date: '2026-09-05' },
    },
    {
      id: 'ev-2',
      summary: 'Standup',
      start: { dateTime: '2026-09-02T09:30:00+03:00' },
    },
    {
      id: 'ev-3',
      summary: 'יום הולדת של דנה',
      start: { date: '2026-10-11' },
      location: 'Tel Aviv',
    },
    { id: 'ev-4', start: { date: '2026-09-20' } },
  ],
};

function stubEverything(): void {
  stubFetch((url, method) => {
    if (url.includes(TOKEN_URL)) return TOKEN_OK;
    if (url.includes(EVENTS_URL) && method === 'POST') {
      return { id: 'created-1', htmlLink: 'https://calendar.google.test/created-1' };
    }
    if (url.includes(EVENTS_URL)) return EVENT_LIST;
    if (url.includes(SEND_URL)) return { id: 'msg-1', threadId: 'thr-1' };
    return undefined;
  });
}

const ctx = { sessionId: 'session-1', userId: 'user-1' };

beforeEach(() => {
  calls = [];
  resetGoogleTokenCache();
  config.integrations.googleClientId = 'gid';
  config.integrations.googleClientSecret = 'gsecret';
  config.integrations.googleRefreshToken = 'grefresh';
});

afterEach(() => {
  vi.unstubAllGlobals();
  config.integrations.googleClientId = undefined;
  config.integrations.googleClientSecret = undefined;
  config.integrations.googleRefreshToken = undefined;
});

describe('googleAccessToken', () => {
  it('exchanges the refresh token for a bearer token', async () => {
    stubEverything();
    await expect(googleAccessToken()).resolves.toBe('ya29.fake');

    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toContain('grant_type=refresh_token');
    expect(calls[0].body).toContain('refresh_token=grefresh');
  });

  it('caches the token across calls', async () => {
    stubEverything();
    await googleAccessToken();
    await googleAccessToken();

    expect(calls.filter((call) => call.url.includes(TOKEN_URL))).toHaveLength(1);
  });

  it('returns null when the refresh token has been revoked', async () => {
    // Google answers a revoked token with `400 invalid_grant`. No retry helps —
    // a human has to mint a new one — so this must surface as a sentence, not a throw.
    stubFetch(() => undefined);
    await expect(googleAccessToken()).resolves.toBeNull();
  });

  it('returns null, and asks nothing, when unconfigured', async () => {
    config.integrations.googleRefreshToken = undefined;
    stubEverything();

    await expect(googleAccessToken()).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('asks for the calendar, sending mail, and reading it back — and nothing else', () => {
    expect(GOOGLE_SCOPES).toEqual([
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
    ]);

    /*
     * `gmail.readonly` is a deliberate widening, and this assertion is where the cost
     * is recorded rather than hidden. It exists for one thing:
     * `scripts/verify-reminder-mail.ts` asking whether an automatic reminder actually
     * landed in the mailbox, which is the one claim about this system that cannot be
     * checked by reading code. No request path reads mail.
     *
     * What is still forbidden is everything that would let this app *change* a
     * mailbox. `gmail.modify` and `gmail.compose` can delete drafts and alter labels,
     * and `https://mail.google.com/` is total control including permanent deletion.
     * Reading and sending are recoverable; those are not.
     */
    for (const forbidden of ['gmail.modify', 'gmail.compose', 'gmail.settings']) {
      expect(GOOGLE_SCOPES.some((scope) => scope.includes(forbidden))).toBe(false);
    }
    expect(GOOGLE_SCOPES).not.toContain('https://mail.google.com/');
  });
});

describe('listEvents', () => {
  it('expands recurring series rather than returning the master entry', async () => {
    stubEverything();
    await listEvents({ timeMin: '2026-09-01T00:00:00Z', timeMax: '2026-12-01T00:00:00Z' });

    const url = calls.at(-1)!.url;
    // Without singleEvents a yearly anniversary comes back as a recurrence rule
    // and the next occurrence has to be computed by hand.
    expect(url).toContain('singleEvents=true');
    expect(url).toContain('orderBy=startTime');
  });

  it('marks all-day entries and reads timed ones', async () => {
    stubEverything();
    const events = await listEvents({ timeMin: 'a', timeMax: 'b' });

    expect(events?.find((event) => event.id === 'ev-1')).toMatchObject({ allDay: true });
    expect(events?.find((event) => event.id === 'ev-2')).toMatchObject({
      allDay: false,
      start: '2026-09-02T09:30:00+03:00',
    });
  });

  it('names an untitled event rather than passing an empty string on', async () => {
    stubEverything();
    const events = await listEvents({ timeMin: 'a', timeMax: 'b' });

    expect(events?.find((event) => event.id === 'ev-4')?.summary).toBe('(untitled)');
  });

  it('returns null when the calendar cannot be reached', async () => {
    stubFetch((url) => (url.includes(TOKEN_URL) ? TOKEN_OK : undefined));
    await expect(listEvents({ timeMin: 'a', timeMax: 'b' })).resolves.toBeNull();
  });
});

describe('insertEvent', () => {
  it('sends `date` for an all-day entry and no dateTime', async () => {
    stubEverything();
    await insertEvent({ summary: 'Anniversary', start: '2026-09-05', end: '2026-09-06', allDay: true });

    const body = JSON.parse(calls.at(-1)!.body!) as { start: Record<string, unknown> };
    expect(body.start).toEqual({ date: '2026-09-05' });
    expect(body.start.dateTime).toBeUndefined();
  });

  it('sends a bare local dateTime with an explicit Israel time zone', async () => {
    stubEverything();
    await insertEvent({
      summary: 'Dinner',
      start: '2026-09-05T20:00:00',
      end: '2026-09-05T22:00:00',
      allDay: false,
    });

    const body = JSON.parse(calls.at(-1)!.body!) as { start: Record<string, unknown> };
    // No offset in the string, on purpose: Google resolves it from timeZone, so
    // nothing here has to know whether Israel is on +02:00 or +03:00 that week.
    expect(body.start).toEqual({ dateTime: '2026-09-05T20:00:00', timeZone: 'Asia/Jerusalem' });
  });

  it('returns null when Google refuses the write', async () => {
    stubFetch((url) => (url.includes(TOKEN_URL) ? TOKEN_OK : undefined));
    await expect(
      insertEvent({ summary: 'x', start: '2026-09-05', end: '2026-09-06', allDay: true }),
    ).resolves.toBeNull();
  });
});

describe('buildRawMessage', () => {
  function decode(raw: string): string {
    return Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  }

  it('encodes as base64url with no padding', () => {
    const raw = buildRawMessage({ to: 'a@b.test', subject: 'Hello', body: 'Hi there' });

    // Gmail rejects standard base64 with an opaque 400, so the alphabet matters.
    expect(raw).not.toContain('+');
    expect(raw).not.toContain('/');
    expect(raw).not.toContain('=');
  });

  it('leaves an ASCII subject alone', () => {
    const decoded = decode(buildRawMessage({ to: 'a@b.test', subject: 'Dinner', body: 'x' }));
    expect(decoded).toContain('Subject: Dinner');
  });

  it('wraps a Hebrew subject in an RFC 2047 encoded-word', () => {
    const decoded = decode(
      buildRawMessage({ to: 'a@b.test', subject: 'יום נישואין', body: 'x' }),
    );

    // A raw UTF-8 subject header is illegal and renders as mojibake. Half the
    // plausible subject lines in this app are Hebrew, so this is not theoretical.
    expect(decoded).toContain('Subject: =?UTF-8?B?');
    expect(decoded).not.toContain('Subject: יום נישואין');
  });

  it('round-trips a Hebrew body through the base64 part', () => {
    const decoded = decode(buildRawMessage({ to: 'a@b.test', subject: 'x', body: 'אני אוהב אותך' }));
    const part = decoded.split('\r\n\r\n')[1];

    expect(Buffer.from(part, 'base64').toString('utf8')).toBe('אני אוהב אותך');
  });
});

describe('sendMessage', () => {
  it('posts a raw message and returns its id', async () => {
    stubEverything();
    await expect(
      sendMessage({ to: 'a@b.test', subject: 'Hi', body: 'Hello' }),
    ).resolves.toEqual({ id: 'msg-1', threadId: 'thr-1' });

    const body = JSON.parse(calls.at(-1)!.body!) as { raw: string };
    expect(typeof body.raw).toBe('string');
  });

  it('returns null when Gmail refuses', async () => {
    stubFetch((url) => (url.includes(TOKEN_URL) ? TOKEN_OK : undefined));
    await expect(sendMessage({ to: 'a@b.test', subject: 'Hi', body: 'x' })).resolves.toBeNull();
  });
});

describe('find_occasions', () => {
  it('leads with occasions but still reports the rest of the window', async () => {
    stubEverything();
    const result = await findOccasionsTool.execute({}, ctx);

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Our anniversary');
    expect(result.summary).toContain('יום הולדת של דנה');
    // Occasions come first, because that is what the tool is for.
    expect(result.summary.indexOf('Our anniversary')).toBeLessThan(
      result.summary.indexOf('Standup'),
    );
    // But the standup is still there. This assertion used to be
    // `not.toContain('Standup')`, and that is precisely the bug that shipped: the
    // ten-word occasion list was a *gate*, so a real diary holding a flight, six
    // hotel stays, two restaurant bookings and two court dates came back as
    // "empty" and the model said so out loud. A read tool may rank what it
    // found; it may not hide it.
    expect(result.summary).toContain('Standup');
  });

  it('matches Hebrew occasion words', async () => {
    stubEverything();
    const result = await findOccasionsTool.execute({}, ctx);
    const data = result.data as { events: Array<{ summary: string }> };

    expect(data.events.map((event) => event.summary)).toContain('יום הולדת של דנה');
  });

  it('hands an explicit query to Google instead of filtering locally', async () => {
    stubEverything();
    const result = await findOccasionsTool.execute({ query: 'standup' }, ctx);

    expect(calls.at(-1)!.url).toContain('q=standup');
    // With a query the caller asked for something specific, so the occasion
    // filter would be second-guessing them.
    expect(result.summary).toContain('Standup');
  });

  it('asks the user for the date rather than guessing when the calendar is unreachable', async () => {
    stubFetch((url) => (url.includes(TOKEN_URL) ? TOKEN_OK : undefined));
    const result = await findOccasionsTool.execute({}, ctx);

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('guessing a date');
  });

  it('reports a genuinely empty window as empty', async () => {
    stubFetch((url) => (url.includes(TOKEN_URL) ? TOKEN_OK : { items: [] }));
    const result = await findOccasionsTool.execute({}, ctx);

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('nothing at all');
  });

  it('does not call an empty window empty when only the occasions are missing', async () => {
    stubFetch((url) =>
      url.includes(TOKEN_URL)
        ? TOKEN_OK
        : { items: [{ id: '1', summary: 'Flight to Manchester', start: { date: '2026-10-12' } }] },
    );
    const result = await findOccasionsTool.execute({}, ctx);

    expect(result.ok).toBe(true);
    // The distinction the model has to be able to draw, and could not before:
    // "no birthdays" is not "no calendar".
    expect(result.summary).toContain('Flight to Manchester');
    expect(result.summary).not.toContain('nothing at all');
  });

  it('never writes', async () => {
    stubEverything();
    await findOccasionsTool.execute({}, ctx);

    expect(calls.every((call) => call.method === 'GET' || call.url.includes(TOKEN_URL))).toBe(true);
  });
});

describe('propose_calendar_event', () => {
  it('proposes without touching the calendar', async () => {
    stubEverything();
    const result = await proposeCalendarEventTool.execute(
      { title: 'Dinner at NOEMA', date: '2026-09-05', time: '20:00' },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(result.proposal?.service).toBe('google-calendar');
    // No POST may happen before a human says yes.
    expect(calls.filter((call) => call.method === 'POST' && call.url.includes(EVENTS_URL))).toHaveLength(0);
  });

  it('makes an all-day entry when no time is given, ending the next day', async () => {
    stubEverything();
    const result = await proposeCalendarEventTool.execute(
      { title: 'Our anniversary', date: '2026-09-05' },
      ctx,
    );

    // Google treats an all-day `end` as exclusive; the same date twice produces a
    // zero-length entry and the day after produces the two-day anniversary bug.
    expect(result.proposal?.payload).toMatchObject({
      allDay: true,
      start: '2026-09-05',
      end: '2026-09-06',
    });
  });

  it('builds a timed range from the duration', async () => {
    stubEverything();
    const result = await proposeCalendarEventTool.execute(
      { title: 'Dinner', date: '2026-09-05', time: '20:30', duration_minutes: 90 },
      ctx,
    );

    expect(result.proposal?.payload).toMatchObject({
      allDay: false,
      start: '2026-09-05T20:30:00',
      end: '2026-09-05T22:00:00',
    });
  });

  it('does not shift the date across the Israeli midnight', async () => {
    stubEverything();
    const result = await proposeCalendarEventTool.execute(
      { title: 'Our anniversary', date: '2026-09-05' },
      ctx,
    );

    expect(result.proposal?.payload).toMatchObject({ start: '2026-09-05' });
  });

  it('refuses an unreadable date', async () => {
    stubEverything();
    const result = await proposeCalendarEventTool.execute({ title: 'x', date: 'whenever' }, ctx);

    expect(result.ok).toBe(false);
    expect(result.proposal).toBeUndefined();
  });

  it('writes the entry only on confirm, and reports the link', async () => {
    stubEverything();
    const result = await proposeCalendarEventTool.confirm!(
      {
        id: 'p',
        sessionId: 'session-1',
        service: 'google-calendar',
        title: 't',
        summary: '',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        payload: {
          title: 'Dinner at NOEMA',
          start: '2026-09-05T20:00:00',
          end: '2026-09-05T22:00:00',
          allDay: false,
          readable: 'Saturday 5 September at 20:00',
        },
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect((result.data as { url: string }).url).toBe('https://calendar.google.test/created-1');
    expect(calls.some((call) => call.method === 'POST' && call.url.includes(EVENTS_URL))).toBe(true);
  });

  it('says nothing was added when Google refuses the write', async () => {
    stubFetch((url) => (url.includes(TOKEN_URL) ? TOKEN_OK : undefined));
    const result = await proposeCalendarEventTool.confirm!(
      {
        id: 'p',
        sessionId: 'session-1',
        service: 'google-calendar',
        title: 't',
        summary: '',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        payload: { title: 'x', start: '2026-09-05', end: '2026-09-06', allDay: true },
      },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('nothing was added');
  });
});

describe('propose_email', () => {
  const good = {
    to: 'dana@example.test',
    subject: 'Table on Saturday',
    body: 'Hello — could we have a quiet table by the window on Saturday at 20:00? Thank you.',
  };

  it('shows the user the exact text and sends nothing', async () => {
    stubEverything();
    const result = await proposeEmailTool.execute(good, ctx);

    expect(result.ok).toBe(true);
    expect(result.proposal?.summary).toContain('quiet table by the window');
    expect(result.proposal?.summary).toContain('Nothing is sent until you confirm');
    expect(calls).toHaveLength(0);
  });

  it('says out loud that the mail comes from Valentin’s own account', async () => {
    stubEverything();
    const result = await proposeEmailTool.execute(good, ctx);

    // One hardcoded account sends everything. Better said on the card than
    // discovered in someone's sent folder.
    expect(result.proposal?.summary).toContain("Valentin's own Gmail account");
  });

  it('carries the full body on the payload, not the truncated preview', async () => {
    stubEverything();
    const longBody = `${'x'.repeat(600)} END`;
    const result = await proposeEmailTool.execute({ ...good, body: longBody }, ctx);

    expect(result.proposal?.summary).toContain('…');
    expect(result.proposal?.payload?.body).toBe(longBody);
  });

  it('refuses an address that is not an address', async () => {
    stubEverything();
    const result = await proposeEmailTool.execute({ ...good, to: 'dana at example' }, ctx);

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('rather than guessing one');
    expect(calls).toHaveLength(0);
  });

  it('refuses an empty subject or body', async () => {
    stubEverything();
    await expect(proposeEmailTool.execute({ ...good, body: '   ' }, ctx)).resolves.toMatchObject({
      ok: false,
    });
    await expect(proposeEmailTool.execute({ ...good, subject: '' }, ctx)).resolves.toMatchObject({
      ok: false,
    });
  });

  it('sends exactly the approved body on confirm', async () => {
    stubEverything();
    const proposed = await proposeEmailTool.execute(good, ctx);
    const result = await proposeEmailTool.confirm!(proposed.proposal!, ctx);

    expect(result.ok).toBe(true);

    const raw = (JSON.parse(calls.at(-1)!.body!) as { raw: string }).raw;
    const decoded = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const sentBody = Buffer.from(decoded.split('\r\n\r\n')[1], 'base64').toString('utf8');

    // What the user read is what leaves the account. If the model could change
    // its mind between the card and the send, the card would mean nothing.
    expect(sentBody).toBe(good.body);
    expect(decoded).toContain(`To: ${good.to}`);
  });

  it('does not claim it went out when Gmail refuses', async () => {
    stubFetch((url) => (url.includes(TOKEN_URL) ? TOKEN_OK : undefined));
    const result = await proposeEmailTool.confirm!(
      {
        id: 'p',
        sessionId: 'session-1',
        service: 'gmail',
        title: 't',
        summary: '',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        payload: good,
      },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('it was not sent');
  });

  it('fails closed when the payload lost the body', async () => {
    stubEverything();
    const result = await proposeEmailTool.confirm!(
      {
        id: 'p',
        sessionId: 'session-1',
        service: 'gmail',
        title: 't',
        summary: '',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        payload: { to: good.to, subject: good.subject },
      },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('registration', () => {
  it('splits the tools across the two service ids', () => {
    expect(googleCalendarTools.map((tool) => tool.name)).toEqual([
      'find_occasions',
      'propose_calendar_event',
    ]);
    expect(gmailTools.map((tool) => tool.name)).toEqual(['propose_email']);

    for (const tool of googleCalendarTools) expect(tool.service).toBe('google-calendar');
    for (const tool of gmailTools) expect(tool.service).toBe('gmail');
  });

  it('gives every write a confirm handler and no read one', () => {
    for (const tool of [...googleCalendarTools, ...gmailTools]) {
      expect(typeof tool.confirm === 'function').toBe(tool.requiresConfirmation);
    }
  });

  it('gates every tool that touches the account', () => {
    expect(proposeCalendarEventTool.requiresConfirmation).toBe(true);
    expect(proposeEmailTool.requiresConfirmation).toBe(true);
    expect(findOccasionsTool.requiresConfirmation).toBe(false);
  });
});
