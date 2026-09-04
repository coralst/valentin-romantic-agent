import { PREFERENCE_CATEGORIES } from '../../shared/constants/categories';
import {
  PROFILE_FIELD_GUIDANCE,
  PROFILE_FIELD_IDS,
} from '../../shared/constants/profile-fields';
import type { Outing } from '../../shared/interfaces/outing';

/**
 * Valentin's persona and the two goals he serves, in that order of permanence.
 *
 * WHY THERE ARE TWO GOALS
 *
 * This prompt used to state exactly one: "fill out a complete partner profile",
 * followed by a fixed interview order (name, then age, then gender). That is only
 * the *first* job, and it made him wrong for the rest of the relationship — asked
 * anything on a profile that was already complete, he still opened with "tell me
 * what your partner loves", because nothing in his instructions described what he
 * is for once he knows her.
 *
 * So the goals are named separately and the caller says which one is live. See
 * {@link buildSystemPrompt}, which is what the orchestrator actually sends.
 */
export const VALENTIN_SYSTEM_PROMPT = `You are Valentin, a warm and sophisticated romantic concierge. You help one person be a better partner to the person they love, by remembering everything that matters about her and using it at the moment it helps.

You have two jobs, and they run in this order.

GOAL 1 — GET TO KNOW HER. Early on, you know little or nothing. Learn who she is through ordinary conversation: her name, her birthday and the dates that matter, how she likes to be loved, what she eats, wears, listens to, dreams about. Never interrogate. Ask about one thing at a time and let the rest arrive on its own.

GOAL 2 — BE HER PARTNER'S ALLY. Once you know her, this is your standing job and it never ends: help him be thoughtful. Remember the dates and raise them before they arrive, not after. Suggest gifts, plans and gestures that fit *her* specifically, citing what you know. Notice what has not been asked about in a while. Answer practical questions with real recommendations, not with more questions. The measure of your work is whether she ends up happier.

Personality:
- Warm and empathetic — you genuinely care about this relationship
- Specific — you refer to her by name and to details you actually know, never in generalities
- Sophisticated — charming and elegant, never pretentious
- Encouraging — you credit him for knowing her well
- Discreet — everything shared with you is held carefully

Conversation guidelines:
- Match your response length to the moment — a quick or casual message gets a short, natural reply; a rich or open-ended one earns a fuller response
- Vary your rhythm — don't acknowledge-then-ask-a-follow-up on every single turn. Sometimes just react, sometimes just answer, sometimes ask
- Only ask a follow-up question when you genuinely need the detail
- Never re-ask something you already know. If you know her name, use it
- Never be judgmental about anything shared
- If he asks you a question, answer it directly. A recommendation beats a clarifying question
- If he seems frustrated, acknowledge it plainly and fix what he is pointing at
- You are not a general assistant, but you are also not a form. If a request is genuinely outside this relationship, say so briefly in your own voice and offer what you can do

Remember: you're helping someone become a more thoughtful, attentive partner. Every detail matters.`;

/**
 * How to behave when tools are on the table.
 *
 * Appended only when the registry has something in it, because most of what it
 * says is meaningless otherwise — and because a model told it can book tables in
 * a deployment with no Ontopo credentials will offer to book tables.
 *
 * The two rules that are not about competence:
 *
 * - **Never claim a write happened.** A tool that writes returns a proposal, and
 *   the user has to accept it. "I've booked you a table" when nothing is booked
 *   is the single worst thing this system can say, and it is the thing a
 *   confident model does by default.
 * - **Shabbat is not a preference.** In Israel a Friday-evening dinner
 *   recommendation is not a slightly-off suggestion, it is a restaurant that is
 *   shut. Hebrew-date anniversaries drift against the Gregorian calendar by up to
 *   three weeks, so "their anniversary is the 14th" is a question for the
 *   calendar tools, not an arithmetic problem.
 */
export const TOOL_GUIDANCE = `
USING YOUR TOOLS

You can reach a few real services. Reach for them when the answer depends on
something you cannot know — what is actually available on Saturday, when Shabbat
ends this week, what her Hebrew anniversary date falls on this year. Do not call
a tool to decorate an answer you already have, and do not narrate the mechanics;
the user wants the restaurant, not the API call.

You are in Israel. Two things follow, always:
- Friday evening through Saturday nightfall is Shabbat. Most places are closed
  and a Friday-night dinner plan is not a suggestion, it is a mistake. מוצ"ש —
  Saturday after dark — is the good night out. Check rather than assume; the
  time changes every week.
- Anniversaries and birthdays given as Hebrew dates move against the Gregorian
  calendar by up to three weeks a year. Look them up. Never calculate them.

NOTHING YOU WRITE, SEND OR BOOK HAPPENS ON YOUR WORD ALONE. Anything that
reserves, orders, emails or messages comes back to you as a proposal, and the
user sees a card they must accept. So describe what you have lined up and ask
them to confirm it. Never say a table is booked, an email is sent or an event is
on the calendar until you are told the confirmation went through. If a tool
fails, say so plainly and offer something else — do not invent the result.

YOU CAN HAND OUT A LINK TO THIS CONVERSATION. If the user asks for a link to the
chat, asks you to email or send them one, or wants to show it to somebody, call
create_conversation_link and give them the URL it returns, exactly as written. To
mail it, call that first and put the URL in the body of propose_email. Do not say
you cannot make a link, and never write a link yourself — they are signed, and one
you compose will not open.`;

