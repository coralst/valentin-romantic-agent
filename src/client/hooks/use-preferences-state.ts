import { useReducer } from 'react';
import type { PreferenceCategory, PreferenceWithHistory } from '../../shared/interfaces/preference';
import { PREFERENCE_CATEGORIES } from '../../shared/constants/categories';

/** Preferences grouped by category, plus highlight tracking */
export interface PreferencesState {
  preferences: Record<PreferenceCategory, PreferenceWithHistory[]>;
  recentlyUpdated: Set<string>;
  /**
   * Facts that were *learned* in this conversation, as opposed to loaded with it.
   *
   * The transcript announces a discovery ("✓ noted — she loves peonies") for four
   * seconds, and only a live extraction deserves that. The announcing component
   * cannot tell the difference on its own: a hydrated preference and a
   * freshly-extracted one are the same shape, so it was diffing against a ref —
   * which resets on remount, and a session switch *is* a remount. Switching into a
   * conversation therefore re-announced everything Valentin had ever learned in
   * it. Only this store knows which action a row came in on, so the distinction
   * has to be recorded here.
   *
   * Keyed by id *and* value, so a corrected fact ("actually, she's vegan") counts
   * as a new discovery while a re-sent identical one does not.
   */
  discovered: Set<string>;
}

/** The `discovered` key for a preference. Shared so readers cannot drift. */
export function discoveryKey(preference: PreferenceWithHistory): string {
  return `${preference.id}:${preference.value}`;
}

/** All actions the preferences reducer can handle */
export type PreferencesAction =
  | { type: 'ADD_PREFERENCE'; preference: PreferenceWithHistory }
  | { type: 'UPDATE_PREFERENCE'; preference: PreferenceWithHistory }
  | { type: 'CLEAR_HIGHLIGHT'; preferenceId: string }
  | { type: 'LOAD_PREFERENCES'; preferences: PreferenceWithHistory[] };

/** Build an empty preferences record with all 8 categories */
function createEmptyPreferences(): Record<PreferenceCategory, PreferenceWithHistory[]> {
  const result = {} as Record<PreferenceCategory, PreferenceWithHistory[]>;
  for (const cat of PREFERENCE_CATEGORIES) {
    result[cat] = [];
  }
  return result;
}

const initialState: PreferencesState = {
  preferences: createEmptyPreferences(),
  recentlyUpdated: new Set<string>(),
  discovered: new Set<string>(),
};

/** Reducer handling all preference state transitions */
export function preferencesReducer(
  state: PreferencesState,
  action: PreferencesAction,
): PreferencesState {
  switch (action.type) {
    case 'ADD_PREFERENCE': {
      const category = action.preference.category;
      return {
        ...state,
        preferences: {
          ...state.preferences,
          [category]: [...state.preferences[category], action.preference],
        },
        // Only the socket dispatches this, and only for an extraction that has
        // just happened — so this is exactly the set worth announcing.
        discovered: new Set(state.discovered).add(discoveryKey(action.preference)),
      };
    }

    case 'UPDATE_PREFERENCE': {
      const category = action.preference.category;
      const updated = state.preferences[category].map((p) =>
        p.id === action.preference.id ? action.preference : p,
      );
      const newRecentlyUpdated = new Set(state.recentlyUpdated);
      newRecentlyUpdated.add(action.preference.id);
      return {
        ...state,
        preferences: {
          ...state.preferences,
          [category]: updated,
        },
        recentlyUpdated: newRecentlyUpdated,
        // A correction is news too: same id, new value, new key.
        discovered: new Set(state.discovered).add(discoveryKey(action.preference)),
      };
    }

    case 'CLEAR_HIGHLIGHT': {
      const newRecentlyUpdated = new Set(state.recentlyUpdated);
      newRecentlyUpdated.delete(action.preferenceId);
      return {
        ...state,
        recentlyUpdated: newRecentlyUpdated,
      };
    }

    case 'LOAD_PREFERENCES': {
      const grouped = createEmptyPreferences();
      for (const pref of action.preferences) {
        grouped[pref.category].push(pref);
      }
      return {
        preferences: grouped,
        recentlyUpdated: new Set<string>(),
        /*
         * Deliberately empty, however many rows arrived.
         *
         * This is the hydration path — a session switch, a reload, a demo reset —
         * and none of it is new information. Seeding this from `action.preferences`
         * is what made switching into a conversation flash "✓ noted" at facts
         * Valentin learned days ago.
         */
        discovered: new Set<string>(),
      };
    }

    default:
      return state;
  }
}

/** Hook wrapping useReducer with the preferences reducer */
export function usePreferencesState() {
  return useReducer(preferencesReducer, initialState);
}
