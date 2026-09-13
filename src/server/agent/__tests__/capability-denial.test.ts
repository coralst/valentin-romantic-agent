/**
 * The detector has exactly one job and one way to be dangerous.
 *
 * The job: recognise the two sentences the live app produced on 2026-09-13, plus
 * the near neighbours of each. The danger: firing on Valentin working correctly —
 * declining a topic he is right to decline, or reporting a failure a tool actually
 * told him about — because that would spend a model call arguing with a good
 * answer. The negatives below are therefore as load-bearing as the positives.
 */
import { describe, expect, it } from 'vitest';

import { capabilityReminder, deniesCapability } from '../capability-denial';
import type { AgentTool, ToolRegistry } from '../../integrations/tool-registry';

describe('deniesCapability', () => {
  /** Verbatim from the live transcript, session 4792ae93, 2026-09-13. */
  it('catches the reported refusal about the conversation link', () => {
    expect(
      deniesCapability(
        "I can send you an email, but I don't have access to a link to this specific " +
          "conversation — that's not something the system gives me.",
      ),
    ).toBe(true);
  });

  /** Also verbatim: the turn after, where it denied having email at all. */
  it('catches the reported refusal about sending email', () => {
    expect(
      deniesCapability(
        "I don't actually have the ability to send emails in this version — that tool " +
          "isn't available right now.",
      ),
    ).toBe(true);
  });

  it.each([
    "I don't have a way to create a link to this chat.",
    'That feature is not available in this version.',
    "I'm not able to send you an email, unfortunately.",
    'I am unable to make a link to this conversation.',
    "That's not something I have access to.",
  ])('catches "%s"', (text) => {
    expect(deniesCapability(text)).toBe(true);
  });

  /**
   * Valentin declining a topic is not Valentin denying a capability. These are
   * the canned replies a blocked turn produces and the "not a general assistant"
   * line from the persona — all correct answers, none of them worth a retry.
   */
  it.each([
    "That one I'd rather not go into — but I'm still right here. Shall we talk about her instead?",
    "I appreciate the curiosity, but that's not really what I'm here for.",
    'That is outside what I do, but I can help you plan something for her.',
  ])('leaves a topic refusal alone: "%s"', (text) => {
    expect(deniesCapability(text)).toBe(false);
  });

  /**
   * A failure a tool reported is the one thing that must never be argued with —
   * it is the honest outcome the whole proposal design exists to produce.
   */
  it.each([
    "Gmail wouldn't send that message, so it hasn't gone out. Shall I try again?",
    "Ontopo has nothing at 21:00 on Saturday — the table isn't available.",
    'I could not reach the restaurant\'s system just now.',
  ])('leaves a reported failure alone: "%s"', (text) => {
    expect(deniesCapability(text)).toBe(false);
  });

  /**
   * A limit of *knowledge* reads like a limit of capability and is not one. "I'm
   * not able to tell" is Valentin being careful, which is the behaviour the rest
   * of the prompt spends most of its words asking for.
   */
  it.each([
    "I'm not able to tell from here whether she'd like it — has she mentioned jazz?",
    "I don't know her sister's name yet.",
    'How about Sunday instead?',
  ])('leaves an ordinary reply alone: "%s"', (text) => {
    expect(deniesCapability(text)).toBe(false);
  });
});

describe('capabilityReminder', () => {
  const registry: ToolRegistry = new Map<string, AgentTool>([
    ['propose_email', { name: 'propose_email' } as AgentTool],
    ['create_conversation_link', { name: 'create_conversation_link' } as AgentTool],
  ]);

  it('names every tool the model actually has', () => {
    const reminder = capabilityReminder(registry);
    expect(reminder).toContain('propose_email');
    expect(reminder).toContain('create_conversation_link');
  });

  /**
   * The escape hatch, pinned. Without it the nudge reads as "you must be able to
   * do this", and a model under that pressure invents the capability rather than
   * repeating a refusal that was right.
   */
  it('still allows an honest refusal', () => {
    expect(capabilityReminder(registry)).toMatch(/none of them|say so plainly/i);
  });
});
