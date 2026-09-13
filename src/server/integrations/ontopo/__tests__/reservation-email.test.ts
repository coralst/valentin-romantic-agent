import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The confirmation mail: what it says, and what it refuses to say.
 *
 * Two halves, and the first one carries the weight. `buildReservationEmail` is
 * pure, and the property worth pinning is not the wording but the *invariant* —
 * a message about a table that is not held must not read as one that is. The
 * booked and unbooked bodies are asserted against each other rather than only
 * against themselves, because the way this feature fails in production is one
 * branch drifting into the other's language.
 */

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('../../google/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../google/client')>()),
  sendMessage,
}));

import { config } from '../../../config';
import type { ToolContext } from '../../tool-registry';
import {
  buildReservationEmail,
  sendReservationSummary,
  type ReservationMailInput,
} from '../reservation-email';

const BOOKED: ReservationMailInput = {
  venueName: 'Noema',
  place: 'Neve Tzedek',
  readableDate: 'Saturday 5 September',
  time: '20:30',
  partySize: 2,
  area: 'Inside',
  occasion: 'your anniversary',
  booked: true,
  guestName: 'Noa Shaked',
  checkoutUrl: 'https://ontopo.com/en/il/tel-aviv/checkout/abc123',
  venuePageUrl: 'https://ontopo.com/en/il/tel-aviv/page/9999',
};

const HANDOFF: ReservationMailInput = { ...BOOKED, booked: false };

describe('buildReservationEmail', () => {
  it('names the state and the table in the subject, for a lock screen', () => {
    expect(buildReservationEmail(BOOKED).subject).toBe(
      'Booked — Noema, Saturday 5 September at 20:30',
    );
    expect(buildReservationEmail(HANDOFF).subject).toBe(
      'Not booked yet — Noema, Saturday 5 September at 20:30',
    );
  });

  it('carries every detail of a booked table', () => {
    const { body } = buildReservationEmail(BOOKED);

    expect(body).toContain('Your table is booked.');
    expect(body).toContain('  Noema, Neve Tzedek');
    expect(body).toContain('  Saturday 5 September at 20:30');
    expect(body).toContain('  Table for 2 — Inside');
    expect(body).toContain('  For your anniversary');
    expect(body).toContain('  Under the name Noa Shaked');
    expect(body).toContain('— Valentin');
  });

  it('gives the checkout URL as the link to verify the reservation on', () => {
    const { body } = buildReservationEmail(BOOKED);

    expect(body).toContain('Verify it on Ontopo:');
    expect(body).toContain(BOOKED.checkoutUrl);
    // The TTL is rendered from CHECKOUT_TTL_MS rather than typed into the prose, so
    // changing the constant cannot leave the mail quoting a stale number.
    expect(body).toContain('15 minutes');
    // Ontopo's own message is the durable one, and the mail has to say so — ours
    // links a page that expires.
    expect(body).toContain('cancellation link');
  });

  it('tells a reader with an unfinished booking that nothing is held', () => {
    const { body } = buildReservationEmail(HANDOFF);

    expect(body).toContain('Your table is not booked yet.');
    expect(body).toContain('Finish the reservation on Ontopo:');
    expect(body).toContain('Nothing is held until you complete that form.');
    expect(body).toContain(HANDOFF.checkoutUrl);
  });

  it('never lets the unbooked body claim a booking', () => {
    const { body } = buildReservationEmail(HANDOFF);

    expect(body).not.toContain('Your table is booked');
    expect(body).not.toContain('Verify it on Ontopo');
  });

  it('withholds the guest name until the form was actually completed', () => {
    // The configured identity is real on both paths, but on a handoff the reader
    // types their own name into Ontopo's form — so naming ours would describe a
    // reservation that does not exist under it.
    expect(buildReservationEmail(HANDOFF).body).not.toContain('Under the name');
  });

  it('links the restaurant page only when there is one', () => {
    expect(buildReservationEmail(BOOKED).body).toContain('The restaurant on Ontopo:');
    expect(
      buildReservationEmail({ ...BOOKED, venuePageUrl: null }).body,
    ).not.toContain('The restaurant on Ontopo:');
  });

  it('drops the lines it has no fact for rather than printing a blank', () => {
    const { body } = buildReservationEmail({
      ...BOOKED,
      place: null,
      area: null,
      occasion: null,
      guestName: null,
      venuePageUrl: null,
    });

    expect(body).toContain('  Noema\n');
    expect(body).toContain('  Table for 2\n');
    expect(body).not.toContain('For \n');
    expect(body).not.toContain('—  ');
    expect(body).not.toContain('Under the name');
  });

  it('falls back to the bare time when the payload lost the readable date', () => {
    const mail = buildReservationEmail({ ...BOOKED, readableDate: null });

    expect(mail.subject).toBe('Booked — Noema, 20:30');
    expect(mail.body).toContain('  20:30');
  });
});

