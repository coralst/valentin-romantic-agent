/**
 * Drives the whole demo through the real UI at human speed, for an audience.
 *
 * ## Why this is not `drive-chat.ts`
 *
 * `drive-chat.ts` exists to make screenshots have content in them: it runs
 * headless, `fill()`s two turns instantly and waits a flat 14 seconds. That is
 * correct for its job and useless for this one. This script is meant to be
 * *watched* — so it runs headed, moves a visible pointer along an eased path,
 * types one character at a time with the pauses a person makes, and waits for
 * Valentin to actually finish talking before reading his answer and replying.
 * Neither script should grow into the other; they are optimising for opposite
 * things (throughput vs. legibility).
 *
 * ## The four acts
 *
 * 1. **The entrance.** Three beats: the landing page, the way in, the empty profile.
 * 2. **The conversation.** Everything else the product does, in one unbroken thread —
 *    the facts land, the inspector opens and stays open, the same question is asked on
 *    both engines, the calendar and Ontopo and Spotify are called for real, and the
 *    last thing it does is *post a letter*. Act 2 ends when the sweep sends the mail.
 * 3. **The inbox.** His actual Gmail, opened in the same browser: the confirmation of
 *    the restaurant he chose, and the surprise playlist link at the bottom of it.
 * 4. **The day-after survey**, which is the one substituted beat (see below).
 *
 * ## What is real here
 *
 * All of it, with one marked exception. The conversation goes through the live
 * websocket to the live model; extraction writes real rows; the reminder is armed
 * by the real planner and swept by the real 60-second scheduler; **the email is
 * really sent** by `gmailSender` and then really read out of the inbox.
 *
 * ## The four marked inspection moments
 *
 * The drawer is opened once, early, and never closed — and at four points the caption
 * turns blue to say *this is the bit to look at*. Each one is read off the screen and
 * then **asserted**, so a take in which the claim was not true stops rather than
 * shipping: (1) engine A spends two Bedrock calls on one turn, (2) that call replayed
 * hop by hop, (3) engine B spends none on extraction, (4) one `check_availability`
 * span per restaurant offered, with a real clock time in the reply.
 *
 * The exception is act 4, the day-after survey, and the script says so on screen while
 * it happens rather than letting it pass as real — an amber caption, for the whole beat.
 * See {@link theSurvey}.
 *
 * ## The address
 *
 * `--to` is required and is never defaulted or assembled. This script sends mail
 * to a real inbox; guessing which one is the single mistake here that reaches a
 * stranger, and it cannot be un-sent.
 *
 * ## Recording it
 *
 * `--record` turns the same run into a video (`screenshots/demo/video/`). It also
 * switches the browser to headless, which is not a detail: the pointer, the
 * captions and the click rings are all drawn *into the page* by {@link OVERLAY},
 * so the recording is identical either way — and a twenty-minute headed run owns
 * the machine's screen for twenty minutes. `--record --headed` if you want to
 * watch it being made.
 *
 * ## Reading the inbox needs a signed-in browser profile
 *
 * Act 3 opens `mail.google.com` in the same browser, which only works if that browser
 * is already signed in — a fresh Playwright profile cannot pass Google's 2FA, and
 * scripting a password into it would be both fragile and a bad idea. So the whole run
 * uses a **persistent** profile at {@link USER_DATA_DIR}, and there is a one-time
 * setup pass that opens Gmail and waits for a human:
 *
 *   npm run demo:drive -- --gmail-login     # sign in once, by hand, then close it
 *
 * A run whose profile is not signed in does not fail: act 3 captions itself as skipped
 * and says which command to run. That is deliberate — a missing inbox beat costs one
 * act, and a take that dies at minute eighteen costs the whole recording.
 *
 * Usage:
 *   npm run demo:drive -- --to=you@example.com
 *   npm run demo:drive -- --to=you@example.com --speed=1.6   # rehearse faster
 *   npm run demo:drive -- --to=you@example.com --no-mail     # skip the send beat
 *   npm run demo:drive -- --to=you@example.com --no-inbox    # skip act 3
 *   npm run demo:drive -- --to=you@example.com --record      # write a video too
 */
import { chromium, type Page, type Locator, type BrowserContext } from '@playwright/test';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';

function flag(name: string): string | undefined {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
const has = (name: string) => process.argv.includes(`--${name}`);

const BASE = flag('base') ?? 'http://localhost:5273';
const TO = flag('to') ?? '';
/** Everything human-paced divides by this. 1 is presentation speed. */
const SPEED = Math.max(0.2, Number(flag('speed') ?? 1));
const SEND_MAIL = !has('no-mail');
const DO_SURVEY = !has('no-survey');
/** Act 3. Pointless with nothing sent, so it follows the mail beat. */
const DO_INBOX = SEND_MAIL && !has('no-inbox');
/** Open Gmail, wait for a human to sign in, and exit. One-time setup. */
const GMAIL_LOGIN = has('gmail-login');
/**
 * The browser profile the run reuses, so act 3 can open a signed-in Gmail.
 *
 * Outside `SHOT_DIR` on purpose: that directory is deleted at the start of every run
 * (see `main`), and a run that wipes its own Google session would put the sign-in back
 * in front of the audience every time.
 */
const USER_DATA_DIR = path.resolve(flag('profile-dir') ?? '.demo-chrome-profile');
const SHOT_DIR = path.resolve('screenshots/demo');
const VIDEO_DIR = path.join(SHOT_DIR, 'video');
/** Write a video of the run as well as the stills. */
const RECORD = has('record');
/**
 * Show the browser window.
 *
 * On by default because this script exists to be watched. A recording run is the
 * exception: the overlay is DOM, so headless records the same frames, and there is
 * no reason to hold someone's screen hostage for a file.
 */
const HEADED = !RECORD || has('headed');

/**
 * The step-forward control's accessible name, copied from `DRAWER_COPY.next`.
 *
 * Duplicated rather than imported: this is a `tsx`-run script outside the app's
 * module graph, and importing a component module to read one string would drag
 * React and the design system into a driver that has no DOM. If the drawer renames
 * the button, the inspector beat stops stepping and says so in the log — a visible,
 * harmless failure, which is the trade being made here.
 */
const DRAWER_COPY_NEXT = 'Next step';

/** How long to wait for one model turn before giving up on the whole run. */
const REPLY_TIMEOUT_MS = 90_000;
/** The scheduler's sweep interval, plus room for the send itself. */
const SWEEP_WAIT_MS = 95_000;

/**
 * The anniversary the demo plans for — computed at launch, never hardcoded.
 *
 * The script used to say "10 September", which was true for exactly the week it
 * was written in: run after the 10th, the model is being handed a date in the
 * past, and everything downstream — the countdown, the reminder arming, "find a
 * table that evening" — is planning for a day that already happened.
 *
 * ## Why a Thursday, and why *more* than a week out
 *
 * A Thursday because the kitchens worth booking are open on one (most are shut for
 * Shabbat on Friday and Saturday, and the model would rightly spend the turn saying
 * so instead of playing the beat).
 *
 * More than a week out because of the order act 2 has to run in, and this is the
 * single most load-bearing number in the script. `leadTimeDays` defaults to **a
 * week**, and `syncReminders` arms the reminder the moment the anniversary lands on
 * the profile — which is turn 1. So on the old four-to-six-days-out date the row was
 * *already overdue* before anything had been booked, and `scheduler.ts` sweeps every
 * 60 seconds: the mail went out about ninety seconds into the conversation, naming no
 * restaurant and carrying no playlist, because neither existed yet.
 *
 * Held outside the lead window, the row is planned and simply not due, all the way
 * through the booking and the playlist. The closing turn then asks for a *fortnight's*
 * notice — a real option in `REMINDER_LEAD_OPTIONS`, not a demo hook — the planner
 * re-plans the row, the due instant lands in the past, and the very next sweep sends
 * it. The mail then has a confirmed venue and a saved playlist to talk about because
 * both happened before it was asked for.
 *
 * {@link LEAD_FLOOR_DAYS} is that week, plus a day so a run that straddles midnight
 * cannot drift into the window on its own.
 */
const LEAD_FLOOR_DAYS = 8;

function pickOccasion(): { iso: string; dayMonth: string; ordinal: string; weekday: string } {
  for (let offset = LEAD_FLOOR_DAYS; offset <= LEAD_FLOOR_DAYS + 7; offset++) {
    const when = new Date(Date.now() + offset * 86_400_000);
    const weekday = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jerusalem',
      weekday: 'long',
    }).format(when);
    /*
     * A Thursday if the window holds one, and it always does — the window is eight
     * consecutive days. The other weekdays are kept as a fallback rather than a
     * `throw`, because "no Thursday" is not a state worth failing a recording over.
     */
    if (weekday !== 'Thursday' && offset < LEAD_FLOOR_DAYS + 7) continue;
    if (weekday === 'Friday' || weekday === 'Saturday') continue;
    const iso = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(when);
    const day = Number(iso.slice(8, 10));
    const month = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jerusalem',
      month: 'long',
    }).format(when);
    const tens = Math.floor((day % 100) / 10);
    const suffix = tens === 1 ? 'th' : (['th', 'st', 'nd', 'rd'][day % 10] ?? 'th');
    return { iso, dayMonth: `${day} ${month}`, ordinal: `${day}${suffix}`, weekday };
  }
  throw new Error('unreachable: an eight-day window contains a Thursday');
}
const OCCASION = pickOccasion();

