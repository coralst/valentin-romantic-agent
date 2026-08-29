import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LEAD_TIME,
  getActByPlan,
  getLeadTime,
  getNextOccurrence,
  OCCASION_LEAD_TIMES,
} from '../lead-times';
import type { Occasion } from '../occasion-derivation';
import { daysBetween } from '../calendar-days';

/** 21 August 2026, the date the Stage 4 checkpoint shots were taken. */
const TODAY = new Date(2026, 7, 21);

function annual(fieldId: string, label: string, month: number, day: number): Occasion {
  return { fieldId, label, date: new Date(1990, month, day), recurrence: 'annual' };
}

describe('getLeadTime', () => {
  it('gives an anniversary a week, because a table competes with other plans', () => {
    expect(getLeadTime('anniversary')).toEqual({
      days: 7,
      verb: 'Book',
      ahead: '1 week ahead',
    });
  });

  it('gives a birthday two weeks, because a gift has to ship and arrive', () => {
    expect(getLeadTime('birthday').days).toBe(14);
    expect(getLeadTime('birthday').verb).toBe('Order');
  });

  it('falls back for a dated field with no entry of its own', () => {
    expect(getLeadTime('some_future_date_field')).toEqual(DEFAULT_LEAD_TIME);
  });

  it('keeps every lead time positive, so no deadline lands after the occasion', () => {
    for (const leadTime of Object.values(OCCASION_LEAD_TIMES)) {
      expect(leadTime.days).toBeGreaterThan(0);
    }
  });
});

describe('getNextOccurrence', () => {
  it('rolls an already-passed annual date into next year', () => {
    // 17 June is behind 21 August, so the next one is June 2027.
    const next = getNextOccurrence(annual('birthday', 'Birthday', 5, 17), TODAY);
    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(5);
    expect(next.getDate()).toBe(17);
  });

  it('keeps an annual date still ahead in the current year', () => {
    const next = getNextOccurrence(annual('anniversary', 'Anniversary', 8, 2), TODAY);
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(8);
    expect(next.getDate()).toBe(2);
  });

  it('returns the reference date itself when the occasion is today', () => {
    const next = getNextOccurrence(annual('birthday', 'Birthday', 7, 21), TODAY);
    expect(next.getTime()).toBe(TODAY.getTime());
  });
});

describe('getActByPlan', () => {
  it('puts the deadline a full lead time before the occasion', () => {
    // 2 September, minus the anniversary's 7 days, is 26 August — the mockup's
    // own worked example at option-5d-brief.html:293.
    const plan = getActByPlan(annual('anniversary', 'Anniversary', 8, 2), TODAY);
    expect(plan.label).toBe('Book by 26 Aug');
    expect(plan.ahead).toBe('1 week ahead');
    expect(plan.daysUntil).toBe(5);
    expect(plan.isOverdue).toBe(false);
  });

  it('uses the ordering verb for a birthday, and its longer lead', () => {
    // 30 September, minus the birthday's 14 days, is 16 September.
    const plan = getActByPlan(annual('birthday', 'Birthday', 8, 30), TODAY);
    expect(plan.label).toBe('Order by 16 Sept');
    expect(plan.ahead).toBe('2 weeks ahead');
    expect(plan.isOverdue).toBe(false);
  });

  it('drops the runway claim once the deadline has passed', () => {
    // Six days out with a seven-day lead: the window has already closed.
    const plan = getActByPlan(annual('anniversary', 'Anniversary', 7, 27), TODAY);
    expect(plan.isOverdue).toBe(true);
    expect(plan.ahead).toBe('Sooner the better');
    expect(plan.daysUntil).toBeLessThan(0);
  });

  it('treats a deadline falling exactly today as overdue', () => {
    // 28 August minus 7 days is 21 August, the reference date.
    const plan = getActByPlan(annual('anniversary', 'Anniversary', 7, 28), TODAY);
    expect(plan.daysUntil).toBe(0);
    expect(plan.isOverdue).toBe(true);
  });

  it('handles a one-time occasion as well as an annual one', () => {
    const plan = getActByPlan(
      {
        fieldId: 'anniversary',
        label: 'Anniversary',
        date: new Date(2026, 8, 2),
        recurrence: 'one-time',
      },
      TODAY,
    );
    expect(plan.label).toBe('Book by 26 Aug');
  });
});

/*
 * `getNextOccurrence` used to be `addDays(today, getDaysUntilOccasion(...))` — it
 * reconstructed the date from the count instead of reading it. So the count being
 * one day out (a daylight-saving hour that `Math.ceil` rounded up) did not merely
 * show a wrong number: it re-rendered as the wrong *date* and the wrong *weekday*.
 * A Sunday birthday was announced as "Monday 15 March", and the act-by line drifted
 * with it.
 */
describe('the occurrence date is read, not reconstructed', () => {
  const REFERENCE = new Date(2026, 7, 29); // Saturday 29 August 2026
  const birthday = {
    fieldId: 'birthday',
    label: 'Birthday',
    date: new Date(2001, 2, 14), // 14 March, year immaterial for an annual
    recurrence: 'annual' as const,
  };

  it('names the real next occurrence, on its real weekday', () => {
    const next = getNextOccurrence(birthday, REFERENCE);

    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(2);
    expect(next.getDate()).toBe(14);
    expect(next.getDay()).toBe(0); // Sunday, not Monday
  });

  it('counts the act-by deadline back from the occasion, not forward from today', () => {
    // A birthday's lead time is 14 days, so 14 March 2027 minus a fortnight.
    const plan = getActByPlan(birthday, REFERENCE);

    expect(plan.date.getMonth()).toBe(1); // February
    expect(plan.date.getDate()).toBe(28);
    expect(plan.label).toBe('Order by 28 Feb');
    expect(plan.isOverdue).toBe(false);
  });

  it('keeps the deadline exactly one lead time before the occasion', () => {
    const next = getNextOccurrence(birthday, REFERENCE);
    const plan = getActByPlan(birthday, REFERENCE);

    expect(daysBetween(plan.date, next)).toBe(14);
  });
});
