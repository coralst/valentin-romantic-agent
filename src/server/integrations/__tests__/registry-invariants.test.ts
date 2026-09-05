/**
 * Rules the whole tool catalogue must obey, asserted over every tool at once.
 *
 * `tool-schemas.test.ts` pins the generated Gateway file against the registry, so
 * the two cannot drift. It says nothing about whether the registry is internally
 * coherent — and the failures that reach a user are mostly coherence failures: a
 * capability reported ready with nothing behind it, one schema spelled in a
 * different case from the other twenty, two gated tools on a service whose
 * confirm step resolves by service.
 *
 * These are invariants rather than examples on purpose. An invariant fails the day
 * a new tool breaks it, which is the day it is cheap to fix.
 */
import { describe, expect, it } from 'vitest';

import { SAFE_INPUT_KEYS } from '../../agent/activity-summary';
import type { AgentTool } from '../tool-registry';
import { fullRegistry, loadWithPlaceholderCredentials } from './full-registry';

interface Schema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: readonly string[];
}

const schemaOf = (tool: AgentTool): Schema => tool.input_schema as Schema;
const propsOf = (tool: AgentTool): Record<string, unknown> => schemaOf(tool).properties ?? {};

describe('tool schemas', () => {
  it('spell every property in snake_case', async () => {
    const registry = await fullRegistry();
    const offenders: string[] = [];

    for (const tool of registry.values()) {
      for (const key of Object.keys(propsOf(tool))) {
        if (!/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(key)) {
          offenders.push(`${tool.name}.${key}`);
        }
      }
    }

    // `input_schema` mirrors Bedrock's `toolSpec`, and every other tool in the
    // catalogue uses snake_case. A lone camelCase key is a key the model will
    // sometimes emit in the house style instead, and the tool then reports the
    // argument as missing.
    expect(offenders, `not snake_case: ${offenders.join(', ')}`).toEqual([]);
  });

  it('declare no required property that the schema does not define', async () => {
    const registry = await fullRegistry();

    for (const tool of registry.values()) {
      const defined = new Set(Object.keys(propsOf(tool)));
      for (const name of schemaOf(tool).required ?? []) {
        expect(defined.has(name), `${tool.name} requires "${name}" but never defines it`).toBe(true);
      }
    }
  });

  it('describe every date property as YYYY-MM-DD', async () => {
    const registry = await fullRegistry();

    for (const tool of registry.values()) {
      for (const [key, spec] of Object.entries(propsOf(tool))) {
        if (!/(^|_)date$|^check_in$|^check_out$/.test(key)) continue;
        const description = String((spec as { description?: unknown }).description ?? '');
        expect(
          description,
          `${tool.name}.${key} does not tell the model the format to use`,
        ).toMatch(/YYYY-MM-DD/);
      }
    }
  });
});

describe('confirmation contract', () => {
  it('puts at most one gated tool on any one service', async () => {
    const registry = await fullRegistry();
    const byService = new Map<string, string[]>();

    for (const tool of registry.values()) {
      if (!tool.requiresConfirmation) continue;
      byService.set(tool.service, [...(byService.get(tool.service) ?? []), tool.name]);
    }

    // `AgentOrchestrator.toolFor` resolves the confirming tool by `service` +
    // `requiresConfirmation`, not by name. A second gated tool on one service
    // therefore misroutes a confirm to whichever the map yields first — the user
    // accepts a restaurant card and something else happens. Until that resolves
    // by name, this invariant is the thing standing between the codebase and a
    // silent misroute.
    const doubled = [...byService].filter(([, names]) => names.length > 1);
    expect(
      doubled,
      `services with more than one gated tool: ${doubled
        .map(([service, names]) => `${service} → ${names.join(' + ')}`)
        .join('; ')}`,
    ).toEqual([]);
  });

  it('gives every gated tool a confirm implementation', async () => {
    const registry = await fullRegistry();

    for (const tool of registry.values()) {
      if (!tool.requiresConfirmation) continue;
      expect(typeof tool.confirm, `${tool.name} is gated but has no confirm()`).toBe('function');
    }
  });

  it('gives no ungated tool a confirm implementation', async () => {
    const registry = await fullRegistry();

    for (const tool of registry.values()) {
      if (tool.requiresConfirmation) continue;
      expect(tool.confirm, `${tool.name} is ungated but defines confirm()`).toBeUndefined();
    }
  });
});

describe('readiness means callability', () => {
  it('reports no integration ready unless a tool provides it', async () => {
    const { registry, readiness } = await loadWithPlaceholderCredentials();
    const services = new Set([...registry.values()].map((tool) => tool.service));

    const empty = Object.entries(readiness)
      .filter(([, ready]) => ready === true)
      .map(([id]) => id)
      .filter((id) => !services.has(id));

    // `GET /api/integrations` is what the client's status strip renders, so an id
    // reported ready with no tool behind it is a capability claimed to the user
    // that nothing can perform.
    expect(
      empty,
      `reported ready but no tool declares the service: ${empty.join(', ')}`,
    ).toEqual([]);
  });
});

describe('activity trail observability', () => {
  it('treats every date argument the same way', async () => {
    const registry = await fullRegistry();
    const dateKeys = new Set<string>();

    for (const tool of registry.values()) {
      for (const key of Object.keys(propsOf(tool))) {
        if (/(^|_)date$|^check_in$|^check_out$/.test(key)) dateKeys.add(key);
      }
    }

    const shown = [...dateKeys].filter((key) => SAFE_INPUT_KEYS.has(key));
    const hidden = [...dateKeys].filter((key) => !SAFE_INPUT_KEYS.has(key));

    // The SAFE_INPUT_KEYS docblock states the rule itself: "A city, a party size
    // and a date cannot" hold anything about a person. So either every date is
    // shown in the activity trail or none is — a split means the trail renders one
    // leg of a hotel stay and redacts the other, and the resolved date, the single
    // most useful thing to see when the agent picks the wrong day, is invisible.
    expect(
      hidden.length === 0 || shown.length === 0,
      `dates shown in the trail: [${shown.join(', ')}] but redacted: [${hidden.join(', ')}]`,
    ).toBe(true);
  });
});
