import type { PreferenceCategory } from '../../shared/interfaces/preference';

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
    id: 'clothing_size',
    label: 'Clothing Size',
    valueType: 'text',
    section: 'sizes',
    mappings: [
      { category: 'gifts', key: 'clothing size' },
      { category: 'gifts', key: 'dress size' },
      { category: 'gifts', key: 'clothes size' },
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
