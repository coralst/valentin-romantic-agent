# Tasks: Partner Profile Panel

## Task 1: Profile Field Registry and Mapper Utilities

- [ ] Create `src/client/utils/profile-field-registry.ts`
  - Define `ProfileFieldDefinition` interface
  - Define `ProfileFieldValueType` type
  - Define `PROFILE_FIELD_SECTIONS` array with section id, label, order
  - Define `PROFILE_FIELD_REGISTRY` array with ~18 field definitions
  - Export helper `getFieldsBySection(sectionId)` and `getFieldById(id)`
- [ ] Create `src/client/utils/preference-field-mapper.ts`
  - Build lazy lookup map from registry mappings
  - Export `resolveField(category, key): string | null`
- [ ] Create `src/client/utils/occasion-derivation.ts`
  - Define `Occasion` interface
  - Export `deriveOccasions(fields, values): Occasion[]`
  - Export `getNextOccasion(occasions, referenceDate): Occasion | null`
  - Handle annual recurrence (match month+day in any year)

## Task 2: Profile Store with localStorage Persistence

- [ ] Create `src/client/hooks/use-profile-store.ts`
  - Define `ProfileStoreState` and `ProfileStoreAction` types
  - Implement reducer with SET_PHOTO, REMOVE_PHOTO, SET_MANUAL_VALUE, SET_DISCOVERED_VALUE, CLEAR_MANUAL_VALUE, RESTORE, STORAGE_ERROR actions
  - Implement `loadFromStorage(sessionId)` with corruption recovery
  - Implement `saveToStorage(sessionId, state)` with error handling
  - Wire save on every mutation via useEffect
- [ ] Create `src/client/context/profile-store-context.tsx`
  - ProfileStoreProvider wrapping children
  - useProfileStore consumer hook

## Task 3: PartnerAvatar Component

- [ ] Create `src/client/components/PartnerAvatar.tsx`
  - Circular photo display (object-fit: cover, border-radius: 50%)
  - Initials placeholder derived from partner_name field
  - Heart glyph fallback when no name
  - File input for upload (hidden, triggered by button)
  - Validation: PNG/JPEG/WebP, <= 5MB
  - Error messages for invalid type/size
  - Replace and remove controls (visible when photo exists)
  - Alt text with partner name or "Partner photo"
  - Full keyboard accessibility on all controls

## Task 4: ProfileField Component

- [ ] Create `src/client/components/ProfileField.tsx`
  - View mode: label, value, source indicator (discovered/manual badge)
  - Confidence badge for discovered values
  - Tentative styling for confidence < 0.5
  - Edit mode: input matching value type (text input, date input, comma-separated list, select for enum)
  - Save/cancel/clear controls
  - Validation per value type with error messages
  - Highlight animation (200-400ms) on new value
  - Accessible: label association, aria-label on edit button

## Task 5: FieldSection Component

- [ ] Create `src/client/components/FieldSection.tsx`
  - Collapsible section with heading (h3)
  - aria-expanded attribute on toggle control
  - Auto-collapse when section has no filled fields
  - Smooth expand/collapse animation (200-400ms)
  - Renders ProfileField for each field in section

## Task 6: CompletionSummary Component

- [ ] Create `src/client/components/CompletionSummary.tsx`
  - "X of Y fields filled" text
  - Visual progress indicator
  - Updates reactively as fields populate

## Task 7: OccasionCalendar Component

- [ ] Create `src/client/components/OccasionCalendar.tsx`
  - Month grid: weekday headings (Su-Sa) + day cells
  - Marked days highlighted for occasions
  - Annual recurrence: mark month+day regardless of year
  - Selected day shows occasion labels (tooltip/popover)
  - Next upcoming occasion display with days-until count
  - Prev/next month navigation controls
  - Empty state: "No important dates known yet"
  - Keyboard accessible: arrow keys for days, tab for controls

## Task 8: PartnerProfilePanel Composition

- [ ] Create `src/client/components/PartnerProfilePanel.tsx`
  - Compose: Avatar -> CompletionSummary -> FieldSections -> OtherDiscoveries -> OccasionCalendar
  - Desktop layout: avatar/calendar pinned, fields scroll
  - Mobile layout: single scrolling column
  - Empty state message when nothing populated
  - Live region for announcing discovered values
  - Wire PreferenceFieldMapper to route preference_update events

## Task 9: Integration with AppLayout

- [ ] Modify `src/client/components/AppLayout.tsx`
  - Replace `<ProfileDashboard />` with `<PartnerProfilePanel />`
  - Wrap with ProfileStoreProvider
  - Wire preference_update through mapper

## Task 10: Unit and Component Tests

- [ ] Create `src/client/utils/__tests__/profile-field-registry.test.ts`
- [ ] Create `src/client/utils/__tests__/preference-field-mapper.test.ts`
- [ ] Create `src/client/utils/__tests__/occasion-derivation.test.ts`
- [ ] Create `src/client/components/__tests__/PartnerAvatar.test.tsx`
- [ ] Create `src/client/components/__tests__/FieldSection.test.tsx`
- [ ] Create `src/client/components/__tests__/ProfileField.test.tsx`
- [ ] Create `src/client/components/__tests__/OccasionCalendar.test.tsx`

## Task 11: E2E Tests

- [ ] Create `e2e/partner-profile-panel.spec.ts`
  - Upload photo, enter date, observe occasion mark
  - Keyboard navigation through avatar, field edit, calendar controls