/** Whole days from today to the occasion, in the reminder's own zone. */
function daysToOccasion(): number {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [ty, tm, td] = today.split('-').map(Number);
  const [oy, om, od] = OCCASION.iso.split('-').map(Number);
  return Math.round((Date.UTC(oy, om - 1, od) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
}

/**
 * The notice asked for in the closing turn, and how overdue that makes the row.
 *
 * A fortnight, because that is the smallest option in `REMINDER_LEAD_OPTIONS` that is
 * larger than {@link LEAD_FLOOR_DAYS} — so it is guaranteed to put the due instant in
 * the past, which is what makes the next sweep send. Computed rather than written into
 * a caption for the usual reason: "four days overdue" is a sentence that goes stale on
 * the day someone runs this at a different distance from the date.
 */
const CLOSING_LEAD_DAYS = 14;
const OVERDUE_DAYS = CLOSING_LEAD_DAYS - daysToOccasion();

/** Weekday names, for the wrong-weekday assertion. */
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Scale a duration by `--speed`. */
const paced = (ms: number) => Math.round(ms / SPEED);
/** `base` ± half of `spread`, scaled. Keeps every pause from being identical. */
const jitter = (base: number, spread: number) =>
  paced(base + Math.random() * spread - spread / 2);

interface Turn {
  /**
   * Exactly what gets typed. Asserted against the composer before sending.
   *
   * A function when the line has to quote the app back to itself — the booking turn
   * has to name one of the hours Ontopo actually returned, and neither a fixed hour
   * nor a vague "one of the times you found" will do: the first can contradict real
   * availability on camera, and the second makes the agent quite rightly ask which
   * one, which is a correct answer to a badly written script.
   */
  say: string | ((previousReply: string) => string);
  /** The on-screen caption while this turn is in flight. */
  beat: string;
  /**
   * Type a wrong character and correct it partway through this line.
   *
   * Only on lines where a stumble reads as natural, and never near the end —
   * the composer is checked against `say` before Enter, so a correction that
   * failed to land stops the run instead of sending mangled text at the model.
   */
  stumble?: boolean;
  /**
   * Drop this turn under `--no-mail`.
   *
   * Load-bearing on the address turn, not just the "send it" turn. The reminder
   * is armed by the *facts* — an anniversary five days out is inside the lead
   * window the moment it is learned — so skipping only the "yes, send me the
   * proposal" line would still leave a due reminder with a real target on it,
   * and the sweeper would mail it within the minute. `--no-mail` has to withhold
   * `notify_email` to mean anything, and then `dispatcher.ts` skips the row on a
   * missing target *without* claiming it, so nothing is burned.
   */
  needsMail?: boolean;
  /**
   * Expect this turn to raise a proposal card, and press Confirm on it.
   *
   * Best-effort by design — see {@link confirmProposal}. Whether the model reaches
   * for `propose_reservation` on a given run is the model's call, and a run that
   * stops because it chose to ask a clarifying question first would be reporting a
   * scripting failure as a product failure.
   */
  confirms?: boolean;
  /**
   * The reply must match every one of these, or the take FAILS.
   *
   * These are the run's own review pass. A recorded take where the model was
   * asked about restaurants and answered about Nina Simone looked fine to every
   * "did a reply arrive" check and was only caught by a human watching the
   * video afterwards. The script now watches for exactly that class of failure
   * and stops the take, because a wrong take discovered at recording time costs
   * a re-run; discovered afterwards it costs the demo.
   */
  replyMust?: RegExp[];
  /** The reply must match none of these, or the take fails. Same contract. */
  replyMustNot?: RegExp[];
  /**
   * If the reply names any weekday at all, this one must be among them.
   *
   * Softer than a mustNot on the six wrong days: a reply may legitimately
   * mention Friday while talking about Shabbat. What it must never do is the
   * recorded failure — call the date "this coming Wednesday" when the day is a
   * Thursday, and have nobody notice until the video was reviewed.
   */
  expectWeekday?: string;
}

/**
 * A turn whose line is settled — `say` resolved against the reply before it.
 *
 * Everything downstream of the resolution (typing, the composer check, the reply
 * assertions, the proposal's name) works on this rather than on {@link Turn}, so a
 * `say` that is still a function cannot reach the keyboard.
 */
type SpokenTurn = Turn & { say: string };

/**
 * Whether a reply has already offered several named options.
 *
 * Two shapes, because the model uses both: markdown bullets, and prose with the
 * names in bold ("**Hotel Montefiore** is the standout…"). Two is the threshold —
 * one bold phrase is emphasis, several are a shortlist.
 *
 * Deliberately shallow. It decides which of two *phrasings* a turn types, so being
 * wrong costs a slightly odd line and not a false claim; anything cleverer would be
 * a parser for prose, which is a thing that quietly stops working.
 */
function looksLikeAList(reply: string): boolean {
  const bullets = reply.match(/^\s*[-*•]\s+\S/gm)?.length ?? 0;
  const bolded = reply.match(/\*\*[^*\n]{3,60}\*\*/g)?.length ?? 0;
  return bullets >= 2 || bolded >= 2;
}

/**
 * The conversation, in the order the rail fills up on camera.
 *
 * ## Why it is in two halves
 *
 * Every line here is fixed, and the model's are not — so a line that does not
 * *fit* whatever Valentin just asked makes **him** look like the one who lost the
 * thread. That is what happened on stage: naming the city and the cuisine in the
 * third breath got him searching restaurants and offering a shortlist, and the
 * four remaining profile facts then arrived as answers to a question nobody had
 * asked. He kept politely steering back to Wednesday and the script kept
 * ignoring him.
 *
 * So: **all the facts first, planning second.** Nothing before the halfway line
 * invites a recommendation — the city, which is what makes a shortlist possible,
 * is held back and arrives *with* the question that asks for one. The opening
 * line says outright that the details come before the plan, which is both a real
 * thing a person would say and the cheapest way to keep him gathering rather than
 * proposing. Later facts open with a connective ("Also", "One more thing") so
 * that even if he does end a turn with a question, volunteering the next fact
 * reads as a person adding to a list rather than as a non-answer.
 *
 * `weekly_rhythm` is late for a reason of its own: "she finishes work at 17:00" is
 * quoted back verbatim in the mail, so it should still be in the audience's mind when
 * the mail appears. The address and everything about timing are later still, in
 * {@link CLOSING_TURNS} — see that block for why they cannot be here.
 */
const PROFILE_TURNS: Turn[] = [
  {
    say: "Hi! Let me get her details down first, then we'll talk about the evening. " +
      `Her name is Maya, and our third anniversary is on ${OCCASION.dayMonth}.`,
    beat: 'Her name and the date — the rail starts counting down',
    // The recorded failure: told the date on a Saturday five days before it, the
    // model called Thursday "this coming Wednesday". The server now computes the
    // weekday into the prompt; this asserts the fix held on camera.
    expectWeekday: OCCASION.weekday,
  },
  {
    say: 'Her birthday is 2 March.',
    beat: 'Her birthday — every deadline in the rail keys off this',
  },
  {
    say: "She loves Mediterranean food — but no shellfish, she's allergic.",
    beat: 'What she eats, and the constraint any shortlist has to respect',
    stumble: true,
  },
  {
    say: 'One more thing for her file — she hates loud rooms. Quiet and candlelit is much ' +
      "more her. Don't suggest anywhere yet, I'll ask when her file is done.",
    beat: 'The kind of room — atmosphere, kept separate from cuisine',
    /*
     * Says "not yet" out loud, because the assertion below had no right to expect it.
     *
     * Even worded purely as a fact, this turn is the point where he has enough about
     * her to be *useful*, and an assistant that offers is behaving well: the take died
     * here on a reply that noted the preference and then volunteered five Tel Aviv
     * rooms. Asserting against an eagerness the script never asked him to restrain is
     * testing the model for the script's omission — the same mistake as three earlier
     * failures. With the line explicit, the assertion means something: it now checks
     * that a stated "not yet" is honoured.
     */
    // A stated preference is a fact to file, not a search brief. The recorded
    // run answered this with five restaurants nobody asked for, and the
    // unanswered offer then dominated every later turn.
    //
    // The line is worded as a fact on purpose. It used to read "Also, somewhere
    // quiet and romantic" — which is a venue brief in anyone's reading, so a
    // shortlist was the *right* answer to it and the assertion below was
    // failing the model for the script's ambiguity. Nothing about the demo
    // needs this beat to be a request: its job is to show atmosphere landing on
    // the profile separately from cuisine.
    replyMustNot: [/Montefiore|Yaffo Tel Aviv|NOEMA|Brasserie|Matteo/i, /here are (a )?(few|five|four|three|some)/i],
  },
  {
    say: "She's obsessed with Nina Simone — jazz generally, really.",
    beat: 'Her music — this is the row Spotify reads later',
    // The reply must engage with the music, not drag the conversation back to a
    // shortlist ("Back to Wednesday: are any of those five speaking to you?").
    replyMust: [/nina|jazz|music/i],
    replyMustNot: [/restaurant|shortlist|Montefiore|Yaffo Tel Aviv|NOEMA|Brasserie|Matteo/i],
  },
  {
    say: 'One more thing — she does pottery on Tuesdays, and on Fridays she finishes work at 17:00.',
    beat: 'Her week — "finishes work at 17:00" is quoted verbatim in the mail',
    stumble: true,
  },
  {
    say: "That's her, then. We're in Tel Aviv.",
    beat: 'The city arrives last — it is what makes a shortlist possible',
  },
];

/**
 * The last three turns of act 2: where to write, and when.
 *
 * Held back to the very end, after the table is booked and the playlist is saved, and
 * the reason is {@link LEAD_FLOOR_DAYS}: these are the turns that make the reminder
 * *due*. Asked any earlier, the sweep fires while the conversation is still gathering
 * facts and the mail goes out with nothing in it to confirm.
 *
 * So the order is exact. The address first, because a row that comes due with no target
 * is skipped without being claimed and would need a second sweep. Then the question
 * about notice, which is a real question — the answer comes off
 * `REMINDER_LEAD_OPTIONS`, not out of the model. Then the change to a fortnight, which
 * re-plans the row into the past and hands it to the next sweep.
 */
const CLOSING_TURNS: Turn[] = [
  {
    say: `And send reminders to ${TO}.`,
    beat: 'His own address — the one field Valentin will never invent',
    needsMail: true,
  },
  {
    say: 'How far in advance do you normally give me a heads-up before a date like this?',
    beat: 'A real question about a real setting — the answer is a stored option',
    replyMust: [/week|day|notice|advance|remind/i],
  },
  {
    /*
     * A fortnight, not "five days": `REMINDER_LEAD_OPTIONS` holds Same day / 1 day /
     * 3 days / 1 week / 2 weeks / 1 month, and `leadTimeDays` silently falls back to a
     * week for anything else — so asking for five days would look like it worked, park
     * the row a week out, and never come due on camera. Two weeks is the smallest
     * option that puts the due instant behind us.
     */
    say: 'Make it two weeks before, from now on — I want time to actually plan something.',
    beat: 'Two weeks of notice — which means this one is already overdue',
    needsMail: true,
    replyMust: [/two weeks|fortnight|14 days/i],
  },
];

/**
 * The planning half: the turns that make him *do* something outside the app.
 *
 * Split out from {@link PROFILE_TURNS} for the reason that half is ordered the way
 * it is — nothing here can be asked until the profile exists, because every one of
 * these calls is parameterised by a fact he was told. The shortlist respects the
 * shellfish allergy, the playlist comes off `music`, the clash check is against the
 * anniversary date. Asked in the other order they are three generic API calls with
 * a chat window around them.
 *
 * They also run *after* the mail beat rather than before it, which is not a
 * cosmetic choice: the reminder is armed the moment the anniversary is learned, and
 * the scheduler sweeps every 60 seconds. Any beat placed between the arming and the
 * sweep means the mail has already gone by the time the run announces it is waiting
 * for it — so the wait is taken first, while the conversation is still short, and
 * the audience sees the sweep fire rather than being told it fired earlier.
 *
 * `confirms` is the point of the last two. A search is a read and reads are cheap;
 * the interesting claim this product makes is that **nothing is written without a
 * human pressing Confirm**, and that is only visible if someone presses it.
 */
const PLAN_TURNS: Turn[] = [
  {
    say: `Before we book anything — what's already in my calendar around the ${OCCASION.ordinal}? ` +
      "I don't want to double-book that evening.",
    beat: 'Google Calendar, read-only — checking for a clash before proposing a thing',
    replyMust: [/calendar|clash|clear|free|nothing|event|booked/i],
  },
  {
    /*
     * Asks for the *times*, in so many words.
     *
     * "Find us a table" alone reliably produced a shortlist of five real Tel Aviv rooms
     * and not one clock time: `find_restaurants` answers that question completely, so
     * `check_availability` never ran and there was nothing for inspection moment 4 to
     * count. The take failed on an assertion the script had no right to make.
     *
     * Naming the hours is also the more honest version of the beat. The claim being
     * demonstrated is that a time on screen was fetched rather than remembered — so the
     * demo should *ask* for hours, not hope the model volunteers them and then take
     * credit for it when it does.
     */
    /*
     * Adapts to whether a shortlist already exists.
     *
     * The clash-check turn before this one sometimes ends by volunteering five rooms
     * of its own accord — it has her file, and offering is the helpful thing to do.
     * When it has, "find us a table" is a request the model has already answered, and
     * it replies by asking *which* of its own suggestions to check: correct behaviour,
     * no clock time, failed take. So when the previous reply is already a list, this
     * turn names a position in it instead of re-asking for one.
     *
     * By position and not by name, for the reason the booking turn gives below: the
     * shortlist is real Ontopo output, and a scripted "check Yaffo" is a line that
     * breaks the first day Yaffo is not on it.
     */
    /*
     * Names a target hour, because the model rightly asks for one otherwise.
     *
     * "Tell me which hours are free" with no window got "what time were you thinking
     * — around 20:00, or earlier?" — a sensible question, and another turn spent not
     * calling Ontopo. `check_availability` takes a time; a request that withholds it
     * is a request the model cannot act on, and the beat needs the call to happen.
     *
     * "Around 20:00" and not "at 20:00": the point of the beat is which hours come
     * back, so the script must not pre-empt the answer it is about to read.
     */
    say: (previous) =>
      looksLikeAList(previous)
        ? 'Good — check the first two on that list for that evening, dinner around ' +
          '20:00, and tell me which hours are actually free. Nothing with shellfish ' +
          'on the menu.'
        : 'Good. Find us a table for two that evening, dinner around 20:00 — quiet, ' +
          'Mediterranean, nothing with shellfish on it — and tell me which hours are ' +
          'actually free.',
    beat: 'Ontopo — real restaurants, real availability, and her allergy in the query',
    // The observed failure class, verbatim from review: "it isn't acceptable
    // that it is asked on restaurant and answer about Nina Simone".
    //
    // The clock time is the third assertion and the strongest one. A shortlist can be
    // recited from the model's own idea of Tel Aviv; a specific "20:30" cannot, because
    // the only thing that knows a table is free at 20:30 is the `check_availability`
    // call inspection moment 4 then counts. A reply with restaurants and no times is
    // exactly the take that looks right and is not.
    // `availab` is in the list because "availability at Yaffo: 19:30, 20:15…" is a
    // perfectly good answer that names no "table" and no "place". The honesty of this
    // beat rests on the clock time and on moment 4's span count, not on this vocabulary
    // check — so it is kept broad enough not to fail a correct reply.
    replyMust: [/table|restaurant|place|availab/i, /\b([01]?\d|2[0-3]):[0-5]\d\b/],
    replyMustNot: [/nina simone/i],
  },
  /*
   * The search and the booking are two turns because that is what the model does.
   * Asked to "find us a table" it searches and then *asks which one* — a read needs
   * no consent, so no card appears, and a run that expected one here logged a missed
   * proposal for a beat that behaved correctly. An explicit instruction to book is
   * what reaches `propose_reservation`, and it also films better: he offers, you pick.
   *
   * Deliberately does not name a restaurant. Whatever the shortlist holds on the day
   * is real Ontopo availability, and a scripted "book Yaffo" is a line that goes
   * wrong on camera the first time Yaffo is full.
   *
   * It picks by *position* rather than by a quality, though. "Book the quiet one"
   * asked for the only thing every result shared — the search filtered for quiet —
   * so the model rightly asked which, and the take failed for the script's
   * ambiguity rather than for anything the model did wrong.
   */
  {
    /*
     * The hour is read out of the shortlist rather than written here.
     *
     * A hardcoded 20:00 can be an hour Ontopo has just said is full, which films the
     * model arguing with the script. "One of the times you found" instead of an hour
     * fails the other way: the model replied "which time works — 19:30, 19:45, 20:00,
     * 20:15 or 20:30?", which is the *right* answer to an underspecified request and
     * still no proposal to confirm. So: quote the first clock time the previous reply
     * actually offered. The fallback is unreachable in a passing take — the shortlist
     * turn's own `replyMust` requires a clock time — and is here so the type holds.
     */
    /*
     * Asks for the card, not just for the booking.
     *
     * "Go ahead and book the first one at 20:00" produced the sentence
     * `propose_reservation`'s description tells the model to say *while calling it* —
     * "I've got a table … it's waiting for you to confirm" — with no call, no card and
     * nothing to confirm. Asking in the shape the tool actually has ("put it in front
     * of me so I can confirm it myself") is what reaches the write path; and if it
     * ever stops working, `confirmProposal` now fails the take on exactly that
     * sentence rather than filming a table nobody is holding.
     */
    say: (previous) =>
      'Yes — book the first one on that list, at ' +
      `${previous.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/)?.[0] ?? '20:00'}. ` +
      'Put it in front of me so I can confirm it myself.',
    beat: 'Now it is a write, so it comes back as a proposal instead of an answer',
    confirms: true,
    replyMust: [/reserv|propos|confirm|book|table/i],
  },
  /*
   * The Nina Simone payoff, and the one turn whose wording matters to a *later* act.
   *
   * "Don't tell her" is not decoration: it is what makes the mail's closing paragraph
   * land in act 3 as a surprise rather than as a duplicate of something already
   * announced. Nothing in the code reads that phrase — the mail's surprise block is
   * rendered from the stored keepsake by `email-body.ts` and would appear either way —
   * so this is a line for the audience, not a flag for the model.
   *
   * What the line does *not* do is name the artist. The playlist is built from the
   * `music` row extraction wrote back in the profile half, and that is the whole claim:
   * say it once, and it turns up in a real Spotify playlist two acts later.
   */
  {
    say: "And put together a playlist for the drive there — keep it as a surprise, don't " +
      'tell her about it.',
    beat: 'Spotify — real tracks, chosen off the row that says Nina Simone',
    confirms: true,
    replyMust: [/playlist|track|song|nina/i],
  },
];

/**
 * The same question, twice, once per engine — with the drawer open both times.
 *
 * A pure memory read on purpose. It exercises the one thing the two engines genuinely
 * implement differently — this repo's extraction plus `readKnownFacts` on engine A, a
 * managed AgentCore Memory strategy on engine B — with no tool call, no Ontopo variance
 * and no proposal card muddying the trace. Two questions rather than one so the
 * comparison rests on more than a single sample, and because the second is the fact the
 * playlist will later be built from.
 */
const MEMORY_TURNS: Turn[] = [
  {
    say: "Remind me what she can't eat.",
    beat: 'A memory read on the glue code — watch the feed on the right',
    replyMust: [/shellfish/i],
  },
  {
    say: 'And what does she listen to?',
    beat: 'Nothing was re-asked — this comes off a row, not out of the transcript',
    replyMust: [/nina|jazz/i],
  },
];

/**
 * Overlay chrome: a pointer that follows the real mouse, and a caption pill.
 *
 * Added as an init script so it survives a reload, and driven by listening to
 * `mousemove` rather than by being told where to go — there is then exactly one
 * source of truth for where the pointer is, and it is the browser's own.
 */
const OVERLAY = `() => {
  const install = () => {
    if (document.getElementById('__demo_pointer')) return;

    const pointer = document.createElement('div');
    pointer.id = '__demo_pointer';
    pointer.style.cssText = [
      'position:fixed','left:0','top:0','width:24px','height:24px',
      'z-index:2147483647','pointer-events:none','will-change:transform',
      'filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))',
      'transform:translate(-100px,-100px)',
    ].join(';');
    pointer.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 24 24">' +
      '<path d="M4 2 L4 18 L8.5 13.5 L11.5 21 L14.5 19.5 L11.5 12.5 L18 12 Z" ' +
      'fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(pointer);

    addEventListener('mousemove', (event) => {
      pointer.style.transform = 'translate(' + event.clientX + 'px,' + event.clientY + 'px)';
    }, { passive: true, capture: true });

    // A click you can see. Without this the pointer sits still at the exact
    // moment the audience needs to know something was pressed.
    addEventListener('mousedown', (event) => {
      const ring = document.createElement('div');
      ring.style.cssText = [
        'position:fixed','z-index:2147483646','pointer-events:none',
        'left:' + (event.clientX - 6) + 'px','top:' + (event.clientY - 6) + 'px',
        'width:12px','height:12px','border-radius:50%',
        'border:2px solid rgba(255,255,255,.9)','box-shadow:0 0 0 2px rgba(0,0,0,.35)',
        'transition:transform 420ms ease-out, opacity 420ms ease-out','opacity:1',
      ].join(';');
      document.body.appendChild(ring);
      requestAnimationFrame(() => {
        ring.style.transform = 'scale(3.2)';
        ring.style.opacity = '0';
      });
      setTimeout(() => ring.remove(), 480);
    }, { passive: true, capture: true });

    const caption = document.createElement('div');
    caption.id = '__demo_caption';
    caption.style.cssText = [
      'position:fixed','left:50%','bottom:26px','transform:translateX(-50%) translateY(14px)',
      'z-index:2147483646','pointer-events:none','max-width:74vw',
      'padding:10px 18px','border-radius:999px',
      'font:500 15px/1.35 ui-sans-serif,system-ui,sans-serif',
      'color:#fff','background:rgba(17,17,20,.88)',
      'border:1px solid rgba(255,255,255,.14)',
      'box-shadow:0 8px 30px rgba(0,0,0,.4)','backdrop-filter:blur(6px)',
      'opacity:0','transition:opacity 260ms ease, transform 260ms ease',
      'text-align:center',
    ].join(';');
    document.body.appendChild(caption);

    window.__demoCaption = (text, tone) => {
      if (!text) {
        caption.style.opacity = '0';
        caption.style.transform = 'translateX(-50%) translateY(14px)';
        return;
      }
      caption.textContent = text;
      // Three tones, and the two coloured ones are the whole point of having tones:
      // amber says "this beat is stood in for", blue says "this is the claim to look
      // at". Anything a viewer has to take on trust is one of those two colours.
      caption.style.background = tone === 'substituted'
        ? 'rgba(120,72,10,.94)'
        : tone === 'inspect'
          ? 'rgba(12,58,104,.94)'
          : 'rgba(17,17,20,.88)';
      caption.style.borderColor = tone === 'substituted'
        ? 'rgba(255,190,90,.55)'
        : tone === 'inspect'
          ? 'rgba(120,196,255,.6)'
          : 'rgba(255,255,255,.14)';
      caption.style.opacity = '1';
      caption.style.transform = 'translateX(-50%) translateY(0)';
    };
  };
  if (document.body) install();
  else addEventListener('DOMContentLoaded', install);
}`;

/** Where the virtual mouse currently is, so a glide can start from it. */
let pointer = { x: 40, y: 40 };

type CaptionTone = 'substituted' | 'inspect';

async function caption(page: Page, text: string, tone?: CaptionTone): Promise<void> {
  await page
    .evaluate(
      ([value, kind]) =>
        (window as unknown as { __demoCaption?: (t: string, k?: string) => void }).__demoCaption?.(
          value as string,
          kind as string | undefined,
        ),
      [text, tone] as const,
    )
    .catch(() => {
      /* An overlay that failed to install must not stop the demo. */
    });
  const mark = tone === 'substituted' ? '🔶 ' : tone === 'inspect' ? '🔎 ' : '';
  if (text) console.log(`  · ${mark}${text}`);
}

/**
 * One of the four marked inspection moments: caption it, hold on it, still it.
 *
 * A helper rather than four hand-rolled blocks so all four are guaranteed to look the
 * same on screen — same colour, same numbering, same dwell. The numbering is written
 * into the caption because the point of marking them is that someone reviewing the
 * video can find them again, and "the second one" has to mean something.
 */
async function inspectionMoment(
  page: Page,
  index: number,
  claim: string,
  target: Locator | null,
  shotName: string,
): Promise<void> {
  await caption(page, `INSPECT ${index}/4 — ${claim}`, 'inspect');
  if (target && (await showing(target))) await linger(page, target, 6_000);
  else await hold(6_000);
  await shot(page, shotName);
}

/** Ease-in-out, so the pointer accelerates and settles like a hand does. */
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Move the pointer to a point along a curved, eased path.
 *
 * The sideways bow is what stops it looking like a machine: a straight line
 * between two buttons is the one path a hand never takes. Scaled by distance so
 * a short hop stays a short hop.
 */
async function glide(page: Page, x: number, y: number): Promise<void> {
  const from = { ...pointer };
  const distance = Math.hypot(x - from.x, y - from.y);
  const steps = Math.max(12, Math.min(48, Math.round(distance / 16)));
  const bow = (Math.random() - 0.5) * Math.min(90, distance * 0.22);

  for (let step = 1; step <= steps; step++) {
    const t = ease(step / steps);
    // A half-sine across the path puts the bow's peak in the middle and zero at
    // both ends, so the pointer still lands exactly where it was asked to.
    const arc = Math.sin((step / steps) * Math.PI) * bow;
    await page.mouse.move(from.x + (x - from.x) * t, from.y + (y - from.y) * t + arc);
    await sleep(paced(9 + Math.random() * 7));
  }
  pointer = { x, y };
}

async function glideTo(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded().catch(() => {});
  const box = await target.boundingBox();
  if (!box) throw new Error('cannot glide to an element with no box');
  // Aim off-centre. Dead-centre on every button is another machine tell.
  await glide(
    page,
    box.x + box.width * (0.4 + Math.random() * 0.2),
    box.y + box.height * (0.42 + Math.random() * 0.16),
  );
}

/** Glide, hesitate the way a person does before committing, then click. */
async function humanClick(page: Page, target: Locator, why: string): Promise<void> {
  console.log(`  → click: ${why}`);
  await glideTo(page, target);
  await sleep(jitter(260, 180));
  await target.click();
  await sleep(jitter(420, 240));
}

/**
 * A per-character delay that varies with what was just typed.
 *
 * Tuned to a **fast** typist — around 100–110 wpm — rather than an average one.
 * The variation is what makes it read as typing at all; a flat delay looks like a
 * paste even when it is slow, and these numbers are still well clear of the point
 * where the characters stop being individually visible.
 */
function keyDelay(char: string, previous: string): number {
  if (/[.,!?—]/.test(previous)) return jitter(190, 150); // a beat after punctuation
  if (previous === ' ') return jitter(48, 40);
  if (char === ' ') return jitter(58, 46);
  if (/[A-Z]/.test(char)) return jitter(82, 55); // reaching for shift
  return jitter(50, 42);
}

/**
 * Type into the composer one key at a time, optionally fumbling once.
 *
 * The composer's value is checked against `text` before this returns, so a
 * stumble whose backspace did not land, or a dropped keystroke, fails the run
 * rather than sending something the model then has to interpret. Being fussy
 * here is what makes it safe to be playful above.
 */
async function typeHuman(page: Page, composer: Locator, turn: SpokenTurn): Promise<void> {
  await glideTo(page, composer);
  await composer.click();
  await sleep(jitter(420, 300)); // gathering the thought

  // Somewhere in the middle of a word, so the correction is visible but the
  // sentence is nowhere near finished.
  const stumbleAt = turn.stumble
    ? Math.floor(turn.say.length * (0.3 + Math.random() * 0.25))
    : -1;

  for (let index = 0; index < turn.say.length; index++) {
    const char = turn.say[index];
    if (index === stumbleAt && /[a-z]/.test(char)) {
      await page.keyboard.type(char === 'e' ? 'r' : 'e');
      await sleep(jitter(340, 220)); // noticing
      await page.keyboard.press('Backspace');
      await sleep(jitter(260, 180));
    }
    await page.keyboard.type(char);
    await sleep(keyDelay(char, index > 0 ? turn.say[index - 1] : ' '));
  }

  const typed = await composer.inputValue();
  if (typed !== turn.say) {
    throw new Error(`composer drifted.\n  wanted: ${turn.say}\n  got:    ${typed}`);
  }
  await sleep(jitter(300, 220)); // re-reading it before sending
}

/** The whole transcript as text, for growth and settling checks. */
const transcriptOf = (page: Page) =>
  page.getByTestId('chat-panel').innerText().catch(() => '');

/**
 * Wait for the turn to genuinely finish before the composer is touched again.
 *
 * ## Why this is careful
 *
 * The first version of this settled as soon as the transcript text held still
 * for 1.8 seconds, and that is not the same thing as Valentin having finished.
 * One turn can produce several bubbles — he says something, calls a tool, then
 * comes back with the result — and in the gap between them the transcript is
 * perfectly still. So the driver typed the next line into a composer that was
 * still mid-turn, and the message was accepted by the server but never rendered:
 * the transcript ended up showing two of his bubbles back to back with the
 * user's line missing from between them. It looked like an app bug and was not.
 *
 * Three things fixed it, and all three are load-bearing:
 *
 * 1. **`typing-indicator` is the real busy signal.** `MessageInput` is only
 *    disabled on `!isValid`, never while a reply is in flight, so there is no
 *    back-pressure from the composer to lean on. The indicator is the one thing
 *    the app renders that means "still working".
 * 2. **Absent *continuously*.** The indicator comes back between the parts of a
 *    multi-part turn, so a single "is it gone?" check is exactly the trap that
 *    caused the bug. It has to stay gone, and the transcript has to stay still,
 *    for {@link QUIET_MS} together.
 * 3. **The sent line has to appear.** If our own text is not in the transcript
 *    shortly after Enter, that *is* the dropped-message failure, and the run
 *    stops and says so rather than carrying on producing a transcript that
 *    misrepresents the product.
 */
const QUIET_MS = 3_500;

async function awaitReply(page: Page, before: string, sent: string): Promise<string> {
  const typing = page.getByTestId('typing-indicator');
  const deadline = Date.now() + REPLY_TIMEOUT_MS;

  // Matched on a slice, not the whole line: it sidesteps any whitespace or
  // punctuation normalising the renderer might do to a long sentence.
  const fingerprint = sent.slice(0, 24);
  let landed = false;
  const sendDeadline = Date.now() + 20_000;
  while (Date.now() < sendDeadline) {
    if ((await transcriptOf(page)).includes(fingerprint)) {
      landed = true;
      break;
    }
    await sleep(400);
  }
  if (!landed) {
    throw new Error(
      `the message was sent but never rendered — this is the dropped-turn bug.\n` +
        `  line: ${sent}`,
    );
  }

  let previous = await transcriptOf(page);
  let quietFor = 0;
  while (Date.now() < deadline) {
    await sleep(500);
    const busy = await typing.isVisible().catch(() => false);
    const now = await transcriptOf(page);

    if (busy || now !== previous) {
      quietFor = 0; // still going, or another part of the turn just arrived
    } else {
      quietFor += 500;
      if (quietFor >= QUIET_MS && now.length > before.length) break;
    }
    previous = now;
  }

  const said = Math.max(0, previous.length - before.length);
  console.log(`  ← replied (${said} chars)`);
  /*
   * Long enough to see that a reply landed, not long enough to read all of it.
   * Was 17ms/char capped at 11s, which on a 900-character restaurant shortlist
   * meant eleven seconds of nothing happening — across eleven turns, most of the
   * run's dead air. Someone who wants to read a bubble can pause; someone
   * watching a demo cannot get the time back.
   */
  await sleep(Math.min(paced(4_500), paced(900) + said * paced(8)));

  /*
   * What the reply actually said, for the per-turn assertions.
   *
   * Cut after the *tail* of the sent line rather than its head, so the user's own
   * words are excluded from the slice being asserted — a mustNot on "restaurant"
   * must not trip on the user saying "find us a table", and a must on "table"
   * must not pass because he typed the word himself.
   */
  const tail = sent.slice(-24);
  const cut = previous.lastIndexOf(tail);
  const after = cut >= 0 ? previous.slice(cut + tail.length) : previous.slice(before.length);
  return withoutNotedChip(after);
}

/**
 * Drop the extraction chip the app draws above a reply, so assertions read prose.
 *
 * The chip is the app announcing what it just learned — "✓ NOTED · jazz, obsessed
 * with Nina Simone · quiet and candlelit" — and it sits inside the transcript, so it
 * lands in the slice being asserted. That failed a take on the restaurant turn for
 * containing "Nina Simone", when the reply was a flawless Ontopo answer and the words
 * belonged to a chip listing rows extracted several turns earlier.
 *
 * Which is a real distinction, not a convenience: every mustNot here exists to catch
 * *the model* answering the wrong question. What the extractor chose to file is a
 * different claim, checked in a different place — inspection moment 1 and her file.
 */
function withoutNotedChip(reply: string): string {
  /*
   * Line-bounded, and deliberately not a `[\s\S]*?` run to the next blank line: the
   * chip renders as `✓` / `NOTED` / the fact list on three consecutive lines with **no**
   * blank line after it, so a greedy version eats the entire reply — and an empty reply
   * passes every mustNot for the wrong reason, which is worse than the false positive it
   * was written to fix.
   */
  const lines = reply.split('\n');
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line === '✓') continue;
    /*
     * The label has to be the *whole* line, or the whole line up to the `·` that starts
     * the fact list. `\bNOTED\b` was too loose: it also matched "Noted. She loves jazz,
     * and I have put it in her file." — a real reply, whose first sentence it then threw
     * away. Silently deleting prose from the text every assertion reads is the failure
     * mode this function exists to avoid, not one it may introduce.
     */
    if (/^✓?\s*NOTED\s*·/i.test(line)) continue; // label and facts on one line
    if (!/^✓?\s*NOTED\s*$/i.test(line)) {
      kept.push(lines[index]);
      continue;
    }
    // The line after a bare label is the fact list. Dropped only when it looks like one —
    // a `·`-separated run, or a short fragment with no sentence end — so a reply that
    // happens to be a bare "Noted" keeps whatever genuinely follows it.
    const next = (lines[index + 1] ?? '').trim();
    if (next.includes('·') || (next.length > 0 && next.length <= 120 && !/[.!?]$/.test(next))) {
      index++;
    }
  }
  return kept.join('\n').trim();
}

