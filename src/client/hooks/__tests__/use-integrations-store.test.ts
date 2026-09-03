import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  INTEGRATIONS_STORAGE_KEY,
  initialIntegrationsState,
  integrationsReducer,
  loadGrants,
  saveGrants,
  useIntegrationsStore,
  type IntegrationGrant,
} from '../use-integrations-store';

const GRANT: IntegrationGrant = { capUsd: 120, grantedAt: '2026-02-14T09:00:00.000Z' };

function stored(grants: Record<string, IntegrationGrant>, version = 1) {
  localStorage.setItem(INTEGRATIONS_STORAGE_KEY, JSON.stringify({ version, grants }));
}

describe('integrationsReducer', () => {
  it('records a grant with its cap and the moment it was made', () => {
    const next = integrationsReducer(initialIntegrationsState, {
      type: 'CONNECT',
      id: 'ontopo',
      capUsd: 120,
      grantedAt: GRANT.grantedAt,
    });
    expect(next.grants.ontopo).toEqual(GRANT);
  });

  /*
   * "Not connected" has to be the *absence* of a grant, not a grant with a flag
   * turned off — anything left in the record can be read back later as consent.
   */
  it('deletes the grant on disconnect rather than flagging it', () => {
    const connected = { ...initialIntegrationsState, grants: { ontopo: GRANT } };
    const next = integrationsReducer(connected, { type: 'DISCONNECT', id: 'ontopo' });
    expect(next.grants).toEqual({});
    expect('ontopo' in next.grants).toBe(false);
  });

  it('changes the cap on an existing grant', () => {
    const connected = { ...initialIntegrationsState, grants: { ontopo: GRANT } };
    const next = integrationsReducer(connected, { type: 'SET_CAP', id: 'ontopo', capUsd: 60 });
    expect(next.grants.ontopo).toEqual({ ...GRANT, capUsd: 60 });
  });

  /* A cap set on something never connected would be a grant made by a slider. */
  it('refuses to create a grant by setting a cap', () => {
    const next = integrationsReducer(initialIntegrationsState, {
      type: 'SET_CAP',
      id: 'ontopo',
      capUsd: 60,
    });
    expect(next).toBe(initialIntegrationsState);
    expect(next.grants.ontopo).toBeUndefined();
  });

  it('carries a storage failure and lets it be dismissed', () => {
    const failed = integrationsReducer(initialIntegrationsState, {
      type: 'STORAGE_ERROR',
      message: 'quota exceeded',
    });
    expect(failed.storageError).toBe('quota exceeded');
    expect(integrationsReducer(failed, { type: 'CLEAR_STORAGE_ERROR' }).storageError).toBeNull();
  });
});

describe('loadGrants', () => {
  beforeEach(() => localStorage.clear());

  it('returns null when nothing has been stored', () => {
    expect(loadGrants()).toBeNull();
  });

  it('round-trips through saveGrants', () => {
    expect(saveGrants({ ontopo: GRANT })).toBeNull();
    expect(loadGrants()).toEqual({ ontopo: GRANT });
  });

  /*
   * A stale id is worse here than in the profile store: it is a permission still
   * recorded against a capability nobody can see in the panel, and therefore
   * nobody can revoke.
   */
  it('drops ids the catalogue no longer offers', () => {
    stored({ ontopo: GRANT, telegraph: GRANT });
    expect(loadGrants()).toEqual({ ontopo: GRANT });
  });

  it('discards a payload from an older schema version', () => {
    stored({ ontopo: GRANT }, 0);
    expect(loadGrants()).toBeNull();
    expect(localStorage.getItem(INTEGRATIONS_STORAGE_KEY)).toBeNull();
  });

  it('discards unparseable storage instead of throwing', () => {
    localStorage.setItem(INTEGRATIONS_STORAGE_KEY, '{not json');
    expect(loadGrants()).toBeNull();
    expect(localStorage.getItem(INTEGRATIONS_STORAGE_KEY)).toBeNull();
  });

  it('normalises a grant whose cap is not a number', () => {
    stored({ ontopo: { capUsd: 'lots', grantedAt: 7 } as unknown as IntegrationGrant });
    expect(loadGrants()).toEqual({ ontopo: { capUsd: null, grantedAt: '' } });
  });
});

describe('useIntegrationsStore', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('starts with nothing connected', () => {
    const { result } = renderHook(() => useIntegrationsStore());
    expect(result.current.connectedCount).toBe(0);
    expect(result.current.isConnected('ontopo')).toBe(false);
  });

  it('connects, counts, and disconnects', () => {
    const { result } = renderHook(() => useIntegrationsStore());

    act(() => result.current.connect('ontopo', 120));
    expect(result.current.isConnected('ontopo')).toBe(true);
    expect(result.current.connectedCount).toBe(1);
    expect(result.current.state.grants.ontopo?.capUsd).toBe(120);

    act(() => result.current.disconnect('ontopo'));
    expect(result.current.isConnected('ontopo')).toBe(false);
    expect(result.current.connectedCount).toBe(0);
  });

  it('persists a grant so a reload keeps it', () => {
    const first = renderHook(() => useIntegrationsStore());
    act(() => first.result.current.connect('ontopo', 120));

    const second = renderHook(() => useIntegrationsStore());
    expect(second.result.current.isConnected('ontopo')).toBe(true);
  });

  it('surfaces a browser that refuses to store the choice', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    const { result } = renderHook(() => useIntegrationsStore());
    act(() => result.current.connect('ontopo', 120));

    expect(result.current.state.storageError).toContain('quota exceeded');
    // The grant still holds for this session — the failure is about durability,
    // not about whether the visitor granted anything.
    expect(result.current.isConnected('ontopo')).toBe(true);

    act(() => result.current.dismissStorageError());
    expect(result.current.state.storageError).toBeNull();
  });
});
