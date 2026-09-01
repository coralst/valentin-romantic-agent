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
  it('offers Amadeus credentials on the Travel card, which needs them', async () => {
    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'travel');

    expect(screen.getByTestId('integration-credentials-amadeus')).toBeInTheDocument();
    expect(screen.getByTestId('integration-field-amadeus-clientId')).toBeInTheDocument();
  });

  it('offers nothing on a capability that is only a drawing', async () => {
    const user = userEvent.setup();
    await renderPanel();
    // Music has no backing service. A credential form here would imply that
    // connecting achieves something in the world, and it does not.
    //
    // Was `flowers`, which is Wolt and genuinely live — asserting it here made the
    // test agree with the bug it should have caught.
    await openSheet(user, 'music');

    expect(screen.queryByTestId('integration-credentials-amadeus')).not.toBeInTheDocument();
    expect(screen.queryByTestId('integration-credentials-google')).not.toBeInTheDocument();
    expect(screen.getByText(/not built yet, so connecting/i)).toBeInTheDocument();
  });

  it('offers nothing on a capability whose provider needs no credential', async () => {
    const user = userEvent.setup();
    await renderPanel();
    // Occasions is Hebcal: arithmetic in-process, live on every deployment.
    await openSheet(user, 'occasions');
    expect(screen.queryByTestId(/integration-credentials-/)).not.toBeInTheDocument();
  });

  it('offers one Google form for Messages, not one per Google service', async () => {
    const user = userEvent.setup();
    await renderPanel();
    // Messages is Gmail + WhatsApp. Gmail maps to the `google` flow, WhatsApp to
    // its own, so two forms — but Calendar and Gmail must never produce two
    // identical Google sign-ins, since one refresh token covers both.
    await openSheet(user, 'messages');

    expect(screen.getAllByTestId('integration-credentials-google')).toHaveLength(1);
    expect(screen.getByTestId('integration-credentials-whatsapp')).toBeInTheDocument();
  });

  it('hides the inputs for a provider that is already configured', async () => {
    serverReports({ hebcal: true, ontopo: true, amadeus: true });
    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'travel');

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
    await openSheet(user, 'travel');

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
    await openSheet(user, 'travel');

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
    await openSheet(user, 'travel');

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
    expect(screen.getByTestId('integration-readiness-travel')).toHaveTextContent('live');
  });

  it('shows the server\'s own reason when a credential is refused', async () => {
    api.post.mockRejectedValue(
      new Error('Amadeus rejected these credentials. Nothing was changed.'),
    );
    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'travel');

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
    expect(screen.getByTestId('integration-readiness-travel')).toHaveTextContent(
      'needs credentials',
    );
  });

  it('keeps one provider\'s failure out of another provider\'s form', async () => {
    api.post.mockRejectedValue(new Error('WhatsApp rejected these credentials.'));
    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'messages');

    await user.type(screen.getByTestId('integration-field-whatsapp-phoneNumberId'), '1');
    await user.type(screen.getByTestId('integration-field-whatsapp-token'), '2');
    await user.click(screen.getByTestId('integration-connect-submit-whatsapp'));
    await act(async () => {});

    // The connect hook is shared across the whole panel, so an unscoped status
    // would print this under the Google form sitting right above it.
    expect(screen.getByTestId('integration-error-whatsapp')).toBeInTheDocument();
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
    await openSheet(user, 'calendar');

    await user.type(screen.getByTestId('integration-field-google-clientId'), 'id');
    await user.type(screen.getByTestId('integration-field-google-clientSecret'), 'secret');
    await user.click(screen.getByTestId('integration-connect-submit-google'));
    await act(async () => {});

    // Saving the client id is not connecting. Reporting success here would leave
    // Calendar reading "live" with no refresh token behind it, and the first
    // thing Valentin tried to do would fail.
    expect(screen.getByTestId('integration-error-google')).toHaveTextContent(/blocked/i);
    expect(screen.queryByTestId('integration-done-google')).not.toBeInTheDocument();
    expect(screen.getByTestId('integration-readiness-calendar')).toHaveTextContent(
      'needs credentials',
    );
  });

  it('says it is waiting while the consent window is open', async () => {
    api.post.mockResolvedValue({ message: 'OAuth client saved.' });
    vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window);

    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'calendar');

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
    await openSheet(user, 'calendar');

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
    expect(screen.getByTestId('integration-readiness-calendar')).toHaveTextContent('live');
  });

  it('ignores a success message from any other origin', async () => {
    api.post.mockResolvedValue({ message: 'OAuth client saved.' });
    vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window);

    const user = userEvent.setup();
    await renderPanel();
    await openSheet(user, 'calendar');

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
