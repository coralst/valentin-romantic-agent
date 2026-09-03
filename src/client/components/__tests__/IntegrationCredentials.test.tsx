import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IntegrationsProvider } from '../../context/integrations-context';
import { IntegrationsPanel } from '../IntegrationsPanel';
import {
  INTEGRATION_IDS,
  INTEGRATION_LABELS,
} from '../../../shared/interfaces/integrations';

/**
 * Handing credentials to the server from inside the panel.
 *
 * Kept apart from `IntegrationsPanel.test.tsx`, which is about the grant model
 * and the drawing. This file is about the other half of the panel's job: a
 * capability that cannot work says why, offers the fix, and flips to live when
 * the fix lands.
 *
 * The tests that matter most here are the negative ones. A form that takes a
 * secret must not render it, must not offer itself for a capability that has no
 * provider behind it, and must not report success on a Google flow whose consent
 * step never happened — that last one would leave Calendar reading "live" with no
 * refresh token behind it.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('../../utils/api-client', () => ({
  apiGetJson: (path: string) => api.get(path),
  apiPostJsonExplained: (path: string, body?: unknown) => api.post(path, body),
}));

/**
 * @param clientPresent Which ids the server already holds an OAuth client for.
 *   Only the Google ids can, and in the real endpoint the two always agree, so
 *   tests pass both together.
 */
function serverReports(
  configured: Partial<Record<string, boolean>>,
  clientPresent: Partial<Record<string, boolean>> = {},
) {
  api.get.mockImplementation(async (path: string) => {
    if (path === '/api/integrations') {
      return {
        integrations: INTEGRATION_IDS.map((id) => ({
          id,
          label: INTEGRATION_LABELS[id],
          configured: configured[id] ?? false,
          ...(id === 'google-calendar' || id === 'gmail'
            ? { oauthClientPresent: clientPresent[id] ?? false }
            : {}),
        })),
      };
    }
    if (path === '/api/integrations/google/auth-url') {
      return { url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x' };
    }
    throw new Error(`unexpected GET ${path}`);
  });
}

async function renderPanel() {
  const result = render(
    <IntegrationsProvider>
      <IntegrationsPanel isMobile={false} onClose={() => {}} />
    </IntegrationsProvider>,
  );
  await act(async () => {});
  return result;
}

/** Open a capability's consent sheet. */
async function openSheet(user: ReturnType<typeof userEvent.setup>, capability: string) {
  await user.click(screen.getByTestId(`integration-node-${capability}`));
}

beforeEach(() => {
  localStorage.clear();
  api.get.mockReset();
  api.post.mockReset();
  serverReports({ hebcal: true, ontopo: true });
});

describe('offering the form', () => {
  it('offers Amadeus credentials on the Amadeus card, which needs them', async () => {
    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'amadeus');

    expect(screen.getByTestId('integration-credentials-amadeus')).toBeInTheDocument();
    expect(screen.getByTestId('integration-field-amadeus-clientId')).toBeInTheDocument();
  });

  /*
   * This test used to assert the opposite, on whichever row was still a drawing —
   * `flowers`, then `music`, then `rides`. There is no such row left: Wolt, Spotify
   * and the rest all reach a real service, and the rides row was deleted rather
   * than left as a promise with nothing behind it.
   *
   * So the assertion flips to the case that now exists. Spotify takes an id and a
   * secret like Amadeus does, and getting its form wrong is the live risk — an
   * empty sheet on a row the panel badges live is the contradiction a visitor
   * would actually hit.
   */
  it('offers Spotify credentials on the Spotify card, now that the row reaches a real service', async () => {
    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'spotify');

    expect(screen.getByTestId('integration-credentials-spotify')).toBeInTheDocument();
    expect(screen.getByTestId('integration-field-spotify-clientId')).toBeInTheDocument();
    expect(screen.getByTestId('integration-field-spotify-clientSecret')).toBeInTheDocument();

    // The copy that belonged to a drawing must not survive on a row that works.
    expect(screen.queryByText(/not built yet, so connecting/i)).not.toBeInTheDocument();
  });

  it('offers nothing on a capability whose provider needs no credential', async () => {
    const user = userEvent.setup();
    await renderPanel();
    // The Hebrew calendar row is Hebcal: arithmetic in-process, live on every
    // deployment.
    await openSheet(user, 'hebcal');
    expect(screen.queryByTestId(/integration-credentials-/)).not.toBeInTheDocument();
  });

  it('offers exactly one form per row, and it is the row\'s own provider', async () => {
    const user = userEvent.setup();
    await renderPanel();
    /*
     * This used to open the combined Messages row and assert that Gmail + WhatsApp
     * produced two forms with only *one* Google sign-in, because Calendar and Gmail
     * share a refresh token and rendering the same form twice would be nonsense.
     *
     * Splitting Messages into a Gmail row and a WhatsApp row is what removed that
     * case: no row backs two services now, so `missingConnectFlows`'s dedup can no
     * longer be reached from the catalogue. The property still worth pinning is the
     * one a visitor sees — a row asks for the credential it needs and for nothing
     * else. WhatsApp's form has no business appearing under Gmail.
     */
    await openSheet(user, 'gmail');

    expect(screen.getAllByTestId('integration-credentials-google')).toHaveLength(1);
    expect(screen.queryByTestId('integration-credentials-whatsapp')).not.toBeInTheDocument();
  });

  it('hides the inputs for a provider that is already configured', async () => {
    serverReports({ hebcal: true, ontopo: true, amadeus: true });
    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'amadeus');

    // No empty inputs to overwrite a working key with a typo. The server probes
    // before applying, so the typo would be rejected and the old value would
    // survive — leaving an error on screen for a service that is actually fine.
    expect(screen.queryByTestId('integration-field-amadeus-clientId')).not.toBeInTheDocument();
    expect(screen.getByTestId('integration-held-amadeus')).toBeInTheDocument();
    expect(screen.getByTestId('integration-forget-amadeus')).toBeInTheDocument();
  });
});

