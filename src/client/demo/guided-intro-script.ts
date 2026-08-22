import type { ChatMessage } from '../../shared/interfaces/message';
import type {
  PreferenceCategory,
  PreferenceWithHistory,
} from '../../shared/interfaces/preference';
import type { ServerEvent } from '../../shared/interfaces/ws-events';

/**
 * The three beats of the guided introduction, and the machinery to replay them
 * without a backend.
 *
 * Why this exists: the intro's real path sends these same three prompts over the
 * live socket, and everything downstream — the typing indicator, the transcript,
 * the `LearnedChip`, the profile highlight flash, the architecture drawer — is
 * driven by `ServerEvent`s. So a backup that survives a dead backend does not
 * need a second rendering path; it needs the same events from a different
 * source. `dispatchServerEvent` in `use-websocket.ts` is an exported pure
 * function precisely so this module can reach it.
 *
 * The facts below are copied **verbatim** from `src/server/fixtures/demo-profile.ts`.
 * That is a hard requirement rather than tidiness: the intro ends by loading the
 * full 18-field profile, and a scripted value that disagreed with the seeded one
 * would visibly rewrite a field the audience just watched land.
 */

/** A fact the script claims Valentin extracted from a beat's prompt. */
export interface ScriptedFact {
  category: PreferenceCategory;
  /** Must match a `mappings` entry in `profile-field-registry.ts` verbatim. */
  key: string;
  value: string;
  confidence: number;
}

/** One question, one reply, and the facts that fall out of it. */
export interface IntroBeat {
  /** What the visitor is shown as having said. */
  prompt: string;
  /** Valentin's reply. */
  reply: string;
  /**
   * Facts extracted from this beat. Two on the opening beat and one after that:
   * the first beat has to prove that a single sentence can fill more than one
   * field, and the later beats are more legible with a single chip to watch.
   */
  facts: readonly ScriptedFact[];
}

export const GUIDED_INTRO_BEATS: readonly IntroBeat[] = [
  {
    prompt: "Her name is Samantha — Sam, to me.",
    reply:
      "Samantha. And Sam when it's just the two of you — I'll use that. Tell me something she'd never stop talking about.",
    facts: [
      { category: 'personality_traits', key: 'name', value: 'Samantha', confidence: 0.97 },
      { category: 'personality_traits', key: 'nickname', value: 'Sam', confidence: 0.91 },
    ],
  },
  {
    prompt:
      "Indie folk, the kind with close harmonies. She plays it while she works and hums the second part.",
    reply:
      "Close harmonies, and she takes the second part herself — that's a specific ear. Noted. When's her birthday?",
    facts: [
      {
        category: 'music',
        key: 'genre',
        value: 'Indie folk, the kind with close harmonies',
        confidence: 0.84,
      },
    ],
  },
  {
    prompt: "June 12th. And she's been saving for Kyoto in cherry blossom season for two years.",
    reply:
      "June 12th, and Kyoto in blossom season. Two years of saving makes that a plan, not a daydream — I'll keep it in view.",
    facts: [
      { category: 'important_dates', key: 'birthday', value: '1994-06-12', confidence: 0.95 },
      {
        category: 'travel',
        key: 'dream destination',
        value: 'Kyoto during cherry blossom season',
        confidence: 0.87,
      },
    ],
  },
];

/**
 * Time each beat occupies on the script's own clock, in ms.
 *
 * This is not a delay — playback timing belongs to `use-flow-playback`. It is
 * the width of the timestamp window a beat's events are laid out in, and it
 * exists because both `SEND_MESSAGE` and `RECEIVE_MESSAGE` re-sort the
 * transcript by timestamp. Beats stamped from a single instant would sort
 * arbitrarily, and the conversation would read out of order.
 */
export const BEAT_TIMESTAMP_SPAN_MS = 4000;

/** Plausible measured durations for the spans a beat fabricates. */
const SCRIPTED_BEDROCK_MS = 412;
const SCRIPTED_EXTRACTION_MS = 380;
const SCRIPTED_DYNAMO_MS = 18;

export interface BuildBeatOptions {
  sessionId: string;
  /** Index into `GUIDED_INTRO_BEATS`; separates beats on the timestamp clock. */
  beatIndex: number;
  /**
   * Epoch ms the intro started at. Passed in rather than read from `Date.now()`
   * so a caller can anchor the script after whatever is already in the
   * transcript — the welcome message is stamped before the first beat.
   */
  startedAtMs: number;
}

