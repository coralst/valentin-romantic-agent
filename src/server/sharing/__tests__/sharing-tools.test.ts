import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createConversationLinkTool } from '../tools';
import { verifyShareToken } from '../share-token';
import { buildToolRegistry } from '../../integrations';
import { SHARE_PARAM } from '../../../shared/constants/share-link';
import { config } from '../../config';

/**
 * The bug this file exists for: asked to email a link to the conversation, Valentin
 * said "I can't generate a link to this chat itself" — truthfully, because no tool
 * could. So the load-bearing assertions here are that the tool is *registered* and
 * that what it returns actually verifies. A link the model composes itself is the
 * failure mode being defended against, and it fails at `verifyShareToken`.
 */

const originalSecret = config.shareTokenSecret;
const originalOrigin = config.publicOrigin;

beforeAll(() => {
  config.shareTokenSecret = 'test-share-secret';
  config.publicOrigin = 'https://valentin.example';
});

afterAll(() => {
  config.shareTokenSecret = originalSecret;
  config.publicOrigin = originalOrigin;
});

/** Pull the token back out of the URL the way the client's guest boot does. */
function tokenFrom(url: string): string {
  return new URL(url).searchParams.get(SHARE_PARAM) ?? '';
}

describe('create_conversation_link', () => {
  it('is registered, so the model can stop saying it cannot make one', () => {
    expect(buildToolRegistry().has('create_conversation_link')).toBe(true);
  });

  it('needs no confirmation — it hands the asker a string and sends nothing', () => {
    expect(createConversationLinkTool.requiresConfirmation).toBe(false);
  });

  it('mints a link that really verifies, for this session and this user', async () => {
    const result = await createConversationLinkTool.execute(
      {},
      { sessionId: 'sess-1', userId: 'user-1' },
    );

    expect(result.ok).toBe(true);
    const url = (result.data as { url: string }).url;
    expect(url.startsWith('https://valentin.example/?')).toBe(true);

    // The whole point: a *verifying* token, which is the one thing a language
    // model could not have produced.
    expect(verifyShareToken(tokenFrom(url))).toMatchObject({
      sessionId: 'sess-1',
      userId: 'user-1',
    });
  });

  it('puts the URL in the summary, the only channel the model reads', async () => {
    const result = await createConversationLinkTool.execute(
      {},
      { sessionId: 'sess-2', userId: 'user-1' },
    );
    const url = (result.data as { url: string }).url;
    expect(result.summary).toContain(url);
  });

  it('takes no session argument, so it cannot be aimed at another conversation', () => {
    const schema = createConversationLinkTool.input_schema as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties)).toEqual([]);
  });

  it('refuses rather than minting a link owned by nobody', async () => {
    const result = await createConversationLinkTool.execute(
      {},
      { sessionId: 'sess-3', userId: '' },
    );
    expect(result.ok).toBe(false);
    expect(result.data).toBeUndefined();
  });
});
