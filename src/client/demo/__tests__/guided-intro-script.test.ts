import { describe, it, expect } from 'vitest';
import {
  BEAT_TIMESTAMP_SPAN_MS,
  GUIDED_INTRO_BEATS,
  buildBeatEvents,
} from '../guided-intro-script';
import { resolveField } from '../../utils/preference-field-mapper';
import { DEMO_PROFILE_PREFERENCES } from '../../../server/fixtures/demo-profile';
import type { AwsSpan } from '../../../shared/interfaces/ws-events';

const STARTED_AT = Date.parse('2026-02-14T18:00:00.000Z');

function build(beatIndex: number) {
  return buildBeatEvents(GUIDED_INTRO_BEATS[beatIndex], {
    sessionId: 's-intro',
    beatIndex,
    startedAtMs: STARTED_AT,
  });
}

describe('the guided intro script', () => {
  it('is three beats', () => {
    // Three is the agreed length: enough to show a second fact landing, short
    // enough that nobody in the room starts checking their phone.
    expect(GUIDED_INTRO_BEATS).toHaveLength(3);
  });

  /**
   * The contract that fails silently. A preference reaches a profile field only
   * via `resolveField(category, key)`; an unmatched pair still renders a chip in
   * the transcript but never highlights a field, so the whole point of the intro
   * — watching the profile fill in — quietly stops working with every test green.
   */
  it('every scripted fact resolves to a real profile field', () => {
    for (const beat of GUIDED_INTRO_BEATS) {
      for (const fact of beat.facts) {
        expect(
          resolveField(fact.category, fact.key),
          `${fact.category}/${fact.key} must resolve to a registry field`,
        ).not.toBeNull();
      }
    }
  });

  /**
   * The intro ends by loading the full 18-field profile. If a scripted value
   * disagreed with the seeded one, the audience would watch a field they just
   * saw land get rewritten to something else.
   */
  it('agrees with the seeded demo profile on every field it touches', () => {
    for (const beat of GUIDED_INTRO_BEATS) {
      for (const fact of beat.facts) {
        const seeded = DEMO_PROFILE_PREFERENCES.find(
          (pref) => pref.category === fact.category && pref.key === fact.key,
        );
        expect(seeded, `${fact.category}/${fact.key} is not in the demo fixture`).toBeDefined();
        expect(seeded?.value).toBe(fact.value);
      }
    }
  });

  it('opens with a beat that fills two fields from one sentence', () => {
    expect(GUIDED_INTRO_BEATS[0].facts.length).toBeGreaterThan(1);
  });
});

describe('buildBeatEvents', () => {
  it('gives the visitor turn and the reply as separate, ordered messages', () => {
    const { userMessage, events } = build(0);

    expect(userMessage.sender).toBe('user');
    expect(userMessage.content).toBe(GUIDED_INTRO_BEATS[0].prompt);

    const reply = events.find((e) => e.type === 'agent_message');
    expect(reply).toBeDefined();
    const message = (reply as { payload: { message: { content: string; timestamp: string } } })
      .payload.message;
    expect(message.content).toBe(GUIDED_INTRO_BEATS[0].reply);
    expect(Date.parse(message.timestamp)).toBeGreaterThan(Date.parse(userMessage.timestamp));
  });

  it('brackets the beat with typing_start and typing_stop', () => {
    const { events } = build(1);
    expect(events[0].type).toBe('typing_start');
    expect(events[events.length - 1].type).toBe('typing_stop');
  });

  /**
   * Both `SEND_MESSAGE` and `RECEIVE_MESSAGE` re-sort the transcript by
   * timestamp. Equal or descending stamps would shuffle the conversation.
   */
  it('stamps every event in strictly ascending order', () => {
    const { userMessage, events } = build(2);
    const stamps = [userMessage.timestamp, ...events.map((e) => e.timestamp)].map(Date.parse);

    for (let i = 1; i < stamps.length; i += 1) {
      expect(stamps[i]).toBeGreaterThan(stamps[i - 1]);
    }
  });

  it('keeps later beats after earlier ones on the same clock', () => {
    const first = build(0);
    const last = build(2);
    const endOfFirst = Date.parse(first.events[first.events.length - 1].timestamp);

    expect(Date.parse(last.userMessage.timestamp)).toBeGreaterThan(endOfFirst);
    expect(BEAT_TIMESTAMP_SPAN_MS).toBeGreaterThan(3000);
  });

  /**
   * Ids are derived from the beat index rather than generated, so a presenter
   * stepping backwards and forwards replays the same messages instead of
   * appending duplicates to an append-only reducer.
   */
  it('is deterministic, down to the message ids', () => {
    expect(build(1)).toEqual(build(1));
  });

  it('attributes each extracted fact to the message it came from', () => {
    const { userMessage, events } = build(0);
    const updates = events.filter((e) => e.type === 'preference_update');

    expect(updates).toHaveLength(GUIDED_INTRO_BEATS[0].facts.length);
    for (const update of updates) {
      const { preference, isNew } = (
        update as { payload: { preference: { sourceMessageId: string }; isNew: boolean } }
      ).payload;
      expect(preference.sourceMessageId).toBe(userMessage.id);
      expect(isNew).toBe(true);
    }
  });

  it('drives the architecture drawer with Bedrock and DynamoDB spans', () => {
    const { events } = build(0);
    const spans = events
      .filter((e) => e.type === 'aws_span')
      .map((e) => e.payload as AwsSpan);

    // Two Converse calls — the reply and the extraction — and one PutItem per
    // fact. Without these the drawer stays in demo mode during the fallback and
    // shows a canned animation instead of this conversation.
    expect(spans.filter((s) => s.operation === 'Converse')).toHaveLength(2);
    expect(spans.filter((s) => s.operation === 'PutItem')).toHaveLength(
      GUIDED_INTRO_BEATS[0].facts.length,
    );
    for (const span of spans) {
      expect(span.sessionId).toBe('s-intro');
      expect(span.durationMs).toBeGreaterThan(0);
      expect(span.ok).toBe(true);
    }
  });

  /**
   * Same privacy rule as the server-side bridge: a span's `detail` carries the
   * category, never the value. The scripted path is on the same projector.
   */
  it('never puts a partner value in a span', () => {
    for (let index = 0; index < GUIDED_INTRO_BEATS.length; index += 1) {
      const { events } = build(index);
      const spans = events.filter((e) => e.type === 'aws_span');
      const serialised = JSON.stringify(spans);

      for (const fact of GUIDED_INTRO_BEATS[index].facts) {
        expect(serialised).not.toContain(fact.value);
        expect(serialised).toContain(`PREF#${fact.category}`);
      }
    }
  });

  it('binds every event to the session it was built for', () => {
    const { userMessage, events } = build(1);
    expect(userMessage.sessionId).toBe('s-intro');
    for (const event of events) {
      const payload = event.payload as Record<string, unknown>;
      const sessionId =
        (payload.sessionId as string | undefined) ??
        (payload.message as { sessionId: string } | undefined)?.sessionId ??
        (payload.preference as { sessionId: string } | undefined)?.sessionId;
      expect(sessionId, `${event.type} must be routable to a session`).toBe('s-intro');
    }
  });
});