/** The smallest thing the prompt builder needs to know about a stored fact */
export interface KnownFact {
  key: string;
  value: string;
  fieldId?: string | null;
}

/** `favorite_cuisine` → `favorite cuisine`, so the block reads as prose */
function readableLabel(fact: KnownFact): string {
  return (fact.fieldId ?? fact.key).replace(/_/g, ' ');
}

/** The partner's name, when it is among the known facts */
export function partnerNameFrom(facts: readonly KnownFact[]): string | null {
  const named = facts.find(
    (fact) => fact.fieldId === 'partner_name' || fact.key === 'partner_name',
  );
  const value = named?.value.trim();
  return value ? value : null;
}

/**
 * The system prompt for one turn, with what he already knows folded in.
 *
 * The model was previously sent {@link VALENTIN_SYSTEM_PROMPT} and the recent
 * messages, and nothing else — so the profile the whole product is built around
 * was invisible to the one component that most needed it. A demo profile with 21
 * known fields still got treated as a stranger, because the transcript above a
 * seeded session is empty and the facts live in DynamoDB, not in the chat.
 *
 * Facts are rendered as plain `label: value` lines rather than JSON: it is fewer
 * tokens and the model quotes them back more naturally.
 *
 * The unknown-field list is deliberately included in the ongoing mode too. It is
 * what lets him fill a gap when a conversation happens to wander past one,
 * instead of either interrogating or never asking again.
 */
export function buildSystemPrompt(
  facts: readonly KnownFact[],
  hasTools = false,
  visited: readonly Outing[] = [],
): string {
  // Appended, not interleaved, so the persona and the profile read the same
  // whether or not this deployment has any credentials.
  const tools = hasTools ? `\n${TOOL_GUIDANCE}` : '';
  const history = visitedBlock(visited);

  if (facts.length === 0) {
    // No history block here even if there somehow is one: an account with no
    // facts at all and a booked restaurant is a state that only arises from a
    // half-finished seed, and the opening turn should introduce him rather than
    // recite a venue.
    return `${VALENTIN_SYSTEM_PROMPT}

CURRENT STATE: You know nothing about her yet. GOAL 1 is live. Open by introducing yourself and asking one easy, warm question about her.${tools}`;
  }

  const name = partnerNameFrom(facts);
  const her = name ?? 'his partner';

  const known = facts
    .map((fact) => `- ${readableLabel(fact)}: ${fact.value}`)
    .join('\n');

  const knownFieldIds = new Set(
    facts.map((fact) => fact.fieldId).filter((id): id is string => Boolean(id)),
  );
  const missing = PROFILE_FIELD_IDS.filter((id) => !knownFieldIds.has(id));

  const gaps =
    missing.length > 0
      ? `\nStill unknown: ${missing.join(', ')}. Do not interrogate him for these. Ask about one only when the conversation naturally arrives there.`
      : `\nYou know every field on her profile. Stop collecting and start using it.`;

  return `${VALENTIN_SYSTEM_PROMPT}

CURRENT STATE: You already know ${her}. GOAL 2 is live — you are past the introductions, so do not open as though you were meeting him for the first time, and do not ask him to tell you about his partner. Use what you know below, by name and in specifics.

WHAT YOU KNOW ABOUT ${(name ?? 'HER').toUpperCase()}:
${known}
${gaps}${history}${tools}`;
}

/**
 * The places they have already been, and what to do about each one.
 *
 * Rendered as prose lines with the verdict spelled out rather than as a rating
 * table, because the instruction attached to a row is the point: a 5/5 is a
 * place to offer again by name, a 2/5 is a place to keep quiet about, and an
 * unrated one is a place he was just at, which makes "somewhere new this time" a
 * reasonable thing for Valentin to say unprompted.
 *
 * Capped, and by the most recent, for the same reason the profile reader is
 * capped: this is sent on every single turn. Ten places is more history than any
 * suggestion needs and still small enough not to crowd out the facts above it.
 */
const MAX_PROMPT_OUTINGS = 10;

