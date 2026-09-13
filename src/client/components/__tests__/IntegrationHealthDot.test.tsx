import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  IntegrationHealthDot,
  healthSentence,
  integrationHealth,
} from '../IntegrationHealthDot';
import { colors } from '../../design-system/tokens';

/*
 * The dot is the only part of the reach panel a visitor reads without reading, so
 * the fold behind it is asserted directly rather than through a rendered fan. What
 * must never happen is a green dot on a service this deployment cannot reach:
 * that is the panel's one unforgivable claim, and it is one `case` away at all
 * times.
 */
describe('integrationHealth', () => {
  it('is green only when the server says the credentials are there', () => {
    expect(integrationHealth('ready', 'loaded')).toBe('live');
    // `partial` is green too: where a row ever spans two providers, the half that
    // has credentials still has them, and the badge beside the dot names which.
    expect(integrationHealth('partial', 'loaded')).toBe('live');
  });

  it('is red for every way a row can fail to reach its provider', () => {
    expect(integrationHealth('unconfigured', 'loaded')).toBe('problem');
    expect(integrationHealth('aspirational', 'loaded')).toBe('problem');
  });

  /*
   * The two states that look the same in `capabilityReadiness` — both return
   * `unknown` — and must not look the same here. Before the first response lands
   * there is nothing to report; when the fetch has failed, the panel cannot reach
   * its own server, which is a fault and not a pause.
   */
  it('separates "not yet" from "could not ask"', () => {
    expect(integrationHealth('unknown', 'loading')).toBe('unknown');
    expect(integrationHealth('unknown', 'unavailable')).toBe('problem');
  });
});

describe('IntegrationHealthDot', () => {
  it('carries the state in a tooltip rather than in colour alone', () => {
    render(<IntegrationHealthDot health="live" name="Gmail" testId="dot" />);
    const dot = screen.getByTestId('dot');
    expect(dot).toHaveAttribute('data-health', 'live');
    expect(dot.getAttribute('title')).toContain('Gmail');
    // The claim is "credentials", never "working" — a revoked token still reports
    // ready, and the tooltip is where that gap is admitted.
    expect(dot.getAttribute('title')).toContain('revoked');
  });

  it('paints the semantic tokens, so the palette stays one place', () => {
    const { rerender } = render(<IntegrationHealthDot health="live" name="Gmail" testId="dot" />);
    expect(screen.getByTestId('dot').style.backgroundColor).toBe(hexToRgb(colors.success));

    rerender(<IntegrationHealthDot health="problem" name="Spotify" testId="dot" />);
    expect(screen.getByTestId('dot').style.backgroundColor).toBe(hexToRgb(colors.error));
  });

  it('says nothing definite while it is still checking', () => {
    render(<IntegrationHealthDot health="unknown" name="Wolt" testId="dot" />);
    expect(healthSentence('Wolt', 'unknown')).toContain('checking');
    // Hollow: neither verdict. A grey fill would read as a third one.
    expect(screen.getByTestId('dot').style.backgroundColor).toBe(hexToRgb(colors.porcelain));
  });
});

/** jsdom normalises inline colours to `rgb()`, so the expectation has to match. */
function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
