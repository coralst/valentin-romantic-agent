import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocationConsent } from '../LocationConsent';
import type { PreferenceWithHistory } from '../../../shared/interfaces/preference';

/**
 * Asking someone where they live.
 *
 * The negative tests carry the weight here. A refusal must not read as a failure,
 * must not block the typed path, and — the one that would be a real defect — a
 * coordinate the browser hands us must never be turned into a preference locally.
 * Only the server writes, and it writes a city.
 */

const api = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('../../utils/api-client', () => ({
  apiPostJsonExplained: (path: string, body?: unknown) => api.post(path, body),
}));

const savedRow: PreferenceWithHistory = {
  id: 'pref-1',
  sessionId: 'sess-1',
  category: 'travel',
  key: 'home city',
  fieldId: 'home_city',
  value: "Ra'anana",
  confidence: 1,
  sourceMessageId: 'location-consent',
  createdAt: '2026-09-03T09:00:00.000Z',
  updatedAt: '2026-09-03T09:00:00.000Z',
  history: [],
};

/** Replaces `navigator.geolocation` for one test. */
function geolocationThat(
  behaviour: (
    ok: PositionCallback,
    fail: PositionErrorCallback,
  ) => void,
): void {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: behaviour },
  });
}

function grants(lat: number, lon: number) {
  geolocationThat((ok) => {
    ok({ coords: { latitude: lat, longitude: lon } } as GeolocationPosition);
  });
}

function refuses() {
  geolocationThat((_ok, fail) => {
    fail({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3 } as GeolocationPositionError);
  });
}

beforeEach(() => {
  api.post.mockReset();
  api.post.mockResolvedValue({ preference: savedRow, city: "Ra'anana" });
});

describe('LocationConsent', () => {
  it('does not ask for a position until the button is pressed', () => {
    const getCurrentPosition = vi.fn();
    geolocationThat(getCurrentPosition as never);

    render(<LocationConsent sessionId="sess-1" />);

    // A prompt on mount is denied reflexively, and the denial sticks for the
    // origin — so mounting must be silent.
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('posts the coordinate once and reports the city the server chose', async () => {
    grants(32.1848, 34.8713);
    const onSaved = vi.fn();
    render(<LocationConsent sessionId="sess-1" onSaved={onSaved} />);

    await userEvent.click(screen.getByTestId('location-use-mine'));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(savedRow));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/api/session/sess-1/location', {
      lat: 32.1848,
      lon: 34.8713,
    });
    expect(screen.getByTestId('location-saved')).toHaveTextContent("Ra'anana");
  });

  it('sends the coordinate and nothing else — the city comes back from the server', async () => {
    grants(32.1848, 34.8713);
    render(<LocationConsent sessionId="sess-1" />);

    await userEvent.click(screen.getByTestId('location-use-mine'));
    await waitFor(() => expect(api.post).toHaveBeenCalled());

    // Guards against a future "helpful" local lookup: this component must not
    // invent a city, a preference row, or a second call.
    expect(api.post.mock.calls).toHaveLength(1);
    expect(Object.keys(api.post.mock.calls[0][1] as object).sort()).toEqual(['lat', 'lon']);
  });

  it('treats a refusal as an answer, not an error, and leaves the typed path open', async () => {
    refuses();
    render(<LocationConsent sessionId="sess-1" />);

    await userEvent.click(screen.getByTestId('location-use-mine'));

    await waitFor(() =>
      expect(screen.getByTestId('location-geo-message')).toHaveTextContent(
        'type your city instead',
      ),
    );
    expect(screen.queryByTestId('location-error')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();

    await userEvent.type(screen.getByTestId('location-city-input'), "Ra'anana");
    await userEvent.click(screen.getByTestId('location-save-city'));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/session/sess-1/location', {
        address: "Ra'anana",
      }),
    );
  });

  it('submits a typed city on Enter', async () => {
    render(<LocationConsent sessionId="sess-1" />);

    await userEvent.type(screen.getByTestId('location-city-input'), 'Haifa{Enter}');

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/session/sess-1/location', {
        address: 'Haifa',
      }),
    );
  });

  it('will not submit an empty or one-letter city', async () => {
    render(<LocationConsent sessionId="sess-1" />);

    expect(screen.getByTestId('location-save-city')).toBeDisabled();
    await userEvent.type(screen.getByTestId('location-city-input'), 'H');
    expect(screen.getByTestId('location-save-city')).toBeDisabled();
    await userEvent.type(screen.getByTestId('location-city-input'), 'aifa');
    expect(screen.getByTestId('location-save-city')).toBeEnabled();
  });

  it("shows the server's own explanation rather than a flattened status", async () => {
    api.post.mockRejectedValue(
      new Error('Location lookup is not configured — type a city instead'),
    );
    render(<LocationConsent sessionId="sess-1" />);

    await userEvent.type(screen.getByTestId('location-city-input'), 'Haifa{Enter}');

    await waitFor(() =>
      expect(screen.getByTestId('location-error')).toHaveTextContent(
        'Location lookup is not configured',
      ),
    );
  });

  it('names the city already on file instead of asking again', () => {
    render(<LocationConsent sessionId="sess-1" currentCity="Tel Aviv" />);

    expect(screen.getByTestId('location-consent')).toHaveTextContent('Searching near Tel Aviv');
  });

  it('says the coordinate is not kept, because it is not', () => {
    render(<LocationConsent sessionId="sess-1" />);

    expect(screen.getByTestId('location-consent')).toHaveTextContent(
      'I keep the city and nothing finer',
    );
  });
});
