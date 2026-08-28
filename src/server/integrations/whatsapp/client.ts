import { config } from '../../config';
import { renderTemplate, type WhatsappTemplate } from './templates';

/**
 * Transport for the WhatsApp Cloud API.
 *
 * `POST https://graph.facebook.com/{version}/{phone_number_id}/messages` with a
 * bearer token. No token exchange and no cache: the access token is a long-lived
 * system-user token supplied in the environment, so unlike Amadeus and Google
 * there is nothing to refresh. That also means there is nothing to rotate
 * automatically — a leaked WhatsApp token stays valid until a human revokes it,
 * which is worth knowing before it goes anywhere near a shared log.
 *
 * ## What this can and cannot send
 *
 * Templates only. See `./templates.ts` for why: every message Valentin sends is
 * business-initiated, and business-initiated messages outside a 24-hour reply
 * window must use pre-approved templates. There is deliberately no code path
 * here that sends a free-text `text` message — not because it would be hard, but
 * because it would appear to work in a test and fail in front of an audience.
 *
 * Knowing whether the 24-hour window is open would need inbound webhooks, and
 * this build has none. So the window is treated as always closed, which is the
 * safe assumption and costs nothing.
 *
 * ## Error reporting
 *
 * Graph returns `{error:{message, code, error_subcode, ...}}` with a 400. Two
 * codes are worth distinguishing because the fixes are completely different, and
 * {@link sendTemplate} reports them separately:
 *
 * - **131047** — outside the window with no template. Cannot happen here, and if
 *   it does, something is sending raw text.
 * - **132001** — the template does not exist or is not approved in that language.
 *   This is the expected failure until Meta review completes, and it is a
 *   configuration problem rather than a fault.
 *
 * Documented-correct, not observed-correct: this repo has no WhatsApp business
 * account, so no call here has met the live API.
 */

const GRAPH_VERSION = 'v23.0';
const TIMEOUT_MS = 10_000;

/** How long a proposed nudge stays confirmable. */
export const WHATSAPP_PROPOSAL_TTL_MS = 10 * 60 * 1000;

/** Why a send failed, in the terms that decide what to say about it. */
export type SendFailure = 'not-configured' | 'template-not-approved' | 'rejected' | 'unreachable';

export type SendResult =
  | { ok: true; messageId: string; rendered: string }
  | { ok: false; reason: SendFailure };

/**
 * Normalise a phone number to the digits-only E.164 form Graph expects.
 *
 * Accepts `+972 50-123-4567`, `0501234567` and `972501234567`. The leading-zero
 * case is the one that matters: an Israeli number written the way an Israeli
 * writes it has a trunk zero that is not part of the international number, and
 * sending `9720501234567` fails with an unhelpful error.
 *
 * Returns `null` rather than a best guess for anything else. A wrong number here
 * means a stranger receives a message about someone's anniversary.
 */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');

  if (digits.startsWith('+')) {
    const bare = digits.slice(1);
    return /^\d{8,15}$/.test(bare) ? bare : null;
  }

  // Local Israeli form: drop the trunk zero and prefix the country code.
  if (/^0\d{8,9}$/.test(digits)) return `972${digits.slice(1)}`;

  // Already international, without a plus.
  return /^\d{10,15}$/.test(digits) ? digits : null;
}

/**
 * Send one approved template.
 *
 * `rendered` on the success result is the sentence WhatsApp will have shown,
 * reconstructed locally — Graph does not echo the body back, and the caller wants
 * to be able to say what was sent rather than that "a message" was sent.
 */
export async function sendTemplate(
  to: string,
  template: WhatsappTemplate,
  values: readonly string[],
): Promise<SendResult> {
  const { whatsappPhoneNumberId, whatsappToken } = config.integrations;
  if (!whatsappPhoneNumberId || !whatsappToken) return { ok: false, reason: 'not-configured' };

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${whatsappPhoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${whatsappToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
          name: template.name,
          language: { code: template.language },
          components: [
            {
              type: 'body',
              parameters: values.map((text) => ({ type: 'text', text })),
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: { code?: unknown };
    };
    // 132001 is "no such approved template", which is the expected state until
    // Meta review finishes and is a different sentence to any other failure.
    if (body.error?.code === 132001) return { ok: false, reason: 'template-not-approved' };
    return { ok: false, reason: 'rejected' };
  }

  const body = (await response.json()) as { messages?: Array<{ id?: unknown }> };
  const messageId = body.messages?.[0]?.id;
  if (typeof messageId !== 'string') return { ok: false, reason: 'unreachable' };

  return { ok: true, messageId, rendered: renderTemplate(template, values) };
}
