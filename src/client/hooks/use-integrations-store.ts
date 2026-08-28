import { useCallback, useEffect, useReducer } from 'react';
import { findIntegration } from '../utils/integration-catalogue';

/**
 * A grant the visitor has made: this service is connected, up to this much.
 *
 * `capUsd` is `null` for services that cannot spend — see `defaultCapUsd` in the
 * catalogue.
 */
export interface IntegrationGrant {
  capUsd: number | null;
  /** ISO timestamp of the grant, shown as "connected on …" in the panel. */
  grantedAt: string;
}

export interface IntegrationsState {
  /** Keyed by service id. A missing key means "not connected". */
  grants: Record<string, IntegrationGrant>;
  /**
   * Set when the browser refused to persist the grants, so the panel can admit
   * that the choice will not survive a reload rather than silently forgetting it.
   */
  storageError: string | null;
}

export type IntegrationsAction =
  | { type: 'RESTORE'; grants: Record<string, IntegrationGrant> }
  | { type: 'CONNECT'; id: string; capUsd: number | null; grantedAt: string }
  | { type: 'DISCONNECT'; id: string }
  | { type: 'SET_CAP'; id: string; capUsd: number }
  | { type: 'STORAGE_ERROR'; message: string }
  | { type: 'CLEAR_STORAGE_ERROR' };

export const initialIntegrationsState: IntegrationsState = {
  grants: {},
  storageError: null,
};

export const INTEGRATIONS_STORAGE_KEY = 'valentin_integrations_v1';
const STORAGE_VERSION = 1;

interface StorageSchema {
  version: number;
  grants: Record<string, IntegrationGrant>;
}

export function integrationsReducer(
  state: IntegrationsState,
  action: IntegrationsAction,
): IntegrationsState {
  switch (action.type) {
    case 'RESTORE':
      return { ...state, grants: action.grants };

    case 'CONNECT':
      return {
        ...state,
        grants: {
          ...state.grants,
          [action.id]: { capUsd: action.capUsd, grantedAt: action.grantedAt },
        },
      };

    case 'DISCONNECT': {
      // Delete rather than flag: "not connected" is the absence of a grant, so a
      // disconnected service leaves nothing behind to be read back as consent.
      const { [action.id]: _removed, ...rest } = state.grants;
      return { ...state, grants: rest };
    }

    case 'SET_CAP': {
      const existing = state.grants[action.id];
      // Raising a cap on something that was never connected would be a grant made
      // by a slider, which is not a grant anybody gave.
      if (!existing) return state;
      return {
        ...state,
        grants: { ...state.grants, [action.id]: { ...existing, capUsd: action.capUsd } },
      };
    }

    case 'STORAGE_ERROR':
      return { ...state, storageError: action.message };

    case 'CLEAR_STORAGE_ERROR':
      return { ...state, storageError: null };

    default:
      return state;
  }
}

/**
 * Read the grants back, dropping anything the catalogue no longer offers.
 *
 * Pruning matters more here than in the profile store: a stale id would be a
 * permission still recorded against a capability nobody can see or revoke.
 */
export function loadGrants(): Record<string, IntegrationGrant> | null {
  try {
    const raw = localStorage.getItem(INTEGRATIONS_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as StorageSchema;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== STORAGE_VERSION) {
      localStorage.removeItem(INTEGRATIONS_STORAGE_KEY);
      return null;
    }

    const pruned: Record<string, IntegrationGrant> = {};
    for (const [id, grant] of Object.entries(parsed.grants ?? {})) {
      if (!findIntegration(id)) continue;
      if (!grant || typeof grant !== 'object') continue;
      pruned[id] = {
        capUsd: typeof grant.capUsd === 'number' ? grant.capUsd : null,
        grantedAt: typeof grant.grantedAt === 'string' ? grant.grantedAt : '',
      };
    }
    return pruned;
  } catch {
    try {
      localStorage.removeItem(INTEGRATIONS_STORAGE_KEY);
    } catch {
      // A storage that cannot be cleared is one we simply stop reading.
    }
    return null;
  }
}

/** Write the grants back. Returns a message on failure, `null` on success. */
export function saveGrants(grants: Record<string, IntegrationGrant>): string | null {
  try {
    const data: StorageSchema = { version: STORAGE_VERSION, grants };
    localStorage.setItem(INTEGRATIONS_STORAGE_KEY, JSON.stringify(data));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Failed to save your connections';
  }
}

export interface UseIntegrationsStoreResult {
  state: IntegrationsState;
  /** How many services currently hold a grant. */
  connectedCount: number;
  isConnected: (id: string) => boolean;
  connect: (id: string, capUsd: number | null) => void;
  disconnect: (id: string) => void;
  setCap: (id: string, capUsd: number) => void;
  dismissStorageError: () => void;
}

/** The grants store: a reducer, plus the same localStorage round-trip the profile store uses. */
export function useIntegrationsStore(): UseIntegrationsStoreResult {
  const [state, dispatch] = useReducer(integrationsReducer, initialIntegrationsState);

  useEffect(() => {
    const stored = loadGrants();
    if (stored) dispatch({ type: 'RESTORE', grants: stored });
  }, []);

  useEffect(() => {
    const error = saveGrants(state.grants);
    if (error) dispatch({ type: 'STORAGE_ERROR', message: error });
  }, [state.grants]);

  const connect = useCallback((id: string, capUsd: number | null) => {
    dispatch({ type: 'CONNECT', id, capUsd, grantedAt: new Date().toISOString() });
  }, []);

  const disconnect = useCallback((id: string) => {
    dispatch({ type: 'DISCONNECT', id });
  }, []);

  const setCap = useCallback((id: string, capUsd: number) => {
    dispatch({ type: 'SET_CAP', id, capUsd });
  }, []);

  const dismissStorageError = useCallback(() => {
    dispatch({ type: 'CLEAR_STORAGE_ERROR' });
  }, []);

  const isConnected = useCallback((id: string) => id in state.grants, [state.grants]);

  return {
    state,
    connectedCount: Object.keys(state.grants).length,
    isConnected,
    connect,
    disconnect,
    setCap,
    dismissStorageError,
  };
}
