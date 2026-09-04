import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Outing } from '../../../shared/interfaces/outing';
import {
  fetchOutings,
  loadOutingsFromStorage,
  outingStoreReducer,
  pushOuting,
  removeOuting,
  sanitiseOutings,
  saveOutingsToStorage,
  type OutingStoreState,
} from '../use-outing-store';

function outing(overrides: Partial<Outing> = {}): Outing {
  return {
    id: 'claro',
    venueSlug: 'claro-tlv',
    venueName: 'Claro',
    city: 'Tel Aviv',
    occursOn: '2026-06-12',
    confirmedAt: '2026-06-01T18:00:00.000Z',
    rating: null,
    verdict: null,
    note: null,
    ratedAt: null,
    ...overrides,
  };
}

const empty: OutingStoreState = { outings: [], storageError: null };

describe('outingStoreReducer', () => {
  it('records the answer against the row it was asked about and nothing else', () => {
    const state = {
      ...empty,
      outings: [outing(), outing({ id: 'ha-achim', venueName: "Ha'achim" })],
    };

    const next = outingStoreReducer(state, {
      type: 'RATE_OUTING',
      id: 'ha-achim',
      patch: { rating: 5, verdict: 'again' },
    });

    expect(next.outings[1].rating).toBe(5);
    expect(next.outings[1].verdict).toBe('again');
    // The other place he took her must not inherit her verdict — the whole point
    // of the history is that each row is its own fact.
    expect(next.outings[0].rating).toBeNull();
    expect(next.outings[0].verdict).toBeNull();
  });

  it('stamps the row as answered so it stops asking before the server replies', () => {
    const state = { ...empty, outings: [outing()] };
    const next = outingStoreReducer(state, {
      type: 'RATE_OUTING',
      id: 'claro',
      patch: { rating: 4 },
    });
    expect(next.outings[0].ratedAt).toBeTruthy();
  });

  it('keeps the venue a rating did not mention', () => {
    // The action is a patch precisely so answering "how was it?" cannot rewrite
    // where he went.
    const state = { ...empty, outings: [outing()] };
    const next = outingStoreReducer(state, {
      type: 'RATE_OUTING',
      id: 'claro',
      patch: { verdict: 'never again' },
    });
    expect(next.outings[0].venueName).toBe('Claro');
    expect(next.outings[0].confirmedAt).toBe('2026-06-01T18:00:00.000Z');
  });

  it('ignores a rating for an id it does not hold', () => {
    const state = { ...empty, outings: [outing()] };
    expect(
      outingStoreReducer(state, { type: 'RATE_OUTING', id: 'nope', patch: { rating: 1 } }).outings,
    ).toEqual(state.outings);
  });

  it('replaces a row the server pushed again rather than showing the place twice', () => {
    const state = { ...empty, outings: [outing({ id: 'first' }), outing()] };
    const next = outingStoreReducer(state, {
      type: 'MERGE_OUTING',
      outing: outing({ venueName: 'Claro, roof' }),
    });
    expect(next.outings).toHaveLength(2);
    // In place, so a confirmation arriving twice does not reshuffle the history.
    expect(next.outings[1].venueName).toBe('Claro, roof');
    expect(next.outings.map((row) => row.id)).toEqual(['first', 'claro']);
  });

  it('appends a booking this client has not seen confirmed yet', () => {
    const next = outingStoreReducer(empty, { type: 'MERGE_OUTING', outing: outing() });
    expect(next.outings.map((row) => row.id)).toEqual(['claro']);
  });

  it('removes by id', () => {
    const state = { ...empty, outings: [outing(), outing({ id: 'ha-achim' })] };
    expect(
      outingStoreReducer(state, { type: 'REMOVE_OUTING', id: 'ha-achim' }).outings.map(
        (row) => row.id,
      ),
    ).toEqual(['claro']);
  });

  it('forgets where he took her alongside her profile', () => {
    // "Forget her" that leaves behind the list of restaurants has not forgotten her.
    const state = { ...empty, outings: [outing(), outing({ id: 'ha-achim' })] };
    expect(outingStoreReducer(state, { type: 'CLEAR_ALL_OUTINGS' }).outings).toEqual([]);
  });

  it('takes the server’s list whole on restore', () => {
    const state = { ...empty, outings: [outing({ id: 'stale' })] };
    const next = outingStoreReducer(state, { type: 'RESTORE', outings: [outing()] });
    expect(next.outings.map((row) => row.id)).toEqual(['claro']);
  });

  it('surfaces a storage failure without discarding the history in memory', () => {
    const state = { ...empty, outings: [outing()] };
    const next = outingStoreReducer(state, { type: 'STORAGE_ERROR', message: 'full' });
    expect(next.storageError).toBe('full');
    expect(next.outings).toHaveLength(1);
  });

  it('clears a stale storage warning once a write succeeds', () => {
    const state: OutingStoreState = { outings: [], storageError: 'full' };
    expect(outingStoreReducer(state, { type: 'MERGE_OUTING', outing: outing() }).storageError)
      .toBeNull();
  });
});

