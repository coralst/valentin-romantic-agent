import { useReducer, useEffect, useCallback, useRef } from 'react';
import { apiDelete, apiGetJson, apiPutJson } from '../utils/api-client';

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
  /**
   * Empty the store because we are now looking at a different conversation.
   *
   * Distinct from `CLEAR_ALL_VALUES`, which is the *user* asking to forget her —
   * that one is exported through `dispatch` and deletes every manual value on the
   * server too. This one is local bookkeeping and must never reach the network.
   */
  | { type: 'RESET_FOR_SESSION' }
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

/** An empty store. Exported so `RESET_FOR_SESSION` has one definition of "empty". */
export const initialState: ProfileStoreState = {
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

    /*
     * Every field of the store is scoped to one conversation, so all of it goes.
     *
     * `RESTORE` spreading `...state` was the bug: it replaced the photo and the
     * manual values but carried `discoveredValues` and `rejectedFieldIds` across a
     * session switch. Ingestion only ever *adds* (`SET_DISCOVERED_VALUE` merges),
     * so nothing downstream could unset them — and her brief showed the previous
     * partner's colour, cuisine and star sign next to the new partner's name.
     * `rejectedFieldIds` leaked the same way, so declining a guess in one
     * conversation silently suppressed the field in another.
     */
    case 'RESET_FOR_SESSION':
      return initialState;

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

/**
 * Read the corrections he has typed back from the server.
 *
 * The route answers `Record<fieldId, string>` — a stored `MANUAL#` row is the
 * value and nothing else — so the source and the timestamp are reconstructed
 * here. `updatedAt` is honest to within one hydration: where the cache holds the
 * same value, its original stamp is kept rather than being reset to now, so "you
 * told me this in June" does not become "you told me this just now" on reload.
 */
export async function fetchManualValues(
  sessionId: string,
  cached: Record<string, ProfileFieldValue> = {},
): Promise<Record<string, ProfileFieldValue>> {
  const { manualValues } = await apiGetJson<{ manualValues: Record<string, string> }>(
    `/api/session/${encodeURIComponent(sessionId)}/manual`,
  );

  const now = new Date().toISOString();
  const restored: Record<string, ProfileFieldValue> = {};
  for (const [fieldId, value] of Object.entries(manualValues ?? {})) {
    if (typeof value !== 'string') continue;
    const previous = cached[fieldId];
    restored[fieldId] = {
      value,
      source: 'manual',
      updatedAt: previous?.value === value ? previous.updatedAt : now,
    };
  }
  return restored;
}

/** Write one correction. */
export async function pushManualValue(
  sessionId: string,
  fieldId: string,
  value: string,
): Promise<void> {
  await apiPutJson(
    `/api/session/${encodeURIComponent(sessionId)}/manual/${encodeURIComponent(fieldId)}`,
    { value },
  );
}

/** Take one correction back. */
export async function clearManualValueOnServer(
  sessionId: string,
  fieldId: string,
): Promise<void> {
  await apiDelete(
    `/api/session/${encodeURIComponent(sessionId)}/manual/${encodeURIComponent(fieldId)}`,
  );
}

/**
 * The profile store: reducer, server-backed corrections, cached locally.
 *
 * What lives where, and why:
 * - **Manual values** are on the server. A correction that never left the
 *   browser was the bug: he fixes her ring size on his phone and Valentin is
 *   still wrong about it on his laptop.
 * - **Her photo** stays in `localStorage`. It is a data URL, not a profile
 *   field, and there is no `MANUAL#` row shaped to hold half a megabyte of
 *   base64.
 * - **Discovered values** are neither: they are ingested from the preferences,
 *   which are already stored, so persisting them here would be a second copy
 *   that can disagree with the first.
 * - **Rejections** are in memory for the session. Their whole job is to stop
 *   ingestion re-offering a guess he just declined, and that is a fact about
 *   this sitting.
 */
export function useProfileStore(sessionId: string | null) {
  const [state, localDispatch] = useReducer(profileStoreReducer, initialState);

  /** The corrections as the reducer last left them — see `usePeopleStore`. */
  const manualRef = useRef(state.manualValues);
  manualRef.current = state.manualValues;

  /*
   * Empty the store the moment the conversation changes — during render, not in an
   * effect.
   *
   * `RESTORE` alone was not enough: it spreads `...state`, so a session switch
   * replaced the photo and the corrections but carried the previous partner's
   * `discoveredValues` and `rejectedFieldIds` across, and her brief showed one
   * partner's colour and star sign beside another partner's name.
   *
   * The reset has to happen in the render phase because the hook that refills the
   * store — `usePreferenceIngestion` — is mounted in `AppLayoutContent`, a *child*
   * of this provider. React runs passive effects children-first, so an effect here
   * would fire *after* ingestion had already written the incoming session's values,
   * and would then wipe those instead of the outgoing ones. Adjusting state during
   * render is React's documented answer to "a prop changed and my state is stale":
   * the dispatch is discarded-and-rerun before this component commits, so no child
   * ever renders against, or ingests into, the previous session's store.
   *
   * A `key` on the provider would also work, and is wrong here for a different
   * reason: it would remount the whole subtree, closing the architecture drawer and
   * resetting the layout every time the user picked a different conversation.
   */
  const storeSessionRef = useRef(sessionId);
  if (storeSessionRef.current !== sessionId) {
    storeSessionRef.current = sessionId;
    localDispatch({ type: 'RESET_FOR_SESSION' });
  }

  // Cache first (the photo, and last-known corrections), then the server.
  useEffect(() => {
    if (!sessionId) return;

    const stored = loadFromStorage(sessionId);
    if (stored) {
      localDispatch({ type: 'RESTORE', state: stored });
    }

    let live = true;
    void fetchManualValues(sessionId, stored?.manualValues ?? {})
      .then((manualValues) => {
        if (live) {
          localDispatch({
            type: 'RESTORE',
            // The photo is not on the server, so it is carried through from the
            // cache rather than being dropped by this second RESTORE.
            state: { partnerPhoto: stored?.partnerPhoto ?? null, manualValues },
          });
        }
      })
      .catch((err: unknown) => {
        if (live) {
          localDispatch({
            type: 'STORAGE_ERROR',
            message: `Showing your corrections from this device — ${
              err instanceof Error ? err.message : 'the server did not answer'
            }`,
          });
        }
      });

    return () => {
      live = false;
    };
  }, [sessionId]);

  // Save to localStorage on every state change (debounced by React batching)
  useEffect(() => {
    if (!sessionId) return;
    const error = saveToStorage(sessionId, state);
    if (error) {
      localDispatch({ type: 'STORAGE_ERROR', message: error });
    }
  }, [sessionId, state.partnerPhoto, state.manualValues]);

  /**
   * Reduce now, write to the server after.
   *
   * Optimistic for the same reason the people store is: typing her bra size and
   * waiting on a round trip before the field shows it reads as a dropped
   * keystroke.
   */
  const dispatch = useCallback(
    (action: ProfileStoreAction) => {
      localDispatch(action);
      if (!sessionId) return;

      const fail = (err: unknown) =>
        localDispatch({
          type: 'STORAGE_ERROR',
          message: `Could not save your correction — ${
            err instanceof Error ? err.message : 'the server did not answer'
          }`,
        });

      switch (action.type) {
        case 'SET_MANUAL_VALUE':
          void pushManualValue(sessionId, action.fieldId, action.value).catch(fail);
          break;

        case 'CLEAR_MANUAL_VALUE':
          void clearManualValueOnServer(sessionId, action.fieldId).catch(fail);
          break;

        case 'CLEAR_ALL_VALUES':
          // Only the corrections are the server's to forget. The preferences
          // behind the discovered values are cleared by the reset route, and the
          // photo goes with the cache.
          void Promise.all(
            Object.keys(manualRef.current).map((fieldId) =>
              clearManualValueOnServer(sessionId, fieldId),
            ),
          ).catch(fail);
          break;

        // The photo, the discovered values and the rejections are all local by
        // design — see the note on this hook.
        default:
          break;
      }
    },
    [sessionId],
  );

  /** Get the effective value for a field (manual takes priority over discovered) */
  const getFieldValue = useCallback(
    (fieldId: string): ProfileFieldValue | null => {
      return state.manualValues[fieldId] ?? state.discoveredValues[fieldId] ?? null;
    },
    [state.manualValues, state.discoveredValues],
  );

  return { state, dispatch, getFieldValue };
}
