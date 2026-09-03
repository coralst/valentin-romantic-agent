/**
 * The canonical profile field ids, shared by the server and the client.
 *
 * WHY THIS LIVES IN `src/shared/`
 *
 * The client owns the rich field registry (`src/client/utils/profile-field-registry.ts`)
 * — labels, sections, enum options, value types. The server must not import from
 * `src/client/`, but it *does* need the field id vocabulary: the extraction tool
 * schema constrains the model's `field` output to this exact set, so the model
 * cannot invent an id that silently drops the discovery on the floor.
 *
 * Duplicating the list into the server would create a drift risk with no
 * compile-time or test-time signal. Instead the ids live here once, and the
 * client registry is asserted against them by
 * `src/client/utils/__tests__/profile-field-registry.test.ts`. Adding a field to
 * one side without the other fails that test.
 */

/** Every profile field id the extraction tool may target. */
export const PROFILE_FIELD_IDS = [
  // Basics
  'partner_name',
  'nickname',
  'birthday',
  'zodiac_sign',
  // Relationship
  'anniversary',
  'how_we_met',
  'love_language',
  'relationship_duration',
  // Interests
  'favorite_cuisine',
  'music_genre',
  'hobbies',
  'weekly_rhythm',
  'travel_destination',
  // Style
  'clothing_style',
  'favorite_color',
  'color_palette',
  'fragrance_preference',
  // Sizes
  'bra_size',
  'clothing_size',
  'shoe_size',
  'ring_size',
  'shoulder_width',
  // Gifts
  'gift_budget',
  'wish_list',
  'gift_shortlist',
  'surprise_preference',
  /*
   * Planning & logistics — appended, never inserted.
   *
   * `profile-field-registry.test.ts` asserts this array against the client
   * registry *by position*, so inserting into the middle renumbers every field
   * after it and turns a five-line change into an unreviewable diff.
   *
   * These five are also the first fields here that describe the **user** rather
   * than his partner. That is not a new precedent — `gift_budget` is what *he*
   * will spend and `gift_shortlist` is what *he* is weighing up — but it is the
   * reason each guidance string below opens by naming whose fact it is. The
   * invariant this file keeps is "the guidance says whose fact it is", not "every
   * fact is about her".
   */
  'next_occasion',
  'home_city',
  'restaurant_style',
  'reminder_lead_time',
  'search_radius',
] as const;

/**
 * How far from home the user will go for an evening out.
 *
 * A closed set rather than free text because this value is **parsed**: it becomes
 * `radius=` metres on a Places request. `shoulder_width` gets away with "38 cm"
 * because that string is only ever shown to a human who is buying a jacket, while
 * "about twenty minutes away" is a perfectly natural thing to type and parses to
 * nothing at all. A field whose value has to round-trip into an integer should not
 * be free text.
 *
 * Here rather than in the client registry because the server does the parsing and
 * cannot import from `src/client/` — which is the reason this file exists.
 */
export const SEARCH_RADIUS_OPTIONS = [
  '1 km',
  '3 km',
  '5 km',
  '10 km',
  '25 km',
  '50 km',
] as const;

export const SEARCH_RADIUS_METRES: Readonly<Record<string, number>> = {
  '1 km': 1_000,
  '3 km': 3_000,
  '5 km': 5_000,
  '10 km': 10_000,
  '25 km': 25_000,
  '50 km': 50_000,
};

/** Metres for a stored radius, falling back to 10 km when it is unset or odd. */
export function radiusMetres(value: string | null | undefined): number {
  if (!value) return SEARCH_RADIUS_METRES['10 km'];
  return SEARCH_RADIUS_METRES[value.trim()] ?? SEARCH_RADIUS_METRES['10 km'];
}

/**
 * How much warning the user wants before an occasion.
 *
 * Closed for the same reason as the radius: the reminder dispatcher computes
 * `dueAt = occasionDate − N days`, and "a bit before" produces no reminder at all,
 * silently — the worst failure mode available to a reminder.
 */
export const REMINDER_LEAD_OPTIONS = [
  'Same day',
  '1 day before',
  '3 days before',
  '1 week before',
  '2 weeks before',
  '1 month before',
] as const;

export const REMINDER_LEAD_DAYS: Readonly<Record<string, number>> = {
  'Same day': 0,
  '1 day before': 1,
  '3 days before': 3,
  '1 week before': 7,
  '2 weeks before': 14,
  '1 month before': 30,
};

/** Days of notice for a stored lead time, defaulting to a week. */
export function leadTimeDays(value: string | null | undefined): number {
  if (!value) return REMINDER_LEAD_DAYS['1 week before'];
  return REMINDER_LEAD_DAYS[value.trim()] ?? REMINDER_LEAD_DAYS['1 week before'];
}

/**
 * The kinds of room the user wants to be in.
 *
 * Chosen so each option maps deterministically onto the existing closed
 * `VenueVibe` union that the bookable Ontopo set is tagged with — see
 * `STYLE_TO_VIBES` in `src/server/integrations/ontopo/venues.ts` — and onto a
 * keyword Google Places can match. A free-text "her words" list could not be
 * matched against either without a fuzzy matcher nobody would maintain, and the
 * free-taste axis already exists as `favorite_cuisine`.
 */
export const RESTAURANT_STYLE_OPTIONS = [
  'Romantic & quiet',
  'Lively & buzzy',
  "Chef's tasting",
  'Wine bar',
  'Rooftop or view',
  'Casual neighbourhood',
] as const;

