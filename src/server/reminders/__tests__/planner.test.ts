import { describe, it, expect } from 'vitest';
import { planReminders, type PlanRemindersInput } from '../planner';
import { REMINDER_ZONE, reminderId } from '../../../shared/interfaces/reminder';

const base: PlanRemindersInput = {
  sessionId: 'session-1',
  userId: 'user-1',
  channel: 'log',
  target: 'him@example.com',
};

/** The wall clock in Israel for an instant, so assertions read as the user's day. */
function wall(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: REMINDER_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date(iso))
    .replace(', ', 'T');
}

describe('planReminders — recurring dates', () => {
  it('projects a birthday decades old onto its next occurrence', () => {
    const now = new Date('2026-03-01T08:00:00Z');
    const [reminder] = planReminders({ ...base, birthday: '1988-06-12' }, now);

    expect(reminder.kind).toBe('birthday');
    expect(reminder.occursOn).toBe('2026-06-12');
    expect(reminder.id).toBe(reminderId('birthday', '2026-06-12'));
    expect(reminder.leadDays).toBe(7);
  });

  it('crosses the year boundary when the date has already gone', () => {
    // Sweeping on 20 December: February is next year's February.
    const now = new Date('2026-12-20T08:00:00Z');
    const [reminder] = planReminders({ ...base, birthday: '1990-02-03' }, now);

    expect(reminder.occursOn).toBe('2027-02-03');
  });

  it('keeps a date that is still to come this year', () => {
    const now = new Date('2026-06-11T02:00:00Z');
    const [reminder] = planReminders(
      { ...base, anniversary: '2015-06-30', reminderLeadTime: '1 day before' },
      now,
    );

    expect(reminder.kind).toBe('anniversary');
    expect(reminder.occursOn).toBe('2026-06-30');
  });

  it('observes a 29 February birthday on the 28th in a common year', () => {
    const now = new Date('2026-01-05T08:00:00Z');
    const [reminder] = planReminders({ ...base, birthday: '1992-02-29' }, now);

    // 2026 is not a leap year: the alternative is reminding her every fourth year.
    expect(reminder.occursOn).toBe('2026-02-28');
  });

  it('keeps 29 February in a leap year', () => {
    const now = new Date('2028-01-05T08:00:00Z');
    const [reminder] = planReminders({ ...base, birthday: '1992-02-29' }, now);

    expect(reminder.occursOn).toBe('2028-02-29');
  });

  it('plans both recurring dates, soonest first', () => {
    const now = new Date('2026-01-01T08:00:00Z');
    const planned = planReminders(
      { ...base, birthday: '1988-06-12', anniversary: '2015-03-04' },
      now,
    );

    expect(planned.map((r) => r.kind)).toEqual(['anniversary', 'birthday']);
  });
});

describe('planReminders — dueAt', () => {
  it('pins the send to 08:30 Israel time, lead days before the occasion', () => {
    const now = new Date('2026-01-01T08:00:00Z');
    const [reminder] = planReminders({ ...base, birthday: '1988-06-12' }, now);

    // Summer, so Israel is UTC+3: 08:30 local is 05:30Z.
    expect(wall(reminder.dueAt)).toBe('2026-06-05T08:30');
    expect(reminder.dueAt).toBe('2026-06-05T05:30:00.000Z');
  });

  it('still pins 08:30 across the winter offset', () => {
    const now = new Date('2026-01-01T08:00:00Z');
    const [reminder] = planReminders({ ...base, birthday: '1988-02-10' }, now);

    // Winter is UTC+2, so the same wall clock is a different instant.
    expect(wall(reminder.dueAt)).toBe('2026-02-03T08:30');
    expect(reminder.dueAt).toBe('2026-02-03T06:30:00.000Z');
  });

  it('sends at once for a date learned inside the lead window', () => {
    /*
     * A week's notice and a birthday three days away. There is no crossing left to
     * wait for — the window opened four days ago — so the row is due immediately
     * rather than dropped, and the next sweep mails it.
     *
     * The body cannot misstate the gap: `dispatcher.bodyFor` recomputes it from
     * `occursOn` at send time, so this mails "three days away".
     */
    const now = new Date('2026-06-09T08:00:00Z');
    const [reminder] = planReminders({ ...base, birthday: '1988-06-12' }, now);

    expect(reminder.dueAt).toBe(now.toISOString());
    expect(reminder.occursOn).toBe('2026-06-12');
    // The planned notice is still recorded as what the profile asked for.
    expect(reminder.leadDays).toBe(7);
  });

  it('produces nothing once the occasion itself has passed', () => {
    /*
     * The clamp above must never resurrect something behind us. A one-off occasion
     * in the past is not projected forward — there is no second promotion dinner.
     */
    const now = new Date('2026-06-09T08:00:00Z');
    expect(
      planReminders({ ...base, birthday: null, nextOccasion: '2026-06-01@the dinner' }, now),
    ).toEqual([]);
  });

  it('honours a shorter lead time on the same near date', () => {
    const now = new Date('2026-06-09T08:00:00Z');
    const [reminder] = planReminders(
      { ...base, birthday: '1988-06-12', reminderLeadTime: '1 day before' },
      now,
    );

    expect(wall(reminder.dueAt)).toBe('2026-06-11T08:30');
  });

  it('defaults to a week when the lead-time field is unset', () => {
    const now = new Date('2026-01-01T08:00:00Z');
    const [unset] = planReminders({ ...base, birthday: '1988-06-12' }, now);
    const [explicit] = planReminders(
      { ...base, birthday: '1988-06-12', reminderLeadTime: '1 week before' },
      now,
    );

    expect(unset.leadDays).toBe(7);
    expect(unset.dueAt).toBe(explicit.dueAt);
  });

  it('falls back to a week for a lead time it does not recognise', () => {
    const now = new Date('2026-01-01T08:00:00Z');
    const [reminder] = planReminders(
      { ...base, birthday: '1988-06-12', reminderLeadTime: 'a bit before' },
      now,
    );

    expect(reminder.leadDays).toBe(7);
  });
});

