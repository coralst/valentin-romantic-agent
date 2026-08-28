import React, { createContext, useContext } from 'react';
import {
  useArchitectureEngine as useEngineState,
  type UseArchitectureEngineResult,
} from '../hooks/use-architecture-engine';
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

const ArchitectureEngineContext = createContext<UseArchitectureEngineResult | null>(null);

export function ArchitectureEngineProvider({ children }: { children: React.ReactNode }) {
  const engine = useEngineState('valentin');

  return (
    <ArchitectureEngineContext.Provider value={engine}>
      {children}
    </ArchitectureEngineContext.Provider>
  );
}

/**
 * Read the selected engine.
 *
 * Falls back to a fixed engine A rather than throwing, matching
 * `useArchitectureDrawer`: the rail is mounted standalone in several component
 * tests, and a hard throw would make this provider a hidden dependency of every
 * one of them.
 */
export function useArchitectureEngineContext(): UseArchitectureEngineResult {
  return useContext(ArchitectureEngineContext) ?? FALLBACK;
}

const FALLBACK: UseArchitectureEngineResult = {
  engine: 'valentin',
  setEngine: () => {},
  toggleEngine: () => {},
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
