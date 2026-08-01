import * as cdk from 'aws-cdk-lib';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environments';

export interface SafetyStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

export class SafetyStack extends cdk.Stack {
  public readonly guardrailId: string;
  public readonly guardrailVersion: string;

  constructor(scope: Construct, id: string, props: SafetyStackProps) {
    super(scope, id, props);

    const { config } = props;

    const guardrail = new bedrock.CfnGuardrail(this, 'ValentinGuardrail', {
      name: config.guardrailName,
      blockedInputMessaging:
        'I can only help with learning about your partner. Could you tell me more about their preferences?',
      blockedOutputsMessaging:
        'Let me stay focused on your partner profile. What else can I learn about them?',
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
        piiEntitiesConfig: [
          { type: 'NAME', action: 'ANONYMIZE' },
          { type: 'AGE', action: 'ANONYMIZE' },
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

    // Create a guardrail version for stable deployment references
    const guardrailVersion = new bedrock.CfnGuardrailVersion(this, 'GuardrailVersion', {
      guardrailIdentifier: guardrail.attrGuardrailId,
      description: `Version for ${config.env} environment`,
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
