import { describe, it, expect } from 'vitest';
import { hasToolMarkup, stripToolMarkup } from '../strip-tool-markup';

/**
 * Build a tag from its inside, rather than writing one out.
 *
 * Every literal tool tag in a source file is a tag some other tool may read as
 * its own — this file is full of them by necessity, and composing them at
 * runtime keeps them inert on the way in.
 */
const tag = (inner: string): string => `<${inner}>`;

/** The shape the live app reported: a call the model typed instead of making. */
const NARRATED_CALL = [
  tag('invoke name="find_music"'),
  tag('parameter name="query"'),
  'Kill Bill soundtrack',
  tag('/parameter'),
  tag('parameter name="limit"'),
  '10',
  tag('/parameter'),
  tag('/invoke'),
].join('\n');

describe('stripToolMarkup', () => {
  it('removes a call the model typed as prose', () => {
    const text = `Let me look that up for you.\n\n${NARRATED_CALL}`;

    const stripped = stripToolMarkup(text);

    // The argument values survive as plain words. They are the model's own text
    // and often the only thing in the turn worth reading; only the scaffolding
    // around them goes.
    expect(stripped).toBe('Let me look that up for you.\n\nKill Bill soundtrack\n\n10');
    expect(stripped).not.toContain('<');
  });

  it('leaves nothing behind when the whole turn was markup', () => {
    // The reported bubble was this and only this, so the caller has to be able
    // to tell that there is no prose left and substitute a real sentence.
    const stripped = stripToolMarkup(
      [tag('invoke name="find_music"'), tag('/invoke')].join(''),
    );

    expect(stripped).toBe('');
  });

  it('removes a wrapper the model opened around several calls', () => {
    const text = [
      tag('function_calls'),
      tag('invoke name="check_shabbat"'),
      tag('/invoke'),
      tag('/function_calls'),
    ].join('\n');

    expect(stripToolMarkup(text).trim()).toBe('');
  });

  it('removes a tag the renderer has already mangled', () => {
    // Exactly what reached the screen: the tag word survives, the rest does not.
    // A pattern anchored to a well-formed tag name would have matched none of it.
    const text = `Here you go. ${tag('e name="find_gaza" invoke')} ${tag('/antml califotml:parameter')}`;

    expect(stripToolMarkup(text)).toBe('Here you go.');
  });

  it('removes a call the model began and never closed', () => {
    // What a turn that runs out of output tokens mid-markup leaves behind.
    const text = `One moment.\n\n${tag('invoke name="find_music"')}\n${'<parameter name="query"'}`;

    expect(stripToolMarkup(text)).toBe('One moment.');
  });

  it('leaves ordinary prose exactly as it is', () => {
    const prose = 'She loved the peonies — shall I book Friday at 8, or would Saturday suit better?';

    expect(stripToolMarkup(prose)).toBe(prose);
  });

  it('leaves prose that merely contains angle brackets alone', () => {
    // Valentin writes real sentences with real punctuation, and a mail-shaped
    // address or a comparison must not be mistaken for a tag.
    const prose = 'Send it to <koralsteinberg@gmail.com> — 8pm < 9pm works better for her.';

    expect(stripToolMarkup(prose)).toBe(prose);
    expect(hasToolMarkup(prose)).toBe(false);
  });

  it('leaves an HTML-ish tag that is not tool markup alone', () => {
    // Only the protocol's own words are stripped. Anything else the model writes
    // is its own business — over-reaching here would silently eat prose.
    const text = `A little ${tag('em')}something${tag('/em')} for her.`;

    expect(stripToolMarkup(text)).toBe(text);
  });

  it('is unchanged by an empty or missing string', () => {
    expect(stripToolMarkup('')).toBe('');
    expect(stripToolMarkup(undefined as unknown as string)).toBe(undefined);
  });

  it('collapses the blank run a stripped block leaves behind', () => {
    const text = `Before.\n\n${tag('invoke name="x_invoke"')}\n\nAfter.`;

    expect(stripToolMarkup(text)).toBe('Before.\n\nAfter.');
  });
});

describe('hasToolMarkup', () => {
  it('recognises markup so a caller can log that it happened', () => {
    expect(hasToolMarkup(NARRATED_CALL)).toBe(true);
  });

  it('answers the same way twice for the same string', () => {
    // `test` on a `g`-flagged regex advances `lastIndex` and alternates. This
    // asserts the bug stays fixed, because a log line that fires every other
    // time is worse than no log line.
    expect(hasToolMarkup(NARRATED_CALL)).toBe(true);
    expect(hasToolMarkup(NARRATED_CALL)).toBe(true);
    expect(hasToolMarkup(NARRATED_CALL)).toBe(true);
  });

  it('says no to ordinary prose', () => {
    expect(hasToolMarkup('Shall I book Friday?')).toBe(false);
    expect(hasToolMarkup('')).toBe(false);
  });
});
