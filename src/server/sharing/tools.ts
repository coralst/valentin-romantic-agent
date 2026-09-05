/**
 * Letting Valentin hand out a link to the conversation he is in.
 *
 * ## Why this exists
 *
 * All the machinery already did. `share-token.ts` mints signed tokens,
 * `shared-conversation.ts` serves the guest view, `POST /api/session/:id/share`
 * answers with a URL and the Share control in the composer calls it. What was
 * missing was any way for the *model* to reach it, so asked "email me a link to
 * this chat" Valentin answered, accurately and uselessly, "I can't generate a
 * link to this chat itself". Reported from the live app on 2026-09-03.
 *
 * A tool is the fix rather than a line of prompt, because the link cannot be
 * written by a language model: it carries an HMAC over the session id and its
 * owner. A model asked to produce one invents a plausible token, and the guest
 * gets "this link has expired or is not valid" — a worse failure than the honest
 * refusal, because it looks like it worked.
 *
 * ## Why it needs no confirmation
 *
 * `requiresConfirmation` marks tools that write, spend or send. This one does
 * none of those: it returns a string to the person who asked for it, in their own
 * conversation, and hands nothing to anybody else. The share *control* carries a
 * warning about who can then read the transcript, and that warning belongs there
 * — at the point a human decides to paste it.
 *
 * Sending it onward is a different act and stays gated as it already was: the
 * model puts this URL in the body of `propose_email`, which raises a proposal
 * card naming the recipient, and nothing leaves until the user accepts it. So the
 * flow the user asked for — mail me a shareable link — is one read-only tool plus
 * one confirmed send, and no new outbound path.
 *
 * ## What it does not do
 *
 * It does not decide who to send to, does not read the transcript, and cannot
 * mint a link for any conversation other than the one it is called in:
 * `sessionId` comes from {@link ToolContext} and is not an input the model can
 * set. That is deliberate — a tool argument for "which conversation" would let a
 * confused model ask for a link to a session id it saw quoted in text.
 */

import type { AgentTool, ToolContext, ToolResult } from '../integrations/tool-registry';
import { SHARE_TTL_DAYS } from '../../shared/constants/share-link';
import { mintShareToken } from './share-token';
import { CONVERSATION_LINK_PLACEHOLDER } from './link-placeholder';

export const createConversationLinkTool: AgentTool = {
  name: 'create_conversation_link',
  description:
    'Create a shareable read-only link to THIS conversation, so someone who is ' +
    'not signed in can read it, or so the user can return to it later from ' +
    'another device. Takes no arguments — it always links to the conversation ' +
    'you are in. Returns an absolute URL that expires. Call this whenever the ' +
    'user asks for a link to the chat, asks you to send or email them a link, ' +
    'or asks how to show this conversation to somebody. Never write such a URL ' +
    'yourself: the link is signed and one you invent will not open. To email it, ' +
    'call this first and put the URL it returns into the body of propose_email.',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
  service: 'sharing',
  requiresConfirmation: false,

  async execute(_input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.userId) {
      // The anonymous/no-owner deployment, the same state `shareSession` answers
      // 503 for. A token needs an owner to name, so say so in prose the model can
      // pass on rather than minting one over an empty string.
      return {
        ok: false,
        summary:
          'Sharing is not available on this deployment, so there is no link to give. ' +
          'Tell the user plainly rather than offering one.',
      };
    }

    const { expiresAt } = mintShareToken(ctx.userId, ctx.sessionId);

    return {
      ok: true,
      // Deliberately NOT the URL. The link is ~250 characters of signed base64url
      // and asking a model to reproduce it exactly is a transcription task it
      // fails often enough to matter — one wrong character and the guest is told
      // the link has expired. So the summary hands back a placeholder the model
      // can retype perfectly, and the server substitutes the real URL on the way
      // out. See `sharing/link-placeholder.ts`.
      summary:
        `The link is ready and is good for ${SHARE_TTL_DAYS} days (until ${expiresAt}).\n\n` +
        `Write ${CONVERSATION_LINK_PLACEHOLDER} wherever the link should appear — in ` +
        'your reply to the user, or in the body of propose_email if they asked you ' +
        'to send it. Write that placeholder exactly and nothing else: never invent ' +
        'or copy a URL of your own, because the real link is signed and is filled ' +
        'in for you. Whoever opens it can read this transcript but nothing from her ' +
        'file: no preferences, dates, people or tasks. Mention that, and that it ' +
        'expires.',
      data: { link: CONVERSATION_LINK_PLACEHOLDER, expiresAt },
    };
  },
};

/** Registered as one array, the shape `buildToolRegistry` expects of every service. */
export const sharingTools: AgentTool[] = [createConversationLinkTool];
