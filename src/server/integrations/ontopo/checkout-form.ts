import { logger } from '../../logging';
import { withPage, BROWSER_NAV_TIMEOUT_MS, type BrowserPage } from '../browser/session';

/**
 * Finishing an Ontopo reservation by driving its checkout form.
 *
 * ### Why this exists
 *
 * Ontopo has no booking API. `createCheckout` mints a URL and that URL is a
 * two-step web form — accept the dining terms, then supply a name, email and
 * phone — and until that form is submitted no table is held. So for a long time
 * `confirm` handed the link over and stopped, and a booking took a human pressing
 * Confirm *and then* filling in a form on their phone. The first half of that is
 * authority; the second half is typing.
 *
 * This module removes the typing. It is the same sequence of clicks a person
 * performs, in the same public page, with the guest identity from config.
 *
 * ### What it does not change
 *
 * **The human gate is untouched.** `confirm` runs only after somebody pressed
 * Confirm on the proposal card, and this is called from inside `confirm`. Nothing
 * here lets the model book a table on its own initiative — it lets an already
 * authorised booking finish without a second manual step.
 *
 * ### Why the failure mode matters more than the success one
 *
 * A form driver against someone else's markup is the most breakable thing in this
 * codebase: a renamed placeholder and it stops working. So every failure here is
 * reported as "not booked, here is the link" rather than thrown, and the caller
 * always keeps the checkout URL. A broken selector costs the automation, not the
 * reservation — the user finishes on the link exactly as they did before. The one
 * thing this must never do is report a booking it did not make, which is why
 * success requires seeing Ontopo's own confirmation text and nothing less.
 */

/** Who to put on the reservation. Every field is required by Ontopo's form. */
export interface CheckoutGuest {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface CheckoutOutcome {
  /** True only when Ontopo displayed its own booking confirmation. */
  booked: boolean;
  /** Why it did not complete, in words that can be shown to a user. */
  reason?: string;
  /** The name the table ended up under, for the confirmation message. */
  guestName?: string;
}

/**
 * How long to wait for any one element on the checkout.
 *
 * Shorter than the navigation timeout on purpose. The steps are cheap and local
 * once the page is up, and a step that has not appeared in eight seconds means the
 * markup moved rather than that the network is slow.
 */
const STEP_TIMEOUT_MS = 8000;

/** Ontopo's own words on a completed booking. Seeing this is the only success. */
const CONFIRMATION_TEXT = 'Thank you for booking';

/**
 * Click something that may legitimately not be there.
 *
 * The cookie banner appears once per browser profile and the "click this button"
 * nudge on step 2 is intermittent, so neither can be waited on — but both sit on
 * top of the control we actually want and swallow the click if ignored.
 */
async function clickIfPresent(page: BrowserPage, role: string, name: string): Promise<void> {
  try {
    const target = page.getByRole(role, { name }).first();
    if (await target.isVisible()) await target.click({ timeout: STEP_TIMEOUT_MS });
  } catch {
    // Absent, or vanished between the check and the click. Either way, move on.
  }
}

/**
 * Fill the contact step.
 *
 * Located by placeholder because that is the only stable handle Ontopo gives these
 * inputs — they carry no name, id, label or test id, so a positional or structural
 * selector would break on any layout change and a placeholder at least breaks
 * loudly and only when the visible text changes.
 */
async function fillContactInfo(page: BrowserPage, guest: CheckoutGuest): Promise<void> {
  const fields: ReadonlyArray<[string, string]> = [
    ['First name', guest.firstName],
    ['Last name', guest.lastName],
    ['Email', guest.email],
    ['Phone', guest.phone],
  ];

  for (const [placeholder, value] of fields) {
    const field = page.getByPlaceholder(placeholder).first();
    await field.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    await field.fill(value);
  }
}

/** Whether Ontopo is showing its post-booking confirmation. */
async function isConfirmed(page: BrowserPage): Promise<boolean> {
  try {
    const banner = page.getByText(CONFIRMATION_TEXT).first();
    await banner.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

/**
 * Complete a minted checkout, and say honestly whether a table was booked.
 *
 * Never throws. A browser that is missing, busy, or defeated by changed markup all
 * come back as `booked: false` with a reason, because the caller's fallback — hand
 * over the link — is correct for all of them.
 */
export async function completeCheckout(
  checkoutUrl: string,
  guest: CheckoutGuest,
): Promise<CheckoutOutcome> {
  const guestName = `${guest.firstName} ${guest.lastName}`.trim();
  const startedAt = Date.now();

  try {
    return await withPage(async (page) => {
      await page.goto(checkoutUrl, {
        waitUntil: 'domcontentloaded',
        timeout: BROWSER_NAV_TIMEOUT_MS,
      });

      // Step 1: the dining terms. The consent banner covers the checkbox.
      await clickIfPresent(page, 'button', 'Accept all');

      const terms = page.getByText('I have read and accept the').first();
      await terms.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
      await terms.click({ timeout: STEP_TIMEOUT_MS });

      const next = page.getByRole('button', { name: 'Next' }).first();
      await next.click({ timeout: STEP_TIMEOUT_MS });

      // Step 1 continued: contact info replaces the terms in the same panel.
      await fillContactInfo(page, guest);
      await page.getByRole('button', { name: 'Next' }).first().click({ timeout: STEP_TIMEOUT_MS });

      // Step 2: review, then commit. The nudge overlay intercepts Done if shown.
      await clickIfPresent(page, 'button', 'Ok');

      const done = page.getByRole('button', { name: 'Done' }).first();
      await done.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
      await done.click({ timeout: STEP_TIMEOUT_MS });

      const booked = await isConfirmed(page);
      logger.info('ontopo.checkout-completed', {
        booked,
        durationMs: Date.now() - startedAt,
      });

      if (!booked) {
        return {
          booked: false,
          reason:
            'Ontopo did not show a booking confirmation after the form was submitted',
          guestName,
        };
      }
      return { booked: true, guestName };
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn('ontopo.checkout-failed', {
      cause: reason.slice(0, 200),
      durationMs: Date.now() - startedAt,
    });
    return { booked: false, reason, guestName };
  }
}
