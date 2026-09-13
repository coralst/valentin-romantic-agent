import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { Reminder } from '../../shared/interfaces/reminder';
import { apiDelete, apiGetJson } from '../utils/api-client';

/**
 * What Valentin is going to tell him, per session, kept on the server.
 *
 * The same shape as `use-outing-store` down to the action names, and for the same
 * reason it has no `addOuting`: **the client never creates a row.** Reminders are
 * written by `set_reminder` when he asks for one and by `syncReminders` when a date
 * lands on her profile. A row invented here would be a promise nothing is going to
 * keep — the sweeper reads the table, not this store.
 *
 * So the client's only write is a cancel, and even that is two different writes
 * underneath. See {@link cancelReminder}.
 */
export interface ReminderStoreState {
  reminders: Reminder[];
  storageError: string | null;
}

export type ReminderStoreAction =
  /** Drop one row locally. The server call it implies depends on the row's kind. */
  | { type: 'CANCEL_REMINDER'; id: string }
  /**
   * One whole row as the server has it, for a `reminder_update` frame. Not written
   * back: the server is where it came from, and echoing it would race the write.
   */
  | { type: 'MERGE_REMINDER'; reminder: Reminder }
  | { type: 'RESTORE'; reminders: Reminder[] }
  | { type: 'CLEAR_ALL_REMINDERS' }
  | { type: 'STORAGE_ERROR'; message: string };

const STORAGE_KEY_PREFIX = 'valentin-reminders-';
const STORAGE_VERSION = 1;

interface StorageSchema {
  version: number;
  reminders: Reminder[];
}

const initialState: ReminderStoreState = { reminders: [], storageError: null };

export function reminderStoreReducer(
  state: ReminderStoreState,
  action: ReminderStoreAction,
): ReminderStoreState {
  switch (action.type) {
    case 'CANCEL_REMINDER':
      return {
        ...state,
        reminders: state.reminders.filter((reminder) => reminder.id !== action.id),
        storageError: null,
      };

    case 'MERGE_REMINDER': {
      const held = state.reminders.some((reminder) => reminder.id === action.reminder.id);
      return {
        ...state,
        reminders: held
          ? state.reminders.map((reminder) =>
              reminder.id === action.reminder.id ? action.reminder : reminder,
            )
          : [...state.reminders, action.reminder],
        storageError: null,
      };
    }

    case 'RESTORE':
      return { ...state, reminders: action.reminders };

    case 'CLEAR_ALL_REMINDERS':
      // Paired with `CLEAR_ALL_OUTINGS` and `CLEAR_ALL_TASKS`: "forget her" must not
      // leave a queue of mail about her birthday behind it.
      return { ...state, reminders: [], storageError: null };

    case 'STORAGE_ERROR':
      return { ...state, storageError: action.message };

    default:
      return state;
  }
}

/**
 * Drop anything that would not render as a row.
 *
 * `dueAt` and `occursOn` are the row: one is when he hears about it and the other is
 * what it is about, and both are drawn. A record missing either would render as a
 * countdown to nothing, in an unpredictable position — `dueAt` is the sort key.
 */
export function sanitiseReminders(reminders: unknown): Reminder[] {
  if (!Array.isArray(reminders)) return [];

  return reminders.filter((candidate): candidate is Reminder => {
    if (!candidate || typeof candidate !== 'object') return false;
    const reminder = candidate as Partial<Reminder>;
    return (
      typeof reminder.id === 'string' &&
      typeof reminder.dueAt === 'string' &&
      typeof reminder.occursOn === 'string' &&
      // Both readers fall back to `occasion`, so it is the one text field that must
      // be there; `title` is legitimately absent on every planner row.
      typeof reminder.occasion === 'string'
    );
  });
}

export function loadRemindersFromStorage(sessionId: string): Reminder[] | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${sessionId}`);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as StorageSchema;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== STORAGE_VERSION) {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${sessionId}`);
      return null;
    }

    return sanitiseReminders(parsed.reminders);
  } catch {
    try {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${sessionId}`);
    } catch {
      // If removal also fails there is nothing further to do.
    }
    return null;
  }
}

export function saveRemindersToStorage(
  sessionId: string,
  reminders: Reminder[],
): string | null {
  try {
    const data: StorageSchema = { version: STORAGE_VERSION, reminders };
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${sessionId}`, JSON.stringify(data));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Failed to save what you will be reminded of';
  }
}

/** Read every reminder for the session back from the server, soonest first. */
export async function fetchReminders(sessionId: string): Promise<Reminder[]> {
  const { reminders } = await apiGetJson<{ reminders: unknown }>(
    `/api/session/${encodeURIComponent(sessionId)}/reminders`,
  );
  return sanitiseReminders(reminders);
}

/**
 * Stop one reminder for good.
 *
 * Deliberately one call for both kinds. Whether that means deleting the row or muting
 * its kind is decided server-side by `cancelReminderDurably`, because the mute has to
 * be *additive* — muting her birthday must not un-mute an anniversary he silenced last
 * week — and a client holding its own copy of the muted list is a client racing
 * another tab, where the losing write silently un-mutes a kind.
 */
export async function removeReminder(sessionId: string, reminderId: string): Promise<void> {
  await apiDelete(
    `/api/session/${encodeURIComponent(sessionId)}/reminders/${encodeURIComponent(reminderId)}`,
  );
}

export function useReminderStore(sessionId: string | null) {
  const [state, localDispatch] = useReducer(reminderStoreReducer, initialState);

  /** The list as the reducer last left it, so a cancel can read the row's kind. */
  const remindersRef = useRef(state.reminders);
  remindersRef.current = state.reminders;

  useEffect(() => {
    if (!sessionId) return;

    const cached = loadRemindersFromStorage(sessionId);
    if (cached) localDispatch({ type: 'RESTORE', reminders: cached });

    let live = true;
    void fetchReminders(sessionId)
      .then((reminders) => {
        if (live) localDispatch({ type: 'RESTORE', reminders });
      })
      .catch((err: unknown) => {
        if (live) {
          localDispatch({
            type: 'STORAGE_ERROR',
            message: `Showing your reminders from this device — ${
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
    const error = saveRemindersToStorage(sessionId, state.reminders);
    if (error) localDispatch({ type: 'STORAGE_ERROR', message: error });
  }, [sessionId, state.reminders]);

  const dispatch = useCallback(
    (action: ReminderStoreAction) => {
      localDispatch(action);
      if (!sessionId) return;

      const fail = (err: unknown) =>
        localDispatch({
          type: 'STORAGE_ERROR',
          message: `Could not cancel that reminder — ${
            err instanceof Error ? err.message : 'the server did not answer'
          }`,
        });

      switch (action.type) {
        case 'CANCEL_REMINDER':
          // One call for both kinds. The server decides whether that is a delete or a
          // mute; see `removeReminder` on why the client must not decide.
          void removeReminder(sessionId, action.id).catch(fail);
          break;

        case 'CLEAR_ALL_REMINDERS':
          void Promise.all(
            remindersRef.current.map((reminder) => removeReminder(sessionId, reminder.id)),
          ).catch(fail);
          break;

        default:
          break;
      }
    },
    [sessionId],
  );

  /**
   * Stop one reminder, whichever kind it is.
   *
   * Its own function for the same reason `rateOuting` is: it is the one control on
   * this surface, and naming it keeps the kind-branch in one place rather than at
   * every call site that draws a Cancel button.
   */
  const cancelReminder = useCallback(
    (id: string) => {
      dispatch({ type: 'CANCEL_REMINDER', id });
    },
    [dispatch],
  );

  return { state, dispatch, cancelReminder };
}
