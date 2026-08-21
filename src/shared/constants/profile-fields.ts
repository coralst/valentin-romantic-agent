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
  'travel_destination',
  // Style
  'clothing_style',
  'favorite_color',
  'fragrance_preference',
  // Gifts
  'gift_budget',
  'wish_list',
  'surprise_preference',
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
  travel_destination: 'A place she wants to visit or loves visiting.',
  clothing_style: 'How she dresses, or the aesthetic she favours.',
  favorite_color: 'A colour she loves.',
  fragrance_preference: 'A perfume or scent family she wears or likes.',
  gift_budget: 'What the user is comfortable spending on a gift.',
  wish_list: 'Something specific she has said she wants.',
  surprise_preference: 'Whether she enjoys surprises or prefers to choose for herself.',
};

/** Type guard: is this string one of the canonical field ids? */
export function isProfileFieldId(value: string): value is ProfileFieldId {
  return (PROFILE_FIELD_IDS as readonly string[]).includes(value);
}
