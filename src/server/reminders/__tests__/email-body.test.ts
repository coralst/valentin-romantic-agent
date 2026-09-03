import { describe, it, expect } from 'vitest';
import { buildReminderEmail, type ReminderEmailInput } from '../email-body';
import { RESUME_PARAM } from '../../../shared/constants/resume-link';

/**
 * These assertions are about honesty as much as formatting.
 *
 * A reminder is the only message this system sends with nobody in the
 * conversation to read it first, so the tests that matter most are the ones that
 * prove it does not claim a table was held, does not invent a fourth suggestion,
 * and always carries a way back into the chat.
 */

const BASE: ReminderEmailInput = {
  occasion: 'her birthday',
  occasionDate: new Date(2026, 5, 12), // Friday 12 June 2026, local
  daysUntil: 7,
  partnerName: 'Samantha',
  criteria: ['romantic and quiet', 'within 10 km of Ra’anana'],
  suggestions: [
    {
      name: 'Hotel Montefiore',
      area: 'Montefiore, Tel Aviv',
      reach: 'bookable',
      rating: 4.6,
      ratingCount: 2180,
      priceLevel: 3,
      availableTimes: ['19:30', '21:00'],
    },
    {
      name: 'Yaffo Tel Aviv',
      area: 'Tel Aviv',
      reach: 'bookable',
      rating: 4.4,
      ratingCount: 3905,
      priceLevel: 2,
      availableTimes: ['20:00'],
      previousRating: 4,
    },
    {
      name: 'Toto',
      area: 'Tel Aviv',
      reach: 'discovery',
      rating: 4.5,
      priceLevel: 3,
      url: 'https://maps.google.com/?cid=123',
    },
  ],
  origin: 'https://example.test',
  sessionId: 'sess-8f2c',
};

function build(overrides: Partial<ReminderEmailInput> = {}) {
  return buildReminderEmail({ ...BASE, ...overrides });
}

describe('buildReminderEmail', () => {
  it('puts the when and the count in the subject', () => {
    const { subject } = build();
    expect(subject).toContain('a week away');
    expect(subject).toContain('three ideas');
    expect(subject).toContain('Samantha');
  });

  it('falls back to "Her" when the name is not known', () => {
    const { subject, body } = build({ partnerName: null });
    expect(subject).not.toContain('null');
    expect(subject).not.toContain('undefined');
    expect(body).not.toContain('undefined');
  });

  it('names the date in words, never as an ambiguous numeric format', () => {
    const { body } = build();
    expect(body).toContain('Friday 12 June');
    expect(body).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
  });

  it('restates the criteria so the choices are auditable', () => {
    const { body } = build();
    expect(body).toContain('romantic and quiet');
    expect(body).toContain('within 10 km of Ra’anana');
  });

  it('caps at three suggestions however many it is handed', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      ...BASE.suggestions[0],
      name: `Venue ${i}`,
    }));
    const { body, subject } = build({ suggestions: many });
    expect(body).toContain('Venue 0');
    expect(body).toContain('Venue 2');
    expect(body).not.toContain('Venue 3');
    expect(subject).toContain('three ideas');
  });

  it('labels reach on every row, not once at the bottom', () => {
    const { body } = build();
    const bookable = body.match(/Bookable through me/g) ?? [];
    expect(bookable).toHaveLength(2);
    expect(body).toContain('I cannot book this one');
    expect(body).toContain('https://maps.google.com/?cid=123');
  });

  it('offers to check times for a bookable row with none known', () => {
    const { body } = build({
      suggestions: [{ ...BASE.suggestions[0], availableTimes: [] }],
    });
    expect(body).toContain('reply and I will check the times');
  });

  it('recalls what the user said about a place they have been', () => {
    const { body } = build();
    expect(body).toContain('rated it 4/5');
  });

  it('never claims anything was reserved', () => {
    const { subject, body } = build();
    const text = `${subject}\n${body}`.toLowerCase();
    // The one lie that would reach a real person about a real restaurant.
    expect(text).not.toContain('booked');
    expect(text).not.toContain('reserved for');
    expect(text).not.toContain('i have held');
    expect(body).toContain('Nothing is reserved');
  });

  it('renders ratings and price without inventing an amount', () => {
    const { body } = build();
    expect(body).toContain('4.6★ (2,180)');
    expect(body).toContain('₪₪₪');
    // A price *level* is not a charge, so no currency amount may appear.
    expect(body).not.toMatch(/₪\s?\d/);
  });

  it('omits facts it does not have rather than printing a placeholder', () => {
    const { body } = build({
      suggestions: [
        {
          name: 'Somewhere',
          area: 'Tel Aviv',
          reach: 'bookable',
          rating: null,
          priceLevel: null,
        },
      ],
    });
    expect(body).toContain('Somewhere, Tel Aviv');
    expect(body).not.toContain('★');
    expect(body).not.toContain('₪');
    expect(body).not.toContain('null');
  });

  it('ends with the resume link and the signature', () => {
    const { body } = build();
    expect(body).toContain(`?${RESUME_PARAM}=sess-8f2c`);
    expect(body.trimEnd().endsWith('— Valentin')).toBe(true);
    // The link is the call to action, so it comes after the suggestions.
    // Matched on the whole query, not on RESUME_PARAM alone — that is one letter
    // and occurs all over the prose.
    expect(body.indexOf(`?${RESUME_PARAM}=sess-8f2c`)).toBeGreaterThan(
      body.indexOf('Toto'),
    );
  });

  it('still sends when nothing was found, and says so', () => {
    const { subject, body } = build({ suggestions: [] });
    expect(subject).toContain('a week away');
    expect(subject).not.toContain('ideas');
    expect(body).toContain('not found anything');
    // The way back in matters more here than anywhere else.
    expect(body).toContain(`?${RESUME_PARAM}=sess-8f2c`);
  });

  it('says the gap the way a person would', () => {
    expect(build({ daysUntil: 1 }).subject).toContain('tomorrow');
    expect(build({ daysUntil: 0 }).subject).toContain('today');
    expect(build({ daysUntil: 14 }).subject).toContain('two weeks away');
    expect(build({ daysUntil: 30 }).subject).toContain('a month away');
    expect(build({ daysUntil: 3 }).subject).toContain('3 days away');
  });

  it('is pure — the same input twice gives the same bytes', () => {
    expect(build()).toEqual(build());
  });
});
