import { describe, it, expect } from 'vitest';
import {
  BAR_THEMES,
  DEFAULT_BAR_THEME,
  barFeather,
  barGround,
  barThemeById,
  resolveBarTheme,
} from './bar-themes';

describe('bar themes', () => {
  it('offers five candidates to choose between', () => {
    expect(BAR_THEMES).toHaveLength(5);
    expect(new Set(BAR_THEMES.map((theme) => theme.id)).size).toBe(5);
  });

  it('names a default that is one of them', () => {
    expect(BAR_THEMES.some((theme) => theme.id === DEFAULT_BAR_THEME)).toBe(true);
  });

  /** None of them may be a fifth red band under a claret window. */
  it('keeps every candidate off the red', () => {
    for (const theme of BAR_THEMES) {
      const [r, g, b] = theme.top;
      expect(r - Math.max(g, b)).toBeLessThan(18);
    }
  });

  it('picks a candidate by id', () => {
    expect(barThemeById('teal').id).toBe('teal');
  });

  /** A stale `?bar=` link must not blank the foot of the window. */
  it('falls back to the default for an unknown or missing id', () => {
    expect(barThemeById('chartreuse').id).toBe(DEFAULT_BAR_THEME);
    expect(barThemeById(null).id).toBe(DEFAULT_BAR_THEME);
    expect(resolveBarTheme('').id).toBe(DEFAULT_BAR_THEME);
  });

  it('reads the candidate off the query string', () => {
    expect(resolveBarTheme('?bar=espresso').id).toBe('espresso');
    expect(resolveBarTheme('?foo=1&bar=indigo').id).toBe('indigo');
  });

  it('grounds the bar in a near-opaque gradient it can blur through', () => {
    const ground = barGround(barThemeById('aubergine'));

    expect(ground).toContain('linear-gradient(180deg');
    expect(ground).toMatch(/rgba\(59, 42, 58, 0\.9\d\)/);
  });

  it('feathers the top edge out to fully transparent', () => {
    expect(barFeather(barThemeById('bronze'))).toContain('rgba(60, 53, 38, 0) 100%');
  });
});
