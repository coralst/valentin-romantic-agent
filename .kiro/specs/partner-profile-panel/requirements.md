# Requirements Document

## Introduction

The Partner Profile panel is the right-hand column of the Valentin application (implemented today as `ProfileDashboard`). In its current form the panel shows only a flat list of preferences grouped by the eight categories defined in `src/shared/constants/categories.ts`, and before any preference is extracted it renders a single centered empty state. The result is a tall, mostly empty column that communicates very little about the partner.

This feature reshapes that panel into a partner profile with three regions:

1. A **Partner_Avatar** at the top holding the partner's photo, with an initials placeholder before a photo exists.
2. A **structured field set** — a declared registry of named profile fields that fill in progressively as Valentin discovers values through conversation, and that the user can also fill or correct by hand.
3. An **Occasion_Calendar** anchored at the bottom of the panel (bottom-right of the desktop viewport) that marks important dates drawn from the profile's date fields and surfaces the next upcoming occasion.

This spec extends the main application spec at `.kiro/specs/valentin-romantic-agent/`. Terminology from that spec's Glossary (Valentin, Profile_Dashboard, Preference_Extractor, Preference_Store, WebSocket_Gateway, Session, Design_System) carries over unchanged. Requirement 4 of the main spec (Real-Time Dual-Panel Dashboard) and Requirement 5 (Sophisticated UI/UX Design) remain in force; this spec refines how the Profile_Dashboard's interior is composed without changing the dual-panel layout, the extraction pipeline, or the WebSocket protocol's existing `preference_update` event.

## Glossary

- **Partner_Profile_Panel**: The right-side panel of the application that presents the partner profile. Refines the Profile_Dashboard defined in the main application spec.
- **Partner_Avatar**: The region at the top of the Partner_Profile_Panel that displays the partner's photo or an initials placeholder.
- **Profile_Field**: A single named slot in the partner profile, identified by a stable identifier and holding at most one current value.
- **Profile_Field_Registry**: The declared, ordered collection of all Profile_Fields, each with its identifier, display label, value type, and owning Field_Section.
- **Field_Section**: A named group of related Profile_Fields rendered together under one heading in the Partner_Profile_Panel.
- **Field_Value**: The current value shown for a Profile_Field, together with its source (discovered or manual) and, for discovered values, its confidence score.
- **Preference_Field_Mapper**: The component that maps an extracted preference's category and key onto a Profile_Field identifier.
- **Other_Discoveries**: The section of the Partner_Profile_Panel that lists extracted preferences for which the Preference_Field_Mapper finds no Profile_Field mapping, preserving the category-grouped presentation that exists today.
- **Occasion**: A dated event derived from a date-typed Profile_Field, consisting of a label, a date, and a recurrence kind (annual or one-time).
- **Occasion_Calendar**: The compact month-grid component at the bottom of the Partner_Profile_Panel that marks Occasion dates and reports the next upcoming Occasion.
- **Profile_Store**: The client-side persistence layer that retains the partner photo and manually entered Field_Values across page reloads.
- **Completion_Summary**: The indicator in the Partner_Profile_Panel that reports how many Profile_Fields hold a value out of the total defined in the Profile_Field_Registry.

## Requirements

### Requirement 1: Partner Photo

**User Story:** As a user, I want a place at the top of the panel for my partner's photo, so that the profile feels like it belongs to a specific person rather than an anonymous data sheet.

#### Acceptance Criteria

1. THE Partner_Profile_Panel SHALL render the Partner_Avatar above every Field_Section and above the Occasion_Calendar.
2. WHILE no partner photo is stored, THE Partner_Avatar SHALL display the initials derived from the partner name Profile_Field.
3. WHILE no partner photo is stored and the partner name Profile_Field holds no value, THE Partner_Avatar SHALL display a heart glyph placeholder.
4. WHEN the user selects an image file whose media type is PNG, JPEG, or WebP and whose size is 5 MB or smaller, THE Partner_Avatar SHALL store the image through the Profile_Store and display the image cropped to a circle.
5. IF the selected file's media type is outside PNG, JPEG, and WebP, THEN THE Partner_Avatar SHALL keep the currently stored photo and display a message naming the three accepted media types.
6. IF the selected file's size exceeds 5 MB, THEN THE Partner_Avatar SHALL keep the currently stored photo and display a message stating the 5 MB maximum.
7. WHILE a partner photo is stored, THE Partner_Avatar SHALL offer a control to replace the photo and a control to remove the photo.
8. WHEN the user activates the remove control, THE Partner_Avatar SHALL delete the stored photo from the Profile_Store and return to the placeholder state defined in criteria 1.2 and 1.3.
9. WHEN a partner photo is displayed, THE Partner_Avatar SHALL supply alternative text that includes the value of the partner name Profile_Field, or the text "Partner photo" when that field holds no value.
10. THE Partner_Avatar SHALL expose the photo selection control, the replace control, and the remove control to keyboard operation.

### Requirement 2: Structured Profile Fields

