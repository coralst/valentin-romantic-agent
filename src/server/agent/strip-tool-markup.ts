/**
 * Remove tool-call markup a model wrote as prose.
 *
 * Bedrock's tool protocol carries a call in a `toolUse` *block*, and the loop in
 * `tool-loop.ts` reads those blocks. But a model can also just type the markup
 * into its text, and when it does the block list comes back empty — so the loop
 * sees an ordinary prose turn, returns it, and the raw XML lands in a chat
 * bubble. Reported from the live app on 2026-09-05: a request for a Kill Bill
 * playlist came back as an angle-bracketed `invoke` element naming `find_music`,
 * wrapping two `parameter` elements (a limit and a track query), with the tag
 * names half-mangled by the renderer on the way through.
 *
 * Nothing had gone wrong upstream — no truncation warning, no tool error, no
 * guardrail intervention — the model simply narrated the call instead of making
 * it.
 *
 * So this is a display guarantee, not a parser: whatever the model does, the
 * user never reads XML. It deliberately does *not* try to execute what it finds.
 * Recovering a call from prose would mean running a tool the protocol never
 * asked for, from text no `toolUseId` correlates, and a wrong guess there books
 * a table or sends an email. Dropping it costs one turn — the user asks again,
 * and the model calls the tool properly.
 */

/**
 * The tag words to strip.
 *
 * `parameter` stands alone because the model often writes the parameter list
 * without a wrapping element, and a lone parameter tag is exactly as unreadable.
 */
const TAG_WORDS = 'invoke|function_calls|function_results|parameter';

/**
 * Any angle-bracketed span containing one of those words.
 *
 * Loose about the rest of the tag on purpose: the namespace prefix varies, the
 * closing slash may be missing, and the live report arrived with whitespace and
 * stray letters inside the tag where the renderer had already chewed it. A
 * pattern anchored to a well-formed tag name would have matched none of it.
 *
 * The length bounds keep this linear — an unbounded `[^<>]*` either side of the
 * alternation is the classic backtracking shape, and this runs on every reply.
 */
const TOOL_ELEMENT = new RegExp(`<[^<>]{0,200}\\b(?:${TAG_WORDS})\\b[^<>]{0,200}>`, 'gi');

/**
 * The same thing unterminated at the end of the text — a call the model began
 * writing and never closed, which is what a turn that runs out of output tokens
 * mid-markup leaves behind.
 */
const TOOL_TAIL = new RegExp(`<[^<>]{0,200}\\b(?:${TAG_WORDS})\\b[^<>]{0,200}$`, 'i');

/** Blank runs left where a block of markup used to be. */
const BLANK_RUN = /\n{3,}/g;

/**
 * Strip tool markup from model prose.
 *
 * Returns the input unchanged when there is no `<` in it at all, which is nearly
 * every turn — so the common path costs one `includes` and allocates nothing.
 */
export function stripToolMarkup(text: string): string {
  if (!text || !text.includes('<')) return text;

  return text.replace(TOOL_ELEMENT, '').replace(TOOL_TAIL, '').replace(BLANK_RUN, '\n\n').trim();
}

/**
 * Whether `text` carries tool markup, so a caller can log that it happened.
 *
 * Builds its own matcher rather than reusing `TOOL_ELEMENT`: `test` on a `g`
 * regex advances `lastIndex` and would return alternating answers for the same
 * string.
 */
export function hasToolMarkup(text: string): boolean {
  if (!text || !text.includes('<')) return false;
  return new RegExp(`<[^<>]{0,200}\\b(?:${TAG_WORDS})\\b`, 'i').test(text);
}
