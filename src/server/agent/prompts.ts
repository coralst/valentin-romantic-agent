import { PREFERENCE_CATEGORIES } from '../../shared/constants/categories';
import {
  PROFILE_FIELD_GUIDANCE,
  PROFILE_FIELD_IDS,
} from '../../shared/constants/profile-fields';

/** Valentin's system prompt — warm, sophisticated, curious personality */
export const VALENTIN_SYSTEM_PROMPT = `You are Valentin, a warm and sophisticated romantic concierge. Your purpose is to help users build a detailed profile of their spouse or partner's preferences through natural, engaging conversation.

Your primary goal is to fill out a complete partner profile. You must gather the following information in order before moving to free-form conversation:

1. Partner's name
2. Partner's age or birthday
3. Partner's gender

Once the basics are collected, transition naturally into discovering preferences across topics like food, hobbies, music, travel, gifts, love languages, important dates, and personality traits.

Personality traits:
- Warm and empathetic — you genuinely care about relationships
- Curious — you ask thoughtful follow-up questions to uncover deeper preferences
- Sophisticated — you speak with charm and elegance, but never pretentiously
- Encouraging — you celebrate the user's knowledge of their partner
- Discreet — you treat all shared information with care and respect

Conversation guidelines:
- Start by asking for the partner's name, then age/birthday, then gender
- After the basics, ask open-ended questions that naturally reveal preferences
- Match your response length to the moment — a quick or casual message gets a short, natural reply; a rich or open-ended one earns a fuller response
- Vary your rhythm — don't acknowledge-then-ask-a-follow-up on every single turn. Sometimes just react, sometimes just answer, sometimes ask
- Only ask a follow-up question when you genuinely need the detail; avoid interrogating the user
- When the user shares something meaningful, show you care, but keep it light and unforced
- Never be judgmental about any preferences shared
- If the user asks you a question, answer it directly and naturally
- If the user seems frustrated, apologize and address their concern

Remember: you're helping someone become a more thoughtful, attentive partner. Every detail matters.`;

/**
 * The `field` enum guidance, rendered as one line per field id.
 *
 * An enum tells the model *which* ids are legal; it does not tell it *when* each
 * one applies. Without this, "her birthday is in June" and "she's turning 32"
 * were emitted as two unrelated preferences.
 */
const FIELD_GUIDANCE_LINES = PROFILE_FIELD_IDS.map(
  (id) => `- ${id}: ${PROFILE_FIELD_GUIDANCE[id]}`,
).join('\n');

/**
 * Tool schema for Bedrock tool-use preference extraction.
 *
 * `field` is an ENUM over the canonical profile field ids, not a free-form
 * string. That is the whole point of this schema's shape: the previous version
 * asked the model for a prose `key` and the client then tried to string-match it
 * against a lookup table. The model is not obliged to guess the table's wording,
 * so real runs emitted keys like `birthday_month`, `age_turning`,
 * `salsa_dancing` and `pronouns` — every one of which resolved to `null` and was
 * dropped without a trace.
 *
 * `key` survives alongside it, deliberately, and is still free-form: not every
 * useful fact has a registry field. An allergy is the load-bearing example —
 * `KeepInMind.tsx` substring-matches keys like `shellfish_allergy` to raise a
 * caution, and there is no allergy field in the 18. So `field` is optional: set
 * it when the fact belongs to a profile field, omit it when the fact is real but
 * off-registry.
 */
export const EXTRACT_PREFERENCES_TOOL = {
  name: 'extract_preferences',
  description:
    'Extract spouse/partner preferences mentioned in the conversation message. Only extract preferences that are clearly stated or strongly implied.\n\n' +
    'For each preference, set "field" to the profile field it belongs to, choosing from this list:\n' +
    FIELD_GUIDANCE_LINES +
    '\n\nIf the fact is real but does not belong to any field above (an allergy, a dislike, something to avoid), omit "field" and give it a descriptive "key" instead.\n\n' +
    'Emit ONE preference per distinct fact. Never split a single fact across two preferences — ' +
    '"she\'s turning 32 in June" is one birthday preference with the value "June (turning 32)", not an age preference plus a month preference.',
  input_schema: {
    type: 'object',
    properties: {
      preferences: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: [...PREFERENCE_CATEGORIES],
              description: 'The preference category',
            },
            field: {
              type: 'string',
              enum: [...PROFILE_FIELD_IDS],
              description:
                'The profile field this preference fills. Omit ONLY if the fact belongs to no field in the list above.',
            },
            key: {
              type: 'string',
              description:
                'Short snake_case label for the preference. When "field" is set, use the same value as "field". When it is not, describe the fact (e.g. "shellfish_allergy").',
            },
            value: {
              type: 'string',
              description: 'The preference value as described by the user',
            },
            confidence: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              description:
                'How confident the extraction is (1.0 = explicitly stated, 0.5 = implied)',
            },
          },
          required: ['category', 'key', 'value', 'confidence'],
        },
      },
    },
    required: ['preferences'],
  },
} as const;
