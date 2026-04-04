import type { ChatMessage } from '../../shared/interfaces/message';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import type { StorageInterface, ExtractedPreference } from '../persistence/storage-interface';
import type { BedrockClient } from '../agent/bedrock-client';
import { EXTRACT_PREFERENCES_TOOL } from '../agent/prompts';
import { ExtractionError } from '../../shared/errors/extraction-error';
import { mapCategory } from './category-mapper';

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
  key: string;
  value: string;
  confidence: number;
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

    for (const raw of rawPreferences) {
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

    // Validate key/value
    if (!raw.key?.trim() || !raw.value?.trim()) return;

    const validated: ExtractedPreference = {
      category,
      key: raw.key.trim(),
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
