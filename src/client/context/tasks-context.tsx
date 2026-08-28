import React, { createContext, useContext } from 'react';
import {
  useTaskStore,
  type TaskStoreAction,
  type TaskStoreState,
} from '../hooks/use-task-store';
import type { Task } from '../../shared/interfaces/task';

interface TasksContextValue {
  state: TaskStoreState;
  dispatch: React.Dispatch<TaskStoreAction>;
  /** Adds a row and mints its id — the only way the UI creates one. */
  addTask: (
    task: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'done'> & { done?: boolean },
  ) => void;
  /** The checkbox on "What to do next". */
  toggleTask: (id: string) => void;
}

const TasksContext = createContext<TasksContextValue | null>(null);

interface TasksProviderProps {
  children: React.ReactNode;
  sessionId: string | null;
}

export function TasksProvider({ children, sessionId }: TasksProviderProps) {
  const { state, dispatch, addTask, toggleTask } = useTaskStore(sessionId);
  return (
    <TasksContext.Provider value={{ state, dispatch, addTask, toggleTask }}>
      {children}
    </TasksContext.Provider>
  );
}

export function useTasksContext(): TasksContextValue {
  const ctx = useOptionalTasksContext();
  if (!ctx) {
    throw new Error('useTasksContext must be used within a TasksProvider');
  }
  return ctx;
}

/**
 * Non-throwing variant, for the same reason `useOptionalPeopleContext` exists:
 * the dossier renders inside component tests that mount no provider, and an
 * empty to-do list is a valid empty state rather than a crash.
 */
export function useOptionalTasksContext(): TasksContextValue | null {
  return useContext(TasksContext);
}
