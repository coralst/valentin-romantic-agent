import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import React from 'react';
import { PreferencesProvider, usePreferencesContext } from '../../context/preferences-context';
import { ProfileStoreProvider, useProfileStoreContext } from '../../context/profile-store-context';
import { DiscoveryProvider, resetDiscoveryMountCount } from '../../context/discovery-context';
import { usePreferenceIngestion } from '../use-preference-ingestion';
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
