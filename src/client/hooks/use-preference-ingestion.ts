import { useState, useEffect } from 'react';
import { usePreferencesContext } from '../context/preferences-context';
import { useProfileStoreContext } from '../context/profile-store-context';
import { PROFILE_FIELD_REGISTRY } from '../utils/profile-field-registry';
import {
  isIntentionalNonField,
  resolveByFieldId,
  resolveField,
} from '../utils/preference-field-mapper';
import { PREFERENCE_CATEGORIES } from '../../shared/constants/categories';
import { animation } from '../design-system/tokens';

/**
 * Route a preference onto a profile field, and complain in development when it
 * cannot be routed.
 *
 * A preference that resolves to nothing used to vanish without a sound — that is
 * the reason this bug survived 574 green tests and every committed screenshot.
 * The registry lookup only ever saw the seeded demo fixture, whose keys were
 * written to match it, so the failing path was never exercised and never
 * reported. Any future drop is now loud.
 *
 * `fieldId` from extraction wins; the category+key table is the fallback for rows
 * that predate it. Keys that are knowingly not profile fields (allergies,
 * pronouns) are silent — they are consumed elsewhere and are not losses.
 */
export function resolvePreferenceField(pref: {
  category: (typeof PREFERENCE_CATEGORIES)[number];
  key: string;
  value: string;
  fieldId?: string | null;
}): string | null {
  const direct = resolveByFieldId(pref.fieldId);
  if (direct) return direct;

  const resolved = resolveField(pref.category, pref.key);
  if (resolved) return resolved;

  if (import.meta.env?.DEV && pref.value?.trim() && !isIntentionalNonField(pref.key)) {
    console.warn(
      `[preference-ingestion] DROPPED discovery — no profile field for ` +
        `"${pref.category}:${pref.key}" (value: "${pref.value}"). ` +
        `Add a mapping in profile-field-registry.ts, a synonym in ` +
        `preference-field-mapper.ts, or have extraction emit a field id.`,
    );
  }
  return null;
}

/** What the ingestion effect exposes to the surfaces that render discoveries. */
export interface PreferenceIngestionResult {
  /** Field ids currently mid highlight animation. */
  highlightedFieldIds: Set<string>;
  /** Latest screen-reader announcement, `"<label>: <value>"`. */
  liveAnnouncement: string;
}

/**
 * The single place in the app where extracted preferences become profile field
 * values. Maps every preference in the preferences store onto a profile field
 * via `resolveField`, dispatches `SET_DISCOVERED_VALUE` for it, drives the
 * highlight animation, and produces the live-region announcement.
 *
 * Must be mounted exactly once — see `DiscoveryProvider`, which enforces that
 * in development. Two callers would double-dispatch and double-announce.
 *
 * ---
 * IMPORTANT — the dependency array is deliberately incomplete.
 *
 * The effect body reads `profileState.manualValues` and
 * `profileState.discoveredValues`, but the dependency array is only
 * `[preferencesState.preferences]`. That is load-bearing, not an oversight:
 *
 *   - The effect *writes* to `discoveredValues`. Depending on it would re-fire
 *     the effect on the store write it just caused — an infinite dispatch loop.
 *   - Reading a stale `manualValues` is exactly what makes "manual value always
 *     wins": the effect only ever runs when new preferences arrive, so a manual
 *     value written after ingestion is never revisited or clobbered.
 *
 * Do NOT "fix" this with an exhaustive-deps autofix. It will hang the app.
 * `use-preference-ingestion.test.ts` has a regression test that fails if you do.
 */
export function usePreferenceIngestion(): PreferenceIngestionResult {
  const { state: preferencesState } = usePreferencesContext();
  const { state: profileState, dispatch: profileDispatch } = useProfileStoreContext();

  const [highlightedFieldIds, setHighlightedFieldIds] = useState<Set<string>>(new Set());
  const [liveAnnouncement, setLiveAnnouncement] = useState('');

  // Map incoming preferences to profile fields
  useEffect(() => {
    for (const category of PREFERENCE_CATEGORIES) {
      for (const pref of preferencesState.preferences[category]) {
        const fieldId = resolvePreferenceField(pref);
        if (fieldId) {
          // A value the user has explicitly rejected must not come back. The
          // preference itself stays in the preferences store — rejecting a guess
          // is a judgement about a value, not a deletion of the message it came
          // from — so without this check the next run of this effect re-adds
          // exactly what ✗ removed.
          if (profileState.rejectedFieldIds.includes(fieldId)) continue;

          // Only set discovered value if no manual value exists
          const currentManual = profileState.manualValues[fieldId];
          if (!currentManual) {
            const currentDiscovered = profileState.discoveredValues[fieldId];
            if (!currentDiscovered || currentDiscovered.value !== pref.value) {
              profileDispatch({
                type: 'SET_DISCOVERED_VALUE',
                fieldId,
                value: pref.value,
                confidence: pref.confidence,
              });

              // Highlight animation
              setHighlightedFieldIds((prev) => new Set([...prev, fieldId]));
              setTimeout(() => {
                setHighlightedFieldIds((prev) => {
                  const next = new Set(prev);
                  next.delete(fieldId);
                  return next;
                });
              }, animation.durations.slow);

              // Live region announcement (R8.4)
              const fieldDef = PROFILE_FIELD_REGISTRY.find((f) => f.id === fieldId);
              if (fieldDef) {
                setLiveAnnouncement(`${fieldDef.label}: ${pref.value}`);
              }
            }
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see the note above; adding profileState here loops forever
  }, [preferencesState.preferences]);

  return { highlightedFieldIds, liveAnnouncement };
}
