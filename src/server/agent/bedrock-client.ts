import type { ChatMessage } from '../../shared/interfaces/message';
import { LlmError } from '../../shared/errors/llm-error';

/** Schema definition for a Bedrock tool-use call */
export interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Response from a standard Bedrock conversation call */
export interface LlmResponse {
  content: string;
}

/** Response from a Bedrock tool-use call */
export interface ToolUseResponse {
  toolName: string;
  input: Record<string, unknown>;
}

/** Abstract interface for LLM interactions — implementations can be real Bedrock SDK or stubs */
export interface BedrockClient {
  /** Generate a conversational response given message history and system prompt */
  generateResponse(
    messages: ChatMessage[],
    systemPrompt: string,
  ): Promise<LlmResponse>;

  /** Call the LLM with a tool-use schema and return structured output */
  extractWithTool(
    message: ChatMessage,
    history: ChatMessage[],
    toolSchema: ToolSchema,
  ): Promise<ToolUseResponse>;
}

// TODO(yellow): integrate real AWS Bedrock SDK — replace this stub with actual SDK calls

/** Keyword-to-response rules for the stub — each rule matches content and produces a contextual reply */
interface StubRule {
  keywords: string[];
  responses: string[];
}

const STUB_RULES: StubRule[] = [
  {
    keywords: ['food', 'eat', 'cook', 'restaurant', 'cuisine', 'dinner', 'lunch', 'breakfast', 'meal', 'recipe', 'chef', 'kitchen'],
    responses: [
      "A foodie at heart! What kind of cuisine makes their eyes light up? Italian, Japanese, something more adventurous?",
      "That's a lovely detail to know. Do they prefer cooking at home or going out to discover new restaurants?",
      "Food says so much about a person. Is there a particular dish that holds special meaning for them?",
    ],
  },
  {
    keywords: ['music', 'song', 'band', 'concert', 'sing', 'playlist', 'album', 'guitar', 'piano', 'jazz', 'rock', 'classical'],
    responses: [
      "Music is such a window into the soul. Do they have a go-to artist or a song that always makes them smile?",
      "I love that! Is music something they enjoy passively, or do they play an instrument or sing?",
      "There's something beautiful about knowing someone's musical taste. What genre do they gravitate toward most?",
    ],
  },
  {
    keywords: ['travel', 'trip', 'vacation', 'beach', 'mountain', 'city', 'country', 'fly', 'explore', 'adventure', 'destination'],
    responses: [
      "A traveler! Are they more of a beach-and-relax type, or do they love exploring cities and culture?",
      "That's wonderful. Is there a dream destination they've always talked about visiting?",
      "Travel memories are so special. Do they prefer planned itineraries or spontaneous adventures?",
    ],
  },
  {
    keywords: ['book', 'read', 'novel', 'author', 'story', 'fiction', 'library', 'literature'],
    responses: [
      "A reader — that's lovely. Do they lean toward fiction, non-fiction, or maybe poetry?",
      "Books reveal so much about what someone values. Do they have a favorite author or a book they always recommend?",
      "I'd love to know more about their reading taste. What kind of stories captivate them?",
    ],
  },
  {
    keywords: ['movie', 'film', 'watch', 'show', 'series', 'cinema', 'tv', 'netflix', 'theater'],
    responses: [
      "Movie nights are the best. Are they into dramas, comedies, thrillers, or maybe documentaries?",
      "That's a great detail! Do they have a comfort movie they could watch over and over?",
      "I love knowing this. Are they more of a binge-a-series person or a classic film enthusiast?",
    ],
  },
  {
    keywords: ['sport', 'exercise', 'gym', 'run', 'yoga', 'hike', 'swim', 'fitness', 'workout', 'soccer', 'football', 'basketball', 'tennis'],
    responses: [
      "Active and energetic! Do they prefer team sports, solo workouts, or outdoor activities?",
      "That's great to know. Is fitness a daily ritual for them, or more of a weekend thing?",
      "I can picture it! Do they have a favorite sport to play or one they love watching?",
    ],
  },
  {
    keywords: ['flower', 'garden', 'plant', 'rose', 'nature', 'outdoor', 'park'],
    responses: [
      "Someone who appreciates nature — that's beautiful. Do they have a favorite flower or plant?",
      "A garden lover! Do they enjoy growing things themselves, or more about being surrounded by nature?",
      "That's such a thoughtful detail. Is there a particular season or outdoor setting they love most?",
    ],
  },
  {
    keywords: ['gift', 'present', 'surprise', 'birthday', 'anniversary', 'celebrate', 'special'],
    responses: [
      "Knowing what makes a great gift is so valuable. Are they more into experiences or physical presents?",
      "That's helpful! Do they prefer surprises, or do they like being involved in planning celebrations?",
      "Special occasions matter. Is there an upcoming date I should help you prepare for?",
    ],
  },
  {
    keywords: ['color', 'favourite', 'favorite', 'prefer', 'like', 'love', 'enjoy', 'passion', 'hobby', 'interest'],
    responses: [
      "Those little preferences paint such a vivid picture. What else brings them joy in their day-to-day?",
      "I'm building a lovely picture of your partner. What other passions or hobbies light them up?",
      "Every detail helps me understand them better. Is there something they're particularly passionate about right now?",
    ],
  },
  {
    keywords: ['pet', 'dog', 'cat', 'animal', 'puppy', 'kitten'],
    responses: [
      "An animal lover — that says so much about their warmth. What kind of pets do they adore?",
      "Pets bring so much joy. Do they have a furry companion, or is it more of a dream for them?",
      "That's adorable. Are they a dog person, a cat person, or do they love all creatures equally?",
    ],
  },
];

