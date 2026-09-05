import { describe, it, expect } from 'vitest';
import type { Outing } from '../../../shared/interfaces/outing';
import type { Reminder } from '../../../shared/interfaces/reminder';
import { InMemoryStoreFactory } from '../../persistence/in-memory-store';
import { CURATED_VENUES } from '../../integrations/ontopo/venues';
import {
  activityFor,
  composeReminderContext,
  reminderContextFor,
  type ComposeInput,
} from '../suggestions';
import { dispatchDue } from '../dispatcher';
import { syncReminders } from '../reminder-sync';
import type { ReminderEmail } from '../email-body';
import type { ReminderSender } from '../sender';

/**
 * What the automatic mail is *about*.
 *
 * The dispatcher's own tests cover the claim and the counts; these cover the content,
 * and the invariant behind almost all of them is the same one `email-body.ts` states in
 * its header — nobody is reading this mail before it goes out, so every fact in it has
 * to come from a stored answer or a curated row. The tests that matter most are
 * therefore the negative ones: what the mail must *not* say when the profile is thin.
 */

const BIRTHDAY: Pick<Reminder, 'kind' | 'title' | 'occasion' | 'occursOn'> = {
  kind: 'birthday',
  title: null,
  occasion: 'birthday',
  // A Friday, so the weekly-rhythm assertions below have a day to match on.
  occursOn: '2026-06-12',
};

function input(overrides: Partial<ComposeInput> = {}): ComposeInput {
  return {
    reminder: BIRTHDAY,
    partnerName: null,
    favoriteCuisine: null,
    restaurantStyle: null,
    homeCity: null,
    musicGenre: null,
    weeklyRhythm: null,
    outings: [],
    ...overrides,
  };
}

function outing(overrides: Partial<Outing> = {}): Outing {
  return {
    id: 'outing-1',
    venueName: 'Hotel Montefiore',
    venueSlug: '33687997',
    city: 'Tel Aviv',
    occursOn: '2025-06-12',
    confirmedAt: '2025-06-12T18:00:00.000Z',
    rating: 5,
    ...overrides,
  };
}

describe('activityFor', () => {
  it('treats a reminder he wrote himself as an errand', () => {
    expect(activityFor({ ...BIRTHDAY, kind: 'custom', title: 'Call the florist' })).toBe('errand');
  });

  it('reads an evening in out of his own description of the occasion', () => {
    for (const said of ['a night in at home', 'cooking for her', 'movie night']) {
      expect(activityFor({ ...BIRTHDAY, kind: 'occasion', occasion: said })).toBe('at_home');
    }
  });

  it('falls back to dinner out for anything it cannot read', () => {
    // The recoverable direction: a restaurant he did not want is an idea he ignores,
    // where silence about an evening in is a reminder that did nothing.
    expect(activityFor({ ...BIRTHDAY, occasion: 'the thing on the 12th' })).toBe('restaurant');
    expect(activityFor(BIRTHDAY)).toBe('restaurant');
  });
});

