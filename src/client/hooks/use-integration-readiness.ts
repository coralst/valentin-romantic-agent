import { useEffect, useState } from 'react';
import type {
  IntegrationId,
  IntegrationStatusResponse,
} from '../../shared/interfaces/integrations';
import { apiGetJson } from '../utils/api-client';

/**
 * Which outside services this *deployment* can actually reach.
 *
 * Distinct from the grants in `use-integrations-store`, and the difference is the
 * whole point of the hook. A grant is the visitor saying "you may"; readiness is
 * the server saying "I can". Both have to be true before a capability does
 * anything, and conflating them produces the one claim this UI must never make —
 * a row reading "Connected" for a service whose credentials were never set.
 *
 * Read once on mount. Readiness is a property of the server process, fixed at boot
 * by which environment variables exist, so polling it would be a request per
 * interval for an answer that cannot change.
 */

export type ReadinessState = 'loading' | 'loaded' | 'unavailable';

export interface IntegrationReadiness {
  state: ReadinessState;
  /** Empty until loaded. Absent id ⇒ unknown, which is rendered as not ready. */
  configured: Partial<Record<IntegrationId, boolean>>;
}

export function useIntegrationReadiness(): IntegrationReadiness {
  const [readiness, setReadiness] = useState<IntegrationReadiness>({
    state: 'loading',
    configured: {},
  });

  useEffect(() => {
    let live = true;

    apiGetJson<IntegrationStatusResponse>('/api/integrations')
      .then((body) => {
        if (!live) return;
        const configured: Partial<Record<IntegrationId, boolean>> = {};
        for (const entry of body.integrations) {
          configured[entry.id] = entry.configured;
        }
        setReadiness({ state: 'loaded', configured });
      })
      .catch(() => {
        /*
         * Swallowed on purpose, and it is not a silent failure — `unavailable` is
         * a state the panel renders, as "can't tell from here" rather than as
         * either "ready" or "not configured". Guessing in either direction would
         * be worse: one overclaims, the other tells the visitor a working service
         * is broken. There is nothing for them to do about it either way, so this
         * is not worth an error strip.
         */
        if (live) setReadiness({ state: 'unavailable', configured: {} });
      });

    return () => {
      live = false;
    };
  }, []);

  return readiness;
}

/** How ready a capability is, once its backing services are known. */
export type CapabilityReadiness =
  | 'aspirational'
  | 'ready'
  | 'partial'
  | 'unconfigured'
  | 'unknown';

/**
 * Fold a capability's backing services into one answer.
 *
 * Three outcomes rather than two, because Messages is Gmail *and* WhatsApp and the
 * two do not arrive together: Gmail needs one OAuth refresh token, while WhatsApp
 * needs a Meta business account and pre-approved message templates, which is a
 * review measured in days. Collapsing that to "not configured" would tell the
 * visitor email does not work when it does; collapsing it to "ready" would promise
 * a WhatsApp nudge that cannot be sent. So `partial` exists, and the caller is
 * expected to name which service is live — a state nobody can act on is a state
 * not worth showing.
 *
 * `unknown` when readiness has not arrived. Never a hopeful default.
 */
export function capabilityReadiness(
  backing: readonly IntegrationId[] | undefined,
  readiness: IntegrationReadiness,
): CapabilityReadiness {
  if (!backing || backing.length === 0) return 'aspirational';
  if (readiness.state !== 'loaded') return 'unknown';
  const live = backing.filter((id) => readiness.configured[id] === true);
  if (live.length === backing.length) return 'ready';
  return live.length > 0 ? 'partial' : 'unconfigured';
}

/** The configured services behind a capability, for naming them on screen. */
export function liveServices(
  backing: readonly IntegrationId[] | undefined,
  readiness: IntegrationReadiness,
): IntegrationId[] {
  return (backing ?? []).filter((id) => readiness.configured[id] === true);
}
