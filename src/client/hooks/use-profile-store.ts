import { useReducer, useEffect, useCallback } from 'react';

/** Value stored for a profile field */
export interface ProfileFieldValue {
  value: string;
  source: 'discovered' | 'manual';
  confidence?: number;
  updatedAt: string;
}

/** State shape for the profile store */
export interface ProfileStoreState {
  partnerPhoto: string | null;
  manualValues: Record<string, ProfileFieldValue>;
  discoveredValues: Record<string, ProfileFieldValue>;
  /**
   * Fields whose discovered value the user has explicitly rejected.
   *
   * Rejecting is not the same as deleting, and this is the difference. The
   * *preference* that produced the value still sits in the preferences store, so
   * without a record of the rejection two things immediately undo it: ingestion
   * re-dispatches `SET_DISCOVERED_VALUE` for the same preference, and the
   * dossier's "Confirm my guesses" card re-derives the same question. Both were
   * visible in the Stage 6 screenshots — pressing ✗ ten times cleared exactly one
   * field, because the other nine came straight back.
   *
   * A manual value on the same field supersedes the rejection: answering by hand
   * is a stronger signal than declining a guess.
   */
  rejectedFieldIds: string[];
  storageError: string | null;
}

/** Actions for the profile store reducer */
export type ProfileStoreAction =
  | { type: 'SET_PHOTO'; dataUrl: string }
  | { type: 'REMOVE_PHOTO' }
  | { type: 'SET_MANUAL_VALUE'; fieldId: string; value: string }
  | { type: 'CLEAR_MANUAL_VALUE'; fieldId: string }
  | { type: 'SET_DISCOVERED_VALUE'; fieldId: string; value: string; confidence: number }
  /**
   * Drops a discovered value the user has explicitly rejected — the ✗ on the
   * dossier's "Confirm my guesses" card.
   *
   * `CLEAR_MANUAL_VALUE` cannot serve this: a rejected guess has no manual value
   * to clear, and clearing the manual slot would *reveal* the discovered value
   * underneath (`getFieldValue` falls through to it) rather than removing it.
   *
   * Also records the rejection in `rejectedFieldIds`, without which the value is
   * re-ingested from the still-present preference on the next render.
   */
  | { type: 'CLEAR_DISCOVERED_VALUE'; fieldId: string }
  | { type: 'RESTORE'; state: Partial<ProfileStoreState> }
  | { type: 'CLEAR_ALL_VALUES' }
  | { type: 'STORAGE_ERROR'; message: string }
  | { type: 'CLEAR_STORAGE_ERROR' };

const STORAGE_KEY_PREFIX = 'valentin-profile-';
const STORAGE_VERSION = 1;

interface StorageSchema {
  version: number;
  partnerPhoto: string | null;
  manualValues: Record<string, ProfileFieldValue>;
}

const initialState: ProfileStoreState = {
  partnerPhoto: null,
  manualValues: {},
  discoveredValues: {},
  rejectedFieldIds: [],
  storageError: null,
};

/** Profile store reducer */
export function profileStoreReducer(
  state: ProfileStoreState,
  action: ProfileStoreAction,
): ProfileStoreState {
  switch (action.type) {
    case 'SET_PHOTO':
      return { ...state, partnerPhoto: action.dataUrl, storageError: null };

    case 'REMOVE_PHOTO':
      return { ...state, partnerPhoto: null, storageError: null };

    case 'SET_MANUAL_VALUE': {
      const fieldValue: ProfileFieldValue = {
        value: action.value,
        source: 'manual',
        updatedAt: new Date().toISOString(),
      };
      return {
        ...state,
        manualValues: { ...state.manualValues, [action.fieldId]: fieldValue },
        // Answering by hand overrides an earlier rejection of the same field, so
        // a later extraction of a *different* value can surface as a guess again.
        rejectedFieldIds: state.rejectedFieldIds.filter((id) => id !== action.fieldId),
        storageError: null,
      };
    }

    case 'CLEAR_MANUAL_VALUE': {
      const { [action.fieldId]: _, ...rest } = state.manualValues;
      return { ...state, manualValues: rest, storageError: null };
    }

    case 'SET_DISCOVERED_VALUE': {
      const fieldValue: ProfileFieldValue = {
        value: action.value,
        source: 'discovered',
        confidence: action.confidence,
        updatedAt: new Date().toISOString(),
      };
      return {
        ...state,
        discoveredValues: { ...state.discoveredValues, [action.fieldId]: fieldValue },
      };
    }

    case 'CLEAR_DISCOVERED_VALUE': {
      const { [action.fieldId]: _, ...rest } = state.discoveredValues;
      return {
        ...state,
        discoveredValues: rest,
        rejectedFieldIds: state.rejectedFieldIds.includes(action.fieldId)
          ? state.rejectedFieldIds
          : [...state.rejectedFieldIds, action.fieldId],
      };
    }

    case 'RESTORE':
      return {
        ...state,
        partnerPhoto: action.state.partnerPhoto ?? null,
        manualValues: action.state.manualValues ?? {},
      };

    case 'CLEAR_ALL_VALUES':
      return {
        ...state,
        partnerPhoto: null,
        manualValues: {},
        discoveredValues: {},
        rejectedFieldIds: [],
        storageError: null,
      };

    case 'STORAGE_ERROR':
      return { ...state, storageError: action.message };

    case 'CLEAR_STORAGE_ERROR':
      return { ...state, storageError: null };

    default:
      return state;
  }
}

/** Load profile data from localStorage */
export function loadFromStorage(sessionId: string): Partial<ProfileStoreState> | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${sessionId}`);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as StorageSchema;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== STORAGE_VERSION) {
      // Incompatible version or corrupt data — discard
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${sessionId}`);
      return null;
    }

    return {
      partnerPhoto: parsed.partnerPhoto ?? null,
      manualValues: parsed.manualValues ?? {},
    };
  } catch {
    // Corrupt data — discard (R7.3)
    try {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${sessionId}`);
    } catch {
      // If removal also fails, just continue
    }
    return null;
  }
}

/** Save profile data to localStorage */
export function saveToStorage(sessionId: string, state: ProfileStoreState): string | null {
  try {
    const data: StorageSchema = {
      version: STORAGE_VERSION,
      partnerPhoto: state.partnerPhoto,
      manualValues: state.manualValues,
    };
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${sessionId}`, JSON.stringify(data));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Failed to save profile data';
  }
}

/** Hook wrapping useReducer with localStorage persistence */
export function useProfileStore(sessionId: string | null) {
  const [state, dispatch] = useReducer(profileStoreReducer, initialState);

  // Restore from localStorage on mount or sessionId change
  useEffect(() => {
    if (!sessionId) return;
    const stored = loadFromStorage(sessionId);
    if (stored) {
      dispatch({ type: 'RESTORE', state: stored });
    }
  }, [sessionId]);

  // Save to localStorage on every state change (debounced by React batching)
  useEffect(() => {
    if (!sessionId) return;
    const error = saveToStorage(sessionId, state);
    if (error) {
      dispatch({ type: 'STORAGE_ERROR', message: error });
    }
  }, [sessionId, state.partnerPhoto, state.manualValues]);

  /** Get the effective value for a field (manual takes priority over discovered) */
  const getFieldValue = useCallback(
    (fieldId: string): ProfileFieldValue | null => {
      return state.manualValues[fieldId] ?? state.discoveredValues[fieldId] ?? null;
    },
    [state.manualValues, state.discoveredValues],
  );

  return { state, dispatch, getFieldValue };
}
