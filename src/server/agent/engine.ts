import { config } from '../config';
import { logger } from '../logging';

/** Which of the two backends a task is serving. */
export type AgentEngine = 'valentin' | 'agentcore';

/** The engine a task falls back to, and the one every existing test exercises. */
export const DEFAULT_ENGINE: AgentEngine = 'valentin';

/**
 * Which engine this process serves.
 *
 * PER PROCESS, NOT PER REQUEST. `compute-stack.ts` runs two Fargate services off
 * one image and distinguishes them only by `AGENT_ENGINE`; the ALB sends
 * `/api/agentcore/*`, `/ws/agentcore` and `X-Valentin-Engine: agentcore` to the
 * second one. So by the time a request reaches this code the routing decision is
 * already made, and re-deciding it here from the path would let a task serve both
 * engines — which would put both engines' latency in one log group and one set of
 * task metrics, and there would be no honest way to chart them apart.
 *
 * A REQUESTED-BUT-UNAVAILABLE ENGINE DOWNGRADES LOUDLY. `AGENTCORE_RUNTIME_ARN`
 * being unset means the AgentCore stack was not deployed or the props were not
 * threaded through, and the choices were: throw and take the task down, or serve
 * engine A while claiming to be engine B. Neither is acceptable — the first turns
 * a misconfiguration into an outage, the second silently attributes engine A's
 * numbers to AgentCore. So it downgrades *and* says so: `agent.engine` is logged
 * at boot with `requested` and `resolved`, and `GET /api/config` reports the
 * resolved value, so the comparison UI labels what actually ran.
 *
 * Unset `AGENT_ENGINE` is engine A with no warning at all. That is the ordinary
 * case for `npm test`, Playwright and `npm run dev:server`, none of which have an
 * AWS account.
 */
export function resolveEngine(
  requested: string | undefined = process.env.AGENT_ENGINE,
): AgentEngine {
  const normalized = requested?.trim().toLowerCase();

  if (!normalized || normalized === 'valentin') return DEFAULT_ENGINE;

  if (normalized !== 'agentcore') {
    logger.warn('agent.engine.unknown', {
      requested,
      resolved: DEFAULT_ENGINE,
      reason: 'AGENT_ENGINE must be "valentin" or "agentcore"',
    });
    return DEFAULT_ENGINE;
  }

  if (!config.agentCore.runtimeArn) {
    logger.error('agent.engine.unavailable', {
      requested: 'agentcore',
      resolved: DEFAULT_ENGINE,
      reason: 'AGENTCORE_RUNTIME_ARN is unset, so the Runtime cannot be reached',
    });
    return DEFAULT_ENGINE;
  }

  return 'agentcore';
}

/**
 * The WebSocket paths a task accepts an upgrade on.
 *
 * Both engines accept both paths on purpose. `/ws/agentcore` is an ALB routing
 * label rather than a second protocol — the frames on it are identical — and
 * making each task accept only "its own" path would mean a browser pointed at a
 * single-process local server could not open a socket at all, and that a
 * misrouted upgrade would fail as a dropped connection rather than as a
 * mislabelled engine. The engine a socket runs is `resolveEngine()`, not the
 * path it arrived on; `/api/config` is what tells the client which it got.
 */
export const WS_PATHS: readonly string[] = ['/ws', '/ws/agentcore'];

/** True when this upgrade request is for the chat socket. */
export function isWebSocketPath(url: string | undefined): boolean {
  if (!url) return false;
  // Compared without a query string: the client appends none today, but an
  // upgrade that failed on `?foo=1` would look like a network fault.
  const path = url.split('?')[0];
  return WS_PATHS.includes(path);
}