/** A profile field id, narrowed to the canonical set. */
export type ProfileFieldId = (typeof PROFILE_FIELD_IDS)[number];

/**
 * One-line guidance per field, injected into the extraction tool schema.
 *
 * The model picks a `field` from an enum, but an enum alone does not tell it
 * *when* each id applies — "birthday" versus "anniversary" versus
 * "relationship_duration" are easy to confuse from prose. These descriptions are
 * the disambiguation, and they are the reason the tool schema is generated
 * rather than hand-written.
 */
export const PROFILE_FIELD_GUIDANCE: Readonly<Record<ProfileFieldId, string>> = {
  partner_name: "The partner's given name.",
  nickname: 'A pet name or shortened name the user calls her.',
  birthday:
    "Her birthday. Use this for ANY birth-date detail — a full date, just a month, or an age. Never split an age and a birth month into two preferences; combine them into one value here.",
  zodiac_sign: 'Her star sign, if named or unambiguously implied by a birth date.',
  anniversary: 'The date the couple married or formally celebrates as their anniversary.',
  how_we_met: 'The story or setting of how the couple first met.',
  love_language:
    'How she most feels loved: words of affirmation, acts of service, receiving gifts, quality time, or physical touch.',
  relationship_duration: 'When the couple got together, or how long they have been together.',
  favorite_cuisine: 'A style of food or cuisine she loves.',
  music_genre: 'A genre, artist, or style of music she loves.',
  hobbies: 'An activity or pastime she enjoys. Dancing, reading, climbing, and so on.',
  weekly_rhythm:
    'A commitment that recurs on a particular weekday, written as "Day@what it is" — for example "Tue@pottery until nine". Use the three-letter English weekday. Add "@light", "@medium" or "@heavy" as a third part when the user says how much of the day it takes ("she is out until nine" is heavy, "a quick class" is light). Never put a comma inside one item, and only record it here if a weekday is actually named — an untimed hobby belongs in hobbies.',
  travel_destination: 'A place she wants to visit or loves visiting.',
  clothing_style: 'How she dresses, or the aesthetic she favours.',
  favorite_color: 'A colour she loves.',
  color_palette:
    'The named colours she actually wears or decorates with, most characteristic first — "Deep sage, Linen, Oat, Blush". Use her words for the shade, not a hex code or a colour you consider close. Use favorite_color for a single colour she has called her favourite; use this for the range.',
  fragrance_preference: 'A perfume or scent family she wears or likes.',
  // Sizes are recorded verbatim, in whatever scale the user says them in — a
  // model that "helpfully" converts UK 6 to EU 39 has invented a fact.
  bra_size:
    'Her bra size, exactly as stated, band and cup together — "34B", "75C". Use this only for a bra; a dress or top size is clothing_size.',
  clothing_size:
    'Her clothing, dress or trouser size, exactly as stated, including the scale (UK, EU, US, S/M/L).',
  shoe_size: 'Her shoe size, exactly as stated, including the scale (UK, EU, US).',
  ring_size:
    'Her ring size, exactly as stated. Use this only for a ring — never for a clothing or shoe size.',
  shoulder_width:
    'Her shoulder measurement, with its unit — "38 cm", "15 in". Only for a measured width across the shoulders, which is what tailoring needs; not a jacket size.',
  gift_budget: 'What the user is comfortable spending on a gift.',
  wish_list: 'Something specific she has said she wants.',
  gift_shortlist:
    'A gift the user is actually considering buying, with its price if one was named, written as "what it is@price" — for example "Ceramic glaze set@62". Omit the "@price" part when no price was given rather than estimating one. Never put a comma inside one item. wish_list is what *she* has said she wants; this is what *he* is weighing up.',
  surprise_preference: 'Whether she enjoys surprises or prefers to choose for herself.',
  // Planning & logistics. Each of these opens by naming whose fact it is, because
  // they are about the user and everything above them is about his partner.
  next_occasion:
    'The next specific thing the user is planning for, written as "YYYY-MM-DD@what it is" — for example "2026-10-04@her promotion dinner". A ONE-OFF occasion only: her birthday belongs in birthday and their anniversary in anniversary, and recording either here would show it twice. Use this for the promotion dinner, the visiting parents, the trip being planned. Omit the field entirely rather than guessing a date.',
  home_city:
    'The city the user lives in or is planning from, as he says it — "Tel Aviv", "Ra\'anana". This is where searches start from, so a neighbourhood or a street is not what is wanted here.',
  restaurant_style:
    'The kind of room the user wants to be in for an evening out — quiet and romantic, lively, a chef\'s tasting, a wine bar, somewhere with a view, or casual and local. This is the atmosphere, not the food; a cuisine goes in favorite_cuisine.',
  reminder_lead_time:
    'How much warning the user wants before an occasion — the morning of, a few days, a week, a month. Record it only when he says something about timing; do not infer it from urgency in his tone.',
  search_radius:
    'How far the user is willing to travel for an evening out, as a distance. If he says it in minutes rather than kilometres, pick the nearest distance rather than recording the minutes.',
};

/** Type guard: is this string one of the canonical field ids? */
export function isProfileFieldId(value: string): value is ProfileFieldId {
  return (PROFILE_FIELD_IDS as readonly string[]).includes(value);
}
