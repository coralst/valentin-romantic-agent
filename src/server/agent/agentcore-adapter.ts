/** Abstract interface for AWS AgentCore lifecycle management */
export interface AgentCoreAdapter {
  /** Register the Valentin agent with AgentCore on startup */
  registerAgent(): Promise<string>;

  /** Create an AgentCore session for a user session */
  createSession(sessionId: string): Promise<string>;
}

// TODO(yellow): integrate real AWS AgentCore SDK — replace this stub with actual SDK calls
/** Stub AgentCore adapter for local development */
export class StubAgentCoreAdapter implements AgentCoreAdapter {
  async registerAgent(): Promise<string> {
    // Stub returns a placeholder agent ID
    return 'stub-agent-valentin-001';
  }

  async createSession(sessionId: string): Promise<string> {
    // Stub maps the session 1:1
    return `agentcore-session-${sessionId}`;
  }
}
