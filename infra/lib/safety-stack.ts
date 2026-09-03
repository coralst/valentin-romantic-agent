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
 * 6 — the EMAIL entity is gone; a recipient address is an input, not a leak.
 * 5 — a street-address regex replaces the ADDRESS entity; SEXUAL input MEDIUM.
 * 4 — ADDRESS no longer judges Valentin's own replies.
 * 3 — the off-topic topic no longer judges Valentin's own replies.
 * 2 — NAME and AGE no longer anonymised.
 * 1 — initial policy.
 */
const POLICY_REVISION = 6;

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
          /*
           * SEXUAL is MEDIUM on the prompt, not HIGH.
           *
           * At HIGH it blocked "Her ring size is 6 and she is 5 foot 4" —
           * measured against the live guardrail. Her sizes are one of the
           * twenty-one profile fields this agent asks for outright, so a visitor
           * reciting them is the product working. MEDIUM still blocks explicit
           * requests about her, checked the same way. Output stays HIGH: what
           * Valentin writes is held to the stricter bar, since a reply is the
           * thing that would be read aloud on stage.
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
         * EMAIL is absent for the third time on the same reasoning, and it was
         * the most direct self-inflicted wound of the three. Valentin's whole
         * reminder feature is "email me the options", `propose_email` takes a
         * `to` address as a required input, and a recipient address is
         * therefore something the visitor has to be able to type. With the
         * entity BLOCKing the prompt they could not: typing
         * "send it to me at <address>" scored `guardrail_intervened`, and
         * `bedrock-client.ts` substitutes a canned line for that, so the reply
         * was Valentin declining to discuss it. Reported from the live app,
         * 2026-09-03. ANONYMIZE is not the answer either — it would rewrite the
         * address into a placeholder and the tool would send to nothing.
         *
         * The address is not incidental PII here. It is an argument the user
         * supplies on purpose so the agent can act on it, like her name and her
         * birthday, and it is stored under its owner's own key. Note that the
         * three regexes below are all address-shaped and none of them matches an
         * email, so removing the entity really does unblock it.
         *
         * The genuinely dangerous identifiers below stay BLOCKed: nothing about
         * remembering a name, a city or a recipient is a reason to carry a card
         * number, an SSN or an AWS key. PHONE stays too — no tool takes a phone
         * number as input today, so unlike EMAIL it blocks nothing that works.
         * If the WhatsApp path is ever built it will hit this exact wall, and
         * this comment is the reason why.
         */
        piiEntitiesConfig: [
          { type: 'CREDIT_DEBIT_CARD_NUMBER', action: 'BLOCK' },
          { type: 'US_SOCIAL_SECURITY_NUMBER', action: 'BLOCK' },
          { type: 'PHONE', action: 'BLOCK' },
          { type: 'AWS_ACCESS_KEY', action: 'BLOCK' },
          { type: 'AWS_SECRET_KEY', action: 'BLOCK' },
        ],
        /*
         * The ADDRESS entity is gone; these three patterns take over the job it
         * was there to do.
         *
         * Disabling ADDRESS on the reply fixed the output half of this, but the
         * entity was still BLOCKing the prompt, and the prompt is where a visitor
         * types the thing the agent is for. Measured against the live guardrail,
         * ADDRESS on input blocked "she's been saving for Kyoto", "I want to take
         * her to Rome for our anniversary", "we met in Paris", "she grew up in
         * Seattle", a restaurant on Rue Saint-Denis, and the bare word "France".
         * Half of what this agent does is plan dates, and every date has a place
         * in it, so the entity could not stay without the feature going with it.
         *
         * The intent behind keeping it was right, though: a visitor typing her
         * home address should not reach the model or the table. That risk is a
         * *residence*, which has a shape — a building number and a street type,
         * or a postcode — and a regex can say so where the entity could not tell
         * "42 Maple Street" from "Rome". Verified both directions on a throwaway
         * guardrail: nine place-name sentences pass, and 1600 Pennsylvania
         * Avenue, 42 Maple Street, 221B Baker Street, "Seattle WA 98101" and
         * "SW1A 1AA" are all still blocked.
         */
        regexesConfig: [
          {
            name: 'street-address',
            description:
              'A building number followed by a street name and type, which is a residence rather than a place name.',
            pattern:
              "\\b\\d{1,5}[A-Za-z]?\\s+([A-Za-z0-9'.-]+\\s+){0,4}(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Terrace|Ter|Circle|Cir|Parkway|Pkwy|Highway|Hwy)\\b\\.?",
            action: 'BLOCK',
          },
          {
            name: 'us-zip-plus-state',
            description:
              'A US state abbreviation followed by a ZIP code, which only appears in a postal address.',
            pattern: '\\b[A-Z]{2}\\s+\\d{5}(-\\d{4})?\\b',
            action: 'BLOCK',
          },
          {
            name: 'uk-postcode',
            description: 'A UK postcode, which only appears in a postal address.',
            pattern: '\\b[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}\\b',
            action: 'BLOCK',
          },
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
