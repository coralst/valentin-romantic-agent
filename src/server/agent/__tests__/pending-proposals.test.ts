import { describe, it, expect } from 'vitest';
import { PendingProposalStore, ProposalUnavailableError } from '../pending-proposals';
import type { ActionProposal, AgentTool } from '../../integrations/tool-registry';

/**
 * The gate both engines pass through before anything is booked.
 *
 * This class was extracted from `AgentOrchestrator.confirmAction` so engine B
 * could reuse the checks rather than reimplement them — and the reason that
 * mattered is exactly what these tests pin: the refusals are *identical* whichever
 * engine is serving, because there is only one copy of them left. Engine A's own
 * tests still exercise it end to end through the orchestrator; these exercise the
 * three refusals directly, where the sentence a user reads is decided.
 */

function proposal(over: Partial<ActionProposal> = {}): ActionProposal {
  return {
    id: 'prop-1',
    sessionId: 'sess-1',
    service: 'ontopo',
    title: 'A table at Port Said',
    summary: 'Saturday, 21:00, two people',
    // Comfortably ahead, so a test that means "not expired" cannot fail on a slow
    // machine the way a 1 ms margin would.
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    payload: { areaId: 'secret-area-id' },
    ...over,
  };
}

const tool = { name: 'propose_reservation' } as unknown as AgentTool;

describe('PendingProposalStore', () => {
  it('hands back what will carry the proposal out — engine A a tool, engine B a name', () => {
    const store = new PendingProposalStore();
    const engineA = proposal();
    const engineB = proposal({ id: 'prop-2' });

    store.remember(engineA, { tool });
    store.remember(engineB, { confirmTool: 'confirm_reservation' });

    expect(store.take('sess-1', 'prop-1').tool).toBe(tool);
    expect(store.take('sess-1', 'prop-2').confirmTool).toBe('confirm_reservation');
  });

  it('refuses an id it never saw', () => {
    const store = new PendingProposalStore();

    expect(() => store.take('sess-1', 'nope')).toThrow(ProposalUnavailableError);
    expect(() => store.take('sess-1', 'nope')).toThrow(/lost track of that one/);
  });

  it('refuses an id belonging to another conversation, in the same words as an unknown one', () => {
    // Deliberately indistinguishable: telling a caller "that id exists but is not
    // yours" confirms the id, and a guessed id would then be worth guessing again.
    const store = new PendingProposalStore();
    store.remember(proposal({ sessionId: 'someone-else' }), { tool });

    let unknown: unknown;
    let crossSession: unknown;
    try {
      store.take('sess-1', 'absent');
    } catch (err) {
      unknown = err;
    }
    try {
      store.take('sess-1', 'prop-1');
    } catch (err) {
      crossSession = err;
    }

    expect((crossSession as ProposalUnavailableError).reason).toBe('unknown');
    expect((crossSession as Error).message).toBe((unknown as Error).message);
  });

  it('leaves another session’s proposal in the store rather than consuming it', () => {
    // The rejected take must not be a covert delete: the rightful owner's Confirm
    // press has to still work after someone else's stale tab has tried it.
    const store = new PendingProposalStore();
    store.remember(proposal({ sessionId: 'hers' }), { tool });

    expect(() => store.take('mine', 'prop-1')).toThrow();
    expect(store.take('hers', 'prop-1').proposal.id).toBe('prop-1');
  });

  it('refuses an expired hold, naming the service so the apology is specific', () => {
    const store = new PendingProposalStore();
    store.remember(proposal({ expiresAt: new Date(Date.now() - 1000).toISOString() }), { tool });

    try {
      store.take('sess-1', 'prop-1');
      expect.unreachable('an expired hold must not be claimable');
    } catch (err) {
      const unavailable = err as ProposalUnavailableError;
      expect(unavailable.reason).toBe('expired');
      expect(unavailable.service).toBe('ontopo');
      expect(unavailable.message).toContain('ontopo');
    }
  });

  it('is one-shot: a second Confirm press cannot book a second table', () => {
    const store = new PendingProposalStore();
    store.remember(proposal(), { tool });

    expect(store.take('sess-1', 'prop-1').proposal.id).toBe('prop-1');
    expect(() => store.take('sess-1', 'prop-1')).toThrow(/lost track/);
    expect(store.size).toBe(0);
  });

  it('drops an expired proposal on the way out, so it cannot be retried', () => {
    // Expiry is checked *after* the delete on purpose. A retry of an expired hold
    // would fail identically forever; leaving it in the map would only keep a dead
    // row alive for the life of the connection.
    const store = new PendingProposalStore();
    store.remember(proposal({ expiresAt: new Date(Date.now() - 1000).toISOString() }), { tool });

    expect(() => store.take('sess-1', 'prop-1')).toThrow(/expired/);
    expect(store.size).toBe(0);
  });

  it('accepts a proposal with no executor at all', () => {
    // The default matters: `remember(proposal)` with no second argument is what a
    // caller writes before it knows how the confirm will travel, and it must not
    // become `{ tool: undefined }` in a way that reads as engine A.
    const store = new PendingProposalStore();
    store.remember(proposal());

    const entry = store.take('sess-1', 'prop-1');
    expect(entry.tool).toBeUndefined();
    expect(entry.confirmTool).toBeUndefined();
  });
});
