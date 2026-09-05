/**
 * One-line, redacted summaries of what a tool was asked to do and what came back.
 *
 * These strings are the whole point of the activity trail: "Valentin is using a
 * tool" is not worth a row, and "searching Ontopo for Saturday, 2 people" is. The
 * difficulty is that tool arguments are the least safe data in the system.
 * `find_restaurants` carries a city and a date, which are fine; `propose_email`
 * carries a recipient and prose about someone's partner, and `find_places_nearby`
 * carries the coordinates of where he lives.
 *
 * So nothing is serialised wholesale. A key on {@link SAFE_INPUT_KEYS} renders its
 * value; every other key renders its *shape* — `to: <email>`, `body: <42 words>`.
 * The shape is what makes the line informative ("he's sending mail, and it's a
 * long one") without naming anybody, and it degrades safely: a key added to a tool
 * schema tomorrow is redacted by default rather than exposed by default.
 *
 * These strings are **never logged.** `runTool`'s contract is that nothing from
 * `input` reaches CloudWatch, and this module does not weaken it — an activity
 * frame goes to exactly one socket, the one belonging to the user whose data it
 * is, and then it is gone.
 */

/** Longest summary we will put on one line before truncating. */
export const INPUT_SUMMARY_MAX_CHARS = 120;

/** Longest outcome line, same reasoning. */
export const OUTCOME_MAX_CHARS = 80;

/**
 * Input keys whose values are safe to show.
 *
 * The test is not "is this useful to see" but "can this ever hold something about
 * a person". A city, a party size and a date cannot. A name, a note and a reason
 * always can, so they are absent — as is `lat`/`lon`, which is his home to five
 * decimal places, and `anniversary_title`, which is routinely "Anniversary with
 * <her name>".
 */
export const SAFE_INPUT_KEYS: ReadonlySet<string> = new Set([
  'anniversary_date',
  'area',
  'category',
  // Every date-shaped key, not some of them. The list used to hold `check_out`
  // alone, so the trail rendered one leg of a hotel stay and redacted the other,
  // and `date: <text>` hid the single most useful thing to see when the agent
  // picks the wrong day. A date is a date whichever tool asks for it; the rule in
  // the docblock above already says a date holds nothing about a person.
  'check_in',
  'check_out',
  'city',
  'date',
  'days_ahead',
  'duration_minutes',
  'keyword',
  'kind',
  'limit',
  'near',
  'occasion',
  'offer_id',
  'party_size',
  'query',
  'radius_km',
  'restaurant',
  'style',
  'template',
  'time',
  'timezone',
  'when',
]);

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^[+\d][\d\s()-]{6,}$/;

/** What a redacted value is, without saying what it says. */
function describeShape(value: unknown): string {
  if (value === null || value === undefined) return '<none>';
  if (typeof value === 'boolean') return '<yes/no>';
  if (typeof value === 'number') return '<number>';
  if (Array.isArray(value)) return `<list of ${value.length}>`;
  if (typeof value === 'object') return '<details>';
  if (typeof value !== 'string') return '<value>';

  const text = value.trim();
  if (text === '') return '<empty>';
  if (EMAIL.test(text)) return '<email>';
  if (PHONE.test(text)) return '<phone>';

  // Word count rather than character count: "42 words" tells the reader this is
  // a written message, where "220 chars" reads like a field length.
  const words = text.split(/\s+/).length;
  return words > 3 ? `<${words} words>` : '<text>';
}

/** A safe value, flattened to one line and kept short. */
function renderSafe(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length <= 3 ? value.map((v) => String(v)).join(', ') : `${value.length} items`;
  }
  if (value === null || value === undefined) return '<none>';
  if (typeof value === 'object') return '<details>';
  return String(value).replace(/\s+/g, ' ').trim();
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * A one-line summary of a tool's arguments, safe to display.
 *
 * Returns `''` for a tool called with nothing, rather than `{}` — an empty string
 * renders as no summary at all, which is the truth, where `{}` looks like a bug.
 */
export function summariseToolInput(input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const rendered = SAFE_INPUT_KEYS.has(key) ? renderSafe(value) : describeShape(value);
    if (rendered === '') continue;
    parts.push(`${key}: ${rendered}`);
  }
  return truncate(parts.join(' · '), INPUT_SUMMARY_MAX_CHARS);
}

/**
 * A one-line outcome, from the prose the tool already wrote for the model.
 *
 * First sentence only. `ToolResult.summary` is written to be *read by the model*
 * and can run to a paragraph with an instruction in it ("tell the user plainly —
 * do not pretend it worked"); the trail wants the fact, not the coaching.
 */
export function summariseToolOutcome(summary: string, ok: boolean): string {
  const firstSentence = summary.trim().split(/(?<=[.!?])\s/)[0] ?? '';
  const text = firstSentence.replace(/\s+/g, ' ').trim();
  if (text !== '') return truncate(text, OUTCOME_MAX_CHARS);
  // A tool that failed without saying anything still has to render as something.
  return ok ? 'done' : 'failed';
}
