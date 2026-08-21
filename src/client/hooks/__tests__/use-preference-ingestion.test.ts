import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import React from 'react';
import { PreferencesProvider, usePreferencesContext } from '../../context/preferences-context';
import { ProfileStoreProvider, useProfileStoreContext } from '../../context/profile-store-context';
import { DiscoveryProvider, resetDiscoveryMountCount } from '../../context/discovery-context';
import { usePreferenceIngestion, resolvePreferenceField } from '../use-preference-ingestion';
import { PROFILE_FIELD_REGISTRY } from '../../utils/profile-field-registry';
import {
  LIVE_EXTRACTION_RUN_1,
  LIVE_EXTRACTION_RUN_2,
  LIVE_EXTRACTION_RUN_3,
} from '../../utils/__tests__/live-extraction-fixture';
import { animation } from '../../design-system/tokens';
import type { PreferenceWithHistory } from '../../../shared/interfaces/preference';

function makePreference(
  overrides: Partial<PreferenceWithHistory> = {},
): PreferenceWithHistory {
  return {
    id: 'pref-1',
    sessionId: 'sess-1',
    category: 'food',
    key: 'cuisine',
    value: 'Italian',
    confidence: 0.9,
    sourceMessageId: 'msg-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: [],
    ...overrides,
  };
}

/**
 * Hard ceiling on renders per test. A runaway ingestion effect would otherwise
 * spin until the vitest worker dies of OOM, which reads as a hung CI job rather
 * than a failing assertion. Throwing during render breaks the cycle so the
 * failure is legible.
 */
const RENDER_BUDGET = 40;

/**
 * Renders the ingestion hook inside the same provider nesting the app uses,
 * and hands the test both stores plus a count of profile-store writes.
 *
 * `discoveredWriteBatches` counts distinct `discoveredValues` object identities
 * seen across renders. `SET_DISCOVERED_VALUE` always builds a fresh record, so
 * a change in identity means at least one ingestion dispatch reached the
 * reducer. React batches dispatches from a single effect pass into one render,
 * so this counts effect passes that wrote, not individual dispatches — which is
 * exactly the granularity the loop guard cares about. Zero means the effect
 * never wrote at all.
 */
function renderIngestion() {
  const discoveredIdentities: Array<Record<string, unknown>> = [];
  let renderCount = 0;

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(PreferencesProvider, {
      children: React.createElement(ProfileStoreProvider, { sessionId: null, children }),
    });

  const view = renderHook(
    () => {
      renderCount += 1;
      if (renderCount > RENDER_BUDGET) {
        throw new Error(
          `usePreferenceIngestion re-rendered more than ${RENDER_BUDGET} times — the ` +
            'ingestion effect is re-firing on the profile writes it causes itself. Check ' +
            'that its dependency array is still exactly [preferencesState.preferences].',
        );
      }

      const preferences = usePreferencesContext();
      const profile = useProfileStoreContext();
      const ingestion = usePreferenceIngestion();

      const last = discoveredIdentities[discoveredIdentities.length - 1];
      if (last !== profile.state.discoveredValues) {
        discoveredIdentities.push(profile.state.discoveredValues);
      }

      return { preferences, profile, ingestion };
    },
    { wrapper },
  );

  return {
    ...view,
    /** Number of effect passes that wrote to the profile store. */
    get discoveredWriteBatches() {
      return Math.max(0, discoveredIdentities.length - 1);
    },
    addPreference(preference: PreferenceWithHistory) {
      act(() => {
        view.result.current.preferences.dispatch({ type: 'ADD_PREFERENCE', preference });
      });
    },
    setManualValue(fieldId: string, value: string) {
      act(() => {
        view.result.current.profile.dispatch({ type: 'SET_MANUAL_VALUE', fieldId, value });
      });
    },
    /** What the dossier's ✗ dispatches. */
    rejectField(fieldId: string) {
      act(() => {
        view.result.current.profile.dispatch({ type: 'CLEAR_DISCOVERED_VALUE', fieldId });
      });
    },
    addPreferences(preferences: PreferenceWithHistory[]) {
      act(() => {
        view.result.current.preferences.dispatch({ type: 'LOAD_PREFERENCES', preferences });
      });
    },
  };
}

