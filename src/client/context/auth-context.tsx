import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  beginLogin,
  exchangeCode,
  hostedLogoutUrl,
  readCallback,
  refreshAccessToken,
  revokeRefreshToken,
} from '../auth/cognito-oauth';
import { demoLogin } from '../auth/demo-login';
import { takeClaimedSession } from '../auth/claimed-session';
import { rememberSignInSession } from '../auth/initial-session';
import { describeToken } from '../auth/identity';
import {
  canHostedLogin,
  fetchRuntimeConfig,
  type DemoPersonaSummary,
  type RuntimeAuthConfig,
} from '../auth/runtime-config';
import {
  clearStoredDemoSession,
  clearTokenSession,
  configureTokenStore,
  peekAccessToken,
  setDevSession,
  setTokenSession,
  setVisitorId,
  storedDemoSession,
  storedRefreshToken,
} from '../auth/token-store';
import { LoginScreen } from '../components/LoginScreen';

/** Where the sign-in flow currently stands */
export type AuthStatus = 'loading' | 'signed-out' | 'signed-in' | 'error';

export interface AuthContextValue {
  status: AuthStatus;
  /** A message worth showing a person, or null */
  error: string | null;
  /** True while a sign-in attempt is in flight */
  busy: boolean;
  /** The backend is running without Cognito — local development */
  authDisabled: boolean;
  /** POST /api/demo/login is available */
  demoAvailable: boolean;
  /** The demo profiles this deployment offers; empty when it advertises none */
  demoPersonas: DemoPersonaSummary[];
  /** A real Hosted UI login can be attempted */
  hostedAvailable: boolean;
  isDemo: boolean;
  /** Short label for the header chip */
  userLabel: string;
  signIn: () => void;
  /** Create an account, through the Hosted UI's sign-up page */
  signUp: () => void;
  /** @param persona Which demo profile to seed; the server's default if absent */
  signInAsDemo: (persona?: string) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Identifies this browser to the dev-bypass verifier across reloads */
const DEV_USER_KEY = 'valentin.devUser';

function devUserId(): string {
  const existing = localStorage.getItem(DEV_USER_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(DEV_USER_KEY, created);
  return created;
}

/**
 * Owns the sign-in lifecycle and gates the rest of the app on it.
 *
 * Children render **only** once there is a token. That is deliberate: it means
 * SessionProvider never mounts without one, `use-websocket` needs no
 * wait-for-auth state, and signing out unmounts the subtree — which discards
 * every scrap of in-memory conversation state for free, rather than by
 * remembering to clear each store.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [userLabel, setUserLabel] = useState('');
  const configRef = useRef<RuntimeAuthConfig | null>(null);
  const [config, setConfig] = useState<RuntimeAuthConfig | null>(null);
  // React 19 StrictMode runs mount effects twice; a second boot would try to
  // exchange an already-consumed authorization code.
  const bootedRef = useRef(false);

  /**
   * Adopt a token as the current session.
   *
   * `demoLabel` is the *person* behind a demo token — the persona's `userName`,
   * e.g. "Ralf". Every demo persona shares one Cognito account, so the token
   * cannot say which profile was seeded — only the login response can, and it is
   * the caller who holds it.
   */
  const adopt = useCallback(
    (accessToken: string, demo: boolean, demoLabel?: string) => {
      setIsDemo(demo);
      setUserLabel(
        demo ? (demoLabel ?? 'Demo profile') : describeToken(accessToken),
      );
      setError(null);
      setStatus('signed-in');
    },
    [],
  );

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    void (async () => {
      let runtime: RuntimeAuthConfig;
      try {
        runtime = await fetchRuntimeConfig();
      } catch {
        setError('The server is not reachable. Refresh to try again.');
        setStatus('error');
        return;
      }

      configRef.current = runtime;
      setConfig(runtime);
      configureTokenStore({
        refresh: canHostedLogin(runtime)
          ? async (refreshToken) => {
              const tokens = await refreshAccessToken(runtime, refreshToken);
              return {
                accessToken: tokens.access_token,
                // Cognito does not re-issue a refresh token on this grant.
                refreshToken,
                expiresAt: Date.now() + tokens.expires_in * 1000,
              };
            }
          : null,
        onSessionLost: () => {
          setIsDemo(false);
          setStatus('signed-out');
          setError('Your session ended. Sign in again to continue.');
        },
      });

      /*
       * 0. A session this page load already obtained for itself.
       *
       * Today that means one thing: a share link was opened and `ShareEntry`
       * traded it for a visitor credential before rendering this provider. It is
       * checked first because none of the four candidates below can recognise it,
       * and candidate 4 would actively replace it with the development user on a
       * local server — stranding the fork the visitor was just handed.
       *
       * The token is already in the store; all that is left is to adopt it.
       */
      const claimed = takeClaimedSession();
      if (claimed) {
        adopt(claimed.accessToken, claimed.demo, claimed.label);
        return;
      }

      // 1. A redirect coming back from the Hosted UI.
      try {
        const callback = readCallback();
        if (callback) {
          const tokens = await exchangeCode(runtime, callback);
          setTokenSession({
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token ?? null,
            expiresAt: Date.now() + tokens.expires_in * 1000,
          });
          adopt(tokens.access_token, false);
          return;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The sign-in failed');
        setStatus('signed-out');
        return;
      }

      // 2. A refresh token this tab left behind on an earlier load.
      const refresh = storedRefreshToken();
      if (refresh && canHostedLogin(runtime)) {
        try {
          const tokens = await refreshAccessToken(runtime, refresh);
          setTokenSession({
            accessToken: tokens.access_token,
            refreshToken: refresh,
            expiresAt: Date.now() + tokens.expires_in * 1000,
          });
          adopt(tokens.access_token, false);
          return;
        } catch {
          clearTokenSession();
        }
      }

      // 3. A demo session this tab was holding before the page reloaded.
      //
      // Deliberately *not* another POST /api/demo/login: that mints a fresh
      // visitorId and seeds a new conversation, which would strand the ones this
      // visitor already has on the old partition. The stored token and the
      // visitor id in sessionStorage together are the whole session, so adopting
      // them is enough — `GET /api/sessions` then answers with the same rows.
      const demo = storedDemoSession();
      if (demo) {
        if (demo.expiresAt > Date.now()) {
          setTokenSession({
            accessToken: demo.accessToken,
            refreshToken: null,
            expiresAt: demo.expiresAt,
            demo: true,
            demoLabel: demo.label,
          });
          adopt(demo.accessToken, true, demo.label);
          return;
        }
        // Expired: nothing can renew a demo token, so forget it and let them in
        // through the front door again.
        clearStoredDemoSession();
      }

      // 4. No Cognito behind this deployment: act as a development user rather
      // than showing a login page that could not work. This is what keeps the
      // Playwright specs and rehearsal.mjs running unchanged.
      if (runtime.authDisabled) {
        const id = devUserId();
        setDevSession(id);
        adopt(`dev:${id}`, false);
        return;
      }

      setStatus('signed-out');
    })();
  }, [adopt]);

