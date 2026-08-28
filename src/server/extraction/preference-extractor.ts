import { randomUUID } from 'crypto';
import type { ChatMessage } from '../../shared/interfaces/message';
import { DEFAULT_GENERATION, isPersonGeneration } from '../../shared/interfaces/person';
import type { Person } from '../../shared/interfaces/person';
import type { Task } from '../../shared/interfaces/task';
import type { PreferenceWithHistory } from '../../shared/interfaces/preference';
import type { StorageInterface, ExtractedPreference } from '../persistence/storage-interface';
import type { BedrockClient } from '../agent/bedrock-client';
import { EXTRACT_PREFERENCES_TOOL } from '../agent/prompts';
import { ExtractionError } from '../../shared/errors/extraction-error';
import { mapCategory } from './category-mapper';
import { isPartnerNamePreference } from './partner-name';
import { isProfileFieldId } from '../../shared/constants/profile-fields';

/** Callback invoked when a preference is persisted */
export type OnPreferenceUpdate = (
  preference: PreferenceWithHistory,
  isNew: boolean,
) => void;

/**
 * What the extractor tells the outside world it learned.
 *
 * An object rather than three positional callbacks: two of the three are new, and
 * a constructor with three optional function parameters is the shape where an
 * argument eventually gets passed in the wrong slot. Every field is optional
 * because extraction must work with nobody listening — `DemoLoginService` seeds
 * through the same graph with no socket attached.
 */
export interface ExtractionListeners {
  onPreference?: OnPreferenceUpdate;
  /** Someone in her life, learned from the turn. */
  onPerson?: (sessionId: string, person: Person, isNew: boolean) => void;
  /** Something he said he would do, learned from the turn. */
  onTask?: (sessionId: string, task: Task, isNew: boolean) => void;
}

/** Interface for the preference extraction pipeline */
export interface PreferenceExtractorInterface {
  extract(message: ChatMessage, history: ChatMessage[]): Promise<void>;
}

/** Raw person shape returned by the Bedrock tool-use call */
interface RawExtractedPerson {
  /** Absent when the message named a relative without naming them. */
  name?: string;
  relationship?: string;
  generation?: string;
  birthday?: string;
  note?: string;
}

/** Raw task shape returned by the Bedrock tool-use call */
interface RawExtractedTask {
  title?: string;
  due?: string;
  note?: string;
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

/** Longest a name, relationship, title or note may be, in characters */
const TEXT_LIMIT = 200;

/** Trim, cap, and collapse blank to null — the same rule the HTTP routes use. */
function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, TEXT_LIMIT) : null;
}

/** An ISO date, or null. Never a guess: a bad date is worse than no date. */
function cleanDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

/** Case- and space-insensitive, for matching a restated fact to a stored one. */
function normalise(value: string | null): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * What to do with a freshly extracted person: update someone, add someone, or
 * neither.
 *
 * `ambiguous` is the third answer and the one that makes this a type instead of a
 * `Person | undefined`. "Her sister is coming Tuesday", when two named sisters are
 * already on the tree, identifies neither of them — and both of the obvious
 * fallbacks are wrong. Writing a new unnamed "Sister?" card puts a gap on the
 * board next to two people who fill it, and picking the first sister invents a
 * fact. Doing nothing loses nothing: her having a sister is already recorded.
 */
export type PersonMatch =
  | { kind: 'update'; person: Person }
  | { kind: 'insert' }
  | { kind: 'ambiguous' };

/**
 * Decide which stored person a freshly extracted one is.
 *
 * Named candidate:
 * 1. Same name — "Nadia" said twice is one sister, however differently the
 *    relationship was phrased the second time.
 * 2. Otherwise, a person on the same relationship whom we could not name: this is
 *    how "her brother" followed later by "her brother Tom" fills the gap in place
 *    instead of drawing a second brother beside it. Filling a gap is the single
 *    most likely edit this feature will ever see, so it happens by itself.
 * 3. Otherwise a new person. She is allowed two sisters, and merging Talia into
 *    Nadia because both are "her sister" would delete one of them.
 *
 * Unnamed candidate: the sole holder of that relationship, whether or not we know
 * their name — and `ambiguous` when there is more than one.
 */
