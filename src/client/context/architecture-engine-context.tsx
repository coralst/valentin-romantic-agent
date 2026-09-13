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

/** `?engine=agentcore` — the one way a *link* can choose which architecture it opens on. */
export const ENGINE_PARAM = 'engine';

/** Where the last selection is kept, so a reload does not silently undo it. */
const ENGINE_STORAGE_KEY = 'valentin.architecture-engine';

function asEngine(value: string | null | undefined): ArchitectureEngine | undefined {
  if (value === 'agentcore' || value === 'valentin') return value;
  // What the rail calls the engine is what a presenter will type into a URL.
  if (value === 'diy') return 'valentin';
  return undefined;
}

/**
 * Which engine this page load opened on: the URL, then the last selection, then A.
 *
 * Read at module load, for the reason `share-view.ts` spells out at length —
 * `cognito-oauth.ts` finishes a sign-in with
 * `window.history.replaceState({}, '', window.location.pathname)`, which wipes the
 * *whole* query string, and `ShareEntry` cleans the URL after spending its token. A
 * provider that read `window.location` in an effect would find the parameter already
 * gone on exactly the two entry paths that matter.
 *
 * The parameter exists because of a real demo failure: a share link handed to
 * somebody to show engine B opened on **DIY**, because the engine was in-memory
 * state initialised to `'valentin'` on every load and nothing in the link said
 * otherwise. The signed share token cannot carry it — it is minted server-side and
 * the links already in people's hands are fixed — but a query parameter can be
 * appended to any of those links, including a `?share=` one.
 *
 * Storage is `sessionStorage`, not `localStorage`: surviving a reload mid-demo is
 * the point, and a machine that opens the app tomorrow should start from the
 * default rather than from a choice nobody remembers making.
 */
export const openedOnEngine: ArchitectureEngine | undefined = readOpeningEngine();

/**
 * The decision itself, separated from where the two inputs come from.
 *
 * Pure and exported so it can be tested at all: {@link openedOnEngine} is evaluated
 * when this module is imported, which is before any test can set a URL, and a test
 * that reassigned it would be asserting against its own seam rather than the rule.
 *
 * The URL beats storage because it is the more deliberate of the two: somebody typed
 * or pasted it for this page load, while storage only remembers what was clicked
 * earlier.
 */
export function resolveOpeningEngine(
  search: string,
  stored: string | null,
): ArchitectureEngine | undefined {
  return asEngine(new URLSearchParams(search).get(ENGINE_PARAM)) ?? asEngine(stored);
}

function readOpeningEngine(): ArchitectureEngine | undefined {
  if (typeof window === 'undefined') return undefined;

  try {
    return resolveOpeningEngine(
      window.location.search,
      window.sessionStorage.getItem(ENGINE_STORAGE_KEY),
    );
  } catch {
    // A blocked storage API is not a reason to fail to boot.
    return undefined;
  }
}

function rememberEngine(engine: ArchitectureEngine): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(ENGINE_STORAGE_KEY, engine);
  } catch {
    // Private-mode Safari throws on write. The toggle still works for this load.
  }
}

export function ArchitectureEngineProvider({
  children,
  /**
   * Which engine to start on. Defaults to whatever {@link openedOnEngine} read off
   * the URL and the last selection, and is also the seam that lets a test render a
   * surface already switched over, without reaching through the icon rail to click
   * the switch it does not mount.
   */
  initialEngine = openedOnEngine ?? 'valentin',
}: {
  children: React.ReactNode;
  initialEngine?: ArchitectureEngine;
}) {
  const engine = useEngineState(initialEngine);
  const servingEngine = useServingEngine(engine.engine);

  useEffect(() => {
    rememberEngine(engine.engine);
  }, [engine.engine]);

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
 * "DIY" rather than "hand-built": what the comparison is actually about is the
 * code between the model and the tools — session handling, memory reads, tool
 * dispatch, retries — which engine B replaces with managed primitives. "Hand-built"
 * described who typed it; "DIY" describes owning that layer yourself, which is the
 * choice the toggle is actually offering.
 */
export const ENGINE_COPY = {
  group: 'Architecture engine',
  valentin: 'DIY',
  agentcore: 'AgentCore',
} as const;

export const ENGINE_OPTIONS: readonly { value: ArchitectureEngine; label: string }[] = [
  { value: 'valentin', label: ENGINE_COPY.valentin },
  { value: 'agentcore', label: ENGINE_COPY.agentcore },
];
