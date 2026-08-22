import React, { createContext, useContext, useEffect } from 'react';
import type { PreferenceIngestionResult } from '../hooks/use-preference-ingestion';

type DiscoveryContextValue = PreferenceIngestionResult;

const DiscoveryContext = createContext<DiscoveryContextValue | null>(null);

/**
 * Number of live `DiscoveryProvider` mounts. The ingestion effect behind this
 * provider must run exactly once per app: a second copy would double-dispatch
 * `SET_DISCOVERED_VALUE` and double the screen-reader announcements.
 */
let mountCount = 0;

/** Test-only: reset the mount counter between cases. */
export function resetDiscoveryMountCount(): void {
  mountCount = 0;
}

interface DiscoveryProviderProps {
  children: React.ReactNode;
  /** The result of the one `usePreferenceIngestion()` call in the app. */
  value: DiscoveryContextValue;
}

/**
 * Publishes preference-ingestion highlight state, so any number of read-only
 * surfaces can render discoveries without owning — or duplicating — the effect.
 *
 * Mount this exactly once, next to the single `usePreferenceIngestion()` call
 * (currently `AppLayoutContent`, which sits inside both `ProfileStoreProvider`
 * and `PreferencesProvider`).
 */
export function DiscoveryProvider({ children, value }: DiscoveryProviderProps) {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    mountCount += 1;
    if (mountCount > 1) {
      console.error(
        `DiscoveryProvider is mounted ${mountCount} times. It must be mounted exactly once — ` +
          'additional mounts double-dispatch discovered profile values and duplicate ' +
          'screen-reader announcements.',
      );
    }
    return () => {
      mountCount -= 1;
    };
  }, []);

  return <DiscoveryContext.Provider value={value}>{children}</DiscoveryContext.Provider>;
}

/** Consumer hook — throws if used outside DiscoveryProvider */
export function useDiscoveryContext(): DiscoveryContextValue {
  const ctx = useOptionalDiscoveryContext();
  if (!ctx) {
    throw new Error('useDiscoveryContext must be used within a DiscoveryProvider');
  }
  return ctx;
}

/**
 * Non-throwing variant, for surfaces that are *enriched* by discovery state but
 * must still render without it.
 *
 * The chat column is the motivating case: `LearnedChip` decorates the transcript
 * with discoveries, but `MessageHistory` is also rendered in tests and in the
 * mobile chat-only view that sit outside `DiscoveryProvider`. Those callers want
 * "no chips", not a crash, so they read this and skip the chips on `null`.
 */
export function useOptionalDiscoveryContext(): DiscoveryContextValue | null {
  return useContext(DiscoveryContext);
}
