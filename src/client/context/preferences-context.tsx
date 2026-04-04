import React, { createContext, useContext } from 'react';
import {
  usePreferencesState,
  type PreferencesState,
  type PreferencesAction,
} from '../hooks/use-preferences-state';

interface PreferencesContextValue {
  state: PreferencesState;
  dispatch: React.Dispatch<PreferencesAction>;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

/** Provider that wraps children with preferences state */
export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = usePreferencesState();
  return (
    <PreferencesContext.Provider value={{ state, dispatch }}>
      {children}
    </PreferencesContext.Provider>
  );
}

/** Consumer hook — throws if used outside PreferencesProvider */
export function usePreferencesContext(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    throw new Error('usePreferencesContext must be used within a PreferencesProvider');
  }
  return ctx;
}
