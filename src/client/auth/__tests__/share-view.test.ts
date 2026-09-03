import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SHARE_PARAM } from '../../../shared/constants/share-link';
import { RESUME_PARAM } from '../../../shared/constants/resume-link';

/**
 * Same timing argument as `resume-session.test.ts` — the token has to be read before
 * `cognito-oauth.ts` wipes the query string — plus two properties specific to this
 * one: the accessor is idempotent, because `App.tsx` re-asks "am I the guest app?"
 * on every render and a consumed token would drop the guest into `LoginScreen`; and
 * the two parameters stay apart, because they have opposite security properties.
 */

/** Load the module fresh with a given query string, as a page load would. */
async function loadWith(search: string) {
  vi.resetModules();
  window.history.replaceState({}, '', `/${search}`);
  return import('../share-view');
}

describe('share-view', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('captures the token a shared link carried', async () => {
    const { takeShareToken } = await loadWith(`?${SHARE_PARAM}=tok-abc`);
    expect(takeShareToken()).toBe('tok-abc');
  });

  it('reads the token at import time, before the auth gate can wipe the query', async () => {
    const module = await loadWith(`?${SHARE_PARAM}=tok-abc`);

    // Exactly what `cognito-oauth.ts` does once sign-in completes: it wipes the whole
    // query string, so anything that waited for a React effect would find nothing.
    window.history.replaceState({}, '', window.location.pathname);
    expect(window.location.search).toBe('');

    expect(module.takeShareToken()).toBe('tok-abc');
  });

  it('hands the token over on every read, unlike the resume id', async () => {
    const { takeShareToken, hasShareToken } = await loadWith(`?${SHARE_PARAM}=tok-abc`);

    // `App.tsx` branches on this during render, and React renders more than once.
    expect(takeShareToken()).toBe('tok-abc');
    expect(takeShareToken()).toBe('tok-abc');
    expect(hasShareToken()).toBe(true);
  });

  it('is null with no parameter, an empty one, or a blank one', async () => {
    expect((await loadWith('')).takeShareToken()).toBeNull();
    expect((await loadWith(`?${SHARE_PARAM}=`)).takeShareToken()).toBeNull();
    expect((await loadWith(`?${SHARE_PARAM}=%20%20`)).takeShareToken()).toBeNull();
    expect((await loadWith('?other=tok-abc')).hasShareToken()).toBe(false);
  });

  it('trims a token a mail client wrapped', async () => {
    const { takeShareToken } = await loadWith(`?${SHARE_PARAM}=%20tok-abc%20`);
    expect(takeShareToken()).toBe('tok-abc');
  });

  it('does not read a resume id as a share token', async () => {
    // The whole point of two parameters: a bare session id authorises nothing and
    // must never be mistaken for a signed credential.
    const { hasShareToken } = await loadWith(`?${RESUME_PARAM}=sess-1`);
    expect(hasShareToken()).toBe(false);
  });

  it('does not persist the token anywhere', async () => {
    const { takeShareToken } = await loadWith(`?${SHARE_PARAM}=tok-abc`);
    expect(takeShareToken()).toBe('tok-abc');

    // A later page load with no parameter must be an ordinary visit, not somebody
    // else's conversation reopening from storage.
    const fresh = await loadWith('');
    expect(fresh.takeShareToken()).toBeNull();
  });
});
