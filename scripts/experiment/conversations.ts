/**
 * The frozen conversation corpus for the engine A vs engine B cost/latency
 * experiment: 12 conversations x 10 user turns = 120 turns, which is exactly the
 * usage assumption on slide 6 of the capstone deck (10 turns x 3 conversations/week
 * x 4 weeks = 120 turns per user per month).
 *
 * The same 120 turns are replayed against both engines. Nothing here is tailored
 * per engine, and nothing is generated at run time — a fixed corpus is what makes
 * the two arms comparable and the run repeatable. Treat this file as data: editing
 * it invalidates every previously recorded run.
 *
 * The turns are seeded from the two places this repo already keeps hand-written
 * conversation material, rather than invented from scratch:
 *   - `scripts/demo-drive.mts` TURNS (11 turns, the polished demo script)
 *   - `src/server/fixtures/demo-history.ts` SAMANTHA_HISTORY (the `sender:'user'` side)
 *
 * Two ordering contracts are inherited from `demo-drive.mts`'s header and MUST be
 * preserved in every conversation that touches them, because breaking them makes
 * the *model* look like it lost the thread, and a confused model is slow and
 * expensive in ways that have nothing to do with which engine served the turn:
 *
 *   1. Profile facts first, planning second.
 *   2. The notification address before anything about reminder timing, and the
 *      weekly rhythm last among the profile facts.
 *
 * One partner (Maya) across all 12, because that is what one user's month actually
 * looks like. Note this does *not* let engine B amortise Memory records across
 * conversations — its strategy namespace is `/valentin/{actorId}/{sessionId}`
 * (`infra/lib/agentcore-stack.ts:428-459`), i.e. per-session — and surfacing that
 * cost is one of the experiment's findings, not an accident of the corpus.
 */

/** The address reminder-bearing turns hand over. Overridden by --to at run time. */
export const DEFAULT_NOTIFY_EMAIL = 'valentin-experiment@example.com';

export type ConversationShape =
  /** Fact-dense. Drives Memory extraction and DynamoDB writes. */
  | 'onboarding'
  /** Planning. Drives Gateway tools/call, the tool loop, and the tool Lambdas. */
  | 'planning'
  /** Asks the agent to recall. Drives Memory retrieval, few writes. */
  | 'recall'
  /** Short and cheap. The tail of a real month. */
  | 'chatter';

export interface ExperimentConversation {
  /** Stable id, used as the JSONL key and in the report. Never renumber these. */
  readonly id: string;
  readonly shape: ConversationShape;
  /** Why this conversation is in the corpus — what it is meant to exercise. */
  readonly rationale: string;
  /** Exactly 10 user turns. `{{TO}}` is substituted with the notify address. */
  readonly turns: readonly string[];
}

