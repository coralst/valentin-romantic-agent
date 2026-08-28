import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Task } from '../../../shared/interfaces/task';
import {
  fetchTasks,
  loadTasksFromStorage,
  pushTask,
  removeTask,
  saveTasksToStorage,
  sanitiseTasks,
  taskStoreReducer,
  type TaskStoreState,
} from '../use-task-store';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'ask-ceramics',
    title: 'Ask her which glaze she wants',
    done: false,
    due: '2026-09-11',
    note: null,
    source: 'discovered',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const empty: TaskStoreState = { tasks: [], storageError: null };

describe('taskStoreReducer', () => {
  it('stamps both dates on add, so a row can be aged and sorted', () => {
    const next = taskStoreReducer(empty, {
      type: 'ADD_TASK',
      task: { id: 't1', title: 'Book the table', done: false, due: null, note: null, source: 'manual' },
    });
    expect(next.tasks).toHaveLength(1);
    expect(next.tasks[0].createdAt).toBeTruthy();
    expect(next.tasks[0].updatedAt).toBeTruthy();
  });

  it('ticks a row without resetting how long it has been outstanding', () => {
    // `createdAt` is what "4 open since June" is counted from, so a tick must not
    // touch it — the patch type forbids it and this is the behaviour that proves
    // the type is doing something.
    const state = { ...empty, tasks: [task()] };
    const next = taskStoreReducer(state, { type: 'UPDATE_TASK', id: task().id, patch: { done: true } });
    expect(next.tasks[0].done).toBe(true);
    expect(next.tasks[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(next.tasks[0].updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
  });

  it('ignores a patch for an id it does not hold', () => {
    const state = { ...empty, tasks: [task()] };
    expect(taskStoreReducer(state, { type: 'UPDATE_TASK', id: 'nope', patch: { done: true } }).tasks)
      .toEqual(state.tasks);
  });

  it('upserts a row the server pushed rather than doubling it', () => {
    const state = { ...empty, tasks: [task()] };
    const next = taskStoreReducer(state, {
      type: 'MERGE_TASK',
      task: task({ title: 'Ask her which glaze — sage or oat' }),
    });
    expect(next.tasks).toHaveLength(1);
    expect(next.tasks[0].title).toMatch(/sage or oat/);
  });

  it('adds a row the server pushed that this client has never seen', () => {
    const next = taskStoreReducer(empty, { type: 'MERGE_TASK', task: task({ id: 'card' }) });
    expect(next.tasks.map((t) => t.id)).toEqual(['card']);
  });

  it('removes by id', () => {
    const state = { ...empty, tasks: [task(), task({ id: 'card' })] };
    expect(taskStoreReducer(state, { type: 'REMOVE_TASK', id: 'card' }).tasks.map((t) => t.id))
      .toEqual(['ask-ceramics']);
  });

  it('forgets his list alongside her profile', () => {
    // "Forget her" must not leave a reminder to buy her mother a card.
    const state = { ...empty, tasks: [task()] };
    expect(taskStoreReducer(state, { type: 'CLEAR_ALL_TASKS' }).tasks).toEqual([]);
  });

  it('surfaces a storage failure without discarding what is in memory', () => {
    const state = { ...empty, tasks: [task()] };
    const next = taskStoreReducer(state, { type: 'STORAGE_ERROR', message: 'full' });
    expect(next.storageError).toBe('full');
    expect(next.tasks).toHaveLength(1);
  });
});

describe('sanitiseTasks', () => {
  it('keeps only rows that would draw', () => {
    expect(
      sanitiseTasks([
        task(),
        { id: 'x', title: '   ', done: false }, // blank title: a line with a box
        { id: 'y', title: 'No tick' }, // no `done`: which half of the list?
        { title: 'No id', done: false },
        'nonsense',
        null,
      ]).map((t) => t.id),
    ).toEqual(['ask-ceramics']);
  });

  it('answers with a list for anything that is not one', () => {
    expect(sanitiseTasks(undefined)).toEqual([]);
    expect(sanitiseTasks({ tasks: [] })).toEqual([]);
  });
});

describe('task storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a list', () => {
    expect(saveTasksToStorage('s1', [task()])).toBeNull();
    expect(loadTasksFromStorage('s1')).toEqual([task()]);
  });

  it('keeps sessions apart', () => {
    saveTasksToStorage('s1', [task()]);
    expect(loadTasksFromStorage('s2')).toBeNull();
  });

  it('drops a payload written by an older version rather than trusting its shape', () => {
    localStorage.setItem('valentin-tasks-s1', JSON.stringify({ version: 0, tasks: [task()] }));
    expect(loadTasksFromStorage('s1')).toBeNull();
    expect(localStorage.getItem('valentin-tasks-s1')).toBeNull();
  });

  it('survives corrupt JSON and clears it', () => {
    localStorage.setItem('valentin-tasks-s1', '{not json');
    expect(loadTasksFromStorage('s1')).toBeNull();
    expect(localStorage.getItem('valentin-tasks-s1')).toBeNull();
  });
});

/*
 * The half that matters most for this board: a tick that does not survive a
 * reload is worse than no list at all, so the row goes to the server on every
 * change rather than only at the end.
 */
describe('tasks over the API', () => {
  let calls: Array<{ url: string; method: string; body: unknown }>;

  function stubFetch(payload: unknown, ok = true) {
    calls = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      return { ok, status: ok ? 200 : 500, json: async () => payload } as Response;
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the list from the session’s own route', async () => {
    stubFetch({ tasks: [task()] });
    expect(await fetchTasks('s 1')).toEqual([task()]);
    expect(calls[0]).toMatchObject({ url: '/api/session/s%201/tasks', method: 'GET' });
  });

  it('drops a row the server could not have meant', async () => {
    stubFetch({ tasks: [task(), { id: 'x' }] });
    expect((await fetchTasks('s1')).map((t) => t.id)).toEqual(['ask-ceramics']);
  });

  it('sends the tick as an upsert of the whole row', async () => {
    stubFetch({ saved: true });
    await pushTask('s1', task({ done: true }));
    expect(calls[0]).toMatchObject({ url: '/api/session/s1/tasks', method: 'POST' });
    expect((calls[0].body as Task).done).toBe(true);
  });

  it('deletes by id', async () => {
    stubFetch({ deleted: true });
    await removeTask('s1', 'card');
    expect(calls[0]).toMatchObject({ url: '/api/session/s1/tasks/card', method: 'DELETE' });
  });

  it('throws a message fit for a projector when the server refuses', async () => {
    stubFetch({}, false);
    await expect(fetchTasks('s1')).rejects.toThrow(/could not complete/);
  });
});