describe('usePreferenceIngestion', () => {
  describe('preference to field mapping', () => {
    it('maps a mapped preference onto its profile field', () => {
      const view = renderIngestion();

      view.addPreference(makePreference({ category: 'food', key: 'cuisine', value: 'Italian' }));

      expect(view.result.current.profile.state.discoveredValues.favorite_cuisine).toMatchObject({
        value: 'Italian',
        source: 'discovered',
        confidence: 0.9,
      });
      expect(view.result.current.profile.getFieldValue('favorite_cuisine')?.value).toBe('Italian');
    });

    it('resolves keys case-insensitively and via alias mappings', () => {
      const view = renderIngestion();

      view.addPreference(
        makePreference({ id: 'p-1', category: 'music', key: 'Favorite Genre', value: 'Jazz' }),
      );

      expect(view.result.current.profile.getFieldValue('music_genre')?.value).toBe('Jazz');
    });

    it('ignores preferences with no registry mapping', () => {
      const view = renderIngestion();

      view.addPreference(
        makePreference({ category: 'food', key: 'allergies', value: 'Peanuts' }),
      );

      expect(view.result.current.profile.state.discoveredValues).toEqual({});
      expect(view.discoveredWriteBatches).toBe(0);
    });

    it('updates the field when a mapped preference changes value', () => {
      const view = renderIngestion();

      view.addPreference(
        makePreference({ id: 'p-1', category: 'food', key: 'cuisine', value: 'Italian' }),
      );
      view.addPreference(
        makePreference({ id: 'p-2', category: 'travel', key: 'bucket list', value: 'Kyoto' }),
      );

      expect(view.result.current.profile.getFieldValue('favorite_cuisine')?.value).toBe('Italian');
      expect(view.result.current.profile.getFieldValue('travel_destination')?.value).toBe('Kyoto');
      expect(view.discoveredWriteBatches).toBe(2);
    });
  });

  describe('manual value wins', () => {
    /**
     * REGRESSION GUARD for the deliberately incomplete dependency array in
     * use-preference-ingestion.ts.
     *
     * The effect reads profileState.manualValues but only depends on
     * preferencesState.preferences. If someone "fixes" that with an
     * exhaustive-deps autofix, the effect re-fires on every profile write —
     * including the writes it causes itself — and this test starts seeing extra
     * SET_DISCOVERED_VALUE dispatches.
     */
    it('does not overwrite a manual value with an identical discovered one', () => {
      const view = renderIngestion();

      view.setManualValue('favorite_cuisine', 'Italian');
      const writesBeforePreference = view.discoveredWriteBatches;

      view.addPreference(
        makePreference({ category: 'food', key: 'cuisine', value: 'Italian' }),
      );

      // Manual value survives and still takes priority.
      expect(view.result.current.profile.state.manualValues.favorite_cuisine).toMatchObject({
        value: 'Italian',
        source: 'manual',
      });
      expect(view.result.current.profile.getFieldValue('favorite_cuisine')?.source).toBe('manual');

      // And the effect did not dispatch a redundant discovered write.
      expect(view.result.current.profile.state.discoveredValues.favorite_cuisine).toBeUndefined();
      expect(view.discoveredWriteBatches).toBe(writesBeforePreference);
    });

    it('does not overwrite a manual value with a conflicting discovered one', () => {
      const view = renderIngestion();

      view.setManualValue('favorite_cuisine', 'Thai');
      view.addPreference(
        makePreference({ category: 'food', key: 'cuisine', value: 'Italian' }),
      );

      expect(view.result.current.profile.getFieldValue('favorite_cuisine')?.value).toBe('Thai');
      expect(view.discoveredWriteBatches).toBe(0);
    });

    it('settles after ingesting a preference instead of re-dispatching forever', () => {
      const view = renderIngestion();

      view.addPreference(
        makePreference({ category: 'food', key: 'cuisine', value: 'Italian' }),
      );
      // A later profile write must not wake the ingestion effect back up.
      view.setManualValue('music_genre', 'Jazz');

      expect(view.discoveredWriteBatches).toBe(1);
    });

    /**
     * The sharpest form of the guard. Two preferences resolve to the same field
     * with *different* values, so the effect can never reach a state where both
     * are satisfied — whichever it wrote last, the other still looks stale.
     *
     * With the correct `[preferencesState.preferences]` dependency array the
     * effect runs once, writes twice, and stops. Add `profileState` to the deps
     * and it re-fires on its own write forever; the render budget in
     * `renderIngestion` turns that into a readable failure instead of an OOM.
     */
    it('does not oscillate when two preferences claim the same field', () => {
      const view = renderIngestion();

      act(() => {
        view.result.current.preferences.dispatch({
          type: 'LOAD_PREFERENCES',
          preferences: [
            makePreference({ id: 'p-1', category: 'food', key: 'cuisine', value: 'Italian' }),
            makePreference({
              id: 'p-2',
              category: 'food',
              key: 'favorite cuisine',
              value: 'Thai',
            }),
          ],
        });
      });

      // Last preference in registry order wins, and the effect settles there.
      expect(view.result.current.profile.getFieldValue('favorite_cuisine')?.value).toBe('Thai');
      // Both dispatches land in a single batched effect pass, and nothing follows.
      expect(view.discoveredWriteBatches).toBe(1);
    });
  });

  /*
   * Found in the Stage 6 screenshots, not by reasoning: pressing the dossier's ✗
   * ten times cleared exactly one field. Rejecting a guess removes the discovered
   * *value*, but the preference that produced it is still in the preferences
   * store, so the next pass of this effect put it straight back.
   */
  describe('rejected values stay rejected', () => {
    it('does not re-ingest a value the user has rejected', () => {
      const view = renderIngestion();

      view.addPreference(makePreference({ category: 'food', key: 'cuisine', value: 'Italian' }));
      expect(view.result.current.profile.getFieldValue('favorite_cuisine')?.value).toBe('Italian');

      view.rejectField('favorite_cuisine');
      expect(view.result.current.profile.getFieldValue('favorite_cuisine')).toBeNull();

      // A further extraction arriving must not resurrect the rejected field, even
      // though the original preference is still sitting in the store.
      view.addPreference(
        makePreference({ id: 'p-2', category: 'music', key: 'genre', value: 'Jazz' }),
      );

      expect(view.result.current.profile.getFieldValue('favorite_cuisine')).toBeNull();
      expect(view.result.current.profile.getFieldValue('music_genre')?.value).toBe('Jazz');
    });

    it('lets a manual answer override an earlier rejection', () => {
      const view = renderIngestion();

      view.addPreference(makePreference({ category: 'food', key: 'cuisine', value: 'Italian' }));
      view.rejectField('favorite_cuisine');
      view.setManualValue('favorite_cuisine', 'Thai');

      expect(view.result.current.profile.getFieldValue('favorite_cuisine')?.value).toBe('Thai');
      // The rejection is lifted, so a *different* later discovery can be offered
      // as a guess again rather than being suppressed forever.
      expect(view.result.current.profile.state.rejectedFieldIds).not.toContain('favorite_cuisine');
    });

    it('rejects each field independently', () => {
      const view = renderIngestion();

      view.addPreferences([
        makePreference({ id: 'p-1', category: 'food', key: 'cuisine', value: 'Italian' }),
        makePreference({ id: 'p-2', category: 'music', key: 'genre', value: 'Jazz' }),
      ]);
      view.rejectField('favorite_cuisine');

      expect(view.result.current.profile.getFieldValue('favorite_cuisine')).toBeNull();
      expect(view.result.current.profile.getFieldValue('music_genre')?.value).toBe('Jazz');
    });
  });

  describe('highlight animation', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('highlights a newly discovered field and clears it after the slow duration', () => {
      const view = renderIngestion();

      view.addPreference(
        makePreference({ category: 'food', key: 'cuisine', value: 'Italian' }),
      );

      expect(view.result.current.ingestion.highlightedFieldIds.has('favorite_cuisine')).toBe(true);

      act(() => {
        vi.advanceTimersByTime(animation.durations.slow - 1);
      });
      expect(view.result.current.ingestion.highlightedFieldIds.has('favorite_cuisine')).toBe(true);

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(view.result.current.ingestion.highlightedFieldIds.has('favorite_cuisine')).toBe(false);
      expect(view.result.current.ingestion.highlightedFieldIds.size).toBe(0);
    });

    it('does not highlight anything for an unmapped preference', () => {
      const view = renderIngestion();

      view.addPreference(
        makePreference({ category: 'food', key: 'allergies', value: 'Peanuts' }),
      );

      expect(view.result.current.ingestion.highlightedFieldIds.size).toBe(0);
    });
  });

  describe('live announcement', () => {
    it('announces the field label and value', () => {
      const view = renderIngestion();

      view.addPreference(
        makePreference({ category: 'food', key: 'cuisine', value: 'Italian' }),
      );

      // `${fieldDef.label}: ${pref.value}` for the favorite_cuisine field.
      expect(view.result.current.ingestion.liveAnnouncement).toBe('Favorite Cuisine: Italian');
    });

    it('starts empty and stays empty for an unmapped preference', () => {
      const view = renderIngestion();
      expect(view.result.current.ingestion.liveAnnouncement).toBe('');

      view.addPreference(
        makePreference({ category: 'food', key: 'allergies', value: 'Peanuts' }),
      );

      expect(view.result.current.ingestion.liveAnnouncement).toBe('');
    });

    it('announces the most recent discovery', () => {
      const view = renderIngestion();

      view.addPreference(
        makePreference({ id: 'p-1', category: 'food', key: 'cuisine', value: 'Italian' }),
      );
      view.addPreference(
        makePreference({ id: 'p-2', category: 'music', key: 'genre', value: 'Jazz' }),
      );

      expect(view.result.current.ingestion.liveAnnouncement).toBe('Music Genre: Jazz');
    });
  });

  describe('single-mount guard', () => {
    beforeEach(() => {
      resetDiscoveryMountCount();
    });

    afterEach(() => {
      resetDiscoveryMountCount();
      vi.restoreAllMocks();
    });

    const emptyDiscovery = { highlightedFieldIds: new Set<string>(), liveAnnouncement: '' };

    function renderProvider() {
      return render(
        React.createElement(DiscoveryProvider, { value: emptyDiscovery, children: 'ok' }),
      );
    }

    it('stays quiet for a single mount', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      renderProvider();

      expect(spy).not.toHaveBeenCalled();
    });

    it('reports an error when a second provider mounts', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const first = renderProvider();
      renderProvider();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toContain('mounted 2 times');

      first.unmount();
    });

    it('releases its slot on unmount so a remount is not flagged', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      renderProvider().unmount();
      renderProvider();

      expect(spy).not.toHaveBeenCalled();
    });
  });
});

