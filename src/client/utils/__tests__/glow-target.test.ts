import { describe, it, expect } from 'vitest';

import {
  dedupeGlowTargets,
  glowSelectors,
  glowTargetKey,
  glowTargetsForEvent,
  glowTargetsForSpan,
  learnToolService,
  type GlowTarget,
} from '../glow-target';
import { DEMO_SEED_SOURCE_MESSAGE_ID } from '../provenance';
import type { ObservedWsEvent } from '../ws-event-observer';
import type { AwsSpan, ServerEvent, ClientEvent } from '../../../shared/interfaces/ws-events';
import type { PreferenceWithHistory } from '../../../shared/interfaces/preference';

function inbound(event: ServerEvent): ObservedWsEvent {
  return { direction: 'inbound', event };
}

function outbound(event: ClientEvent): ObservedWsEvent {
  return { direction: 'outbound', event };
}

const NOW = '2026-09-13T08:00:00.000Z';

function preference(overrides: Partial<PreferenceWithHistory> = {}): PreferenceWithHistory {
  return {
    id: 'pref-1',
    sessionId: 'session-1',
    category: 'food',
    key: 'favourite_cuisine',
    value: 'Chinese food',
    confidence: 0.9,
    sourceMessageId: 'message-7',
    createdAt: NOW,
    updatedAt: NOW,
    history: [],
    ...overrides,
  };
}

function span(overrides: Partial<AwsSpan> = {}): AwsSpan {
  return {
    sessionId: 'session-1',
    resourceId: 'integrations',
    service: 'External APIs',
    resourceName: 'valentin-integration-tools',
    operation: 'check_availability',
    ok: true,
    ...overrides,
  };
}

describe('glowTargetsForEvent', () => {
  it("names the agent's turn from an agent_message", () => {
    const targets = glowTargetsForEvent(
      inbound({
        type: 'agent_message',
        payload: {
          message: {
            id: 'message-9',
            sessionId: 'session-1',
            sender: 'agent',
            content: 'Noted.',
            timestamp: NOW,
          },
        },
        timestamp: NOW,
      }),
    );

    expect(targets).toEqual([{ kind: 'message', messageId: 'message-9' }]);
  });

  it("names the user's own turn from send_message, which is what a badge hangs under", () => {
    const targets = glowTargetsForEvent(
      outbound({
        type: 'send_message',
        payload: { sessionId: 'session-1', content: '2 years', messageId: 'message-7' },
        timestamp: NOW,
      }),
    );

    expect(targets).toEqual([{ kind: 'message', messageId: 'message-7' }]);
  });

  it('names the fact and the message that taught it from a preference_update', () => {
    const targets = glowTargetsForEvent(
      inbound({
        type: 'preference_update',
        payload: { preference: preference(), isNew: true },
        timestamp: NOW,
      }),
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      kind: 'preference',
      preferenceId: 'pref-1',
      sourceMessageId: 'message-7',
    });
  });

  it('drops the message anchor for a seeded fact, which nobody ever said', () => {
    const targets = glowTargetsForEvent(
      inbound({
        type: 'preference_update',
        payload: {
          preference: preference({ sourceMessageId: DEMO_SEED_SOURCE_MESSAGE_ID }),
          isNew: false,
        },
        timestamp: NOW,
      }),
    );

    // Still a target — the chip is real even when the conversation was not.
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ kind: 'preference', sourceMessageId: undefined });
  });

  it('names the proposal and its service from an action_proposal', () => {
    const targets = glowTargetsForEvent(
      inbound({
        type: 'action_proposal',
        payload: {
          sessionId: 'session-1',
          proposalId: 'proposal-3',
          service: 'ontopo',
          title: 'A table',
          summary: 'Friday, 8pm',
          expiresAt: NOW,
        },
        timestamp: NOW,
      }),
    );

    expect(targets).toEqual([
      { kind: 'proposal', proposalId: 'proposal-3', service: 'ontopo' },
    ]);
  });

  it('has nothing to say about the reply arriving, only about the reply', () => {
    expect(
      glowTargetsForEvent(
        inbound({ type: 'typing_stop', payload: { sessionId: 'session-1' }, timestamp: NOW }),
      ),
    ).toEqual([]);
  });
});

