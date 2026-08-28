import { config } from '../config';
import { logger } from '../logging';
import type { AgentTool, IntegrationId, ToolRegistry } from './tool-registry';
import { amadeusTools } from './amadeus/tools';
import { gmailTools, googleCalendarTools } from './google/tools';
import { hebcalTools } from './hebcal/tools';
import { ontopoTools } from './ontopo/tools';
import { whatsappTools } from './whatsapp/tools';

export type { ToolRegistry, AgentTool, ActionProposal, IntegrationId } from './tool-registry';

/**
 * Whether each integration has what it needs to work.
 *
 * Read twice: here, to decide what to register, and by `GET /api/integrations`,
 * so the sidebar can show a service as dark rather than pretending it is ready.
 * That endpoint returns these booleans and nothing else — never a credential,
 * not even a masked one.
 *
 * Hebcal and Ontopo are unconditionally true, and neither has a secret to be
 * missing: Hebcal is a local calculation, and Ontopo's availability and checkout
 * endpoints turn out to need no authentication at all. The site does mint an
 * anonymous JWT, but it is not required — see the note in `ontopo/client.ts`.
 */
export function integrationReadiness(): Record<IntegrationId, boolean> {
  const { integrations } = config;
  const google = Boolean(
    integrations.googleClientId &&
      integrations.googleClientSecret &&
      integrations.googleRefreshToken,
  );

  return {
    hebcal: true,
    ontopo: true,
    amadeus: Boolean(
      integrations.amadeusClientId && integrations.amadeusClientSecret,
    ),
    'google-calendar': google,
    gmail: google,
    whatsapp: Boolean(
      integrations.whatsappPhoneNumberId && integrations.whatsappToken,
    ),
  };
}

/**
 * The tools this process can actually offer the model.
 *
 * Credential-gated per service, and that gating is the honesty of the whole
 * design: an unconfigured integration is absent from the tool list rather than
 * present and failing. The difference the user hears is "I can't book tables
 * yet" versus "I tried to book a table and something broke".
 *
 * Returns an empty registry when nothing is configured, which the orchestrator
 * treats as "no tools at all" and answers with a plain single-shot call —
 * Bedrock rejects a `toolConfig` with an empty tool list, so that branch is
 * required, not an optimisation.
 */
export function buildToolRegistry(): ToolRegistry {
  const ready = integrationReadiness();
  const tools: AgentTool[] = [];

  // Registrations land here as each integration is built. Each one is gated on
  // its own `ready` flag, so a half-configured deployment offers the half that
  // works instead of nothing.
  if (ready.hebcal) tools.push(...hebcalTools);
  if (ready.ontopo) tools.push(...ontopoTools);
  if (ready.amadeus) tools.push(...amadeusTools);
  // Calendar and Gmail share one refresh token, so these two flags rise and fall
  // together — but they stay separate ids so the sidebar can say which capability
  // the account actually granted.
  if (ready['google-calendar']) tools.push(...googleCalendarTools);
  if (ready.gmail) tools.push(...gmailTools);
  if (ready.whatsapp) tools.push(...whatsappTools);

  const registry = new Map(tools.map((tool) => [tool.name, tool]));

  logger.info('integrations.registered', {
    tools: registry.size,
    services: Object.entries(ready)
      .filter(([, isReady]) => isReady)
      .map(([id]) => id),
  });

  return registry;
}
