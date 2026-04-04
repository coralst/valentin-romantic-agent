import { describe, it, expect } from 'vitest';
import { StubBedrockClient } from '../bedrock-client';
import type { ChatMessage } from '../../../shared/interfaces/message';

function makeMsg(content: string, sender: 'user' | 'agent' = 'user'): ChatMessage {
  return {
    id: `msg-${Math.random()}`,
    sessionId: 'session-test',
    sender,
    content,
    timestamp: new Date().toISOString(),
  };
}

describe('StubBedrockClient', () => {
  const stub = new StubBedrockClient();

  it('returns a welcome message when no user messages are present', async () => {
    const agentOnly = [makeMsg('Hello!', 'agent')];
    const result = await stub.generateResponse(agentOnly, 'system');
    expect(result.content).toContain('Valentin');
  });

  it('returns food-related response for food keywords', async () => {
    const result = await stub.generateResponse(
      [makeMsg('My partner loves Italian food and cooking')],
      'system',
    );
    expect(result.content.toLowerCase()).toMatch(/cuisine|cook|restaurant|dish|food/);
  });

  it('returns music-related response for music keywords', async () => {
    const result = await stub.generateResponse(
      [makeMsg('She really enjoys jazz music and plays piano')],
      'system',
    );
    expect(result.content.toLowerCase()).toMatch(/music|artist|song|instrument|genre/);
  });

  it('returns travel-related response for travel keywords', async () => {
    const result = await stub.generateResponse(
      [makeMsg('We love to travel and explore new cities')],
      'system',
    );
    expect(result.content.toLowerCase()).toMatch(/travel|beach|cities|destination|adventure/);
  });

  it('returns book-related response for reading keywords', async () => {
    const result = await stub.generateResponse(
      [makeMsg('He reads a novel every week, loves fiction')],
      'system',
    );
    expect(result.content.toLowerCase()).toMatch(/read|fiction|author|book|stories/);
  });

  it('returns sport-related response for fitness keywords', async () => {
    const result = await stub.generateResponse(
      [makeMsg('She goes to the gym every morning and loves yoga')],
      'system',
    );
    expect(result.content.toLowerCase()).toMatch(/sport|workout|fitness|active|outdoor/);
  });

  it('produces different responses for different food messages', async () => {
    const r1 = await stub.generateResponse(
      [makeMsg('My partner loves sushi')],
      'system',
    );
    const r2 = await stub.generateResponse(
      [makeMsg('She enjoys baking cakes in the kitchen')],
      'system',
    );
    expect(r1.content).not.toBe(r2.content);
  });

  it('produces different responses for completely different topics', async () => {
    const food = await stub.generateResponse(
      [makeMsg('He loves cooking pasta')],
      'system',
    );
    const music = await stub.generateResponse(
      [makeMsg('She plays guitar in a band')],
      'system',
    );
    const travel = await stub.generateResponse(
      [makeMsg('We want to visit Japan next year')],
      'system',
    );

    const responses = [food.content, music.content, travel.content];
    const unique = new Set(responses);
    expect(unique.size).toBe(3);
  });

  it('returns a fallback response for unrecognized topics', async () => {
    const result = await stub.generateResponse(
      [makeMsg('dsdsd')],
      'system',
    );
    expect(result.content).toBeTruthy();
    expect(result.content.length).toBeGreaterThan(20);
  });

  it('uses the last user message, not agent messages', async () => {
    const messages = [
      makeMsg('Tell me about your partner', 'agent'),
      makeMsg('He loves rock concerts and live music'),
    ];
    const result = await stub.generateResponse(messages, 'system');
    expect(result.content.toLowerCase()).toMatch(/music|artist|song|instrument|genre/);
  });

  it('extractWithTool returns empty preferences', async () => {
    const result = await stub.extractWithTool(
      makeMsg('test'),
      [],
      { name: 'extract_preferences', description: 'test', input_schema: {} },
    );
    expect(result.toolName).toBe('extract_preferences');
    expect(result.input).toEqual({ preferences: [] });
  });
});