describe('composeReminderContext — dinner out', () => {
  it('offers bookable curated venues, with the area and page Ontopo gave them', () => {
    const context = composeReminderContext(input());

    expect(context.activity).toBe('restaurant');
    expect(context.suggestions.length).toBeGreaterThan(0);
    for (const suggestion of context.suggestions) {
      // Every row must be a real curated venue: an invented restaurant is the one
      // failure mode this whole module exists to prevent.
      expect(CURATED_VENUES.map((v) => v.name)).toContain(suggestion.name);
      expect(suggestion.reach).toBe('bookable');
      expect(suggestion.url).toMatch(/^https:\/\/ontopo\.com\/en\/il\/[a-z-]+\/page\/\d+$/);
      // No availability call was made, so no time may be claimed as free.
      expect(suggestion.availableTimes).toEqual([]);
    }
  });

  it('states the criteria it actually searched on', () => {
    const context = composeReminderContext(
      input({
        favoriteCuisine: 'Mediterranean',
        restaurantStyle: 'Romantic & quiet',
        homeCity: 'Tel Aviv',
      }),
    );

    expect(context.criteria).toEqual([
      'she loves Mediterranean',
      'romantic & quiet',
      'near Tel Aviv',
    ]);
  });

  it('claims no criteria when the search matched nothing and it fell back', () => {
    /*
     * The honesty case. Nothing on a Tel Aviv list serves Peruvian food in Haifa, so
     * the suggestions are the fallback ordering rather than a match — and
     * `email-body.ts` renders criteria as "here is what fits what you have told me",
     * which would be a lie over a list that fit none of it.
     */
    const context = composeReminderContext(
      input({ favoriteCuisine: 'Peruvian', homeCity: 'Haifa' }),
    );

    expect(context.suggestions.length).toBeGreaterThan(0);
    expect(context.criteria).toEqual([]);
  });

  it('ignores a restaurant style it does not recognise rather than returning nothing', () => {
    const context = composeReminderContext(input({ restaurantStyle: 'somewhere nice' }));

    expect(context.suggestions.length).toBeGreaterThan(0);
    expect(context.criteria).not.toContain('somewhere nice');
  });

  it('leads with a place she has already rated', () => {
    const liked = CURATED_VENUES[4];
    const context = composeReminderContext(
      input({ outings: [outing({ venueSlug: liked.slug, venueName: liked.name, rating: 5 })] }),
    );

    expect(context.suggestions[0].name).toBe(liked.name);
    expect(context.suggestions[0].previousRating).toBe(5);
  });

  it('matches an outing recorded by hand on its name, since it carries no slug', () => {
    const context = composeReminderContext(
      input({ outings: [outing({ venueSlug: undefined, venueName: 'hotel montefiore', rating: 4 })] }),
    );

    expect(context.suggestions[0]).toMatchObject({ name: 'Hotel Montefiore', previousRating: 4 });
  });

  it('ignores an outing with no rating — an unanswered survey says nothing', () => {
    const context = composeReminderContext(input({ outings: [outing({ rating: null })] }));

    for (const suggestion of context.suggestions) {
      expect(suggestion.previousRating).toBeUndefined();
    }
  });
});

describe('composeReminderContext — an evening in', () => {
  const staying = { ...BIRTHDAY, kind: 'occasion' as const, occasion: 'a quiet night in at home' };

  it('suggests no restaurants at all', () => {
    const context = composeReminderContext(input({ reminder: staying, favoriteCuisine: 'Thai' }));

    expect(context.activity).toBe('at_home');
    expect(context.suggestions).toEqual([]);
  });

  it('hands back only what he has already told Valentin', () => {
    const context = composeReminderContext(
      input({ reminder: staying, favoriteCuisine: 'Thai', musicGenre: 'Nina Simone' }),
    );

    expect(context.ideas).toEqual([
      'She loves Thai — cook it or order it in.',
      'Put Nina Simone on. I can build the playlist if Spotify is connected.',
    ]);
  });

  it('offers nothing when it knows nothing, rather than inventing an evening', () => {
    expect(composeReminderContext(input({ reminder: staying })).ideas).toEqual([]);
  });
});

describe('composeReminderContext — his own reminder', () => {
  it('adds nothing to a reminder he wrote himself', () => {
    const context = composeReminderContext(
      input({
        reminder: { ...BIRTHDAY, kind: 'custom', title: 'Call the florist' },
        favoriteCuisine: 'Thai',
      }),
    );

    expect(context.activity).toBe('errand');
    expect(context.suggestions).toEqual([]);
    expect(context.ideas).toEqual([]);
  });
});

