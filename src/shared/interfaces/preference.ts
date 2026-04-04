/** The defined preference categories for spouse profiling */
export type PreferenceCategory =
  | 'food'
  | 'hobbies'
  | 'music'
  | 'travel'
  | 'gifts'
  | 'love_language'
  | 'important_dates'
  | 'personality_traits';

/** A structured preference record extracted from conversation */
export interface Preference {
  id: string;
  sessionId: string;
  category: PreferenceCategory;
  key: string;
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
