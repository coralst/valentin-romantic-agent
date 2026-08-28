import { describe, it, expect } from 'vitest';
import {
  PROFILE_FIELD_REGISTRY,
  PROFILE_FIELD_SECTIONS,
  getFieldsBySection,
  getFieldById,
  getDateFields,
} from '../profile-field-registry';
import {
  PROFILE_FIELD_GUIDANCE,
  PROFILE_FIELD_IDS,
  isProfileFieldId,
} from '../../../shared/constants/profile-fields';

describe('PROFILE_FIELD_REGISTRY', () => {
  it('defines at least 15 fields', () => {
    expect(PROFILE_FIELD_REGISTRY.length).toBeGreaterThanOrEqual(15);
  });

  it('has unique field ids', () => {
    const ids = PROFILE_FIELD_REGISTRY.map((f) => f.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('every field references a valid section', () => {
    const sectionIds = new Set(PROFILE_FIELD_SECTIONS.map((s) => s.id));
    for (const field of PROFILE_FIELD_REGISTRY) {
      expect(sectionIds.has(field.section)).toBe(true);
    }
  });

  it('every field has a non-empty label', () => {
    for (const field of PROFILE_FIELD_REGISTRY) {
      expect(field.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('every field has a valid valueType', () => {
    const validTypes = ['text', 'date', 'list', 'enum'];
    for (const field of PROFILE_FIELD_REGISTRY) {
      expect(validTypes).toContain(field.valueType);
    }
  });

  it('enum fields have enumOptions defined', () => {
    const enumFields = PROFILE_FIELD_REGISTRY.filter((f) => f.valueType === 'enum');
    for (const field of enumFields) {
      expect(field.enumOptions).toBeDefined();
      expect(field.enumOptions!.length).toBeGreaterThan(0);
    }
  });

  /**
   * The sizing facts a gift assistant is expected to hold.
   *
   * Pinned by id rather than left to the general shape tests above, because
   * these three are the ones a well-meaning tidy-up would fold back into
   * "Style" or drop as niche — and they are the ones visitors ask for first.
   */
  it('holds the gift-relevant sizes, grouped as sizes', () => {
    for (const id of ['clothing_size', 'shoe_size', 'ring_size']) {
      const field = getFieldById(id);
      expect(field, `missing field "${id}"`).toBeDefined();
      expect(field!.section).toBe('sizes');
      // Free text, not an enum: real answers are "UK 6 / EU 39" and "a 10 in
      // most things", neither of which fits a canonical scale.
      expect(field!.valueType).toBe('text');
    }
  });

  /**
   * The three measurements the dossier's "What fits her" card draws.
   *
   * Pinned separately from the gift sizes above because the card shows exactly
   * these three, in this order, and a tidy-up that renamed `clothing_size` back
   * to "Clothing Size" would leave the card claiming a generic word for a row
   * sitting beside a bra size.
   */
  it('holds the three measurements the card shows, labelled for it', () => {
    const expected: Array<[string, string]> = [
      ['bra_size', 'מידת חזיה'],
      ['clothing_size', 'Trousers'],
      ['shoulder_width', 'Shoulders'],
    ];
    for (const [id, label] of expected) {
      const field = getFieldById(id);
      expect(field, `missing field "${id}"`).toBeDefined();
      expect(field!.section).toBe('sizes');
      expect(field!.valueType).toBe('text');
      expect(field!.label).toBe(label);
    }
  });

  /**
   * The two `@`-encoded list fields.
   *
   * Both are drawn as structure — priced rows against a budget bar, seven
   * weekday bars — so both need a separator the value can be split on. They
   * must stay `list` (comma between items) with `@` inside an item; flipping
   * either to `text` would render the raw encoding on the page.
   */
  it('keeps the structured tiles as lists so their items can be split', () => {
    for (const id of ['gift_shortlist', 'weekly_rhythm', 'color_palette']) {
      const field = getFieldById(id);
      expect(field, `missing field "${id}"`).toBeDefined();
      expect(field!.valueType).toBe('list');
    }
  });

  it('never resolves the bare key "size" to a specific size field', () => {
    // "size" is generic enough that extraction reaches for it about a ring, a
    // shoe or a canvas. Mapping it would file the wrong fact confidently.
    const mappedKeys = PROFILE_FIELD_REGISTRY.flatMap((f) =>
      f.mappings.map((m) => m.key.toLowerCase()),
    );
    expect(mappedKeys).not.toContain('size');
  });

  it('every field has at least one mapping', () => {
    for (const field of PROFILE_FIELD_REGISTRY) {
      expect(field.mappings.length).toBeGreaterThan(0);
    }
  });
});

describe('PROFILE_FIELD_SECTIONS', () => {
  it('defines at least 4 sections', () => {
    expect(PROFILE_FIELD_SECTIONS.length).toBeGreaterThanOrEqual(4);
  });

  it('has unique section ids', () => {
    const ids = PROFILE_FIELD_SECTIONS.map((s) => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('has unique order values', () => {
    const orders = PROFILE_FIELD_SECTIONS.map((s) => s.order);
    const uniqueOrders = new Set(orders);
    expect(uniqueOrders.size).toBe(orders.length);
  });
});

describe('getFieldsBySection', () => {
  it('returns only fields belonging to the given section', () => {
    const basicsFields = getFieldsBySection('basics');
    expect(basicsFields.length).toBeGreaterThan(0);
    for (const field of basicsFields) {
      expect(field.section).toBe('basics');
    }
  });

  it('returns an empty array for a non-existent section', () => {
    expect(getFieldsBySection('nonexistent')).toEqual([]);
  });

  it('covers all fields when queried for all sections', () => {
    let total = 0;
    for (const section of PROFILE_FIELD_SECTIONS) {
      total += getFieldsBySection(section.id).length;
    }
    expect(total).toBe(PROFILE_FIELD_REGISTRY.length);
  });
});

describe('getFieldById', () => {
  it('returns the correct field for a valid id', () => {
    const field = getFieldById('partner_name');
    expect(field).toBeDefined();
    expect(field!.id).toBe('partner_name');
    expect(field!.label).toBe('Name');
  });

  it('returns undefined for an invalid id', () => {
    expect(getFieldById('nonexistent')).toBeUndefined();
  });
});

describe('getDateFields', () => {
  it('returns only date-typed fields', () => {
    const dateFields = getDateFields();
    expect(dateFields.length).toBeGreaterThan(0);
    for (const field of dateFields) {
      expect(field.valueType).toBe('date');
    }
  });

  it('includes birthday and anniversary', () => {
    const dateFields = getDateFields();
    const ids = dateFields.map((f) => f.id);
    expect(ids).toContain('birthday');
    expect(ids).toContain('anniversary');
  });
});

/**
 * The client registry and the shared field-id list must not drift.
 *
 * The server cannot import from `src/client/`, so the extraction tool schema is
 * built from `src/shared/constants/profile-fields.ts` while the rail is built
 * from `PROFILE_FIELD_REGISTRY`. Nothing in the type system connects the two: add
 * a field to one and the other silently ignores it, which is a quieter version of
 * the exact bug this branch fixes. These tests are that connection.
 */
describe('shared field-id list agrees with the client registry', () => {
  it('has the same ids, in the same order', () => {
    expect(PROFILE_FIELD_REGISTRY.map((f) => f.id)).toEqual([...PROFILE_FIELD_IDS]);
  });

  it('has guidance text for every field id', () => {
    for (const id of PROFILE_FIELD_IDS) {
      expect(PROFILE_FIELD_GUIDANCE[id], `missing guidance for "${id}"`).toBeTruthy();
    }
  });

  it('recognises every registry id as canonical', () => {
    for (const field of PROFILE_FIELD_REGISTRY) {
      expect(isProfileFieldId(field.id), `"${field.id}" not canonical`).toBe(true);
    }
  });

  it('rejects an id that is not in the registry', () => {
    expect(isProfileFieldId('not_a_field')).toBe(false);
  });
});
