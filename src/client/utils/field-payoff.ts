import { PROFILE_FIELD_REGISTRY } from './profile-field-registry';

/**
 * What each profile field is *worth* — the ranking behind "Worth asking next"
 * and behind which prompt Valentin pins in the rail.
 *
 * The registry knows a field's shape (text, date, enum) but not its value to a
 * plan. Love language changes every suggestion Valentin makes; zodiac sign
 * changes none of them. Without a ranking the rail has to ask for every registry
 * field in declaration order, which means it opens by asking for a nickname while it
 * still has no idea what she likes.
 *
 * `reason` is written to be shown verbatim, in Valentin's voice, as the second
 * line of the pinned nudge (option-5d-brief.html:341). It says why the answer
 * helps, not that the field is empty — the empty box is already visible.
 */
export interface FieldPayoff {
  /** Higher wins. Ties break on registry order, so the ordering is total. */
  rank: number;
  /** One line, Valentin's voice, on what knowing this unlocks. */
  reason: string;
}

/**
 * Ranks are spaced by 5 so a field can be slotted between two others later
 * without renumbering the table.
 */
export const FIELD_PAYOFFS: Readonly<Record<string, FieldPayoff>> = {
  // --- Tier 1: changes every recommendation Valentin makes. ---
  love_language: {
    rank: 100,
    reason: "I still don't know her love language — it's the fastest way to make the anniversary land.",
  },
  anniversary: {
    rank: 95,
    reason: 'Without your anniversary I cannot tell you when to start planning it.',
  },
  birthday: {
    rank: 90,
    reason: 'Her birthday sets every deadline in this rail — it is the one date I really need.',
  },
  /*
   * The occasion outranks her birthday's neighbours and the home city outranks
   * hobbies, because these two are the only fields that gate *action*. Without a
   * date there is nothing to count down to and no reminder to send; without a
   * city every search has no origin and "within 10 km" cannot be answered at all.
   * A field that unblocks a capability is worth more than one that colours a
   * suggestion.
   */
  next_occasion: {
    rank: 92,
    reason: 'What is the next thing you are planning for? Give me the date and I will count down to it.',
  },
  home_city: {
    rank: 85,
    reason: 'Tell me where you are planning from and I can look for places you could actually get to.',
  },

  // --- Tier 2: shapes what a specific plan looks like. ---
  hobbies: {
    rank: 80,
    reason: 'Tell me what she loves doing and I can suggest something she would actually choose.',
  },
  favorite_cuisine: {
    rank: 75,
    reason: 'Her cuisine narrows a hundred restaurants down to three worth booking.',
  },
  restaurant_style: {
    rank: 72,
    reason: 'What kind of room do you want to be in? It narrows the list faster than the food does.',
  },
  surprise_preference: {
    rank: 70,
    reason: 'Some people bloom at a surprise and some brace for it. Which is she?',
  },
  gift_budget: {
    rank: 65,
    reason: 'A budget keeps my suggestions in the range you would actually spend.',
  },
  wish_list: {
    rank: 60,
    reason: 'Anything she has mentioned wanting? Her own words beat my guesses.',
  },
  gift_shortlist: {
    rank: 58,
    reason: 'Tell me what you are weighing up and I will keep it against your budget.',
  },
  /*
   * Her week outranks cuisine's neighbours because it is the only field that
   * says when she is *free*. A perfect restaurant on the night she has pottery
   * is a worse suggestion than a fair one on a Thursday.
   */
  weekly_rhythm: {
    rank: 55,
    reason: 'Which evenings are already hers? I would rather not plan over her pottery.',
  },

  // --- Tier 3: useful texture once the plan exists. ---
  music_genre: {
    rank: 50,
    reason: 'Her music tells me which evenings will feel like hers.',
  },
  travel_destination: {
    rank: 45,
    reason: 'One place she dreams of gives us a milestone gift to build towards.',
  },
  how_we_met: {
    rank: 40,
    reason: 'How you met is the detail worth echoing back to her on the day.',
  },
  relationship_duration: {
    rank: 35,
    reason: 'Knowing how long it has been lets me mark the quieter milestones too.',
  },
  /*
   * The two settings sit low on purpose. Both have a sensible default in
   * `profile-fields.ts` (a week's notice, ten kilometres), so an empty one costs
   * nothing — unlike an empty home city, which costs the search. The rail should
   * not spend an early turn asking someone to confirm a default.
   */
  reminder_lead_time: {
    rank: 33,
    reason: 'How much warning do you want before a date like that? I default to a week.',
  },
  fragrance_preference: {
    rank: 30,
    reason: 'A fragrance she already wears is the safest gift there is.',
  },
  search_radius: {
    rank: 28,
    reason: 'How far would you go for a good evening? I assume ten kilometres unless you say otherwise.',
  },
  clothing_style: {
    rank: 26,
    reason: 'Her style keeps me from suggesting something she would never put on.',
  },
  /*
   * The five sizes sit as a contiguous cluster between style (26) and colour
   * (20) rather than on the 5-spacing, because in practice they are one
   * question — nobody asks for a shoe size on Tuesday and a dress size on
   * Thursday. Keeping their ranks adjacent means the queue offers them
   * together, and keeping them integers means the ordering stays total without
   * relying on the registry tie-break.
   */
  bra_size: {
    rank: 25,
    reason: 'If you know it, I will hold it — it is the one size nobody wants to ask twice.',
  },
  clothing_size: {
    rank: 24,
    reason: 'Her trouser size is the difference between a gift she wears and one she returns.',
  },
  shoe_size: {
    rank: 23,
    reason: 'A shoe size opens up half the gifts I would otherwise not dare suggest.',
  },
  ring_size: {
    rank: 22,
    reason: 'Her ring size is worth knowing long before the day you need it.',
  },
  shoulder_width: {
    rank: 21,
    reason: 'A shoulder measurement is what anything tailored actually turns on.',
  },
  favorite_color: {
    rank: 20,
    reason: 'A colour she reaches for makes even a small gift feel chosen.',
  },
  color_palette: {
    rank: 19,
    reason: 'The shades she actually wears keep me from buying the one colour she owns six of.',
  },

  // --- Tier 4: nice to have, never the thing to ask for next. ---
  partner_name: {
    rank: 15,
    reason: 'What should I call her?',
  },
  nickname: {
    rank: 10,
    reason: 'Does she have a name only you use for her?',
  },
  /*
   * Low despite gating reminder delivery entirely — a planned reminder with no
   * address is swept and skipped. It sits here because the rail asks these
   * questions in Valentin's voice, and opening a conversation about her by asking
   * for an email address reads like a signup form. It earns its place above the
   * zodiac sign only because something depends on it.
   */
  notify_email: {
    rank: 8,
    reason: 'Where should I send your reminders? Without an address I can plan one but not deliver it.',
  },
  zodiac_sign: {
    rank: 5,
    reason: 'Her sign is a small thing, but some people love a nod to it.',
  },
};

