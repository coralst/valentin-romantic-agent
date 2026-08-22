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

describe('the persona picker', () => {
  it('offers every persona the deployment advertises', () => {
    render(<LoginScreen />);

    expect(screen.getByTestId('persona-samantha')).toBeInTheDocument();
    expect(screen.getByTestId('persona-fresh')).toBeInTheDocument();
    expect(screen.getByText('18 of 18 known')).toBeInTheDocument();
    expect(screen.getByText("0 of 18 · he'll ask")).toBeInTheDocument();
  });

  it('starts on the first persona, so the button always means something', () => {
    render(<LoginScreen />);

    expect(screen.getByTestId('persona-samantha')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByTestId('demo-login-button').textContent).toContain('Samantha');
  });

  it('names the chosen persona on the button', async () => {
    render(<LoginScreen />);

    await userEvent.click(screen.getByTestId('persona-fresh'));

    expect(screen.getByTestId('persona-fresh')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('persona-samantha')).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByTestId('demo-login-button').textContent).toContain('Start fresh');
  });

  /** The one thing here that can silently do the wrong thing. */
  it('signs in as the persona that was chosen', async () => {
    render(<LoginScreen />);

    await userEvent.click(screen.getByTestId('persona-fresh'));
    await userEvent.click(screen.getByTestId('demo-login-button'));

    expect(signInAsDemo).toHaveBeenCalledWith('fresh');
  });

  it('is a radio group, so the pair reads as one choice', () => {
    render(<LoginScreen />);

    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  /**
   * A deployment that predates personas advertises none. Losing the demo button
   * along with the picker would leave it with no way in at all.
   */
  it('falls back to a plain demo button when none are advertised', async () => {
    stubAuth({ demoPersonas: [] });
    render(<LoginScreen />);

    expect(screen.queryByTestId('persona-picker')).toBeNull();
    await userEvent.click(screen.getByTestId('demo-login-button'));

    expect(signInAsDemo).toHaveBeenCalledWith();
  });
});

describe('which ways in are offered', () => {
  it('hides the demo where the demo account is not deployed', () => {
    stubAuth({ demoAvailable: false });
    render(<LoginScreen />);

    expect(screen.queryByTestId('demo-login-button')).toBeNull();
    expect(screen.queryByTestId('persona-picker')).toBeNull();
    expect(screen.getByTestId('sign-in-button')).toBeInTheDocument();
  });

  it('offers sign-in and register when the Hosted UI is reachable', async () => {
    render(<LoginScreen />);

    await userEvent.click(screen.getByTestId('sign-in-button'));
    await userEvent.click(screen.getByTestId('sign-up-button'));

    expect(signIn).toHaveBeenCalled();
    expect(signUp).toHaveBeenCalled();
  });

  it('hides both when there is no Hosted UI', () => {
    stubAuth({ hostedAvailable: false });
    render(<LoginScreen />);

    expect(screen.queryByTestId('sign-in-button')).toBeNull();
    expect(screen.queryByTestId('sign-up-button')).toBeNull();
  });

  /**
   * The dev bypass has no Hosted UI and no accounts, so "Sign in" is a local
   * fiction and "Create an account" would be a lie.
   */
  it('offers Continue and no register on the dev bypass', () => {
    stubAuth({ authDisabled: true, hostedAvailable: false });
    render(<LoginScreen />);

    expect(screen.getByTestId('sign-in-button').textContent).toBe('Continue');
    expect(screen.queryByTestId('sign-up-button')).toBeNull();
  });

  it('says so plainly when nothing is configured', () => {
    stubAuth({ demoAvailable: false, hostedAvailable: false, authDisabled: false });
    render(<LoginScreen />);

    expect(screen.getByRole('alert').textContent).toContain(
      'No sign-in method is configured',
    );
  });
});

describe('while a sign-in is in flight', () => {
  it('disables every way in, so a second click cannot race the first', () => {
    stubAuth({ busy: true });
    render(<LoginScreen />);

    expect(screen.getByTestId('demo-login-button')).toBeDisabled();
    expect(screen.getByTestId('persona-samantha')).toBeDisabled();
    expect(screen.getByTestId('sign-in-button')).toBeDisabled();
    expect(screen.getByTestId('sign-up-button')).toBeDisabled();
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
