import { describe, it, expect } from 'vitest';
import { DEMO_PEOPLE } from '../demo-people';
import { DEMO_TASKS, resolveDemoTasks } from '../demo-tasks';
import { isGap } from '../../../shared/interfaces/person';

/**
 * The fixtures are keyed by hand-written ids, and a person or a task is stored at
 * its own id. A duplicate would not fail loudly — it would overwrite, and the
 * board would simply be missing someone. That is the class of bug these pin.
 */
describe('her family, as seeded', () => {
  it('gives every person a distinct id', () => {
    const ids = DEMO_PEOPLE.map((person) => person.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('puts somebody on all four rungs', () => {
    const rungs = new Set(DEMO_PEOPLE.map((person) => person.generation));
    expect([...rungs].sort()).toEqual(['elder', 'grandparent', 'peer', 'younger']);
  });

  it('records exactly two people whose names nobody has said', () => {
    // Deliberate, and the state the whole nullable-name design exists for. If a
    // later edit "tidies" them by inventing names, the dashed card and the "ask
    // her" prompt stop appearing in the demo at all.
    expect(DEMO_PEOPLE.filter((person) => isGap(person as never))).toHaveLength(2);
  });

  it('always says how someone is related, even when it cannot say who', () => {
    for (const person of DEMO_PEOPLE) {
      expect(person.relationship.trim().length).toBeGreaterThan(0);
    }
  });

  it('leaves some birthdays unknown, so the empty state is on screen', () => {
    const known = DEMO_PEOPLE.filter((person) => Boolean(person.birthday));
    expect(known.length).toBeGreaterThan(0);
    expect(known.length).toBeLessThan(DEMO_PEOPLE.length);
  });

  it('writes birthdays as plain ISO dates', () => {
    for (const person of DEMO_PEOPLE) {
      if (!person.birthday) continue;
      expect(person.birthday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('his to-do list, as seeded', () => {
  it('gives every task a distinct id', () => {
    const ids = DEMO_TASKS.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ships two already ticked', () => {
    expect(DEMO_TASKS.filter((task) => task.done)).toHaveLength(2);
    expect(DEMO_TASKS.filter((task) => !task.done).length).toBeGreaterThan(0);
  });

  it('covers every due state the row can render', () => {
    const offsets = DEMO_TASKS.map((task) => task.dueInDays);
    expect(offsets).toContain(0); // today
    expect(offsets).toContain(null); // sometime
    expect(offsets.some((days) => days !== null && days > 0)).toBe(true);
    expect(offsets.some((days) => days !== null && days < 0)).toBe(true);
  });

  it('resolves offsets against the moment it is given', () => {
    // Pinned to a fixed instant rather than `Date.now()`: the point is that the
    // dates move *with* the clock, which a test reading the same clock cannot see.
    const now = Date.UTC(2026, 8, 4); // 4 September 2026

    const resolved = resolveDemoTasks(DEMO_TASKS, now);

    const byId = new Map(resolved.map((task) => [task.id, task]));
    expect(byId.get('demo-task-ask-about-the-18th')?.due).toBe('2026-09-04');
    expect(byId.get('demo-task-book-what-she-picks')?.due).toBe('2026-09-11');
    expect(byId.get('demo-task-order-glaze-set')?.due).toBeNull();
    expect(byId.get('demo-task-ask-nadia')?.due).toBe('2026-08-26');
  });

  it('stamps created and updated at the seed moment, not at import time', () => {
    const now = Date.UTC(2026, 8, 4);

    for (const task of resolveDemoTasks(DEMO_TASKS, now)) {
      expect(task.createdAt).toBe(new Date(now).toISOString());
      expect(task.updatedAt).toBe(task.createdAt);
    }
  });

  it('drops the offset field, so nothing downstream sees a fixture-only shape', () => {
    for (const task of resolveDemoTasks(DEMO_TASKS, Date.UTC(2026, 8, 4))) {
      expect('dueInDays' in task).toBe(false);
    }
  });

  it('says something useful on the second line of every row', () => {
    for (const task of DEMO_TASKS) {
      expect(task.title.trim().length).toBeGreaterThan(0);
      expect((task.note ?? '').trim().length).toBeGreaterThan(0);
    }
  });

  it('distinguishes what Valentin raised from what the user wrote down', () => {
    // A seed where all six read the same way would never show the difference the
    // row is styled to show.
    const sources = new Set(DEMO_TASKS.map((task) => task.source));
    expect([...sources].sort()).toEqual(['discovered', 'manual']);
  });
});
