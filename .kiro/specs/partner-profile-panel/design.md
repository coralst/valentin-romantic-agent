# Design Document: Partner Profile Panel

## Component Hierarchy

```
PartnerProfilePanel (composition root)
  +-- PartnerAvatar
  |     +-- photo display (circular crop) OR initials OR heart glyph
  |     +-- upload/replace/remove controls
  +-- CompletionSummary ("X of Y fields filled")
  +-- FieldSection[] (one per section in registry)
  |     +-- heading (collapsible, h3)
  |     +-- ProfileField[] (one per field in section)
  |           +-- view mode: label + value + source badge + confidence
  |           +-- edit mode: label + input control + save/cancel
  +-- OtherDiscoveries (unmapped preferences, CategoryGroup reuse)
  +-- OccasionCalendar
        +-- next upcoming display
        +-- month grid (weekday headings + day cells)
        +-- prev/next month nav
        +-- selected day tooltip
```

## Data Flow

```
WebSocket preference_update event
  --> PreferencesContext (existing reducer: ADD_PREFERENCE / UPDATE_PREFERENCE)
  --> PartnerProfilePanel observes PreferencesContext
  --> PreferenceFieldMapper.resolve(category, key) => fieldId | null
      if fieldId:
        --> ProfileStoreContext.setDiscoveredValue(fieldId, value, confidence)
        --> ProfileField re-renders with new value, highlight animation
        --> Live region announces "{label}: {value}"
      if null:
        --> OtherDiscoveries renders via existing CategoryGroup pattern

Manual entry:
  --> ProfileField edit mode
  --> user submits value
  --> ProfileStoreContext.setManualValue(fieldId, value)
  --> localStorage persistence
  --> ProfileField re-renders with source=manual
```

## New Interfaces

### ProfileFieldDefinition

```typescript
type ProfileFieldValueType = 'text' | 'date' | 'list' | 'enum';

interface ProfileFieldDefinition {
  id: string;                    // stable identifier e.g. "partner_name"
  label: string;                 // display label e.g. "Name"
  valueType: ProfileFieldValueType;
  section: string;               // section id e.g. "basics"
  enumOptions?: string[];        // for enum type
  mappings: Array<{              // category+key combos that map to this field
    category: PreferenceCategory;
    key: string;                 // case-insensitive match
  }>;
}
```

### ProfileFieldValue

```typescript
interface ProfileFieldValue {
  value: string;
  source: 'discovered' | 'manual';
  confidence?: number;           // 0-1, only for discovered
  updatedAt: string;             // ISO timestamp
}
```

### Occasion

```typescript
interface Occasion {
  fieldId: string;
  label: string;                 // from field definition's label
  date: Date;
  recurrence: 'annual' | 'one-time';
}
```

### ProfileStoreState

```typescript
interface ProfileStoreState {
  partnerPhoto: string | null;            // data URL
  manualValues: Record<string, ProfileFieldValue>;
  discoveredValues: Record<string, ProfileFieldValue>;
  storageError: string | null;
}
```

## Profile Field Registry Structure

The registry defines ~18 fields across 5 sections:

| Section | Fields |
|---------|--------|
| **Basics** (basics) | Name, Nickname, Birthday, Zodiac Sign |
| **Relationship** (relationship) | Anniversary, How We Met, Love Language, Relationship Duration |
| **Interests** (interests) | Favorite Cuisine, Music Genre, Hobbies, Travel Destination |
| **Style** (style) | Clothing Style, Favorite Color, Fragrance Preference |
| **Gifts** (gifts) | Gift Budget, Wish List, Surprise Preference |

Each field's `mappings` array maps from preference categories/keys:
- "partner_name" maps from `{ category: 'personality_traits', key: 'name' }`
- "birthday" maps from `{ category: 'important_dates', key: 'birthday' }`
- "anniversary" maps from `{ category: 'important_dates', key: 'anniversary' }`
- etc.

## Mapping Strategy

`PreferenceFieldMapper.resolve(category, key)`:
1. Build a lookup Map on first call (lazy singleton): `Map<"category:key", fieldId>`
2. Normalize the key to lowercase for matching
3. Return the fieldId or null if no mapping exists

This allows O(1) lookup and the map is rebuilt if the registry changes.

## Persistence Schema

localStorage key: `valentin-profile-{sessionId}`

```json
{
  "version": 1,
  "partnerPhoto": "data:image/png;base64,...",
  "manualValues": {
    "partner_name": { "value": "Alex", "source": "manual", "updatedAt": "..." },
    "birthday": { "value": "1990-03-15", "source": "manual", "updatedAt": "..." }
  }
}
```

On load:
- Parse JSON; if parse fails, discard and start fresh (R7.3)
- Check `version` field matches expected; if not, discard
- Restore `partnerPhoto` and `manualValues` into state

On write failure:
- Keep in-memory state intact
- Set `storageError` message (R7.4)

## Testing Strategy

### Unit Tests (Vitest)
- `profile-field-registry.test.ts` — validates field definitions, uniqueness, section membership
- `preference-field-mapper.test.ts` — resolve returns correct fieldId, null for unmapped
- `occasion-derivation.test.ts` — derives occasions from date fields, handles annual recurrence

### Component Tests (React Testing Library)
- `PartnerAvatar.test.tsx` — upload flow, validation errors, remove, keyboard
- `FieldSection.test.tsx` — collapse/expand, heading role, aria-expanded
- `ProfileField.test.tsx` — view/edit toggle, source badges, tentative marking
- `OccasionCalendar.test.tsx` — month rendering, day marking, navigation, keyboard

### E2E Tests (Playwright)
- Full flow: upload photo, enter date, see occasion mark
- Keyboard nav: tab through avatar, field edit, calendar controls
