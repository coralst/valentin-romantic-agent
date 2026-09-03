import { config } from '../config';
import { logger } from '../logging';
import type { AgentTool, IntegrationId, ToolRegistry } from './tool-registry';
import { amadeusTools } from './amadeus/tools';
import { gmailTools, googleCalendarTools } from './google/tools';
import { hebcalTools } from './hebcal/tools';
import { ontopoTools } from './ontopo/tools';
import { whatsappTools } from './whatsapp/tools';
import { browserReadyCached } from './browser/session';
import { woltTools } from './wolt/tools';
import { placesConfigured } from './google-places/client';
import { googlePlacesTools } from './google-places/tools';
import { sharingTools } from '../sharing/tools';

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
 *
 * The browser tier is ready or not for a different reason than everything else
 * here. There is no credential to supply: it depends on a Chromium binary existing
 * in this deployment, which is an environmental fact a visitor cannot fix from the
 * panel. So `browser` reflects a launch probe, and the capabilities behind it are
 * only as ready as it is — an events scrape with no browser is not "unconfigured",
 * it is impossible, and reporting it as ready would have the model confidently
 * offer something that cannot run.
 */
export function integrationReadiness(): Record<IntegrationId, boolean> {
  const { integrations } = config;
  const google = Boolean(
    integrations.googleClientId &&
      integrations.googleClientSecret &&
      integrations.googleRefreshToken,
  );
  const browser = browserReadyCached();

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
    browser,
    // Wolt's catalogue is an unauthenticated JSON API, so it needs nothing — the
    // same shape as Ontopo.
    wolt: true,
    events: browser,
    /*
     * Reads a module variable rather than the env var, because the key may arrive
     * from Secrets Manager a moment after boot — see `primePlacesKey`. Until it
     * lands this reports false, so the tool is simply absent rather than present
     * and failing on the first call.
     */
    'google-places': placesConfigured(),
    /*
     * Always true. This is not an outside service — the token is signed in this
     * process and the guest view is served by it, so there is no credential that
     * could be missing. `share-token.ts` falls back to a per-process random key
     * when `SHARE_TOKEN_SECRET` is unset, which weakens a link's lifetime across
     * a restart but never makes minting one impossible.
     */
    sharing: true,
  };
}

/**
 * The one live registry, refilled in place rather than replaced.
 *
 * Identity matters here. `createServer` reads this once at boot and hands the
 * same reference to every orchestrator it builds, so a *new* map returned from a
 * later rebuild would be invisible to all of them — a service connected through
 * the panel would report "live" in the UI while the model still had no tool for
 * it. Clearing and refilling the existing map means every holder sees the change
 * with no plumbing, no restart, and no change to `ToolSupport`.
 *
 * Everything outside this module receives it as a `ReadonlyMap`, which is the
 * true contract: this module owns the contents, and no one else may write.
 */
const activeRegistry = new Map<string, AgentTool>();

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
 *
 * Safe to call repeatedly: credentials can now arrive at runtime through
 * `POST /api/integrations/:id/connect`, and that route calls this to pick them
 * up. Registration is derived wholly from `integrationReadiness()`, so a rebuild
 * is idempotent for unchanged credentials.
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
  // Flowers, wine and gifts. Needs no credential — Wolt's catalogue endpoint is
  // unauthenticated — so this is on wherever the process can reach the internet.
  if (ready.wolt) tools.push(...woltTools);
  // Discovery within a radius. Absent without a key, which is why the dining row's
  // `backing` lists Ontopo as well — the panel then reads "live via Ontopo" rather
  // than going dark on a capability that still half works.
  if (ready['google-places']) tools.push(...googlePlacesTools);
  // A link to the conversation Valentin is already in. Always on, for the reason
  // `integrationReadiness` gives — and load-bearing for the reminder flow, since
  // "email me the options" is worth little if the mail cannot point back here.
  if (ready.sharing) tools.push(...sharingTools);

  // Cleared first, so a *disconnect* actually removes tools. Refilling without
  // clearing would leave the old ones registered and let the model keep calling
  // a service whose credentials were just taken away.
  activeRegistry.clear();
  for (const tool of tools) activeRegistry.set(tool.name, tool);

  logger.info('integrations.registered', {
    tools: activeRegistry.size,
    services: Object.entries(ready)
      .filter(([, isReady]) => isReady)
      .map(([id]) => id),
  });

  return activeRegistry;
}
