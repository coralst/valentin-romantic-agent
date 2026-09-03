import { useState } from 'react';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import { colors, radii, typography } from '../design-system/tokens';
import { useGeolocation } from '../hooks/use-geolocation';
import { apiPostJsonExplained } from '../utils/api-client';

/**
 * "Use my location, or type a city."
 *
 * Two ways to answer the same question, side by side and equally weighted, because
 * they are genuinely equal here. The only thing this feature needs is a *city* —
 * the radius filter compares city centroids — so someone who types "Ra'anana" gives
 * up nothing versus someone who shares a position. Presenting the typed path as the
 * fallback for a refusal, rather than as a first-class choice, would be pressure
 * for no gain.
 *
 * What the server does with a shared coordinate is stated plainly in the copy
 * rather than buried in a privacy note: the city is kept, the coordinate is not.
 * That is true — `POST /session/:id/location` writes one `home_city` preference row
 * and drops the point after seeding an in-memory cache — and a claim like that is
 * only worth making where the code backs it.
 *
 * The permission prompt fires from the button and nowhere else. See
 * `use-geolocation.ts` for why a prompt on mount would be worse than no feature.
 *
 * Rendered from the brief rail's gap nudge — the one place that already knows the
 * home city is the highest-payoff thing Valentin is missing. Deliberately *not*
 * in the dining integration's consent sheet: that sheet is a list of scopes being
 * granted to a provider, and a city input is not a scope. Someone who would rather
 * say it in words can still just tell him, and extraction files it the usual way.
 */

interface LocationConsentProps {
  sessionId: string;
  /** The city already on file, if any. Renders as the current answer. */
  currentCity?: string | null;
  /**
   * Called with the row the server wrote, so the parent can merge it.
   *
   * The parent owns the preference store — this component does not reach into it,
   * which is what lets it render anywhere without dragging a provider along. It
   * hands back the saved row rather than just the city string because the store
   * needs the id and timestamps to merge on, and inventing them here would put a
   * fictional row on her file.
   */
  onSaved?: (preference: PreferenceWithHistory) => void;
}

interface LocationResponse {
  preference: PreferenceWithHistory;
  city: string;
}

const blockStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const promptStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  color: colors.inkMuted,
  lineHeight: typography.lineHeights.normal,
  margin: 0,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  flexWrap: 'wrap',
};

const inputStyle: React.CSSProperties = {
  flex: '1 1 120px',
  minWidth: 0,
  boxSizing: 'border-box',
  height: 34,
  padding: '0 10px',
  borderRadius: radii.chip,
  border: `1px solid ${colors.linenShade}`,
  backgroundColor: colors.porcelain,
  color: colors.ink,
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.small,
};

function buttonStyle(disabled: boolean, primary: boolean): React.CSSProperties {
  return {
    height: 34,
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
  };
}

function noteStyle(kind: 'error' | 'done' | 'quiet'): React.CSSProperties {
  return {
    fontFamily: typography.bodyFontFamily,
    fontSize: typography.px.label,
    lineHeight: typography.lineHeights.normal,
    color: kind === 'error' ? colors.claret : kind === 'done' ? colors.olive : colors.inkFaint,
    margin: 0,
  };
}

export function LocationConsent({ sessionId, currentCity, onSaved }: LocationConsentProps) {
  const geo = useGeolocation();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(body: { lat: number; lon: number } | { address: string }) {
    setBusy(true);
    setError(null);
    try {
      const result = await apiPostJsonExplained<LocationResponse>(
        `/api/session/${sessionId}/location`,
        body,
      );
      setSaved(result.city);
      setTyped('');
      onSaved?.(result.preference);
    } catch (cause) {
      // `Explained`, not `apiPostJson`: the server distinguishes "could not work
      // out which city that is" from "location lookup is not configured — type a
      // city instead", and both are worth showing verbatim. Flattened to "the
      // server could not complete it", the second one would leave the visitor
      // retrying a path that cannot work.
      setError(cause instanceof Error ? cause.message : 'that did not work');
    } finally {
      setBusy(false);
    }
  }

  async function useMyLocation() {
    const point = await geo.request();
    if (point) await submit(point);
  }

  const city = saved ?? currentCity ?? null;
  const canSubmitTyped = typed.trim().length > 1 && !busy;

  return (
    <div style={blockStyle} data-testid="location-consent">
      <p style={promptStyle}>
        {city
          ? `Searching near ${city}. Change it whenever you like.`
          : 'Where should I look? I keep the city and nothing finer — the coordinate is used once and thrown away.'}
      </p>

      <div style={rowStyle}>
        <button
          type="button"
          style={buttonStyle(busy || geo.status === 'prompting', true)}
          disabled={busy || geo.status === 'prompting'}
          onClick={useMyLocation}
          data-testid="location-use-mine"
        >
          {geo.status === 'prompting' ? 'Asking…' : 'Use my location'}
        </button>

        {/* Not a <form>: this renders inside the consent sheet and inside the brief
            rail, and a nested form would be invalid markup in at least one of them.
            Enter is wired by hand so the keyboard still works. */}
        <input
          style={inputStyle}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canSubmitTyped) {
              event.preventDefault();
              void submit({ address: typed.trim() });
            }
          }}
          placeholder="or type a city"
          aria-label="City"
          autoComplete="address-level2"
          data-testid="location-city-input"
        />

        <button
          type="button"
          style={buttonStyle(!canSubmitTyped, false)}
          disabled={!canSubmitTyped}
          onClick={() => void submit({ address: typed.trim() })}
          data-testid="location-save-city"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>

      {error ? (
        <p style={noteStyle('error')} role="status" data-testid="location-error">
          {error}
        </p>
      ) : saved ? (
        <p style={noteStyle('done')} role="status" data-testid="location-saved">
          Saved {saved}.
        </p>
      ) : geo.message ? (
        // A refusal is not an error — it is an answer, and the copy says so.
        <p style={noteStyle('quiet')} role="status" data-testid="location-geo-message">
          {geo.message}
        </p>
      ) : null}
    </div>
  );
}
