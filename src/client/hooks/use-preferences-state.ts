import { useReducer } from 'react';
import type { PreferenceCategory, PreferenceWithHistory } from '../../shared/interfaces/preference';
import { PREFERENCE_CATEGORIES } from '../../shared/constants/categories';

/** Preferences grouped by category, plus highlight tracking */
export interface PreferencesState {
  preferences: Record<PreferenceCategory, PreferenceWithHistory[]>;
  recentlyUpdated: Set<string>;
}

/** All actions the preferences reducer can handle */
export type PreferencesAction =
  | { type: 'ADD_PREFERENCE'; preference: PreferenceWithHistory }
  | { type: 'UPDATE_PREFERENCE'; preference: PreferenceWithHistory }
  | { type: 'CLEAR_HIGHLIGHT'; preferenceId: string };

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

    default:
      return state;
  }
}

/** Hook wrapping useReducer with the preferences reducer */
export function usePreferencesState() {
  return useReducer(preferencesReducer, initialState);
}
