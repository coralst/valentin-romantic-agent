import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Person } from '../../../shared/interfaces/person';
import {
  fetchPeople,
  loadPeopleFromStorage,
  peopleStoreReducer,
  pushPerson,
  removePerson,
  savePeopleToStorage,
  type PeopleStoreState,
} from '../use-people-store';

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: 'leah',
    name: 'Leah',
    relationship: 'Older sister',
    generation: 'peer',
    birthday: '1988-09-09',
    note: null,
    source: 'manual',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const empty: PeopleStoreState = { people: [], storageError: null };

describe('peopleStoreReducer', () => {
  it('stamps updatedAt on add so the record is never undated', () => {
    const next = peopleStoreReducer(empty, {
      type: 'ADD_PERSON',
      person: { ...person(), updatedAt: undefined },
    });
    expect(next.people).toHaveLength(1);
    expect(next.people[0].updatedAt).toBeTruthy();
  });

  it('patches only the named fields, leaving the rest of the record alone', () => {
    const state = { ...empty, people: [person()] };
    const next = peopleStoreReducer(state, {
      type: 'UPDATE_PERSON',
      id: 'leah',
      patch: { birthday: '1988-09-10' },
    });
    expect(next.people[0].birthday).toBe('1988-09-10');
    expect(next.people[0].name).toBe('Leah');
    expect(next.people[0].updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
  });

  it('ignores an update for an id it does not hold', () => {
    const state = { ...empty, people: [person()] };
    const next = peopleStoreReducer(state, {
      type: 'UPDATE_PERSON',
      id: 'nobody',
      patch: { name: 'Wrong' },
    });
    expect(next.people).toEqual(state.people);
  });

  it('removes by id', () => {
    const state = { ...empty, people: [person(), person({ id: 'noa', name: 'Noa' })] };
    const next = peopleStoreReducer(state, { type: 'REMOVE_PERSON', id: 'leah' });
    expect(next.people.map((p) => p.id)).toEqual(['noa']);
  });

  it('forgets her family alongside her profile', () => {
    // Paired with the profile store's CLEAR_ALL_VALUES — otherwise the next
    // partner inherits this one's sister.
    const state = { ...empty, people: [person()] };
    expect(peopleStoreReducer(state, { type: 'CLEAR_ALL_PEOPLE' }).people).toEqual([]);
  });

  /*
   * The extractor's route in. `MERGE_PERSON` is deliberately not `ADD_PERSON`:
   * the socket frame says whether the *server* thought the row was new, which is
   * a different question from whether this client already holds it — he can
   * mention his sister-in-law twice in one turn.
   */
  it('upserts a person the server pushed, rather than doubling her', () => {
    const state = { ...empty, people: [person()] };
    const next = peopleStoreReducer(state, {
      type: 'MERGE_PERSON',
      person: person({ birthday: '1988-09-11', source: 'discovered' }),
    });
    expect(next.people).toHaveLength(1);
    expect(next.people[0].birthday).toBe('1988-09-11');
  });

  it('adds a person the server pushed that this client has never seen', () => {
    const next = peopleStoreReducer(empty, {
      type: 'MERGE_PERSON',
      person: person({ id: 'nadia', name: 'Nadia' }),
    });
    expect(next.people.map((p) => p.id)).toEqual(['nadia']);
  });

  it('clears a stale storage error once the server answers', () => {
    // Otherwise "showing her family from this device" stays on screen beside a
    // tree that is now the server's.
    const state: PeopleStoreState = { people: [], storageError: 'offline' };
    expect(
      peopleStoreReducer(state, { type: 'MERGE_PERSON', person: person() }).storageError,
    ).toBeNull();
  });

  it('surfaces a storage failure without discarding what is in memory', () => {
    const state = { ...empty, people: [person()] };
    const next = peopleStoreReducer(state, { type: 'STORAGE_ERROR', message: 'full' });
    expect(next.storageError).toBe('full');
    expect(next.people).toHaveLength(1);
  });
});

describe('people storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a list', () => {
    expect(savePeopleToStorage('s1', [person()])).toBeNull();
    expect(loadPeopleFromStorage('s1')).toEqual([person()]);
  });

  it('keeps sessions apart', () => {
    savePeopleToStorage('s1', [person()]);
    expect(loadPeopleFromStorage('s2')).toBeNull();
  });

  it('drops a payload written by an older version rather than trusting its shape', () => {
    localStorage.setItem(
      'valentin-people-s1',
      JSON.stringify({ version: 0, people: [person()] }),
    );
    expect(loadPeopleFromStorage('s1')).toBeNull();
    expect(localStorage.getItem('valentin-people-s1')).toBeNull();
  });

  it('survives corrupt JSON and clears it', () => {
    localStorage.setItem('valentin-people-s1', '{not json');
    expect(loadPeopleFromStorage('s1')).toBeNull();
    expect(localStorage.getItem('valentin-people-s1')).toBeNull();
  });

  it('discards records that would render as an unlabelled node', () => {
    // localStorage is writable by anything in the origin, so a record missing
    // `relationship` or carrying an unknown row must not reach the tree — it has
    // no row to be drawn on.
    localStorage.setItem(
      'valentin-people-s1',
      JSON.stringify({
        version: 1,
        people: [
          person(),
          { id: 'x', generation: 'peer' }, // no relationship
          { id: 'y', relationship: 'Aunt', generation: 'ancestor' }, // unknown row
          { relationship: 'Aunt', generation: 'elder' }, // no id
          'nonsense',
        ],
      }),
    );
    expect(loadPeopleFromStorage('s1')?.map((p) => p.id)).toEqual(['leah']);
  });

  it('reads a gap back as a gap, not as a person with no name key', () => {
    const gap = person({ id: 'g1', name: null, relationship: 'Brother' });
    savePeopleToStorage('s1', [gap]);
    expect(loadPeopleFromStorage('s1')).toEqual([gap]);
  });
});

