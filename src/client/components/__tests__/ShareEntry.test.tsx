import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ShareEntry } from '../ShareEntry';
import { takeClaimedSession } from '../../auth/claimed-session';
import { takeSignInSession } from '../../auth/initial-session';
import { hasShareToken, setShareTokenForTests } from '../../auth/share-view';
import { clearTokenSession, peekAccessToken, peekVisitorId } from '../../auth/token-store';
import type { ShareContinueResponse } from '../../../shared/constants/share-link';

/**
 * The handoff from a link to a live session.
 *
 * The assertions that matter are about *ordering and once-ness*: the token, the
 * visitor id and the forked session id must all be in place before the app tree
 * mounts, and the claim must happen exactly once no matter how many times React
 * mounts this. A second claim is not a wasted request — it forks the conversation
 * again, and the visitor's sidebar opens with two copies of it.
 */

const claim: ShareContinueResponse = {
  accessToken: 'visitor-token',
  refreshToken: null,
  expiresIn: 3600,
  sessionId: 'forked-session',
  visitorId: '33333333-3333-4333-8333-333333333333',
  demo: true,
  title: 'Planning the 4th (continued)',
  copied: 4,
  advanced: false,
};

function fetchThatAnswers(status: number, body?: unknown): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response);
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** Stands in for the app tree, and proves what was in place when it mounted. */
function Landed() {
  return (
    <div data-testid="landed">
      <span data-testid="token-at-mount">{peekAccessToken() ?? 'none'}</span>
      <span data-testid="visitor-at-mount">{peekVisitorId() ?? 'none'}</span>
    </div>
  );
}

beforeEach(() => {
  clearTokenSession();
  // Drained so one test cannot read what another left behind.
  takeClaimedSession();
  takeSignInSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearTokenSession();
  setShareTokenForTests(null);
});

describe('opening a share link', () => {
  it('trades the link for a session and then renders the app', async () => {
    const spy = fetchThatAnswers(200, claim);

    render(
      <ShareEntry token="tok">
        <Landed />
      </ShareEntry>,
    );

    // An interstitial rather than a blank page, because the claim is a round trip.
    expect(screen.getByRole('status')).toHaveTextContent(/Opening the conversation/i);

    await waitFor(() => expect(screen.getByTestId('landed')).toBeInTheDocument());

    expect(spy).toHaveBeenCalledWith('/api/share/tok/continue', { method: 'POST' });
    // Both already in the store by the time the tree mounted — the first request the
    // app makes must carry them.
    expect(screen.getByTestId('token-at-mount')).toHaveTextContent('visitor-token');
    expect(screen.getByTestId('visitor-at-mount')).toHaveTextContent(claim.visitorId!);
    // And the fork is named, so SessionProvider opens it instead of making a new one.
    expect(takeSignInSession()).toBe('forked-session');
  });

  it('spends the token exactly once, however often it is mounted', async () => {
    const spy = fetchThatAnswers(200, claim);

    const view = render(
      <ShareEntry token="tok">
        <Landed />
      </ShareEntry>,
    );
    await waitFor(() => expect(screen.getByTestId('landed')).toBeInTheDocument());
    view.rerender(
      <ShareEntry token="tok">
        <Landed />
      </ShareEntry>,
    );

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('stops treating the page load as a guest’s once the link is spent', async () => {
    setShareTokenForTests('tok');
    fetchThatAnswers(200, claim);

    render(
      <ShareEntry token="tok">
        <Landed />
      </ShareEntry>,
    );
    await waitFor(() => expect(screen.getByTestId('landed')).toBeInTheDocument());

    // Otherwise App.tsx keeps answering "this is a share link" and a remount forks
    // the conversation a second time.
    expect(hasShareToken()).toBe(false);
    expect(new URLSearchParams(window.location.search).has('share')).toBe(false);
  });

  it('tells the auth provider what it already obtained', async () => {
    fetchThatAnswers(200, claim);

    render(
      <ShareEntry token="tok">
        <Landed />
      </ShareEntry>,
    );
    await waitFor(() => expect(screen.getByTestId('landed')).toBeInTheDocument());

    // Without this the boot sequence recognises none of the four candidates it knows
    // and, on a local server, replaces this session with the development user.
    expect(takeClaimedSession()).toEqual({ accessToken: 'visitor-token', demo: true });
  });

  it('says the conversation moved on, when it did', async () => {
    fetchThatAnswers(200, { ...claim, advanced: true });

    render(
      <ShareEntry token="tok">
        <Landed />
      </ShareEntry>,
    );
    await waitFor(() => expect(screen.getByTestId('landed')).toBeInTheDocument());

    // Beside the app, not instead of it: a visitor told nothing assumes the missing
    // turns were lost.
    expect(screen.getByRole('status')).toHaveTextContent(/moved on/i);
  });

  it('falls back to the read-only view when the link cannot be continued', async () => {
    // 404 on the claim, then the fallback fetches the same token itself and gets the
    // same answer.
    fetchThatAnswers(404, { error: 'This link has expired or is not valid' });

    render(
      <ShareEntry token="tok">
        <Landed />
      </ShareEntry>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('shared-view')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('landed')).not.toBeInTheDocument();
    // Nothing adopted, so the app cannot come up half-signed-in behind the notice.
    expect(peekAccessToken()).toBeNull();
    expect(takeClaimedSession()).toBeNull();
  });
});
