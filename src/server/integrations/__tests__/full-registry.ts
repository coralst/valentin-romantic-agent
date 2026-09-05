/**
 * A registry with every tool in it, for tests that assert about the catalogue.
 *
 * `buildToolRegistry()` is gated by `integrationReadiness()`, so on a laptop with
 * no Google credentials it returns a registry with no `propose_email` in it. A
 * test that asserts "every tool obeys rule X" would then pass by not looking at
 * most of the tools, and would keep passing as tools were added — the worst kind
 * of green.
 *
 * The placeholder-env-then-dynamic-import dance is lifted from
 * `scripts/generate-tool-schemas.mts`, and is load-bearing for the same reason it
 * is there: `src/server/config.ts` is a module-level literal frozen at first
 * import, so a static import would hoist above these assignments and yield a
 * near-empty registry, silently.
 *
 * No network request is made — these credentials are never used, only counted.
 */
import type { ToolRegistry } from '../tool-registry';

const PLACEHOLDER_ENV = {
  AMADEUS_CLIENT_ID: 'test-only',
  AMADEUS_CLIENT_SECRET: 'test-only',
  GOOGLE_CLIENT_ID: 'test-only',
  GOOGLE_CLIENT_SECRET: 'test-only',
  GOOGLE_REFRESH_TOKEN: 'test-only',
  WHATSAPP_PHONE_NUMBER_ID: 'test-only',
  WHATSAPP_TOKEN: 'test-only',
  SPOTIFY_CLIENT_ID: 'test-only',
  SPOTIFY_CLIENT_SECRET: 'test-only',
  SPOTIFY_REFRESH_TOKEN: 'test-only',
  GOOGLE_PLACES_API_KEY: 'test-only',
  TAVILY_API_KEY: 'tvly-test-only',
} as const;

/** Every registered tool, regardless of what this machine has credentials for. */
export async function fullRegistry(): Promise<ToolRegistry> {
  return (await loadWithPlaceholderCredentials()).registry;
}

/**
 * Registry and readiness read from the *same* module instance.
 *
 * Both must come from here rather than from a top-level import in the test file:
 * a static `import ... from '../index'` is hoisted above the env assignments and
 * freezes `config` uncredentialed, at which point the registry is missing every
 * gated tool and an invariant over "every tool" quietly checks half of them.
 */
export async function loadWithPlaceholderCredentials(): Promise<{
  registry: ToolRegistry;
  readiness: Record<string, boolean>;
}> {
  for (const [key, value] of Object.entries(PLACEHOLDER_ENV)) {
    process.env[key] = value;
  }

  const { buildToolRegistry, integrationReadiness } = await import('../index.js');
  return {
    registry: buildToolRegistry(),
    readiness: integrationReadiness() as unknown as Record<string, boolean>,
  };
}