describe('the fields themselves', () => {
  it('masks the secret and not the public identifier', async () => {
    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'amadeus');

    // This panel gets projected. A secret rendered as plain text is disclosed
    // whether or not anyone meant it to be.
    expect(screen.getByTestId('integration-field-amadeus-clientSecret')).toHaveAttribute(
      'type',
      'password',
    );
    expect(screen.getByTestId('integration-field-amadeus-clientId')).toHaveAttribute(
      'type',
      'text',
    );
  });

  it('will not submit until every field has something in it', async () => {
    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'amadeus');

    const submit = screen.getByTestId('integration-connect-submit-amadeus');
    expect(submit).toBeDisabled();

    await user.type(screen.getByTestId('integration-field-amadeus-clientId'), 'key');
    expect(submit).toBeDisabled();

    await user.type(screen.getByTestId('integration-field-amadeus-clientSecret'), 'secret');
    expect(submit).toBeEnabled();
  });
});

describe('submitting', () => {
  it('posts the fields and refetches readiness, so the badge flips', async () => {
    api.post.mockResolvedValue({ message: 'Amadeus connected.' });
    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'amadeus');

    await user.type(screen.getByTestId('integration-field-amadeus-clientId'), 'key-1');
    await user.type(screen.getByTestId('integration-field-amadeus-clientSecret'), 'secret-1');

    // Readiness now reports Amadeus as configured, as the server would after a
    // successful probe.
    serverReports({ hebcal: true, ontopo: true, amadeus: true });
    await user.click(screen.getByTestId('integration-connect-submit-amadeus'));
    await act(async () => {});

    expect(api.post).toHaveBeenCalledWith('/api/integrations/amadeus/connect', {
      clientId: 'key-1',
      clientSecret: 'secret-1',
    });
    expect(screen.getByTestId('integration-done-amadeus')).toBeInTheDocument();
    // The badge is the visible payoff: the panel re-read the server rather than
    // trusting its own request.
    expect(screen.getByTestId('integration-readiness-amadeus')).toHaveTextContent('live');
  });

  it('shows the server\'s own reason when a credential is refused', async () => {
    api.post.mockRejectedValue(
      new Error('Amadeus rejected these credentials. Nothing was changed.'),
    );
    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'amadeus');

    await user.type(screen.getByTestId('integration-field-amadeus-clientId'), 'typo');
    await user.type(screen.getByTestId('integration-field-amadeus-clientSecret'), 'typo');
    await user.click(screen.getByTestId('integration-connect-submit-amadeus'));
    await act(async () => {});

    // Not "the server responded with 400". Only the server knows whether the key
    // was wrong or the provider was unreachable, and the visitor acts differently
    // on each.
    expect(screen.getByTestId('integration-error-amadeus')).toHaveTextContent(
      /rejected these credentials/i,
    );
    expect(screen.getByTestId('integration-readiness-amadeus')).toHaveTextContent(
      'needs credentials',
    );
  });

  it('keeps one provider\'s failure out of another provider\'s form', async () => {
    api.post.mockRejectedValue(new Error('WhatsApp rejected these credentials.'));
    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'whatsapp');

    await user.type(screen.getByTestId('integration-field-whatsapp-phoneNumberId'), '1');
    await user.type(screen.getByTestId('integration-field-whatsapp-token'), '2');
    await user.click(screen.getByTestId('integration-connect-submit-whatsapp'));
    await act(async () => {});

    expect(screen.getByTestId('integration-error-whatsapp')).toBeInTheDocument();

    /*
     * The connect hook lives on the panel, not on the sheet, so a status left
     * unscoped survives the sheet that produced it. It used to be enough to check
     * the Google form sitting directly below WhatsApp's in the combined Messages
     * row; with one provider per row the same leak now shows up a sheet later, so
     * that is where it is checked — close this row, open Gmail's, and WhatsApp's
     * failure must not be waiting there.
     */
    await user.keyboard('{Escape}');
    await openSheet(user, 'gmail');
    await act(async () => {});

    expect(screen.queryByTestId('integration-error-whatsapp')).not.toBeInTheDocument();
    expect(screen.queryByTestId('integration-error-google')).not.toBeInTheDocument();
  });
});

