import { useEffect, useState } from 'react';
import type { ChatMessage } from '../../shared/interfaces/message';
import type {
  SharedConversation,
  SharedMessage,
} from '../../shared/constants/share-link';
import { colors, insets, radii, typography } from '../design-system/tokens';
import { chatMeasureStyle } from './chat-measure';
import { MessageBubble } from './MessageBubble';

/**
 * What somebody sees when they open a `/?share=<token>` link.
 *
 * This is the whole app for that page load. There is no account behind it, so
 * `App.tsx` renders this *instead of* `AuthProvider` and everything under it —
 * mounting the session stack would only produce a wall of 401s, and mounting the
 * auth provider would put `LoginScreen` in front of a guest who has no account and
 * is not being asked to make one.
 *
 * It is deliberately a dead end: transcript and title, no composer, no dossier, no
 * rails, nothing to click through to. `share-link.ts` argues the narrow-type case
 * for why the profile is not here; this component is the other half of that promise,
 * and the copy states what the page is rather than letting it look like a stripped
 * version of the real app someone might try to sign into.
 */

interface SharedConversationViewProps {
  /** The signed token from the URL. Opaque here; only the server reads it. */
  token: string;
}

/**
 * Loading, then one of three ends.
 *
 * `gone` and `failed` are kept apart because they call for opposite things from the
 * reader: an expired link is finished and there is nothing to do but be told so,
 * while a transport failure is worth a reload. Collapsing them would either invite
 * someone to retry a link that will never work again, or hide a blip behind
 * "expired".
 */
type ViewState =
  | { status: 'loading' }
  | { status: 'loaded'; conversation: SharedConversation }
  | { status: 'gone' }
  | { status: 'failed' };

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  boxSizing: 'border-box',
  padding: `${insets.roomy}px ${insets.tight}px`,
  backgroundColor: colors.linen,
  fontFamily: typography.bodyFontFamily,
  color: colors.ink,
};

const sheetStyle: React.CSSProperties = {
  ...chatMeasureStyle,
  boxSizing: 'border-box',
  padding: `${insets.snug}px ${insets.roomy}px ${insets.roomy}px`,
  borderRadius: radii.card,
  border: `1px solid ${colors.linenShade}`,
  backgroundColor: colors.porcelain,
};

const eyebrowStyle: React.CSSProperties = {
  margin: 0,
  fontSize: typography.px.eyebrow,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: colors.inkFaint,
};

const titleStyle: React.CSSProperties = {
  margin: '6px 0 0',
  fontFamily: typography.headingFontFamily,
  fontSize: typography.px.headingLg,
  fontWeight: typography.weights.normal,
  color: colors.ink,
};

const noteStyle: React.CSSProperties = {
  margin: '8px 0 0',
  fontSize: typography.px.caption,
  lineHeight: typography.lineHeights.normal,
  color: colors.inkMuted,
};

const separatorStyle: React.CSSProperties = {
  height: 1,
  border: 'none',
  margin: `${insets.tight}px 0`,
  background: colors.hairlineGradient,
};

const transcriptStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

/** "10 Sep 2026", matching every other date this app prints. */
function formatExpiry(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Adapt a guest turn to the bubble the app already draws.
 *
 * `MessageBubble` is reused rather than reimplemented because it needs no context —
 * only `useTypewriter` — so a guest gets the real thing. The ids are synthesised
 * from the index: the wire shape has none, on purpose, and the bubble only uses an
 * id to remember which reveals have already played. `animate` is left off
 * everywhere, so nothing types itself out; a shared transcript is a record, not an
 * arrival.
 */
function toChatMessage(message: SharedMessage, index: number): ChatMessage {
  return {
    id: `shared-${index}`,
    sessionId: '',
    sender: message.role === 'user' ? 'user' : 'agent',
    content: message.content,
    timestamp: message.timestamp,
  };
}

export function SharedConversationView({ token }: SharedConversationViewProps) {
  const [state, setState] = useState<ViewState>({ status: 'loading' });

  useEffect(() => {
    let live = true;

    async function load() {
      try {
        /*
         * A bare `fetch`, and the one place in the client where that is correct.
         * `apiFetch` attaches a bearer token, and there is none — the guest has no
         * account. Worse, on a browser that happens to hold a *stale* token from a
         * previous signed-in visit, sending it would make this request look like an
         * authenticated one and invite the server to answer as that user. The share
         * token in the path is the whole credential.
         */
        const response = await fetch(`/api/share/${encodeURIComponent(token)}`);
        if (!live) return;

        if (response.status === 404) {
          setState({ status: 'gone' });
          return;
        }
        if (!response.ok) {
          setState({ status: 'failed' });
          return;
        }

        const conversation = (await response.json()) as SharedConversation;
        if (!live) return;
        setState({ status: 'loaded', conversation });
      } catch {
        if (live) setState({ status: 'failed' });
      }
    }

    void load();
    return () => {
      live = false;
    };
  }, [token]);

  if (state.status === 'loading') {
    return (
      <main style={pageStyle} data-testid="shared-view">
        <div style={sheetStyle}>
          <p style={eyebrowStyle}>Shared conversation</p>
          <p style={noteStyle} role="status" data-testid="shared-loading">
            Opening the conversation…
          </p>
        </div>
      </main>
    );
  }

  if (state.status === 'gone') {
    // Nothing but the explanation. There is no retry that could work, and a button
    // offering one would be a lie; an invitation to sign up would be worse — the
    // visitor came to read one conversation, not to be converted.
    return (
      <main style={pageStyle} data-testid="shared-view">
        <div style={sheetStyle}>
          <p style={eyebrowStyle}>Shared conversation</p>
          <h1 style={titleStyle} data-testid="shared-expired">
            This link has expired
          </h1>
          <p style={noteStyle}>
            Shared links stop working after a while, and this one has. Nothing is
            wrong with your link — it is simply finished. If you still need to read
            the conversation, ask the person who sent it for a new link.
          </p>
        </div>
      </main>
    );
  }

  if (state.status === 'failed') {
    return (
      <main style={pageStyle} data-testid="shared-view">
        <div style={sheetStyle}>
          <p style={eyebrowStyle}>Shared conversation</p>
          <h1 style={titleStyle} data-testid="shared-failed">
            This conversation could not be loaded
          </h1>
          <p style={noteStyle}>
            Something went wrong on the way here rather than with the link itself.
            Reloading the page is worth a try.
          </p>
        </div>
      </main>
    );
  }

  const { conversation } = state;
  const expiry = formatExpiry(conversation.expiresAt);

  return (
    <main style={pageStyle} data-testid="shared-view">
      <article style={sheetStyle} data-testid="shared-conversation">
        <header>
          <p style={eyebrowStyle}>Shared conversation</p>
          <h1 style={titleStyle} data-testid="shared-title">
            {conversation.title}
          </h1>
          <p style={noteStyle} data-testid="shared-readonly-note">
            A read-only copy of one conversation, shared by its owner. You cannot
            reply here.
            {expiry ? ` This link stops working on ${expiry}.` : ''}
          </p>
        </header>

        <hr style={separatorStyle} />

        <div style={transcriptStyle} data-testid="shared-transcript">
          {conversation.messages.length === 0 ? (
            <p style={noteStyle}>This conversation has no messages in it.</p>
          ) : (
            conversation.messages.map((message, index) => (
              <MessageBubble key={index} message={toChatMessage(message, index)} />
            ))
          )}
        </div>
      </article>
    </main>
  );
}
