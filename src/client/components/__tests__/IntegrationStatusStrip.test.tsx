import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  IntegrationStatusStrip,
  MAX_TILES,
  integrationStatus,
  statusSentence,
} from '../IntegrationStatusStrip';
import { INTEGRATION_CATALOGUE } from '../../utils/integration-catalogue';
import type { IntegrationReadiness } from '../../hooks/use-integration-readiness';
import type { IntegrationId } from '../../../shared/interfaces/integrations';

/**
 * What these assert is one claim: **the strip never says a service is reachable
 * unless the server said so.**
 *
 * That is worth its own file because the failure mode is silent and expensive. A
 * dot that goes green off the back of anything held in this browser — a grant in
 * `localStorage`, a hopeful default while the fetch is in flight — looks exactly
 * like a dot that went green because the deployment holds a Gmail token, and the
 * visitor only learns the difference when a booking they were promised fails.
 *
 * So `configured` is the only input, and the first two tests here are the ones
 * that would have caught the draft this component replaced, which ANDed in the
 * client-side grant and would have claimed "not allowed" for services the model
 * could already call.
 */

const loaded = (configured: Partial<Record<IntegrationId, boolean>>): IntegrationReadiness => ({
  state: 'loaded',
  configured,
});

const gmail = INTEGRATION_CATALOGUE.find((s) => s.id === 'gmail')!;
const spotify = INTEGRATION_CATALOGUE.find((s) => s.id === 'spotify')!;

describe('integrationStatus', () => {
  it('calls a service configured only when the server reports it configured', () => {
    expect(integrationStatus(gmail, loaded({ gmail: true }))).toBe('configured');
    expect(integrationStatus(gmail, loaded({ gmail: false }))).toBe('unconfigured');
  });

  it('treats an id the server never mentioned as unconfigured, not as configured', () => {
    // An absent key is "unknown", and unknown must never round up to reachable.
    expect(integrationStatus(gmail, loaded({}))).toBe('unconfigured');
  });

  it('reports unknown — never a guess — until readiness has arrived', () => {
    expect(integrationStatus(gmail, { state: 'loading', configured: {} })).toBe('unknown');
    expect(integrationStatus(gmail, { state: 'unavailable', configured: {} })).toBe('unknown');
  });

  it('reports every catalogue row, so no row is silently assumed to work', () => {
    for (const service of INTEGRATION_CATALOGUE) {
      expect(integrationStatus(service, loaded({}))).toMatch(/^(unconfigured|unbuilt)$/);
    }
  });
});

describe('statusSentence', () => {
  /*
   * `configured: true` means credentials are present, not that a call would
   * succeed — `ontopo` and `wolt` report true unconditionally, and a revoked
   * Google token keeps reporting true. So the copy may not promise it works.
   */
  it('claims credentials rather than working, for the configured case', () => {
    expect(statusSentence('Gmail', 'configured')).toBe('Gmail — credentials in place');
  });

  it('never uses the words live, working, or connected for any state', () => {
    const forbidden = /\b(live|working|connected|active)\b/i;
    for (const kind of ['configured', 'unconfigured', 'unbuilt', 'unknown'] as const) {
      expect(statusSentence('Gmail', kind)).not.toMatch(forbidden);
    }
  });
});

describe('IntegrationStatusStrip', () => {
  it('marks the configured service and only the configured service', () => {
    render(<IntegrationStatusStrip readiness={loaded({ gmail: true, spotify: false })} />);

    expect(screen.getByTestId(`integration-status-${gmail.id}`)).toHaveAttribute(
      'data-status',
      'configured',
    );
    expect(screen.getByTestId(`integration-status-${spotify.id}`)).toHaveAttribute(
      'data-status',
      'unconfigured',
    );
    expect(screen.getByTestId('integration-status-strip')).toHaveAttribute(
      'data-configured-count',
      '1',
    );
  });

  it('caps the tiles and counts the remainder, so the header cannot overflow', () => {
    render(<IntegrationStatusStrip readiness={loaded({})} />);

    const tiles = INTEGRATION_CATALOGUE.filter((s) =>
      screen.queryByTestId(`integration-status-${s.id}`),
    );
    expect(tiles).toHaveLength(MAX_TILES);
    expect(screen.getByTestId('integration-status-overflow')).toHaveTextContent(
      `+${INTEGRATION_CATALOGUE.length - MAX_TILES}`,
    );
  });

  it('shows the configured services first, so they survive the overflow cut', () => {
    // Two configured out of nine: both must be inside the visible six.
    render(<IntegrationStatusStrip readiness={loaded({ hebcal: true, whatsapp: true })} />);

    expect(screen.getByTestId('integration-status-hebcal')).toBeInTheDocument();
    expect(screen.getByTestId('integration-status-whatsapp')).toBeInTheDocument();
  });

  it('says the status is unavailable rather than reporting a count it cannot justify', () => {
    render(<IntegrationStatusStrip readiness={{ state: 'unavailable', configured: {} }} />);

    const strip = screen.getByTestId('integration-status-strip');
    expect(strip).toHaveAccessibleName(/status unavailable/i);
    expect(strip).not.toHaveAccessibleName(/0 of 9/);
  });

  it('warns in the tooltip that credentials present is not the same as working', () => {
    render(<IntegrationStatusStrip readiness={loaded({ gmail: true })} />);

    expect(screen.getByTestId('integration-status-strip').getAttribute('title')).toContain(
      'can still fail if they have been revoked',
    );
  });

  it('opens the integrations panel when pressed', async () => {
    const onOpen = vi.fn();
    render(<IntegrationStatusStrip readiness={loaded({})} onOpen={onOpen} />);

    await userEvent.click(screen.getByTestId('integration-status-strip'));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
