import React, { createContext, useContext } from 'react';
import {
  useIntegrationReadiness,
  type IntegrationReadinessHandle,
} from '../hooks/use-integration-readiness';

/**
 * One answer to "what can this deployment reach", shared by everything that asks.
 *
 * The hook itself is unchanged and still usable directly; what this adds is a
 * *single instance* of it, and that is the point rather than a saving on one HTTP
 * call. Readiness is now read in two sibling subtrees — the integrations panel and
 * the conversation header's status strip — and `useIntegrationReadiness` holds its
 * answer in component state. Two instances means two copies that drift: the panel
 * hands over a credential and calls `refresh`, its own copy updates, and the
 * header goes on showing the service as unconfigured until something unrelated
 * remounts it. A status indicator that is stale after the one action that changes
 * it is worse than no indicator, because it is wrong exactly when someone is
 * looking at it.
 *
 * So `refresh` on this context refreshes what everybody sees.
 */

const IntegrationReadinessContext = createContext<IntegrationReadinessHandle | null>(null);

export function IntegrationReadinessProvider({ children }: { children: React.ReactNode }) {
  const readiness = useIntegrationReadiness();
  return (
    <IntegrationReadinessContext.Provider value={readiness}>
      {children}
    </IntegrationReadinessContext.Provider>
  );
}

/**
 * Read shared readiness.
 *
 * Falls back to a permanently-`loading` handle rather than throwing, matching
 * `useIntegrations`: the header and the panel both render standalone in component
 * tests, and a hard throw would make this provider a hidden dependency of all of
 * them. `loading` is the right direction to fail in — it renders as "can't tell
 * from here", which claims nothing about any service either way.
 */
export function useSharedIntegrationReadiness(): IntegrationReadinessHandle {
  return useContext(IntegrationReadinessContext) ?? FALLBACK;
}

const FALLBACK: IntegrationReadinessHandle = {
  state: 'loading',
  configured: {},
  refresh: () => {},
};
