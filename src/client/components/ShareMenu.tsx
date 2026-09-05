import { useCallback, useEffect, useRef, useState } from 'react';
import { resumeLink } from '../../shared/constants/resume-link';
import {
  SHARE_TTL_DAYS,
  type ShareLinkResponse,
} from '../../shared/constants/share-link';
import { colors, insets, radii, shadows, typography } from '../design-system/tokens';
import { apiPostJsonExplained } from '../utils/api-client';

/**
 * "Share" in the conversation header — one control, three genuinely different things.
 *
 * A single Share button would have to pick one of them silently, and the three are
 * not interchangeable:
 *
 * - **My link** is `resumeLink`'s `/?s=<id>`, which authorises nothing. Every
 *   session route is scoped to the caller, so this opens the conversation for its
 *   owner and 404s for everybody else. That is exactly what makes it safe to leave
 *   in a note to self — and exactly what makes it useless for sharing, so the copy
 *   says both.
 * - **A link anyone can open** mints a signed token server-side and is a real
 *   credential with a real blast radius. Its warning is rendered *before* the link
 *   exists, not after: a caveat that appears next to a URL already sitting on the
 *   clipboard is a notification, not a choice.
 * - **Email it to me** sends the transcript to the address on the account, and fails
 *   with a 409 when there is no address yet. That is a fixable state rather than an
 *   error, so the server's own sentence — which names the panel to fix it in — is
 *   shown verbatim instead of being flattened into "something went wrong".
 *
 * Nothing here mints or inspects a token; `share-token.ts` on the server is the only
 * thing that can. This component only ever handles the assembled `url` it is given.
 */

interface ShareMenuProps {
  /**
   * The conversation to share, or null when there is not one yet.
   *
   * Null renders nothing at all. The chat column mounts standalone in tests and on
   * mobile before the socket has minted a session, and a Share button that cannot
   * name a conversation has nothing to offer.
   */
  sessionId: string | null;
}

/** Which action is in flight. At most one — every button disables while one runs. */
type PendingAction = 'mine' | 'public' | 'email';

interface Outcome {
  kind: 'done' | 'error';
  text: string;
}

/** How long an outcome stays on screen before clearing itself. */
const OUTCOME_MS = 7000;

const wrapperStyle: React.CSSProperties = {
  position: 'relative',
  marginLeft: 'auto',
  flexShrink: 0,
};

/**
 * The trigger is the share glyph rather than the word "Share".
 *
 * Three nodes in a triangle with two links, which is the glyph a phone's share
 * sheet is reached by and so the one thing here nobody has to read to understand.
 * Deliberately *not* the rail's `FanOutMark`, which is one node fanning to three:
 * that mark is the integrations identity, and it now appears a few pixels away on
 * the status strip's own affordance — two near-identical fans meaning "share this
 * conversation" and "what Valentin can reach" would be worse than a word.
 *
 * The word is not lost: it is the button's `aria-label` and its `title`, so a
 * screen reader and a hovering pointer both still get "Share".
 */
const triggerStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  display: 'grid',
  placeItems: 'center',
  padding: 0,
  borderRadius: radii.pill,
  border: `1px solid ${colors.linenShade}`,
  backgroundColor: colors.porcelain,
  color: colors.claret,
  cursor: 'pointer',
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  fontWeight: typography.weights.medium,
};

const popoverStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  right: 0,
  zIndex: 20,
  width: 312,
  boxSizing: 'border-box',
  padding: insets.tight,
  display: 'flex',
  flexDirection: 'column',
  gap: insets.tight,
  borderRadius: radii.panel,
  border: `1px solid ${colors.linenShade}`,
  backgroundColor: colors.porcelain,
  boxShadow: shadows.cardHover,
  textAlign: 'left',
};

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  fontWeight: typography.weights.semibold,
  color: colors.ink,
};

const proseStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.caption,
  lineHeight: typography.lineHeights.normal,
  color: colors.inkMuted,
};

/**
 * The warning above the public link. Claret and bordered rather than grey prose,
 * because it is the one sentence in this popover somebody could regret not reading.
 */
const warningStyle: React.CSSProperties = {
  margin: 0,
  padding: '8px 10px',
  borderRadius: radii.kv,
  border: `1px solid ${colors.petal}`,
  backgroundColor: colors.sand,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.caption,
  lineHeight: typography.lineHeights.normal,
  color: colors.claret,
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  backgroundColor: colors.borderSubtle,
  border: 'none',
  margin: 0,
};

const fallbackInputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  height: 32,
  padding: '0 8px',
  borderRadius: radii.kv,
  border: `1px solid ${colors.linenShade}`,
  backgroundColor: colors.surface,
  color: colors.ink,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.caption,
};

function actionButtonStyle(disabled: boolean, primary: boolean): React.CSSProperties {
  return {
    height: 32,
    padding: '0 12px',
    borderRadius: radii.chip,
    border: primary ? 'none' : `1px solid ${colors.linenShade}`,
    backgroundColor: primary ? colors.claret : colors.porcelain,
    color: primary ? colors.onClaret : colors.inkMuted,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    fontFamily: typography.bodyFontFamily,
    fontSize: typography.px.label,
    fontWeight: primary ? typography.weights.semibold : typography.weights.normal,
    alignSelf: 'flex-start',
  };
}

function outcomeStyle(kind: Outcome['kind'] | null): React.CSSProperties {
  return {
    margin: 0,
    minHeight: 15,
    fontFamily: typography.bodyFontFamily,
    fontSize: typography.px.caption,
    lineHeight: typography.lineHeights.normal,
    color: kind === 'error' ? colors.claret : colors.olive,
  };
}

/** "10 Sep 2026" — the `en-GB` shape every other date in this app is rendered in. */
export function formatShareExpiry(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Put `text` on the clipboard, reporting whether it landed.
 *
 * `navigator.clipboard` is absent on insecure origins — which includes the plain
 * `http://` a demo sometimes runs on — and can reject even where it exists, when the
 * document is not focused or permission is refused. Both are ordinary, so neither
 * throws here: the caller shows the URL in a selectable field instead, and the action
 * never dead-ends with nothing on the clipboard and nothing on screen.
 */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Three nodes, two links — the share glyph. Decorative; the button carries the name. */
function ShareMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={15}
      height={15}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="6.5" cy="12" r="2.4" />
      <circle cx="17.5" cy="5.8" r="2.4" />
      <circle cx="17.5" cy="18.2" r="2.4" />
      <path d="M8.7 10.8l6.6-3.7M8.7 13.2l6.6 3.7" />
    </svg>
  );
}

