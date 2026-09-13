/**
 * Catching the turn where Valentin tells the user a capability he has is missing.
 *
 * ## The failure this exists to remove
 *
 * Reported from the live app on 2026-09-13. Asked "send me mail with links to
 * this conversation", with `create_conversation_link` and `propose_email` both in
 * the tool list, the model called neither and answered:
 *
 * > I can send you an email, but I don't have access to a link to this specific
 * > conversation — that's not something the system gives me.
 *
 * and then, when the user pasted a link of his own and asked again:
 *
 * > I don't actually have the ability to send emails in this version — that tool
 * > isn't available right now.
 *
 * Both sentences are false. The prod task definition had `GOOGLE_REFRESH_TOKEN`
 * wired and `GET /api/integrations` reported `gmail` and `sharing` configured, so
 * the tools were on the list the model was handed; the input token count on the
 * failing turn matches a turn carrying the full 16-tool schema. It simply did not
 * call them.
 *
 * ## Why prose detection rather than a better prompt
 *
 * `TOOL_GUIDANCE` already said "Do not say you cannot make a link", and the same
 * transcript replayed against the same model, prompt, guardrail and registry
 * produced the correct two-tool chain 12 times out of 12. So this is not a prompt
 * that forgot to say it: it is a sampling outcome at `temperature: 0.8`, which no
 * amount of prompt text reduces to zero. The prompt fix that ships alongside this
 * makes the wording harder to reach; this makes it recoverable when it is reached
 * anyway.
 *
 * ## What it deliberately does not do
 *
 * It does not decide the reply is wrong, and it never rewrites one. The only
 * action it authorises is *one* extra model round trip with the tool list
 * restated — so a false positive costs a few seconds and produces the same honest
 * refusal, and a true positive costs the same and produces the tool call. Nothing
 * here can put words in Valentin's mouth, which is why the check is allowed to be
 * approximate.
 */

import type { ToolRegistry } from '../integrations/tool-registry';

/**
 * The shapes a false "I can't" takes, each anchored on a *capability* rather than
 * on refusal in general.
 *
 * Topic refusals must not match. "That's not really what I'm here for" and "I'd
 * rather not go into that" are Valentin working correctly — he is not a general
 * assistant, and a retry there would nag the model into helping with something it
 * was right to decline. So every pattern needs a word about the machinery:
 * access, ability, tool, integration, permission, or a bare "not available".
 */
const DENIAL_PATTERNS: readonly RegExp[] = [
  /*
   * "I don't have access to a link to this conversation."
   * "I don't actually have the ability to send emails."
   *
   * The bounded gap lets an adverb and a short object in ("don't actually have
   * any way to") without spanning into the next sentence, which is what an
   * unbounded `.*` would do.
   */
  /\bi\s+(?:don'?t|do not|can'?t|cannot|won'?t)\s+(?:actually\s+|really\s+)?(?:have|get)\b[^.!?\n]{0,40}\b(?:access|ability|way|tool|tools|integration|permission|means)\b/i,

  /*
   * "That tool isn't available right now." / "That feature is not available in
   * this version." The subject is named, so "the table isn't available" — a real
   * answer from a real reservation lookup — cannot match.
   */
  /\b(?:that|this|the)\s+(?:tool|feature|capability|integration|function|ability)\b[^.!?\n]{0,30}\b(?:isn'?t|is not|aren'?t|are not|wasn'?t|was not)\s+available\b/i,

  /*
   * "That's not something the system gives me." The exact sentence from the live
   * report, and the one a model reaches for when it is describing its own limits
   * rather than a failure it observed.
   */
  /\bnot something\s+(?:the system|i)\b[^.!?\n]{0,30}\b(?:gives?|hands?|offers?|provides?|can|have|do)\b/i,

  /*
   * "I'm not able to send you an email." / "I am unable to create a link." /
   * "I can't make a link to this chat."
   *
   * Restricted to the verbs this product actually has tools for, so "I'm not able
   * to tell from here whether she'd like it" — an honest limit of knowledge, not
   * of capability — is left alone. Both apostrophes, because the model writes the
   * typographic one about as often as the straight one.
   */
  /\bi(?:['’]m| am)?\s+(?:not able to|unable to|can['’]?t|cannot)\s+(?:send|email|mail|create|generate|make|give|share|book|reserve|order|set)\b/i,
];

/**
 * Does this reply claim a capability is missing?
 *
 * Cheap and synchronous: it runs on at most one reply per turn, and only on a
 * turn that called no tools at all.
 */
export function deniesCapability(text: string): boolean {
  return DENIAL_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * The turn appended to the transcript to make the model look again.
 *
 * Written as something the *user* says, because that is the only role Bedrock
 * will accept after an assistant turn, and because a system-voiced correction
 * mid-transcript is a thing the model then tries to explain to the user.
 *
 * Three things it must do, and the third is the one that keeps this safe:
 *
 * 1. Name the tools, so "I don't have a tool for that" is contradicted by a list.
 * 2. Say what to do — call it — rather than merely that the refusal was wrong,
 *    which produced an apology and no tool call.
 * 3. Leave the honest refusal available. If nothing on the list fits, saying so
 *    plainly is the correct answer and is explicitly allowed here. Without that
 *    sentence a false positive would pressure the model into inventing a
 *    capability, which is the failure this whole file is against.
 */
export function capabilityReminder(registry: ToolRegistry): string {
  return (
    'Before you answer: you just told me a capability is missing. Check the tools ' +
    `you actually have — ${[...registry.keys()].join(', ')}. If one of them does ` +
    'what I asked, call it now and answer from what it returns. If none of them ' +
    'does, say so plainly in one sentence — but never claim an action happened, ' +
    'and never tell me a tool is unavailable when it is on that list.'
  );
}
