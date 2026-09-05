import { beforeEach, describe, expect, it } from 'vitest';
import {
  correctOfferedIds,
  offeredIn,
  rememberOffered,
  resetOfferedTracks,
} from '../offered-tracks';

/**
 * The id the live bug hunt actually caught, and the corruption it actually saw:
 * one character, `5` → `6`, at position sixteen.
 */
const REAL = '1zNXF2svmdlNxfS5XeNUgr';
const CORRUPTED = '1zNXF2svmdlNxfS6XeNUgr';

describe('the ids find_music offered', () => {
  beforeEach(resetOfferedTracks);

  it('repairs the one-character slip that lost a song from a real playlist', () => {
    rememberOffered('s1', [REAL, '4uLU6hMCjMI75M1A2tKUQC']);

    const { ids, corrections, unknown } = correctOfferedIds('s1', [CORRUPTED]);

    expect(ids).toEqual([REAL]);
    expect(corrections).toEqual([{ from: CORRUPTED, to: REAL }]);
    expect(unknown).toEqual([]);
  });

  it('repairs a dropped and an added character too', () => {
    rememberOffered('s1', [REAL]);

    expect(correctOfferedIds('s1', [REAL.slice(0, 10) + REAL.slice(11)]).ids).toEqual([REAL]);
    expect(correctOfferedIds('s1', [`${REAL.slice(0, 10)}Q${REAL.slice(10)}`]).ids).toEqual([REAL]);
  });

  it('passes an exact id straight through without reporting a correction', () => {
    rememberOffered('s1', [REAL]);

    const { ids, corrections, unknown } = correctOfferedIds('s1', [REAL]);

    expect(ids).toEqual([REAL]);
    expect(corrections).toEqual([]);
    expect(unknown).toEqual([]);
  });

  it('refuses to guess when two offered ids are equally close', () => {
    // Both differ from the candidate by exactly one character, so which song was
    // meant is unknowable. Substituting either would put a track on the card the
    // user never discussed, which is the bug this module exists to prevent.
    rememberOffered('s1', ['aaaaaaaaaaaaaaaaaaaaa1', 'aaaaaaaaaaaaaaaaaaaaa2']);

    const { ids, corrections, unknown } = correctOfferedIds('s1', ['aaaaaaaaaaaaaaaaaaaaa3']);

    expect(ids).toEqual(['aaaaaaaaaaaaaaaaaaaaa3']);
    expect(corrections).toEqual([]);
    expect(unknown).toEqual(['aaaaaaaaaaaaaaaaaaaaa3']);
  });

  it('leaves an id nothing like an offered one alone, and names it', () => {
    rememberOffered('s1', [REAL]);

    const { ids, unknown } = correctOfferedIds('s1', ['totallyInventedId00000']);

    expect(ids).toEqual(['totallyInventedId00000']);
    expect(unknown).toEqual(['totallyInventedId00000']);
  });

  it('does nothing at all for a session that has not searched', () => {
    const { ids, corrections, unknown } = correctOfferedIds('never-searched', [CORRUPTED]);

    expect(ids).toEqual([CORRUPTED]);
    expect(corrections).toEqual([]);
    expect(unknown).toEqual([]);
  });

  it('keeps sessions apart', () => {
    rememberOffered('s1', [REAL]);

    expect(correctOfferedIds('s2', [CORRUPTED]).ids).toEqual([CORRUPTED]);
  });

  it('accumulates across searches without repeating an id', () => {
    rememberOffered('s1', [REAL]);
    rememberOffered('s1', [REAL, '4uLU6hMCjMI75M1A2tKUQC']);

    expect(offeredIn('s1')).toEqual([REAL, '4uLU6hMCjMI75M1A2tKUQC']);
  });

  it('bounds what it remembers, so a long-lived process cannot grow', () => {
    for (let i = 0; i < 260; i += 1) rememberOffered(`session-${i}`, [`id-${i}`]);

    // The oldest sessions are gone; the newest are not.
    expect(offeredIn('session-0')).toEqual([]);
    expect(offeredIn('session-259')).toEqual(['id-259']);
  });
});
