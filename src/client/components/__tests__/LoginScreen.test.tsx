import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginScreen } from '../LoginScreen';
import type { AuthContextValue } from '../../context/auth-context';

/**
 * The landing page, exercised against a stubbed auth context.
 *
 * `auth-context.test.tsx` drives the real provider through this same screen, so
 * these do not re-test the login mechanics. What they cover is the part only this
 * component owns: which of the four ways in are offered on a given deployment,
 * and whether the chosen persona actually reaches `signInAsDemo`.
 */

const signIn = vi.fn();
const signUp = vi.fn();
const signInAsDemo = vi.fn();
const signOut = vi.fn();

let auth: AuthContextValue;

vi.mock('../../context/auth-context', () => ({
  useAuthContext: () => auth,
}));

const PERSONAS = [
  { id: 'samantha', name: 'Samantha', blurb: 'Three years together.', fieldCount: 18 },
  { id: 'fresh', name: 'Start fresh', blurb: 'From scratch.', fieldCount: 0 },
];

function stubAuth(overrides: Partial<AuthContextValue> = {}): void {
  auth = {
    status: 'signed-out',
    error: null,
    busy: false,
    authDisabled: false,
    demoAvailable: true,
    demoPersonas: PERSONAS,
    hostedAvailable: true,
    isDemo: false,
    userLabel: '',
    signIn,
    signUp,
    signInAsDemo,
    signOut,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stubAuth();
});

describe('the masthead', () => {
  it('leads with the crest and the wordmark', () => {
    render(<LoginScreen />);

    expect(screen.getByRole('heading', { name: 'Valentin' })).toBeInTheDocument();
    expect(screen.getByText('Romantic Agent')).toBeInTheDocument();
  });

  /**
   * The crest is decoration beside a heading that already says "Valentin"; alt
   * text would make a screen reader announce the name twice.
   */
  it('carries the crest as decoration, not as content', () => {
    render(<LoginScreen />);

    const crest = document.querySelector('img[src="/logo.png"]');
    expect(crest).not.toBeNull();
    expect(crest?.getAttribute('alt')).toBe('');
  });
});

describe('the prefilled login form', () => {
  it('arrives filled in, so Login is one click', () => {
    render(<LoginScreen />);

    expect(screen.getByTestId('login-email')).toHaveValue('Ralf1988@gmail.com');
    // Non-empty and masked. The exact string is deliberately not asserted: it is
    // filler, and pinning it here would read as pinning a credential.
    expect(screen.getByTestId('login-password')).toHaveAttribute('type', 'password');
    expect((screen.getByTestId('login-password') as HTMLInputElement).value).not.toBe('');
  });

  /**
   * The presenter should be able to type a different address. A field that looks
   * like an input and refuses to accept text is worse than no field.
   */
  it('lets the fields be edited', async () => {
    render(<LoginScreen />);

    const email = screen.getByTestId('login-email');
    await userEvent.clear(email);
    await userEvent.type(email, 'someone@else.com');

    expect(email).toHaveValue('someone@else.com');
  });

  /** The one thing here that can silently open the wrong profile. */
  it('opens the filled profile', async () => {
    render(<LoginScreen />);

    await userEvent.click(screen.getByTestId('demo-login-button'));

    expect(signInAsDemo).toHaveBeenCalledWith('samantha');
    expect(signIn).not.toHaveBeenCalled();
  });
});

describe('Create an Account', () => {
  /**
   * Hosted sign-up would bounce the visitor into an email-verification round
   * trip, which is not a demo. The empty persona is the honest version of a new
   * account: Valentin knows nothing and opens by asking.
   */
  it('opens a separate, empty profile rather than hosted sign-up', async () => {
    render(<LoginScreen />);

    await userEvent.click(screen.getByTestId('sign-up-button'));

    expect(signInAsDemo).toHaveBeenCalledWith('fresh');
    expect(signUp).not.toHaveBeenCalled();
  });

  it('falls back to real hosted sign-up where there is no demo endpoint', async () => {
    stubAuth({ demoAvailable: false });
    render(<LoginScreen />);

    await userEvent.click(screen.getByTestId('sign-up-button'));

    expect(signUp).toHaveBeenCalled();
    expect(signInAsDemo).not.toHaveBeenCalled();
  });
});

describe('which ways in are offered', () => {
  /**
   * Exactly two, always. The previous version varied between a persona picker, a
   * plain demo button, a sign-in link and a register link depending on four
   * config flags, so what the visitor met depended on the deployment.
   */
  it('offers exactly two doors', () => {
    render(<LoginScreen />);

    expect(screen.getByTestId('demo-login-button').textContent).toBe('Login');
    expect(screen.getByTestId('sign-up-button').textContent).toBe('Create an Account');
    expect(screen.queryByTestId('persona-picker')).toBeNull();
    expect(screen.queryByTestId('sign-in-button')).toBeNull();
  });

  /**
   * A local run has no Cognito at all, so Login restores the development user
   * instead. Same button in the same place, so the rehearsal driver and the
   * presenter both find one Login control either way.
   */
  it('routes Login through the dev bypass when auth is disabled', async () => {
    stubAuth({ authDisabled: true, demoAvailable: false, hostedAvailable: false });
    render(<LoginScreen />);

    await userEvent.click(screen.getByTestId('demo-login-button'));

    expect(signIn).toHaveBeenCalled();
    expect(signInAsDemo).not.toHaveBeenCalled();
  });

  it('says so plainly when nothing is configured', () => {
    stubAuth({ demoAvailable: false, hostedAvailable: false, authDisabled: false });
    render(<LoginScreen />);

    expect(screen.getByRole('alert').textContent).toContain(
      'No sign-in method is configured',
    );
    expect(screen.queryByTestId('demo-login-button')).toBeNull();
  });
});

describe('while a sign-in is in flight', () => {
  it('disables every way in, so a second click cannot race the first', () => {
    stubAuth({ busy: true });
    render(<LoginScreen />);

    expect(screen.getByTestId('demo-login-button')).toBeDisabled();
    expect(screen.getByTestId('sign-up-button')).toBeDisabled();
    expect(screen.getByTestId('login-email')).toBeDisabled();
    expect(screen.getByTestId('login-password')).toBeDisabled();
  });
});

describe('the four auth statuses', () => {
  it('waits quietly while the config is being read', () => {
    stubAuth({ status: 'loading' });
    render(<LoginScreen />);

    expect(screen.getByTestId('auth-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('login-screen')).toBeNull();
  });

  /**
   * No retry button on the error branch: the server is unreachable, so nothing
   * here could succeed, and offering a button only invites a second failure.
   */
  it('shows the masthead and the reason when the config could not be read', () => {
    stubAuth({ status: 'error', error: 'The server is not answering' });
    render(<LoginScreen />);

    expect(screen.getByTestId('auth-error')).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toBe('The server is not answering');
    expect(screen.getByRole('heading', { name: 'Valentin' })).toBeInTheDocument();
    expect(screen.queryByTestId('demo-login-button')).toBeNull();
  });

  it('reports a failed login without leaving the page', () => {
    stubAuth({ error: 'The demo is unavailable' });
    render(<LoginScreen />);

    expect(screen.getByTestId('login-error').textContent).toBe(
      'The demo is unavailable',
    );
    expect(screen.getByTestId('login-screen')).toBeInTheDocument();
  });
});