  const signIn = useCallback(() => {
    const runtime = configRef.current;
    if (!runtime) return;

    if (runtime.authDisabled) {
      // The bypass has no login page to show; being "signed in" is a local
      // fiction, so honour the click by restoring the development user.
      const id = devUserId();
      setDevSession(id);
      adopt(`dev:${id}`, false);
      return;
    }

    setBusy(true);
    void beginLogin(runtime).catch((err: unknown) => {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'The sign-in failed');
    });
  }, [adopt]);

  /**
   * Register, via the Hosted UI's own sign-up page.
   *
   * Not a separate flow: it is the same authorization request through the same
   * callback, so a newly-created account is signed in when it returns. There is
   * deliberately no bypass branch — `authDisabled` means there are no accounts to
   * create, and the landing page hides this entirely in that case.
   */
  const signUp = useCallback(() => {
    const runtime = configRef.current;
    if (!runtime || runtime.authDisabled) return;

    setBusy(true);
    void beginLogin(runtime, 'signup').catch((err: unknown) => {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'The sign-up failed');
    });
  }, []);

  const signInAsDemo = useCallback((persona?: string) => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const result = await demoLogin(persona);
        // Before anything can fetch: `adopt` below flips the app to signed-in,
        // and the first `GET /api/sessions` must already carry this or it reads
        // the pooled account and shows a stranger's conversations.
        if (result.visitorId) setVisitorId(result.visitorId);
        // The login already created and seeded a conversation. Naming it here is
        // what stops `SessionProvider` from creating a second one when the
        // eventually-consistent session list has not caught up with it yet.
        if (result.sessionId) rememberSignInSession(result.sessionId);
        // The server's answer wins over what was asked for: it falls back to
        // the default persona on an id it does not know, and the chip must not
        // claim otherwise.
        const seeded = result.persona ?? persona;
        const named = configRef.current?.demoPersonas?.find(
          (candidate) => candidate.id === seeded,
        );
        /*
         * The persona's *user*, not its partner.
         *
         * `named.name` is "Samantha" — the person the profile is about — and
         * putting it here is what made the menu say "Signed in as Samantha"
         * about her husband. Undefined when the server predates `userName`, so
         * `adopt` falls back to "Demo profile"; a wrong name is worse than a
         * generic one.
         */
        const signedInAs = named?.userName;
        setTokenSession({
          accessToken: result.accessToken,
          // Deliberately dropped: it belongs to the server-only demo client, so
          // refreshing it with the SPA's client id would fail. Which is why the
          // access token itself is what gets persisted — see token-store.ts.
          refreshToken: null,
          expiresAt: Date.now() + result.expiresIn * 1000,
          demo: true,
          demoLabel: signedInAs,
        });
        adopt(result.accessToken, true, signedInAs);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The demo is unavailable');
        setStatus('signed-out');
      } finally {
        setBusy(false);
      }
    })();
  }, [adopt]);

  const signOut = useCallback(() => {
    const runtime = configRef.current;
    const refresh = storedRefreshToken();
    const hadHostedSession = Boolean(refresh) && !isDemo;

    clearTokenSession();
    setIsDemo(false);
    setUserLabel('');
    setError(null);
    setStatus('signed-out');

    if (runtime && refresh) void revokeRefreshToken(runtime, refresh);

    // Clear the Hosted UI's own cookie too, or the next "Sign in" click would
    // sail straight back through without asking — which is not what someone
    // who just signed out expects.
    const logout = runtime && hadHostedSession ? hostedLogoutUrl(runtime) : null;
    if (logout) window.location.assign(logout);
  }, [isDemo]);

  const value: AuthContextValue = {
    status,
    error,
    busy,
    authDisabled: config?.authDisabled ?? false,
    demoAvailable: config?.demoAvailable ?? false,
    demoPersonas: config?.demoPersonas ?? [],
    hostedAvailable: config ? canHostedLogin(config) : false,
    isDemo,
    userLabel: userLabel || (peekAccessToken() ? 'Signed in' : ''),
    signIn,
    signUp,
    signInAsDemo,
    signOut,
  };

  return (
    <AuthContext.Provider value={value}>
      {status === 'signed-in' ? children : <LoginScreen />}
    </AuthContext.Provider>
  );
}

/** Consumer hook — throws if used outside AuthProvider */
export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return ctx;
}

/**
 * The same value, or null outside a provider.
 *
 * For header chrome: the component tests render AppLayout on its own, and a
 * missing sign-out button is the honest rendering of "there is no session to
 * sign out of" rather than a crash.
 */
export function useOptionalAuthContext(): AuthContextValue | null {
  return useContext(AuthContext);
}
