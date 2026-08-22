import { useCallback, useMemo, useRef, useState } from 'react';
import { usePreferencesContext } from '../context/preferences-context';
import { useProfileStoreContext } from '../context/profile-store-context';
import { useChatContext } from '../context/chat-context';
import { colors, insets, typography } from '../design-system/tokens';
import {
  PROFILE_FIELD_REGISTRY,
  getDateFields,
} from '../utils/profile-field-registry';
import { deriveOccasions } from '../utils/occasion-derivation';
import { rankUnfilledFields, type FieldGap } from '../utils/field-payoff';
import { getAgeBucketFromValue } from '../utils/age-bucket';
import { formatBirthdayValue } from '../utils/birthday-display';
import { PREFERENCE_CATEGORIES } from '../../shared/constants/categories';
import { WhoHeader } from './brief/WhoHeader';
import { NextUp } from './brief/NextUp';
import { KeepInMind, deriveCautions } from './brief/KeepInMind';
import { WorthAsking } from './brief/WorthAsking';
import { GoodToKnow, type Chip } from './brief/GoodToKnow';
import { ValentinNudge } from './brief/ValentinNudge';
import { TallyFooter } from './brief/TallyFooter';
import { onClaret } from './brief/rail-tones';
import { useOptionalViewContext } from '../context/view-context';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';

/*
 * The unmapped extraction output is rescued, as of Stage 6.
 *
 * Preferences that `resolveField()` cannot match onto one of the 18 registry
 * fields now render in the dossier's "Also mentioned" card
 * (`dossier/AlsoMentioned.tsx`), through the `CategoryGroup`/`PreferenceCard`
 * pair that was kept alive for exactly that. The rail keeps rescuing the most
 * consequential slice itself — `KeepInMind`'s allergy/avoidance keys — because
 * a dinner suggestion that ignores an allergy is worse than no suggestion, and
 * that has to be visible without opening the dossier.
 */

/**
 * Which registry fields become chips in the pinned "Good to know" strip.
 *
 * These are the short, factual answers you glance at rather than read: a colour,
 * a cuisine, a fragrance. Anything whose value is a sentence (`how_we_met`) would
 * wrap to three lines and break the strip, so it stays in the scroll region.
 *
 * `label` is shortened from the registry's own label — "Dream Destination" does
 * not fit in a 306px pill next to its value.
 */
const CHIP_FIELDS: ReadonlyArray<{ fieldId: string; label: string }> = [
  { fieldId: 'favorite_color', label: 'Colour' },
  { fieldId: 'favorite_cuisine', label: 'Food' },
  { fieldId: 'music_genre', label: 'Music' },
  { fieldId: 'fragrance_preference', label: 'Scent' },
  { fieldId: 'travel_destination', label: 'Dreams of' },
  { fieldId: 'gift_budget', label: 'Budget' },
  { fieldId: 'zodiac_sign', label: 'Sign' },
];

/** Chip values are pills, not paragraphs — anything longer is cut on a word. */
const CHIP_VALUE_MAX = 22;

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  // Only break on a word if that leaves something worth reading.
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/*
 * The subtitle reads "17 June 1988 · mid-thirties · Gemini" — whichever parts are
 * known. The date comes from `formatBirthdayValue`, which refuses to invent a day
 * and a month from a partial value; see `birthday-display.ts`.
 */

/**
 * The legacy-alias wrapper.
 *
 * `data-testid` is a single-valued attribute, so one DOM node cannot answer to
 * both `brief-rail` and `partner-profile-panel`. Rather than hide a marker span —
 * which would satisfy `toBeInTheDocument()` but fail any future `toBeVisible()` —
 * the alias is a real, full-bleed, transparent flex wrapper. Both selectors
 * resolve to a visible box of the rail's exact size.
 *
 * It repeats `flex: 1` / `minHeight: 0` / `minWidth: 0` because it is now the
 * grid child, and an extra flex level with default `min-height: auto` is exactly
 * the bug that pushed the composer off-screen in Stage 3.
 */
const aliasWrapperStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflow: 'hidden',
};

