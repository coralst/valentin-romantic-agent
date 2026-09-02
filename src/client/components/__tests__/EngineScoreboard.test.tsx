import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EngineScoreboard,
  SCOREBOARD_COPY,
  EXTRACTION_LINES,
  MEMORY_LINES,
  REPLACED_LINES,
} from '../EngineScoreboard';
import { ENGINE_COPY } from '../../context/architecture-engine-context';
import type { EngineMetrics } from '../../hooks/use-engine-metrics';

const EMPTY: EngineMetrics = {
  valentin: { turns: 0, tokenTurns: 0 },
  agentcore: { turns: 0, tokenTurns: 0 },
  unattributed: 0,
};

const MEASURED: EngineMetrics = {
  valentin: {
    turns: 4,
    modelCallsPerTurn: 2,
    storeReadsPerTurn: 9,
    storeBackend: 'dynamodb',
    tokensPerTurn: 3752,
    tokenTurns: 4,
    replyP50Ms: 1240,
    replyP95Ms: 2100,
  },
  agentcore: {
    turns: 3,
    modelCallsPerTurn: 1,
    storeReadsPerTurn: 11,
    storeBackend: 'dynamodb',
    tokenTurns: 0,
    replyP50Ms: 1610,
    replyP95Ms: 2400,
  },
  unattributed: 0,
};

describe('EngineScoreboard', () => {
  it('shows an em dash, never a zero, for a value nobody measured', () => {
    render(<EngineScoreboard metrics={EMPTY} isLive serving="valentin" />);

    const sheet = screen.getByTestId('engine-scoreboard');
    // The two static tiles carry real counts, so digits exist; what must not exist is
    // a measured tile reading 0.
    expect(sheet.textContent).toContain('—');
    expect(sheet.textContent).toContain(SCOREBOARD_COPY.liveEmpty);
  });

  it('renders zero digits in demo mode', () => {
    // The guard against `aws-demo-flows.ts`, whose engine-B durations are authored and
    // deliberately larger than engine A's. Showing any number here under the heading
    // "measured" would turn a narration aid into a fabricated benchmark.
    render(<EngineScoreboard metrics={MEASURED} isLive={false} serving="valentin" />);

    const sheet = screen.getByTestId('engine-scoreboard');
    expect(sheet.textContent ?? '').not.toMatch(/\d/);
    expect(screen.getByTestId('engine-scoreboard-refusal').textContent).toBe(
      SCOREBOARD_COPY.demoRefusal,
    );
  });

  it('shows measured values for both engines when live', () => {
    render(<EngineScoreboard metrics={MEASURED} isLive serving="agentcore" />);

    const text = screen.getByTestId('engine-scoreboard').textContent ?? '';
    expect(text).toContain('1.2s');
    expect(text).toContain('1.6s');
    expect(text).toContain('3.8k');
    // AgentCore reports no token usage, so its token tile stays an em dash.
    expect(text).toContain('DynamoDB reads per turn');
  });

  it('calls them store reads, not DynamoDB reads, on the in-memory backend', () => {
    render(
      <EngineScoreboard
        metrics={{
          ...MEASURED,
          valentin: { ...MEASURED.valentin, storeBackend: 'memory' },
          agentcore: { ...MEASURED.agentcore, storeBackend: 'memory' },
        }}
        isLive
        serving="valentin"
      />,
    );

    const text = screen.getByTestId('engine-scoreboard').textContent ?? '';
    expect(text).toContain('store reads per turn');
    expect(text).not.toContain('DynamoDB reads per turn');
  });

  it('says which engine has not been run yet', () => {
    render(
      <EngineScoreboard
        metrics={{ ...MEASURED, agentcore: { turns: 0, tokenTurns: 0 } }}
        isLive
        serving="valentin"
      />,
    );

    const text = screen.getByTestId('engine-scoreboard').textContent ?? '';
    expect(text).toContain(`${ENGINE_COPY.agentcore} ${SCOREBOARD_COPY.notRun}`);
  });

  it('admits where glue code wins and does not overclaim what AgentCore removes', () => {
    render(<EngineScoreboard metrics={MEASURED} isLive serving="valentin" />);

    const text = screen.getByTestId('engine-scoreboard').textContent ?? '';
    expect(text).toContain(SCOREBOARD_COPY.glueWins);
    expect(text).toContain(SCOREBOARD_COPY.scope);
    expect(text).toContain(SCOREBOARD_COPY.legend);
  });

  it('uses the shared engine labels rather than retyping them', () => {
    render(<EngineScoreboard metrics={MEASURED} isLive serving="valentin" />);

    const text = screen.getByTestId('engine-scoreboard').textContent ?? '';
    expect(text).toContain(ENGINE_COPY.valentin);
    expect(text).toContain(ENGINE_COPY.agentcore);
  });
});

/**
 * The claim that cannot be allowed to rot.
 *
 * "727 lines stop being ours" is the panel's strongest honest argument, and it is a
 * hardcoded number. If someone deletes half the extractor, the tile keeps asserting the
 * old figure and the panel starts lying. Re-counting the real files here means the
 * repository itself has to agree.
 */
describe('the lines-we-own claim', () => {
  const countLines = (relative: string): number => {
    const path = resolve(__dirname, '../../../..', relative);
    return readFileSync(path, 'utf8').split('\n').length - 1;
  };

  it('matches the extraction files it is counted from', () => {
    const counted =
      countLines('src/server/extraction/preference-extractor.ts') +
      countLines('src/server/extraction/category-mapper.ts') +
      countLines('src/server/extraction/partner-name.ts');

    // A tolerance rather than an exact match: an unrelated one-line edit to the
    // extractor should not fail the build, but a rewrite or a deletion should.
    expect(Math.abs(counted - EXTRACTION_LINES) / EXTRACTION_LINES).toBeLessThan(0.1);
  });

  it('matches the conversation-memory file it is counted from', () => {
    const counted = countLines('src/server/persistence/conversation-memory.ts');
    expect(Math.abs(counted - MEMORY_LINES) / MEMORY_LINES).toBeLessThan(0.1);
  });

  it('adds up', () => {
    expect(REPLACED_LINES).toBe(EXTRACTION_LINES + MEMORY_LINES);
  });
});
