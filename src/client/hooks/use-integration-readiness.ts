import { useCallback, useEffect, useState } from 'react';
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
 * Read on mount, and again on demand. It used to be fetch-once, on the grounds
 * that readiness was fixed at boot by which environment variables existed — that
 * stopped being true when credentials became something the panel can hand over
 * at runtime. Still not polled: it changes only as a result of an action taken in
 * this UI, so the action refetches and nothing else needs to.
 */

export type ReadinessState = 'loading' | 'loaded' | 'unavailable';

export interface IntegrationReadiness {
  state: ReadinessState;
  /** Empty until loaded. Absent id ⇒ unknown, which is rendered as not ready. */
  configured: Partial<Record<IntegrationId, boolean>>;
}

/** The hook's return: the data, plus the means to ask again. */
export interface IntegrationReadinessHandle extends IntegrationReadiness {
  /**
   * Refetch. Safe to call from a completed request's `.then` — a refresh that
   * lands after unmount is dropped rather than warned about.
   *
   * Deliberately not on {@link IntegrationReadiness} itself, which stays a plain
   * data shape so `capabilityReadiness` and every test fixture can keep building
   * one from two fields.
   */
  refresh: () => void;
}

export function useIntegrationReadiness(): IntegrationReadinessHandle {
  const [readiness, setReadiness] = useState<IntegrationReadiness>({
    state: 'loading',
    configured: {},
  });
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

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
    // `nonce` is the refetch trigger. Not `readiness` — depending on the value we
    // set here would loop.
  }, [nonce]);

  return { ...readiness, refresh };
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
