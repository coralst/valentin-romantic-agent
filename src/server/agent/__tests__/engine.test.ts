import { describe, it, expect, vi, afterEach } from 'vitest';
import { DEFAULT_ENGINE, isWebSocketPath, resolveEngine, WS_PATHS } from '../engine';
import { config } from '../../config';

describe('resolveEngine', () => {
  const originalArn = config.agentCore.runtimeArn;

  afterEach(() => {
    config.agentCore.runtimeArn = originalArn;
    vi.restoreAllMocks();
  });

  it('is engine A when AGENT_ENGINE is unset — the local and test default', () => {
    expect(resolveEngine(undefined)).toBe('valentin');
    expect(DEFAULT_ENGINE).toBe('valentin');
  });

  it('accepts engine A explicitly, and tolerates case and whitespace', () => {
    expect(resolveEngine('valentin')).toBe('valentin');
    expect(resolveEngine('  VALENTIN ')).toBe('valentin');
  });

  it('serves engine B when the Runtime ARN is present', () => {
    config.agentCore.runtimeArn = 'arn:aws:bedrock-agentcore:us-east-1:1:runtime/v';
    expect(resolveEngine('agentcore')).toBe('agentcore');
    expect(resolveEngine('AgentCore')).toBe('agentcore');
  });

  it('downgrades loudly when engine B is asked for but unconfigured', () => {
    // Not a throw: a misconfiguration should not be an outage. Not silent
    // either: serving engine A under engine B's label would attribute engine
    // A's numbers to AgentCore.
    config.agentCore.runtimeArn = undefined;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(resolveEngine('agentcore')).toBe('valentin');

    const logged = spy.mock.calls.map((call) => String(call[0])).join('');
    expect(logged).toContain('agent.engine.unavailable');
    expect(logged).toContain('AGENTCORE_RUNTIME_ARN');
  });

  it('warns and falls back on a typo rather than serving something unnamed', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveEngine('agent-core')).toBe('valentin');
    expect(spy.mock.calls.map((call) => String(call[0])).join('')).toContain(
      'agent.engine.unknown',
    );
  });
});

describe('isWebSocketPath', () => {
  it('accepts both engines’ paths, on either task', () => {
    // `/ws/agentcore` is an ALB routing label, not a second protocol.
    expect(WS_PATHS).toEqual(['/ws', '/ws/agentcore']);
    expect(isWebSocketPath('/ws')).toBe(true);
    expect(isWebSocketPath('/ws/agentcore')).toBe(true);
  });

  it('ignores a query string, so an upgrade does not look like a network fault', () => {
    expect(isWebSocketPath('/ws?token=abc')).toBe(true);
    expect(isWebSocketPath('/ws/agentcore?x=1')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isWebSocketPath('/ws/other')).toBe(false);
    expect(isWebSocketPath('/api/health')).toBe(false);
    expect(isWebSocketPath('/wsx')).toBe(false);
    expect(isWebSocketPath(undefined)).toBe(false);
  });
});
