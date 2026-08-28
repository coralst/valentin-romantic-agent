import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { Task } from '../../shared/interfaces/task';
import { apiDelete, apiGetJson, apiPostJson } from '../utils/api-client';

/**
 * What he has to do, per session, kept on the server.
 *
 * The same shape as `use-people-store` deliberately — reducer, optimistic
 * dispatch, `localStorage` as a cache in front of DynamoDB — because the two
 * boards sit side by side and behave identically. What is different is why it
 * cannot be derived: the tick. See the header of `shared/interfaces/task.ts`.
 *
 * A tick that does not survive a reload is worse than no list at all, so this
 * one is server-first from the day it ships rather than promoted from
 * `localStorage` later like the family tree was.
 */
export interface TaskStoreState {
  tasks: Task[];
  storageError: string | null;
}

export type TaskStoreAction =
  | { type: 'ADD_TASK'; task: Omit<Task, 'createdAt' | 'updatedAt'> }
  /** Any subset of a row's fields — the tick, a new due date, a reworded title. */
  | { type: 'UPDATE_TASK'; id: string; patch: Partial<Omit<Task, 'id' | 'createdAt'>> }
  /**
   * One whole row as the server has it — a `task_update` frame arriving while he
   * is still talking. Not written back; see `MERGE_PERSON` for the full reason.
   */
  | { type: 'MERGE_TASK'; task: Task }
  | { type: 'REMOVE_TASK'; id: string }
  | { type: 'RESTORE'; tasks: Task[] }
  | { type: 'CLEAR_ALL_TASKS' }
  | { type: 'STORAGE_ERROR'; message: string };

const STORAGE_KEY_PREFIX = 'valentin-tasks-';
const STORAGE_VERSION = 1;

interface StorageSchema {
  version: number;
  tasks: Task[];
}

const initialState: TaskStoreState = { tasks: [], storageError: null };

/** `crypto.randomUUID` where it exists — same fallback as `newPersonId`. */
export function newTaskId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `t-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export function taskStoreReducer(
  state: TaskStoreState,
  action: TaskStoreAction,
): TaskStoreState {
  switch (action.type) {
    case 'ADD_TASK': {
      const stamp = new Date().toISOString();
      const task: Task = { ...action.task, createdAt: stamp, updatedAt: stamp };
      return { ...state, tasks: [...state.tasks, task], storageError: null };
    }

    case 'UPDATE_TASK':
      return {
        ...state,
        tasks: state.tasks.map((task) =>
          task.id === action.id
            ? // `createdAt` is deliberately not patchable: ticking a task must
              // not reset how long it has been outstanding.
              { ...task, ...action.patch, updatedAt: new Date().toISOString() }
            : task,
        ),
        storageError: null,
      };

    case 'MERGE_TASK': {
      const held = state.tasks.some((task) => task.id === action.task.id);
      return {
        ...state,
        tasks: held
          ? state.tasks.map((task) => (task.id === action.task.id ? action.task : task))
          : [...state.tasks, action.task],
        storageError: null,
      };
    }

    case 'REMOVE_TASK':
      return {
        ...state,
        tasks: state.tasks.filter((task) => task.id !== action.id),
        storageError: null,
      };

    case 'RESTORE':
      return { ...state, tasks: action.tasks };

    case 'CLEAR_ALL_TASKS':
      // Paired with the profile store's `CLEAR_ALL_VALUES` and the people
      // store's `CLEAR_ALL_PEOPLE`: "forget her" must not leave a reminder to
      // buy her mother a card.
      return { ...state, tasks: [], storageError: null };

    case 'STORAGE_ERROR':
      return { ...state, storageError: action.message };

    default:
      return state;
  }
}

/**
 * Drop anything that would not render as a row.
 *
 * A title is the row, and `done` decides which half of the list it lands in — a
 * record without them would draw as a blank line with a checkbox.
 */
export function sanitiseTasks(tasks: unknown): Task[] {
  if (!Array.isArray(tasks)) return [];

  return tasks.filter((candidate): candidate is Task => {
    if (!candidate || typeof candidate !== 'object') return false;
    const task = candidate as Partial<Task>;
    return (
      typeof task.id === 'string' &&
      typeof task.title === 'string' &&
      task.title.trim().length > 0 &&
      typeof task.done === 'boolean'
    );
  });
}

export function loadTasksFromStorage(sessionId: string): Task[] | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${sessionId}`);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as StorageSchema;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== STORAGE_VERSION) {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${sessionId}`);
      return null;
    }

    return sanitiseTasks(parsed.tasks);
  } catch {
    try {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${sessionId}`);
    } catch {
      // If removal also fails there is nothing further to do.
    }
    return null;
  }
}

