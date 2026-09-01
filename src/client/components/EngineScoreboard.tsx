import React from 'react';
import { colors, typography } from '../design-system/tokens';
import { ENGINE_COPY } from '../context/architecture-engine-context';
import type { EngineId } from '../../shared/interfaces/engine';
import type { EngineMetrics, EngineTally } from '../hooks/use-engine-metrics';

/**
 * What each engine costs per turn, measured.
 *
 * The point of this panel is narrower than "AgentCore is better", and deliberately
 * so. Two of the three arguments people reach for do not survive this codebase:
 *
 * - **Latency is worse on engine B, by construction.** `InvokeAgentRuntime` is a
 *   second network call wrapping the model call, and a tool goes out over MCP to a
 *   Lambda instead of the in-process SDK. The tile stays, reported straight, because a
 *   comparison that hid its own cost would not deserve to be believed on anything else.
 * - **Store reads are a wash or worse.** `agentcore-orchestrator.ts` calls the *same*
 *   `readKnownFacts()` as engine A, and additionally does a `findPreference` per
 *   remembered record when mirroring. Engine A's only extra read is the extractor's
 *   history fetch — one query, not seven.
 *
 * What does survive: engine A makes strictly more model calls per turn, because it
 * pays for a separate forced-tool `extract-preferences` Converse that AgentCore Memory
 * does on its own schedule; and 727 lines of extraction and conversation-memory code
 * stop being ours to maintain.
 */

/** Height of the sheet. Fixed so the drawer's own geometry is untouched. */
export const SCOREBOARD_HEIGHT = 172;

export const SCOREBOARD_COPY = {
  toggleOpen: 'Why AgentCore',
  toggleClose: 'Hide the comparison',
  title: 'Per turn, measured',
  /**
   * Shown instead of every number in demo mode.
   *
   * Load-bearing. `aws-demo-flows.ts` states in its own comments that engine B's
   * durations there are "authored and deliberately larger" than engine A's — they are
   * a narration device, not a measurement. Rendering them here under the word
   * "measured" would turn an honest demo aid into a fabricated benchmark.
   */
  demoRefusal:
    'Demo durations are authored, not measured. Switch the data source to Live to fill this in.',
  /** Shown when live but nothing has happened yet. */
  liveEmpty: 'Send a message on each engine and both columns fill in.',
  glueWins:
    'Glue code wins at: fixed cost under steady load, no preview-service dependency, and propose-then-confirm — engine B has none.',
  scope:
    'AgentCore still answers behind a Fargate proxy here. What it removes is the stateful Fargate, the hand-written extractor and the DynamoDB memory layer — not Fargate.',
  legend: '● measured live · ▪ counted in this repo · ○ published-rate calculation',
  notRun: 'not yet run',
} as const;

/**
 * Where a number came from.
 *
 * Displayed, not just tracked. A room cannot tell a stopwatch reading from an arithmetic
 * result from a price list, and every one of those is on this panel.
 */
type Provenance = 'measured' | 'counted' | 'calculated';

const PROVENANCE_MARK: Record<Provenance, string> = {
  measured: '●',
  counted: '▪',
  calculated: '○',
};

/**
 * The two static tiles, with the commands that produced them.
 *
 * `wc -l src/server/extraction/*.ts` → 545 (`preference-extractor.ts`) + 50
 * (`category-mapper.ts`) + 29 (`partner-name.ts`) = 624, plus `conversation-memory.ts`
 * at 103 lines, whose budget-and-truncation half is what AgentCore Memory replaces.
 * `extraction-line-count.test.ts` re-counts these files and fails if they drift, so the
 * claim cannot quietly rot into a lie.
 */
export const EXTRACTION_LINES = 624;
export const MEMORY_LINES = 103;
export const REPLACED_LINES = EXTRACTION_LINES + MEMORY_LINES;