/**
 * The end-to-end regression guard for the "0 OF 18 KNOWN" bug.
 *
 * Driven by `live-extraction-fixture.ts` — keys captured verbatim from real
 * Bedrock runs — and NOT by `DEMO_PROFILE_PREFERENCES`, whose keys were authored
 * to match the registry and therefore cannot detect this class of failure.
 */
describe('ingestion of real extraction output', () => {
  it('populates the profile from run 1 of the live capture', () => {
    const view = renderIngestion();

    LIVE_EXTRACTION_RUN_1.forEach((row, index) => {
      view.addPreference(
        makePreference({
          id: `live-1-${index}`,
          category: row.category,
          key: row.key,
          value: row.value,
        }),
      );
    });

    expect(view.result.current.profile.getFieldValue('birthday')?.value).toBe('June (turning 32)');
    expect(view.result.current.profile.getFieldValue('hobbies')?.value).toBe('loves salsa dancing');
  });

  it('populates the profile from the split-fact run', () => {
    const view = renderIngestion();

    LIVE_EXTRACTION_RUN_2.forEach((row, index) => {
      view.addPreference(
        makePreference({
          id: `live-2-${index}`,
          category: row.category,
          key: row.key,
          value: row.value,
        }),
      );
    });

    // Both halves route to `birthday`; the field is populated either way.
    expect(view.result.current.profile.getFieldValue('birthday')).not.toBeNull();
    expect(view.result.current.profile.getFieldValue('hobbies')?.value).toBe('loves salsa dancing');
  });

  it('names her and fills a non-zero tally after two realistic turns', () => {
    // This is the success criterion from the bug report, asserted directly: the
    // rail header showed "Someone special" and the tally read 0 OF 18.
    const view = renderIngestion();

    LIVE_EXTRACTION_RUN_3.forEach((row, index) => {
      view.addPreference(
        makePreference({
          id: `live-3-${index}`,
          category: row.category,
          key: row.key,
          value: row.value,
        }),
      );
    });

    expect(view.result.current.profile.getFieldValue('partner_name')?.value).toBe('Mirabel');

    const filled = PROFILE_FIELD_REGISTRY.filter(
      (f) => view.result.current.profile.getFieldValue(f.id) !== null,
    );
    expect(filled.length).toBeGreaterThan(0);
  });

  it('prefers an explicit fieldId over key resolution', () => {
    const view = renderIngestion();

    view.addPreference(
      makePreference({
        id: 'explicit',
        category: 'important_dates',
        // A key that resolves nowhere on its own.
        key: 'when_she_was_born_ish',
        fieldId: 'birthday',
        value: '12 June',
      }),
    );

    expect(view.result.current.profile.getFieldValue('birthday')?.value).toBe('12 June');
  });

  it('ignores a non-canonical fieldId and falls back to the key', () => {
    const view = renderIngestion();

    view.addPreference(
      makePreference({
        id: 'bogus-field',
        category: 'important_dates',
        key: 'birthday_month',
        fieldId: 'not_a_real_field',
        value: 'June',
      }),
    );

    expect(view.result.current.profile.getFieldValue('birthday')?.value).toBe('June');
    expect(view.result.current.profile.getFieldValue('not_a_real_field')).toBeNull();
  });

  it('still lets a manual value win over a live-resolved discovery', () => {
    // The manual-wins guarantee must survive the new resolution path.
    const view = renderIngestion();

    view.setManualValue('birthday', '1994-06-12');
    view.addPreference(
      makePreference({ id: 'live-manual', category: 'important_dates', key: 'birthday_month', value: 'June' }),
    );

    expect(view.result.current.profile.getFieldValue('birthday')?.value).toBe('1994-06-12');
  });
});

