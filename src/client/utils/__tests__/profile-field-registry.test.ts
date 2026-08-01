import { describe, it, expect } from 'vitest';
import {
  PROFILE_FIELD_REGISTRY,
  PROFILE_FIELD_SECTIONS,
  getFieldsBySection,
  getFieldById,
  getDateFields,
} from '../profile-field-registry';

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
