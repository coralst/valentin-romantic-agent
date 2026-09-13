import { describe, it, expect, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useLiveArchitecture } from '../use-live-architecture';
import { publishInboundWsEvent, resetWsObservers } from '../../utils/ws-event-observer';
import type { ServerEvent } from '../../../shared/interfaces/ws-events';

/**
 * What each recorded beat says it produced on screen.
 *
 * Kept in its own file rather than added to `use-live-architecture.test.ts`: that
 * file is being rewritten on an open branch, and these assertions are about a
 * different property of the same hook.
 */

const TIMESTAMP = '2026-09-13T08:00:00.000Z';

const AGENT_MESSAGE: ServerEvent = {
  type: 'agent_message',
  payload: {
    message: {
      id: 'msg-9',
      sessionId: 'sess-1',
      sender: 'agent',
      content: 'Noted.',
      timestamp: TIMESTAMP,
    },
  },
  timestamp: TIMESTAMP,
};

const TOOL_START: ServerEvent = {
  type: 'agent_activity',
  payload: {
    kind: 'tool_start',
    sessionId: 'sess-1',
    id: 'tool-use-1',
    iteration: 1,
    tool: 'check_availability',
    service: 'ontopo',
    inputSummary: 'a table for two',
  },
  timestamp: TIMESTAMP,
};

const TOOL_SPAN: ServerEvent = {
  type: 'aws_span',
  payload: {
    sessionId: 'sess-1',
    resourceId: 'integrations',
    service: 'External APIs',
    resourceName: 'valentin-integration-tools',
    operation: 'check_availability',
    durationMs: 412,
    ok: true,
  },
  timestamp: TIMESTAMP,
};

afterEach(() => {
  resetWsObservers();
});

describe('useLiveArchitecture — what each beat produced', () => {
  it("names the reply on the beat that carried it", () => {
    const { result } = renderHook(() => useLiveArchitecture());

    act(() => publishInboundWsEvent(AGENT_MESSAGE));

    expect(result.current.beats).toHaveLength(1);
    expect(result.current.beats[0].targets).toEqual([{ kind: 'message', messageId: 'msg-9' }]);
  });

  it('still records no beat for an activity frame', () => {
    // Read on the way past for its service name, then dropped as always — several
    // arrive per turn, and rows of their own would push every action off the feed.
    const { result } = renderHook(() => useLiveArchitecture());

    act(() => publishInboundWsEvent(TOOL_START));

    expect(result.current.beats).toHaveLength(0);
  });

  it('names the integration on a tool span, recovered from the activity frame', () => {
    const { result } = renderHook(() => useLiveArchitecture());

    act(() => publishInboundWsEvent(TOOL_START));
    act(() => publishInboundWsEvent(TOOL_SPAN));

    expect(result.current.beats).toHaveLength(1);
    expect(result.current.beats[0].targets).toEqual([{ kind: 'tool', service: 'ontopo' }]);
  });

  it('leaves a tool span unattributed rather than guessing, with no frame to learn from', () => {
    // The span alone says `External APIs` and the tool name; which partner it was
    // is genuinely not on it. A wrong icon glowing on stage is worse than none.
    const { result } = renderHook(() => useLiveArchitecture());

    act(() => publishInboundWsEvent(TOOL_SPAN));

    expect(result.current.beats).toHaveLength(1);
    expect(result.current.beats[0].targets).toEqual([]);
  });

  it('has nothing to point at on a beat that produced no element', () => {
    const { result } = renderHook(() => useLiveArchitecture());

    act(() =>
      publishInboundWsEvent({
        type: 'typing_stop',
        payload: { sessionId: 'sess-1' },
        timestamp: TIMESTAMP,
      }),
    );

    expect(result.current.beats[0].targets).toEqual([]);
  });
});