function visitedBlock(visited: readonly Outing[]): string {
  if (visited.length === 0) return '';

  const lines = visited.slice(0, MAX_PROMPT_OUTINGS).map((outing) => {
    const where = outing.city ? `${outing.venueName}, ${outing.city}` : outing.venueName;
    const when = outing.occursOn ? ` on ${outing.occursOn}` : '';
    if (outing.rating === null || outing.rating === undefined) {
      return `- ${where}${when} — not rated yet, so do not assume it went well`;
    }
    const verdict = outing.verdict ? `, "${outing.verdict}"` : '';
    return `- ${where}${when} — she rated it ${outing.rating}/5${verdict}`;
  });

  return `
WHERE YOU HAVE ALREADY TAKEN HER:
${lines.join('\n')}

Use this. Never present one of these as a new discovery — he was there. Do not
re-offer anything rated 3 or below unless he asks for it by name; say plainly
that it did not land last time if he does. A place rated 4 or 5 is worth
suggesting again by name, as a return rather than a find.`;
}

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
 * caution, and there is no allergy field in the registry. So `field` is optional: set
 * it when the fact belongs to a profile field, omit it when the fact is real but
 * off-registry.
 *
 * ## Three arrays, one tool
 *
 * `people` and `tasks` are here rather than in two tools of their own because
 * `extractWithTool` forces `toolChoice` to a single named tool: a second and third
 * tool would mean a second and third Bedrock call on every user turn, tripling the
 * latency and cost of extraction to read the same sentence three times. One
 * schema with three arrays gets the model to sort the turn once, which is also
 * how it avoids filing "her sister Nadia's birthday is in March" as both a person
 * and a `birthday` preference — the arrays are described in terms of each other.
 *
 * All three are optional. Most turns fill none of them, and an empty array is the
 * normal answer.
 */
export const EXTRACT_PREFERENCES_TOOL = {
  name: 'extract_preferences',
  description:
    'Extract what the conversation says about the user\'s partner, the people in her life, and what the user has to do. Only extract what is clearly stated or strongly implied.\n\n' +
    'PREFERENCES — facts about her. For each, set "field" to the profile field it belongs to, choosing from this list:\n' +
    FIELD_GUIDANCE_LINES +
    '\n\nIf the fact is real but does not belong to any field above (an allergy, a dislike, something to avoid), omit "field" and give it a descriptive "key" instead.\n\n' +
    'Emit ONE preference per distinct fact. Never split a single fact across two preferences — ' +
    '"she\'s turning 32 in June" is one birthday preference with the value "June (turning 32)", not an age preference plus a month preference.\n\n' +
    'PEOPLE — someone in HER life: her mother, her sister, her uncle, her cat. Not the user, and not her. ' +
    'A relative mentioned without a name is still a person: record the relationship and leave "name" out, because "her brother, whose name I never caught" is exactly the thing worth remembering. ' +
    'A birthday belonging to a relative goes on that person, never in a preference — the "birthday" field is HERS alone.\n\n' +
    'TASKS — something the USER has said he will do or should do: book a table, buy the glaze set, ask her about a date. ' +
    'Only when he commits or asks for a reminder, never for something he has already done, and never for advice you are merely offering in reply.',
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
      people: {
        type: 'array',
        description:
          'People in her life mentioned in this message. Empty on most turns.',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description:
                'What they are called. OMIT when the message names a relative without naming them.',
            },
            relationship: {
              type: 'string',
              description:
                'How they are related to her, in the user\'s own words: "her mother", "her older sister", "her uncle on her father\'s side".',
            },
            generation: {
              type: 'string',
              enum: ['grandparent', 'elder', 'peer', 'younger'],
              description:
                'Which rung of her family they sit on: grandparent, elder (her parents, aunts and uncles), peer (siblings, cousins, friends of her own age), younger (children, nieces, nephews, pets).',
            },
            birthday: {
              type: 'string',
              description:
                'Their birthday as YYYY-MM-DD when the year is known, otherwise omit it. Never guess a year.',
            },
            note: {
              type: 'string',
              description:
                'Anything worth remembering about them: "goes by Mimi", "do not mention the illness".',
            },
          },
          required: ['relationship', 'generation'],
        },
      },
      tasks: {
        type: 'array',
        description:
          'Things the user has to do, from this message. Empty on most turns.',
        items: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description:
                'The line as he would read it back: "Book the Italian place for the 18th".',
            },
            due: {
              type: 'string',
              description:
                'YYYY-MM-DD when he named a date. Omit for "sometime" — never invent a deadline.',
            },
            note: {
              type: 'string',
              description: 'Why it matters, or what to say when he does it.',
            },
          },
          required: ['title'],
        },
      },
    },
    required: ['preferences'],
  },
} as const;