/**
 * Idle floor, from the CDK rather than from a price list.
 *
 * `minCapacity: config.desiredCount` with dev `desiredCount: 1`
 * (`infra/config/environments.ts`), so engine A never scales below one task. Stated as
 * a shape rather than a dollar figure on purpose: the NAT gateway and the ALB are
 * shared by both engines, and the second always-on dev task is engine B's *own* proxy,
 * so a "$/month for engine A" number would be double-billing AgentCore for its own hop.
 */
const IDLE_FLOOR = { valentin: '1', agentcore: '0' };

/** One number, or `—` when nobody measured it. */
function Value({ text, dim }: { text: string; dim: boolean }) {
  return (
    <span
      style={{
        fontSize: 24,
        lineHeight: 1.1,
        fontVariantNumeric: 'tabular-nums',
        color: dim ? colors.warmTaupe : colors.text,
      }}
    >
      {text}
    </span>
  );
}

interface TileProps {
  caption: string;
  provenance: Provenance;
  left?: string;
  right?: string;
  title?: string;
}

/**
 * One metric, both engines.
 *
 * `—` for an unmeasured value, never `0`. A zero here would claim the call was free or
 * never happened; the em dash says nobody counted, which is a different and often more
 * important fact. Same rule as `AwsSpan.durationMs`.
 */
function Tile({ caption, provenance, left, right, title }: TileProps) {
  return (
    <div style={{ minWidth: 128, flex: '1 1 0' }} title={title}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <Value text={left ?? '—'} dim={left === undefined} />
        <span style={{ color: colors.warmTaupe, fontSize: 13 }}>→</span>
        <span
          style={{
            fontSize: 24,
            lineHeight: 1.1,
            fontVariantNumeric: 'tabular-nums',
            color: right === undefined ? colors.warmTaupe : colors.claret,
          }}
        >
          {right ?? '—'}
        </span>
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 10.5,
          lineHeight: 1.3,
          color: colors.textSecondary,
          fontFamily: typography.bodyFontFamily,
        }}
      >
        <span style={{ marginRight: 4, color: colors.warmTaupe }}>
          {PROVENANCE_MARK[provenance]}
        </span>
        {caption}
      </div>
    </div>
  );
}

/** Round a mean to one decimal, dropping a pointless `.0`. */
function mean(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function millis(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

function tokens(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value));
}

/**
 * How to label the reads tile.
 *
 * "DynamoDB reads" only when the reads really hit DynamoDB. `STORAGE_BACKEND` defaults
 * to `memory`, so on a laptop they do not, and a panel describing an architecture it is
 * not running would be the same class of error as mislabelling the engine.
 */
function readsCaption(a: EngineTally, b: EngineTally): string {
  const backend = a.storeBackend ?? b.storeBackend;
  return backend === 'dynamodb' ? 'DynamoDB reads per turn' : 'store reads per turn';
}

export interface EngineScoreboardProps {
  metrics: EngineMetrics;
  /** False in demo or replay mode, when no number on screen was measured. */
  isLive: boolean;
  /** The engine confirmed to be answering, for the provenance strip. */
  serving: EngineId | null;
}

