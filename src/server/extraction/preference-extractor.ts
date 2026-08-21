import type { ChatMessage } from '../../shared/interfaces/message';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import type { StorageInterface, ExtractedPreference } from '../persistence/storage-interface';
import type { BedrockClient } from '../agent/bedrock-client';
import { EXTRACT_PREFERENCES_TOOL } from '../agent/prompts';
import { ExtractionError } from '../../shared/errors/extraction-error';
import { mapCategory } from './category-mapper';
import { isProfileFieldId } from '../../shared/constants/profile-fields';

/** Callback invoked when a preference is persisted */
export type OnPreferenceUpdate = (
  preference: PreferenceWithHistory,
  isNew: boolean,
) => void;

/** Interface for the preference extraction pipeline */
export interface PreferenceExtractorInterface {
  extract(message: ChatMessage, history: ChatMessage[]): Promise<void>;
}

/** Raw preference shape returned by the Bedrock tool-use call */
interface RawExtractedPreference {
  category: string;
  /** Constrained profile field id, or absent for an off-registry fact. */
  field?: string;
  key: string;
  value: string;
  confidence: number;
}

/**
 * Collapse preferences that the model split across two entries.
 *
 * Even with an explicit "one preference per fact" instruction, "she's turning 32
 * in June" is a standing temptation to emit an age and a month separately. Both
 * now carry `field: 'birthday'`, so a same-field collision within one extraction
 * batch is the signal: keep one entry and join the values rather than letting the
 * second silently overwrite the first.
 *
 * Only entries with a resolved `field` are merged. Off-registry facts are keyed
 * by prose, and two of those are genuinely two facts.
 */
export function mergeSplitFacts(
  raw: RawExtractedPreference[],
): RawExtractedPreference[] {
  const byField = new Map<string, RawExtractedPreference>();
  const passthrough: RawExtractedPreference[] = [];

  for (const pref of raw) {
    const field = pref.field?.trim();
    if (!field || !isProfileFieldId(field)) {
      passthrough.push(pref);
      continue;
    }

    const existing = byField.get(field);
    if (!existing) {
      byField.set(field, { ...pref });
      continue;
    }

    // Same field twice in one batch — two halves of one fact.
    const a = existing.value.trim();
    const b = pref.value.trim();

    // If one phrasing already contains the other, the longer one wins outright.
    if (a.toLowerCase().includes(b.toLowerCase())) {
      existing.confidence = Math.min(existing.confidence, pref.confidence);
      continue;
    }
    if (b.toLowerCase().includes(a.toLowerCase())) {
      existing.value = b;
      existing.confidence = Math.min(existing.confidence, pref.confidence);
      continue;
    }

    // Genuinely complementary halves: "June" + "32" -> "June (32)".
    const [longer, shorter] = a.length >= b.length ? [a, b] : [b, a];
    existing.value = `${longer} (${shorter})`;
    existing.confidence = Math.min(existing.confidence, pref.confidence);
    console.warn(
      `[preference-extractor] merged split fact for field "${field}": ` +
        `"${a}" + "${b}" -> "${existing.value}"`,
    );
  }

  return [...byField.values(), ...passthrough];
}

/** Extracts structured preferences from conversation messages via Bedrock tool-use */
export class PreferenceExtractor implements PreferenceExtractorInterface {
  constructor(
    private readonly bedrockClient: BedrockClient,
    private readonly storage: StorageInterface,
    private readonly onPreferenceUpdate: OnPreferenceUpdate | null,
  ) {}

  async extract(
    message: ChatMessage,
    history: ChatMessage[],
  ): Promise<void> {
    let rawPreferences: RawExtractedPreference[];

    try {
      const toolResponse = await this.bedrockClient.extractWithTool(
        message,
        history,
        EXTRACT_PREFERENCES_TOOL,
      );

      const input = toolResponse.input as {
        preferences?: RawExtractedPreference[];
      };
      rawPreferences = input.preferences ?? [];
    } catch (err) {
      console.error(
        `[preference-extractor] Extraction failed for message ${message.id}:`,
        err instanceof Error ? err.message : String(err),
      );
      // Never throw to caller — extraction failures must not interrupt conversation
      return;
    }

    for (const raw of mergeSplitFacts(rawPreferences)) {
      try {
        await this.processPreference(raw, message);
      } catch (err) {
        const wrapped = new ExtractionError(
          `Failed to process preference "${raw.key}"`,
          {
            messageId: message.id,
            sessionId: message.sessionId,
            category: raw.category,
            key: raw.key,
            cause: err instanceof Error ? err.message : String(err),
          },
        );
        console.error(
          `[preference-extractor] ${wrapped.message}`,
          wrapped.context,
        );
        // Continue processing remaining preferences
      }
    }
  }

  private async processPreference(
    raw: RawExtractedPreference,
    message: ChatMessage,
  ): Promise<void> {
    // Map and validate category
    const category = mapCategory(raw.category);
    if (!category) return;

    // Validate confidence
    const confidence = Math.max(0, Math.min(1, raw.confidence));

    // Validate the model's field id against the canonical set. An unrecognised
    // id is dropped to null rather than trusted — the client then falls back to
    // resolving category+key, and the dev-only warning there makes it visible.
    const rawField = raw.field?.trim();
    let fieldId: string | null = null;
    if (rawField) {
      if (isProfileFieldId(rawField)) {
        fieldId = rawField;
      } else {
        console.warn(
          `[preference-extractor] unknown field id "${rawField}" for ` +
            `${raw.category}:${raw.key} — falling back to key resolution`,
        );
      }
    }

    // Validate key/value
    if (!raw.key?.trim() || !raw.value?.trim()) return;

    const validated: ExtractedPreference = {
      category,
      // When the model identified a profile field, the field id IS the key. That
      // keeps `findPreference` stable across turns: the same fact restated in
      // different words updates one row instead of accumulating near-duplicates
      // under `birthday_month`, `age_turning`, `birthday`, ...
      key: fieldId ?? raw.key.trim(),
      fieldId,
      value: raw.value.trim(),
      confidence,
    };

    // Check for existing preference (same session + category + key)
    const existing = await this.storage.findPreference(
      message.sessionId,
      validated.category,
      validated.key,
    );

    let result: PreferenceWithHistory;
    let isNew: boolean;

    if (existing) {
      // Update existing preference — triggers history tracking
      result = await this.storage.updatePreference(existing.id, {
        value: validated.value,
        confidence: validated.confidence,
        sourceMessageId: message.id,
      });
      isNew = false;
    } else {
      // Create new preference
      result = await this.storage.savePreference({
        sessionId: message.sessionId,
        category: validated.category,
        key: validated.key,
        fieldId: validated.fieldId ?? null,
        value: validated.value,
        confidence: validated.confidence,
        sourceMessageId: message.id,
      });
      isNew = true;
    }

    // Notify listeners
    if (this.onPreferenceUpdate) {
      this.onPreferenceUpdate(result, isNew);
    }
  }
}
