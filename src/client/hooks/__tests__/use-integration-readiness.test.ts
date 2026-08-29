import { describe, it, expect } from 'vitest';
import {
  capabilityReadiness,
  liveServices,
  type IntegrationReadiness,
} from '../use-integration-readiness';

const loaded = (
  configured: IntegrationReadiness['configured'],
): IntegrationReadiness => ({ state: 'loaded', configured });

describe('capabilityReadiness', () => {
  it('calls a capability with no backing aspirational, whatever the server says', () => {
    // Flowers is a drawing. No credential could make it work, so readiness is
    // irrelevant to it and must not be consulted.
    expect(capabilityReadiness(undefined, loaded({ gmail: true }))).toBe('aspirational');
    expect(capabilityReadiness([], loaded({ gmail: true }))).toBe('aspirational');
  });

  it('is ready only when every backing service is configured', () => {
    expect(capabilityReadiness(['ontopo'], loaded({ ontopo: true }))).toBe('ready');
    expect(
      capabilityReadiness(['gmail', 'whatsapp'], loaded({ gmail: true, whatsapp: true })),
    ).toBe('ready');
  });

  it('is partial when some backing service is configured and some is not', () => {
    /*
     * The realistic case: Gmail needs one refresh token, WhatsApp needs a Meta
     * business number and template review. Reporting "unconfigured" here would
     * claim email does not work when it does.
     */
    expect(
      capabilityReadiness(['gmail', 'whatsapp'], loaded({ gmail: true, whatsapp: false })),
    ).toBe('partial');
  });

  it('is unconfigured when nothing behind it is configured', () => {
    expect(capabilityReadiness(['amadeus'], loaded({ amadeus: false }))).toBe('unconfigured');
    // An id the server did not mention is unknown, and unknown is not ready.
    expect(capabilityReadiness(['amadeus'], loaded({}))).toBe('unconfigured');
  });

  it('never guesses before the answer arrives', () => {
    for (const state of ['loading', 'unavailable'] as const) {
      expect(capabilityReadiness(['ontopo'], { state, configured: {} })).toBe('unknown');
    }
  });

  it('still knows an unbuilt capability is unbuilt with no server at all', () => {
    // The one thing that needs no server to be true, and the reason the
    // aspirational check comes first.
    expect(
      capabilityReadiness(undefined, { state: 'unavailable', configured: {} }),
    ).toBe('aspirational');
  });
});

describe('liveServices', () => {
  it('names only the configured half, in catalogue order', () => {
    expect(liveServices(['gmail', 'whatsapp'], loaded({ gmail: true }))).toEqual(['gmail']);
  });

  it('is empty for an aspirational capability', () => {
    expect(liveServices(undefined, loaded({ gmail: true }))).toEqual([]);
  });
});
