import type { PreferenceCategory } from '../../shared/interfaces/preference';
import {
  REMINDER_LEAD_OPTIONS,
  RESTAURANT_STYLE_OPTIONS,
  SEARCH_RADIUS_OPTIONS,
} from '../../shared/constants/profile-fields';

/** The set of value types a profile field can hold */
export type ProfileFieldValueType = 'text' | 'date' | 'list' | 'enum';

/** A mapping from a preference category+key to this field */
export interface FieldMapping {
  category: PreferenceCategory;
  key: string;
}

/** Definition of a single profile field in the registry */
export interface ProfileFieldDefinition {
  id: string;
  label: string;
  valueType: ProfileFieldValueType;
  section: string;
  enumOptions?: string[];
  mappings: FieldMapping[];
}

/** Definition of a field section */
export interface FieldSectionDefinition {
  id: string;
  label: string;
  order: number;
}

/** All field sections, ordered */
export const PROFILE_FIELD_SECTIONS: readonly FieldSectionDefinition[] = [
  { id: 'basics', label: 'Basics', order: 0 },
  { id: 'relationship', label: 'Relationship', order: 1 },
  { id: 'interests', label: 'Interests', order: 2 },
  { id: 'style', label: 'Style & Aesthetics', order: 3 },
  /*
   * Sizes are their own section rather than three more rows under Style.
   *
   * A dress size is not an aesthetic — it is the lookup you do standing in a
   * shop with your phone out, and the three of them are always wanted together.
   * Grouping them means the dossier shows one small block you can read in a
   * glance instead of burying "Ring Size" between a fragrance and a colour.
   */
  { id: 'sizes', label: 'Sizes', order: 4 },
  { id: 'gifts', label: 'Gifts & Celebrations', order: 5 },
  /*
   * The first section whose rows are facts about *him*: where he is planning
   * from, how far he will travel, how much warning he wants. They are grouped
   * apart from Basics because mixing "her ring size" and "my search radius" into
   * one card makes the dossier read as though the radius were hers.
   */
  { id: 'logistics', label: 'Planning & Logistics', order: 6 },
] as const;