describe('composeReminderContext — the timing note', () => {
  it('names what she has on that evening, when the profile says', () => {
    // 12 June 2026 is a Friday.
    const context = composeReminderContext(
      input({ weeklyRhythm: 'Tue@pottery until nine@heavy, Fri@dinner with her sister@medium' }),
    );

    expect(context.timingNote).toBe(
      'That is a Friday, and you have told me dinner with her sister — worth planning around.',
    );
  });

  it('reads a weekday written out in full', () => {
    const context = composeReminderContext(input({ weeklyRhythm: 'Friday@her late shift@heavy' }));

    expect(context.timingNote).toContain('her late shift');
  });

  it('says nothing when that day is free, or when her week is unknown', () => {
    expect(composeReminderContext(input({ weeklyRhythm: 'Tue@pottery@heavy' })).timingNote).toBeNull();
    expect(composeReminderContext(input()).timingNote).toBeNull();
  });
});

/** A sender that keeps what it was handed, so the body can be asserted. */
function recordingSender(): ReminderSender & { sent: { to: string; email: ReminderEmail }[] } {
  return {
    channel: 'recording',
    sent: [],
    async send(to, email) {
      this.sent.push({ to, email });
    },
  };
}

/**
 * The whole send path against a real store: profile in, mail out.
 *
 * The unit tests above cover the composition and the dispatcher's own tests cover the
 * claim; this is the seam between them, which is where the bug would actually live —
 * `suggestions: []` sat hardcoded in `bodyFor` for exactly as long as nothing asserted
 * a suggestion had reached an inbox.
 */
