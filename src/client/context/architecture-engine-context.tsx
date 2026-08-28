import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  useArchitectureEngine as useEngineState,
  type UseArchitectureEngineResult,
} from '../hooks/use-architecture-engine';
import { fetchRuntimeConfig } from '../auth/runtime-config';
import type { ArchitectureEngine } from '../utils/aws-architecture';

/**
 * Which of the two backends the app is showing.
 *
 * Lifted out of the drawer for the same reason `architecture-drawer-context` was:
 * the control and the thing it controls now live in sibling subtrees. The switch
 * sits in the icon rail — a presenter reaches for it while talking, and the rail
 * is where the hand already is — while the diagram it redraws is mounted by
 * `AppLayout` inside the drawer. Local `useState` in the drawer could not be read
 * from the rail at all.
 *
 * The choice deliberately outlives the drawer being closed: closing the panel to
 * show the conversation and reopening it should not silently put you back on
 * engine A.
 */

/**
 * The selection, plus what the backend did about it.
 *
 * Two fields rather than one, because they can disagree and the disagreement
 * matters: `engine` is what you picked and what the socket is pointed at,
 * `servingEngine` is what actually answered. A deployment missing its AgentCore
 * wiring downgrades to engine A server-side while still accepting the socket, so
 * without the second field the UI would show AgentCore's diagram over engine A's
 * traffic and attribute one architecture's latency to the other.
 */
export interface ArchitectureEngineContextValue extends UseArchitectureEngineResult {
  /** The engine that answered, or `null` while unknown or unreachable. */
  servingEngine: ArchitectureEngine | null;
  /** True once we know the selected engine is not the one serving. */
  isDowngraded: boolean;
}

const ArchitectureEngineContext = createContext<ArchitectureEngineContextValue | null>(null);

export function ArchitectureEngineProvider({
  children,
  /**
   * Which engine to start on. The app always starts on A; this is the seam that
   * lets a test render a surface already switched over, without reaching through
   * the icon rail to click the switch it does not mount.
   */
  initialEngine = 'valentin',
}: {
  children: React.ReactNode;
  initialEngine?: ArchitectureEngine;
}) {
  const engine = useEngineState(initialEngine);
  const servingEngine = useServingEngine(engine.engine);

  return (
    <ArchitectureEngineContext.Provider
      value={{
        ...engine,
        servingEngine,
        // Only a *known* mismatch counts. `null` means the question has not been
        // answered yet, and warning during that gap would flash a scary chip on
        // every switch.
        isDowngraded: servingEngine !== null && servingEngine !== engine.engine,
      }}
    >
      {children}
    </ArchitectureEngineContext.Provider>
  );
}

/**
 * Ask the selected engine who it is.
 *
 * `GET /api/config` is unauthenticated and reports the engine the answering process
 * *resolved* to, so routing the request to the selected backend and reading that
 * field is the one honest way to confirm the switch took effect. Re-asked on every
 * switch rather than cached per engine: reachability is a property of the
 * deployment right now, and a proxy service that has since fallen over should stop
 * claiming to serve.
 */
function useServingEngine(engine: ArchitectureEngine): ArchitectureEngine | null {
  const [serving, setServing] = useState<ArchitectureEngine | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Back to unknown first, so the chip never shows the previous engine's answer
    // next to the new engine's name.
    setServing(null);

    fetchRuntimeConfig(engine)
      .then((config) => {
        if (cancelled) return;
        // A deployment predating two engines omits the field. Absent means engine
        // A, which is what such a deployment is.
        setServing(config.engine ?? 'valentin');
      })
      .catch(() => {
        // Unreachable is not the same as downgraded, so it stays `null` and the UI
        // says nothing rather than accusing the deployment of the wrong fault.
        if (!cancelled) setServing(null);
      });

    return () => {
      cancelled = true;
    };
  }, [engine]);

  return serving;
}

/**
 * Read the selected engine.
 *
 * Falls back to a fixed engine A rather than throwing, matching
 * `useArchitectureDrawer`: the rail is mounted standalone in several component
 * tests, and a hard throw would make this provider a hidden dependency of every
 * one of them.
 */
export function useArchitectureEngineContext(): ArchitectureEngineContextValue {
  return useContext(ArchitectureEngineContext) ?? FALLBACK;
}

const FALLBACK: ArchitectureEngineContextValue = {
  engine: 'valentin',
  setEngine: () => {},
  toggleEngine: () => {},
  // Not `'valentin'`: a component rendered without the provider has asked nobody,
  // and claiming a confirmed answer would put a "serving" chip on a screen where
  // nothing was ever checked.
  servingEngine: null,
  isDowngraded: false,
};

/**
 * The engine's names, in one place because three surfaces say them.
 *
 * "Glue code" rather than "hand-built": what the comparison is actually about is
 * the code between the model and the tools — session handling, memory reads, tool
 * dispatch, retries — which engine B replaces with managed primitives. "Hand-built"
 * described who typed it; "glue code" describes what it is, and it is the same
 * phrase the diagram's band caption uses.
 */
export const ENGINE_COPY = {
  group: 'Architecture engine',
  valentin: 'Glue code',
  agentcore: 'AgentCore',
} as const;

export const ENGINE_OPTIONS: readonly { value: ArchitectureEngine; label: string }[] = [
  { value: 'valentin', label: ENGINE_COPY.valentin },
  { value: 'agentcore', label: ENGINE_COPY.agentcore },
];
