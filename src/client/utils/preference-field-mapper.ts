import type { PreferenceCategory } from '../../shared/interfaces/preference';
import { PROFILE_FIELD_REGISTRY } from './profile-field-registry';

/** Lazy-initialized lookup map from "category:key" to fieldId */
let lookupMap: Map<string, string> | null = null;

/** Build the lookup map from registry mappings */
function buildLookupMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const field of PROFILE_FIELD_REGISTRY) {
    for (const mapping of field.mappings) {
      const key = `${mapping.category}:${mapping.key.toLowerCase()}`;
      map.set(key, field.id);
    }
  }
  return map;
}

/** Get or create the lookup map */
function getLookupMap(): Map<string, string> {
  if (!lookupMap) {
    lookupMap = buildLookupMap();
  }
  return lookupMap;
}

/**
 * Resolve a preference category+key to a profile field identifier.
 * Returns null if no mapping exists in the registry.
 */
export function resolveField(category: PreferenceCategory, key: string): string | null {
  const map = getLookupMap();
  const normalizedKey = `${category}:${key.toLowerCase()}`;
  return map.get(normalizedKey) ?? null;
}

/**
 * Reset the lookup map (useful for testing when registry changes).
 */
export function resetMapper(): void {
  lookupMap = null;
}