**User Story:** As a user, I want the panel to show a defined set of profile fields rather than an unstructured list, so that I can see at a glance both what Valentin already knows and what remains to be discovered.

#### Acceptance Criteria

1. THE Profile_Field_Registry SHALL define each Profile_Field with a stable identifier, a display label, a value type drawn from the set {text, date, list, enum}, and one owning Field_Section.
2. THE Partner_Profile_Panel SHALL render every Profile_Field defined in the Profile_Field_Registry, grouped under the Field_Section that owns the field, in the order the registry declares.
3. THE Partner_Profile_Panel SHALL derive the set of rendered Profile_Fields from the Profile_Field_Registry, so that adding one entry to the registry adds one field to the panel without further changes to the panel's rendering code.
4. WHILE a Profile_Field holds no Field_Value, THE Partner_Profile_Panel SHALL render the field's display label together with a placeholder indicating the value is not yet known.
5. WHEN a Profile_Field holds a Field_Value, THE Partner_Profile_Panel SHALL render the field's display label, the value, and an indicator of the value's source.
6. THE Partner_Profile_Panel SHALL render the Completion_Summary reporting the count of Profile_Fields holding a Field_Value and the total count of Profile_Fields defined in the Profile_Field_Registry.
7. WHERE a Field_Section holds no Profile_Field with a Field_Value, THE Partner_Profile_Panel SHALL render that Field_Section collapsed on first render.
8. WHEN the user activates a Field_Section heading, THE Partner_Profile_Panel SHALL toggle that section between the expanded and collapsed presentations.

### Requirement 3: Progressive Population From Conversation

**User Story:** As a user, I want the profile fields to fill in as I chat with Valentin, so that the profile grows without me having to enter data manually.

#### Acceptance Criteria

1. WHEN the WebSocket_Gateway delivers a `preference_update` event, THE Preference_Field_Mapper SHALL resolve the preference's category and key to a Profile_Field identifier if the registry declares a mapping for that category and key.
2. WHEN the Preference_Field_Mapper resolves a Profile_Field identifier and that Profile_Field holds no manual Field_Value, THE Partner_Profile_Panel SHALL display the extracted value as that field's Field_Value with source `discovered` within 2 seconds of receiving the event.
3. WHEN a Profile_Field transitions from holding no Field_Value to holding a Field_Value, THE Partner_Profile_Panel SHALL play a highlight animation lasting between 200 ms and 400 ms on that field.
4. IF the Preference_Field_Mapper resolves no Profile_Field identifier for a `preference_update` event, THEN THE Partner_Profile_Panel SHALL render the preference under Other_Discoveries, grouped by its preference category.
5. WHEN a discovered value replaces an existing discovered Field_Value for the same Profile_Field, THE Partner_Profile_Panel SHALL display the replacing value and retain the replaced value in that preference's history log.
6. WHERE a discovered Field_Value carries a confidence score below 0.5, THE Partner_Profile_Panel SHALL mark that Field_Value as tentative.
7. WHILE no Profile_Field holds a Field_Value and no partner photo is stored, THE Partner_Profile_Panel SHALL display a message encouraging the user to continue chatting with Valentin, and SHALL continue to render the Partner_Avatar and the Occasion_Calendar.

### Requirement 4: Manual Entry and Correction

**User Story:** As a user, I want to fill in or correct a profile field myself, so that a value Valentin missed or got wrong does not stay wrong.

#### Acceptance Criteria

1. WHEN the user activates a Profile_Field's edit control, THE Partner_Profile_Panel SHALL present an input control matching that field's declared value type.
2. WHEN the user submits a value that satisfies the validation rules for the field's value type, THE Partner_Profile_Panel SHALL store the value through the Profile_Store as a Field_Value with source `manual` and SHALL display the value with a manual source indicator.
3. IF the submitted value violates the validation rules for the field's value type, THEN THE Partner_Profile_Panel SHALL keep the field's previous Field_Value and display a message stating the expected format for that value type.
4. WHILE a Profile_Field holds a manual Field_Value, THE Partner_Profile_Panel SHALL display the manual Field_Value in place of any discovered value for that field.
5. WHEN the user clears a Profile_Field's manual Field_Value and a discovered value exists for that field, THE Partner_Profile_Panel SHALL display the most recent discovered value as that field's Field_Value.
6. WHEN the user clears a Profile_Field's manual Field_Value and no discovered value exists for that field, THE Partner_Profile_Panel SHALL render that field in the unfilled presentation defined in criterion 2.4.
7. WHEN the user cancels an in-progress edit, THE Partner_Profile_Panel SHALL keep the field's previous Field_Value and close the input control.

### Requirement 5: Occasion Calendar

**User Story:** As a user, I want a small calendar in the bottom-right of the panel showing my partner's important dates, so that I can see what is coming up without leaving the conversation.

#### Acceptance Criteria

