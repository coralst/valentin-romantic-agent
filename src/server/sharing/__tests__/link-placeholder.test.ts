/**
 * The point of this file is the bug it locks down: a model cannot retype a
 * 250-character signed token, so it is never given one. These tests assert the
 * placeholder is what travels and the URL is what arrives.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  CONVERSATION_LINK_PLACEHOLDER,
  expandConversationLinkText,
  expandConversationLinks,
  hasConversationLinkPlaceholder,
} from '../link-placeholder';

const URL = 'https://example.test/?share=abc_def-ghi.sig_1';

describe('hasConversationLinkPlaceholder', () => {
  it('finds the canonical form', () => {
    expect(hasConversationLinkPlaceholder(`here: ${CONVERSATION_LINK_PLACEHOLDER}`)).toBe(true);
  });

  it('answers the same way twice on the same string', () => {
    // A `g` regex advances `lastIndex` on `test`, which made the second call lie.
    const text = `here: ${CONVERSATION_LINK_PLACEHOLDER}`;
    expect(hasConversationLinkPlaceholder(text)).toBe(true);
    expect(hasConversationLinkPlaceholder(text)).toBe(true);
  });

  it('is false for ordinary prose', () => {
    expect(hasConversationLinkPlaceholder('I will email you a link shortly.')).toBe(false);
  });
});

describe('expandConversationLinkText', () => {
  it('substitutes the minted URL', () => {
    expect(expandConversationLinkText(`Open ${CONVERSATION_LINK_PLACEHOLDER}`, () => URL)).toBe(
      `Open ${URL}`,
    );
  });

  it('substitutes every occurrence', () => {
    const text = `${CONVERSATION_LINK_PLACEHOLDER} and ${CONVERSATION_LINK_PLACEHOLDER}`;
    expect(expandConversationLinkText(text, () => URL)).toBe(`${URL} and ${URL}`);
  });

  it.each([
    '{{ conversation_link }}',
    '{{conversation-link}}',
    '{{Conversation Link}}',
    '[[conversation_link]]',
  ])('tolerates the near-miss %s rather than showing it to the user', (variant) => {
    expect(expandConversationLinkText(`Open ${variant}`, () => URL)).toBe(`Open ${URL}`);
  });

  it('does not mint for text with no placeholder', () => {
    const mint = vi.fn(() => URL);
    expect(expandConversationLinkText('No link here.', mint)).toBe('No link here.');
    expect(mint).not.toHaveBeenCalled();
  });
});

describe('expandConversationLinks', () => {
  it('reaches a nested string such as an email body', () => {
    const input = { to: 'a@b.test', subject: 'Hi', body: `Read it: ${CONVERSATION_LINK_PLACEHOLDER}` };
    expect(expandConversationLinks(input, () => URL)).toEqual({
      to: 'a@b.test',
      subject: 'Hi',
      body: `Read it: ${URL}`,
    });
  });

  it('reaches inside arrays', () => {
    expect(expandConversationLinks([CONVERSATION_LINK_PLACEHOLDER], () => URL)).toEqual([URL]);
  });

  it('leaves non-strings alone', () => {
    const input = { count: 3, ok: true, nothing: null };
    expect(expandConversationLinks(input, () => URL)).toEqual(input);
  });

  it('returns the same object when there is nothing to expand', () => {
    const input = { body: 'plain' };
    expect(expandConversationLinks(input, () => URL)).toBe(input);
  });
});
