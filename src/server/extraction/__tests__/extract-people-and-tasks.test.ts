import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PreferenceExtractor, matchPerson } from '../preference-extractor';
import { InMemoryStoreFactory } from '../../persistence/in-memory-store';
import type { StorageInterface } from '../../persistence/storage-interface';
import type { BedrockClient } from '../../agent/bedrock-client';
import type { ChatMessage } from '../../../shared/interfaces/message';
import type { Person } from '../../../shared/interfaces/person';

/**
 * The extraction half of "her family is real data".
 *
 * A real store rather than a mock one, because most of what these assert is what
 * the *second* mention of someone does to what the first one wrote — and a mock
 * whose `getPeopleBySession` always answers `[]` would pass every duplicate test
 * while production grew a second Nadia on every turn.
 */

function mockBedrock(input: Record<string, unknown>): BedrockClient {
  return {
    generateResponse: vi.fn(),
    extractWithTool: vi.fn().mockResolvedValue({
      toolName: 'extract_preferences',
      input: { preferences: [], ...input },
    }),
  };
}

function makeMessage(sessionId: string): ChatMessage {
  return {
    id: 'msg-1',
    sessionId,
    sender: 'user',
    content: 'Her sister Nadia turns 30 in March',
    timestamp: new Date().toISOString(),
  };
}

