import { describe, it, expect } from 'vitest';
import {
  parsePalette,
  parsePrice,
  parseShortlist,
  parseWeeklyRhythm,
  rhythmHeight,
} from '../list-field-parsing';

/*
 * Every parser here is total, and that is the property worth pinning. These three
 * fields are extracted from conversation, so the values arrive in whatever shape
 * the model half-understood — and a tile that renders nothing for a field that is
 * on file is a tile you cannot correct.
 */

describe('parsePalette', () => {
  it('keeps her words and colours the ones it can', () => {
    const shades = parsePalette('Deep sage, Linen, Oat, Blush');
    expect(shades.map((shade) => shade.name)).toEqual(['Deep sage', 'Linen', 'Oat', 'Blush']);
    expect(shades.every((shade) => shade.hex !== null)).toBe(true);
  });

  it('matches on the last word, so a modifier does not lose the hue', () => {
    // "deep sage", "pale sage" and "sage" are all sage. The modifier changes the
    // shade less than getting the hue wrong would.
    const [deep, pale] = parsePalette('deep sage, pale sage');
    expect(deep.hex).toBe(pale.hex);
  });

  it('refuses to invent a colour for a name nobody could colour', () => {
    // The card draws these as a label with no swatch. Guessing a hex for "her
    // mother's blue" would be the board asserting something nobody said.
    const [shade] = parsePalette("her mother's favourite");
    expect(shade.name).toBe("her mother's favourite");
    expect(shade.hex).toBeNull();
  });

  it('answers with nothing for an empty field rather than one blank shade', () => {
    expect(parsePalette(null)).toEqual([]);
    expect(parsePalette('')).toEqual([]);
    expect(parsePalette(' , , ')).toEqual([]);
  });
});

describe('parseShortlist', () => {
  it('splits the name from the price', () => {
    expect(parseShortlist('Ceramic glaze set@62, Linen apron@34')).toEqual([
      { name: 'Ceramic glaze set', price: 62 },
      { name: 'Linen apron', price: 34 },
    ]);
  });

  it('reads a price with a symbol and a separator in it', () => {
    expect(parseShortlist('The good camera@£1,200')[0].price).toBe(1200);
  });

  it('keeps an unpriced item rather than dropping it or calling it free', () => {
    // A shortlist item with no price is an ordinary entry. Zero would be a lie
    // about the one number the card exists to compare against his budget.
    expect(parseShortlist('Poetry anthology')).toEqual([
      { name: 'Poetry anthology', price: null },
    ]);
    expect(parseShortlist('Something@sometime')[0].price).toBeNull();
  });

  it('splits at the first @ only, so a name keeps the rest of itself', () => {
    expect(parseShortlist('Dinner @ the place by the river@80')).toEqual([
      { name: 'Dinner', price: 80 },
    ]);
  });
});

describe('parsePrice', () => {
  it('reads the number out of however it was written', () => {
    expect(parsePrice('£62')).toBe(62);
    expect(parsePrice('around $80 for everyday gestures')).toBe(80);
    expect(parsePrice('12.50')).toBe(12.5);
  });

  it('answers null rather than zero when there is no number', () => {
    expect(parsePrice('a lot')).toBeNull();
  });
});

describe('parseWeeklyRhythm', () => {
  it('reads the day, the label and the weight', () => {
    expect(parseWeeklyRhythm('Tue@pottery until nine@heavy, Sun@bread baking@medium')).toEqual([
      { weekday: 2, label: 'pottery until nine', weight: 'heavy' },
      { weekday: 0, label: 'bread baking', weight: 'medium' },
    ]);
  });

  it('takes any spelling of a weekday', () => {
    expect(parseWeeklyRhythm('monday@run@light, THURS@sketching@light').map((e) => e.weekday))
      .toEqual([1, 4]);
  });

  it('falls back to medium for a commitment nobody sized', () => {
    // An evening whose size the model did not judge is still an evening she is
    // busy, so the row survives with a middling bar.
    expect(parseWeeklyRhythm('Fri@dinner with Tom')[0].weight).toBe('medium');
  });

  it('drops an entry with no day, because the chart has nowhere to draw it', () => {
    // The only parser here that drops anything: the chart is keyed on the weekday,
    // and unlike a shade or a shortlist item there is no "the name on its own"
    // fallback for a bar with no column.
    expect(parseWeeklyRhythm('pottery until nine, Tue@pottery@heavy')).toHaveLength(1);
  });
});

describe('rhythmHeight', () => {
  it('is monotonic, so a heavier evening never draws shorter', () => {
    expect(rhythmHeight('light')).toBeLessThan(rhythmHeight('medium'));
    expect(rhythmHeight('medium')).toBeLessThan(rhythmHeight('heavy'));
    expect(rhythmHeight('heavy')).toBeLessThanOrEqual(100);
  });
});
