/**
 * The defined preference categories for spouse profiling.
 *
 * `love_language` used to be one of them. It is retired: it asked the user to
 * pick from a five-item taxonomy, which the conversation answers better in her
 * own words, and every plan it was supposed to shape is shaped by `hobbies`,
 * `gifts` and `food` anyway. Rows persisted under it are dropped on load rather
 * than rendered — see `bucketFor` in `use-preferences-state.ts`.
 */
export type PreferenceCategory =
  | 'food'
  | 'hobbies'
  | 'music'
  | 'travel'
  | 'gifts'
  | 'important_dates'
  | 'personality_traits';

/** A structured preference record extracted from conversation */
export interface Preference {
  id: string;
  sessionId: string;
  category: PreferenceCategory;
  key: string;
  /**
   * The profile field this preference fills, chosen by the extraction model from
   * a constrained enum, or `null`/absent for a real-but-off-registry fact (an
   * allergy, a dislike).
   *
   * This is the authoritative route from a preference to a profile field. The
   * client falls back to resolving `category` + `key` only when this is absent —
   * which covers preferences persisted before this field existed, and seeded
   * demo data.
   */
  fieldId?: string | null;
  value: string;
  /** Confidence score between 0.0 and 1.0 */
  confidence: number;
  sourceMessageId: string;
  createdAt: string;
  updatedAt: string;
}

/** A single entry in the preference change history */
export interface PreferenceHistoryEntry {
  previousValue: string;
  changedAt: string;
  sourceMessageId: string;
}

/** A preference with its full change history */
export interface PreferenceWithHistory extends Preference {
  history: PreferenceHistoryEntry[];
}