describe('sanitiseOutings', () => {
  it('keeps only rows that would draw as a row', () => {
    expect(
      sanitiseOutings([
        outing(),
        { venueName: 'No id', confirmedAt: '2026-06-01T18:00:00.000Z' }, // nothing to rate against
        { id: 'blank', venueName: '   ', confirmedAt: '2026-06-01T18:00:00.000Z' }, // a nameless line
        { id: 'undated', venueName: 'Somewhere' }, // no confirmedAt: unsortable position
        'nonsense',
        null,
      ]).map((row) => row.id),
    ).toEqual(['claro']);
  });

  it('answers with a list for anything that is not one', () => {
    expect(sanitiseOutings(undefined)).toEqual([]);
    expect(sanitiseOutings({ outings: [] })).toEqual([]);
  });
});

describe('outing storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips the history', () => {
    expect(saveOutingsToStorage('s1', [outing()])).toBeNull();
    expect(loadOutingsFromStorage('s1')).toEqual([outing()]);
  });

  it('keeps sessions apart', () => {
    saveOutingsToStorage('s1', [outing()]);
    expect(loadOutingsFromStorage('s2')).toBeNull();
  });

  it('drops a payload written by an older version rather than trusting its shape', () => {
    localStorage.setItem('valentin-outings-s1', JSON.stringify({ version: 0, outings: [outing()] }));
    expect(loadOutingsFromStorage('s1')).toBeNull();
    expect(localStorage.getItem('valentin-outings-s1')).toBeNull();
  });

  it('survives corrupt JSON and clears it', () => {
    localStorage.setItem('valentin-outings-s1', '{not json');
    expect(loadOutingsFromStorage('s1')).toBeNull();
    expect(localStorage.getItem('valentin-outings-s1')).toBeNull();
  });

  it('drops a cached row that would not draw', () => {
    localStorage.setItem(
      'valentin-outings-s1',
      JSON.stringify({ version: 1, outings: [outing(), { id: 'x' }] }),
    );
    expect(loadOutingsFromStorage('s1')?.map((row) => row.id)).toEqual(['claro']);
  });
});

/*
 * The server owns this board: rows are created there when a booking is confirmed,
 * and a rating that does not survive a reload would make the history a lie about
 * which places he already knows about.
 */
describe('outings over the API', () => {
  let calls: Array<{ url: string; method: string; body: unknown }>;

  function stubFetch(payload: unknown, ok = true) {
    calls = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      return { ok, status: ok ? 200 : 500, json: async () => payload } as Response;
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the history from the session’s own route', async () => {
    stubFetch({ outings: [outing()] });
    expect(await fetchOutings('s 1')).toEqual([outing()]);
    expect(calls[0]).toMatchObject({ url: '/api/session/s%201/outings', method: 'GET' });
  });

  it('drops a row the server could not have meant', async () => {
    stubFetch({ outings: [outing(), { id: 'x' }] });
    expect((await fetchOutings('s1')).map((row) => row.id)).toEqual(['claro']);
  });

  it('sends the answer as an upsert of the whole row', async () => {
    stubFetch({ saved: true });
    await pushOuting('s1', outing({ rating: 5, verdict: 'again' }));
    expect(calls[0]).toMatchObject({ url: '/api/session/s1/outings', method: 'POST' });
    expect((calls[0].body as Outing).rating).toBe(5);
  });

  it('deletes by id', async () => {
    stubFetch({ deleted: true });
    await removeOuting('s1', 'claro');
    expect(calls[0]).toMatchObject({ url: '/api/session/s1/outings/claro', method: 'DELETE' });
  });

  it('throws a message fit for a projector when the server refuses', async () => {
    stubFetch({}, false);
    await expect(fetchOutings('s1')).rejects.toThrow(/could not complete/);
  });
});
