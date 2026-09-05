import { describe, it, expect } from 'vitest';
import {
  MUTABLE_REMINDER_KINDS,
  mutedReminderKinds,
  PROFILE_FIELD_GUIDANCE,
} from '../constants/profile-fields';
import { PLANNER_KINDS } from '../interfaces/reminder';

/**
 * The two lists that have to agree for muting to mean anything.
 *
 * `MUTABLE_REMINDER_KINDS` is the extraction vocabulary and `PLANNER_KINDS` is the
 * storage contract, and they are written out separately on purpose — see the comment
 * on the former. Separately written is fine; separately *drifting* is not: a fourth
 * planner kind that nobody can mute is a reminder with no off switch, and a mutable
 * kind the planner never emits is a mute that silently does nothing.
 */

describe('the mute vocabulary', () => {
  it('is exactly the set of kinds the planner derives', () => {
    expect([...MUTABLE_REMINDER_KINDS].sort()).toEqual([...PLANNER_KINDS].sort());
  });

  it('never includes custom — a hand-set reminder is cancelled by asking', () => {
    expect(MUTABLE_REMINDER_KINDS as readonly string[]).not.toContain('custom');
  });

  it('names every mutable kind in the guidance the model reads', () => {
    for (const kind of MUTABLE_REMINDER_KINDS) {
      expect(PROFILE_FIELD_GUIDANCE.reminders_muted).toContain(kind);
    }
  });
});

describe('mutedReminderKinds', () => {
  it('reads a comma-separated list, in any casing or spacing', () => {
    expect(mutedReminderKinds(' Birthday ,anniversary')).toEqual(['birthday', 'anniversary']);
  });

  it('folds the phrasings of the occasion onto one kind', () => {
    expect(mutedReminderKinds('the next occasion')).toEqual(['occasion']);
    expect(mutedReminderKinds('occasion, next occasion')).toEqual(['occasion']);
  });

  it('mutes nothing for absent, empty or unrecognisable values', () => {
    expect(mutedReminderKinds(null)).toEqual([]);
    expect(mutedReminderKinds('')).toEqual([]);
    expect(mutedReminderKinds(' , ')).toEqual([]);
    // Dropped rather than throwing or muting broadly: this runs inside a chat turn,
    // and over-muting is silence the user has no way to notice.
    expect(mutedReminderKinds('her cake day')).toEqual([]);
  });
});
