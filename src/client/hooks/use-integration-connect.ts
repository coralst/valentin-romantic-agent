import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGetJson, apiPostJsonExplained } from '../utils/api-client';
import type { ConnectableId } from '../utils/integration-connect';

/**
 * Handing credentials to the server from inside the app.
 *
 * Two shapes of flow behind one hook, because the panel should not have to know
 * which is which beyond a label:
 *
 * - **Amadeus and WhatsApp** are one round trip. The server probes the provider
 *   with the candidate values and only keeps them if the provider says yes, so a
 *   `resolve` here genuinely means "this works", not "this was stored".
 * - **Google** cannot be verified without a human. The values are saved, then a
 *   popup carries the visitor through Google's consent screen, and the server's
 *   callback earns the refresh token. So this hook waits for the popup rather
 *   than for its own fetch.
 *
 * Nothing typed into these forms is kept in this module beyond the request. The
 * hook holds status, never values — the component owns the inputs and drops them
 * when it unmounts.
 */

export type ConnectStatus =
  | { phase: 'idle' }
  | { phase: 'working'; id: ConnectableId }
  /** Consent popup is open; we are waiting on the visitor, not on the network. */
  | { phase: 'consenting'; id: ConnectableId }
  | { phase: 'done'; id: ConnectableId; message: string }
  | { phase: 'error'; id: ConnectableId; message: string };

/** What the OAuth popup posts back to us when it finishes. */
interface OAuthMessage {
  source: 'valentin-google-oauth';
  ok: boolean;
}

function isOAuthMessage(data: unknown): data is OAuthMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === 'valentin-google-oauth'
  );
}

export interface UseIntegrationConnect {
  status: ConnectStatus;
  /** Submit a provider's fields. Resolves true when the service is connected. */
  connect: (id: ConnectableId, fields: Record<string, string>) => Promise<boolean>;
  disconnect: (id: ConnectableId) => Promise<boolean>;
  reset: () => void;
}

/**
 * @param onChanged Called after anything that could move readiness, so the
 *   caller can refetch `GET /api/integrations`. Called on failure too: a partial
 *   Google connect (client saved, consent declined) changes nothing the panel
 *   shows, but a failed *disconnect* is worth re-reading rather than assuming.
 */
export function useIntegrationConnect(onChanged: () => void): UseIntegrationConnect {
  const [status, setStatus] = useState<ConnectStatus>({ phase: 'idle' });

  // Guards every setState after an await. Connecting is the one place in this
  // panel where a request outlives its dialog — the sheet closes on success, and
  // a popup can take a minute — so an unguarded update here warns in the console
  // and, worse, resurrects a status for a form that is gone.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reset = useCallback(() => setStatus({ phase: 'idle' }), []);

  /**
   * Run Google's consent leg: open the popup, wait for its verdict.
   *
   * The popup reports back by `postMessage` rather than by us polling its URL —
   * cross-origin, we cannot read its location while it sits on accounts.google.com,
   * and after the redirect it closes itself. A closed-window poll is the fallback
   * for the visitor who dismisses the popup instead of finishing.
   */
  const runConsent = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    const { url } = await apiGetJson<{ url: string }>(
      '/api/integrations/google/auth-url',
    );

    // Opened *after* the await, which is a real constraint on Safari: a popup is
    // only allowed while the browser still considers a user gesture in progress.
    // If this proves flaky, the fix is to fetch the URL before opening rather
    // than to add a permission prompt.
    const popup = window.open(url, 'valentin-google-oauth', 'width=520,height=680');
    if (!popup) {
      return {
        ok: false,
        message: 'Your browser blocked the sign-in window. Allow popups for this site and try again.',
      };
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok: boolean, message: string) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
        clearInterval(closedPoll);
        resolve({ ok, message });
      };

      const onMessage = (event: MessageEvent) => {
        // Same-origin only: the callback page is served by us, so a message from
        // anywhere else is not our popup and must not be able to report success.
        if (event.origin !== window.location.origin) return;
        if (!isOAuthMessage(event.data)) return;
        finish(
          event.data.ok,
          event.data.ok
            ? 'Google connected.'
            : 'Google did not complete the sign-in. Nothing was changed.',
        );
      };
      window.addEventListener('message', onMessage);

      // The visitor closed the window without finishing. Not an error worth
      // shouting about — they changed their mind — but the form must stop
      // waiting.
      const closedPoll = window.setInterval(() => {
        if (popup.closed) {
          finish(false, 'Sign-in window closed before Google could confirm.');
        }
      }, 700);
    });
  }, []);

  const connect = useCallback(
    async (id: ConnectableId, fields: Record<string, string>): Promise<boolean> => {
      setStatus({ phase: 'working', id });
      try {
        const { message } = await apiPostJsonExplained<{ message: string }>(
          `/api/integrations/${id}/connect`,
          fields,
        );

        if (id !== 'google') {
          onChanged();
          if (mounted.current) setStatus({ phase: 'done', id, message });
          return true;
        }

        // Google: the POST only saved the client. The grant is still to come.
        if (mounted.current) setStatus({ phase: 'consenting', id });
        const consent = await runConsent();
        onChanged();
        if (mounted.current) {
          setStatus(
            consent.ok
              ? { phase: 'done', id, message: consent.message }
              : { phase: 'error', id, message: consent.message },
          );
        }
        return consent.ok;
      } catch (err) {
        onChanged();
        if (mounted.current) {
          setStatus({
            phase: 'error',
            id,
            message: err instanceof Error ? err.message : 'That did not work.',
          });
        }
        return false;
      }
    },
    [onChanged, runConsent],
  );

  const disconnect = useCallback(
    async (id: ConnectableId): Promise<boolean> => {
      setStatus({ phase: 'working', id });
      try {
        await apiPostJsonExplained<{ message: string }>(
          `/api/integrations/${id}/disconnect`,
        );
        onChanged();
        if (mounted.current) {
          setStatus({ phase: 'done', id, message: 'Disconnected.' });
        }
        return true;
      } catch (err) {
        onChanged();
        if (mounted.current) {
          setStatus({
            phase: 'error',
            id,
            message: err instanceof Error ? err.message : 'That did not work.',
          });
        }
        return false;
      }
    },
    [onChanged],
  );

  return { status, connect, disconnect, reset };
}