/**
 * The send path.
 *
 * Every assertion here is about a failure, save the first. The reservation has
 * already happened by the time this is called, so the only interesting question is
 * whether a broken mailbox can damage it — and the answer has to be no on all four
 * of the ways it can break.
 */
describe('sendReservationSummary', () => {
  type Mutable = Record<string, unknown>;

  const ctx: ToolContext = { sessionId: 'session-1', userId: 'user-1' };
  const originalIntegrations: Mutable = {};
  let originalDefaultEmail: string;

  const GOOGLE_KEYS = ['googleClientId', 'googleClientSecret', 'googleRefreshToken'] as const;

  beforeEach(() => {
    const integrations = config.integrations as unknown as Mutable;
    for (const key of GOOGLE_KEYS) originalIntegrations[key] = integrations[key];
    // Gmail ready: readiness is client id + secret + refresh token, all from config.
    integrations.googleClientId = 'client-id';
    integrations.googleClientSecret = 'client-secret';
    integrations.googleRefreshToken = 'refresh-token';

    originalDefaultEmail = config.reminders.defaultEmail;
    (config.reminders as unknown as Mutable).defaultEmail = 'owner@example.com';

    sendMessage.mockReset();
    sendMessage.mockResolvedValue({ id: 'message-1' });
  });

  afterEach(() => {
    const integrations = config.integrations as unknown as Mutable;
    for (const [key, value] of Object.entries(originalIntegrations)) integrations[key] = value;
    (config.reminders as unknown as Mutable).defaultEmail = originalDefaultEmail;
    vi.restoreAllMocks();
  });

  it('mails the built body to the deployment owner when Gmail is ready', async () => {
    const outcome = await sendReservationSummary(BOOKED, ctx);

    expect(outcome).toEqual({ sent: true, channel: 'gmail' });
    expect(sendMessage).toHaveBeenCalledWith({
      to: 'owner@example.com',
      subject: buildReservationEmail(BOOKED).subject,
      body: buildReservationEmail(BOOKED).body,
    });
  });

  it('writes the body to the log instead of sending when Gmail is dark', async () => {
    (config.integrations as unknown as Mutable).googleRefreshToken = undefined;

    const outcome = await sendReservationSummary(BOOKED, ctx);

    // Not `sent`, deliberately: only Gmail accepting a message id is a send, and the
    // reply's "I've emailed you" sentence hangs off this boolean.
    expect(outcome).toEqual({ sent: false, channel: 'log' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('reports a Gmail refusal rather than claiming the mail went', async () => {
    sendMessage.mockResolvedValue(null);

    expect(await sendReservationSummary(BOOKED, ctx)).toEqual({
      sent: false,
      channel: 'gmail',
    });
  });

  it('swallows a thrown send, because the table is already booked', async () => {
    sendMessage.mockRejectedValue(new Error('quota exceeded'));

    expect(await sendReservationSummary(BOOKED, ctx)).toEqual({
      sent: false,
      channel: 'gmail',
    });
  });

  it('says so when there is no usable address anywhere', async () => {
    (config.reminders as unknown as Mutable).defaultEmail = 'not-an-address';

    expect(await sendReservationSummary(BOOKED, ctx)).toEqual({
      sent: false,
      channel: 'none',
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
