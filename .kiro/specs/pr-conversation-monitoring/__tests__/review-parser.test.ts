/**
 * Review Parser Tests — severity extraction robustness
 *
 * Covers the workflow-review fixes:
 *   - Emoji slicing must not depend on code-unit widths / variation selectors.
 *     A bare ⚠ (no U+FE0F) and a list-prefixed "- ❌ ..." must both parse, with
 *     no leading character eaten.
 *   - The general bucket should not swallow list markers as findings.
 */

import { describe, it, expect } from 'vitest';
// @ts-expect-error - JS skill module without type declarations
import parser from '../../../skills/pr-monitoring/review-parser-skill.js';

const { parseReview } = parser;

describe('parseReview severity extraction', () => {
  it('extracts each severity without dropping leading characters', () => {
    const body = ['❌ SQL injection risk', '⚠️ Consider memoizing', '✅ Good coverage'].join('\n');
    const parsed = parseReview(body);
    expect(parsed.blocking).toEqual(['SQL injection risk']);
    expect(parsed.suggestions).toEqual(['Consider memoizing']);
    expect(parsed.positive).toEqual(['Good coverage']);
  });

  it('handles ⚠ WITHOUT the U+FE0F variation selector', () => {
    // Bare warning sign (U+26A0) — old substring(2) would have eaten a char.
    const parsed = parseReview('\u26A0 rate limiting missing');
    expect(parsed.suggestions).toEqual(['rate limiting missing']);
  });

  it('handles list-marker-prefixed severity lines', () => {
    const body = ['- ❌ missing validation', '* ⚠️ tighten types'].join('\n');
    const parsed = parseReview(body);
    expect(parsed.blocking).toEqual(['missing validation']);
    expect(parsed.suggestions).toEqual(['tighten types']);
  });

  it('handles ordered-list (numbered) severity lines round-trip', () => {
    // formatForAgent emits findings as "1. ❌ ...", so the parser must accept
    // ordered markers too — otherwise its own output is not re-parseable.
    const body = ['1. ❌ SQL injection risk', '2) ⚠️ memoize selector', '3. ✅ good coverage'].join('\n');
    const parsed = parseReview(body);
    expect(parsed.blocking).toEqual(['SQL injection risk']);
    expect(parsed.suggestions).toEqual(['memoize selector']);
    expect(parsed.positive).toEqual(['good coverage']);
    expect(parsed.general).toHaveLength(0);
  });

  it('routes prose to general but skips headers and emphasis', () => {
    const body = ['# Review', '**Bold header**', 'This is a general note.'].join('\n');
    const parsed = parseReview(body);
    expect(parsed.general).toEqual(['This is a general note.']);
    expect(parsed.blocking).toHaveLength(0);
  });

  it('returns empty buckets for empty input', () => {
    const parsed = parseReview('');
    expect(parsed).toEqual({ blocking: [], suggestions: [], positive: [], general: [] });
  });
});