describe('the composed reminder, end to end', () => {
  const NOW = new Date('2026-06-05T05:30:00.000Z');

  async function seeded(profile: Record<string, string>): Promise<InMemoryStoreFactory> {
    const factory = new InMemoryStoreFactory();
    const store = factory.forUser('user-1');
    const sessionId = await store.createSession();
    for (const [fieldId, value] of Object.entries(profile)) {
      await store.savePreference({
        sessionId,
        category: 'important_dates',
        key: fieldId,
        fieldId,
        value,
        confidence: 0.9,
        sourceMessageId: 'msg-1',
      });
    }
    await store.saveReminder(sessionId, {
      id: 'anniversary-2026-06-12',
      sessionId,
      userId: 'user-1',
      kind: 'anniversary',
      occursOn: '2026-06-12',
      dueAt: NOW.toISOString(),
      leadDays: 7,
      occasion: 'anniversary',
      channel: 'log',
      target: 'him@example.com',
      sentAt: null,
      attempts: 0,
      lastError: null,
      createdAt: '2026-06-01T08:00:00.000Z',
    });
    return factory;
  }

  it('mails real bookable restaurants, her name, and the evening she is busy', async () => {
    const factory = await seeded({
      partner_name: 'Maya',
      favorite_cuisine: 'Mediterranean',
      restaurant_style: 'Romantic & quiet',
      home_city: 'Tel Aviv',
      weekly_rhythm: 'Fri@dinner with her sister@medium',
    });
    const sender = recordingSender();

    const summary = await dispatchDue(factory, sender, NOW, {
      origin: 'https://valentin.example.com',
      context: (reminder) => reminderContextFor(factory.forUser(reminder.userId), reminder),
    });

    expect(summary.sent).toBe(1);
    const { subject, body } = sender.sent[0].email;
    expect(subject).toBe("Maya's anniversary is a week away — three ideas");
    expect(body).toContain('she loves Mediterranean');
    expect(body).toContain('dinner with her sister');
    expect(body).toContain('Bookable through me');
    // The line the old body was stuck on, now that there is something to offer.
    expect(body).not.toContain('I have not found anything worth suggesting yet');
    // And still nothing held: no availability was checked and no table was reserved.
    expect(body).not.toMatch(/reserved for you|booked|your table at/i);
    expect(body).toContain('Nothing is reserved');
  });

  it('still sends the date when the profile has nothing else on it', async () => {
    const factory = await seeded({});
    const sender = recordingSender();

    await dispatchDue(factory, sender, NOW, {
      context: (reminder) => reminderContextFor(factory.forUser(reminder.userId), reminder),
    });

    const { subject, body } = sender.sent[0].email;
    // A thin profile still gets the curated list, so the mail is useful rather than
    // apologetic — and says "here is what I found", claiming no criteria.
    expect(subject).toContain('Her anniversary is a week away');
    expect(body).toContain('Here is what I found:');
    expect(body).toContain('Friday 12 June');
  });

  /*
   * The two timings the demo is built on, asserted through the same path production
   * uses — `syncReminders` for the arming and `dispatchDue` for the send — rather than
   * against `planReminders` alone, because the interesting half is what the sweeper
   * does with the row afterwards.
   */
  describe('the demo timings', () => {
    /** Arm from a profile, then sweep once, and report what went out. */
    async function armAndSweep(occursOn: string, now: Date) {
      const factory = new InMemoryStoreFactory();
      const store = factory.forUser('user-1');
      const sessionId = await store.createSession();
      for (const [fieldId, value] of Object.entries({
        next_occasion: `${occursOn}@our third anniversary`,
        notify_email: 'him@example.com',
        partner_name: 'Maya',
      })) {
        await store.savePreference({
          sessionId,
          category: 'important_dates',
          key: fieldId,
          fieldId,
          value,
          confidence: 0.9,
          sourceMessageId: 'msg-1',
        });
      }
      await syncReminders(store, sessionId, now);
      const [armed] = await store.getRemindersBySession(sessionId);
      const sender = recordingSender();
      const summary = await dispatchDue(factory, sender, now, {
        context: (reminder) => reminderContextFor(factory.forUser(reminder.userId), reminder),
      });
      return { armed, sender, summary };
    }

    it('sends at once for an occasion five days out, with the default week of notice', async () => {
      // He is inside the window already, so there is no crossing left to wait for.
      const now = new Date('2026-06-07T11:00:00.000Z');
      const { armed, sender } = await armAndSweep('2026-06-12', now);

      expect(armed.leadDays).toBe(7);
      expect(armed.dueAt).toBe(now.toISOString());
      expect(sender.sent).toHaveLength(1);
      // His own phrasing for the occasion, not "Maya's our third anniversary".
      expect(sender.sent[0].email.subject).toBe('Our third anniversary is 5 days away — three ideas');
    });

    it('waits until 08:30 tomorrow for an occasion eight days out', async () => {
      const now = new Date('2026-06-04T11:00:00.000Z');
      const { armed, sender } = await armAndSweep('2026-06-12', now);

      // 08:30 on the 5th in Israel, which is summer time, so 05:30Z.
      expect(armed.dueAt).toBe('2026-06-05T05:30:00.000Z');
      expect(sender.sent).toHaveLength(0);

      // And the sweep that runs after that moment sends it.
      const factory = new InMemoryStoreFactory();
      await factory.forUser('user-1').saveReminder(armed.sessionId, armed);
      const later = recordingSender();
      await dispatchDue(factory, later, new Date('2026-06-05T05:30:01.000Z'));
      expect(later.sent).toHaveLength(1);
    });
  });

  it('sends the date and nothing else when the profile read fails', async () => {
    const factory = await seeded({ favorite_cuisine: 'Mediterranean' });
    const sender = recordingSender();
    const broken = {
      forUser: (userId: string) =>
        Object.assign(Object.create(factory.forUser(userId)), {
          getPreferencesBySession: async (): Promise<never> => {
            throw new Error('ProvisionedThroughputExceededException');
          },
        }),
    };

    const summary = await dispatchDue(factory, sender, NOW, {
      context: (reminder) => reminderContextFor(broken.forUser(reminder.userId), reminder),
    });

    // The reminder is the thing the user is owed; the suggestions are a bonus.
    expect(summary.sent).toBe(1);
    expect(sender.sent[0].email.body).toContain('I have not found anything worth suggesting yet');
  });
});
