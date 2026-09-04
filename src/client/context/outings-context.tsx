import React, { createContext, useContext } from 'react';
import {
  useOutingStore,
  type OutingStoreAction,
  type OutingStoreState,
} from '../hooks/use-outing-store';
import type { OutingVerdict } from '../../shared/interfaces/outing';

interface OutingsContextValue {
  state: OutingStoreState;
  dispatch: React.Dispatch<OutingStoreAction>;
  /**
   * The survey. Note there is no `addOuting` counterpart to `addTask` — rows are
   * written by the server when a booking is confirmed, so the UI only ever says
   * how it went.
   */
  rateOuting: (
    id: string,
    patch: { rating?: number | null; verdict?: OutingVerdict | null; note?: string | null },
  ) => void;
}

const OutingsContext = createContext<OutingsContextValue | null>(null);

interface OutingsProviderProps {
  children: React.ReactNode;
  sessionId: string | null;
}

export function OutingsProvider({ children, sessionId }: OutingsProviderProps) {
  const { state, dispatch, rateOuting } = useOutingStore(sessionId);
  return (
    <OutingsContext.Provider value={{ state, dispatch, rateOuting }}>
      {children}
    </OutingsContext.Provider>
  );
}

export function useOutingsContext(): OutingsContextValue {
  const ctx = useOptionalOutingsContext();
  if (!ctx) {
    throw new Error('useOutingsContext must be used within an OutingsProvider');
  }
  return ctx;
}

/**
 * Non-throwing variant, for the same reason `useOptionalTasksContext` exists: the
 * dossier renders inside component tests that mount no provider, and a couple who
 * have not been anywhere yet is a valid empty state rather than a crash.
 */
export function useOptionalOutingsContext(): OutingsContextValue | null {
  return useContext(OutingsContext);
}