/**
 * Fail the take when a reply is off-topic, instead of finding out in review.
 *
 * Throwing is the point: every one of these patterns encodes a failure that a
 * recorded run actually exhibited, was not caught by any liveness check, and
 * cost the demo. A thrown take is re-runnable; a shipped wrong take is not.
 */
function assertReply(turn: SpokenTurn, reply: string): void {
  for (const must of turn.replyMust ?? []) {
    if (!must.test(reply)) {
      throw new Error(
        `TAKE FAILED — the reply never matched ${must}.\n  asked: ${turn.say}\n  reply: ${reply.slice(0, 400)}`,
      );
    }
  }
  for (const mustNot of turn.replyMustNot ?? []) {
    if (mustNot.test(reply)) {
      throw new Error(
        `TAKE FAILED — the reply matched forbidden ${mustNot}.\n  asked: ${turn.say}\n  reply: ${reply.slice(0, 400)}`,
      );
    }
  }
  if (turn.expectWeekday) {
    const named = WEEKDAYS.filter((day) => new RegExp(`\\b${day}\\b`, 'i').test(reply));
    if (named.length > 0 && !named.includes(turn.expectWeekday)) {
      throw new Error(
        `TAKE FAILED — the reply named ${named.join(', ')} but the date is a ${turn.expectWeekday}.\n` +
          `  asked: ${turn.say}\n  reply: ${reply.slice(0, 400)}`,
      );
    }
  }
}

