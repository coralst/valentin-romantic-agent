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
 * ## What is real here
 *
 * All of it, with one marked exception. The conversation goes through the live
 * websocket to the live model; extraction writes real rows; the reminder is armed
 * by the real planner and swept by the real 60-second scheduler; **the email is
 * really sent** by `gmailSender`.
 *
 * The exception is the day-after survey, and the script says so on screen while
 * it happens rather than letting it pass as real. A survey exists because a date
 * went by and nobody can make a day pass during a demo — so the last beat seeds
 * the demo fixture, whose outings are already in the past, and the *real*
 * `unratedOutings` path raises the prompt. Only the passage of time is stood in
 * for. See `CAPTION_SUBSTITUTED`.
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
 * Usage:
 *   npm run demo:drive -- --to=you@example.com
 *   npm run demo:drive -- --to=you@example.com --speed=1.6   # rehearse faster
 *   npm run demo:drive -- --to=you@example.com --no-mail     # skip the send beat
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Scale a duration by `--speed`. */
const paced = (ms: number) => Math.round(ms / SPEED);
/** `base` ± half of `spread`, scaled. Keeps every pause from being identical. */
const jitter = (base: number, spread: number) =>
  paced(base + Math.random() * spread - spread / 2);

interface Turn {
  /** Exactly what gets typed. Asserted against the composer before sending. */
  say: string;
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
 * Two ordering constraints inside that. `notify_email` comes before anything
 * about timing, so the address is on the profile before a reminder is discussed —
 * though a sweep landing early is harmless, because `dispatcher.ts` checks for a
 * missing target *before* it claims the row and `adoptTarget` back-fills the
 * address afterwards. And `weekly_rhythm` is the last fact, because "she finishes
 * work at 17:00" is quoted back verbatim in the mail, so it should still be in the
 * audience's mind when the mail appears.
 */
const PROFILE_TURNS: Turn[] = [
  {
    say: "Hi! Let me get her details down first, then we'll talk about the evening. " +
      'Her name is Maya, and our third anniversary is on 10 September.',
    beat: 'Her name and the date — the rail starts counting down',
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
    say: 'Also, somewhere quiet and romantic. She hates loud rooms.',
    beat: 'The kind of room — atmosphere, kept separate from cuisine',
  },
  {
    say: "She's obsessed with Nina Simone — jazz generally, really.",
    beat: 'Her music — this is the row Spotify reads later',
  },
  {
    say: 'One more thing — she does pottery on Tuesdays, and on Fridays she finishes work at 17:00.',
    beat: 'Her week — "finishes work at 17:00" is quoted verbatim in the mail',
    stumble: true,
  },
  {
    say: `And send reminders to ${TO}.`,
    beat: 'His own address — the one field Valentin will never invent',
    needsMail: true,
  },
  {
    say: "That's her, then. We're in Tel Aviv — how far in advance do you normally " +
      'give me a heads-up before a date like this?',
    beat: 'The city arrives with the question — and a week out is already now',
  },
  {
    say: 'Yes — send me the proposal.',
    beat: 'Arming the reminder',
    needsMail: true,
  },
  {
    say: "Don't email me about her birthday though, I never forget that one.",
    beat: 'Per-date control: silences the mail, keeps the date',
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
    say: "Before we book anything — what's already in my calendar around the 10th? " +
      "I don't want to double-book that evening.",
    beat: 'Google Calendar, read-only — checking for a clash before proposing a thing',
  },
  {
    say: 'Good. Find us a table for two that evening — quiet, Mediterranean, ' +
      'and nothing with shellfish on it.',
    beat: 'Ontopo — real restaurants, real availability, and her allergy in the query',
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
   */
  {
    say: 'Yes — go ahead and book the quiet one at 20:00.',
    beat: 'Now it is a write, so it comes back as a proposal instead of an answer',
    confirms: true,
  },
  {
    say: 'And put together a playlist for the drive there.',
    beat: 'Spotify — real tracks, chosen off the row that says Nina Simone',
    confirms: true,
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
      caption.style.background = tone === 'substituted'
        ? 'rgba(120,72,10,.94)'
        : 'rgba(17,17,20,.88)';
      caption.style.borderColor = tone === 'substituted'
        ? 'rgba(255,190,90,.55)'
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

async function caption(page: Page, text: string, tone?: 'substituted'): Promise<void> {
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
  if (text) console.log(`  · ${tone === 'substituted' ? '🔶 ' : ''}${text}`);
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
async function typeHuman(page: Page, composer: Locator, turn: Turn): Promise<void> {
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

async function awaitReply(page: Page, before: string, sent: string): Promise<void> {
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
async function confirmProposal(page: Page, what: string): Promise<void> {
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

/** Play a block of scripted turns, waiting out each reply. */
async function playTurns(page: Page, composer: Locator, turns: Turn[], tag: string): Promise<void> {
  const playable = turns.filter((turn) => SEND_MAIL || !turn.needsMail);
  for (const [index, turn] of playable.entries()) {
    console.log(`\n${tag} ${index + 1}/${playable.length}: ${turn.beat}`);
    await caption(page, turn.beat);
    const before = await transcriptOf(page);
    await typeHuman(page, composer, turn);
    await composer.press('Enter');
    await awaitReply(page, before, turn.say);
    await shot(page, `${tag}-${String(index + 1).padStart(2, '0')}`);
    if (turn.confirms) await confirmProposal(page, tag === 'plan' ? planName(turn) : 'action');
  }
}

/** A short, file-safe name for the proposal a planning turn is expected to raise. */
function planName(turn: Turn): string {
  if (/playlist/i.test(turn.say)) return 'playlist';
  if (/table|restaurant/i.test(turn.say)) return 'reservation';
  return 'action';
}

async function main(): Promise<void> {
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

  const browser = await chromium.launch({
    headless: !HEADED,
    args: ['--window-size=1680,1020'],
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 960 },
    /*
     * A device scale of 2 makes the overlay crisp on a retina screen being
     * mirrored to a projector — but it doubles every recorded frame to 3200×1920
     * before ffmpeg ever sees it, and Playwright's encoder is the bottleneck in a
     * twenty-minute run. A recording run therefore takes scale 1 and a video sized
     * to the viewport: same layout, same captions, a file that plays anywhere.
     */
    deviceScaleFactor: RECORD ? 1 : 2,
    ...(RECORD
      ? { recordVideo: { dir: VIDEO_DIR, size: { width: 1600, height: 960 } } }
      : {}),
  });
  await context.addInitScript(`(${OVERLAY})()`);
  const page = await context.newPage();

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

    console.log('\nact 2 — the conversation');
    const composer = page.getByRole('textbox', { name: /type a message/i });
    await playTurns(page, composer, PROFILE_TURNS, 'turn');

    console.log('\nact 3 — what it learned');
    await caption(page, 'Every row on the right was extracted from what he just said');
    await linger(page, page.getByTestId('brief-rail'), 4_500);
    await shot(page, 'brief-rail');

    const nextUp = page.getByTestId('brief-next-up');
    if (await showing(nextUp)) {
      await caption(page, 'The countdown is the notification, before any mail exists');
      await linger(page, nextUp, 4_000);
      await shot(page, 'next-up');
    }

    if (SEND_MAIL) {
      console.log('\nact 4 — the notification, and the mail');
      await caption(page, 'The scheduler sweeps every 60 seconds. Waiting for it to fire…');
      // Nothing to click here and that is the point: no button was pressed to
      // make this happen. Wait it out on screen so the audience sees that.
      const until = Date.now() + SWEEP_WAIT_MS;
      while (Date.now() < until) {
        const left = Math.ceil((until - Date.now()) / 1000);
        await caption(page, `Waiting for the 60-second sweep — ${left}s`);
        await sleep(1_000);
      }
      await caption(page, `Sent by code, not by the model — check ${TO}`);
      await hold(4_000);
      await shot(page, 'after-sweep');
      console.log(`  mail should now be in ${TO}`);
      console.log('  to prove it arrived from the mailbox side:');
      console.log(`    npm run verify:reminder-mail -- --to=${TO}`);
      console.log('  (needs one Google Disconnect→Connect first, or it exits 2)');
    }

    console.log('\nact 5 — the tools he can actually reach');
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

    console.log('\nact 6 — the plan: calendar, then a table, then the music');
    await playTurns(page, composer, PLAN_TURNS, 'plan');

    console.log('\nact 7 — the inspector');
    /*
     * Two ways in, and both are on screen: the magnifier in the sidebar and the
     * bar across the bottom. The sidebar toggle is preferred because it is the one
     * a presenter can point at; the bar is the fallback for a layout where the
     * sidebar is collapsed.
     */
    const architecture = page.getByTestId('architecture-toggle');
    const reopenBar = page.getByTestId('architecture-reopen-bar');
    const opener = (await showing(architecture)) ? architecture : reopenBar;
    if (await showing(opener)) {
      await humanClick(page, opener, 'open the live architecture drawer');
      const drawer = page.getByTestId('architecture-drawer');
      await drawer.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
      await caption(page, 'Every call the last ten minutes made — with its trace id');
      await linger(page, page.getByTestId('aws-topology-diagram'), 5_200);
      await shot(page, 'inspector-topology');

      /*
       * Replay one call rather than describing the feed.
       *
       * Clicking a group is what turns the feed from a log into an inspector: the
       * diagram stops following live traffic and walks that one request hop by hop,
       * and the step controls appear because there is now something that can be
       * stepped. `aws-feed-group-header` is the clickable row — the group is the
       * container.
       */
      const group = page.getByTestId('aws-feed-group-header').first();
      if (await showing(group)) {
        const traceId = await page
          .getByTestId('aws-feed-trace-id')
          .first()
          .innerText()
          .catch(() => '');
        await caption(page, 'Pick one of them apart — hop by hop');
        await humanClick(page, group, 'replay one call');
        if (traceId) console.log(`  replaying trace ${traceId.trim()}`);

        const steps = page.getByTestId('architecture-step-count');
        await steps.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
        await shot(page, 'inspector-replay');

        // Scoped to the drawer: `/^next/i` alone also matches the rail's "Next up"
        // hero, and stepping the flow by clicking a countdown card is a confusing
        // way for this beat to appear to do nothing.
        const next = drawer.getByRole('button', { name: DRAWER_COPY_NEXT });
        for (let step = 0; step < 4 && (await showing(next)); step++) {
          if (await next.isDisabled().catch(() => true)) break;
          await humanClick(page, next, `advance the replay (${step + 1})`);
          // The readout already reads "Step 2 of 10" — prefixing it produced
          // "Step Step 2 of 10" on screen.
          const readout = (await steps.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
          await caption(page, readout || 'Stepping through the call');
          await hold(2_400);
        }
        await shot(page, 'inspector-stepped');
      }

      const scoreboard = page.getByTestId('scoreboard-toggle');
      if (await showing(scoreboard)) {
        await humanClick(page, scoreboard, 'open the engine scoreboard');
        await caption(page, 'The two engines, measured against each other');
        await hold(5_000);
        await shot(page, 'inspector-scoreboard');
      }
    }

    console.log('\nact 8 — the other architecture');
    /*
     * The engine switch is the claim that the same conversation runs on two
     * different back ends: engine A is this repo's own tool loop ("Glue code"),
     * engine B is Bedrock AgentCore running the same tools behind a managed
     * runtime.
     *
     * What is *not* assumed is that engine B is reachable. `resolveEngine`
     * downgrades to A when the AgentCore wiring is absent, and the drawer says so
     * through `architecture-serving-chip` / the `downgraded` marker. The caption is
     * therefore read from the app rather than written here — a video that says
     * "now on AgentCore" over engine A's answers is exactly the lie this project
     * keeps deciding not to tell.
     */
    const engineSwitch = page.getByTestId('rail-engine-switch');
    if (await showing(engineSwitch)) {
      await caption(page, 'Same conversation, same tools — a different engine underneath');
      await linger(page, engineSwitch, 3_000);
      await humanClick(page, page.getByTestId('rail-engine-agentcore'), 'switch to AgentCore');
      await hold(3_000);

      const serving = page.getByTestId('architecture-serving-chip');
      const downgraded = (await showing(page.getByTestId('downgraded')))
        || /glue/i.test(await serving.innerText().catch(() => ''));
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
        console.log(`  engine B unavailable here — serving chip reads: ${label || '(none)'}`);
        await hold(6_000);
      } else {
        await caption(page, `Now served by ${label || 'AgentCore'} — the topology redraws`);
        await hold(2_500);
        const agentcoreBox = page.getByTestId('aws-agentcore-box');
        if (await showing(agentcoreBox)) await linger(page, agentcoreBox, 4_500);
        await shot(page, 'engine-agentcore-topology');

        // One real turn on engine B. Short on purpose: the claim being filmed is
        // "the switch is live", and one answer proves it as well as ten.
        await playTurns(
          page,
          composer,
          [{ say: "Remind me what she can't eat.", beat: 'Answered by AgentCore, not by the glue code' }],
          'agentcore',
        );
      }
      await shot(page, 'engine-agentcore');

      await humanClick(page, page.getByTestId('rail-engine-valentin'), 'switch back to the glue code');
      await caption(page, 'And back. The switch is a runtime choice, not a redeploy');
      await hold(4_000);
      await shot(page, 'engine-back');
    }

    if (DO_SURVEY) {
      console.log('\nact 9 — the day-after survey (substituted)');
      const demo = page.getByTestId('rail-demo-button');
      if (await demo.isVisible().catch(() => false)) {
        await caption(
          page,
          'SUBSTITUTED: a survey needs a date to have passed, and a day cannot pass on stage',
          'substituted',
        );
        await hold(4_500);
        await humanClick(page, demo, 'open demo controls');
        const seed = page.getByTestId('load-demo-profile-button');
        if (await seed.isVisible().catch(() => false)) {
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
    }

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
    await browser.close().catch(() => {});
  }
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