1. THE Partner_Profile_Panel SHALL render the Occasion_Calendar below every Field_Section.
2. THE Occasion_Calendar SHALL display one month at a time as a grid of weekday headings and the days of the displayed month.
3. THE Occasion_Calendar SHALL derive one Occasion from each date-typed Profile_Field that holds a Field_Value, using the field's display label as the Occasion label.
4. THE Occasion_Calendar SHALL mark every day in the displayed month that carries at least one Occasion.
5. WHERE an Occasion has recurrence kind `annual`, THE Occasion_Calendar SHALL mark the day and month of that Occasion in every displayed year.
6. WHEN the user selects a marked day, THE Occasion_Calendar SHALL display the labels of all Occasions falling on that day.
7. THE Occasion_Calendar SHALL display the label and date of the next upcoming Occasion together with the whole number of days between the current date and that Occasion.
8. WHEN the user activates the next-month control or the previous-month control, THE Occasion_Calendar SHALL display the adjacent month with its Occasion marks applied.
9. WHEN a date-typed Profile_Field's Field_Value changes, THE Occasion_Calendar SHALL update its Occasion marks and its next upcoming Occasion to reflect the changed value.
10. WHILE no date-typed Profile_Field holds a Field_Value, THE Occasion_Calendar SHALL display the current month and a message stating that no important dates are known yet.
11. THE Occasion_Calendar SHALL expose the day cells, the next-month control, and the previous-month control to keyboard operation.

### Requirement 6: Panel Layout and Responsiveness

**User Story:** As a user, I want the photo, fields, and calendar to share the panel without crowding each other, so that the column reads as one coherent profile at any window size.

#### Acceptance Criteria

1. WHILE the viewport width is 768 px or greater, THE Partner_Profile_Panel SHALL place the Partner_Avatar at the top of the panel, the Field_Sections in the middle, and the Occasion_Calendar at the bottom of the panel.
2. WHILE the combined height of the Field_Sections exceeds the height available between the Partner_Avatar and the Occasion_Calendar, THE Partner_Profile_Panel SHALL scroll the Field_Sections region independently while keeping the Partner_Avatar and the Occasion_Calendar visible.
3. WHILE the viewport width is below 768 px, THE Partner_Profile_Panel SHALL render the Partner_Avatar, the Field_Sections, and the Occasion_Calendar in a single scrolling column in that order.
4. THE Partner_Profile_Panel SHALL draw all colors, spacing values, typography values, border radii, and shadows from the Design_System tokens.
5. THE Partner_Profile_Panel SHALL keep every state-change animation within a duration between 200 ms and 400 ms.

### Requirement 7: Profile Persistence

**User Story:** As a user, I want the photo I uploaded and the values I typed to still be there after I reload the page, so that my input is not thrown away.

#### Acceptance Criteria

1. THE Profile_Store SHALL persist the partner photo and every manual Field_Value keyed by the current Session identifier.
2. WHEN the application loads and the Profile_Store holds data for the current Session identifier, THE Partner_Profile_Panel SHALL restore the partner photo and every manual Field_Value from that data.
3. IF the data held by the Profile_Store cannot be parsed, THEN THE Profile_Store SHALL discard the unparsable data, and THE Partner_Profile_Panel SHALL render the state defined in criterion 3.7.
4. IF a write to the Profile_Store fails, THEN THE Partner_Profile_Panel SHALL keep the value in its in-memory state and display a message stating the value was not saved for the next visit.

### Requirement 8: Accessibility

**User Story:** As a user relying on assistive technology, I want the profile panel to be navigable and readable, so that the photo, fields, and calendar are usable without a mouse.

#### Acceptance Criteria

1. THE Partner_Profile_Panel SHALL associate every Profile_Field input control with its display label through an accessible name.
2. THE Partner_Profile_Panel SHALL render each Field_Section heading as a heading element and each collapsible Field_Section control with an expanded-state attribute reflecting the section's current state.
3. THE Occasion_Calendar SHALL render its month grid with a role that identifies the grid as a table of dates and SHALL give each marked day an accessible name including the day's date and the labels of its Occasions.
4. WHEN a Profile_Field receives a Field_Value from a `preference_update` event, THE Partner_Profile_Panel SHALL announce the field label and new value through a live region.
5. THE Partner_Profile_Panel SHALL render text at a contrast ratio of 4.5:1 or greater against its background.

### Requirement 9: Test Coverage

**User Story:** As a developer, I want the new panel regions covered by automated tests, so that the panel stays correct as later phases extend it.

#### Acceptance Criteria

1. THE test suite SHALL include unit tests for the Profile_Field_Registry, the Preference_Field_Mapper, and the Occasion derivation logic using Vitest.
2. THE test suite SHALL include component tests for the Partner_Avatar, the Field_Section rendering, the Profile_Field edit flow, and the Occasion_Calendar using React Testing Library.
3. THE test suite SHALL include an end-to-end test covering the flow of loading the application, uploading a partner photo, entering a date-typed Profile_Field by hand, and observing the resulting Occasion mark in the Occasion_Calendar using Playwright.
4. THE test suite SHALL include an end-to-end test covering keyboard navigation through the Partner_Avatar controls, one Profile_Field edit control, and the Occasion_Calendar month controls using Playwright.
