import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { colors, typography, spacing, animation, borderRadius, shadows, breakpoints } from './tokens';

// --- 5.3: Unit tests for design tokens ---

describe('design tokens', () => {
  it('exports all expected token groups', () => {
    expect(colors).toBeDefined();
    expect(typography).toBeDefined();
    expect(spacing).toBeDefined();
    expect(animation).toBeDefined();
    expect(borderRadius).toBeDefined();
    expect(shadows).toBeDefined();
    expect(breakpoints).toBeDefined();
  });

  it('all color tokens are valid hex or CSS color values', () => {
    const hexOrCssColor = /^#[0-9A-Fa-f]{3,8}$|^rgb|^hsl|^[a-z]+$/;
    for (const [key, value] of Object.entries(colors)) {
      expect(value, `colors.${key} should be a valid color`).toMatch(hexOrCssColor);
    }
  });

  it('typography defines serif heading and sans-serif body font families', () => {
    expect(typography.headingFontFamily).toContain('serif');
    expect(typography.bodyFontFamily).toContain('sans-serif');
  });

  it('spacing tokens follow 8px grid', () => {
    for (const [key, value] of Object.entries(spacing)) {
      expect(value % 8, `spacing.${key} should be a multiple of 8`).toBe(0);
    }
  });

  it('animation durations are between 200ms and 400ms', () => {
    for (const [key, value] of Object.entries(animation.durations)) {
      expect(value, `animation.durations.${key}`).toBeGreaterThanOrEqual(200);
      expect(value, `animation.durations.${key}`).toBeLessThanOrEqual(400);
    }
  });

  it('breakpoints defines mobile threshold', () => {
    expect(breakpoints.mobile).toBe(768);
  });

  it('colors includes semantic tokens', () => {
    expect(colors.agentBubble).toBeDefined();
    expect(colors.userBubble).toBeDefined();
    expect(colors.background).toBeDefined();
    expect(colors.text).toBeDefined();
    expect(colors.border).toBeDefined();
    expect(colors.highlight).toBeDefined();
  });
});

// --- 5.4: Property test — Design token constraints (Property 11) ---
// Feature: valentin-romantic-agent, Property 11: Design token constraints
// **Validates: Requirements 5.3, 5.7**

describe('Property 11: Design token constraints', () => {
  const spacingEntries = Object.entries(spacing) as [string, number][];
  const durationEntries = Object.entries(animation.durations) as [string, number][];

  it('for any spacing token, its numeric value is a positive multiple of 8', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...spacingEntries),
        ([key, value]) => {
          expect(value, `spacing.${key} must be positive`).toBeGreaterThan(0);
          expect(value % 8, `spacing.${key} must be a multiple of 8`).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for any animation duration token, its value is between 200ms and 400ms inclusive', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...durationEntries),
        ([key, value]) => {
          expect(value, `animation.durations.${key} >= 200`).toBeGreaterThanOrEqual(200);
          expect(value, `animation.durations.${key} <= 400`).toBeLessThanOrEqual(400);
        },
      ),
      { numRuns: 100 },
    );
  });
});
