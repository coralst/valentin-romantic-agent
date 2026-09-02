import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { config } from '../../../config';
import { guestForCheckout } from '../tools';

/**
 * The gate that decides whether a confirm books a table or hands over a link.
 *
 * This is the highest-consequence branch in the integration: on one side a real
 * reservation at a real restaurant, on the other a link. It is worth testing on its
 * own, because the dangerous failure is not a crash — it is booking a table under a
 * half-filled identity that the restaurant cannot act on.
 */

const GUEST_KEYS = [
  'ontopoGuestFirstName',
  'ontopoGuestLastName',
  'ontopoGuestEmail',
  'ontopoGuestPhone',
] as const;

type MutableIntegrations = Record<string, unknown>;

const original: MutableIntegrations = {};

beforeEach(() => {
  const integrations = config.integrations as unknown as MutableIntegrations;
  for (const key of [...GUEST_KEYS, 'ontopoAutoComplete']) {
    original[key] = integrations[key];
  }
  integrations.ontopoAutoComplete = true;
  integrations.ontopoGuestFirstName = 'Noa';
  integrations.ontopoGuestLastName = 'Shaked';
  integrations.ontopoGuestEmail = 'someone@example.com';
  integrations.ontopoGuestPhone = '0528712774';
});

afterEach(() => {
  const integrations = config.integrations as unknown as MutableIntegrations;
  for (const [key, value] of Object.entries(original)) integrations[key] = value;
  vi.restoreAllMocks();
});

function integrations(): MutableIntegrations {
  return config.integrations as unknown as MutableIntegrations;
}

describe('guestForCheckout', () => {
  it('returns the guest when the whole identity is configured', () => {
    expect(guestForCheckout()).toEqual({
      firstName: 'Noa',
      lastName: 'Shaked',
      email: 'someone@example.com',
      phone: '0528712774',
    });
  });

  it.each(GUEST_KEYS)('refuses to book with %s missing', (key) => {
    integrations()[key] = undefined;
    expect(guestForCheckout()).toBeNull();
  });

  it.each(GUEST_KEYS)('treats a blank %s as missing rather than as a value', (key) => {
    integrations()[key] = '   ';
    expect(guestForCheckout()).toBeNull();
  });

  it('trims surrounding whitespace off the details it submits', () => {
    integrations().ontopoGuestPhone = '  0528712774  ';
    expect(guestForCheckout()?.phone).toBe('0528712774');
  });

  it('falls back to the link handoff when auto-complete is switched off', () => {
    integrations().ontopoAutoComplete = false;
    expect(guestForCheckout()).toBeNull();
  });
});
