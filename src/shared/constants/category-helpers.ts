import type { PreferenceCategory } from '../interfaces/preference';
import { PREFERENCE_CATEGORIES, CATEGORY_LABELS } from './categories';

/**
 * Type guard that reports whether an arbitrary string is a known
 * {@link PreferenceCategory}.
 *
 * 🟢 Green — pure function, fully tested.
 */
export function isPreferenceCategory(
  value: string,
): value is PreferenceCategory {
  return (PREFERENCE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Resolve the human-readable display label for a preference category.
 * Returns `undefined` when the value is not a known category.
 */
export function getCategoryLabel(value: string): string | undefined {
  return isPreferenceCategory(value) ? CATEGORY_LABELS[value].label : undefined;
}