describe('planReminders — next_occasion', () => {
  it('parses the date and the description out of "YYYY-MM-DD@what it is"', () => {
    const now = new Date('2026-09-01T08:00:00Z');
    const [reminder] = planReminders(
      { ...base, nextOccasion: '2026-10-04@her promotion dinner' },
      now,
    );

    expect(reminder.kind).toBe('occasion');
    expect(reminder.occursOn).toBe('2026-10-04');
    expect(reminder.occasion).toBe('her promotion dinner');
  });

  it('still uses a value with no @, with a neutral description', () => {
    const now = new Date('2026-09-01T08:00:00Z');
    const [reminder] = planReminders({ ...base, nextOccasion: '2026-10-04' }, now);

    expect(reminder.kind).toBe('occasion');
    expect(reminder.occasion).toBe('the date you are planning');
  });

  it('does not re-project a one-off occasion that has passed', () => {
    // Re-projecting a year forward would invent a second promotion dinner.
    const now = new Date('2026-09-01T08:00:00Z');
    expect(planReminders({ ...base, nextOccasion: '2026-08-04@her promotion dinner' }, now)).toEqual(
      [],
    );
  });
});

describe('planReminders — bad input', () => {
  it('yields nothing at all for an empty profile', () => {
    expect(planReminders(base, new Date('2026-01-01T08:00:00Z'))).toEqual([]);
  });

  it('silently skips a value with no parseable date', () => {
    const now = new Date('2026-01-01T08:00:00Z');
    const planned = planReminders(
      { ...base, birthday: "March, she's turning 30", anniversary: '2015-03-04' },
      now,
    );

    expect(planned.map((r) => r.kind)).toEqual(['anniversary']);
  });

  it('rejects an impossible month rather than rolling it over', () => {
    const now = new Date('2026-01-01T08:00:00Z');
    expect(planReminders({ ...base, birthday: '1988-13-12' }, now)).toEqual([]);
  });

  it('records a null target rather than dropping the reminder', () => {
    const now = new Date('2026-01-01T08:00:00Z');
    const [reminder] = planReminders({ ...base, target: null, birthday: '1988-06-12' }, now);

    expect(reminder.target).toBeNull();
    expect(reminder.sentAt).toBeNull();
    expect(reminder.attempts).toBe(0);
    expect(reminder.lastError).toBeNull();
    expect(reminder.createdAt).toBe(now.toISOString());
  });

  it('is idempotent: the same profile re-plans to the same ids', () => {
    const now = new Date('2026-01-01T08:00:00Z');
    const input = { ...base, birthday: '1988-06-12', reminderLeadTime: '1 week before' };
    const first = planReminders(input, now);
    const second = planReminders({ ...input, reminderLeadTime: '2 weeks before' }, now);

    // Changing the lead time must move the reminder, not add a second one.
    expect(second[0].id).toBe(first[0].id);
    expect(second[0].dueAt).not.toBe(first[0].dueAt);
  });
});