export function matchPerson(
  existing: readonly Person[],
  candidate: { name: string | null; relationship: string },
): PersonMatch {
  const name = normalise(candidate.name);
  const relationship = normalise(candidate.relationship);
  const sameRelationship = existing.filter(
    (person) => normalise(person.relationship) === relationship,
  );

  if (!name) {
    if (sameRelationship.length === 1) {
      return { kind: 'update', person: sameRelationship[0] };
    }
    return sameRelationship.length === 0
      ? { kind: 'insert' }
      : { kind: 'ambiguous' };
  }

  const byName = existing.find((person) => normalise(person.name) === name);
  if (byName) return { kind: 'update', person: byName };

  const gap = sameRelationship.find((person) => normalise(person.name) === '');
  return gap ? { kind: 'update', person: gap } : { kind: 'insert' };
}

/** Extracts structured preferences from conversation messages via Bedrock tool-use */
export class PreferenceExtractor implements PreferenceExtractorInterface {
  constructor(
    private readonly bedrockClient: BedrockClient,
    private readonly storage: StorageInterface,
    private readonly listeners: ExtractionListeners | null,
  ) {}

  async extract(
    message: ChatMessage,
    history: ChatMessage[],
  ): Promise<void> {
    let rawPreferences: RawExtractedPreference[];
    let rawPeople: RawExtractedPerson[];
    let rawTasks: RawExtractedTask[];

    try {
      const toolResponse = await this.bedrockClient.extractWithTool(
        message,
        history,
        EXTRACT_PREFERENCES_TOOL,
      );

      const input = toolResponse.input as {
        preferences?: RawExtractedPreference[];
        people?: RawExtractedPerson[];
        tasks?: RawExtractedTask[];
      };
      rawPreferences = input.preferences ?? [];
      // Absent on most turns, and absent entirely from a stubbed tool response
      // that predates these arrays — hence `?? []` rather than a required field.
      rawPeople = Array.isArray(input.people) ? input.people : [];
      rawTasks = Array.isArray(input.tasks) ? input.tasks : [];
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

    // Sequential, and after the preferences, for a reason: both processors read
    // the session's current people or tasks to decide whether this is the same
    // relative restated. Run concurrently, two mentions of "her brother" in one
    // turn would both read the empty list and both insert.
    for (const raw of rawPeople) {
      try {
        await this.processPerson(raw, message);
      } catch (err) {
        this.reportFailure(
          `Failed to process person "${raw.name ?? raw.relationship ?? '?'}"`,
          message,
          err,
        );
      }
    }

    for (const raw of rawTasks) {
      try {
        await this.processTask(raw, message);
      } catch (err) {
        this.reportFailure(
          `Failed to process task "${raw.title ?? '?'}"`,
          message,
          err,
        );
      }
    }
  }

  /**
   * Log one failed item and carry on.
   *
   * Same discipline the preference loop has always had: one unusable entry must
   * not cost the rest of the turn, and extraction must never surface to the
   * person having the conversation.
   */
  private reportFailure(
    summary: string,
    message: ChatMessage,
    err: unknown,
  ): void {
    const wrapped = new ExtractionError(summary, {
      messageId: message.id,
      sessionId: message.sessionId,
      cause: err instanceof Error ? err.message : String(err),
    });
    console.error(`[preference-extractor] ${wrapped.message}`, wrapped.context);
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
      // Update existing preference — triggers history tracking.
      // Addressed by natural key, which findPreference above was already given,
      // so this needs no extra lookup.
      result = await this.storage.updatePreference(
        {
          sessionId: message.sessionId,
          category: validated.category,
          key: validated.key,
        },
        {
          value: validated.value,
          confidence: validated.confidence,
          sourceMessageId: message.id,
        },
      );
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

    // Denormalise the partner's name onto the session so the sidebar can label
    // the conversation without fetching its whole profile. Nothing else ever
    // writes this field — PartnerProfilePanel derives the name live for display
    // and never writes back, which is why SessionEntry has always fallen through
    // to "New conversation".
    if (isPartnerNamePreference(validated.category, validated.key)) {
      await this.storage.updateSessionMeta(message.sessionId, {
        partnerName: validated.value,
      });
    }

    // Notify listeners
    this.listeners?.onPreference?.(result, isNew);
  }

  /**
   * Persist one person the turn revealed.
   *
   * `relationship` is the only required field, because it is the only one that
   * makes the record worth keeping: "her brother" with no name is a card worth
   * drawing, and a name with no relationship is a word.
   */
  private async processPerson(
    raw: RawExtractedPerson,
    message: ChatMessage,
  ): Promise<void> {
    const relationship = cleanText(raw.relationship);
    if (!relationship) return;

    const name = cleanText(raw.name);
    // An unrecognised rung falls back rather than dropping the person: which row
    // she is drawn on is a detail, and losing an entire relative over a bad enum
    // value is not.
    const generation = isPersonGeneration(raw.generation)
      ? raw.generation
      : DEFAULT_GENERATION;
    if (raw.generation && !isPersonGeneration(raw.generation)) {
      console.warn(
        `[preference-extractor] unknown generation "${raw.generation}" for ` +
          `"${relationship}" — filing on the ${DEFAULT_GENERATION} rung`,
      );
    }

    const existing = await this.storage.getPeopleBySession(message.sessionId);
    const outcome = matchPerson(existing, { name, relationship });
    if (outcome.kind === 'ambiguous') {
      console.warn(
        `[preference-extractor] "${relationship}" matches more than one person ` +
          'and the turn named nobody — leaving the tree alone',
      );
      return;
    }
    const match = outcome.kind === 'update' ? outcome.person : undefined;

    const person: Person = {
      id: match?.id ?? randomUUID(),
      // A gap that has just been named keeps its new name; a person restated
      // without their name keeps the one we already had, because "her sister
      // said..." is not an instruction to forget she is Nadia.
      name: name ?? match?.name ?? null,
      relationship,
      generation,
      birthday: cleanDate(raw.birthday) ?? match?.birthday ?? null,
      note: cleanText(raw.note) ?? match?.note ?? null,
      // Even when it updates a row the user typed by hand: this write came out of
      // a conversation, and that is what the badge on the card reports.
      source: 'discovered',
      updatedAt: new Date().toISOString(),
    };

    const saved = await this.storage.savePerson(message.sessionId, person);
    this.listeners?.onPerson?.(message.sessionId, saved, !match);
  }

  /**
   * Persist one thing he said he would do.
   *
   * Matched on the title, so restating the same intention next turn updates the
   * row rather than adding a second one — a to-do list that grows a duplicate
   * every time he mentions the booking is a list he stops reading.
   *
   * `done` is never set from here. Ticking is his act, and a model that decided a
   * task was finished because he talked about it would erase the one piece of
   * state on this board that only he can write.
   */
  private async processTask(
    raw: RawExtractedTask,
    message: ChatMessage,
  ): Promise<void> {
    const title = cleanText(raw.title);
    if (!title) return;

    const existing = await this.storage.getTasksBySession(message.sessionId);
    const match = existing.find((task) => normalise(task.title) === normalise(title));

    const now = new Date().toISOString();
    const task: Task = {
      id: match?.id ?? randomUUID(),
      title,
      due: cleanDate(raw.due) ?? match?.due ?? null,
      note: cleanText(raw.note) ?? match?.note ?? null,
      done: match?.done ?? false,
      source: 'discovered',
      createdAt: match?.createdAt ?? now,
      updatedAt: now,
    };

    const saved = await this.storage.saveTask(message.sessionId, task);
    this.listeners?.onTask?.(message.sessionId, saved, !match);
  }
}
