import { describe, it, expect, beforeEach } from 'vitest';
import type { Person } from '../../../shared/interfaces/person';
import {
  loadPeopleFromStorage,
  peopleStoreReducer,
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
