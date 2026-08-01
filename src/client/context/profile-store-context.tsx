import React, { createContext, useContext } from 'react';
import {
  useProfileStore,
  type ProfileStoreState,
  type ProfileStoreAction,
  type ProfileFieldValue,
} from '../hooks/use-profile-store';

interface ProfileStoreContextValue {
  state: ProfileStoreState;
  dispatch: React.Dispatch<ProfileStoreAction>;
  getFieldValue: (fieldId: string) => ProfileFieldValue | null;
}

const ProfileStoreContext = createContext<ProfileStoreContextValue | null>(null);

interface ProfileStoreProviderProps {
  children: React.ReactNode;
  sessionId: string | null;
}

/** Provider that wraps children with profile store state */
export function ProfileStoreProvider({ children, sessionId }: ProfileStoreProviderProps) {
  const { state, dispatch, getFieldValue } = useProfileStore(sessionId);
  return (
    <ProfileStoreContext.Provider value={{ state, dispatch, getFieldValue }}>
      {children}
    </ProfileStoreContext.Provider>
  );
}

/** Consumer hook — throws if used outside ProfileStoreProvider */
export function useProfileStoreContext(): ProfileStoreContextValue {
  const ctx = useContext(ProfileStoreContext);
  if (!ctx) {
    throw new Error('useProfileStoreContext must be used within a ProfileStoreProvider');
  }
  return ctx;
}
