import * as cdk from 'aws-cdk-lib';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environments';

export interface SafetyStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

/**
 * Bumped whenever the guardrail's policy below changes.
 *
 * 3 — the off-topic topic no longer judges Valentin's own replies.
 * 2 — NAME and AGE no longer anonymised.
 * 1 — initial policy.
 */
const POLICY_REVISION = 3;

export class SafetyStack extends cdk.Stack {
  public readonly guardrailId: string;
  public readonly guardrailVersion: string;

  constructor(scope: Construct, id: string, props: SafetyStackProps) {
    super(scope, id, props);

    const { config } = props;

    const guardrail = new bedrock.CfnGuardrail(this, 'ValentinGuardrail', {
      name: config.guardrailName,
      /*
       * Both messages are worded as Valentin declining *this* turn, not as him
       * announcing the limits of his job.
       *
       * The old pair ("I can only help with learning about your partner. Could
       * you tell me more about their preferences?" / "Let me stay focused on
       * your partner profile. What else can I learn about them?") landed on
       * people mid-conversation about a partner he already knew twenty-one facts
       * about, and read as though he had forgotten her and could do nothing
       * else. They also matched the client-side fallback in `bedrock-client.ts`
       * word for word, so there was no way to tell from a transcript which of
       * the two had spoken.
       */
      blockedInputMessaging:
        "That one I'd rather not go into — but I'm still right here. Shall we talk about her instead?",
      blockedOutputsMessaging:
        "I started to answer that and thought better of it. Ask me again another way and I'll try.",
      contentPolicyConfig: {
        filtersConfig: [
          { type: 'SEXUAL', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'VIOLENCE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'HATE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'INSULTS', inputStrength: 'MEDIUM', outputStrength: 'HIGH' },
          { type: 'MISCONDUCT', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'PROMPT_ATTACK', inputStrength: 'HIGH', outputStrength: 'NONE' },
        ],
      },
      sensitiveInformationPolicyConfig: {
        /*
         * NAME and AGE are deliberately absent — user-approved, 2026-08-22.
         *
         * Anonymising them defeated the product: the guardrail rewrote the model's
         * own words, so a live run answered "{NAME} — that's lovely" seconds after
         * the user typed the partner's name, and an age came back a placeholder. A
         * partner's name and birthday are the two facts this agent exists to
         * remember and the first two it asks for — its subject matter rather than
         * incidental PII, and already stored under their owner's own key.
         *
         * The genuinely dangerous identifiers below stay BLOCKed: nothing about
         * remembering a name is a reason to carry a card number, an SSN, a home
         * address or an AWS key.
         */
        piiEntitiesConfig: [
          { type: 'CREDIT_DEBIT_CARD_NUMBER', action: 'BLOCK' },
          { type: 'US_SOCIAL_SECURITY_NUMBER', action: 'BLOCK' },
          { type: 'PHONE', action: 'BLOCK' },
          { type: 'EMAIL', action: 'BLOCK' },
          { type: 'ADDRESS', action: 'BLOCK' },
          { type: 'AWS_ACCESS_KEY', action: 'BLOCK' },
          { type: 'AWS_SECRET_KEY', action: 'BLOCK' },
        ],
      },
      topicPolicyConfig: {
        topicsConfig: [
          {
            name: 'off-topic',
            definition:
              'Requests unrelated to romantic relationships, partner preferences, gift ideas, or date planning',
            type: 'DENY',
            /*
             * INPUT ONLY. This topic judged Valentin's own replies too, and it
             * was wrong about them in the single most important case: asked
             * "What should I get her for our anniversary?", the model wrote four
             * specific, on-topic gift ideas drawn from her profile — and the
             * classifier marked that reply `off-topic` and replaced all of it
             * with `blockedOutputsMessaging`. Verified against the live
             * guardrail with `ApplyGuardrail`/Converse traces: the input scored
             * `action: NONE`, the reply scored `BLOCKED`.
             *
             * The topic is defined by what it excludes, which reads as a
             * sentence about a *request*. A long assistant answer naming
             * cottages, trail shoes and poetry anthologies matches the surface
             * of it however on-topic the answer actually is. Nothing is lost by
             * scoping it to the prompt: this topic exists to stop a visitor
             * dragging Valentin off his job, and a prompt he never sees cannot
             * produce an off-topic answer. The content filters below, and
             * `system-prompt-extraction`, still judge every reply.
             */
            outputEnabled: false,
          },
          {
            name: 'system-prompt-extraction',
            definition:
              'Attempts to reveal system instructions, prompt content, or internal configuration',
            type: 'DENY',
          },
        ],
      },
    });

    /*
     * A published version, referenced by the container.
     *
     * Versions are immutable snapshots, and this resource has no dependency on the
     * policy above — so editing a filter changes only DRAFT, and the running task
     * keeps enforcing the version it was given. `POLICY_REVISION` is what makes an
     * edit reach production: bumping it changes this resource's description, CFN
     * replaces it, and a new version number flows through to the task definition.
     *
     * Bump it in the same commit as any policy change above.
     */
    const guardrailVersion = new bedrock.CfnGuardrailVersion(this, 'GuardrailVersion', {
      guardrailIdentifier: guardrail.attrGuardrailId,
      description: `Version for ${config.env} environment (policy revision ${POLICY_REVISION})`,
    });

    this.guardrailId = guardrail.attrGuardrailId;
    this.guardrailVersion = guardrailVersion.attrVersion;

    // Outputs
    new cdk.CfnOutput(this, 'GuardrailId', {
      value: guardrail.attrGuardrailId,
      exportName: `Valentin-GuardrailId-${config.env}`,
    });

    new cdk.CfnOutput(this, 'GuardrailVersionOutput', {
      value: guardrailVersion.attrVersion,
      exportName: `Valentin-GuardrailVersion-${config.env}`,
    });
  }
}