describe('the Google consent leg', () => {
  it('does not claim success when the popup is blocked', async () => {
    api.post.mockResolvedValue({ message: 'OAuth client saved.' });
    // No popup — what a browser with popups blocked returns.
    vi.spyOn(window, 'open').mockReturnValue(null);

    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'google-calendar');

    await user.type(screen.getByTestId('integration-field-google-clientId'), 'id');
    await user.type(screen.getByTestId('integration-field-google-clientSecret'), 'secret');
    await user.click(screen.getByTestId('integration-connect-submit-google'));
    await act(async () => {});

    // Saving the client id is not connecting. Reporting success here would leave
    // Calendar reading "live" with no refresh token behind it, and the first
    // thing Valentin tried to do would fail.
    expect(screen.getByTestId('integration-error-google')).toHaveTextContent(/blocked/i);
    expect(screen.queryByTestId('integration-done-google')).not.toBeInTheDocument();
    expect(screen.getByTestId('integration-readiness-google-calendar')).toHaveTextContent(
      'needs credentials',
    );
  });

  it('says it is waiting while the consent window is open', async () => {
    api.post.mockResolvedValue({ message: 'OAuth client saved.' });
    vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window);

    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'google-calendar');

    await user.type(screen.getByTestId('integration-field-google-clientId'), 'id');
    await user.type(screen.getByTestId('integration-field-google-clientSecret'), 'secret');
    await user.click(screen.getByTestId('integration-connect-submit-google'));
    await act(async () => {});

    // The visitor is mid-consent. The button has to say that rather than sit
    // looking finished — the request has returned, but the flow has not.
    expect(screen.getByTestId('integration-connect-submit-google')).toHaveTextContent(
      /waiting for google/i,
    );
  });

  it('completes when the callback page reports success from our own origin', async () => {
    api.post.mockResolvedValue({ message: 'OAuth client saved.' });
    vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window);

    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'google-calendar');

    await user.type(screen.getByTestId('integration-field-google-clientId'), 'id');
    await user.type(screen.getByTestId('integration-field-google-clientSecret'), 'secret');
    await user.click(screen.getByTestId('integration-connect-submit-google'));
    await act(async () => {});

    serverReports({ hebcal: true, ontopo: true, 'google-calendar': true, gmail: true });
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: 'valentin-google-oauth', ok: true },
          origin: window.location.origin,
        }),
      );
    });
    await act(async () => {});

    expect(screen.getByTestId('integration-done-google')).toBeInTheDocument();
    expect(screen.getByTestId('integration-readiness-google-calendar')).toHaveTextContent('live');
  });

  it('ignores a success message from any other origin', async () => {
    api.post.mockResolvedValue({ message: 'OAuth client saved.' });
    vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window);

    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'google-calendar');

    await user.type(screen.getByTestId('integration-field-google-clientId'), 'id');
    await user.type(screen.getByTestId('integration-field-google-clientSecret'), 'secret');
    await user.click(screen.getByTestId('integration-connect-submit-google'));
    await act(async () => {});

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: 'valentin-google-oauth', ok: true },
          origin: 'https://evil.example.com',
        }),
      );
    });
    await act(async () => {});

    // The callback page is served by us, so a message from elsewhere is not our
    // popup and must not be able to report a connection that never happened.
    expect(screen.queryByTestId('integration-done-google')).not.toBeInTheDocument();
    expect(screen.getByTestId('integration-connect-submit-google')).toHaveTextContent(
      /waiting for google/i,
    );
  });
});

