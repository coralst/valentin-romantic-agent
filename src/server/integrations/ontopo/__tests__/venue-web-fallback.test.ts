import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The way out of "Ontopo said no".
 *
 * The web layer is mocked, because the assertions here are about judgement rather
 * than about HTTP: which of six results is the restaurant's own site, when to admit
 * we do not know, and — most of all — that nothing in this file can throw or hang.
 * Its caller runs it on a path that is already a partial failure, so a rejection
 * would turn a usable answer into `runTool`'s generic "could not be completed".
 */

const { webSearch, readPage } = vi.hoisted(() => ({
  webSearch: vi.fn(),
  readPage: vi.fn(),
}));
vi.mock('../../websearch/client', () => ({ webSearch, readPage }));

import { describeVenueWebLead, findVenueOwnPage } from '../venue-web-fallback';

/** One search result, with only the fields the scorer reads. */
function result(title: string, url: string): { title: string; url: string; snippet: string } {
  return { title, url, snippet: '' };
}

function answered(...results: ReturnType<typeof result>[]): void {
  webSearch.mockResolvedValue({ source: 'tavily', answer: null, results });
}

function pageSays(text: string): void {
  readPage.mockResolvedValue({ source: 'fetch', url: 'https://example.test', text });
}

describe('findVenueOwnPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readPage.mockResolvedValue(null);
  });

  it('finds the restaurant’s own domain and its phone number', async () => {
    answered(result('Ha Salon — Tel Aviv', 'https://www.hasalon.co.il/'));
    pageSays('Ha Salon, Ha-Arba\'a 8. Reservations 03-6021133. Open Tue–Sat.');

    const lead = await findVenueOwnPage({ name: 'Ha Salon', city: 'Tel Aviv' });

    expect(lead).toEqual({
      url: 'https://www.hasalon.co.il/',
      host: 'hasalon.co.il',
      phone: '03-6021133',
    });
  });

  /*
   * The transliteration case, and the reason the hostname is matched with the spaces
   * squashed out rather than token by token: "Ha Salon" is `hasalon.co.il`, and no
   * single token of the name appears in that host on its own.
   */
  it('matches a hostname that runs the name together', async () => {
    answered(result('Some review', 'https://mishlam.example/x'), result('Site', 'https://ocdtlv.com/'));

    const lead = await findVenueOwnPage({ name: 'OCD', city: 'Tel Aviv' });

    expect(lead?.host).toBe('ocdtlv.com');
  });

  it('never offers Ontopo back, since Ontopo is what just failed', async () => {
    answered(result('Ha Salon | Ontopo', 'https://ontopo.com/en/il/page/hasalon'));

    expect(await findVenueOwnPage({ name: 'Ha Salon', city: 'Tel Aviv' })).toBeNull();
  });

  it('skips aggregators and review sites even when they name the venue', async () => {
    answered(
      result('Ha Salon - Tripadvisor', 'https://www.tripadvisor.com/hasalon'),
      result('Ha Salon on Facebook', 'https://facebook.com/hasalon'),
      result('Ha Salon delivery', 'https://wolt.com/en/isr/hasalon'),
      result('Ha Salon | Rest', 'https://www.rest.co.il/hasalon'),
    );

    expect(await findVenueOwnPage({ name: 'Ha Salon', city: 'Tel Aviv' })).toBeNull();
  });

  /*
   * The failure worth avoiding, and the reason `ownSiteScore` refuses to guess: a
   * wrong number for a restaurant is worse than no number, because the user rings it.
   */
  it('answers null rather than offering a page it cannot place', async () => {
    answered(
      result('The 20 best restaurants in Tel Aviv', 'https://someblog.example/best-20'),
      result('Where to eat this autumn', 'https://magazine.example/eat/autumn'),
    );

    expect(await findVenueOwnPage({ name: 'Ha Salon', city: 'Tel Aviv' })).toBeNull();
  });

  it('prefers the homepage over a deep link on the same evidence', async () => {
    answered(
      result('Ha Salon menu', 'https://hasalon.co.il/menus/winter/tasting'),
      result('Ha Salon', 'https://hasalon.co.il/'),
    );

    const lead = await findVenueOwnPage({ name: 'Ha Salon' });

    expect(lead?.url).toBe('https://hasalon.co.il/');
  });

  it('still hands over the link when the page cannot be read', async () => {
    answered(result('Ha Salon', 'https://hasalon.co.il/'));
    readPage.mockResolvedValue(null);

    const lead = await findVenueOwnPage({ name: 'Ha Salon' });

    // The link alone already answers "where do I book this myself".
    expect(lead).toMatchObject({ host: 'hasalon.co.il', phone: null });
  });

  it('reads mobile and +972 numbers, and leaves prices alone', async () => {
    answered(result('Buckaroo', 'https://buckaroo.co.il/'));
    pageSays('Tasting menu 380 ILS, wine from 2019. Call 052-1234567 to book.');

    expect((await findVenueOwnPage({ name: 'Buckaroo' }))?.phone).toBe('052-1234567');

    vi.clearAllMocks();
    answered(result('Buckaroo', 'https://buckaroo.co.il/'));
    pageSays('Est. 20180101. Reservations: +972-3-7654321');

    expect((await findVenueOwnPage({ name: 'Buckaroo' }))?.phone).toBe('+972-3-7654321');
  });

  it('does not lift a phone number out of a longer run of digits', async () => {
    answered(result('Buckaroo', 'https://buckaroo.co.il/'));
    pageSays('Order reference 0361133445566778899 — no telephone on this page.');

    expect((await findVenueOwnPage({ name: 'Buckaroo' }))?.phone).toBeNull();
  });

  it('answers null when the search itself found nothing', async () => {
    webSearch.mockResolvedValue(null);
    expect(await findVenueOwnPage({ name: 'Ha Salon' })).toBeNull();

    answered();
    expect(await findVenueOwnPage({ name: 'Ha Salon' })).toBeNull();
  });

  /*
   * The property the caller depends on. `check_availability` reaches this only when
   * Ontopo has already let it down; a throw here would replace "try another night"
   * with a generic tool failure the model reads as worth retrying.
   */
  it('swallows a throwing search rather than failing the tool call', async () => {
    webSearch.mockRejectedValue(new Error('ETIMEDOUT'));

    await expect(findVenueOwnPage({ name: 'Ha Salon' })).resolves.toBeNull();
  });

  it('swallows a throwing page read and keeps the link', async () => {
    answered(result('Ha Salon', 'https://hasalon.co.il/'));
    readPage.mockRejectedValue(new Error('socket hang up'));

    expect(await findVenueOwnPage({ name: 'Ha Salon' })).toMatchObject({ phone: null });
  });

  it('does not search for a venue with no name', async () => {
    expect(await findVenueOwnPage({ name: '   ' })).toBeNull();
    expect(webSearch).not.toHaveBeenCalled();
  });

  it('puts the city in the query, because two rooms share a name', async () => {
    answered(result('Ha Salon', 'https://hasalon.co.il/'));

    await findVenueOwnPage({ name: 'Ha Salon', city: 'Tel Aviv' });

    expect(webSearch).toHaveBeenCalledWith(
      expect.stringContaining('Ha Salon Tel Aviv'),
      expect.anything(),
    );
  });
});

describe('describeVenueWebLead', () => {
  it('names the site and the number, and refuses to imply a table', () => {
    const clause = describeVenueWebLead(
      { url: 'https://hasalon.co.il/', host: 'hasalon.co.il', phone: '03-6021133' },
      'Ha Salon',
    );

    expect(clause).toContain('hasalon.co.il');
    expect(clause).toContain('03-6021133');
    // The one line that must survive any edit to the wording: the model is told out
    // loud that nothing has been held, because this is exactly where a helpful model
    // starts improvising a reservation.
    expect(clause).toMatch(/not a table you have held/);
  });

  it('says nothing about a number it does not have', () => {
    const clause = describeVenueWebLead(
      { url: 'https://hasalon.co.il/', host: 'hasalon.co.il', phone: null },
      'Ha Salon',
    );

    expect(clause).toContain('hasalon.co.il');
    expect(clause).not.toMatch(/number is/);
  });
});
