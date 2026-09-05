import { describe, it, expect } from 'vitest';
import {
  branchSharedConversation,
  branchTitle,
  messagesAsSharedAt,
} from '../branch-conversation';
import { InMemoryStoreFactory } from '../../persistence/in-memory-store';
import type { ChatMessage } from '../../../shared/interfaces/message';
import type { SessionData } from '../../../shared/interfaces/session';

/**
 * The two properties that make a fork safe to hand a stranger: it stops at the point
 * the link was made, and it cannot write anywhere near the owner. Everything here is
 * one of those two.
 */

const SHARED_AT = Date.parse('2026-03-01T12:00:00.000Z');
const SHARED_AT_SECONDS = Math.floor(SHARED_AT / 1000);

function turn(offsetMs: number, content: string): ChatMessage {
  return {
    id: `m${offsetMs}`,
    sessionId: 'source',
    sender: offsetMs % 2 === 0 ? 'user' : 'agent',
    content,
    timestamp: new Date(SHARED_AT + offsetMs).toISOString(),
  };
}

describe('the turns that existed when the link was made', () => {
  it('keeps everything up to the shared moment and drops what came later', () => {
    const kept = messagesAsSharedAt(
      [turn(-60_000, 'before'), turn(0, 'at'), turn(60_000, 'after')],
      SHARED_AT_SECONDS,
    );

    expect(kept.map((m) => m.content)).toEqual(['before', 'at']);
  });

  it('keeps the turn the sharer was looking at, sub-second though it is', () => {
    // `iat` is whole seconds while a timestamp carries milliseconds, so an exact
    // comparison would drop the very message that prompted the click.
    const kept = messagesAsSharedAt([turn(400, 'the one they shared')], SHARED_AT_SECONDS);
    expect(kept).toHaveLength(1);
  });

  it('orders by time rather than trusting the order it was handed', () => {
    const kept = messagesAsSharedAt(
      [turn(-1_000, 'second'), turn(-5_000, 'first')],
      SHARED_AT_SECONDS,
    );
    expect(kept.map((m) => m.content)).toEqual(['first', 'second']);
  });

  it('keeps a message with an unreadable timestamp rather than dropping it', () => {
    const broken: ChatMessage = { ...turn(0, 'broken'), timestamp: 'not a date' };
    const kept = messagesAsSharedAt([broken, turn(-1_000, 'fine')], SHARED_AT_SECONDS);
    // Sorted to the front, since a lost turn is worse than a misplaced one.
    expect(kept.map((m) => m.content)).toEqual(['broken', 'fine']);
  });
});

describe('a branch heading', () => {
  const base = { id: 's1', createdAt: '', lastActivity: '' } as unknown as SessionData;

  it('names the original and marks the continuation', () => {
    expect(branchTitle({ ...base, title: 'The anniversary' })).toBe(
      'The anniversary (continued)',
    );
  });

  it('falls back to the partner, then to something generic', () => {
    expect(branchTitle({ ...base, partnerName: 'Samantha' })).toContain('Samantha');
    expect(branchTitle(base)).toBe('A conversation with Valentin (continued)');
  });
});

describe('forking a shared conversation', () => {
  async function seed() {
    const factory = new InMemoryStoreFactory();
    const owner = factory.forUser('alice');
    const sourceSessionId = await owner.createSession();
    await owner.updateSessionMeta(sourceSessionId, { title: 'The anniversary' });

    for (const message of [
      turn(-120_000, 'What should I plan?'),
      turn(-60_000, 'Tell me the date'),
    ]) {
      await owner.saveMessage({ ...message, sessionId: sourceSessionId });
    }

    return { factory, owner, sourceSessionId };
  }

  it('copies the transcript into the visitor’s own store, untouched at the source', async () => {
    const { factory, owner, sourceSessionId } = await seed();
    const visitor = factory.forUser('alice#visitor');
    const session = (await owner.getSession(sourceSessionId))!;

    const branch = await branchSharedConversation({
      source: owner,
      target: visitor,
      session,
      sourceSessionId,
      sharedAt: SHARED_AT_SECONDS,
    });

    expect(branch.copied).toBe(2);
    expect(branch.advanced).toBe(false);
    expect(branch.title).toBe('The anniversary (continued)');

    const copied = await visitor.getMessagesBySession(branch.sessionId);
    expect(copied.map((m) => m.content)).toEqual([
      'What should I plan?',
      'Tell me the date',
    ]);
    // The original instants, not the fork's: a week-old conversation must not look
    // like it happened in one afternoon second.
    expect(copied[0].timestamp).toBe(new Date(SHARED_AT - 120_000).toISOString());
    // Fresh ids, so nothing collides if the same link is opened twice.
    expect(copied[0].id).not.toBe('m-120000');

    // The owner still has exactly one session, with exactly its two turns.
    expect(await owner.listSessions()).toHaveLength(1);
    expect(await owner.getMessagesBySession(sourceSessionId)).toHaveLength(2);
    // And the fork is not visible from the owner's partition at all.
    expect(await owner.getSession(branch.sessionId)).toBeNull();
  });

  it('reports that the original moved on, and cuts at the shared point anyway', async () => {
    const { factory, owner, sourceSessionId } = await seed();
    await owner.saveMessage({
      ...turn(600_000, 'Something said after the link was sent'),
      sessionId: sourceSessionId,
    });
    const visitor = factory.forUser('alice#visitor');
    const session = (await owner.getSession(sourceSessionId))!;

    const branch = await branchSharedConversation({
      source: owner,
      target: visitor,
      session,
      sourceSessionId,
      sharedAt: SHARED_AT_SECONDS,
    });

    expect(branch.advanced).toBe(true);
    expect(branch.copied).toBe(2);
    const copied = await visitor.getMessagesBySession(branch.sessionId);
    expect(copied.map((m) => m.content)).not.toContain(
      'Something said after the link was sent',
    );
  });

  it('opens an empty branch rather than failing when nothing preceded the link', async () => {
    const { factory, owner, sourceSessionId } = await seed();
    const visitor = factory.forUser('alice#visitor');
    const session = (await owner.getSession(sourceSessionId))!;

    // A link minted before any of the turns exist — the shape a share of a brand-new
    // conversation takes.
    const branch = await branchSharedConversation({
      source: owner,
      target: visitor,
      session,
      sourceSessionId,
      sharedAt: Math.floor((SHARED_AT - 600_000) / 1000),
    });

    expect(branch.copied).toBe(0);
    expect(branch.advanced).toBe(true);
    // Still a real session, so the visitor lands in a working composer rather than
    // on an error.
    expect(await visitor.getSession(branch.sessionId)).not.toBeNull();
  });
});
