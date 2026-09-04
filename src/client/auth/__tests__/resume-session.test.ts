import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RESUME_PARAM, resumeLink } from '../../../shared/constants/resume-link';

/**
 * The link in a reminder email has to survive the trip through the auth gate, and
 * the only thing that makes that true is *when* the id is read. These tests pin
 * the timing, because a refactor that moves the read into an effect would still
 * pass any test that set the URL and called `take` in the same breath.
 */

/** Load the module fresh with a given query string, as a page load would. */
async function loadWith(search: string) {
  vi.resetModules();
  window.history.replaceState({}, '', `/${search}`);
  return import('../resume-session');
}

describe('resume-session', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('captures the session id a link asked for', async () => {
    const { takeResumeSession } = await loadWith(`?${RESUME_PARAM}=abc-123`);
    expect(takeResumeSession()).toBe('abc-123');
  });

  it('reads the id at import time, before the auth gate can wipe the query', async () => {
    const module = await loadWith(`?${RESUME_PARAM}=abc-123`);

    /*
     * Exactly what `cognito-oauth.ts` does once sign-in completes. It wipes the
     * whole query string, not just the auth code, so anything that waited for a
     * React effect would find nothing here.
     */
    window.history.replaceState({}, '', window.location.pathname);
    expect(window.location.search).toBe('');

    expect(module.takeResumeSession()).toBe('abc-123');
  });

  it('hands the id over once and only once', async () => {
    const { takeResumeSession } = await loadWith(`?${RESUME_PARAM}=abc-123`);
    expect(takeResumeSession()).toBe('abc-123');
    // A remount, or a sign-in as somebody else, must not reopen the first
    // visitor's conversation.
    expect(takeResumeSession()).toBeNull();
  });

  it('reports whether a resume was asked for without consuming it', async () => {
    const { hasResumeSession, takeResumeSession } = await loadWith(
      `?${RESUME_PARAM}=abc-123`,
    );
    expect(hasResumeSession()).toBe(true);
    expect(hasResumeSession()).toBe(true);
    expect(takeResumeSession()).toBe('abc-123');
    expect(hasResumeSession()).toBe(false);
  });

  it('is null with no parameter, an empty one, or a blank one', async () => {
    expect((await loadWith('')).takeResumeSession()).toBeNull();
    expect((await loadWith(`?${RESUME_PARAM}=`)).takeResumeSession()).toBeNull();
    expect((await loadWith(`?${RESUME_PARAM}=%20%20`)).takeResumeSession()).toBeNull();
  });

  it('ignores other parameters, including the auth code and the bar flag', async () => {
    const { takeResumeSession } = await loadWith('?code=xyz&bar=noir');
    expect(takeResumeSession()).toBeNull();
  });

  it('round-trips an id the server put in an email body', async () => {
    // The server builds the link; the client parses it. This is the one assertion
    // that fails if either side changes the parameter name on its own.
    const link = resumeLink('https://example.test/', 'sess/with?odd&chars');
    const { takeResumeSession } = await loadWith(new URL(link).search);
    expect(takeResumeSession()).toBe('sess/with?odd&chars');
  });
});
