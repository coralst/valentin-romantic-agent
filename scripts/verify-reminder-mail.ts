#!/usr/bin/env npx tsx
/**
 * Arm a reminder, let the sweeper fire it, then ask Gmail whether the mail arrived.
 *
 *   npx tsx scripts/verify-reminder-mail.ts                    # 5 days out, sends now
 *   npx tsx scripts/verify-reminder-mail.ts --days=8            # arms for 08:30 tomorrow
 *   npx tsx scripts/verify-reminder-mail.ts --to=you@example.com
 *   npx tsx scripts/verify-reminder-mail.ts --dry-run           # compose only, send nothing
 *
 * ### Why this exists
 *
 * The unit suite proves the reminder is planned at the right minute and that the body
 * says the right things, and `reminder.sent` in the log proves the dispatcher thought
 * it sent something. None of that is the claim the demo actually makes, which is that
 * a mail is sitting in an inbox. A reminder is the one message this system sends with
 * nobody watching, so "did it arrive" is the one thing that cannot be verified by
 * reading code — and until this script existed the answer came from somebody opening
 * Gmail and saying yes.
 *
 * So this walks the real path end to end: seed a profile, `syncReminders` to arm the
 * row, one `dispatchDue` sweep through the real `gmailSender`, then `findSentMessages`
 * against the mailbox to find the message by its subject. It reports what it found,
 * including the snippet, or it names precisely what was missing.
 *
 * ### What is real here and what is not
 *
 * Real: the planner, the arming, the due-index query, the claim, the composed body,
 * the Gmail send, and the mailbox read. Every restaurant in the mail is a curated
 * Ontopo venue with a live booking slug.
 *
 * Not real: the *store*. This uses `InMemoryStoreFactory` rather than DynamoDB, because
 * what is under test is the send path and not the table — and pointing it at a real
 * table would leave a fabricated profile and a sent-reminder row behind in whatever
 * environment it ran against. The reminder row it sweeps is written by the same
 * `syncReminders` the server calls on every extraction.
 *
 * Also not real: the clock. `--days` moves the *occasion*, not the current time, so the
 * lead-window arithmetic runs against a genuine `new Date()`.
 *
 * ### It sends a real email
 *
 * Unlike `prove-integrations.mts`, which deliberately stops at a proposal, this one has
 * to send: a message that was never sent cannot be found in a mailbox. That is the whole
 * point, and it is why `--to` defaults to the account's own address — the demo account
 * mailing itself. `--dry-run` composes and prints without sending, for checking the body.
 */
import { config } from '../src/server/config';
import { integrationReadiness } from '../src/server/integrations';
import { findSentMessages, type FoundMessage } from '../src/server/integrations/google/client';
import { InMemoryStoreFactory } from '../src/server/persistence/in-memory-store';
import { dispatchDue } from '../src/server/reminders/dispatcher';
import { syncReminders } from '../src/server/reminders/reminder-sync';
import { resolveSender, type ReminderSender } from '../src/server/reminders/sender';
import { reminderContextFor } from '../src/server/reminders/suggestions';
import type { ReminderEmail } from '../src/server/reminders/email-body';

/** How long Gmail may take to index a message it has already accepted. */
const POLL_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 5_000;

