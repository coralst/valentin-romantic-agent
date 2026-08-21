import { useMemo, useCallback } from 'react';
import { usePreferencesContext } from '../context/preferences-context';
import { useProfileStoreContext } from '../context/profile-store-context';
import { useDiscoveryContext } from '../context/discovery-context';
import { PROFILE_FIELD_SECTIONS, PROFILE_FIELD_REGISTRY, getFieldsBySection, getDateFields } from '../utils/profile-field-registry';
import { resolveField } from '../utils/preference-field-mapper';
import { deriveOccasions } from '../utils/occasion-derivation';
import { PREFERENCE_CATEGORIES } from '../../shared/constants/categories';
import { PartnerAvatar } from './PartnerAvatar';
import { CompletionSummary } from './CompletionSummary';
import { FieldSection } from './FieldSection';
import { CategoryGroup } from './CategoryGroup';
import { OccasionCalendar } from './OccasionCalendar';
import { colors, spacing, typography } from '../design-system/tokens';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  backgroundColor: colors.surface,
};

const headerStyle: React.CSSProperties = {
  padding: `${spacing.sm}px ${spacing.md}px ${spacing.xs}px`,
  fontFamily: typography.headingFontFamily,
  fontSize: typography.sizes.lg,
  fontWeight: typography.weights.bold,
  color: colors.text,
  letterSpacing: '-0.01em',
  flexShrink: 0,
};

const scrollableStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: `0 ${spacing.sm}px`,
  minHeight: 0,
};

const calendarSectionStyle: React.CSSProperties = {
  padding: `${spacing.xs}px ${spacing.sm}px ${spacing.sm}px`,
  flexShrink: 0,
};

const otherDiscoveriesStyle: React.CSSProperties = {
  marginTop: spacing.xs,
  padding: `${spacing.xs}px 0`,
};

const otherDiscoveriesHeaderStyle: React.CSSProperties = {
  fontSize: typography.sizes.xs,
  fontWeight: typography.weights.semibold,
  color: colors.textSecondary,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  padding: `${spacing.xs}px ${spacing.xs}px`,
};

const emptyMessageStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: `${spacing.lg}px ${spacing.md}px`,
  fontSize: typography.sizes.sm,
  color: colors.textSecondary,
  fontStyle: 'italic',
  lineHeight: typography.lineHeights.relaxed,
};

const storageErrorStyle: React.CSSProperties = {
  fontSize: typography.sizes.xs,
  color: colors.error,
  padding: `4px ${spacing.md}px`,
  textAlign: 'center',
};

export function PartnerProfilePanel() {
  const { state: preferencesState, dispatch: preferencesDispatch } = usePreferencesContext();
  const { state: profileState, dispatch: profileDispatch, getFieldValue } = useProfileStoreContext();

  // Highlight state is owned by the ingestion effect in AppLayoutContent; this
  // panel only reads it. See use-preference-ingestion.ts.
  const { highlightedFieldIds } = useDiscoveryContext();

  // Handle save field
  const handleSaveField = useCallback((fieldId: string, value: string) => {
    profileDispatch({ type: 'SET_MANUAL_VALUE', fieldId, value });
  }, [profileDispatch]);

  // Handle clear field
  const handleClearField = useCallback((fieldId: string) => {
    profileDispatch({ type: 'CLEAR_MANUAL_VALUE', fieldId });
  }, [profileDispatch]);

  // Handle preference highlight end (for Other Discoveries)
  const handleHighlightEnd = useCallback((preferenceId: string) => {
    preferencesDispatch({ type: 'CLEAR_HIGHLIGHT', preferenceId });
  }, [preferencesDispatch]);

  // Get partner name for avatar
  const partnerNameValue = getFieldValue('partner_name');
  const partnerName = partnerNameValue?.value ?? null;

  // Calculate completion
  const totalFields = PROFILE_FIELD_REGISTRY.length;
  const filledFields = PROFILE_FIELD_REGISTRY.filter((f) => getFieldValue(f.id) !== null).length;

  // Derive occasions from date fields
  const dateFields = getDateFields();
  const fieldValuesForOccasions = useMemo(() => {
    const result: Record<string, { value: string } | undefined> = {};
    for (const df of dateFields) {
      const val = getFieldValue(df.id);
      if (val) result[df.id] = { value: val.value };
    }
    return result;
  }, [dateFields, getFieldValue, profileState.manualValues, profileState.discoveredValues]);

  const occasions = useMemo(() => deriveOccasions(dateFields, fieldValuesForOccasions), [dateFields, fieldValuesForOccasions]);

  // Find unmapped preferences for Other Discoveries
  const unmappedPreferences = useMemo(() => {
    const result: Record<string, PreferenceWithHistory[]> = {};
    for (const category of PREFERENCE_CATEGORIES) {
      const unmapped = preferencesState.preferences[category].filter((pref) => {
        return resolveField(pref.category, pref.key) === null;
      });
      if (unmapped.length > 0) {
        result[category] = unmapped;
      }
    }
    return result;
  }, [preferencesState.preferences]);

  const hasUnmapped = Object.keys(unmappedPreferences).length > 0;

  // Empty state check
  const isCompletelyEmpty = filledFields === 0 && !profileState.partnerPhoto;

  return (
    <div style={panelStyle} data-testid="partner-profile-panel">
      <h2 style={headerStyle}>Partner Profile</h2>

      {profileState.storageError && (
        <p style={storageErrorStyle} role="alert">{profileState.storageError}</p>
      )}

      <PartnerAvatar partnerName={partnerName} />
      <CompletionSummary filled={filledFields} total={totalFields} />

      {isCompletelyEmpty && (
        <p style={emptyMessageStyle} data-testid="empty-encouragement">
          Keep chatting with Valentin to discover your partner's preferences. Fields will fill in as the conversation unfolds.
        </p>
      )}

      <div style={scrollableStyle}>
        {PROFILE_FIELD_SECTIONS.map((section) => {
          const fields = getFieldsBySection(section.id);
          return (
            <FieldSection
              key={section.id}
              sectionId={section.id}
              label={section.label}
              fields={fields}
              getFieldValue={getFieldValue}
              onSaveField={handleSaveField}
              onClearField={handleClearField}
              highlightedFieldIds={highlightedFieldIds}
            />
          );
        })}

        {hasUnmapped && (
          <div style={otherDiscoveriesStyle} data-testid="other-discoveries">
            <p style={otherDiscoveriesHeaderStyle}>Other Discoveries</p>
            {PREFERENCE_CATEGORIES.filter((cat) => unmappedPreferences[cat]).map((cat) => (
              <CategoryGroup
                key={cat}
                category={cat}
                preferences={unmappedPreferences[cat]}
                highlightedIds={preferencesState.recentlyUpdated}
                onHighlightEnd={handleHighlightEnd}
              />
            ))}
          </div>
        )}
      </div>

      <div style={calendarSectionStyle}>
        <OccasionCalendar occasions={occasions} />
      </div>
    </div>
  );
}

