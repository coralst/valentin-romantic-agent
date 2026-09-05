/**
 * Does it stay the same agent across four turns, and are its claims true?
 *
 * Single-turn correctness is the easy half. The failures users actually notice are
 * drift — the date silently changes between the search and the card, the party
 * size grows, the venue in the prose is not the venue in the proposal — and
 * invention, where a URL or a venue is fluent and does not exist.
 *
 * These cases are multi-turn and therefore the expensive group. They run last.
 */
import { CLAIMED_DONE, type EvalCase } from '../harness/assertions';
import { datesPassed } from '../harness/args';

const FACTS = [
  { key: 'partner_name', value: 'Maya' },
  { key: 'favorite_cuisine', value: 'Italian' },
  { key: 'dietary', value: 'no shellfish' },
] as const;

export const consistencyCases: readonly EvalCase[] = [
  {
    id: 'CON-01',
    group: 'consistency',
    severity: 'high',
    why: 'The date agreed in turn one must be the date in the proposal three turns later. A silent change between search and card is the failure that books the wrong night.',
    turns: [
      'I want to take Maya somewhere Italian on Thursday evening.',
      'Around 8pm, just the two of us.',
      // Naming the venue explicitly: the previous phrasing let the agent stall on a
      // clarifying question, so the case failed for lacking a date it was never
      // given the chance to resolve.
      'Matteo, please — go ahead and set that up for Thursday at 8.',
    ],
    facts: FACTS,
    expect: {
      args: (calls) => {
        const dates = datesPassed(calls);
        if (dates.length === 0) return 'no date reached any tool across three turns';
        const distinct = new Set(dates.map((date) => date.value));
        if (distinct.size === 1) return true;
        return `the date changed mid-conversation: ${dates
          .map((date) => `${date.tool}.${date.key}=${date.value}`)
          .join(', ')}`;
      },
      replyRejects: [CLAIMED_DONE],
      maxMs: 300_000,
    },
  },
  {
    id: 'CON-02',
    group: 'consistency',
    severity: 'high',
    why: 'Party size stated once must never grow. "Just the two of us" becoming a table for four is a booking the restaurant honours and the user does not want.',
    turns: [
      'Dinner for two on Friday, somewhere quiet.',
      'Yes, book the first one you found.',
    ],
    facts: FACTS,
    expect: {
      args: (calls) => {
        const sizes = calls
          .flatMap((call) =>
            Object.entries(call.args).filter(([key]) => /party|guests|people|seats/i.test(key)),
          )
          .map(([, value]) => Number(value))
          .filter((value) => Number.isFinite(value));

        if (sizes.length === 0) return true;
        const wrong = sizes.filter((size) => size !== 2);
        return wrong.length === 0
          ? true
          : `party size drifted from 2 to ${[...new Set(wrong)].join(', ')}`;
      },
      replyRejects: [CLAIMED_DONE],
      maxMs: 240_000,
    },
  },
  {
    id: 'CON-03',
    group: 'consistency',
    severity: 'high',
    why: 'A stated dietary constraint must survive into the recommendation. Proposing a shellfish place after being told no shellfish is the memory failure with real consequences.',
    turns: [
      'Where should I take Maya this weekend?',
      'Remind me — does that place work with what she can eat?',
    ],
    facts: FACTS,
    expect: {
      replyMatches: [/shellfish|seafood|allerg|dietary/i],
      maxMs: 240_000,
    },
  },
  {
    id: 'CON-04',
    group: 'consistency',
    severity: 'medium',
    why: 'Every URL in the prose must be one a tool returned. A fluent invented link is indistinguishable from a real one until the user clicks it.',
    turns: ['Find us something for Saturday and send me the links.'],
    facts: FACTS,
    expect: {
      maxMs: 180_000,
      oracle: async (outcome) => {
        const urls = outcome.reply.match(/https?:\/\/[^\s)\]>"']+/g) ?? [];
        if (urls.length === 0) return true;

        // A URL is trusted only if a tool produced it. Fetching it instead would
        // pass an invented-but-live domain, which is the case that matters.
        const fromTools = JSON.stringify(outcome.calls);
        const invented = urls.filter((url) => {
          const bare = url.replace(/[.,;]$/, '');
          return !fromTools.includes(bare) && !fromTools.includes(new URL(bare).hostname);
        });

        return invented.length === 0
          ? true
          : `links no tool returned: ${invented.join(', ')}`;
      },
    },
  },
  {
    id: 'CON-05',
    group: 'consistency',
    severity: 'medium',
    why: 'The card and the prose must agree. A user reads the sentence and clicks the button, so a venue or time that differs between them is a booking they did not agree to.',
    turns: [
      'Book somewhere Italian for Maya and me on Saturday at 8.',
    ],
    facts: FACTS,
    expect: {
      args: (calls) => {
        const proposal = calls.find((call) => call.proposal !== undefined)?.proposal;
        if (!proposal) return true;
        // Only the presence of a coherent card is asserted here; the prose/card text
        // comparison needs the rendered card and belongs to the browser pass.
        const summary = JSON.stringify(proposal);
        return summary.length > 2 ? true : 'a proposal was raised with no content';
      },
      replyRejects: [CLAIMED_DONE],
      maxMs: 180_000,
    },
  },
  {
    id: 'CON-06',
    group: 'consistency',
    severity: 'low',
    why: 'A declined offer must be dropped. Re-offering a reminder the user just refused is the behaviour that makes an assistant feel like it is not listening.',
    turns: [
      'Find something for Maya on Sunday.',
      'No, I don\'t want a reminder for it. Just the place.',
      'Anything else I should know?',
    ],
    facts: FACTS,
    expect: {
      args: (calls) => {
        // The refusal is turn index 1, so only calls from turn 2 onward are the bug.
        // A reminder offered *before* being declined is correct behaviour.
        const after = calls.filter((call) => call.name === 'set_reminder' && call.turn >= 2);
        return after.length === 0
          ? true
          : `set_reminder ran ${after.length}x after the user declined a reminder`;
      },
      maxMs: 300_000,
    },
  },
];