/** The complete profile field registry */
export const PROFILE_FIELD_REGISTRY: readonly ProfileFieldDefinition[] = [
  // Basics
  {
    id: 'partner_name',
    label: 'Name',
    valueType: 'text',
    section: 'basics',
    mappings: [
      { category: 'personality_traits', key: 'name' },
      { category: 'personality_traits', key: 'partner name' },
      { category: 'personality_traits', key: 'first name' },
    ],
  },
  {
    id: 'nickname',
    label: 'Nickname',
    valueType: 'text',
    section: 'basics',
    mappings: [
      { category: 'personality_traits', key: 'nickname' },
    ],
  },
  {
    id: 'birthday',
    label: 'Birthday',
    valueType: 'date',
    section: 'basics',
    mappings: [
      { category: 'important_dates', key: 'birthday' },
      { category: 'important_dates', key: 'birth date' },
      // Extraction reaches for these constantly; a birth month or an age is a
      // birthday detail, not a separate fact.
      { category: 'important_dates', key: 'birth month' },
      { category: 'important_dates', key: 'birthday month' },
      { category: 'important_dates', key: 'age' },
    ],
  },
  {
    id: 'zodiac_sign',
    label: 'Zodiac Sign',
    valueType: 'enum',
    section: 'basics',
    enumOptions: [
      'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
      'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
    ],
    mappings: [
      { category: 'personality_traits', key: 'zodiac sign' },
      { category: 'personality_traits', key: 'zodiac' },
    ],
  },
  // Relationship
  {
    id: 'anniversary',
    label: 'Anniversary',
    valueType: 'date',
    section: 'relationship',
    mappings: [
      { category: 'important_dates', key: 'anniversary' },
      { category: 'important_dates', key: 'wedding anniversary' },
    ],
  },
  {
    id: 'how_we_met',
    label: 'How We Met',
    valueType: 'text',
    section: 'relationship',
    mappings: [
      { category: 'personality_traits', key: 'how we met' },
    ],
  },
  {
    id: 'love_language',
    label: 'Love Language',
    valueType: 'enum',
    section: 'relationship',
    enumOptions: [
      'Words of Affirmation', 'Acts of Service', 'Receiving Gifts',
      'Quality Time', 'Physical Touch',
    ],
    mappings: [
      { category: 'love_language', key: 'primary' },
      { category: 'love_language', key: 'love language' },
    ],
  },
  {
    id: 'relationship_duration',
    label: 'Together Since',
    valueType: 'date',
    section: 'relationship',
    mappings: [
      { category: 'important_dates', key: 'together since' },
      { category: 'important_dates', key: 'dating since' },
    ],
  },
  // Interests
  {
    id: 'favorite_cuisine',
    label: 'Favorite Cuisine',
    valueType: 'text',
    section: 'interests',
    mappings: [
      { category: 'food', key: 'favorite cuisine' },
      { category: 'food', key: 'cuisine' },
      { category: 'food', key: 'favorite food' },
    ],
  },
  {
    id: 'music_genre',
    label: 'Music Genre',
    valueType: 'text',
    section: 'interests',
    mappings: [
      { category: 'music', key: 'genre' },
      { category: 'music', key: 'favorite genre' },
      { category: 'music', key: 'favorite artist' },
    ],
  },
  {
    id: 'hobbies',
    label: 'Hobbies',
    valueType: 'list',
    section: 'interests',
    mappings: [
      { category: 'hobbies', key: 'hobbies' },
      { category: 'hobbies', key: 'hobby' },
      { category: 'hobbies', key: 'activities' },
      { category: 'hobbies', key: 'interests' },
    ],
  },
  /*
   * Her week is a list of "Day@what it is" items, not free prose, because the
   * board draws it as seven bars — one per weekday. Storing "pottery on
   * Tuesdays and her mother on Sundays" as a sentence would render as a
   * sentence, and the whole point of the tile is that you can see at a glance
   * which evenings are already hers.
   */
  {
    id: 'weekly_rhythm',
    label: 'Her Week',
    valueType: 'list',
    section: 'interests',
    mappings: [
      { category: 'hobbies', key: 'weekly rhythm' },
      { category: 'hobbies', key: 'her week' },
      { category: 'hobbies', key: 'routine' },
      { category: 'hobbies', key: 'weekly routine' },
    ],
  },
  {
    id: 'travel_destination',
    label: 'Dream Destination',
    valueType: 'text',
    section: 'interests',
    mappings: [
      { category: 'travel', key: 'dream destination' },
      { category: 'travel', key: 'favorite destination' },
      { category: 'travel', key: 'bucket list' },
    ],
  },
  // Style
  {
    id: 'clothing_style',
    label: 'Clothing Style',
    valueType: 'text',
    section: 'style',
    mappings: [
      { category: 'gifts', key: 'clothing style' },
      { category: 'personality_traits', key: 'style' },
    ],
  },
  {
    id: 'favorite_color',
    label: 'Favorite Color',
    valueType: 'text',
    section: 'style',
    mappings: [
      { category: 'gifts', key: 'favorite color' },
      { category: 'personality_traits', key: 'favorite color' },
    ],
  },
  /*
   * A palette, not one more colour.
   *
   * `favorite_color` answers "what is her colour" and has exactly one value.
   * What a gift actually needs is the range she wears, in her words — a scarf
   * in "oat" is safe and a scarf in the one colour she named as her favourite
   * may be the colour she already owns in six things. Kept as her named shades
   * rather than hex, because "deep sage" is a decision and #6B7A5E is a guess.
   */
  {
    id: 'color_palette',
    label: 'Her Palette',
    valueType: 'list',
    section: 'style',
    mappings: [
      { category: 'gifts', key: 'color palette' },
      { category: 'gifts', key: 'colour palette' },
      { category: 'gifts', key: 'palette' },
      { category: 'gifts', key: 'colors she wears' },
    ],
  },
  {
    id: 'fragrance_preference',
    label: 'Fragrance',
    valueType: 'text',
    section: 'style',
    mappings: [
      { category: 'gifts', key: 'fragrance' },
      { category: 'gifts', key: 'perfume' },
    ],
  },
  /*
   * Sizes
   *
   * All three are `text`, not `enum` or a number: sizing is regional and a
   * person's real answer is "UK 6 / EU 39" or "a 10 in most things, an 8 in
   * Zara". An enum would force a made-up canonical scale and make the honest
   * answer unenterable, and a number would lose the letter sizes entirely.
   *
   * Mappings avoid the bare key "size" on purpose. It is generic enough that
   * extraction reaches for it about anything — a ring, a shoe, a canvas — and
   * resolving it to a specific field would silently file the wrong fact.
   */
  {
    id: 'bra_size',
    label: 'מידת חזיה',
    valueType: 'text',
    section: 'sizes',
    mappings: [
      { category: 'gifts', key: 'bra size' },
      { category: 'gifts', key: 'cup size' },
      { category: 'gifts', key: 'lingerie size' },
    ],
  },
  {
    /*
     * Labelled "Trousers" rather than "Clothing Size" because the card now
     * shows three measurements side by side, and next to a bra size and a
     * shoulder width the generic word reads as though it covered them.
     */
    id: 'clothing_size',
    label: 'Trousers',
    valueType: 'text',
    section: 'sizes',
    mappings: [
      { category: 'gifts', key: 'clothing size' },
      { category: 'gifts', key: 'dress size' },
      { category: 'gifts', key: 'clothes size' },
      { category: 'gifts', key: 'trouser size' },
    ],
  },
  {
    id: 'shoe_size',
    label: 'Shoe Size',
    valueType: 'text',
    section: 'sizes',
    mappings: [
      { category: 'gifts', key: 'shoe size' },
      { category: 'gifts', key: 'shoes size' },
      { category: 'gifts', key: 'boot size' },
    ],
  },
  {
    id: 'ring_size',
    label: 'Ring Size',
    valueType: 'text',
    section: 'sizes',
    mappings: [
      { category: 'gifts', key: 'ring size' },
      { category: 'gifts', key: 'finger size' },
    ],
  },
  {
    id: 'shoulder_width',
    label: 'Shoulders',
    valueType: 'text',
    section: 'sizes',
    mappings: [
      { category: 'gifts', key: 'shoulder width' },
      { category: 'gifts', key: 'shoulders' },
      { category: 'gifts', key: 'shoulder measurement' },
    ],
  },
  // Gifts
  {
    id: 'gift_budget',
    label: 'Gift Budget',
    valueType: 'text',
    section: 'gifts',
    mappings: [
      { category: 'gifts', key: 'budget' },
      { category: 'gifts', key: 'price range' },
    ],
  },
  {
    id: 'wish_list',
    label: 'Wish List',
    valueType: 'list',
    section: 'gifts',
    mappings: [
      { category: 'gifts', key: 'wish list' },
      { category: 'gifts', key: 'wishlist' },
    ],
  },
  /*
   * The shortlist is his, the wish list is hers.
   *
   * They look similar enough to merge and must not be: "she mentioned wanting a
   * glaze set" is a fact about her, while "I am weighing up the glaze set at
   * £62" is a decision he is making. The board shows the second against his
   * budget, and folding them together would price her own words.
   */
  {
    id: 'gift_shortlist',
    label: 'Gift Shortlist',
    valueType: 'list',
    section: 'gifts',
    mappings: [
      { category: 'gifts', key: 'gift shortlist' },
      { category: 'gifts', key: 'shortlist' },
      { category: 'gifts', key: 'gift ideas' },
      { category: 'gifts', key: 'considering' },
    ],
  },
  {
    id: 'surprise_preference',
    label: 'Surprise Preference',
    valueType: 'enum',
    section: 'gifts',
    enumOptions: ['Loves Surprises', 'Prefers to Choose', 'Depends on Occasion'],
    mappings: [
      { category: 'gifts', key: 'surprise preference' },
    ],
  },

  /*
   * Planning & Logistics — appended, never inserted.
   *
   * `profile-field-registry.test.ts` asserts this array against
   * `PROFILE_FIELD_IDS` by position, so an insertion in the middle renumbers
   * every field after it.
   *
   * No new `PreferenceCategory` for these. `fieldId` is authoritative on the read
   * path and `category`+`key` is only the legacy fallback, so a ninth category
   * would buy nothing while widening the extraction tool's enum — an invitation to
   * file every unclassifiable remark under "logistics" forever. The grouping the
   * user actually sees comes from `section`, which is client-side and free.
   *
   * The three enum option lists come from `shared/constants/profile-fields.ts`
   * rather than being written out here, because the server parses the same
   * strings — a radius becomes `radius=` metres on a Places request and a lead
   * time becomes `dueAt = occasionDate − N days`. Two copies of the option text
   * is how a stored value silently stops parsing.
   */
  {
    id: 'next_occasion',
    label: 'Next Occasion',
    valueType: 'text',
    section: 'logistics',
    mappings: [
      { category: 'important_dates', key: 'next occasion' },
      { category: 'important_dates', key: 'upcoming occasion' },
      { category: 'important_dates', key: 'occasion' },
    ],
  },
  {
    id: 'home_city',
    label: 'Home City',
    valueType: 'text',
    section: 'logistics',
    mappings: [
      { category: 'travel', key: 'home city' },
      { category: 'travel', key: 'city' },
      { category: 'travel', key: 'lives in' },
    ],
  },
  {
    id: 'restaurant_style',
    label: 'Restaurant Style',
    valueType: 'enum',
    section: 'logistics',
    enumOptions: [...RESTAURANT_STYLE_OPTIONS],
    mappings: [
      { category: 'food', key: 'restaurant style' },
      { category: 'food', key: 'dining style' },
      { category: 'food', key: 'atmosphere' },
    ],
  },
  {
    id: 'reminder_lead_time',
    label: 'Reminder Lead Time',
    valueType: 'enum',
    section: 'logistics',
    enumOptions: [...REMINDER_LEAD_OPTIONS],
    mappings: [
      { category: 'important_dates', key: 'reminder lead time' },
      { category: 'important_dates', key: 'notice' },
    ],
  },
  {
    id: 'search_radius',
    label: 'Search Radius',
    valueType: 'enum',
    section: 'logistics',
    enumOptions: [...SEARCH_RADIUS_OPTIONS],
    mappings: [
      { category: 'travel', key: 'search radius' },
      { category: 'travel', key: 'radius' },
    ],
  },
  /*
   * `text`, not a new `'email'` value type.
   *
   * A fifth value type would have to be handled by every rendering primitive that
   * switches on `valueType` — the dossier tile, the editor, the skeleton — for the
   * sake of one field, and would buy only an input `type` attribute. Whether a
   * stored string is a plausible address is a question for the route and the
   * extraction layer, which are the two places that can reject it before it is
   * written.
   *
   * Mapped under `important_dates` because that is the category the reminder rows
   * already live in (`reminder_lead_time`), and `fieldId` is authoritative on the
   * read path anyway — the pair is only the legacy fallback.
   */
  {
    id: 'notify_email',
    label: 'Reminder Email',
    valueType: 'text',
    section: 'logistics',
    mappings: [
      { category: 'important_dates', key: 'notify email' },
      { category: 'important_dates', key: 'reminder email' },
      { category: 'important_dates', key: 'notification email' },
    ],
  },
  /*
   * `list`, so the panel shows the muted dates as removable chips — taking a mute
   * off is the edit this field exists to make easy, and a text box would make it a
   * comma-punctuation exercise. Not an `enum`: `enumOptions` is single-select in
   * every primitive that reads it, and he may well want two of the three silenced.
   */
  {
    id: 'reminders_muted',
    label: 'Reminders Muted',
    valueType: 'list',
    section: 'logistics',
    mappings: [
      { category: 'important_dates', key: 'reminders muted' },
      { category: 'important_dates', key: 'muted reminders' },
      { category: 'important_dates', key: 'no reminders for' },
    ],
  },
] as const;

/** Get all fields belonging to a section, in registry order */
export function getFieldsBySection(sectionId: string): ProfileFieldDefinition[] {
  return PROFILE_FIELD_REGISTRY.filter((f) => f.section === sectionId);
}

/** Get a field definition by its id */
export function getFieldById(id: string): ProfileFieldDefinition | undefined {
  return PROFILE_FIELD_REGISTRY.find((f) => f.id === id);
}

/** Get all date-typed fields from the registry */
export function getDateFields(): ProfileFieldDefinition[] {
  return PROFILE_FIELD_REGISTRY.filter((f) => f.valueType === 'date');
}
