import { describe, it, expect } from 'vitest';
import {
  buildConversationEmail,
  type ConversationEmailInput,
  type ConversationEmailTurn,
} from '../conversation-email';
import { resumeLink } from '../../../shared/constants/resume-link';

/**
 * Same standard as `email-body.test.ts`, and for the same reason: this mail is posted
 * by a button press with nobody reviewing the result, so the assertions worth having
 * are that it quotes rather than summarises, admits what it left out, and never
 * claims anything was booked or paid for.
 */

function turns(count: number): ConversationEmailTurn[] {
  return Array.from({ length: count }, (_, index) => ({
    sender: index % 2 === 0 ? ('user' as const) : ('agent' as const),
    content: `turn ${index + 1}`,
  }));
}

const BASE: ConversationEmailInput = {
  title: 'Her birthday, the 12th',
  partnerName: 'Samantha',
  turns: [
    { sender: 'user', content: 'Something quiet for her birthday' },
    { sender: 'agent', content: 'Montefiore has a table at 19:30 — shall I hold it?' },
  ],
  origin: 'https://example.test',
  sessionId: 'sess-8f2c',
};

function build(overrides: Partial<ConversationEmailInput> = {}) {
  return buildConversationEmail({ ...BASE, ...overrides });
}

describe('buildConversationEmail', () => {
  it('names the conversation in the subject', () => {
    // A reader with four conversations open gets nothing from "Your conversation".
    expect(build().subject).toContain('Her birthday, the 12th');
  });

  it('falls back to a usable subject for an untitled conversation', () => {
    expect(build({ title: '   ' }).subject).toBe('Your conversation with Valentin');
  });

  it('quotes the turns verbatim rather than summarising them', () => {
    const { body } = build();

    expect(body).toContain('Something quiet for her birthday');
    expect(body).toContain('Montefiore has a table at 19:30 — shall I hold it?');
  });

  it('labels the speakers as You and Valentin', () => {
    const { body } = build();

    expect(body).toContain('You:');
    expect(body).toContain('Valentin:');
  });

  it('ends on the resume link as the only call to action', () => {
    const { body } = build();
    const link = resumeLink(BASE.origin, BASE.sessionId);

    expect(body).toContain(link);
    // Last thing before the signature, so it is what the reader acts on.
    const lines = body.trimEnd().split('\n');
    expect(lines[lines.length - 1]).toBe('— Valentin');
    expect(lines[lines.length - 3]).toBe(link);
    // Exactly one link: a share token must never ride along in a mail nobody asked
    // to share.
    expect(body.match(/https?:\/\//g)).toHaveLength(1);
  });

  it('carries no share token', () => {
    expect(build().body).not.toContain('share=');
  });

  it('caps the transcript at six turns and keeps the tail', () => {
    const { body } = build({ turns: turns(10) });

    expect(body).toContain('turn 10');
    expect(body).toContain('turn 5');
    expect(body).not.toContain('turn 4');
  });

  it('says how many turns it left out, before the quotes', () => {
    const { body } = build({ turns: turns(10) });

    expect(body).toContain('4 earlier turns are not included');
    expect(body.indexOf('not included')).toBeLessThan(body.indexOf('turn 5'));
  });

  it('uses the singular when exactly one turn was dropped', () => {
    expect(build({ turns: turns(7) }).body).toContain('one earlier turn is not included');
  });

  it('claims no omission when the whole conversation fits', () => {
    expect(build({ turns: turns(6) }).body).not.toContain('not included');
    expect(build({ turns: turns(6) }).body).toContain('The conversation so far');
  });

  it('never claims anything was booked, held or paid for', () => {
    // The one error here that would be a lie to a real person about a real
    // restaurant. Every factual sentence in this mail is a quote of a stored turn;
    // the code-authored lines assert nothing.
    const codeAuthored = build({ turns: [] }).body;

    for (const claim of ['reserved', 'booked', 'confirmed', 'paid', 'charged']) {
      expect(codeAuthored.toLowerCase()).not.toContain(claim);
    }
  });

  it('still sends, and still links, for an empty conversation', () => {
    const { body } = build({ turns: [] });

    expect(body).toContain('nothing in this conversation yet');
    expect(body).toContain(resumeLink(BASE.origin, BASE.sessionId));
  });

  it('elides a single enormous turn rather than mailing a wall of text', () => {
    const { body } = build({
      turns: [{ sender: 'agent', content: 'x'.repeat(2000) }],
    });

    expect(body).toContain('…');
    expect(body.length).toBeLessThan(1200);
  });

  it('omits her name from the intro when it is not known', () => {
    const { body } = build({ partnerName: null });

    expect(body).not.toContain('Samantha');
    expect(body).toContain('Here is where we got to on');
  });
});