export function EngineScoreboard({ metrics, isLive, serving }: EngineScoreboardProps) {
  const a = metrics.valentin;
  const b = metrics.agentcore;

  return (
    <section
      data-testid="engine-scoreboard"
      aria-label={SCOREBOARD_COPY.title}
      style={{
        height: SCOREBOARD_HEIGHT,
        boxSizing: 'border-box',
        padding: '12px 18px',
        background: colors.surface,
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        fontFamily: typography.bodyFontFamily,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: colors.textSecondary }}>
          {SCOREBOARD_COPY.title}
        </span>
        <span style={{ fontSize: 10.5, color: colors.warmTaupe }}>
          {ENGINE_COPY.valentin} → <span style={{ color: colors.claret }}>{ENGINE_COPY.agentcore}</span>
        </span>
        {/* Suppressed in demo mode along with everything else. The turn counts are
            themselves measurements, and a sheet that refuses to show latencies while
            still reporting "4 turns" would be refusing only half of what it should. */}
        {isLive && (
          <span style={{ marginLeft: 'auto', fontSize: 10.5, color: colors.textSecondary }}>
            {turnsLabel(a, b, serving)}
          </span>
        )}
      </div>

      {!isLive ? (
        <p
          data-testid="engine-scoreboard-refusal"
          style={{ margin: 0, fontSize: 12, color: colors.textSecondary, maxWidth: 520 }}
        >
          {SCOREBOARD_COPY.demoRefusal}
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <Tile
              caption="model calls per turn"
              provenance="measured"
              left={mean(a.modelCallsPerTurn)}
              right={mean(b.modelCallsPerTurn)}
              title="Engine A adds a forced-tool extract-preferences Converse to every turn."
            />
            <Tile
              caption={readsCaption(a, b)}
              provenance="measured"
              left={mean(a.storeReadsPerTurn)}
              right={mean(b.storeReadsPerTurn)}
              title="Both engines call the same readKnownFacts(); engine B also mirrors preferences back."
            />
            <Tile
              caption="reply p50"
              provenance="measured"
              left={millis(a.replyP50Ms)}
              right={millis(b.replyP50Ms)}
              title={`p95: ${millis(a.replyP95Ms) ?? '—'} → ${millis(b.replyP95Ms) ?? '—'}. AgentCore adds a network hop; this is its cost, not its win.`}
            />
            <Tile
              caption="tokens per turn"
              provenance="measured"
              left={tokens(a.tokensPerTurn)}
              right={tokens(b.tokensPerTurn)}
              title="AgentCore's Runtime reports no usage today, so its tokens are unmeasured rather than zero."
            />
            <Tile
              caption="lines of extraction we own"
              provenance="counted"
              left={String(REPLACED_LINES)}
              right="0"
              title={`${EXTRACTION_LINES} lines of src/server/extraction/ plus ${MEMORY_LINES} of conversation-memory.ts.`}
            />
            <Tile
              caption="always-on tasks (dev)"
              provenance="calculated"
              left={IDLE_FLOOR.valentin}
              right={IDLE_FLOOR.agentcore}
              title="minCapacity: config.desiredCount, with dev desiredCount: 1, so engine A never scales to nothing; AgentCore Runtime bills per invocation-second. The NAT gateway and the ALB are shared by both engines and are not counted here."
            />
          </div>

        </>
      )}

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 9.5, color: colors.warmTaupe }}>{SCOREBOARD_COPY.legend}</span>
        <span style={{ fontSize: 10, color: colors.textSecondary }}>{SCOREBOARD_COPY.glueWins}</span>
        <span style={{ fontSize: 10, color: colors.textSecondary }}>{SCOREBOARD_COPY.scope}</span>
      </div>
    </section>
  );
}

/**
 * How many turns each column rests on.
 *
 * Shown because the two columns are almost never measured at the same time — one
 * process serves one engine, so the second column requires a restart — and a reader
 * deserves to know that one side is thinner evidence than the other.
 */
function turnsLabel(a: EngineTally, b: EngineTally, serving: EngineId | null): string {
  // Nothing measured at all: say what to do about it instead of printing two
  // "not yet run"s and leaving the reader to guess.
  if (a.turns === 0 && b.turns === 0) return SCOREBOARD_COPY.liveEmpty;

  const describe = (tally: EngineTally, label: string) =>
    tally.turns === 0
      ? `${label} ${SCOREBOARD_COPY.notRun}`
      : `${label} ${tally.turns} turn${tally.turns === 1 ? '' : 's'}`;

  const servingNote = serving ? ` · serving ${ENGINE_COPY[serving]}` : '';
  return `${describe(a, ENGINE_COPY.valentin)} · ${describe(b, ENGINE_COPY.agentcore)}${servingNote}`;
}