/*
 * The server side of the store: the half that makes her family survive a new
 * device, and the half the extractor writes into.
 */
describe('people over the API', () => {
  let calls: Array<{ url: string; method: string; body: unknown }>;

  function stubFetch(payload: unknown, ok = true) {
    calls = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      return {
        ok,
        status: ok ? 200 : 500,
        json: async () => payload,
      } as Response;
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads her family from the session’s own route', async () => {
    stubFetch({ people: [person()] });
    expect(await fetchPeople('s 1')).toEqual([person()]);
    // Encoded, because a session id reaches this from the server and a raw space
    // would make the path a different one.
    expect(calls[0]).toMatchObject({ url: '/api/session/s%201/people', method: 'GET' });
  });

  it('keeps the grandparent rung the server sends', async () => {
    // This was a real bug: the client's own allow-list predated the fourth rung,
    // so every grandmother the server returned was silently dropped by the client
    // that asked for her.
    stubFetch({ people: [person({ id: 'miriam', generation: 'grandparent' })] });
    expect((await fetchPeople('s1')).map((p) => p.generation)).toEqual(['grandparent']);
  });

  it('drops a record the server could not have meant, rather than drawing a blank node', async () => {
    stubFetch({ people: [person(), { id: 'x' }, null] });
    expect((await fetchPeople('s1')).map((p) => p.id)).toEqual(['leah']);
  });

  it('upserts through one POST, so an edit is not a delete and an add', async () => {
    stubFetch({ saved: true });
    await pushPerson('s1', person({ name: 'Leah B' }));
    expect(calls[0]).toMatchObject({
      url: '/api/session/s1/people',
      method: 'POST',
    });
    expect((calls[0].body as Person).name).toBe('Leah B');
  });

  it('deletes by id', async () => {
    stubFetch({ deleted: true });
    await removePerson('s1', 'leah');
    expect(calls[0]).toMatchObject({
      url: '/api/session/s1/people/leah',
      method: 'DELETE',
    });
  });

  it('throws a message fit for a projector when the server refuses', async () => {
    stubFetch({}, false);
    await expect(fetchPeople('s1')).rejects.toThrow(/could not complete/);
  });
});
