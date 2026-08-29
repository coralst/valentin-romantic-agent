import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import {
  ArchitectureEngineProvider,
  useArchitectureEngineContext,
} from '../architecture-engine-context';

/**
 * What the app believes about the engine, and how it found out.
 *
 * The selection is trivial state; the interesting half is `servingEngine`, which
 * exists because the selection can be *refused*. Pointing the socket at
 * `/ws/agentcore` on a deployment without the AgentCore wiring still connects — the
 * server downgrades to engine A rather than taking the task down — so "which engine
 * did I ask for" and "which engine answered" are two different questions, and the
 * UI is only honest if it can tell them apart.
 */
describe('ArchitectureEngineProvider', () => {
  /** Renders the context value as text, so assertions read it without a hook wrapper. */
  function Probe() {
    const { engine, servingEngine, isDowngraded, setEngine } = useArchitectureEngineContext();
    return (
      <div>
        <span data-testid="selected">{engine}</span>
        <span data-testid="serving">{servingEngine ?? 'unknown'}</span>
        <span data-testid="downgraded">{String(isDowngraded)}</span>
        <button type="button" onClick={() => setEngine('agentcore')}>
          pick agentcore
        </button>
      </div>
    );
  }

  /** The header the ALB routes on, from the most recent `/api/config` call. */
  function requestedEngine(call: number): string | undefined {
    const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
    return (init?.headers as Record<string, string> | undefined)?.['X-Valentin-Engine'];
  }

  let fetchMock: ReturnType<typeof vi.fn>;

  /** `/api/config` answering as a given engine. */
  function configAnswering(engine: string | undefined) {
    return { ok: true, json: async () => ({ authDisabled: true, engine }) };
  }

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(configAnswering('valentin'));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts on engine A', async () => {
    render(
      <ArchitectureEngineProvider>
        <Probe />
      </ArchitectureEngineProvider>,
    );
    expect(screen.getByTestId('selected')).toHaveTextContent('valentin');
    // Waited out rather than left in flight: the provider asks who is serving on
    // mount, and a state update landing after the test ends is an act() warning.
    await waitFor(() => expect(screen.getByTestId('serving')).toHaveTextContent('valentin'));
  });

  it('asks the baseline route who is serving, with no routing header', async () => {
    render(
      <ArchitectureEngineProvider>
        <Probe />
      </ArchitectureEngineProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('serving')).toHaveTextContent('valentin'));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/config');
    // Engine A is the listener's default action, so a header here would be noise.
    expect(requestedEngine(0)).toBeUndefined();
  });

  it('routes the question to the AgentCore service when AgentCore is selected', async () => {
    fetchMock.mockResolvedValue(configAnswering('agentcore'));
    render(
      <ArchitectureEngineProvider>
        <Probe />
      </ArchitectureEngineProvider>,
    );
    act(() => {
      screen.getByRole('button').click();
    });

    await waitFor(() => expect(screen.getByTestId('serving')).toHaveTextContent('agentcore'));
    expect(requestedEngine(fetchMock.mock.calls.length - 1)).toBe('agentcore');
    expect(screen.getByTestId('downgraded')).toHaveTextContent('false');
  });

  it('reports a downgrade when the selected engine is not the one answering', async () => {
    // The local case, and the misconfigured-deployment case: one process, engine A,
    // accepting the AgentCore socket path quite happily.
    render(
      <ArchitectureEngineProvider>
        <Probe />
      </ArchitectureEngineProvider>,
    );
    act(() => {
      screen.getByRole('button').click();
    });

    await waitFor(() => expect(screen.getByTestId('downgraded')).toHaveTextContent('true'));
    expect(screen.getByTestId('serving')).toHaveTextContent('valentin');
  });

  it('treats a config without an engine field as engine A', async () => {
    // A deployment predating two engines omits it, and that deployment is engine A.
    fetchMock.mockResolvedValue(configAnswering(undefined));
    render(
      <ArchitectureEngineProvider>
        <Probe />
      </ArchitectureEngineProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('serving')).toHaveTextContent('valentin'));
    expect(screen.getByTestId('downgraded')).toHaveTextContent('false');
  });

  it('claims no downgrade when it could not ask', async () => {
    // Unreachable is not refused. Accusing the deployment of downgrading when the
    // request never landed would send someone looking for the wrong fault.
    fetchMock.mockRejectedValue(new Error('offline'));
    render(
      <ArchitectureEngineProvider>
        <Probe />
      </ArchitectureEngineProvider>,
    );
    act(() => {
      screen.getByRole('button').click();
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByTestId('serving')).toHaveTextContent('unknown');
    expect(screen.getByTestId('downgraded')).toHaveTextContent('false');
  });

  it('re-asks on every switch rather than trusting a cached answer', async () => {
    render(
      <ArchitectureEngineProvider>
        <Probe />
      </ArchitectureEngineProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    act(() => {
      screen.getByRole('button').click();
    });
    // Reachability is a property of the deployment right now, not of the engine.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('is inert without a provider, and confirms nothing', () => {
    // Matching `useArchitectureDrawer`: several component tests mount the rail
    // standalone, and a throw would make this provider their hidden dependency.
    render(<Probe />);
    expect(screen.getByTestId('selected')).toHaveTextContent('valentin');
    // Deliberately not 'valentin': nobody was asked, so there is nothing to report.
    expect(screen.getByTestId('serving')).toHaveTextContent('unknown');
    expect(screen.getByTestId('downgraded')).toHaveTextContent('false');
  });
});
