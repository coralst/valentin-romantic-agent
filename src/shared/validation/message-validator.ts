import { PREFERENCE_CATEGORIES } from '../constants/categories';

/** Result of a validation check */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Rejects empty or whitespace-only message content */
export function validateMessageContent(content: string): ValidationResult {
  if (content.trim().length === 0) {
    return { valid: false, error: 'Message content must not be empty or whitespace-only' };
  }
  return { valid: true };
}

/** Validates a preference object has valid category, confidence, and non-empty key/value */
export function validatePreference(pref: unknown): ValidationResult {
  if (typeof pref !== 'object' || pref === null) {
    return { valid: false, error: 'Preference must be a non-null object' };
  }

  const obj = pref as Record<string, unknown>;

  if (typeof obj.category !== 'string' || !(PREFERENCE_CATEGORIES as readonly string[]).includes(obj.category)) {
    return { valid: false, error: `Invalid category: must be one of ${PREFERENCE_CATEGORIES.join(', ')}` };
  }

  if (typeof obj.confidence !== 'number' || obj.confidence < 0 || obj.confidence > 1) {
    return { valid: false, error: 'Confidence must be a number between 0 and 1' };
  }

  if (typeof obj.key !== 'string' || obj.key.trim().length === 0) {
    return { valid: false, error: 'Preference key must be a non-empty string' };
  }

  if (typeof obj.value !== 'string' || obj.value.trim().length === 0) {
    return { valid: false, error: 'Preference value must be a non-empty string' };
  }

  return { valid: true };
}

/** Validates a session ID is a non-empty string */
export function validateSessionId(id: string): ValidationResult {
  if (id.trim().length === 0) {
    return { valid: false, error: 'Session ID must be a non-empty string' };
  }
  return { valid: true };
}