let shotIndex = 0;
async function shot(page: Page, name: string): Promise<void> {
  shotIndex += 1;
  const file = path.join(SHOT_DIR, `${String(shotIndex).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
}

/**
 * How much of a written-in dwell to actually take.
 *
 * The pauses were each chosen as "long enough to take that in", and eleven of
 * them in a row still added up to a run that felt slow — the fix belongs in one
 * place rather than in eleven re-guessed numbers, so the intent stays readable
 * and the trim stays adjustable. Distinct from `--speed`, which also scales
 * typing: this is only the standing-still time.
 */
const DWELL = Math.max(0.2, Number(flag('dwell') ?? 0.62));

/** A deliberate pause on something already on screen. */
const hold = (ms: number) => sleep(paced(Math.round(ms * DWELL)));

/** Hold on something worth looking at, with the pointer resting near it. */
async function linger(page: Page, target: Locator, ms: number): Promise<void> {
  await glideTo(page, target).catch(() => {});
  await hold(ms);
}

/** True if the element is there to be pointed at, without throwing if it is not. */
const showing = (target: Locator) => target.isVisible().catch(() => false);

/**
 * Press Confirm on whatever proposal the last turn raised.
 *
 * ## Why this is the beat worth filming
 *
 * Every tool that costs money or leaves the building is a *proposal* first: the
 * model calls `propose_reservation`, the server mints nothing, and a card appears
 * with a countdown on it. The write happens in `runToolConfirm`, reachable only
 * from this button. So this click is the entire consent model, on camera.
 *
 * ## Why it never fails the run
 *
 * The model decides whether to propose. It may reasonably ask which of three
 * restaurants first, and then there is no card and nothing has gone wrong — so a
 * missing card is logged and skipped. What is *not* tolerated is a card that fails
 * to resolve after the click: that is the confirm path being broken, which is worth
 * stopping for.
 *
 * ## What the confirm actually does here
 *
 * Ontopo has no booking API, so `confirm` mints a checkout link and hands it back
 * unless a full guest identity is configured (`ONTOPO_GUEST_*`, unset in every
 * local `.env`) — see `guestForCheckout`. A playlist with no `SPOTIFY_REFRESH_TOKEN`
 * likewise hands over track links instead of saving into a library. Both are the
 * documented, safe fallback, and both say which happened in the text on screen —
 * which is why this is filmable at all: no restaurant is being committed to for the
 * sake of a demo.
 */
async function confirmProposal(page: Page, what: string, reply: string): Promise<void> {
  /*
   * The card's own testid is `proposal-<uuid>`, but two of its *children* are
   * `proposal-countdown` and `proposal-resolved` — so a bare prefix match plus
   * `.last()` lands on the countdown, which is visible, contains no Confirm button,
   * and made the run report a live card as "already resolved or lapsed". Excluding
   * the two fixed names leaves only real cards, and `.last()` then means the newest.
   */
  const card = page
    .locator(
      '[data-testid^="proposal-"]'
      + ':not([data-testid="proposal-countdown"])'
      + ':not([data-testid="proposal-resolved"])',
    )
    .last();
  const appeared = await card
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);

  if (!appeared) {
    /*
     * A claimed proposal with no card is the one outcome that must not be filmed.
     *
     * Observed: "Done — I've got a table for two at Yaffo Tel Aviv on Thursday the
     * 24th at 20:00. It's waiting for you to confirm." — with no card, and no tool
     * span for that turn in the feed. The sentence is almost verbatim from
     * `propose_reservation`'s own description, which instructs the model to say it
     * *when calling*; saying it instead of calling is a table nobody is holding, and
     * downstream it is a mail that names a venue no reservation exists for.
     *
     * A reply that simply asks another question is a different thing entirely and
     * still only a log line: he is allowed not to propose. What he is not allowed to
     * do is announce that he has.
     */
    if (/waiting (for|on) (you|your)|waiting to be confirmed|got (you )?a table/i.test(reply)) {
      throw new Error(
        `TAKE FAILED — the reply announces a ${what} that no card exists for.\n` +
          '  Nothing was proposed, so nothing can be confirmed, and the sentence on ' +
          'screen is untrue.\n' +
          `  reply: ${reply.slice(0, 400)}`,
      );
    }
    console.log(`  (no proposal card for ${what} — he answered without proposing)`);
    return;
  }

  await caption(page, 'Nothing is booked yet — this is a proposal, with a clock on it');
  await linger(page, card, 4_200);
  await shot(page, `proposal-${what}`);

  const confirm = card.getByRole('button', { name: 'Confirm' });
  if (!(await showing(confirm))) {
    console.log(`  (the ${what} proposal is already resolved or lapsed)`);
    return;
  }

  await caption(page, 'This click is the only thing in the system that writes');
  await humanClick(page, confirm, `confirm the ${what}`);

  const resolved = await card
    .getByTestId('proposal-resolved')
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  if (!resolved) {
    throw new Error(`confirmed the ${what} proposal and the card never resolved`);
  }

  // Read it out rather than asserting a wording: what a confirm *does* depends on
  // which credentials this deployment holds, and the card is where it says so.
  const outcome = (await card.getByTestId('proposal-resolved').innerText()).trim();
  console.log(`  ✓ ${what}: ${outcome}`);
  await hold(3_600);
  await shot(page, `confirmed-${what}`);
}

/**
 * Play a block of scripted turns, waiting out each reply.
 *
 * `numberedFrom` exists because one block is played in two halves — inspection moment 4
 * lands between the shortlist and the booking — and a second call that restarted its
 * counting at "plan 1/2" would make the log read as two separate plans instead of one
 * interrupted one.
 */
async function playTurns(
  page: Page,
  composer: Locator,
  turns: Turn[],
  tag: string,
  numberedFrom = 0,
): Promise<void> {
  const playable = turns.filter((turn) => SEND_MAIL || !turn.needsMail);
  /*
   * The reply this loop last read, so a turn can quote it. Seeded empty: the first
   * turn of a block has nothing before it, and a `say` function is only used where
   * there demonstrably is something to quote.
   */
  let previousReply = '';
  for (const [index, turn] of playable.entries()) {
    const number = numberedFrom + index + 1;
    console.log(`\n${tag} ${number}/${numberedFrom + playable.length}: ${turn.beat}`);
    await caption(page, turn.beat);
    const before = await transcriptOf(page);
    const spoken: SpokenTurn = {
      ...turn,
      say: typeof turn.say === 'function' ? turn.say(previousReply) : turn.say,
    };
    await typeHuman(page, composer, spoken);
    await composer.press('Enter');
    const reply = await awaitReply(page, before, spoken.say);
    assertReply(spoken, reply);
    previousReply = reply;
    await shot(page, `${tag}-${String(number).padStart(2, '0')}`);
    if (turn.confirms) {
      await confirmProposal(page, tag === 'plan' ? planName(spoken) : 'action', reply);
    }
  }
}

/** A short, file-safe name for the proposal a planning turn is expected to raise. */
function planName(turn: SpokenTurn): string {
  if (/playlist/i.test(turn.say)) return 'playlist';
  // `book` is in here because the booking line names neither a table nor a
  // restaurant — it says "book the first one on that list" — and the log then called
  // the reservation beat "action", which is the one beat whose name matters most.
  if (/table|restaurant|book/i.test(turn.say)) return 'reservation';
  return 'action';
}

/**
 * One browser, reused between runs, so act 3 can read a signed-in inbox.
 *
 * `launchPersistentContext` rather than `launch` + `newContext`, which is the whole
 * reason this function exists: a fresh context has no Google session, and Google's
 * sign-in cannot be scripted past 2FA — nor should it be. The profile is signed in once
 * by hand (`--gmail-login`) and every later run inherits it.
 *
 * It asks for real Chrome first (`channel: 'chrome'`). Bundled Chromium works for
 * everything else here, but Google is materially more likely to challenge a sign-in
 * from it, and the profile is only useful if the sign-in survives. Falls back silently
 * when Chrome is not installed: the run then works exactly as before and only act 3 is
 * at risk.
 */
async function openBrowser(): Promise<BrowserContext> {
  const options = {
    headless: !HEADED,
    viewport: { width: 1600, height: 960 },
    args: ['--window-size=1680,1020'],
    /*
     * A device scale of 2 makes the overlay crisp on a retina screen being mirrored to
     * a projector — but it doubles every recorded frame to 3200×1920 before ffmpeg ever
     * sees it, and Playwright's encoder is the bottleneck in a twenty-minute run. A
     * recording run therefore takes scale 1 and a video sized to the viewport: same
     * layout, same captions, a file that plays anywhere.
     */
    deviceScaleFactor: RECORD ? 1 : 2,
    ...(RECORD
      ? { recordVideo: { dir: VIDEO_DIR, size: { width: 1600, height: 960 } } }
      : {}),
  };

  try {
    return await chromium.launchPersistentContext(USER_DATA_DIR, {
      ...options,
      channel: 'chrome',
    });
  } catch {
    console.log('  (no Chrome channel installed — using bundled Chromium)');
    return chromium.launchPersistentContext(USER_DATA_DIR, options);
  }
}

/**
 * `--gmail-login`: open Gmail and get out of the way.
 *
 * Deliberately not part of a demo run. Signing in is a human step that can take a
 * couple of minutes and involves a phone, and a recording that pauses for it is not a
 * recording. This exists so the pause happens once, on a different afternoon.
 */
async function gmailLogin(): Promise<void> {
  const context = await chromium
    .launchPersistentContext(USER_DATA_DIR, { headless: false, channel: 'chrome' })
    .catch(() => chromium.launchPersistentContext(USER_DATA_DIR, { headless: false }));
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto('https://mail.google.com/', { waitUntil: 'domcontentloaded' });
  console.log(
    `\nSign in to Gmail in the window that just opened.\n` +
      `The session is kept in ${USER_DATA_DIR}, so this is a one-time step.\n` +
      `When the inbox is on screen, close the window (or Ctrl-C here).\n`,
  );
  // Long, but bounded: an unattended `--gmail-login` should not hold a terminal
  // for ever, and fifteen minutes is more than a sign-in takes.
  await page.waitForEvent('close', { timeout: 900_000 }).catch(() => {});
  await context.close().catch(() => {});
}

async function main(): Promise<void> {
  if (GMAIL_LOGIN) {
    await gmailLogin();
    return;
  }

  if (SEND_MAIL && !TO) {
    console.error(
      'demo-drive: --to=<address> is required.\n' +
        'This run sends a real reminder email. The address is never guessed —\n' +
        'a reminder to an invented address reaches a stranger and cannot be un-sent.\n' +
        'Pass --no-mail instead to rehearse the conversation with nothing sent.',
    );
    process.exit(2);
  }

  /*
   * Refuse to promise a send this server cannot make.
   *
   * `REMINDER_CHANNEL` defaults to `log`, and on that channel the dispatcher does
   * everything except send: the body is rendered, the row is stamped sent, and the
   * sweep logs `sent: 1`. A run went out saying "check your inbox" on the strength
   * of that, and no mail existed — a claim about the real world, made from a log
   * line. Checked before the browser opens, because the honest failure is the run
   * that does not start.
   */
  if (SEND_MAIL) {
    const runtime = (await fetch(`${BASE}/api/config`)
      .then((response) => response.json() as Promise<{ reminderChannel?: string }>)
      .catch(() => null));
    if (!runtime) {
      console.error(`demo-drive: ${BASE} is not answering. Start the servers first.`);
      process.exit(2);
    }
    if (runtime.reminderChannel !== 'gmail') {
      console.error(
        `demo-drive: this server would send reminders to the ${runtime.reminderChannel ?? 'log'} ` +
          'channel, not to Gmail.\n' +
          'Nothing would reach an inbox, and the sweep would still report it as sent.\n' +
          'Start the backend with REMINDER_CHANNEL=gmail, or pass --no-mail.',
      );
      process.exit(2);
    }
  }

  /*
   * One run's worth of screenshots, not a pile of them.
   *
   * The numbering is the play order, and the number of beats changes with the
   * flags — so a shorter run leaves the tail of a longer one behind, and the
   * folder then reads as one impossible demo. Emptied rather than appended to.
   * Safe because the path is fixed, gitignored, and holds nothing else.
   */
  await rm(SHOT_DIR, { recursive: true, force: true });
  await mkdir(SHOT_DIR, { recursive: true });
  if (RECORD) await mkdir(VIDEO_DIR, { recursive: true });
  console.log(
    `demo-drive: ${BASE} · speed ${SPEED}× · mail ${SEND_MAIL ? `→ ${TO}` : 'skipped'}` +
      `${RECORD ? ` · recording${HEADED ? ' (headed)' : ''}` : ''}\n`,
  );

  const context = await openBrowser();
  await context.addInitScript(`(${OVERLAY})()`);
  const page = context.pages()[0] ?? (await context.newPage());
  await page.setViewportSize({ width: 1600, height: 960 });

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));

  try {
    console.log('act 1 — the entrance');
    /*
     * `?landing` is what keeps the entrance page on screen under the local dev
     * bypass, which would otherwise sign straight in and skip it — see the step-4
     * comment in `auth-context.tsx`. On a deployment with real auth the page shows
     * without it and the parameter is ignored.
     */
    await page.goto(`${BASE}/?landing`, { waitUntil: 'domcontentloaded' });

    /*
     * Forget who this browser was last time.
     *
     * `auth-context.tsx` keeps `valentin.devUser` — a uuid minted once per browser —
     * in `localStorage`, and that uuid *is* the profile: the rows, her file, the
     * conversations. A fresh Playwright context used to throw it away for free, but
     * act 3 has to read a signed-in Gmail, so the run now reuses one persistent
     * Chrome profile — and that profile carries the uuid forward. The symptom was a
     * take where turn 4 answered "already in her file" and volunteered the previous
     * run's restaurant shortlist: an app behaving correctly, demonstrating a demo
     * that had quietly stopped starting from nothing.
     *
     * Cleared per origin, which is the whole point: `localStorage` is scoped to the
     * app's origin, so this cannot touch the Google session living under
     * `google.com` that act 3 depends on. Cookies are left alone for the same reason.
     */
    await page
      .evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      })
      .catch(() => {});
    await page.goto(`${BASE}/?landing`, { waitUntil: 'domcontentloaded' });

    /*
     * A real wait, not `isVisible()`.
     *
     * `isVisible()` answers immediately and ignores a `timeout` passed to it, so
     * asking it one moment after `goto` is asking React whether it has rendered
     * yet — and the answer is no. That returned "already signed in", skipped the
     * entrance beat, and then hung for twenty seconds waiting for an app that was
     * never coming because the entrance page was on screen the whole time.
     */
    const login = page.getByTestId('login-screen');
    const onEntrance = await login
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);

    if (onEntrance) {
      await caption(page, 'The entrance — where a first-time visitor lands');
      await hold(3_400);
      await shot(page, 'entrance-page');

      /*
       * Which button opens an *empty* profile depends on the deployment, so ask.
       *
       * Where a demo endpoint exists, the two buttons differ in exactly the thing
       * this demo is about: `handleLogin` opens the pre-seeded Samantha persona
       * with 32 fields already filled, and `handleSignUp` opens the `fresh` one
       * with none — "Valentin knows nothing and opens by asking". So there,
       * "Create an Account" is the right button and Login would silently start
       * the demo with someone else's answers already in the rail.
       *
       * Under the local dev bypass it is the other way round: `signUp` returns
       * immediately when `authDisabled`, so "Create an Account" does nothing at
       * all, and Login is the only button that enters. The empty profile then
       * comes from "+ New conversation" a moment later instead.
       *
       * The email and password fields are left alone either way. Under the bypass
       * `handleLogin` never reads them, so typing into them would be miming a
       * credential check that is not happening.
       */
      const runtime = (await page
        .evaluate(() => fetch('/api/config').then((response) => response.json()))
        .catch(() => ({}))) as { demoAvailable?: boolean };

      const freshProfileButton = runtime.demoAvailable === true;
      await caption(
        page,
        freshProfileButton
          ? 'Create a new profile — he starts knowing nothing'
          : 'In — and straight to a new, empty profile',
      );
      await hold(1_800);
      await humanClick(
        page,
        page.getByTestId(freshProfileButton ? 'sign-up-button' : 'demo-login-button'),
        freshProfileButton ? 'create a new profile' : 'enter',
      );
    } else {
      console.log('  (no entrance page — already signed in)');
    }

    await page.getByTestId('app-layout').waitFor({ timeout: 20_000 });
    await caption(page, 'Everything after this is the real app — real model, real integrations');
    await hold(2_600);
    await shot(page, 'entrance');

    // A clean transcript, so the countdown and the learned rows are visibly
    // built by this conversation rather than left over from the last run.
    const newChat = page.getByRole('button', { name: /new (chat|conversation)/i });
    if (await newChat.isVisible().catch(() => false)) {
      await humanClick(page, newChat, 'start a new profile');
    }
    await caption(page, 'Valentin opens — this greeting is the only code-authored line');
    await hold(3_600);
    await shot(page, 'welcome');

    /*
     * ## Act 2, and why it is one act
     *
     * Everything the product does happens inside a single conversation, in one
     * unbroken thread, and it ends by posting a letter. The old cut — facts, then a
     * detour to the rail, then the mail, then back for the booking — put the mail
     * *before* the things the mail is about, so it could only ever be a prompt. Here
     * the table is booked and the playlist is saved while everyone is watching, and
     * the reminder that goes out at the end is a confirmation of both.
     */
    console.log('\nact 2 — the conversation (one thread, ending in the post)');
    const composer = page.getByRole('textbox', { name: /type a message/i });
    await playTurns(page, composer, PROFILE_TURNS, 'turn');

    await caption(page, 'Every row on the right was extracted from what he just said');
    await linger(page, page.getByTestId('brief-rail'), 4_000);
    await shot(page, 'brief-rail');

    const nextUp = page.getByTestId('brief-next-up');
    if (await showing(nextUp)) {
      await caption(page, 'The countdown is the notification, before any mail exists');
      await linger(page, nextUp, 3_500);
      await shot(page, 'next-up');
    }

    /*
     * The drawer opens here and is never closed again.
     *
     * Once, early, so that every later beat — both engines, the calendar read, the
     * availability calls, the two confirms — is visible in the feed as it happens
     * rather than reconstructed afterwards. It used to open and close around a single
     * act, which made it look like a diagnostic mode rather than what it is: a window
     * onto the run that was already going on.
     *
     * Two ways in and both are on screen: the magnifier in the sidebar and the bar
     * across the bottom. The sidebar toggle is preferred because it is the one a
     * presenter can point at.
     */
    const architecture = page.getByTestId('architecture-toggle');
    const reopenBar = page.getByTestId('architecture-reopen-bar');
    const opener = (await showing(architecture)) ? architecture : reopenBar;
    const drawer = page.getByTestId('architecture-drawer');
    const feed = page.getByTestId('aws-flow-feed');
    if (await showing(opener)) {
      await humanClick(page, opener, 'open the live architecture drawer');
      await drawer.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
      await caption(page, 'Every call the conversation has made — each with its trace id');
      await linger(page, page.getByTestId('aws-topology-diagram'), 4_800);
      /*
       * Unfolded here, once, on camera. The feed opens as an index of *actions* in plain
       * English — "Valentin writes a reply" — and the AWS spans underneath each one are
       * folded away; every claim the next few minutes make is about those spans, so this
       * is the click that puts them on screen. It is also the click whose absence made
       * every count in this script read zero.
       */
      await expandFeed(feed);
      await caption(page, 'Unfolded: under each plain-English action, the actual AWS calls');
      await hold(3_000);
      await shot(page, 'inspector-topology');

      // ——— A: the glue code ———
      await playTurns(page, composer, MEMORY_TURNS, 'engine-a');
      await inspectMomentOne(page, feed);
      await inspectMomentTwo(page, drawer);

      // ——— The switch, and B ———
      await runEngineB(page, composer, feed);
    }

    /*
     * Her file — the answer to "is any of that actually stored, or is it just in the
     * transcript?". One captioned claim and one assertion: the artist he mentioned
     * once, in passing, six turns ago, is on the board as a card.
     */
    const herFile = page.getByTestId('her-file-thread');
    if (await showing(herFile)) {
      await humanClick(page, herFile, 'open her file');
      const board = page.getByTestId('dossier-board');
      await board.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
      await caption(page, 'Not a form he filled in — every card here came out of a sentence');
      await linger(page, board, 5_000);
      const boardText = await board.innerText().catch(() => '');
      if (!/nina|jazz/i.test(boardText)) {
        throw new Error(
          'TAKE FAILED — her file has no music card, so the playlist beat has nothing ' +
            'to be built from.',
        );
      }
      console.log('  ✓ her file holds the music row the playlist will be built from');
      await shot(page, 'her-file');
      await humanClick(page, herFile, 'back to the conversation');
      await hold(1_400);
    }

    /*
     * The integrations panel, for one reason only: the turns immediately after this
     * call real providers, and this is where the audience gets to see that the
     * providers are named, credentialed and countable before anything is booked.
     */
    const integrations = page.getByTestId('rail-integrations-button');
    if (await showing(integrations)) {
      await humanClick(page, integrations, 'open the integrations panel');
      /*
       * The numbers are read off the panel rather than written into the caption.
       * It was "Fourteen tools" in prose here, and the number of registered tools
       * is a function of which credentials the deployment holds — so the line was
       * one `buildToolRegistry` change away from being a false claim, delivered
       * with total confidence, on camera.
       *
       * The count it reads is the per-row **readiness** badge, not the panel's
       * "N connected" chip. Those are different facts: the chip counts services
       * connected *through this panel in this browser*, which is legitimately 0 on a
       * deployment whose Google and Spotify credentials come from the environment —
       * so captioning "0 connected" over a panel listing seven live rows was the
       * screen and the voice-over contradicting each other.
       */
      const readiness = await page
        .locator('[data-testid^="integration-readiness-"]')
        .allInnerTexts()
        .catch(() => [] as string[]);
      const live = readiness.filter((text) => /^live/i.test(text.trim())).length;
      const keyless = readiness.filter((text) => /needs credentials/i.test(text)).length;
      await caption(
        page,
        live
          ? `${live} of these are live code against a real provider`
            + (keyless ? ` — ${keyless} more are the same code waiting for a key` : '')
          : 'Every tool he can reach, and the ones he cannot',
      );
      await hold(5_500);
      await shot(page, 'integrations');
      const close = page.getByTestId('integrations-close-button');
      if (await showing(close)) await humanClick(page, close, 'close integrations');
    }

    /*
     * The plan, split at the shortlist so inspection moment 4 can land between the
     * search and the booking — which is the only place it belongs. The claim being
     * marked is that the times on screen came from Ontopo and not from the model, and
     * that is an interesting claim for exactly as long as nobody has booked yet.
     */
    console.log('\n  the plan: calendar, then a table, then the music');
    await playTurns(page, composer, PLAN_TURNS.slice(0, 2), 'plan');
    await inspectMomentFour(page, feed);
    await playTurns(page, composer, PLAN_TURNS.slice(2), 'plan', 2);

    await playTurns(page, composer, CLOSING_TURNS, 'closing');

    if (SEND_MAIL) {
      /*
       * The only beat in the demo with nothing to click, and that is its content: the
       * two turns above changed a setting, and a timer nobody is watching turned that
       * into a letter. Waited out on screen at full length for the same reason.
       */
      console.log('\n  the sweep, and the mail');
      const overdue = OVERDUE_DAYS > 0
        ? `${OVERDUE_DAYS} day${OVERDUE_DAYS === 1 ? '' : 's'} overdue`
        : 'due now';
      await caption(
        page,
        `Two weeks' notice makes this reminder ${overdue}. The scheduler sweeps every 60s…`,
      );
      await hold(4_000);
      const until = Date.now() + SWEEP_WAIT_MS;
      while (Date.now() < until) {
        const left = Math.ceil((until - Date.now()) / 1000);
        await caption(page, `Waiting for the 60-second sweep — ${left}s`);
        await sleep(1_000);
      }
      await caption(page, `Gone. Sent by code, not by the model — it is in ${TO}`);
      await hold(4_500);
      await shot(page, 'after-sweep');
      console.log(`  mail should now be in ${TO}`);
    }

    if (DO_INBOX) await readTheInbox(page, context);

    if (DO_SURVEY) await theSurvey(page);

    await caption(page, '');
    console.log(`\nscreenshots → ${SHOT_DIR}`);
    if (errors.length) {
      console.error(`\n${errors.length} browser error(s) during the run:`);
      for (const error of errors.slice(0, 12)) console.error(`  ${error}`);
    }

    /*
     * Leave it on screen. Closing the window the instant the last beat ends is
     * the wrong ending for something someone is watching. `--no-hold` is for
     * rehearsing the script itself, where an exit code is the whole point.
     *
     * A recording run must not hold either, and this is not a preference: the
     * `.webm` is finalised by `context.close()`, so a run that sits in a ten-minute
     * sleep and is then Ctrl-C'd out of leaves a truncated file — the failure mode
     * being "I recorded the demo" followed by no video.
     */
    if (has('no-hold') || RECORD) return;
    console.log('\ndone — window stays open, Ctrl-C to close');
    await sleep(600_000);
  } finally {
    if (RECORD) await finishVideo(context);
    else await context.close().catch(() => {});
  }
}