const railStyle: React.CSSProperties = {
  background: colors.railGradient,
  color: colors.onClaret,
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  // `minHeight: 0` and `flex: 1` together. The rail is a flex child of the
  // window grid cell, whose own default `min-height: auto` sizes it to content:
  // without both, the scroll region grows to its full 1384px and shoves the
  // pinned nudge and chip strip out through the bottom of an 872px window —
  // which is the exact bug pinning them was meant to fix
  // (option-5d-brief.html:41-42). Stage 3 hit the same thing one level deeper.
  minHeight: 0,
  minWidth: 0,
  flex: 1,
  overflow: 'hidden',
};

/**
 * The masked fade at the foot of the scroll region.
 *
 * Content recedes under the pinned nudge instead of being sliced off mid-line.
 * Dropped on mobile: at the bottom of a full-height panel with nothing pinned
 * visually below it, a fade reads as a rendering fault rather than as depth.
 */
const SCROLL_MASK = 'linear-gradient(to bottom, #000 calc(100% - 26px), transparent 100%)';

function getScrollStyle(isMobile: boolean): React.CSSProperties {
  return {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: `${insets.snug}px ${insets.snug}px 8px`,
    ...(isMobile
      ? {}
      : { maskImage: SCROLL_MASK, WebkitMaskImage: SCROLL_MASK }),
  };
}

const emptyStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  lineHeight: 1.55,
  color: onClaret(0.6),
  marginTop: 14,
};

const storageErrorStyle: React.CSSProperties = {
  fontFamily: typography.bodyFontFamily,
  fontSize: typography.px.label,
  lineHeight: 1.4,
  color: colors.goldLight,
  marginTop: 12,
};

interface BriefRailProps {
  /** Full-width and unmasked when true. Driven by `AppLayout`'s `isMobile`. */
  isMobile?: boolean;
}

/**
 * Column 4 of the window: the brief.
 *
 * An agenda, not a mirror of the profile. Three regions, top to bottom:
 * a masked scroll region (who she is, what is next, what to keep in mind, what
 * to ask), then the pinned "Good to know" chips, the pinned nudge, and the tally
 * footer. The bottom three never scroll away, because they are the parts you act
 * on and they were previously invisible below the fold.
 *
 * The root carries `data-testid="brief-rail"` *and* the legacy
 * `data-testid="partner-profile-panel"`. The alias is not decorative: three
 * unit tests and two Playwright specs select the profile surface by the old name,
 * and `e2e/` is not this component's lane to edit. A QA follow-up renames them.
 */
