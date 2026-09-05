import { describe, it, expect, vi } from 'vitest';
import {
  checkBedrockReadiness,
  describeReadiness,
} from '../bedrock-preflight';
import type { LlmResponse } from '../bedrock-client';
import { LlmError } from '../../../shared/errors/llm-error';

/**
 * The point of this module is *where the news arrives*, so the tests are about
 * classification and legibility rather than about the model call itself. A
 * denial that gets reported as "unknown" is nearly as useless as no report at
 * all — the operator still has to go and read the raw error to know which
 * console to open.
 */

function clientThatFails(message: string) {
  return { generateResponse: vi.fn(async () => { throw new Error(message); }) };
}

const ok = {
  generateResponse: vi.fn(async (): Promise<LlmResponse> => ({
    content: 'ok',
    tokensUsed: 2,
  }) as unknown as LlmResponse),
};

describe('the boot-time model probe', () => {
  it('reports a working model call', async () => {
    const result = await checkBedrockReadiness(ok);
    expect(result).toEqual({ ok: true });
    expect(ok.generateResponse).toHaveBeenCalled();
  });

  it('names the exact fault behind the local "having a little trouble" reply', async () => {
    // Verbatim shape of what a plain IAM user gets, which is what a local
    // dev-server started without AWS_PROFILE gets on every single turn.
    const client = clientThatFails(
      'User: arn:aws:iam::684394110906:user/coralst is not authorized to perform: ' +
        'bedrock:InvokeModel on resource: arn:aws:bedrock:us-west-2:684394110906:' +
        'inference-profile/us.anthropic.claude-sonnet-4-5-20250929-v1:0 because no ' +
        'identity-based policy allows the bedrock:InvokeModel action',
    );

    const result = await checkBedrockReadiness(client);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('denied');
    // The hint has to carry the fix, not just the diagnosis.
    expect(result.hint).toContain('AWS_PROFILE=dev-devops-agent');
  });

  it('separates missing credentials from a denied action', async () => {
    const result = await checkBedrockReadiness(
      clientThatFails('Could not load credentials from any providers'),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Different fix, so it must not collapse into `denied`.
    expect(result.kind).toBe('no-credentials');
  });

  it('calls out the wrong region as a model-access problem', async () => {
    const result = await checkBedrockReadiness(
      clientThatFails("You don't have access to the model with the specified model ID."),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('no-model-access');
    expect(result.hint).toContain('us-east-1');
  });

  it('recognises a throttle, which is the one transient cause', async () => {
    const result = await checkBedrockReadiness(
      clientThatFails('ThrottlingException: Too many requests, please wait before trying again.'),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('throttled');
  });

  it('recognises no egress at all', async () => {
    const result = await checkBedrockReadiness(
      clientThatFails('getaddrinfo ENOTFOUND bedrock-runtime.us-east-1.amazonaws.com'),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('unreachable');
  });

  it('sees through the wrapper the real client throws', async () => {
    // AwsBedrockClient never lets the SDK error out — it files the real reason
    // under LlmError's context. Classifying only the outer message reported every
    // fault as `unknown`, which is exactly the bug this test pins.
    const wrapped = {
      generateResponse: vi.fn(async (): Promise<LlmResponse> => {
        throw new LlmError('Bedrock generateResponse failed', {
          modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
          errorName: 'AccessDeniedException',
          cause:
            'User: arn:aws:iam::684394110906:user/coralst is not authorized to ' +
            'perform: bedrock:InvokeModel on resource: arn:aws:bedrock:us-west-2:' +
            '684394110906:inference-profile/us.anthropic.claude-sonnet-4-5-20250929-v1:0',
        });
      }),
    };

    const result = await checkBedrockReadiness(wrapped);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('denied');
    expect(result.detail).toContain('bedrock:InvokeModel');
  });

  it('gives up rather than holding up the listener', async () => {
    // A hung Converse call must not delay `listen()` — the container health check
    // is waiting behind it, and ECS rolls a task that answers too late.
    const hangs = { generateResponse: vi.fn(() => new Promise<never>(() => {})) };

    const result = await checkBedrockReadiness(hangs, 20);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain('timed out');
  });
});

describe('the banner', () => {
  it('stays to one quiet line when everything is fine', () => {
    const line = describeReadiness({ ok: true }, 'model-x', 'us-east-1');
    expect(line.split('\n')).toHaveLength(1);
    expect(line).toContain('us-east-1');
  });

  it('spells out the consequence, not just the error', () => {
    const banner = describeReadiness(
      { ok: false, kind: 'denied', detail: 'nope', hint: 'do the thing' },
      'model-x',
      'us-west-2',
    );
    // Someone skimming a boot log has to understand that chat is dead, and that
    // the wrong region is a candidate.
    expect(banner).toContain('having a little trouble');
    expect(banner).toContain('us-west-2');
    expect(banner).toContain('do the thing');
  });
});