describe('learnToolService and glowTargetsForSpan', () => {
  it('recovers the integration a tool span belongs to from the activity frame', () => {
    const lookup = new Map<string, string>();
    learnToolService(lookup, {
      kind: 'tool_start',
      sessionId: 'session-1',
      id: 'tool-use-1',
      iteration: 1,
      tool: 'check_availability',
      service: 'ontopo',
      inputSummary: 'a table for two',
    });

    expect(glowTargetsForSpan(span(), 'integrations', lookup)).toEqual([
      { kind: 'tool', service: 'ontopo' },
    ]);
  });

  it('ignores a thinking frame, which names no tool', () => {
    const lookup = new Map<string, string>();
    learnToolService(lookup, {
      kind: 'thinking',
      sessionId: 'session-1',
      id: 'thinking:1',
      iteration: 1,
      text: 'weighing it up',
    });

    expect(lookup.size).toBe(0);
  });

  it('says nothing for a tool it has never seen an activity frame for', () => {
    expect(glowTargetsForSpan(span(), 'integrations', new Map())).toEqual([]);
  });

  it("says nothing for a span that is not an outbound call — the reply's own row is", () => {
    const lookup = new Map([['check_availability', 'ontopo']]);

    expect(glowTargetsForSpan(span({ operation: 'Converse' }), 'bedrock', lookup)).toEqual([]);
    expect(glowTargetsForSpan(span(), 'dynamodb', lookup)).toEqual([]);
  });

  it("recognises engine B's outbound hops as the same beat as engine A's integrations", () => {
    const lookup = new Map([['check_availability', 'ontopo']]);

    // Both of engine B's nodes on the way out — the Gateway and the tool Lambda
    // that serves it. `SPAN_ACTION` captions both "asks the outside world", so a
    // row from either has to be able to say who it called.
    for (const node of ['ac-gateway', 'ac-lambda-tools']) {
      expect(glowTargetsForSpan(span(), node, lookup)).toEqual([
        { kind: 'tool', service: 'ontopo' },
      ]);
    }
  });

  it("does not treat engine B's profile Lambda as an outbound call", () => {
    // It is captioned "learns something new" — a write to her record, not a call
    // out to a partner, so there is no integration tile to glow.
    const lookup = new Map([['check_availability', 'ontopo']]);

    expect(glowTargetsForSpan(span(), 'ac-lambda-profile', lookup)).toEqual([]);
  });
});

describe('glowSelectors', () => {
  it('finds a message by the attribute the bubble carries', () => {
    expect(glowSelectors({ kind: 'message', messageId: 'message-9' })).toEqual([
      '[data-message-id="message-9"]',
    ]);
  });

  it('finds a fact in both places it appears — the badge and the rail chip', () => {
    const selectors = glowSelectors({
      kind: 'preference',
      preferenceId: 'pref-1',
      sourceMessageId: 'message-7',
      fieldId: 'food_favourite',
    });

    expect(selectors).toEqual(['[data-noted-for="message-7"]', '[data-field-id="food_favourite"]']);
  });

  it('omits the anchors a target does not have rather than matching everything', () => {
    expect(glowSelectors({ kind: 'preference', preferenceId: 'pref-1' })).toEqual([]);
  });

  it('finds a tool call at the strip tile and at its own row in the trail', () => {
    expect(glowSelectors({ kind: 'tool', service: 'ontopo' })).toEqual([
      '[data-testid="integration-status-ontopo"]',
      '[data-service="ontopo"]',
    ]);
  });

  it('refuses an id that would break the selector rather than throwing inside it', () => {
    expect(glowSelectors({ kind: 'message', messageId: 'oops"] , *' })).toEqual([]);
  });
});

describe('glowTargetKey and dedupeGlowTargets', () => {
  it('keys a target by what it points at, not by which row produced it', () => {
    expect(glowTargetKey({ kind: 'preference', preferenceId: 'pref-1' })).toBe('preference:pref-1');
  });

  it('collapses the repeats a group of consecutive beats produces, keeping order', () => {
    const targets: GlowTarget[] = [
      { kind: 'message', messageId: 'm1' },
      { kind: 'preference', preferenceId: 'p1' },
      { kind: 'message', messageId: 'm1' },
    ];

    expect(dedupeGlowTargets(targets)).toEqual([
      { kind: 'message', messageId: 'm1' },
      { kind: 'preference', preferenceId: 'p1' },
    ]);
  });
});