export function saveTasksToStorage(sessionId: string, tasks: Task[]): string | null {
  try {
    const data: StorageSchema = { version: STORAGE_VERSION, tasks };
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${sessionId}`, JSON.stringify(data));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Failed to save his list';
  }
}

/** Read the whole list back from the server. */
export async function fetchTasks(sessionId: string): Promise<Task[]> {
  const { tasks } = await apiGetJson<{ tasks: unknown }>(
    `/api/session/${encodeURIComponent(sessionId)}/tasks`,
  );
  return sanitiseTasks(tasks);
}

/** Upsert one row. The server keys on `id`, so this covers add, edit and tick. */
export async function pushTask(sessionId: string, task: Task): Promise<void> {
  await apiPostJson(`/api/session/${encodeURIComponent(sessionId)}/tasks`, task);
}

/** Drop one row for good. */
export async function removeTask(sessionId: string, taskId: string): Promise<void> {
  await apiDelete(
    `/api/session/${encodeURIComponent(sessionId)}/tasks/${encodeURIComponent(taskId)}`,
  );
}

export function useTaskStore(sessionId: string | null) {
  const [state, localDispatch] = useReducer(taskStoreReducer, initialState);

  /** The list as the reducer last left it — `UPDATE_TASK` patches, the server takes rows. */
  const tasksRef = useRef(state.tasks);
  tasksRef.current = state.tasks;

  useEffect(() => {
    if (!sessionId) return;

    const cached = loadTasksFromStorage(sessionId);
    if (cached) localDispatch({ type: 'RESTORE', tasks: cached });

    let live = true;
    void fetchTasks(sessionId)
      .then((tasks) => {
        if (live) localDispatch({ type: 'RESTORE', tasks });
      })
      .catch((err: unknown) => {
        if (live) {
          localDispatch({
            type: 'STORAGE_ERROR',
            message: `Showing his list from this device — ${
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
    const error = saveTasksToStorage(sessionId, state.tasks);
    if (error) localDispatch({ type: 'STORAGE_ERROR', message: error });
  }, [sessionId, state.tasks]);

  const dispatch = useCallback(
    (action: TaskStoreAction) => {
      localDispatch(action);
      if (!sessionId) return;

      const fail = (err: unknown) =>
        localDispatch({
          type: 'STORAGE_ERROR',
          message: `Could not save his list — ${
            err instanceof Error ? err.message : 'the server did not answer'
          }`,
        });

      switch (action.type) {
        case 'ADD_TASK': {
          const stamp = new Date().toISOString();
          void pushTask(sessionId, {
            ...action.task,
            createdAt: stamp,
            updatedAt: stamp,
          }).catch(fail);
          break;
        }

        case 'UPDATE_TASK': {
          const current = tasksRef.current.find((task) => task.id === action.id);
          if (current) {
            void pushTask(sessionId, {
              ...current,
              ...action.patch,
              updatedAt: new Date().toISOString(),
            }).catch(fail);
          }
          break;
        }

        case 'REMOVE_TASK':
          void removeTask(sessionId, action.id).catch(fail);
          break;

        case 'CLEAR_ALL_TASKS':
          void Promise.all(
            tasksRef.current.map((task) => removeTask(sessionId, task.id)),
          ).catch(fail);
          break;

        default:
          break;
      }
    },
    [sessionId],
  );

  /** Add a row and mint its id — the only way the UI creates one. */
  const addTask = useCallback(
    (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'done'> & { done?: boolean }) => {
      dispatch({
        type: 'ADD_TASK',
        task: { ...task, id: newTaskId(), done: task.done ?? false },
      });
    },
    [dispatch],
  );

  /**
   * Tick or un-tick one row.
   *
   * Its own function rather than leaving every caller to spell out
   * `UPDATE_TASK` with a `done` patch: the checkbox is the most-used control on
   * the board, and this is the action the extractor is forbidden from taking.
   */
  const toggleTask = useCallback(
    (id: string) => {
      const current = tasksRef.current.find((task) => task.id === id);
      if (!current) return;
      dispatch({ type: 'UPDATE_TASK', id, patch: { done: !current.done } });
    },
    [dispatch],
  );

  return { state, dispatch, addTask, toggleTask };
}
