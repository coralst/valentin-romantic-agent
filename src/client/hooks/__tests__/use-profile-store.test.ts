import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  clearManualValueOnServer,
  fetchManualValues,
  initialState,
  profileStoreReducer,
  pushManualValue,
  type ProfileFieldValue,
} from '../use-profile-store';

/*
 * His corrections, over the wire.
 *
 * The bug this fixes is quiet and expensive: he fixes her ring size on his phone,
 * the value goes to `localStorage`, and Valentin is still confidently wrong about
 * it on his laptop. So the assertions here are about the request actually being
 * made, and about the stored row surviving a round trip as a `manual` value —
 * which is what stops the extractor from overwriting it.
 */
describe('manual values over the API', () => {
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

  it('reconstructs the source and the stamp the stored row does not carry', async () => {
    // A `MANUAL#` row is the value and nothing else, so `source: 'manual'` has to
    // be put back here — and it is load-bearing: it is what makes the value win
    // over whatever the extractor discovers next.
    stubFetch({ manualValues: { ring_size: 'M' } });
    const values = await fetchManualValues('s1');
    expect(values.ring_size.value).toBe('M');
    expect(values.ring_size.source).toBe('manual');
    expect(values.ring_size.updatedAt).toBeTruthy();
    expect(calls[0]).toMatchObject({ url: '/api/session/s1/manual', method: 'GET' });
  });

  it('keeps the cache’s own stamp for a value that has not changed', async () => {
    // Otherwise "you told me this in June" becomes "you told me this just now" on
    // every reload, which makes the one honest timestamp on the card a lie.
    const cached: Record<string, ProfileFieldValue> = {
      ring_size: { value: 'M', source: 'manual', updatedAt: '2026-06-01T00:00:00.000Z' },
    };
    stubFetch({ manualValues: { ring_size: 'M' } });
    expect((await fetchManualValues('s1', cached)).ring_size.updatedAt).toBe(
      '2026-06-01T00:00:00.000Z',
    );
  });

  it('re-stamps a value the server disagrees with the cache about', async () => {
    const cached: Record<string, ProfileFieldValue> = {
      ring_size: { value: 'M', source: 'manual', updatedAt: '2026-06-01T00:00:00.000Z' },
    };
    stubFetch({ manualValues: { ring_size: 'L' } });
    const values = await fetchManualValues('s1', cached);
    expect(values.ring_size.value).toBe('L');
    expect(values.ring_size.updatedAt).not.toBe('2026-06-01T00:00:00.000Z');
  });

  it('ignores a row whose value is not a string, rather than rendering it', async () => {
    stubFetch({ manualValues: { ring_size: { nested: true }, bra_size: '34B' } });
    expect(Object.keys(await fetchManualValues('s1'))).toEqual(['bra_size']);
  });

  it('answers with nothing when the session has no corrections', async () => {
    stubFetch({ manualValues: undefined });
    expect(await fetchManualValues('s1')).toEqual({});
  });

  it('PUTs one correction to the field’s own route', async () => {
    stubFetch({ saved: true });
    await pushManualValue('s1', 'bra_size', '34B');
    expect(calls[0]).toMatchObject({
      url: '/api/session/s1/manual/bra_size',
      method: 'PUT',
      body: { value: '34B' },
    });
  });

  it('DELETEs a correction he has taken back', async () => {
    stubFetch({ deleted: true });
    await clearManualValueOnServer('s1', 'bra_size');
    expect(calls[0]).toMatchObject({
      url: '/api/session/s1/manual/bra_size',
      method: 'DELETE',
    });
  });

  it('throws a message fit for a projector when the server refuses', async () => {
    stubFetch({}, false);
    await expect(pushManualValue('s1', 'bra_size', '34B')).rejects.toThrow(
      /could not complete/,
    );
  });
});

/*
 * Nothing about one conversation may survive into the next.
 *
 * The leak: `RESTORE` spreads `...state` and replaces only the photo and the
 * corrections, so switching from a session that knew "Deep sage green / Northern
 * Italian / Gemini" to one that knew only "Thai food" showed all four at once,
 * under the second partner's name. `discoveredValues` was carried across because
 * ingestion can only ever *add* — `SET_DISCOVERED_VALUE` merges, and nothing
 * downstream could unset it.
 */
describe('resetting the store for a new conversation', () => {
  const populated = profileStoreReducer(
    profileStoreReducer(
      profileStoreReducer(
        profileStoreReducer(initialState, { type: 'RESET_FOR_SESSION' }),
        { type: 'SET_DISCOVERED_VALUE', fieldId: 'favorite_color', value: 'Deep sage green', confidence: 0.9 },
      ),
      { type: 'SET_MANUAL_VALUE', fieldId: 'ring_size', value: 'M' },
    ),
    { type: 'CLEAR_DISCOVERED_VALUE', fieldId: 'music_genre' },
  );

  it('starts from something actually populated', () => {
    // Guards the test itself: if this ever goes empty, the assertions below pass
    // for the wrong reason.
    expect(populated.discoveredValues.favorite_color?.value).toBe('Deep sage green');
    expect(populated.manualValues.ring_size?.value).toBe('M');
    expect(populated.rejectedFieldIds).toContain('music_genre');
  });

  it('drops discovered values, which RESTORE used to carry across', () => {
    const reset = profileStoreReducer(populated, { type: 'RESET_FOR_SESSION' });
    expect(reset.discoveredValues).toEqual({});
  });

  it('drops rejections, so a ✗ in one conversation cannot suppress a field in another', () => {
    const reset = profileStoreReducer(populated, { type: 'RESET_FOR_SESSION' });
    expect(reset.rejectedFieldIds).toEqual([]);
  });

  it('drops the corrections and the photo too — all of it is session-scoped', () => {
    const withPhoto = profileStoreReducer(populated, {
      type: 'SET_PHOTO',
      dataUrl: 'data:image/png;base64,AAAA',
    });
    const reset = profileStoreReducer(withPhoto, { type: 'RESET_FOR_SESSION' });

    expect(reset.manualValues).toEqual({});
    expect(reset.partnerPhoto).toBeNull();
  });

  /*
   * The distinction that matters: `CLEAR_ALL_VALUES` is the user asking to forget
   * her, and its exported `dispatch` wrapper deletes every manual value on the
   * server. `RESET_FOR_SESSION` is local bookkeeping and must never reach the
   * network — which is why it is a separate action rather than a reuse.
   */
  it('leaves the same state as RESTORE-from-empty would, with nothing carried', () => {
    const reset = profileStoreReducer(populated, { type: 'RESET_FOR_SESSION' });
    const fresh = profileStoreReducer(initialState, { type: 'RESET_FOR_SESSION' });
    expect(reset).toEqual(fresh);
  });
});
