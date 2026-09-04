#!/usr/bin/env npx tsx
/**
 * Emit the Gateway tool schemas from the registry that actually runs.
 *
 *   npx tsx scripts/generate-tool-schemas.mts
 *
 * Writes `infra/lib/generated/integration-tool-schemas.json`, which
 * `agentcore-stack.ts` spreads into the integration target's `inlinePayload`.
 *
 * ### Why a generator and not a hand-written list
 *
 * `infra/tsconfig.json` has `rootDir: '.'` and includes only `bin`, `lib` and
 * `config`, so the CDK app **cannot** import
 * `src/server/integrations/<service>/tools.ts` — spelled with a placeholder
 * rather than a glob because a `*` followed by a slash ends this comment.
 * That leaves two options: describe fourteen tools a second time in the stack, or
 * generate the description from the tools themselves.
 *
 * The second copy is the thing to avoid. A tool's `description` is the entire
 * instruction the model gets about when to call it, and its `input_schema` is the
 * contract — so a stale copy does not fail loudly, it makes the model call the
 * right tool with the wrong arguments, or stop calling it at all. That reads as
 * "AgentCore's tool use is worse", which is exactly the false conclusion this
 * whole comparison exists to avoid.
 *
 * So: generate, commit the output, and fail a unit test on drift
 * (`src/server/integrations/__tests__/tool-schemas.test.ts`). Committing it is
 * what keeps `npm run test:infra` working on a clean clone with no generate step,
 * and what puts the agent's actual instructions in the reviewed diff.
 *
 * ### Why the credentials are stubbed
 *
 * `buildToolRegistry` registers a tool only when its integration is ready, which
 * is right at runtime and wrong here: the schema list must be the same on a
 * laptop with no `.env` as in CI. So every credential is set to a placeholder
 * before the registry is built — these values are never used to call anything,
 * this process makes no network request, and the *deployed* Lambda still gates
 * registration on real readiness. A tool whose credentials are missing at run
 * time is declared to the Gateway and answers "not configured", which is a better
 * failure than being invisible.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Set before importing anything that reads it.
 *
 * `src/server/config.ts` is a module-level literal built from `process.env`, so
 * it is frozen at first import — which is why the registry is pulled in with a
 * dynamic `import()` below rather than a top-level one. A static import would be
 * hoisted above these assignments and produce an empty registry, silently: the
 * generated file would contain two tools and no error.
 */
const PLACEHOLDER_ENV = {
  AMADEUS_CLIENT_ID: 'schema-generation-only',
  AMADEUS_CLIENT_SECRET: 'schema-generation-only',
  GOOGLE_CLIENT_ID: 'schema-generation-only',
  GOOGLE_CLIENT_SECRET: 'schema-generation-only',
  GOOGLE_REFRESH_TOKEN: 'schema-generation-only',
  WHATSAPP_PHONE_NUMBER_ID: 'schema-generation-only',
  WHATSAPP_TOKEN: 'schema-generation-only',
  SPOTIFY_CLIENT_ID: 'schema-generation-only',
  SPOTIFY_CLIENT_SECRET: 'schema-generation-only',
  // Read into a module variable at first import of the Places client, which is why
  // this one must be set before the dynamic import below like all the others —
  // `primePlacesKey()` is the async path and is deliberately not called here, since
  // this process makes no network request.
  GOOGLE_PLACES_API_KEY: 'schema-generation-only',
} as const;

/** One tool as the Gateway's `inlinePayload` wants it. */
export interface GatewayToolSchema {
  readonly name: string;
  readonly description: string;
  /**
   * Whether this tool proposes rather than acts.
   *
   * Carried here so the stack can ship the read-only tools first, and later pair
   * each gated tool with a `confirm_*` the *proxy* calls, without inferring
   * either from the name. The name prefix happens to agree today — a test asserts
   * it — but a convention is a weaker thing to key IAM and tool exposure on than
   * the flag the tool itself declares. `agentcore-stack.ts` drops this field when
   * building `inlinePayload`, which takes schema fields only.
   */
  readonly requiresConfirmation: boolean;
  readonly inputSchema: {
    readonly type: 'object';
    readonly properties: Record<string, unknown>;
    readonly required: readonly string[];
  };
}

/**
 * Build the schema list.
 *
 * Exported so the drift test can call it in-process instead of shelling out to
 * this script — a test that spawned `tsx` would be slow and would pass on a
 * machine where the generated file happened to be stale in the same way.
 */
export async function generateToolSchemas(): Promise<GatewayToolSchema[]> {
  for (const [key, value] of Object.entries(PLACEHOLDER_ENV)) {
    process.env[key] = value;
  }

  const { buildToolRegistry } = await import('../src/server/integrations/index.js');
  const { GATEWAY_IDENTITY_ARGS, GATEWAY_IDENTITY_REQUIRED } = await import(
    '../infra/lib/gateway-identity-args.js'
  );

  const registry = buildToolRegistry();

  return [...registry.values()]
    .map((tool): GatewayToolSchema => {
      const schema = tool.input_schema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      return {
        name: tool.name,
        description: tool.description,
        requiresConfirmation: tool.requiresConfirmation,
        inputSchema: {
          type: 'object',
          // Identity first, then the tool's own arguments. A tool that declared
          // its own `user_id` would be overriding the proxy's — spreading identity
          // first rather than last means the shared definition wins.
          properties: { ...GATEWAY_IDENTITY_ARGS, ...(schema.properties ?? {}) },
          required: [...GATEWAY_IDENTITY_REQUIRED, ...(schema.required ?? [])],
        },
      };
    })
    // Sorted by name so the committed diff reflects a real change to a tool and
    // not the order integrations happen to register in.
    .sort((a, b) => a.name.localeCompare(b.name));
}

const OUTPUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../infra/lib/generated/integration-tool-schemas.json',
);

/** True when run directly, false when imported by the drift test. */
const runDirectly = process.argv[1]?.includes('generate-tool-schemas');

if (runDirectly) {
  const schemas = await generateToolSchemas();
  mkdirSync(dirname(OUTPUT), { recursive: true });
  // Trailing newline, two-space indent: the file is committed and read by humans
  // in review, and a diff without a trailing newline is noisier than the change.
  writeFileSync(OUTPUT, `${JSON.stringify(schemas, null, 2)}\n`);

  const gated = schemas.filter((s) => s.requiresConfirmation);
  console.log(`Wrote ${schemas.length} tool schemas to ${OUTPUT}`);
  console.log(`  ${gated.length} require confirmation: ${gated.map((g) => g.name).join(', ')}`);
}
