/**
 * Live model verification for Valentin's Bedrock LLM.
 *
 * Unlike the unit tests (which mock the AWS SDK), this script makes REAL calls
 * to Bedrock using your configured credentials. It confirms three things about
 * the conversational flow:
 *
 *   1. The configured model is invokable and returns non-empty text.
 *   2. Response variability — asking the SAME question twice yields at least
 *      some different wording (temperature > 0 is doing its job).
 *   3. Classic conversational shape — Valentin's replies land in a natural
 *      range (roughly a few sentences), per the system prompt.
 *
 * Requires AWS credentials with bedrock:InvokeModel on the target model's
 * inference profile. Run with:
 *
 *   AWS_PROFILE=valentin AWS_REGION=us-east-1 npm run verify-model
 */
import { AwsBedrockClient } from '../src/server/agent/bedrock-client';
import { VALENTIN_SYSTEM_PROMPT } from '../src/server/agent/prompts';
import type { ChatMessage } from '../src/shared/interfaces/message';

function userMessage(content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    sessionId: 'verify-model',
    sender: 'user',
    content,
    timestamp: new Date().toISOString(),
  };
}

/** Count sentences by terminal punctuation (., !, ?). */
function countSentences(text: string): number {
  const matches = text.match(/[^.!?]+[.!?]+/g);
  return matches ? matches.length : text.trim().length > 0 ? 1 : 0;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
  console.log(`  ✓ ${message}`);
}

async function main() {
  const client = new AwsBedrockClient();
  console.log(`[verify-model] Model: ${client.getModelId()}`);
  console.log(`[verify-model] Region: ${process.env.AWS_REGION ?? 'us-east-1'}\n`);

  // --- Check 1: model is invokable and returns text ---
  console.log('[verify-model] Check 1: model responds with non-empty text');
  const first = await client.generateResponse(
    [userMessage('Hi Valentin! My partner is named Maya.')],
    VALENTIN_SYSTEM_PROMPT,
  );
  assert(first.content.trim().length > 0, 'model returned non-empty content');
  console.log(`    → "${first.content}"\n`);

  // --- Check 2: response variability on the same prompt ---
  console.log('[verify-model] Check 2: same question yields varied wording');
  const question = 'What kinds of things should I tell you about my partner?';
  const [a, b, c] = await Promise.all([
    client.generateResponse([userMessage(question)], VALENTIN_SYSTEM_PROMPT),
    client.generateResponse([userMessage(question)], VALENTIN_SYSTEM_PROMPT),
    client.generateResponse([userMessage(question)], VALENTIN_SYSTEM_PROMPT),
  ]);
  const unique = new Set([a.content.trim(), b.content.trim(), c.content.trim()]);
  console.log(`    → 3 responses, ${unique.size} unique`);
  assert(
    unique.size >= 2,
    'the same question produced at least 2 distinct responses (variability)',
  );
  console.log('');

  // --- Check 3: classic conversational shape (a few sentences) ---
  console.log('[verify-model] Check 3: replies are a natural few sentences');
  const sentenceCounts = [first, a, b, c].map((r) => countSentences(r.content));
  console.log(`    → sentence counts: ${sentenceCounts.join(', ')}`);
  const avg =
    sentenceCounts.reduce((sum, n) => sum + n, 0) / sentenceCounts.length;
  console.log(`    → average: ${avg.toFixed(1)} sentences`);
  assert(
    sentenceCounts.every((n) => n >= 1 && n <= 8),
    'every reply is between 1 and 8 sentences (concise but heartfelt)',
  );
  console.log('');

  console.log('[verify-model] ✅ All live checks passed');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n[verify-model] ❌ FAILED');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