describe('resolvePreferenceField observability', () => {
  const originalDev = import.meta.env.DEV;

  afterEach(() => {
    vi.restoreAllMocks();
    (import.meta.env as { DEV: boolean }).DEV = originalDev;
  });

  it('warns loudly when a valued preference resolves to nothing', () => {
    (import.meta.env as { DEV: boolean }).DEV = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = resolvePreferenceField({
      category: 'gifts',
      key: 'her_favourite_sandwich_filling',
      value: 'coronation chicken',
    });

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0][0] as string;
    // The warning must name both halves, or it is not actionable.
    expect(message).toContain('gifts');
    expect(message).toContain('her_favourite_sandwich_filling');
    expect(message).toContain('coronation chicken');
  });

  it('stays quiet for a key that is knowingly not a profile field', () => {
    (import.meta.env as { DEV: boolean }).DEV = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    resolvePreferenceField({
      category: 'food',
      key: 'allergies',
      value: 'shellfish',
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it('stays quiet for a preference with no value', () => {
    (import.meta.env as { DEV: boolean }).DEV = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    resolvePreferenceField({ category: 'gifts', key: 'unknowable', value: '   ' });

    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn outside development', () => {
    (import.meta.env as { DEV: boolean }).DEV = false;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    resolvePreferenceField({ category: 'gifts', key: 'unknowable', value: 'a value' });

    expect(warn).not.toHaveBeenCalled();
  });
});