/**
 * Unfold every group in the feed, so its span rows are in the DOM at all.
 *
 * `LiveArchitectureDrawer` does not pass `startExpanded`, and `AwsFlowFeed` renders a
 * group's rows behind `{!isCollapsed && …}` — so with the drawer freshly opened there
 * are **zero** `aws-feed-row` elements to count, only the plain-English group captions
 * ("Valentin writes a reply", "Valentin learns something new"). Every assertion here
 * counted `0` and read it as "extraction did not run", which is the opposite of true.
 *
 * Called before *and* between polls, because a group that arrives while the panel is
 * open honours `startExpanded` — i.e. it arrives folded. `aws-feed-fold-all` offers
 * "Expand all" whenever anything is folded, so re-clicking on that label is idempotent
 * in the only sense that matters: it never collapses what is already open.
 */
async function expandFeed(feed: Locator): Promise<void> {
  const foldAll = feed.getByTestId('aws-feed-fold-all');
  if (!(await showing(foldAll))) return;
  const label = (await foldAll.innerText().catch(() => '')).trim();
  if (/expand/i.test(label)) await foldAll.click({ timeout: 5_000 }).catch(() => {});
}

/**
 * The span rows belonging to the newest turn, newest first, as flattened row text.
 *
 * "One turn" needs a boundary, and the feed supplies an exact one: a group captioned
 * *sends a message in chat* is the inbound user message, so everything from the top of
 * the list down to and including that group is the work one turn caused. Scoping to the
 * single newest group instead — which is what this used to do — cannot see the double
 * Bedrock call at all, because `groupFeedRows` keys on actor *and action*: the reply and
 * the extraction have different actions ("writes a reply", "learns something new") and
 * so are always two separate groups, never two rows of one.
 *
 * Read in one `evaluate` rather than through a tree of locators: the list re-renders as
 * spans arrive, and a half-dozen chained `count()` calls against a moving DOM is how a
 * counting assertion becomes flaky in the one place flakiness is indistinguishable from
 * the defect it is meant to catch.
 */