function flag(name: string): string | undefined {
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const DRY_RUN = process.argv.includes('--dry-run');
const DAYS_OUT = Number(flag('days') ?? 5);
const TO = flag('to') ?? process.env.PROOF_EMAIL ?? '';

/**
 * A tag in the occasion, so the mailbox search can find *this* run's message.
 *
 * It ends up in the subject line, which is a small cost for the thing it buys: without
 * it a search for "anniversary" matches every previous verification run and the script
 * would happily report yesterday's mail as today's proof.
 */
const RUN_TAG = `v${Date.now().toString(36).slice(-5)}`;
const OCCASION = `our third anniversary (${RUN_TAG})`;

/** `YYYY-MM-DD`, `days` from now, in the process's own calendar. */
function occursOn(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/** The profile a first-run user would have after the intake questions. */
const PROFILE: Record<string, string> = {
  partner_name: 'Maya',
  favorite_cuisine: 'Mediterranean',
  restaurant_style: 'Romantic & quiet',
  home_city: 'Tel Aviv',
  music_genre: 'Nina Simone',
  weekly_rhythm: 'Tue@pottery until nine@heavy, Fri@she finishes at five@medium',
};

/** Keeps what was handed to the channel, so the body can be printed either way. */
function recording(inner: ReminderSender | null): ReminderSender & { sent: ReminderEmail[] } {
  return {
    channel: inner?.channel ?? 'dry-run',
    sent: [] as ReminderEmail[],
    async send(to: string, email: ReminderEmail) {
      this.sent.push(email);
      if (inner) await inner.send(to, email);
    },
  };
}

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<number> {
  const ready = integrationReadiness();
  if (!DRY_RUN && !ready.gmail) {
    say('✗ Gmail is not configured, so nothing can be sent or read.');
    say('  Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN, or');
    say('  connect Google in the integrations panel, then re-run.');
    return 1;
  }
  if (!DRY_RUN && !TO) {
    say('✗ No recipient. Pass --to=you@example.com (or set PROOF_EMAIL).');
    say('  Use the demo account, not a personal mailbox: this sends a real email.');
    return 1;
  }

  const now = new Date();
  const occasion = occursOn(DAYS_OUT);

  // The same store the server uses in tests, and the same two calls the server makes:
  // write the profile, then sync. Nothing here reaches for a reminder row directly.
  const factory = new InMemoryStoreFactory();
  const store = factory.forUser('verify-user');
  const sessionId = await store.createSession();
  for (const [fieldId, value] of Object.entries({
    ...PROFILE,
    next_occasion: `${occasion}@${OCCASION}`,
    notify_email: TO || 'nobody@example.test',
  })) {
    await store.savePreference({
      sessionId,
      category: 'important_dates',
      key: fieldId,
      fieldId,
      value,
      confidence: 0.9,
      sourceMessageId: 'verify',
    });
  }

  await syncReminders(store, sessionId, now);
  const [armed] = await store.getRemindersBySession(sessionId);
  if (!armed) {
    say(`✗ Nothing was armed for an occasion ${DAYS_OUT} days out. The planner refused it.`);
    return 1;
  }

  say(`Occasion  ${occasion} — "${OCCASION}", ${DAYS_OUT} days out`);
  say(`Armed     lead ${armed.leadDays}d, due ${armed.dueAt}, channel ${armed.channel}`);

  const dueNow = new Date(armed.dueAt).getTime() <= now.getTime();
  say(
    dueNow
      ? '          due already — inside the lead window, so this sweep sends it'
      : '          not due yet — this is the "8 days out fires tomorrow at 08:30" case',
  );

  const sender = recording(DRY_RUN ? null : resolveSender('gmail'));
  const summary = await dispatchDue(factory, sender, now, {
    origin: config.publicOrigin,
    context: (reminder) => reminderContextFor(factory.forUser(reminder.userId), reminder),
  });
  say(
    `Sweep     considered ${summary.considered}, sent ${summary.sent}, ` +
      `skipped ${summary.skipped}, failed ${summary.failed}`,
  );

  if (sender.sent.length > 0) {
    say('');
    say(`Subject   ${sender.sent[0].subject}`);
    say('');
    say(sender.sent[0].body.replace(/^/gm, '  '));
    say('');
  }

  if (DRY_RUN) {
    say('— dry run: nothing was sent, so there is nothing to look for.');
    return 0;
  }

  if (!dueNow) {
    // Not a failure: this is the timing the demo shows off, and the mail is genuinely
    // supposed to arrive tomorrow morning. Re-running with --days=5 proves the send.
    say(`— armed for ${armed.dueAt}. Re-run with --days=5 to verify a send now.`);
    return 0;
  }
  if (summary.sent !== 1) {
    say('✗ The sweep did not send. See reminder.send_failed above for the reason.');
    return 1;
  }

  // Gmail's send call has returned an id by now, but `messages.list` is eventually
  // consistent against its index — a search a second after the send routinely misses.
  const query = `in:sent newer_than:1d "${RUN_TAG}"`;
  say(`Searching ${query}`);

  let found: FoundMessage[] | null = null;
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    found = await findSentMessages(query, 5);
    if (found === null || found.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    say(`          not indexed yet (${attempt}/${POLL_ATTEMPTS})…`);
  }

  if (found === null) {
    /*
     * The distinction this whole `null` return exists for. An empty result and an
     * unreadable mailbox look identical from a caller that only has an array, and they
     * mean opposite things — one says the reminder never arrived, the other says the
     * token predates `gmail.readonly`. Reporting the second as the first would send
     * somebody debugging the dispatcher over a permissions problem.
     */
    say('');
    say('! The mail was sent, but this token cannot read the mailbox, so arrival is');
    say('  unconfirmed. Google mints scopes at consent time, so an existing refresh');
    say('  token does not gain gmail.readonly — reconnect Google once in the');
    say('  integrations panel (Disconnect, then Connect) and re-run.');
    return 2;
  }

  if (found.length === 0) {
    say('');
    say('✗ Gmail accepted the message but it is not in the mailbox. Check the Sent');
    say('  folder by hand before trusting this — indexing can exceed 30 seconds.');
    return 1;
  }

  say('');
  for (const message of found) {
    say(`✓ In the mailbox — ${message.sentAt}`);
    say(`  id       ${message.id}`);
    say(`  to       ${message.to}`);
    say(`  subject  ${message.subject}`);
    say(`  snippet  ${message.snippet}`);
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    say(`✗ ${error instanceof Error ? error.stack : String(error)}`);
    process.exit(1);
  },
);
