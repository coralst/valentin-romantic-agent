import React, { createContext, useContext } from 'react';
import {
  useIntegrationsStore,
  type UseIntegrationsStoreResult,
  initialIntegrationsState,
} from '../hooks/use-integrations-store';

/**
 * Which services Valentin has been given reach into.
 *
 * A context rather than local state because the grants are read in two sibling
 * subtrees: the rail draws the connected count on its badge, and the integrations
 * panel is mounted beside the chat.
 */

const IntegrationsContext = createContext<UseIntegrationsStoreResult | null>(null);

export function IntegrationsProvider({ children }: { children: React.ReactNode }) {
  const store = useIntegrationsStore();
  return <IntegrationsContext.Provider value={store}>{children}</IntegrationsContext.Provider>;
}

/**
 * Read the grants.
 *
 * Falls back to an empty, inert store rather than throwing, for the same reason
 * `useArchitectureDrawer` does: the rail renders standalone in several component
 * tests, and a hard throw would make this provider a hidden dependency of all of
 * them. The fallback grants nothing, which is the safe direction for a permission
 * store to fail in.
 */
export function useIntegrations(): UseIntegrationsStoreResult {
  return useContext(IntegrationsContext) ?? FALLBACK;
}

const FALLBACK: UseIntegrationsStoreResult = {
  state: initialIntegrationsState,
  connectedCount: 0,
  isConnected: () => false,
  connect: () => {},
  disconnect: () => {},
  setCap: () => {},
  dismissStorageError: () => {},
};
