import React, { createContext, useContext } from 'react';
import {
  useReminderStore,
  type ReminderStoreAction,
  type ReminderStoreState,
} from '../hooks/use-reminder-store';

interface RemindersContextValue {
  state: ReminderStoreState;
  dispatch: React.Dispatch<ReminderStoreAction>;
  /**
   * Stop one reminder. Note there is no `addReminder` counterpart — rows are written
   * by `set_reminder` when he asks and by `syncReminders` when a date lands on her
   * profile, so the UI only ever cancels.
   */
  cancelReminder: (id: string) => void;
}

const RemindersContext = createContext<RemindersContextValue | null>(null);

interface RemindersProviderProps {
  children: React.ReactNode;
  sessionId: string | null;
}

export function RemindersProvider({ children, sessionId }: RemindersProviderProps) {
  const { state, dispatch, cancelReminder } = useReminderStore(sessionId);
  return (
    <RemindersContext.Provider value={{ state, dispatch, cancelReminder }}>
      {children}
    </RemindersContext.Provider>
  );
}

export function useRemindersContext(): RemindersContextValue {
  const ctx = useOptionalRemindersContext();
  if (!ctx) {
    throw new Error('useRemindersContext must be used within a RemindersProvider');
  }
  return ctx;
}

/**
 * Non-throwing variant, for the same reason `useOptionalOutingsContext` exists: the
 * dossier renders inside component tests that mount no provider, and a couple with
 * nothing armed yet is a valid empty state rather than a crash.
 */
export function useOptionalRemindersContext(): RemindersContextValue | null {
  return useContext(RemindersContext);
}
