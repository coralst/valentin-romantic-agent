import { useEffect, useRef, useState } from 'react';
import { rememberClaimedSession } from '../auth/claimed-session';
import { rememberSignInSession } from '../auth/initial-session';
import { claimSharedConversation } from '../auth/share-continue';
import { clearShareToken } from '../auth/share-view';
import { setTokenSession, setVisitorId } from '../auth/token-store';
import { SHARE_PARAM } from '../../shared/constants/share-link';
import { colors, insets, radii, shadows, typography } from '../design-system/tokens';
import { SharedConversationView } from './SharedConversationView';

/**
 * What opening a `/?share=<token>` link actually does.
 *
 * ## Why this is not the read-only view any more
 *
 * It used to be: a link opened a transcript with no composer, and that was the whole
 * page. People do not send these links to show somebody a screenshot — they send
 * them to *continue a conversation*, and a page with nothing to type into reads as
 * the app being broken. So a link now trades itself for a real session and drops the
 * visitor into the app proper, in a conversation forked from the point the link was
 * made (`server/sharing/branch-conversation.ts` is where the fork happens and why).
 *
 * The read-only view is kept as the fallback, which is exactly the right place for
 * it: a link that is expired, forged or points at a deleted conversation cannot be
 * continued, and the old copy already says so well.
 *
 * ## Why the claim happens here and not inside `AuthProvider`
 *
 * `AuthProvider` renders `LoginScreen` for anyone not signed in, so a guest reaching
 * it would be asked to make an account before the token could be spent. The claim
 * has to complete *above* it, and its result handed down — see
 * `auth/claimed-session.ts` for that handoff.
 *
 * `children` is the ordinary app tree. It is passed as an element rather than
 * rendered by a callback because creating an element mounts nothing: the tree only
 * comes alive once there is a token for it.
 */

interface ShareEntryProps {
  /** The signed token from the URL. Opaque here; only the server reads it. */
  token: string;
  /** The normal app, rendered once this visitor has a session of their own. */
  children: React.ReactNode;
}

/**
 * Claiming, then one of two ends.
 *
 * No separate `expired` state: everything that stops a link resolving hands off to
 * the read-only view, which fetches the same token itself and already distinguishes
 * "expired" from "the network failed" in the copy it shows. Duplicating that here
 * would mean two components deciding what a 404 means.
 */
type EntryState = 'claiming' | 'entered' | 'unavailable';

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: insets.roomy,
  backgroundColor: colors.linen,
  fontFamily: typography.bodyFontFamily,
  color: colors.ink,
  textAlign: 'center',
};

const noticeStyle: React.CSSProperties = {
  position: 'fixed',
  // Below any header and clear of the composer: this is an aside, not a modal, and
  // it must not sit on top of the one control the visitor is here to use.
  top: insets.snug,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 40,
  maxWidth: 420,
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  padding: `10px ${insets.tight}px`,
  borderRadius: radii.card,
  border: `1px solid ${colors.linenShade}`,
  backgroundColor: colors.porcelain,
  boxShadow: shadows.card,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.body,
  color: colors.ink,
  textAlign: 'left',
};

const dismissStyle: React.CSSProperties = {
  flexShrink: 0,
  border: 'none',
  background: 'none',
  padding: 4,
  cursor: 'pointer',
  color: colors.inkFaint,
  fontSize: typography.px.body,
  lineHeight: 1,
};

/**
 * Drop the share parameter, leaving any others alone.
 *
 * Not `replaceState({}, '', pathname)` — the blunt version `cognito-oauth.ts` uses —
 * because a share link can perfectly well arrive with something else in the query
 * string, and wiping the lot would silently discard it.
 */
function stripShareParam(): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(SHARE_PARAM)) return;
    url.searchParams.delete(SHARE_PARAM);
    const query = url.searchParams.toString();
    window.history.replaceState({}, '', `${url.pathname}${query ? `?${query}` : ''}${url.hash}`);
  } catch {
    // A URL we cannot parse is not worth failing the page load over; the visitor
    // keeps a spent token in the address bar, which is untidy rather than unsafe.
  }
}

export function ShareEntry({ token, children }: ShareEntryProps) {
  const [state, setState] = useState<EntryState>('claiming');
  const [advanced, setAdvanced] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  /*
   * React 19 StrictMode runs mount effects twice, and this effect is not idle —
   * each run forks the conversation. Without the guard a visitor's sidebar opens
   * with two identical copies of it in development.
   */
  const claimedRef = useRef(false);

  useEffect(() => {
    if (claimedRef.current) return;
    claimedRef.current = true;

    void (async () => {
      try {
        const claim = await claimSharedConversation(token);

        // In this order, and all of it before `setState`: the app tree mounts on
        // the next render and its first request must already carry the token, the
        // visitor id, and the session it is meant to open.
        if (claim.visitorId) setVisitorId(claim.visitorId);
        setTokenSession({
          accessToken: claim.accessToken,
          refreshToken: claim.refreshToken,
          expiresAt: Date.now() + claim.expiresIn * 1000,
          demo: claim.demo,
        });
        // Names the fork, so `SessionProvider` opens it rather than creating an
        // empty conversation while the session list is still catching up.
        rememberSignInSession(claim.sessionId);
        rememberClaimedSession({ accessToken: claim.accessToken, demo: claim.demo });

        // Spent: neither the URL nor `App.tsx` should still be treating this page
        // load as a guest's.
        clearShareToken();
        stripShareParam();

        setAdvanced(claim.advanced);
        setState('entered');
      } catch {
        // Deliberately no message: the fallback view fetches the same token and
        // says what is wrong with it in its own words.
        setState('unavailable');
      }
    })();
  }, [token]);

  if (state === 'claiming') {
    return (
      <div style={pageStyle} role="status" aria-live="polite">
        <p style={{ margin: 0, color: colors.inkFaint }}>Opening the conversation…</p>
      </div>
    );
  }

  if (state === 'unavailable') {
    return <SharedConversationView token={token} />;
  }

  return (
    <>
      {children}
      {advanced && !dismissed && (
        <div style={noticeStyle} role="status">
          <span>
            You're continuing from where this link was made. The original conversation
            has moved on since then, so anything said after that is not here.
          </span>
          <button
            type="button"
            style={dismissStyle}
            aria-label="Dismiss"
            onClick={() => setDismissed(true)}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