const FALLBACK_RESPONSES = [
  "That's a lovely detail about your partner. What else can you tell me about what makes them special?",
  "I appreciate you sharing that. What other interests or quirks does your partner have?",
  "Every little thing you share helps paint a richer picture. What else comes to mind about them?",
  "Thank you for telling me that. Is there something your partner is particularly passionate about?",
  "That's really sweet. What's something your partner does that always makes you smile?",
  "I'm getting a wonderful sense of who they are. What else would you like me to remember about them?",
];

/** Pick a deterministic-but-varied response based on message content */
function pickResponse(responses: string[], content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
  }
  return responses[Math.abs(hash) % responses.length];
}

/** Find the best matching rule for a message, or return null for fallback */
function matchRule(content: string): StubRule | null {
  const lower = content.toLowerCase();
  let bestRule: StubRule | null = null;
  let bestCount = 0;

  for (const rule of STUB_RULES) {
    const matchCount = rule.keywords.filter((kw) => lower.includes(kw)).length;
    if (matchCount > bestCount) {
      bestCount = matchCount;
      bestRule = rule;
    }
  }

  return bestRule;
}

/** Stub Bedrock client that returns contextual responses for local development */
export class StubBedrockClient implements BedrockClient {
  async generateResponse(
    messages: ChatMessage[],
    _systemPrompt: string,
  ): Promise<LlmResponse> {
    const lastUserMessage = [...messages].reverse().find((m) => m.sender === 'user');

    if (!lastUserMessage) {
      return {
        content: "Hello! I'm Valentin, your romantic concierge. Tell me about your special someone, and I'll help you remember every little detail that makes them unique.",
      };
    }

    const userContent = lastUserMessage.content;
    const rule = matchRule(userContent);

    const content = rule
      ? pickResponse(rule.responses, userContent)
      : pickResponse(FALLBACK_RESPONSES, userContent);

    return { content };
  }

  async extractWithTool(
    _message: ChatMessage,
    _history: ChatMessage[],
    _toolSchema: ToolSchema,
  ): Promise<ToolUseResponse> {
    return {
      toolName: 'extract_preferences',
      input: { preferences: [] },
    };
  }
}
