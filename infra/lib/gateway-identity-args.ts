/**
 * The two arguments every Gateway tool takes, wherever it is hosted.
 *
 * Lifted out of `agentcore-stack.ts` so the profile target and the integration
 * target cannot disagree about identity. They are two Lambdas behind one MCP
 * endpoint; if one asked for `userId` and the other for `user_id`, the agent
 * would call both the same way and one would fail on every invocation — a
 * difference in spelling presenting as a broken integration.
 *
 * Imported by `scripts/generate-tool-schemas.mts` as well as the stack, which is
 * the actual reason this is a module rather than a constant in one file: the
 * generator emits the integration target's schemas and the stack writes the
 * profile target's by hand, so this is the only shared surface between them.
 *
 * ## Why identity is an argument and not a JWT claim
 *
 * The Gateway's token belongs to a Cognito *machine* client and carries no
 * end-user identity, so there is nothing to read a user id from — the caller has
 * to name it. What makes that safe is the trust boundary rather than the schema:
 * nothing browser-reachable can call the Gateway. The proxy authenticates the
 * user, derives the storage id itself, and invokes the Runtime with SigV4; only
 * the Runtime holds a Gateway token. The model, meanwhile, never chooses these
 * values — `agent.py` injects them into every tool call from the invocation
 * payload and strips them from the schema it shows the model, so "ask for a
 * different user's profile" is not a sentence that can have an effect.
 */
export const GATEWAY_IDENTITY_ARGS = {
  user_id: {
    type: 'string',
    description: 'Storage id of the signed-in user, supplied by the proxy service',
  },
  session_id: { type: 'string', description: 'The conversation session id' },
} as const;

/** The identity args are always required, on every tool, on both targets. */
export const GATEWAY_IDENTITY_REQUIRED = ['user_id', 'session_id'] as const;
