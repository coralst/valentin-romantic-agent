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

function serverReports(configured: Partial<Record<string, boolean>>) {
  api.get.mockImplementation(async (path: string) => {
    if (path === '/api/integrations') {
      return {
        integrations: INTEGRATION_IDS.map((id) => ({
          id,
          label: INTEGRATION_LABELS[id],
          configured: configured[id] ?? false,
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
  /*
   * WhatsApp is this file's worked example, and it used to be Amadeus.
   *
   * Not a cosmetic swap: the Amadeus row was removed from the catalogue, so there is
   * no card left to open. Its server tier and its `CONNECT_RECIPES` entry are both
   * still in the tree — what it lost was the right to a row, because it was the only
   * one offering a $400 spend cap against a test sandbox where the hold it capped
   * cannot be placed.
   *
   * WhatsApp is the same shape for these purposes — one public identifier, one
   * secret — with the incidental benefit that its field names are `phoneNumberId`
   * and `token` rather than another `clientId`/`clientSecret` pair, so a form that
   * posts the wrong keys now fails a test instead of blending in.
   */
  it('offers WhatsApp credentials on the WhatsApp card, which needs them', async () => {
    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'whatsapp');

    expect(screen.getByTestId('integration-credentials-whatsapp')).toBeInTheDocument();
    expect(screen.getByTestId('integration-field-whatsapp-phoneNumberId')).toBeInTheDocument();
  });

  /*
   * This slot used to hold "offers nothing on a capability that is only a drawing",
   * pointed at `flowers`, then `music`, then `rides`, then `spotify` — each row in
   * turn stopped being a drawing and the assertion moved rather than being reasoned
   * about. There is no row left to point it at: every catalogue row is backed and
   * every backed row that needs a credential offers a form.
   *
   * So the test asserts the case that replaced it. Spotify was the last drawing and is
   * now the one row whose sheet offers a form *and* a consent step, because an id and
   * secret buy catalogue search while saving a playlist needs an account on top.
   */
  it('offers Spotify credentials on the Spotify card, which is no longer a drawing', async () => {
    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'spotify');

    expect(screen.getByTestId('integration-credentials-spotify')).toBeInTheDocument();
    expect(screen.getByTestId('integration-field-spotify-clientId')).toBeInTheDocument();
    // And the row must not still be calling itself unbuilt next to a form asking for
    // a real credential — that pairing is what this file exists to prevent.
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
    serverReports({ hebcal: true, ontopo: true, whatsapp: true });
    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'whatsapp');

    // No empty inputs to overwrite a working key with a typo. The server probes
    // before applying, so the typo would be rejected and the old value would
    // survive — leaving an error on screen for a service that is actually fine.
    expect(screen.queryByTestId('integration-field-whatsapp-phoneNumberId')).not.toBeInTheDocument();
    expect(screen.getByTestId('integration-held-whatsapp')).toBeInTheDocument();
    expect(screen.getByTestId('integration-forget-whatsapp')).toBeInTheDocument();
  });
});

describe('the fields themselves', () => {
  it('masks the secret and not the public identifier', async () => {
    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'whatsapp');

    // This panel gets projected. A secret rendered as plain text is disclosed
    // whether or not anyone meant it to be.
    expect(screen.getByTestId('integration-field-whatsapp-token')).toHaveAttribute(
      'type',
      'password',
    );
    expect(screen.getByTestId('integration-field-whatsapp-phoneNumberId')).toHaveAttribute(
      'type',
      'text',
    );
  });

  it('will not submit until every field has something in it', async () => {
    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'whatsapp');

    const submit = screen.getByTestId('integration-connect-submit-whatsapp');
    expect(submit).toBeDisabled();

    await user.type(screen.getByTestId('integration-field-whatsapp-phoneNumberId'), 'key');
    expect(submit).toBeDisabled();

    await user.type(screen.getByTestId('integration-field-whatsapp-token'), 'secret');
    expect(submit).toBeEnabled();
  });
});

describe('submitting', () => {
  it('posts the fields and refetches readiness, so the badge flips', async () => {
    api.post.mockResolvedValue({ message: 'WhatsApp connected.' });
    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'whatsapp');

    await user.type(screen.getByTestId('integration-field-whatsapp-phoneNumberId'), 'key-1');
    await user.type(screen.getByTestId('integration-field-whatsapp-token'), 'secret-1');

    // Readiness now reports WhatsApp as configured, as the server would after a
    // successful probe.
    serverReports({ hebcal: true, ontopo: true, whatsapp: true });
    await user.click(screen.getByTestId('integration-connect-submit-whatsapp'));
    await act(async () => {});

    // The field *names* are the contract, not just their values: these are the keys
    // the server reads off the body, and a form that posted `clientId` here would be
    // rejected by a provider that has never heard of it.
    expect(api.post).toHaveBeenCalledWith('/api/integrations/whatsapp/connect', {
      phoneNumberId: 'key-1',
      token: 'secret-1',
    });
    expect(screen.getByTestId('integration-done-whatsapp')).toBeInTheDocument();
    // The badge is the visible payoff: the panel re-read the server rather than
    // trusting its own request.
    expect(screen.getByTestId('integration-readiness-whatsapp')).toHaveTextContent('live');
  });

  it('shows the server\'s own reason when a credential is refused', async () => {
    api.post.mockRejectedValue(
      new Error('WhatsApp rejected these credentials. Nothing was changed.'),
    );
    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'whatsapp');

    await user.type(screen.getByTestId('integration-field-whatsapp-phoneNumberId'), 'typo');
    await user.type(screen.getByTestId('integration-field-whatsapp-token'), 'typo');
    await user.click(screen.getByTestId('integration-connect-submit-whatsapp'));
    await act(async () => {});

    // Not "the server responded with 400". Only the server knows whether the key
    // was wrong or the provider was unreachable, and the visitor acts differently
    // on each.
    expect(screen.getByTestId('integration-error-whatsapp')).toHaveTextContent(
      /rejected these credentials/i,
    );
    expect(screen.getByTestId('integration-readiness-whatsapp')).toHaveTextContent(
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
