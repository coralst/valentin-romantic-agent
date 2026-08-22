import { describe, it, expect, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useArchitectureMode } from '../use-architecture-mode';
import { publishInboundWsEvent, resetWsObservers } from '../../utils/ws-event-observer';
import type { ServerEvent } from '../../../shared/interfaces/ws-events';

const PONG: ServerEvent = { type: 'pong', payload: {}, timestamp: '2026-08-21T00:00:00.000Z' };

describe('useArchitectureMode', () => {
  afterEach(() => {
    resetWsObservers();
  });

  /**
   * The drawer must never open blank. At open time we cannot know whether a
   * socket exists, and a blank diagram in front of a room is the worst available
   * failure, so the scripted flow is the safe starting state.
   */
  it('starts in demo mode', () => {
    const { result } = renderHook(() => useArchitectureMode());
    expect(result.current.mode).toBe('demo');
    expect(result.current.hasLiveTraffic).toBe(false);
  });

  it('flips to live on the first observed event', () => {
    const { result } = renderHook(() => useArchitectureMode());

    act(() => {
      publishInboundWsEvent(PONG);
    });

    expect(result.current.mode).toBe('live');
    expect(result.current.hasLiveTraffic).toBe(true);
  });

  it('records traffic as an explicit signal, not just a mode change', () => {
    const { result } = renderHook(() => useArchitectureMode('live'));

    act(() => {
      publishInboundWsEvent(PONG);
    });

    expect(result.current.hasLiveTraffic).toBe(true);
    expect(result.current.isUserChosen).toBe(false);
  });

  it('honours an explicit choice', () => {
    const { result } = renderHook(() => useArchitectureMode());

    act(() => {
      result.current.setMode('live');
    });

    expect(result.current.mode).toBe('live');
    expect(result.current.isUserChosen).toBe(true);
  });

  /**
   * The behaviour this protects: a heartbeat arriving mid-sentence must not yank
   * the view out from under a presenter who deliberately chose the scripted flow.
   */
  it('does not let arriving traffic override the user', () => {
    const { result } = renderHook(() => useArchitectureMode());

    act(() => {
      result.current.setMode('demo');
    });
    act(() => {
      publishInboundWsEvent(PONG);
    });

    expect(result.current.mode).toBe('demo');
    expect(result.current.hasLiveTraffic).toBe(true);
  });

  it('keeps following traffic after clearing the override', () => {
    const { result } = renderHook(() => useArchitectureMode());

    act(() => {
      publishInboundWsEvent(PONG);
    });
    act(() => {
      result.current.setMode('demo');
    });
    act(() => {
      result.current.clearOverride();
    });

    // Traffic has already been seen, so live is the honest default again.
    expect(result.current.mode).toBe('live');
    expect(result.current.isUserChosen).toBe(false);
  });

  it('falls back to demo when clearing an override before any traffic', () => {
    const { result } = renderHook(() => useArchitectureMode());

    act(() => {
      result.current.setMode('live');
    });
    act(() => {
      result.current.clearOverride();
    });

    expect(result.current.mode).toBe('demo');
  });

  it('unsubscribes on unmount', () => {
    const { result, unmount } = renderHook(() => useArchitectureMode());
    unmount();

    act(() => {
      publishInboundWsEvent(PONG);
    });

    // No state change and, more to the point, no update on an unmounted hook.
    expect(result.current.mode).toBe('demo');
  });
});
