import { useCallback, useEffect, useReducer, useRef } from 'react';
import { isPersonGeneration, type Person } from '../../shared/interfaces/person';
import { apiDelete, apiGetJson, apiPostJson } from '../utils/api-client';

/**
 * Her people, per session, kept on the server.
 *
 * It was `localStorage` only, which made her family the one thing on the board
 * that did not survive a new device — and, worse, that the extractor could not
 * write: a `PERSON#` row learned from the conversation had nowhere to land in a
 * browser it had never seen. DynamoDB is now the source of truth and
 * `localStorage` is a cache, read on mount so the tree draws before the fetch
 * lands rather than flashing empty.
 *
 * Still two stores rather than one shared with `use-profile-store`, because the
 * profile is a fixed set of *fields* and this is an unbounded list of *records*;
 * sharing one reducer would mean either people-shaped actions on the profile
 * store or `family_member_3_name` fields in the registry.
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
  /**
   * One whole record as the server has it — a `person_update` frame arriving
   * while he is still talking.
   *
   * Distinct from `ADD_PERSON`/`UPDATE_PERSON` because it must not be written
   * back: the sync wrapper mirrors those two to the server, and echoing a row
   * the server just sent is at best a wasted round trip and at worst a race
   * with the extractor's next write. It is also an upsert, since the frame does
   * not say whether the tree already holds the row this client is looking at.
   */
  | { type: 'MERGE_PERSON'; person: Person }
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

    case 'MERGE_PERSON': {
      const held = state.people.some((person) => person.id === action.person.id);
      return {
        ...state,
        people: held
          ? state.people.map((person) =>
              person.id === action.person.id ? action.person : person,
            )
          : [...state.people, action.person],
        storageError: null,
      };
    }

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
export function sanitise(people: unknown): Person[] {
  if (!Array.isArray(people)) return [];

  return people.filter((candidate): candidate is Person => {
    if (!candidate || typeof candidate !== 'object') return false;
    const person = candidate as Partial<Person>;
    return (
      typeof person.id === 'string' &&
      typeof person.relationship === 'string' &&
      // `isPersonGeneration` rather than a list spelled out here: this file had
      // its own copy, and it was written before the tree grew a grandparent
      // rung — so every grandmother the server sent back was silently dropped
      // by the client that asked for her.
      isPersonGeneration(person.generation) &&
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

/** Read her whole family back from the server. */
export async function fetchPeople(sessionId: string): Promise<Person[]> {
  const { people } = await apiGetJson<{ people: unknown }>(
    `/api/session/${encodeURIComponent(sessionId)}/people`,
  );
  return sanitise(people);
}

/** Upsert one person. The server keys on `id`, so this covers add and edit. */
export async function pushPerson(sessionId: string, person: Person): Promise<void> {
  await apiPostJson(`/api/session/${encodeURIComponent(sessionId)}/people`, person);
}

/** Forget one person for good. */
export async function removePerson(sessionId: string, personId: string): Promise<void> {
  await apiDelete(
    `/api/session/${encodeURIComponent(sessionId)}/people/${encodeURIComponent(personId)}`,
  );
}

export function usePeopleStore(sessionId: string | null) {
  const [state, localDispatch] = useReducer(peopleStoreReducer, initialState);

  /**
   * The list as the reducer last left it.
   *
   * `UPDATE_PERSON` carries a *patch*, and the server takes whole records, so
   * writing an edit means reading the row it patches. A ref rather than closing
   * over `state.people`: the wrapped dispatch has to be stable, or every
   * consumer that memoises on it re-subscribes on every keystroke.
   */
  const peopleRef = useRef(state.people);
  peopleRef.current = state.people;

  // Cache first, then the server. Both go through `RESTORE`, so the second one
  // wins by arriving last — which is the right order, because the server knows
  // about the sister the extractor discovered on another device.
  useEffect(() => {
    if (!sessionId) return;

    const cached = loadPeopleFromStorage(sessionId);
    if (cached) localDispatch({ type: 'RESTORE', people: cached });

    let live = true;
    void fetchPeople(sessionId)
      .then((people) => {
        if (live) localDispatch({ type: 'RESTORE', people });
      })
      .catch((err: unknown) => {
        // The cache is still on screen, so this is a note rather than an empty
        // tree: her family is what we last saw, just possibly not the latest.
        if (live) {
          localDispatch({
            type: 'STORAGE_ERROR',
            message: `Showing her family from this device — ${
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
    const error = savePeopleToStorage(sessionId, state.people);
    if (error) localDispatch({ type: 'STORAGE_ERROR', message: error });
  }, [sessionId, state.people]);

  /**
   * The dispatch every consumer gets: reduce now, write to the server after.
   *
   * Optimistic on purpose. Renaming a node is a two-character edit and waiting
   * on a round trip to see it makes the card feel broken; if the write fails the
   * next hydration corrects it, and the failure is reported meanwhile.
   */
  const dispatch = useCallback(
    (action: PeopleStoreAction) => {
      localDispatch(action);
      if (!sessionId) return;

      const fail = (err: unknown) =>
        localDispatch({
          type: 'STORAGE_ERROR',
          message: `Could not save her family — ${
            err instanceof Error ? err.message : 'the server did not answer'
          }`,
        });

      switch (action.type) {
        case 'ADD_PERSON':
          void pushPerson(sessionId, {
            ...action.person,
            updatedAt: action.person.updatedAt ?? new Date().toISOString(),
          }).catch(fail);
          break;

        case 'UPDATE_PERSON': {
          const current = peopleRef.current.find((person) => person.id === action.id);
          if (current) {
            void pushPerson(sessionId, {
              ...current,
              ...action.patch,
              updatedAt: new Date().toISOString(),
            }).catch(fail);
          }
          break;
        }

        case 'REMOVE_PERSON':
          void removePerson(sessionId, action.id).catch(fail);
          break;

        case 'CLEAR_ALL_PEOPLE':
          // One delete per row rather than a "clear" route: nothing else needs
          // one, and a route that empties a session's family is a bad thing to
          // have lying around behind a single fetch.
          void Promise.all(
            peopleRef.current.map((person) => removePerson(sessionId, person.id)),
          ).catch(fail);
          break;

        // `RESTORE` and `MERGE_PERSON` are how the server talks to us; echoing
        // either back would be a write loop. `STORAGE_ERROR` is local by
        // definition.
        default:
          break;
      }
    },
    [sessionId],
  );

  const addPerson = useCallback(
    (person: Omit<Person, 'id' | 'updatedAt'>) => {
      dispatch({ type: 'ADD_PERSON', person: { ...person, id: newPersonId() } });
    },
    [dispatch],
  );

  return { state, dispatch, addPerson };
}
