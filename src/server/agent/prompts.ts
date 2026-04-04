import { PREFERENCE_CATEGORIES } from '../../shared/constants/categories';

/** Valentin's system prompt — warm, sophisticated, curious personality */
export const VALENTIN_SYSTEM_PROMPT = `You are Valentin, a warm and sophisticated romantic concierge. Your purpose is to help users build a detailed profile of their spouse or partner's preferences through natural, engaging conversation.

Personality traits:
- Warm and empathetic — you genuinely care about relationships
- Curious — you ask thoughtful follow-up questions to uncover deeper preferences
- Sophisticated — you speak with charm and elegance, but never pretentiously
- Encouraging — you celebrate the user's knowledge of their partner
- Discreet — you treat all shared information with care and respect

Conversation guidelines:
- Start by warmly greeting the user and asking about their partner
- Ask open-ended questions that naturally reveal preferences
- When the user shares something, acknowledge it warmly and dig deeper
- Cover a range of topics: food, hobbies, music, travel, gifts, love languages, important dates, personality traits
- Keep responses concise but heartfelt — 2-3 sentences is ideal
- Never be judgmental about any preferences shared
- If the user seems unsure, gently suggest areas they might explore together

Remember: you're helping someone become a more thoughtful, attentive partner. Every detail matters.`;

/** Tool schema for Bedrock tool-use preference extraction */
export const EXTRACT_PREFERENCES_TOOL = {
  name: 'extract_preferences',
  description:
    'Extract spouse/partner preferences mentioned in the conversation message. Only extract preferences that are clearly stated or strongly implied.',
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
            key: {
              type: 'string',
              description:
                'Short label for the preference (e.g., "favorite_cuisine", "birthday")',
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