async function newestTurnRows(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const groups = Array.from(
      document.querySelectorAll('[data-testid="aws-flow-feed"] [data-testid="aws-feed-group"]'),
    );
    const rows: string[] = [];
    for (const group of groups) {
      for (const row of Array.from(group.querySelectorAll('[data-testid="aws-feed-row"]'))) {
        /*
         * Joined cell by cell, not `row.textContent`.
         *
         * The row is a CSS grid with no whitespace between its cells, so `textContent`
         * runs the service into the operation and yields `BedrockConverse` — against
         * which `/\bBedrock\b/` cannot match, because `k` and `C` are both word
         * characters and there is no boundary between them. That is a matcher that
         * fails on text which is on screen and correct, which is the worst kind.
         */
        const cells = Array.from(row.children).map((cell) => cell.textContent ?? '');
        rows.push(cells.join(' ').replace(/\s+/g, ' ').trim());
      }
      const header = group.querySelector('[data-testid="aws-feed-group-header"]');
      if (/sends a message/i.test(header?.textContent ?? '')) break;
    }
    return rows;
  });
}

/** Rows for the newest turn once `match` shows up in one, or once the wait runs out. */
async function turnRowsMatching(
  page: Page,
  feed: Locator,
  match: RegExp,
  timeoutMs: number,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await expandFeed(feed);
    const rows = await newestTurnRows(page);
    if (rows.some((row) => match.test(row)) || Date.now() >= deadline) return rows;
    await sleep(1_200);
  }
}