describe('learning her people from a conversation', () => {
  let store: StorageInterface;
  let sessionId: string;
  let onPerson: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    store = new InMemoryStoreFactory().forUser('user-under-test');
    sessionId = await store.createSession();
    onPerson = vi.fn();
  });

  /** Run one extraction turn with the given tool output. */
  async function turn(input: Record<string, unknown>): Promise<void> {
    const extractor = new PreferenceExtractor(mockBedrock(input), store, {
      onPerson,
    });
    await extractor.extract(makeMessage(sessionId), []);
  }

  it('writes a person the turn named', async () => {
    await turn({
      people: [
        {
          name: 'Nadia',
          relationship: 'Her sister',
          generation: 'peer',
          birthday: '1996-03-22',
        },
      ],
    });

    const [person] = await store.getPeopleBySession(sessionId);
    expect(person).toMatchObject({
      name: 'Nadia',
      relationship: 'Her sister',
      generation: 'peer',
      birthday: '1996-03-22',
      // Not 'manual', even though a person is normally typed into a form: this
      // one came out of something he said.
      source: 'discovered',
    });
  });

  it('writes a relative nobody named as a gap, not as nothing', async () => {
    // The state the whole nullable-name design exists for.
    await turn({
      people: [{ relationship: 'Her brother', generation: 'peer' }],
    });

    const [person] = await store.getPeopleBySession(sessionId);
    expect(person.name).toBeNull();
    expect(person.relationship).toBe('Her brother');
  });

  it('drops an entry with no relationship, since a name alone is a word', async () => {
    await turn({ people: [{ name: 'Tom', generation: 'peer' }] });

    expect(await store.getPeopleBySession(sessionId)).toEqual([]);
    expect(onPerson).not.toHaveBeenCalled();
  });

  it('updates the same person when the next turn mentions her again', async () => {
    await turn({
      people: [{ name: 'Nadia', relationship: 'Her sister', generation: 'peer' }],
    });
    await turn({
      people: [
        {
          name: 'Nadia',
          relationship: 'Her older sister',
          generation: 'peer',
          note: 'Lives in Haifa',
        },
      ],
    });

    const people = await store.getPeopleBySession(sessionId);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({
      relationship: 'Her older sister',
      note: 'Lives in Haifa',
    });
  });

  it('fills a gap in place when the name finally arrives', async () => {
    // The reason `matchPerson` looks at relationship at all. Two cards where
    // there is one brother is the failure this prevents.
    await turn({ people: [{ relationship: 'Her brother', generation: 'peer' }] });
    await turn({
      people: [{ name: 'Tom', relationship: 'Her brother', generation: 'peer' }],
    });

    const people = await store.getPeopleBySession(sessionId);
    expect(people).toHaveLength(1);
    expect(people[0].name).toBe('Tom');
  });

  it('keeps a name it already had when a later turn omits it', async () => {
    await turn({
      people: [{ name: 'Nadia', relationship: 'Her sister', generation: 'peer' }],
    });
    await turn({ people: [{ relationship: 'Her sister', generation: 'peer' }] });

    const people = await store.getPeopleBySession(sessionId);
    expect(people).toHaveLength(1);
    // "Her sister said..." is not an instruction to forget she is Nadia.
    expect(people[0].name).toBe('Nadia');
  });

  it('keeps two sisters apart', async () => {
    await turn({
      people: [
        { name: 'Nadia', relationship: 'Her sister', generation: 'peer' },
        { name: 'Talia', relationship: 'Her sister', generation: 'peer' },
      ],
    });

    const people = await store.getPeopleBySession(sessionId);
    expect(people.map((person) => person.name).sort()).toEqual(['Nadia', 'Talia']);
  });

  it('leaves the tree alone when "her sister" could be either of two', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await turn({
      people: [
        { name: 'Nadia', relationship: 'Her sister', generation: 'peer' },
        { name: 'Talia', relationship: 'Her sister', generation: 'peer' },
      ],
    });

    await turn({ people: [{ relationship: 'Her sister', generation: 'peer' }] });

    const people = await store.getPeopleBySession(sessionId);
    // Two, not three: no "Sister?" gap beside the two sisters who fill it.
    expect(people).toHaveLength(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('files an unknown rung on her parents’ row rather than losing the person', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await turn({
      people: [{ name: 'Miriam', relationship: 'Her great-aunt', generation: 'ancestor' }],
    });

    const [person] = await store.getPeopleBySession(sessionId);
    expect(person.generation).toBe('elder');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('refuses a birthday that is not a plain date, rather than guessing one', async () => {
    await turn({
      people: [
        { name: 'Ruth', relationship: 'Her mother', generation: 'elder', birthday: 'March' },
      ],
    });

    const [person] = await store.getPeopleBySession(sessionId);
    expect(person.birthday).toBeNull();
  });

  it('tells the socket about a new person, and marks a restatement as not new', async () => {
    await turn({
      people: [{ name: 'Nadia', relationship: 'Her sister', generation: 'peer' }],
    });
    await turn({
      people: [{ name: 'Nadia', relationship: 'Her sister', generation: 'peer' }],
    });

    expect(onPerson).toHaveBeenNthCalledWith(
      1,
      sessionId,
      expect.objectContaining({ name: 'Nadia' }),
      true,
    );
    expect(onPerson).toHaveBeenNthCalledWith(2, sessionId, expect.anything(), false);
  });

  it('does not count a relative as a profile field', async () => {
    await turn({
      people: [{ name: 'Nadia', relationship: 'Her sister', generation: 'peer' }],
    });

    // The brief reads `preferenceCount` as field coverage. A sister is not one of
    // the twenty-one, so "21 of 21" must not become "22 of 21".
    const session = await store.getSession(sessionId);
    expect(session?.preferenceCount ?? 0).toBe(0);
  });

  it('carries on with the second person when the first one fails to save', async () => {
    const broken = new InMemoryStoreFactory().forUser('user-under-test');
    const brokenSession = await broken.createSession();
    const savePerson = vi
      .spyOn(broken, 'savePerson')
      .mockRejectedValueOnce(new Error('write failed'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const extractor = new PreferenceExtractor(
      mockBedrock({
        people: [
          { name: 'Ruth', relationship: 'Her mother', generation: 'elder' },
          { name: 'Daniel', relationship: 'Her father', generation: 'elder' },
        ],
      }),
      broken,
      null,
    );
    await extractor.extract(makeMessage(brokenSession), []);

    expect(savePerson).toHaveBeenCalledTimes(2);
    const people = await broken.getPeopleBySession(brokenSession);
    expect(people.map((person) => person.name)).toEqual(['Daniel']);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('learning what he has to do', () => {
  let store: StorageInterface;
  let sessionId: string;
  let onTask: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    store = new InMemoryStoreFactory().forUser('user-under-test');
    sessionId = await store.createSession();
    onTask = vi.fn();
  });

  async function turn(input: Record<string, unknown>): Promise<void> {
    const extractor = new PreferenceExtractor(mockBedrock(input), store, { onTask });
    await extractor.extract(makeMessage(sessionId), []);
  }

  it('writes a task he committed to', async () => {
    await turn({
      tasks: [
        {
          title: 'Book the Italian place for the 18th',
          due: '2026-09-11',
          note: 'She would rather choose',
        },
      ],
    });

    const [task] = await store.getTasksBySession(sessionId);
    expect(task).toMatchObject({
      title: 'Book the Italian place for the 18th',
      due: '2026-09-11',
      done: false,
      source: 'discovered',
    });
    expect(onTask).toHaveBeenCalledWith(sessionId, expect.anything(), true);
  });

  it('leaves a task undated rather than inventing a deadline', async () => {
    await turn({ tasks: [{ title: 'Order the glaze set', due: 'sometime soon' }] });

    const [task] = await store.getTasksBySession(sessionId);
    expect(task.due).toBeNull();
  });

  it('drops an entry with no title', async () => {
    await turn({ tasks: [{ note: 'no idea what this is' }] });

    expect(await store.getTasksBySession(sessionId)).toEqual([]);
  });

  it('updates the same row when he says it again', async () => {
    await turn({ tasks: [{ title: 'Book the table' }] });
    await turn({ tasks: [{ title: 'book the  table', due: '2026-09-11' }] });

    const tasks = await store.getTasksBySession(sessionId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].due).toBe('2026-09-11');
  });

  it('never un-ticks something he has already done', async () => {
    // The one piece of state on this board only he can write. A model deciding a
    // task is open again because he mentioned it is the worst thing this could do.
    await turn({ tasks: [{ title: 'Book the table' }] });
    const [open] = await store.getTasksBySession(sessionId);
    await store.saveTask(sessionId, { ...open, done: true });

    await turn({ tasks: [{ title: 'Book the table', note: 'For eight o’clock' }] });

    const [task] = await store.getTasksBySession(sessionId);
    expect(task.done).toBe(true);
    expect(task.note).toBe('For eight o’clock');
  });

  it('keeps the original createdAt when a later turn restates it', async () => {
    await turn({ tasks: [{ title: 'Book the table' }] });
    const [first] = await store.getTasksBySession(sessionId);

    await turn({ tasks: [{ title: 'Book the table', due: '2026-09-11' }] });

    const [task] = await store.getTasksBySession(sessionId);
    expect(task.createdAt).toBe(first.createdAt);
  });

  it('does nothing at all on a turn with neither people nor tasks', async () => {
    await turn({});

    expect(await store.getTasksBySession(sessionId)).toEqual([]);
    expect(onTask).not.toHaveBeenCalled();
  });

  it('survives a tool response that predates these arrays', async () => {
    // Old stubs and cached responses return `{ preferences: [...] }` only. That
    // has to read as "nothing to record", not as a crash mid-turn.
    const extractor = new PreferenceExtractor(
      mockBedrock({ people: undefined, tasks: 'not an array' as never }),
      store,
      { onTask },
    );

    await expect(extractor.extract(makeMessage(sessionId), [])).resolves.toBeUndefined();
    expect(await store.getTasksBySession(sessionId)).toEqual([]);
  });
});

describe('matchPerson', () => {
  const person = (over: Partial<Person>): Person => ({
    id: 'p1',
    name: 'Nadia',
    relationship: 'Her sister',
    generation: 'peer',
    source: 'manual',
    updatedAt: new Date().toISOString(),
    ...over,
  });

  it('matches on the name, whatever the relationship says', () => {
    const stored = [person({ relationship: 'Her sister' })];

    expect(
      matchPerson(stored, { name: 'nadia', relationship: 'Her older sister' }),
    ).toEqual({ kind: 'update', person: stored[0] });
  });

  it('matches a named candidate to an unnamed person on the same rung', () => {
    const stored = [person({ id: 'gap', name: null, relationship: 'Her brother' })];

    expect(
      matchPerson(stored, { name: 'Tom', relationship: 'her  brother' }),
    ).toEqual({ kind: 'update', person: stored[0] });
  });

  it('does not merge two people who share a relationship', () => {
    const stored = [person({ id: 'nadia' })];

    expect(matchPerson(stored, { name: 'Talia', relationship: 'Her sister' })).toEqual({
      kind: 'insert',
    });
  });

  it('matches an unnamed candidate to the one person it can only be', () => {
    const stored = [person({ id: 'nadia' })];

    // "Her sister is coming Tuesday" with one known sister is about that sister —
    // a second unnamed "Sister?" card beside her would be a gap the tree already
    // has filled.
    expect(matchPerson(stored, { name: null, relationship: 'Her sister' })).toEqual({
      kind: 'update',
      person: stored[0],
    });
  });

  it('gives up when an unnamed mention could be either of two sisters', () => {
    const stored = [person({ id: 'nadia' }), person({ id: 'talia', name: 'Talia' })];

    expect(matchPerson(stored, { name: null, relationship: 'Her sister' })).toEqual({
      kind: 'ambiguous',
    });
  });

  it('inserts when nobody holds that relationship yet', () => {
    expect(matchPerson([], { name: null, relationship: 'Her brother' })).toEqual({
      kind: 'insert',
    });
  });

  it('finds nothing in an empty tree', () => {
    expect(matchPerson([], { name: 'Ruth', relationship: 'Her mother' })).toEqual({
      kind: 'insert',
    });
  });
});