export function BriefRail({ isMobile = false }: BriefRailProps) {
  const { state: preferencesState } = usePreferencesContext();
  const { state: profileState, dispatch: profileDispatch, getFieldValue } =
    useProfileStoreContext();
  const { dispatch: chatDispatch } = useChatContext();
  /*
   * Optional, not required: the footer grows its "Full profile →" link when the
   * app's view context is above the rail, and the rail still renders without it
   * in the unit tests that mount it on its own.
   */
  const view = useOptionalViewContext();

  /** Field ids whose nudge the user has waved off this session. */
  const [dismissedGaps, setDismissedGaps] = useState<Set<string>>(new Set());
  const photoInputRef = useRef<HTMLInputElement>(null);

  const isFilled = useCallback(
    (fieldId: string) => getFieldValue(fieldId) !== null,
    [getFieldValue],
  );

  const total = PROFILE_FIELD_REGISTRY.length;
  const filled = PROFILE_FIELD_REGISTRY.filter((field) => isFilled(field.id)).length;

  const name = getFieldValue('partner_name')?.value ?? null;
  const birthdayValue = getFieldValue('birthday')?.value ?? null;
  const zodiac = getFieldValue('zodiac_sign')?.value ?? null;

  const subtitle = useMemo(() => {
    const parts: string[] = [];
    if (birthdayValue) {
      const said = formatBirthdayValue(birthdayValue);
      if (said) parts.push(said);
      const bucket = getAgeBucketFromValue(birthdayValue);
      if (bucket) parts.push(bucket);
    }
    if (zodiac) parts.push(zodiac);
    return parts.length > 0 ? parts.join(' · ') : null;
  }, [birthdayValue, zodiac]);

  const dateFields = getDateFields();
  const occasions = useMemo(() => {
    const values: Record<string, { value: string } | undefined> = {};
    for (const field of dateFields) {
      const entry = getFieldValue(field.id);
      if (entry) values[field.id] = { value: entry.value };
    }
    return deriveOccasions(dateFields, values);
  }, [dateFields, getFieldValue]);

  /** Every preference, flattened out of its per-category buckets. */
  const allPreferences = useMemo(() => {
    const flat: PreferenceWithHistory[] = [];
    for (const category of PREFERENCE_CATEGORIES) {
      flat.push(...preferencesState.preferences[category]);
    }
    return flat;
  }, [preferencesState.preferences]);

  const cautions = useMemo(
    () => deriveCautions(getFieldValue, allPreferences),
    [getFieldValue, allPreferences],
  );

  const gaps = useMemo(() => rankUnfilledFields(isFilled), [isFilled]);
  const nudgeGap = gaps.find((gap) => !dismissedGaps.has(gap.fieldId)) ?? null;
  // The nudge already occupies the top gap, so the list starts after it.
  const listedGaps = useMemo(
    () => gaps.filter((gap) => gap.fieldId !== nudgeGap?.fieldId),
    [gaps, nudgeGap],
  );

  const chips = useMemo<Chip[]>(
    () =>
      CHIP_FIELDS.map(({ fieldId, label }) => {
        const entry = getFieldValue(fieldId);
        return {
          fieldId,
          label,
          value: entry ? truncate(entry.value, CHIP_VALUE_MAX) : null,
        };
      })
        // An all-empty strip is seven identical outlines and no information, so
        // once anything is known the empty chips drop out except the first two,
        // which stay as the visible invitation to fill them.
        .filter((chip, index) => chip.value !== null || index < 2),
    [getFieldValue],
  );

  /**
   * Ask on the user's behalf: drop the question into the composer rather than
   * sending it. Valentin is the one who asks questions here, so the user gets to
   * see and edit the line before it goes.
   */
  const askAbout = useCallback(
    (gap: FieldGap) => {
      chatDispatch({ type: 'SET_INPUT', value: `Ask me about her ${gap.label.toLowerCase()}.` });
    },
    [chatDispatch],
  );

  const handleLater = useCallback(() => {
    if (!nudgeGap) return;
    setDismissedGaps((prev) => new Set(prev).add(nudgeGap.fieldId));
  }, [nudgeGap]);

  const handlePhotoChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (loaded) => {
        const dataUrl = loaded.target?.result;
        if (typeof dataUrl === 'string') profileDispatch({ type: 'SET_PHOTO', dataUrl });
      };
      reader.readAsDataURL(file);
    },
    [profileDispatch],
  );

  const isCompletelyEmpty = filled === 0 && !profileState.partnerPhoto;

  return (
    <div style={aliasWrapperStyle} data-testid="partner-profile-panel">
      <aside style={railStyle} data-testid="brief-rail" aria-label="Her brief">
        <div style={getScrollStyle(isMobile)} data-testid="brief-scroll">
          <WhoHeader
            name={name}
            subtitle={subtitle}
            photo={profileState.partnerPhoto}
            onEditPhoto={() => photoInputRef.current?.click()}
          />
          <input
            ref={photoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handlePhotoChange}
            style={{ display: 'none' }}
            aria-hidden="true"
            data-testid="brief-photo-input"
          />

          {profileState.storageError && (
            <p style={storageErrorStyle} role="alert">
              {profileState.storageError}
            </p>
          )}

          {isCompletelyEmpty ? (
            <p style={emptyStyle} data-testid="empty-encouragement">
              Keep chatting with Valentin. Her dates, the things to watch out for and
              the next thing worth planning will fill in here as you talk.
            </p>
          ) : (
            <>
              <NextUp occasions={occasions} />
              <KeepInMind cautions={cautions} />
              <WorthAsking gaps={listedGaps} onAsk={askAbout} />
            </>
          )}
        </div>

        {!isCompletelyEmpty && <GoodToKnow chips={chips} onChipClick={() => undefined} />}

        {nudgeGap && (
          <ValentinNudge
            reason={nudgeGap.reason}
            onAsk={() => askAbout(nudgeGap)}
            onLater={handleLater}
          />
        )}

        <TallyFooter filled={filled} total={total} onOpenFullProfile={view?.openDossier} />
      </aside>
    </div>
  );
}
