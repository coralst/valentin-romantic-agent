import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { Outing, OutingVerdict } from '../../shared/interfaces/outing';
import { apiDelete, apiGetJson, apiPostJson } from '../utils/api-client';

/**
 * Where he has taken her, per session, kept on the server.
 *
 * The same shape as `use-task-store` down to the action names, because the two
 * boards sit side by side in the dossier and a reader should not have to learn a
 * second idiom. What differs is who writes: a task is created by the user or the
 * extractor, whereas an outing row is created by the *server* when a booking is
 * confirmed. The client's only write is the survey.
 *
 * So there is deliberately no `addOuting`. A row the UI invented would be a place
 * he claims to have been, and the whole value of this record — for the prompt
 * block and for the reminder's "you have been here before" line — is that every
 * row corresponds to a real confirmed booking.
 */
export interface OutingStoreState {
  outings: Outing[];
  storageError: string | null;
}

export type OutingStoreAction =
  /**
   * The survey answer, and the only write the UI makes. A partial patch rather
   * than a whole row so a rating cannot silently rewrite the venue.
   */
  | {
      type: 'RATE_OUTING';
      id: string;
      patch: { rating?: number | null; verdict?: OutingVerdict | null; note?: string | null };
    }
  /**
   * One whole row as the server has it — an `outing_update` frame arriving the
   * moment he presses Confirm on a proposal card. Not written back: the server
   * is where it came from, and echoing it would race the write that sent it.
   */
  | { type: 'MERGE_OUTING'; outing: Outing }
  | { type: 'REMOVE_OUTING'; id: string }
  | { type: 'RESTORE'; outings: Outing[] }
  | { type: 'CLEAR_ALL_OUTINGS' }
  | { type: 'STORAGE_ERROR'; message: string };

const STORAGE_KEY_PREFIX = 'valentin-outings-';
const STORAGE_VERSION = 1;

interface StorageSchema {
  version: number;
  outings: Outing[];
}

const initialState: OutingStoreState = { outings: [], storageError: null };

export function outingStoreReducer(
  state: OutingStoreState,
  action: OutingStoreAction,
): OutingStoreState {
  switch (action.type) {
    case 'RATE_OUTING':
      return {
        ...state,
        outings: state.outings.map((outing) =>
          outing.id === action.id
            ? // `ratedAt` is stamped here as well as on the server so the row
              // reads as answered immediately; the server's value wins on the
              // next `RESTORE`, and the two agree to within a round trip.
              { ...outing, ...action.patch, ratedAt: new Date().toISOString() }
            : outing,
        ),
        storageError: null,
      };

    case 'MERGE_OUTING': {
      const held = state.outings.some((outing) => outing.id === action.outing.id);
      return {
        ...state,
        outings: held
          ? state.outings.map((outing) =>
              outing.id === action.outing.id ? action.outing : outing,
            )
          : [...state.outings, action.outing],
        storageError: null,
      };
    }

    case 'REMOVE_OUTING':
      return {
        ...state,
        outings: state.outings.filter((outing) => outing.id !== action.id),
        storageError: null,
      };

    case 'RESTORE':
      return { ...state, outings: action.outings };

    case 'CLEAR_ALL_OUTINGS':
      // Paired with `CLEAR_ALL_TASKS` and the profile store's
      // `CLEAR_ALL_VALUES`: "forget her" must not leave behind a list of the
      // restaurants he took her to.
      return { ...state, outings: [], storageError: null };

    case 'STORAGE_ERROR':
      return { ...state, storageError: action.message };

    default:
      return state;
  }
}

/**
 * Drop anything that would not render as a row.
 *
 * A name and a `confirmedAt` are the row: the name is the line and `confirmedAt`
 * is what the history and the survey both sort by, so a record missing either
 * would draw as a blank entry in an unpredictable position.
 */
export function sanitiseOutings(outings: unknown): Outing[] {
  if (!Array.isArray(outings)) return [];

  return outings.filter((candidate): candidate is Outing => {
    if (!candidate || typeof candidate !== 'object') return false;
    const outing = candidate as Partial<Outing>;
    return (
      typeof outing.id === 'string' &&
      typeof outing.venueName === 'string' &&
      outing.venueName.trim().length > 0 &&
      typeof outing.confirmedAt === 'string'
    );
  });
}

