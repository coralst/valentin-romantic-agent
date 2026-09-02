import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The checkout form driver, tested through a fake page.
 *
 * There is no way to test this against Ontopo without booking a real table at a
 * real restaurant every run, so the page is faked — but the *contract* being
 * checked is the one that matters and is not about markup: this module must never
 * report a booking it did not make, and must never throw. Those two properties are
 * what the caller's fallback depends on, and both are exercised here.
 *
 * The fake deliberately records the order of interactions. Ontopo's form is
 * sequential — the contact fields do not exist until Next is pressed on the terms
 * step — so "filled the fields" is only correct if it happened after that click.
 */

const { withPage } = vi.hoisted(() => ({ withPage: vi.fn() }));
vi.mock('../../browser/session', () => ({
  withPage,
  BROWSER_NAV_TIMEOUT_MS: 20_000,
}));

import { completeCheckout } from '../checkout-form';

const GUEST = {
  firstName: 'Noa',
  lastName: 'Shaked',
  email: 'someone@example.com',
  phone: '0528712774',
};

interface FakeOptions {
  /** Whether Ontopo's post-booking banner ever appears. */
  confirms?: boolean;
  /** Placeholders/labels that are absent, to simulate changed markup. */
  missing?: string[];
  /** Overlay buttons that are not rendered this run. */
  absentButtons?: string[];
}

/** A page that records what was done to it, and can be made to misbehave. */
function fakePage(opts: FakeOptions = {}) {
  const confirms = opts.confirms ?? true;
  const missing = new Set(opts.missing ?? []);
  const absent = new Set(opts.absentButtons ?? []);
  const actions: string[] = [];
  const filled: Record<string, string> = {};

  const locator = (key: string) => {
    const self = {
      first: () => self,
      isVisible: async () => !absent.has(key) && !missing.has(key),
      count: async () => (missing.has(key) ? 0 : 1),
      innerText: async () => key,
      evaluateAll: async () => [] as never,
      async waitFor() {
        if (missing.has(key)) throw new Error(`locator not found: ${key}`);
        actions.push(`wait:${key}`);
      },
      async click() {
        if (missing.has(key) || absent.has(key)) throw new Error(`not clickable: ${key}`);
        actions.push(`click:${key}`);
      },
      async fill(value: string) {
        if (missing.has(key)) throw new Error(`no such field: ${key}`);
        filled[key] = value;
        actions.push(`fill:${key}`);
      },
    };
    return self;
  };

  const page = {
    goto: async (url: string) => void actions.push(`goto:${url}`),
    content: async () => '',
    title: async () => "Home'is | Ontopo",
    waitForTimeout: async () => {},
    route: async () => {},
    url: () => 'https://s1.ontopo.com/en/checkout/X',
    evaluate: async () => undefined as never,
    locator: (sel: string) => locator(sel),
    getByPlaceholder: (text: string) => locator(text),
    getByRole: (_role: string, o?: { name?: string }) => locator(o?.name ?? '?'),
    getByText: (text: string) =>
      locator(text.startsWith('Thank you') && !confirms ? 'MISSING-CONFIRMATION' : text),
  };

  if (!confirms) missing.add('MISSING-CONFIRMATION');
  return { page, actions, filled };
}

/*
 * Braces matter here. `mockReset()` returns the mock, and a function returned from
 * `beforeEach` is treated by vitest as a teardown hook — so the concise arrow form
 * makes vitest *call* withPage with no arguments after every test.
 */
beforeEach(() => {
  withPage.mockReset();
});

/** Route the mocked `withPage` at a given fake page. */
function serve(fake: ReturnType<typeof fakePage>) {
  withPage.mockImplementation(async (visit: (p: unknown) => Promise<unknown>) => {
    return visit(fake.page);
  });
}

describe('completeCheckout', () => {
  it('books the table and reports the name it went under', async () => {
    const fake = fakePage();
    serve(fake);

    const outcome = await completeCheckout('https://ontopo.com/en/checkout/ABC', GUEST);

    expect(outcome.booked).toBe(true);
    expect(outcome.guestName).toBe('Noa Shaked');
    expect(outcome.reason).toBeUndefined();
  });

  it('submits exactly the configured guest, and only after the terms step', async () => {
    const fake = fakePage();
    serve(fake);

    await completeCheckout('https://ontopo.com/en/checkout/ABC', GUEST);

    expect(fake.filled).toEqual({
      'First name': 'Noa',
      'Last name': 'Shaked',
      Email: 'someone@example.com',
      Phone: '0528712774',
    });

    // The contact inputs do not exist until Next is pressed, so filling them
    // before that click would pass against this fake and fail against Ontopo.
    const firstNext = fake.actions.indexOf('click:Next');
    const firstFill = fake.actions.findIndex((a) => a.startsWith('fill:'));
    expect(firstNext).toBeGreaterThanOrEqual(0);
    expect(firstFill).toBeGreaterThan(firstNext);
  });

  it('presses Done only after accepting the terms', async () => {
    const fake = fakePage();
    serve(fake);

    await completeCheckout('https://ontopo.com/en/checkout/ABC', GUEST);

    const terms = fake.actions.indexOf('click:I have read and accept the');
    const done = fake.actions.indexOf('click:Done');
    expect(terms).toBeGreaterThanOrEqual(0);
    expect(done).toBeGreaterThan(terms);
  });

  it('refuses to claim a booking when Ontopo never confirms', async () => {
    const fake = fakePage({ confirms: false });
    serve(fake);

    const outcome = await completeCheckout('https://ontopo.com/en/checkout/ABC', GUEST);

    expect(outcome.booked).toBe(false);
    expect(outcome.reason).toMatch(/did not show a booking confirmation/i);
  });

  it('reports rather than throws when the markup has moved', async () => {
    const fake = fakePage({ missing: ['First name'] });
    serve(fake);

    const outcome = await completeCheckout('https://ontopo.com/en/checkout/ABC', GUEST);

    expect(outcome.booked).toBe(false);
    expect(outcome.reason).toContain('First name');
  });

  it('reports rather than throws when no browser is available', async () => {
    withPage.mockRejectedValue(new Error('Playwright is not installed in this deployment'));

    const outcome = await completeCheckout('https://ontopo.com/en/checkout/ABC', GUEST);

    expect(outcome.booked).toBe(false);
    expect(outcome.reason).toMatch(/not installed/i);
  });

  it('still books when the optional cookie and nudge overlays are absent', async () => {
    const fake = fakePage({ absentButtons: ['Accept all', 'Ok'] });
    serve(fake);

    const outcome = await completeCheckout('https://ontopo.com/en/checkout/ABC', GUEST);

    expect(outcome.booked).toBe(true);
    expect(fake.actions).not.toContain('click:Accept all');
    expect(fake.actions).toContain('click:Done');
  });
});