export function ShareMenu({ sessionId }: ShareMenuProps) {
  const [isOpen, setOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [publicLink, setPublicLink] = useState<ShareLinkResponse | null>(null);
  /** A URL the clipboard refused, held so it can be selected by hand instead. */
  const [manualCopyUrl, setManualCopyUrl] = useState<string | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const manualCopyRef = useRef<HTMLInputElement>(null);

  /**
   * Close, and hand focus back to the button that opened it.
   *
   * Without this the focus ring is left on a node that has just been unmounted, and
   * a keyboard user's next Tab starts again from the top of the document.
   */
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Escape and an outside click both dismiss, the way a popover should. Bound on the
  // document rather than the popover because focus may be anywhere by now.
  useEffect(() => {
    if (!isOpen) return;

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handlePointer);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handlePointer);
    };
  }, [isOpen, close]);

  // Move focus into the popover on open, so the first Tab lands on its own controls.
  useEffect(() => {
    if (isOpen) popoverRef.current?.focus();
  }, [isOpen]);

  // Pre-select the fallback URL, so the visitor's next keystroke is ⌘C and not a
  // drag across a 90-character string.
  useEffect(() => {
    if (manualCopyUrl) manualCopyRef.current?.select();
  }, [manualCopyUrl]);

  // Every outcome clears itself. A "Copied" that stays put is indistinguishable
  // from a "Copied" from four actions ago.
  useEffect(() => {
    if (!outcome) return;
    const timer = window.setTimeout(() => setOutcome(null), OUTCOME_MS);
    return () => window.clearTimeout(timer);
  }, [outcome]);

  /** Copy, or fall back to showing the URL. Either way, say which happened. */
  const report = useCallback(async (url: string, copiedText: string) => {
    const copied = await writeClipboard(url);
    if (copied) {
      setManualCopyUrl(null);
      setOutcome({ kind: 'done', text: copiedText });
      return;
    }
    setManualCopyUrl(url);
    setOutcome({ kind: 'done', text: 'Copying was blocked — here is the link to copy by hand.' });
  }, []);

  const handleCopyMyLink = async () => {
    if (!sessionId) return;
    setPending('mine');
    try {
      await report(
        resumeLink(window.location.origin, sessionId),
        'Copied. That link only opens for you.',
      );
    } finally {
      setPending(null);
    }
  };

  const handleCreatePublicLink = async () => {
    if (!sessionId) return;
    setPending('public');
    setOutcome(null);
    try {
      const created = await apiPostJsonExplained<ShareLinkResponse>(
        `/api/session/${encodeURIComponent(sessionId)}/share`,
      );
      setPublicLink(created);
      await report(created.url, 'Link created and copied.');
    } catch (cause) {
      setOutcome({
        kind: 'error',
        text: cause instanceof Error ? cause.message : 'the link could not be created',
      });
    } finally {
      setPending(null);
    }
  };

  const handleEmailToMe = async () => {
    if (!sessionId) return;
    setPending('email');
    setOutcome(null);
    try {
      await apiPostJsonExplained<unknown>(
        `/api/session/${encodeURIComponent(sessionId)}/email`,
      );
      setOutcome({ kind: 'done', text: 'Sent. Check your inbox.' });
    } catch (cause) {
      // `Explained`, not `apiPostJson`: a 409 here means "you have no notify address
      // yet", and the server's sentence is the one that says where to add one.
      // Flattened to "the server responded with 409" it would read as a bug.
      setOutcome({
        kind: 'error',
        text: cause instanceof Error ? cause.message : 'that could not be sent',
      });
    } finally {
      setPending(null);
    }
  };

  if (!sessionId) return null;

  const busy = pending !== null;
  const expiry = publicLink ? formatShareExpiry(publicLink.expiresAt) : null;

  return (
    <div style={wrapperStyle} data-testid="share-menu">
      <button
        type="button"
        ref={triggerRef}
        style={triggerStyle}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label="Share"
        title="Share"
        onClick={() => (isOpen ? close() : setOpen(true))}
        data-testid="share-trigger"
      >
        <ShareMark />
      </button>

      {isOpen ? (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Share this conversation"
          tabIndex={-1}
          style={popoverStyle}
          data-testid="share-popover"
        >
          <section style={sectionStyle}>
            <h3 style={sectionTitleStyle}>Copy my link</h3>
            <p style={proseStyle}>
              Reopens this conversation when <em>you</em> are signed in, and does
              nothing for anyone else. Safe to keep in a note to self.
            </p>
            <button
              type="button"
              style={actionButtonStyle(busy, false)}
              disabled={busy}
              onClick={handleCopyMyLink}
              data-testid="share-copy-mine"
            >
              {pending === 'mine' ? 'Copying…' : 'Copy my link'}
            </button>
          </section>

          <hr style={dividerStyle} />

          <section style={sectionStyle}>
            <h3 style={sectionTitleStyle}>Create a link anyone can open</h3>
            {/* Before the link exists, not after. */}
            <p style={warningStyle} data-testid="share-public-warning">
              Anyone holding this link can read this conversation — including
              everything already said about her — for {SHARE_TTL_DAYS} days.
            </p>
            <button
              type="button"
              style={actionButtonStyle(busy, true)}
              disabled={busy}
              onClick={handleCreatePublicLink}
              data-testid="share-create-public"
            >
              {pending === 'public' ? 'Creating…' : 'Create link'}
            </button>
            {publicLink ? (
              <p style={proseStyle} data-testid="share-public-expiry">
                {expiry
                  ? `This link stops working on ${expiry}.`
                  : `This link stops working after ${SHARE_TTL_DAYS} days.`}
              </p>
            ) : null}
          </section>

          <hr style={dividerStyle} />

          <section style={sectionStyle}>
            <h3 style={sectionTitleStyle}>Email this conversation to me</h3>
            <p style={proseStyle}>Sends the transcript to the address on your account.</p>
            <button
              type="button"
              style={actionButtonStyle(busy, false)}
              disabled={busy}
              onClick={handleEmailToMe}
              data-testid="share-email"
            >
              {pending === 'email' ? 'Sending…' : 'Email it to me'}
            </button>
          </section>

          {manualCopyUrl ? (
            <input
              ref={manualCopyRef}
              readOnly
              value={manualCopyUrl}
              style={fallbackInputStyle}
              aria-label="Link to copy"
              onFocus={(event) => event.currentTarget.select()}
              data-testid="share-manual-copy"
            />
          ) : null}

          {/*
            Mounted whether or not there is anything to say. An `aria-live` region
            has to exist before its content changes to be announced — inserting one
            already holding "Copied" announces nothing.
          */}
          <p
            role="status"
            aria-live="polite"
            style={outcomeStyle(outcome?.kind ?? null)}
            data-testid="share-outcome"
          >
            {outcome?.text ?? ''}
          </p>
        </div>
      ) : null}
    </div>
  );
}