/** A Bedrock `Converse` row — the service column is shortened to `Bedrock`. */
const BEDROCK_CONVERSE = /\bBedrock\b.*\bConverse\b/i;

/**
 * Inspection moment 1: one turn on engine A, two Bedrock calls.
 *
 * The cost of the do-it-yourself engine, on screen and counted rather than asserted in
 * prose: the reply itself, plus a forced-tool `extract-preferences` Converse that
 * re-reads the turn for facts. Both land in the feed with their `operation` in the
 * detail column. The extraction call is fired after the reply and trails it, hence the
 * wait before counting.
 *
 * This one throws. The double call is the sharpest thing the comparison has to say, and
 * a take that captioned it over a single row would be a false claim delivered with
 * total confidence — which is the exact failure this script exists to prevent.
 */
async function inspectMomentOne(page: Page, feed: Locator): Promise<void> {
  const rows = await turnRowsMatching(page, feed, /extract-preferences/i, 40_000);
  const converse = rows.filter((row) => BEDROCK_CONVERSE.test(row));
  const bedrockCalls = converse.length;
  const extracted = converse.filter((row) => /extract-preferences/i.test(row)).length;
  console.log(
    `  feed shows ${bedrockCalls} Bedrock Converse call(s) for that turn ` +
      `(${extracted} of them extraction)`,
  );

  if (bedrockCalls < 2 || extracted < 1) {
    throw new Error(
      `TAKE FAILED — engine A's newest turn holds ${bedrockCalls} Bedrock Converse row(s) ` +
        `and ${extracted} extract-preferences row(s); the claim needs 2 and 1.\n` +
        '  The whole point of this moment is the second, forced-tool extraction call.\n' +
        `  Rows seen: ${rows.join(' | ') || '(none — is any group expanded?)'}`,
    );
  }

  await inspectionMoment(
    page,
    1,
    `One turn, ${bedrockCalls} Bedrock calls — the reply, plus a forced-tool "extract-preferences" pass`,
    // The extraction row itself, which is the one row the claim is about. It exists —
    // the assertion above just counted it — so this needs no fallback.
    feed.getByText('extract-preferences').first(),
    'inspect-1-two-bedrock-calls',
  );
}

/**
 * Inspection moment 2: that same call, walked hop by hop.
 *
 * Clicking a group is what turns the feed from a log into an inspector — the diagram
 * stops following live traffic and replays one request. `aws-feed-group-header` is the
 * clickable row; the group is the container around it.
 *
 * Asserted on the step readout rather than on the diagram, because the readout is the
 * one thing that can only be true if a stored trace is genuinely being stepped: "Step 2
 * of 10" needs a hop count, and a hop count needs spans.
 */