/**
 * The deployment that already knows which Google app it is.
 *
 * This is the ordinary state of both environments Valentin runs in — `.env` locally
 * and Secrets Manager when deployed both supply `GOOGLE_CLIENT_ID` and
 * `GOOGLE_CLIENT_SECRET`, and neither can supply the refresh token, which only a
 * human at a Google consent screen can produce. Readiness is false in that state,
 * and the panel used to read false as "I have been told nothing" and ask for the two
 * values it was already holding. Retyping them cannot produce the third, so the form
 * was a dead end: the visitor's only real action was the one button that was missing.
 */
describe('when the server already holds the OAuth client', () => {
  const clientLoaded = () =>
    serverReports(
      { hebcal: true, ontopo: true },
      { 'google-calendar': true, gmail: true },
    );

  it('asks for a sign-in instead of the credentials it already has', async () => {
    clientLoaded();
    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'google-calendar');

    expect(screen.getByTestId('integration-client-loaded-google')).toBeInTheDocument();
    expect(screen.queryByTestId('integration-field-google-clientId')).not.toBeInTheDocument();
    expect(screen.queryByTestId('integration-field-google-clientSecret')).not.toBeInTheDocument();
    expect(screen.getByTestId('integration-connect-submit-google')).toHaveTextContent(
      /^sign in with google$/i,
    );
  });

  it('goes straight to consent without re-saving a client it has', async () => {
    clientLoaded();
    vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window);

    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'google-calendar');
    await user.click(screen.getByTestId('integration-connect-submit-google'));
    await act(async () => {});

    // The save is skipped, not sent empty: there is nothing to write, and the
    // route would rightly reject a Google connect carrying no client id.
    expect(api.post).not.toHaveBeenCalled();
    expect(window.open).toHaveBeenCalledOnce();
    expect(screen.getByTestId('integration-connect-submit-google')).toHaveTextContent(
      /waiting for google/i,
    );
  });

  it('flips the capability live once consent lands', async () => {
    clientLoaded();
    vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window);

    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'google-calendar');
    await user.click(screen.getByTestId('integration-connect-submit-google'));
    await act(async () => {});

    serverReports(
      { hebcal: true, ontopo: true, 'google-calendar': true, gmail: true },
      { 'google-calendar': true, gmail: true },
    );
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: 'valentin-google-oauth', ok: true },
          origin: window.location.origin,
        }),
      );
    });
    await act(async () => {});

    expect(screen.getByTestId('integration-readiness-google-calendar')).toHaveTextContent('live');
  });

  it('still lets someone point it at a different Google project', async () => {
    clientLoaded();
    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'google-calendar');

    // The escape hatch matters: a server can be holding the *wrong* client, and
    // hiding the inputs entirely would leave no way to correct it.
    await user.click(screen.getByTestId('integration-replace-client-google'));

    expect(screen.getByTestId('integration-field-google-clientId')).toBeInTheDocument();
    expect(screen.getByTestId('integration-connect-submit-google')).toHaveTextContent(
      /save & sign in/i,
    );
  });

  it('keeps asking for credentials when the server has none', async () => {
    // The other half of the contract. Absent flag ⇒ nothing held ⇒ the form must
    // still collect a client, or a fresh deployment has no way to be configured.
    serverReports({ hebcal: true, ontopo: true });
    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'google-calendar');

    expect(screen.getByTestId('integration-field-google-clientId')).toBeInTheDocument();
    expect(screen.queryByTestId('integration-client-loaded-google')).not.toBeInTheDocument();
  });
});