export const EXPERIMENT_CONVERSATIONS: readonly ExperimentConversation[] = [
  // ---------------------------------------------------------------- onboarding
  {
    id: 'c01-onboarding-core',
    shape: 'onboarding',
    rationale:
      'The canonical demo script. Profile facts first, notify address before timing, ' +
      'weekly rhythm last. Highest expected extraction and write volume.',
    turns: [
      "Hi! Let me get her details down first, then we'll talk about the evening. " +
        'Her name is Maya, and our third anniversary is on 10 September.',
      'Her birthday is 2 March.',
      "She loves Mediterranean food — but no shellfish, she's allergic.",
      'Also, somewhere quiet and romantic. She hates loud rooms.',
      "She's obsessed with Nina Simone — jazz generally, really.",
      'One more thing — she does pottery on Tuesdays, and on Fridays she finishes work at 17:00.',
      'And send reminders to {{TO}}.',
      "That's her, then. We're in Tel Aviv — how far in advance do you normally " +
        'give me a heads-up before a date like this?',
      'Yes — send me the proposal.',
      "Don't email me about her birthday though, I never forget that one.",
    ],
  },
  {
    id: 'c02-onboarding-history',
    shape: 'onboarding',
    rationale:
      'Seeded from SAMANTHA_HISTORY. Dense biographical facts with dates, which is ' +
      'the highest-value extraction case and the one the deck prices at 2,940 in / 300 out.',
    turns: [
      'A bit more about her. She goes by Maya but her family calls her May.',
      "12 June 1994. She's a Gemini and she will tell you so within about four minutes of meeting you.",
      'We met at a rainy Sunday pottery class, back in March 2019 — the 2nd. ' +
        'We both made the same lopsided mug and argued about whose was worse.',
      'Together since that class, but the anniversary we actually celebrate is 10 September.',
      'Her sister Dana is the one person whose opinion she actually takes on gifts.',
      'Dana lives in Haifa, so anything involving her needs a weekend.',
      "Maya's mother is Ruth, and they speak every Sunday evening without fail.",
      'She has a colleague, Tomer, who she complains about affectionately.',
      'Her best friend from university is Noa — they do a birthday dinner every year.',
      'That should be everyone who matters.',
    ],
  },
  {
    id: 'c03-onboarding-taste',
    shape: 'onboarding',
    rationale:
      'Preference-heavy, no dates and no people. Isolates the extraction cost of ' +
      'taste facts from the entity-resolution cost of names and dates.',
    turns: [
      'Let me fill in what she actually likes.',
      'Somewhere Northern Italian. Anything with brown butter and sage and she goes quiet in a happy way.',
      'Indie folk, always. The kind with close harmonies — two voices about a semitone apart and she is gone.',
      'Relaxed and tactile — linen, oversized knits, one good silk scarf she rotates through everything.',
      "Deep sage green. It's in the studio, the scarf, half the glazes. It's not a preference, it's a personality.",
      'Warm and woody — fig, cedar, a little vanilla. Nothing floral, ever.',
      "She doesn't want presents nearly as much as she wants me in the room. " +
        "Even if I'm just reading while she throws a pot.",
      'She loves surprises. Genuinely — she has never once spoiled one.',
      'Around $80 for the everyday stuff, more for the milestones.',
      "And she's talked about Kyoto during cherry blossom season for years and we've never gone.",
    ],
  },
  {
    id: 'c04-onboarding-rhythm',
    shape: 'onboarding',
    rationale:
      'Weekly-rhythm and scheduling facts, which are the ones the reminder pipeline ' +
      'reads back verbatim. Also the corpus test that late-arriving facts still extract.',
    turns: [
      'A few scheduling things I keep forgetting to tell you.',
      'Up before me for a sunrise trail run, back at the wheel by ten — she never stopped pottery after that class.',
      "Afternoons she'll watercolour, or start a loaf she'll fuss over all day.",
      'Tuesdays are pottery, that one is fixed.',
      'Thursdays she has a late meeting and is useless afterwards.',
      'On Fridays she finishes work at 17:00.',
      'Weekends are hers before eleven, mine after.',
      'She hates being rushed more than she hates being late.',
      'Send anything time-sensitive to {{TO}}.',
      'A week of notice is about right for anything that needs a booking.',
    ],
  },

  // ------------------------------------------------------------------ planning
  {
    id: 'c05-planning-dinner',
    shape: 'planning',
    rationale:
      'Restaurant search plus availability. The primary Gateway tools/call driver ' +
      'and the case where engine A hits its 5-iteration tool-loop cap.',
    turns: [
      'Right — the anniversary. Find me somewhere for dinner.',
      'Tel Aviv, and it has to be quiet enough to actually talk.',
      'No shellfish anywhere on the menu if you can manage it.',
      'What about that first one, is it free on the 10th?',
      'Try the second one too.',
      'Around 20:00, if there is a choice.',
      'How long does a table like that usually take to get?',
      'Show me what the room actually looks like.',
      'Is there anywhere to walk afterwards nearby?',
      'Book the first one that works.',
    ],
  },
  {
    id: 'c06-planning-day',
    shape: 'planning',
    rationale:
      'Multi-tool day plan. Deliberately asks for several things per turn to make ' +
      "engine B's uncapped tool loop visible against engine A's cap of 5.",
    turns: [
      'I want to plan the whole day, not just dinner.',
      'Something in the morning that is outdoors but not strenuous.',
      'Is the weather usually reliable in Tel Aviv in September?',
      'Find somewhere for lunch near wherever the morning thing is.',
      'Then something in the afternoon involving pottery or ceramics if such a thing exists.',
      'Check whether any of that is open on a Wednesday.',
      'Is the 10th a holiday or anything I should know about?',
      'Put the whole day in order for me with rough timings.',
      'What does that come to, roughly?',
      'Good. Remind me the week before.',
    ],
  },
  {
    id: 'c07-planning-gift',
    shape: 'planning',
    rationale:
      'Search-heavy with no booking. Exercises web search and page reads without ' +
      'the confirm/propose path, isolating read-only tool cost.',
    turns: [
      'I need a gift as well, not just the evening.',
      'Something for the studio — she throws pots, so tools or glazes.',
      'Sage green if any of it comes in colours.',
      'Around $80, maybe a bit over for this one.',
      'Can you read that page and tell me if it actually ships to Israel?',
      'What about the second link?',
      'Is there anything with fig or cedar in it, scent-wise, as a second small thing?',
      'Nothing floral, she is firm about that.',
      'Which of those two would you actually pick?',
      'Fine. Note that as the plan.',
    ],
  },
  {
    id: 'c08-planning-music',
    shape: 'planning',
    rationale:
      'Playlist plus one booking. The Spotify path plus a confirm, which is the only ' +
      'engine-B Gateway call that carries a real duration (gateway-client.ts:150).',
    turns: [
      'Can you put together a playlist for the evening?',
      'Nina Simone, and the indie folk with the close harmonies.',
      'About two hours of it.',
      'Nothing too slow at the start, she finds that funereal.',
      'Add something from the year we met if you can.',
      'Is there anywhere live playing jazz that night as a backup plan?',
      'Quiet, not a loud bar.',
      'Check if that one has anything on the 10th.',
      'Hold the playlist and the restaurant, drop the live music idea.',
      'Confirm the restaurant.',
    ],
  },

  // -------------------------------------------------------------------- recall
  {
    id: 'c09-recall-profile',
    shape: 'recall',
    rationale:
      'Pure retrieval, no new facts. Drives Memory reads on engine B and store reads ' +
      'on engine A, and is where per-session namespacing should visibly hurt B.',
    turns: [
      'Remind me what I have told you about her so far.',
      'What did I say about food?',
      'And the allergy — what was it exactly?',
      'What music does she like?',
      'When is her birthday again?',
      'What about the anniversary?',
      'What was the colour thing?',
      'Which day is pottery?',
      'What time does she finish on Fridays?',
      'Have I given you an email address for reminders?',
    ],
  },
  {
    id: 'c10-recall-plan',
    shape: 'recall',
    rationale:
      'Recall plus small corrections. Mixed read/write, which is the most common ' +
      'real shape and the one the deck models as the average turn.',
    turns: [
      'Where did we land on the anniversary dinner?',
      'What time was the booking?',
      'Actually, make it 20:30 rather than 20:00.',
      'Did I ask you to sort out a gift as well?',
      'What was the budget I gave you?',
      'Change that to $120, it is a milestone.',
      'Is the playlist still on the plan?',
      'What is still outstanding?',
      'Anything you need from me?',
      'Good, leave it there.',
    ],
  },

  // ------------------------------------------------------------------- chatter
  {
    id: 'c11-chatter-short',
    shape: 'chatter',
    rationale:
      'Short turns, minimal context. The cheap end of the month, and the cleanest ' +
      'measurement of fixed per-turn overhead — Gateway handshake, Memory event write, ' +
      'and the base prompt — with almost no variable model work on top.',
    turns: [
      'Morning.',
      'Nothing much, just checking in.',
      'Is the reminder still set?',
      'Good.',
      'How many days until the anniversary?',
      'And her birthday?',
      'Right.',
      'No, nothing to add.',
      'Thanks.',
      'Bye.',
    ],
  },
  {
    id: 'c12-chatter-mixed',
    shape: 'chatter',
    rationale:
      'Short turns with one fact and one small ask, so the cheap tail is not ' +
      'unrealistically inert. Closes the corpus without a booking.',
    turns: [
      'Quick one.',
      'She mentioned wanting to try that new bakery.',
      'The one near the port, I think.',
      'Add it to the list for another time.',
      'Not for the anniversary, that is already sorted.',
      'What is the weather doing this week?',
      'Fine.',
      'One more thing — she is away the last week of the month.',
      'So nothing after the 24th.',
      'That is all.',
    ],
  },
];

/** 120 by construction. Asserted at import so a bad edit fails loudly, not quietly. */
export const EXPERIMENT_TURN_COUNT = EXPERIMENT_CONVERSATIONS.reduce(
  (sum, conversation) => sum + conversation.turns.length,
  0,
);

if (EXPERIMENT_CONVERSATIONS.length !== 12) {
  throw new Error(
    `corpus must hold 12 conversations, found ${EXPERIMENT_CONVERSATIONS.length}`,
  );
}

for (const conversation of EXPERIMENT_CONVERSATIONS) {
  if (conversation.turns.length !== 10) {
    throw new Error(
      `${conversation.id} must hold 10 turns, found ${conversation.turns.length}`,
    );
  }
}

if (EXPERIMENT_TURN_COUNT !== 120) {
  throw new Error(`corpus must total 120 turns, found ${EXPERIMENT_TURN_COUNT}`);
}

/** Substitutes `{{TO}}`. Kept separate so the corpus itself stays a pure constant. */
export function conversationTurns(
  conversation: ExperimentConversation,
  notifyEmail: string,
): string[] {
  return conversation.turns.map((turn) => turn.replaceAll('{{TO}}', notifyEmail));
}
