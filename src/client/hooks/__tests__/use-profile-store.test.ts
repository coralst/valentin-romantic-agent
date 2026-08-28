import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  clearManualValueOnServer,
  fetchManualValues,
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