/** Rank for any field id, including one with no entry above. */
export function getFieldRank(fieldId: string): number {
  return FIELD_PAYOFFS[fieldId]?.rank ?? 0;
}

/** The one-line reason for a field, or null when the field has no entry. */
export function getFieldReason(fieldId: string): string | null {
  return FIELD_PAYOFFS[fieldId]?.reason ?? null;
}

/** A field the rail wants an answer for, resolved to its label and its reason. */
export interface FieldGap {
  fieldId: string;
  label: string;
  rank: number;
  reason: string;
}

/**
 * The unanswered fields, most valuable first.
 *
 * `isFilled` is injected rather than read from the profile store so this stays a
 * pure function and can be reasoned about without React.
 */
export function rankUnfilledFields(isFilled: (fieldId: string) => boolean): FieldGap[] {
  return PROFILE_FIELD_REGISTRY
    // Registry order is the tie-break, so capture it before sorting.
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => !isFilled(field.id))
    .map(({ field, index }) => ({
      fieldId: field.id,
      label: field.label,
      rank: getFieldRank(field.id),
      reason: getFieldReason(field.id) ?? `Tell me about her ${field.label.toLowerCase()}.`,
      index,
    }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map(({ index: _index, ...gap }) => gap);
}

/**
 * The single gap Valentin pins in the nudge, or null once nothing is left to
 * ask — at which point the nudge is hidden rather than filled with filler.
 */
export function getTopFieldGap(isFilled: (fieldId: string) => boolean): FieldGap | null {
  return rankUnfilledFields(isFilled)[0] ?? null;
}
