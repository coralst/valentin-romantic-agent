/**
 * Backdated conversations for the demo personas.
 *
 * A seeded profile with no history reads as a profile that materialised one
 * second ago: eighteen fields filled in, one conversation in the sidebar, and
 * nothing that explains where any of it came from. These transcripts are the
 * missing half — the exchanges that would plausibly have produced the fixture in
 * `demo-profile.ts`, spread over the last few months.
 *
 * CONTRACT: every fact spoken here must agree with `DEMO_PROFILE_PREFERENCES`.
 * The transcript is the visible evidence for the profile panel sitting next to
 * it, so a contradiction — a different anniversary, a different favourite colour
 * — is the one thing on this screen a presenter cannot talk their way out of.
 * `src/server/fixtures/__tests__/demo-personas.test.ts` pins the values that
 * appear in both places.
 *
 * Declarative on purpose: dates are relative ages in days, not timestamps, so
 * the demo is never "last updated in March" no matter when it is shown, and
 * nothing here needs to run to be read.
 *
 * The persona is fictional. No real person, and no identifying detail.
 */

import type { Sender } from '../../shared/interfaces/message';

/** One turn of a seeded transcript */
export interface DemoTranscriptTurn {
  sender: Sender;
  content: string;
}

/** One backdated conversation, as the sidebar and the transcript will show it */
export interface DemoConversation {
  /**
   * The sidebar label.
   *
   * Written into the session's `title`, which takes precedence over the
   * denormalised partner name — otherwise every row in the list would read
   * "Samantha" and the history would be unnavigable.
   */
  title: string;
  /**
   * How long before the seed this conversation happened, in whole days.
   *
   * `0` means "today", which is the live conversation the demo opens on.
   */
  daysAgo: number;
  /** Ordered oldest turn first */
  turns: readonly DemoTranscriptTurn[];
}

/**
 * Samantha's history, oldest first.
 *
 * The last entry is the conversation the demo lands in: it is the one that
 * carries the seeded preferences, so it also has to be the most recent.
 */
export const SAMANTHA_HISTORY: readonly DemoConversation[] = [
  {
    title: 'Getting to know Samantha',
    daysAgo: 134,
    turns: [
      {
        sender: 'agent',
        content:
          "I'd love to start with the essentials. What's your partner's name?",
      },
      {
        sender: 'user',
        content: "Samantha. Everyone calls her Sam, including me most days.",
      },
      {
        sender: 'agent',
        content:
          'Samantha — Sam. Noted, both. And when does she get to be the centre of attention? Her birthday, I mean.',
      },
      {
        sender: 'user',
        content:
          "12 June 1994. She's a Gemini and she will tell you so within about four minutes of meeting you.",
      },
      {
        sender: 'agent',
        content:
          'A Gemini who leads with it. I like her already. How did the two of you meet?',
      },
      {
        sender: 'user',
        content:
          'A rainy Sunday pottery class, back in March 2019 — the 2nd. We both made the same lopsided mug and argued about whose was worse.',
      },
      {
        sender: 'agent',
        content:
          'Two identical lopsided mugs is not a coincidence, it\'s a beginning. Is that the date you count from, or is there another one?',
      },
      {
        sender: 'user',
        content:
          'Both, honestly. Together since that class, but the anniversary we actually celebrate is 18 September 2021.',
      },
      {
        sender: 'agent',
        content:
          "Then I'll hold on to both: together since 2 March 2019, anniversary 18 September 2021. That's a good foundation.",
      },
    ],
  },
  {
    title: 'What she eats, what she plays',
    daysAgo: 97,
    turns: [
      {
        sender: 'agent',
        content:
          "Let's talk about feeding her. If you were booking somewhere for no reason at all, where would you book?",
      },
      {
        sender: 'user',
        content:
          "Somewhere Northern Italian. Anything with brown butter and sage and she goes quiet in a happy way.",
      },
      {
        sender: 'agent',
        content:
          'Brown butter and sage — that is a very specific kind of quiet, and a very easy one to arrange. What tends to be playing while she eats?',
      },
      {
        sender: 'user',
        content:
          "Indie folk, always. The kind with close harmonies — two voices about a semitone apart and she's gone.",
      },
      {
        sender: 'agent',
        content:
          "Close harmonies and sage butter. I'm starting to see the shape of an evening here.",
      },
    ],
  },
  {
    title: 'Her weekends',
    daysAgo: 62,
    turns: [
      {
        sender: 'agent',
        content:
          'What does a Saturday she gets to plan herself actually look like?',
      },
      {
        sender: 'user',
        content:
          "Up before me for a sunrise trail run, back at the wheel by ten — she never stopped doing pottery after that class. Afternoons she'll watercolour, or start a loaf she'll fuss over all day.",
      },
      {
        sender: 'agent',
        content:
          'Pottery, sunrise trail runs, watercolour sketching, bread baking. Four things she does with her hands. Does she want company for any of it?',
      },
      {
        sender: 'user',
        content:
          "That's the thing — she doesn't want presents nearly as much as she wants me in the room. Even if I'm just reading while she throws a pot.",
      },
      {
        sender: 'agent',
        content:
          "Quality time, then, above the rest. That's worth knowing, because it means the cheapest gesture you have is also the best one.",
      },
    ],
  },
  {
    title: 'Sage green and linen',
    daysAgo: 24,
    turns: [
      {
        sender: 'agent',
        content:
          "I want to get her taste right before I suggest anything you'd have to wrap. What does she reach for?",
      },
      {
        sender: 'user',
        content:
          'Relaxed and tactile — linen, oversized knits, one good silk scarf she rotates through everything.',
      },
      {
        sender: 'agent',
        content: 'And a colour, if she had to choose one and live with it?',
      },
      {
        sender: 'user',
        content:
          "Deep sage green. It's in the studio, the scarf, half the glazes. It's not a preference, it's a personality.",
      },
      {
        sender: 'agent',
        content: 'Understood. Does she wear a fragrance?',
      },
      {
        sender: 'user',
        content:
          'Warm and woody — fig, cedar, a little vanilla. Nothing floral, ever.',
      },
      {
        sender: 'agent',
        content:
          "Deep sage green, linen and knits, fig and cedar. I could pick her out of a crowd now.",
      },
    ],
  },
  {
    title: 'Planning the anniversary',
    daysAgo: 0,
    turns: [
      {
        sender: 'agent',
        content:
          "Your anniversary is 18 September — that's close enough to start planning properly. How ambitious are we being?",
      },
      {
        sender: 'user',
        content:
          "Ambitious. She's talked about Kyoto during cherry blossom season for years and we've never gone.",
      },
      {
        sender: 'agent',
        content:
          "Kyoto in blossom season is a spring trip, so treat September as the announcement rather than the departure. Does she like being surprised, or would she rather be part of the planning?",
      },
      {
        sender: 'user',
        content:
          "She loves surprises. Genuinely — she's never once spoiled one.",
      },
      {
        sender: 'agent',
        content:
          'Then the reveal is half the gift. What are we usually spending on each other?',
      },
      {
        sender: 'user',
        content:
          "Around $80 for the everyday stuff, more for the milestones. This is a milestone.",
      },
      {
        sender: 'agent',
        content:
          "Then here's my shortlist against what she's been circling: the ceramic glaze set, a linen apron for the studio, that hardback poetry anthology, and new trail shoes. The shoes and the glazes are the anniversary; the apron and the anthology are the Tuesdays in between.",
      },
    ],
  },
];