export interface BuiltBeat {
  /**
   * The visitor's turn. Dispatched with `SEND_MESSAGE`, because a user message
   * is not something the server sends back — there is no `ServerEvent` for it.
   */
  userMessage: ChatMessage;
  /**
   * Everything the server would have sent, in order, ending with `typing_stop`.
   * Feed each through `dispatchServerEvent` and `publishInboundWsEvent`.
   */
  events: readonly ServerEvent[];
}

/**
 * Synthesise one beat's traffic.
 *
 * Pure: no clock, no randomness, no module state. The same options give the same
 * events, which is what lets a presenter step backwards and see exactly the
 * transcript they saw before.
 */
export function buildBeatEvents(beat: IntroBeat, options: BuildBeatOptions): BuiltBeat {
  const { sessionId, beatIndex, startedAtMs } = options;
  const base = startedAtMs + beatIndex * BEAT_TIMESTAMP_SPAN_MS;
  const at = (offsetMs: number): string => new Date(base + offsetMs).toISOString();

  // Ids are derived from the beat index, not generated. A regenerated id on a
  // backward step would append a duplicate message instead of replacing one.
  const userMessage: ChatMessage = {
    id: `intro-${beatIndex}-user`,
    sessionId,
    sender: 'user',
    content: beat.prompt,
    timestamp: at(0),
  };

  const agentMessage: ChatMessage = {
    id: `intro-${beatIndex}-agent`,
    sessionId,
    sender: 'agent',
    content: beat.reply,
    timestamp: at(1200),
  };

  const events: ServerEvent[] = [
    { type: 'typing_start', payload: { sessionId }, timestamp: at(100) },
    {
      type: 'aws_span',
      payload: {
        sessionId,
        resourceId: 'bedrock',
        service: 'Amazon Bedrock',
        resourceName: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
        operation: 'Converse',
        durationMs: SCRIPTED_BEDROCK_MS,
        ok: true,
        detail: 'chat-reply',
      },
      timestamp: at(1100),
    },
    { type: 'agent_message', payload: { message: agentMessage }, timestamp: at(1200) },
    {
      type: 'aws_span',
      payload: {
        sessionId,
        resourceId: 'bedrock',
        service: 'Amazon Bedrock',
        resourceName: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
        operation: 'Converse',
        durationMs: SCRIPTED_EXTRACTION_MS,
        ok: true,
        detail: 'extract-preferences',
      },
      timestamp: at(1600),
    },
  ];

  beat.facts.forEach((fact, factIndex) => {
    const offset = 1800 + factIndex * 300;
    events.push({
      type: 'preference_update',
      payload: {
        preference: scriptedPreference(fact, {
          sessionId,
          id: `intro-${beatIndex}-${fact.category}-${fact.key}`,
          sourceMessageId: userMessage.id,
          atIso: at(offset),
        }),
        // Always new: the intro starts from the empty `fresh` persona, and each
        // beat introduces a field no earlier beat touched.
        isNew: true,
      },
      timestamp: at(offset),
    });

    events.push({
      type: 'aws_span',
      payload: {
        sessionId,
        resourceId: 'dynamodb',
        service: 'Amazon DynamoDB',
        resourceName: 'ValentinTable-dev',
        operation: 'PutItem',
        durationMs: SCRIPTED_DYNAMO_MS,
        ok: true,
        // Category only. This is projected in front of a room, and the values
        // belong to a person — even a fictional one sets the habit.
        detail: `PREF#${fact.category}`,
      },
      timestamp: at(offset + 60),
    });
  });

  events.push({ type: 'typing_stop', payload: { sessionId }, timestamp: at(3000) });

  return { userMessage, events };
}

function scriptedPreference(
  fact: ScriptedFact,
  meta: { sessionId: string; id: string; sourceMessageId: string; atIso: string },
): PreferenceWithHistory {
  return {
    id: meta.id,
    sessionId: meta.sessionId,
    category: fact.category,
    key: fact.key,
    value: fact.value,
    confidence: fact.confidence,
    sourceMessageId: meta.sourceMessageId,
    createdAt: meta.atIso,
    updatedAt: meta.atIso,
    // No `fieldId`: the client resolves `category` + `key` through
    // `resolveField`, which is the same route seeded demo rows take. Inventing a
    // field id here would let the script drift from the registry unnoticed.
    history: [],
  };
}
