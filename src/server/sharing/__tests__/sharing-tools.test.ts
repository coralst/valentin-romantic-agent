import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createConversationLinkTool } from '../tools';
import { mintShareToken, verifyShareToken } from '../share-token';
import { buildToolRegistry } from '../../integrations';
import { SHARE_PARAM, shareLink } from '../../../shared/constants/share-link';
import { config } from '../../config';
import {
  CONVERSATION_LINK_PLACEHOLDER,
  expandConversationLinkText,
} from '../link-placeholder';

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

  /**
   * Hands back a placeholder rather than the URL, and the substituted URL really
   * verifies. Both halves matter: the model must not be given 250 characters to
   * retype (it gets one wrong, and the guest is told the link expired), and the
   * thing that replaces the placeholder must still be a token this server signed.
   */
  it('gives the model a placeholder, never a token to transcribe', async () => {
    const result = await createConversationLinkTool.execute(
      {},
      { sessionId: 'sess-1', userId: 'user-1' },
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toContain(CONVERSATION_LINK_PLACEHOLDER);
    // No URL anywhere the model can read, so there is nothing to mis-copy.
    expect(result.summary).not.toContain('https://valentin.example');
    expect(result.data).toMatchObject({ link: CONVERSATION_LINK_PLACEHOLDER });
  });

  it('expands that placeholder into a token that really verifies', async () => {
    const result = await createConversationLinkTool.execute(
      {},
      { sessionId: 'sess-2', userId: 'user-1' },
    );

    // Exactly what the tool loop does to the model's reply and to a tool's input.
    const prose = expandConversationLinkText(
      `Here you go: ${result.summary.includes(CONVERSATION_LINK_PLACEHOLDER) ? CONVERSATION_LINK_PLACEHOLDER : ''}`,
      () => shareLink(config.publicOrigin, mintShareToken('user-1', 'sess-2').token),
    );

    const url = prose.slice(prose.indexOf('https://'));
    expect(url.startsWith('https://valentin.example/?')).toBe(true);
    expect(verifyShareToken(tokenFrom(url))).toMatchObject({
      sessionId: 'sess-2',
      userId: 'user-1',
    });
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
