import { useCallback, useEffect, useReducer } from 'react';
import type { Person, PersonGeneration } from '../../shared/interfaces/person';

/**
 * Her people, persisted per session.
 *
 * Deliberately the same shape and the same storage contract as
 * `use-profile-store`: its own versioned key, a reducer, a `RESTORE` on mount and
 * a save on every change. Two stores rather than one because the profile is a
 * fixed set of *fields* and this is an unbounded list of *records*; sharing one
 * reducer would mean either people-shaped actions on the profile store or
 * `family_member_3_name` fields in the registry.
 */
export interface PeopleStoreState {
  people: Person[];
  storageError: string | null;
}

export type PeopleStoreAction =
  | {
      type: 'ADD_PERSON';
      person: Omit<Person, 'updatedAt'> & { updatedAt?: string };
    }
  /** Any subset of a person's fields — used by every inline edit on the card. */
  | { type: 'UPDATE_PERSON'; id: string; patch: Partial<Omit<Person, 'id'>> }
  | { type: 'REMOVE_PERSON'; id: string }
  | { type: 'RESTORE'; people: Person[] }
  | { type: 'CLEAR_ALL_PEOPLE' }
  | { type: 'STORAGE_ERROR'; message: string };

const STORAGE_KEY_PREFIX = 'valentin-people-';
const STORAGE_VERSION = 1;

interface StorageSchema {
  version: number;
  people: Person[];
}

const initialState: PeopleStoreState = { people: [], storageError: null };

/**
 * `crypto.randomUUID` where it exists, a counter-free fallback where it does not.
 *
 * jsdom in older Node has no `randomUUID`, and the fallback keeps the reducer
 * usable in tests without a polyfill. Ids only need to be unique within one
 * session's list.
 */
export function newPersonId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `p-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export function peopleStoreReducer(
  state: PeopleStoreState,
  action: PeopleStoreAction,
): PeopleStoreState {
  switch (action.type) {
    case 'ADD_PERSON': {
      const person: Person = {
        ...action.person,
        updatedAt: action.person.updatedAt ?? new Date().toISOString(),
      };
      return { ...state, people: [...state.people, person], storageError: null };
    }

    case 'UPDATE_PERSON':
      return {
        ...state,
        people: state.people.map((person) =>
          person.id === action.id
            ? { ...person, ...action.patch, updatedAt: new Date().toISOString() }
            : person,
        ),
        storageError: null,
      };

    case 'REMOVE_PERSON':
      return {
        ...state,
        people: state.people.filter((person) => person.id !== action.id),
        storageError: null,
      };

    case 'RESTORE':
      return { ...state, people: action.people };

    case 'CLEAR_ALL_PEOPLE':
      // Paired with the profile store's `CLEAR_ALL_VALUES`: "forget her" has to
      // forget her family too, or the next partner inherits her sister.
      return { ...state, people: [], storageError: null };

    case 'STORAGE_ERROR':
      return { ...state, storageError: action.message };

    default:
      return state;
  }
}

/**
 * Drop anything that is not a plausible `Person`.
 *
 * The list is read back out of `localStorage`, which any tab can write, and a
 * record missing `relationship` or `generation` would render as an unlabelled
 * card in the middle of the tree.
 */
function sanitise(people: unknown): Person[] {
  if (!Array.isArray(people)) return [];
  const generations: PersonGeneration[] = ['elder', 'peer', 'younger'];

  return people.filter((candidate): candidate is Person => {
    if (!candidate || typeof candidate !== 'object') return false;
    const person = candidate as Partial<Person>;
    return (
      typeof person.id === 'string' &&
      typeof person.relationship === 'string' &&
      typeof person.generation === 'string' &&
      generations.includes(person.generation) &&
      (person.name === null || typeof person.name === 'string')
    );
  });
}

export function loadPeopleFromStorage(sessionId: string): Person[] | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${sessionId}`);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as StorageSchema;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== STORAGE_VERSION) {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${sessionId}`);
      return null;
    }

    return sanitise(parsed.people);
  } catch {
    try {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${sessionId}`);
    } catch {
      // If removal also fails there is nothing further to do.
    }
    return null;
  }
}

export function savePeopleToStorage(
  sessionId: string,
  people: Person[],
): string | null {
  try {
    const data: StorageSchema = { version: STORAGE_VERSION, people };
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${sessionId}`, JSON.stringify(data));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Failed to save her family';
  }
}

export function usePeopleStore(sessionId: string | null) {
  const [state, dispatch] = useReducer(peopleStoreReducer, initialState);

  useEffect(() => {
    if (!sessionId) return;
    const stored = loadPeopleFromStorage(sessionId);
    if (stored) dispatch({ type: 'RESTORE', people: stored });
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const error = savePeopleToStorage(sessionId, state.people);
    if (error) dispatch({ type: 'STORAGE_ERROR', message: error });
  }, [sessionId, state.people]);

  const addPerson = useCallback(
    (person: Omit<Person, 'id' | 'updatedAt'>) => {
      dispatch({ type: 'ADD_PERSON', person: { ...person, id: newPersonId() } });
    },
    [dispatch],
  );

  return { state, dispatch, addPerson };
}