export function loadOutingsFromStorage(sessionId: string): Outing[] | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${sessionId}`);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as StorageSchema;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== STORAGE_VERSION) {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${sessionId}`);
      return null;
    }

    return sanitiseOutings(parsed.outings);
  } catch {
    try {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${sessionId}`);
    } catch {
      // If removal also fails there is nothing further to do.
    }
    return null;
  }
}

export function saveOutingsToStorage(sessionId: string, outings: Outing[]): string | null {
  try {
    const data: StorageSchema = { version: STORAGE_VERSION, outings };
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${sessionId}`, JSON.stringify(data));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Failed to save where you have been';
  }
}

/** Read the whole history back from the server. */
export async function fetchOutings(sessionId: string): Promise<Outing[]> {
  const { outings } = await apiGetJson<{ outings: unknown }>(
    `/api/session/${encodeURIComponent(sessionId)}/outings`,
  );
  return sanitiseOutings(outings);
}

/**
 * Upsert one row. The survey resends the whole row with a rating on it — the same
 * "tick a task by resending it" idiom, which is why there is no `/rating` route.
 */
export async function pushOuting(sessionId: string, outing: Outing): Promise<void> {
  await apiPostJson(`/api/session/${encodeURIComponent(sessionId)}/outings`, outing);
}

/** Drop one row for good. */
export async function removeOuting(sessionId: string, outingId: string): Promise<void> {
  await apiDelete(
    `/api/session/${encodeURIComponent(sessionId)}/outings/${encodeURIComponent(outingId)}`,
  );
}

export function useOutingStore(sessionId: string | null) {
  const [state, localDispatch] = useReducer(outingStoreReducer, initialState);

  /** The list as the reducer last left it — `RATE_OUTING` patches, the server takes rows. */
  const outingsRef = useRef(state.outings);
  outingsRef.current = state.outings;

  useEffect(() => {
    if (!sessionId) return;

    const cached = loadOutingsFromStorage(sessionId);
    if (cached) localDispatch({ type: 'RESTORE', outings: cached });

    let live = true;
    void fetchOutings(sessionId)
      .then((outings) => {
        if (live) localDispatch({ type: 'RESTORE', outings });
      })
      .catch((err: unknown) => {
        if (live) {
          localDispatch({
            type: 'STORAGE_ERROR',
            message: `Showing where you have been from this device — ${
              err instanceof Error ? err.message : 'the server did not answer'
            }`,
          });
        }
      });

    return () => {
      live = false;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const error = saveOutingsToStorage(sessionId, state.outings);
    if (error) localDispatch({ type: 'STORAGE_ERROR', message: error });
  }, [sessionId, state.outings]);

  const dispatch = useCallback(
    (action: OutingStoreAction) => {
      localDispatch(action);
      if (!sessionId) return;

      const fail = (err: unknown) =>
        localDispatch({
          type: 'STORAGE_ERROR',
          message: `Could not save how it went — ${
            err instanceof Error ? err.message : 'the server did not answer'
          }`,
        });

      switch (action.type) {
        case 'RATE_OUTING': {
          const current = outingsRef.current.find((outing) => outing.id === action.id);
          if (current) {
            void pushOuting(sessionId, {
              ...current,
              ...action.patch,
              ratedAt: new Date().toISOString(),
            }).catch(fail);
          }
          break;
        }

        case 'REMOVE_OUTING':
          void removeOuting(sessionId, action.id).catch(fail);
          break;

        case 'CLEAR_ALL_OUTINGS':
          void Promise.all(
            outingsRef.current.map((outing) => removeOuting(sessionId, outing.id)),
          ).catch(fail);
          break;

        default:
          break;
      }
    },
    [sessionId],
  );

  /**
   * Answer the survey for one outing.
   *
   * Its own function rather than leaving every caller to spell out `RATE_OUTING`,
   * for the same reason `toggleTask` exists: it is the one control on this board,
   * and naming it keeps the survey's shape in one place.
   */
  const rateOuting = useCallback(
    (
      id: string,
      patch: { rating?: number | null; verdict?: OutingVerdict | null; note?: string | null },
    ) => {
      dispatch({ type: 'RATE_OUTING', id, patch });
    },
    [dispatch],
  );

  return { state, dispatch, rateOuting };
}
