/**
 * The agent's own lifecycle: registering Valentin at startup and opening a
 * runtime session per conversation.
 *
 * Named for what it does rather than for the AWS product it might one day sit
 * on. This was `AgentCoreAdapter`, which claimed Bedrock AgentCore was in the
 * request path when nothing here calls it — and the integration layer is
 * deliberately built without it, so the name was going to keep being wrong.
 */
export interface ValentinRuntime {
  /** Register the Valentin agent on startup. Returns its agent id. */
  registerAgent(): Promise<string>;

  /** Open a runtime session for a user session. Returns the runtime session id. */
  createSession(sessionId: string): Promise<string>;
}

/**
 * The local runtime: an identity and a session id, no network.
 *
 * Not a placeholder for something missing. Valentin's session state lives in
 * DynamoDB and its model calls go straight to Bedrock Converse, so there is
 * nothing for a managed runtime to do here yet. Moving onto one is a deliberate
 * future step, not a gap.
 */
export class LocalValentinRuntime implements ValentinRuntime {
  async registerAgent(): Promise<string> {
    return 'valentin-001';
  }

  async createSession(sessionId: string): Promise<string> {
    // The runtime session maps 1:1 onto the conversation.
    return `valentin-session-${sessionId}`;
  }
}
