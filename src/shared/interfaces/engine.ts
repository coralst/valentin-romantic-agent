/**
 * Which of the two backends is in play.
 *
 * Lives in `@shared` because three layers name it and they must agree: the server
 * resolves it (`server/agent/engine.ts`), the client selects it
 * (`client/utils/aws-architecture.ts`), and a `TurnMetrics` frame crosses between
 * them stamped with it. The union was previously declared twice, in the server's
 * `AgentEngine` and the client's `ArchitectureEngine`; both now alias this, so a
 * third engine cannot be added to one side alone.
 */
export type EngineId = 'valentin' | 'agentcore';