async function inspectMomentTwo(page: Page, drawer: Locator): Promise<void> {
  /*
   * The busiest group, not the newest one.
   *
   * `.first()` is the most recent, which after the memory turns is a single-span group
   * — and the beat then opened on "Step 1 of 1". The assertion passed and the claim
   * ("picked apart hop by hop") was thin enough to be embarrassing. `groupFeedRows`
   * keys on actor and action, so the group with the most rows is the one where a
   * single action fanned out into several AWS calls: exactly what a hop-by-hop replay
   * is for. Ties keep the newest, since the loop only takes a strictly larger count.
   */
  const richest = await page.evaluate(() => {
    const groups = Array.from(
      document.querySelectorAll('[data-testid="aws-flow-feed"] [data-testid="aws-feed-group"]'),
    );
    let best = 0;
    let bestRows = -1;
    groups.forEach((candidate, index) => {
      const rows = candidate.querySelectorAll('[data-testid="aws-feed-row"]').length;
      if (rows > bestRows) {
        bestRows = rows;
        best = index;
      }
    });
    return { index: best, rows: bestRows };
  });
  if (richest.rows > 1) console.log(`  replaying the group with ${richest.rows} spans in it`);
  const group = page.getByTestId('aws-feed-group-header').nth(richest.index);
  if (!(await showing(group))) {
    console.log('  (no replayable group in the feed — skipping the hop-by-hop moment)');
    return;
  }

  // The trace id of *this* group, so the number logged belongs to the call being
  // replayed. Only the AgentCore Runtime span carries one, so an empty string here is
  // normal on engine A and the log line is skipped rather than printed blank.
  const traceId = await page
    .getByTestId('aws-feed-group')
    .nth(richest.index)
    .getByTestId('aws-feed-trace-id')
    .first()
    .innerText()
    .catch(() => '');
  await caption(page, 'INSPECT 2/4 — the same call, picked apart hop by hop', 'inspect');
  await humanClick(page, group, 'replay the call');
  if (traceId) console.log(`  replaying trace ${traceId.trim()}`);

  const steps = page.getByTestId('architecture-step-count');
  await steps.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
  const opening = (await steps.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  if (!/step\s+\d+\s+of\s+\d+/i.test(opening)) {
    throw new Error(
      `TAKE FAILED — clicking the call did not open a stepped replay.\n` +
        `  the step readout says: ${opening || '(nothing)'}`,
    );
  }
  console.log(`  ✓ replay opened: ${opening}`);
  await shot(page, 'inspect-2-replay-opened');

  // Scoped to the drawer: `/^next/i` alone also matches the rail's "Next up" hero, and
  // stepping the flow by clicking a countdown card is a confusing way for this beat to
  // appear to do nothing.
  const next = drawer.getByRole('button', { name: DRAWER_COPY_NEXT });
  for (let step = 0; step < 4 && (await showing(next)); step++) {
    if (await next.isDisabled().catch(() => true)) break;
    await humanClick(page, next, `advance the replay (${step + 1})`);
    // The readout already reads "Step 2 of 10" — prefixing it produced
    // "Step Step 2 of 10" on screen.
    const readout = (await steps.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    await caption(page, readout || 'Stepping through the call', 'inspect');
    await hold(2_400);
  }
  await shot(page, 'inspect-2-stepped');
}

/**
 * The switch to AgentCore, the identical questions, and inspection moment 3.
 *
 * ## What is not assumed
 *
 * That engine B is reachable. `resolveEngine` downgrades to A when the AgentCore wiring
 * is absent, and the drawer says so through `architecture-serving-chip`'s own
 * `data-serving` / `data-downgraded`. The caption is therefore read from the app rather
 * than written here — a video that says "now on AgentCore" over engine A's answers is
 * exactly the lie this project keeps deciding not to tell.
 *
 * **This act needs the deployed app.** `resolveEngine` is per *process*, not per
 * request: it reads `AGENT_ENGINE` and ignores what the request asked for, because
 * `compute-stack.ts` runs two Fargate services off one image and the ALB is what routes
 * `X-Valentin-Engine: agentcore` to the second. A single `dev-server.ts` therefore
 * serves one engine no matter which way the rail is flipped, and against `localhost`
 * this act correctly takes the amber downgrade branch and skips inspection moment 3.
 * That is not a bug to be worked around by setting `AGENT_ENGINE=agentcore` on the local
 * server either — that would serve engine B for the *whole* run, including the beats
 * whose whole point is engine A's double Bedrock call.
 *
 * It ends by switching back, and that is not tidying up: every turn after this calls a
 * tool, and AgentCore is invoked with no tool registry (`hasTools = false`), so the
 * booking beats have to run on the glue code.
 */
async function runEngineB(page: Page, composer: Locator, feed: Locator): Promise<void> {
  const engineSwitch = page.getByTestId('rail-engine-switch');
  if (!(await showing(engineSwitch))) return;

  await caption(page, 'Same conversation, same tools — a different engine underneath');
  await linger(page, engineSwitch, 3_000);
  await humanClick(page, page.getByTestId('rail-engine-agentcore'), 'switch to AgentCore');
  await hold(3_000);

  /*
   * Read off the chip's own attributes, not its words.
   *
   * `ServingChip` publishes `data-serving` (`valentin` | `agentcore` | `unknown`) and
   * `data-downgraded`, which are the app's unambiguous statement about what answered.
   * This used to sniff the rendered text for /glue/ — and the chip says "DIY", so a
   * genuine downgrade read as success and the script captioned "now served by DIY" over
   * an act announcing AgentCore. Exactly the lie the surrounding comment promises not to
   * tell, told by the check that was meant to prevent it.
   *
   * Polled, because the chip is a `/api/config` fetch that restarts on every switch and
   * is deliberately `null` — "Checking engine…" — while in flight. Reading it once, three
   * seconds after the click, is a race whose losing side is a false caption.
   */
  const serving = page.getByTestId('architecture-serving-chip');
  const chipDeadline = Date.now() + 20_000;
  let servingId = '';
  for (;;) {
    servingId = (await serving.getAttribute('data-serving').catch(() => '')) ?? '';
    if (servingId === 'agentcore' || Date.now() >= chipDeadline) break;
    // `unknown` is in flight; `valentin` here is a settled downgrade, but give the
    // fetch a moment in case the switch has not propagated yet.
    await sleep(1_000);
  }
  const downgraded =
    servingId !== 'agentcore' ||
    (await serving.getAttribute('data-downgraded').catch(() => '')) === 'true';
  // The chip renders its own "SERVING:" prefix, so the raw text read back into a
  // sentence gave "is serving SERVING: GLUE CODE". Keep the engine name only.
  const label = (await serving.innerText().catch(() => ''))
    .replace(/\s+/g, ' ')
    .replace(/^serving:?\s*/i, '')
    .trim();

  if (downgraded) {
    await caption(
      page,
      label
        ? `Asked for AgentCore; this deployment is serving ${label} — it says so rather than pretending`
        : 'AgentCore is not wired on this deployment, and the app refuses to claim it is',
      'substituted',
    );
    console.log(
      `  engine B unavailable here — serving chip reads: ${label || '(none)'} ` +
        `(data-serving=${servingId || 'unset'})`,
    );
    // Named, because on a local server this is the *expected* answer rather than a
    // fault, and a run that reported it as a fault would send someone debugging a
    // correctly-behaving app.
    if (servingId === 'valentin') {
      console.log(
        '  (one process serves one engine — `resolveEngine` reads AGENT_ENGINE, not the\n' +
          '   request. The switch needs the deployed app, where the ALB routes\n' +
          '   `X-Valentin-Engine: agentcore` to a second Fargate service.)',
      );
    }
    await hold(6_000);
    await shot(page, 'engine-agentcore-downgraded');
    await humanClick(page, page.getByTestId('rail-engine-valentin'), 'switch back to the glue code');
    await hold(2_500);
    return;
  }

  await caption(page, `Now served by ${label || 'AgentCore'} — same diagram, a different path lights up`);
  await hold(2_500);
  const agentcoreBox = page.getByTestId('aws-agentcore-box');
  if (await showing(agentcoreBox)) await linger(page, agentcoreBox, 4_500);
  await shot(page, 'engine-agentcore-topology');

  await playTurns(page, composer, MEMORY_TURNS, 'engine-b');

  /*
   * Inspection moment 3: the *absence*, which is the exact counterpart of moment 1.
   *
   * Engine B answers the same two questions and spends no Bedrock call on extraction,
   * because AgentCore Memory's managed strategy already holds the fact. An absence is
   * the hardest thing to show on camera, so it is counted and captioned with the number
   * — and asserted, because "no extraction row" is also what a broken feed looks like.
   * The Runtime row is checked alongside it for exactly that reason: it proves the feed
   * was receiving this turn at all.
   */
  /*
   * Waited on `InvokeAgentRuntime` and not on the absence, because you cannot wait for
   * something not to appear: the Runtime row is the proof this turn reached the feed,
   * and once it is there the extraction count is a count of a settled list rather than
   * a race that happens to read zero because nothing has arrived yet.
   */
  const rows = await turnRowsMatching(page, feed, /InvokeAgentRuntime/i, 40_000);
  const extractionRows = rows.filter((row) => /extract-preferences/i.test(row)).length;
  const runtimeRows = rows.filter((row) => /InvokeAgentRuntime/i.test(row)).length;
  console.log(
    `  engine B's newest turn: ${extractionRows} extraction row(s), ${runtimeRows} runtime row(s)`,
  );

  if (extractionRows > 0) {
    throw new Error(
      `TAKE FAILED — engine B's newest turn holds ${extractionRows} extract-preferences row(s).\n` +
        '  The comparison this moment makes is that AgentCore spends none.',
    );
  }
  if (runtimeRows === 0) {
    throw new Error(
      'TAKE FAILED — engine B ran, but the feed shows no AgentCore Runtime row for it.\n' +
        '  An empty turn would make "no extraction call" true for the wrong reason.\n' +
        `  Rows seen: ${rows.join(' | ') || '(none — is any group expanded?)'}`,
    );
  }

  await inspectionMoment(
    page,
    3,
    'Same answers — and zero extraction calls. AgentCore Memory already held the fact',
    feed.getByText('InvokeAgentRuntime').first(),
    'inspect-3-no-extraction',
  );

  /*
   * The scoreboard here, once both engines hold turns from this run — so neither column
   * can read "not yet run" and every number on it was measured minutes ago, on camera.
   */
  const scoreboard = page.getByTestId('scoreboard-toggle');
  if (await showing(scoreboard)) {
    await humanClick(page, scoreboard, 'open the engine scoreboard');
    await caption(page, 'The two engines, measured — every number from turns this run just played');
    await hold(6_000);
    await shot(page, 'inspector-scoreboard');
  }

  await humanClick(page, page.getByTestId('rail-engine-valentin'), 'switch back to the glue code');
  await caption(page, 'And back — the switch is a runtime choice, not a redeploy. Tools live here');
  await hold(4_000);
  await shot(page, 'engine-back');
}

/**
 * Inspection moment 4: the times on screen were fetched, not remembered.
 *
 * One `check_availability` span per restaurant the shortlist offered. The count is read
 * off the feed and put in the caption rather than written into it, because how many
 * venues the model decides to price is the model's call and a hardcoded "three" is a
 * sentence that goes wrong on camera.
 *
 * Zero is the one count that fails the take: a shortlist with times in it and no
 * availability call behind it is a shortlist the model made up, which is precisely the
 * claim this demo is making it does not do. The clock time in the reply itself is
 * asserted separately, on the turn — see `PLAN_TURNS`.
 */
async function inspectMomentFour(page: Page, feed: Locator): Promise<void> {
  // The one moment reached from outside the "drawer opened" branch, so it has to cope
  // with there being no feed to read. Skipped rather than failed: the absence of the
  // inspector is not evidence about where the times came from.
  if (!(await showing(feed))) {
    console.log('  (the inspector is not open — skipping the availability moment)');
    return;
  }

  const rows = await turnRowsMatching(page, feed, /check_availability/i, 30_000);
  const calls = rows.filter((row) => /check_availability/i.test(row)).length;
  console.log(`  feed shows ${calls} check_availability span(s) for that turn`);

  if (calls === 0) {
    throw new Error(
      'TAKE FAILED — the shortlist named times and the feed holds no check_availability ' +
        'span.\n  Those times would have to have come from the model, which is the one ' +
        'thing this beat claims cannot happen.',
    );
  }

  await inspectionMoment(
    page,
    4,
    `${calls} availability call${calls === 1 ? '' : 's'} to Ontopo — those times were fetched, not remembered`,
    feed.getByText('check_availability').first(),
    'inspect-4-availability-spans',
  );
}

/**
 * Act 3: his own inbox, in the same browser.
 *
 * The mail is the one artefact of this demo that leaves the building, so it is the one
 * worth reading where it actually landed rather than in a render of it. Three things are
 * pointed at in order, and they are the three that could only be true if the whole chain
 * held: the restaurant *he* chose is named, the link back into the conversation works,
 * and at the bottom there is a playlist he asked to be kept a surprise.
 *
 * ## Why nothing here fails the take
 *
 * Because everything that *can* be verified already has been, in code — the reservation
 * and surprise branches are unit-tested in `email-body.test.ts`, and the send itself is
 * confirmed by the sweep. What is left is Google's own UI and a signed-in profile, and
 * neither is this project's to guarantee. A run that ends after the sweep is still a
 * complete demo of the product; a run that dies at minute eighteen on a Gmail selector
 * is not.
 */
async function readTheInbox(page: Page, context: BrowserContext): Promise<void> {
  console.log('\nact 3 — the inbox');
  await caption(page, 'And now the part that left the building — his actual inbox');
  await hold(3_000);

  const mail = await context.newPage();
  await mail.addInitScript(`(${OVERLAY})()`);
  await mail.setViewportSize({ width: 1600, height: 960 });
  await mail.goto('https://mail.google.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});

  // The message list is the one thing on a Gmail page that means "signed in and
  // loaded". A sign-in screen never renders it.
  const inbox = mail.locator('table[role="grid"], div[role="main"] table').first();
  const signedIn = await inbox
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true)
    .catch(() => false);

  if (!signedIn) {
    await caption(
      mail,
      'SKIPPED: this browser profile is not signed in to Gmail — run --gmail-login once',
      'substituted',
    );
    console.log(
      `  Gmail is not signed in on ${USER_DATA_DIR}.\n` +
        '  One-time fix:  npm run demo:drive -- --gmail-login\n' +
        '  Or prove the mail arrived from the mailbox side instead:\n' +
        `    npm run verify:reminder-mail -- --to=${TO}`,
    );
    await hold(6_000);
    await shot(mail, 'inbox-not-signed-in');
    await mail.close().catch(() => {});
    return;
  }

  await caption(mail, 'Nobody sent this by hand — a 60-second timer did, two minutes ago');
  await hold(4_000);
  await shot(mail, 'inbox');

  /*
   * The newest message from Valentin, found by its subject rather than by position: an
   * inbox is a real inbox and something else may well have arrived during the run. The
   * occasion word is in every subject `buildSubject` produces.
   */
  const letter = mail
    .locator('tr')
    .filter({ hasText: /anniversary/i })
    .first();
  if (!(await showing(letter))) {
    await caption(mail, 'The mail has not landed in this view yet — Gmail is a few seconds behind', 'substituted');
    console.log('  no matching message visible yet — leaving the inbox as it is');
    await hold(5_000);
    await shot(mail, 'inbox-no-message-yet');
    await mail.close().catch(() => {});
    return;
  }

  await humanClick(mail, letter, 'open the reminder');
  await hold(2_500);
  await caption(mail, 'The restaurant he chose — and it never says "booked", because it cannot know that');
  await hold(6_000);
  await shot(mail, 'mail-opened');

  /*
   * The surprise, read out of the body rather than asserted: `email-body.ts` renders it
   * only from a stored title and an http(s) link, and its absence here would mean the
   * playlist confirm handed back no URL — which the card on screen said at the time.
   */
  const body = await mail.locator('div[role="main"]').innerText().catch(() => '');
  const hasSurprise = /surprise/i.test(body);
  console.log(`  mail body ${hasSurprise ? 'carries' : 'does not carry'} the surprise paragraph`);
  await caption(
    mail,
    hasSurprise
      ? 'And at the bottom: the surprise. A playlist, made from one sentence he said in passing'
      : 'The confirmation, the timing note, and a link back into the conversation',
  );
  await hold(7_000);
  await shot(mail, 'mail-surprise');

  const playlistLink = mail.locator('a[href*="open.spotify.com"]').first();
  if (await showing(playlistLink)) {
    await caption(mail, 'A real playlist, in a real library — opened from a real mail');
    await humanClick(mail, playlistLink, 'open the playlist');
    await hold(6_000);
    await shot(mail, 'mail-playlist-opened');
  }

  await mail.close().catch(() => {});
  await page.bringToFront().catch(() => {});
  await hold(1_500);
}

/**
 * Act 4: the day-after survey — the one substituted beat, and it says so.
 *
 * A survey exists because a date went by, and nobody can make a day pass during a demo.
 * So this seeds the demo fixture, whose outings are already in the past, and the *real*
 * `unratedOutings` path raises the prompt. Only the passage of time is stood in for, and
 * the amber caption is on screen the whole time saying which part.
 */
async function theSurvey(page: Page): Promise<void> {
  console.log('\nact 4 — the day-after survey (substituted)');
  const demo = page.getByTestId('rail-demo-button');
  if (!(await showing(demo))) return;

  await caption(
    page,
    'SUBSTITUTED: a survey needs a date to have passed, and a day cannot pass on stage',
    'substituted',
  );
  await hold(4_500);
  await humanClick(page, demo, 'open demo controls');

  const seed = page.getByTestId('load-demo-profile-button');
  if (await showing(seed)) {
    await humanClick(page, seed, 'seed the demo session');
    await caption(
      page,
      'Only the passing of time is stood in for — the rating prompt itself is the real path',
      'substituted',
    );
    await hold(7_000);
  }
  await shot(page, 'survey-seeded');
}


/**
 * Close the context so the video is flushed, then give the file a name.
 *
 * Playwright names videos after an internal page guid, which is unusable as a
 * deliverable — and it only writes them on `close()`, which is why this runs
 * before `browser.close()` rather than after it.
 *
 * The mp4 is a convenience, not the artifact: Keynote, Slack and QuickTime all
 * decline to play a VP8 `.webm`, so a run whose whole purpose is something to show
 * people would otherwise end in a file they cannot open. When ffmpeg is missing the
 * webm is still there and the run still succeeded, so this only ever warns.
 */
async function finishVideo(context: BrowserContext): Promise<void> {
  await context.close().catch(() => {});

  const written = (await readdir(VIDEO_DIR).catch(() => [])).filter((name) =>
    name.endsWith('.webm'),
  );
  if (!written.length) {
    console.error('\n--record was passed but no video was written.');
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const webm = path.join(VIDEO_DIR, `valentin-demo-${stamp}.webm`);
  await rename(path.join(VIDEO_DIR, written[0]), webm);
  console.log(`\nvideo → ${webm}`);

  const mp4 = webm.replace(/\.webm$/, '.mp4');
  const converted = await new Promise<boolean>((resolve) => {
    execFile(
      'ffmpeg',
      ['-y', '-i', webm, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4],
      (error) => resolve(!error),
    );
  });
  console.log(
    converted
      ? `        ${mp4}`
      : '        (ffmpeg not available or failed — the .webm above is the recording)',
  );
}

main().catch((error) => {
  console.error('demo-drive failed:', error);
  process.exit(1);
});
