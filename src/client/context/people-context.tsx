import React, { createContext, useContext } from 'react';
import {
  usePeopleStore,
  type PeopleStoreAction,
  type PeopleStoreState,
} from '../hooks/use-people-store';
import type { Person } from '../../shared/interfaces/person';

interface PeopleContextValue {
  state: PeopleStoreState;
  dispatch: React.Dispatch<PeopleStoreAction>;
  /** Adds a person and mints their id — the only way the UI creates one. */
  addPerson: (person: Omit<Person, 'id' | 'updatedAt'>) => void;
}

const PeopleContext = createContext<PeopleContextValue | null>(null);

interface PeopleProviderProps {
  children: React.ReactNode;
  sessionId: string | null;
}

export function PeopleProvider({ children, sessionId }: PeopleProviderProps) {
  const { state, dispatch, addPerson } = usePeopleStore(sessionId);
  return (
    <PeopleContext.Provider value={{ state, dispatch, addPerson }}>
      {children}
    </PeopleContext.Provider>
  );
}

export function usePeopleContext(): PeopleContextValue {
  const ctx = useOptionalPeopleContext();
  if (!ctx) {
    throw new Error('usePeopleContext must be used within a PeopleProvider');
  }
  return ctx;
}

/**
 * Non-throwing variant, for the same reason `useOptionalProfileStoreContext`
 * exists: the dossier renders inside component tests that mount neither provider,
 * and a family tree with nobody in it is a valid empty state rather than a crash.
 */
export function useOptionalPeopleContext(): PeopleContextValue | null {
  return useContext(PeopleContext);
}
