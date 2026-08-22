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
 * 2 — NAME and AGE no longer anonymised.
 * 1 — initial policy.
 */
const POLICY_REVISION = 2;

export class SafetyStack extends cdk.Stack {
  public readonly guardrailId: string;
  public readonly guardrailVersion: string;

  constructor(scope: Construct, id: string, props: SafetyStackProps) {
    super(scope, id, props);

    const { config } = props;

    const guardrail = new bedrock.CfnGuardrail(this, 'ValentinGuardrail', {
      name: config.guardrailName,
      /*
       * Worded as Valentin declining this one turn, and kept in step with the
       * fallback in bedrock-client.ts. The guardrail's message wins whenever it
       * fires — Bedrock returns it as the assistant's reply text, so the nicer
       * line in the client is only ever reached when the guardrail sends none.
       * The old text ("I can only help with learning about your partner…") read,
       * mid-conversation about a partner he already knew, as though he had
       * forgotten her.
       */
      blockedInputMessaging:
        "That one I'd rather not go into — but I'm still right here. Shall we talk about her instead?",
      blockedOutputsMessaging:
        'Let me stay focused on your partner profile. What else can I learn about them?',
      contentPolicyConfig: {
        filtersConfig: [
          /*
           * SEXUAL is MEDIUM on input, not HIGH — user-approved, 2026-08-22.
           *
           * At HIGH it blocked "Her ring size is 6 and she is 5 foot 4." Her
           * sizes are a profile field this agent asks for outright, so measuring
           * a partner is the product working, not a filter catch. MEDIUM still
           * blocks explicit requests (verified against the live guardrail), and
           * output stays HIGH: what Valentin writes is held to the stricter bar.
           */
          { type: 'SEXUAL', inputStrength: 'MEDIUM', outputStrength: 'HIGH' },
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
         * ADDRESS is absent for the same reason, and it was the worse offender:
         * Bedrock reads a bare place name as an address, so "she's been saving
         * for Kyoto" was BLOCKed, and so were Paris, Rome, Seattle, a favourite
         * restaurant on Rue Saint-Denis, and the word "France". Date planning is
         * half of what this agent does and every date has a place in it, so the
         * entity can't be blocked without blocking the feature. A street address
         * the user volunteers is stored under their own key, as her name is.
         *
         * The genuinely dangerous identifiers below stay BLOCKed: nothing about
         * remembering a name or a city is a reason to carry a card number, an
         * SSN, a phone number or an AWS key.
         */
        piiEntitiesConfig: [
          { type: 'CREDIT_DEBIT_CARD_NUMBER', action: 'BLOCK' },
          { type: 'US_SOCIAL_SECURITY_NUMBER', action: 'BLOCK' },
          { type: 'PHONE', action: 'BLOCK' },
          { type: 'EMAIL', action: 'BLOCK' },
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
