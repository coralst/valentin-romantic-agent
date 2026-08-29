import { randomUUID } from 'node:crypto';
import type { ActionProposal, AgentTool, ToolResult } from '../tool-registry';
import { WHATSAPP_PROPOSAL_TTL_MS, normalisePhone, sendTemplate } from './client';
import { WHATSAPP_TEMPLATES, renderTemplate, templateByName } from './templates';

/**
 * One tool: offer to send a WhatsApp reminder.
 *
 * The whole integration is a single confirmation-gated tool, and the constraint
 * that makes it small is the same one that makes it honest. WhatsApp only permits
 * pre-approved templates for a business-initiated message, so Valentin cannot
 * write whatever it likes — it picks one of three sentences and fills in the
 * blanks. See `./templates.ts`.
 *
 * That turns out to suit a romantic concierge. The useful message here is "your
 * anniversary is on Saturday, shall I plan something?", not an essay, and a
 * constrained set of nudges is far less likely to be the thing that makes someone
 * mute the app.
 */

/** The template list, rendered into the tool description the model reads. */
function describeTemplates(): string {
  return WHATSAPP_TEMPLATES.map((template) => {
    const params = template.params.map((param) => `${param.key} (${param.description})`).join(', ');
    return `"${template.name}" — sends: ${template.body} | needs: ${params}`;
  }).join(' || ');
}

/** Pull the parameters out of the model's object, in the order the template wants. */
function collectValues(
  template: (typeof WHATSAPP_TEMPLATES)[number],
  params: unknown,
): { values: string[] } | { missing: string[] } {
  const record = params && typeof params === 'object' ? (params as Record<string, unknown>) : {};

  const values: string[] = [];
  const missing: string[] = [];
  for (const param of template.params) {
    const value = record[param.key];
    if (typeof value !== 'string' || value.trim() === '') {
      missing.push(param.key);
      continue;
    }
    // WhatsApp rejects a parameter containing a newline or a tab, and it is a
    // 400 with no useful message. Flatten rather than fail.
    values.push(value.trim().replace(/\s+/g, ' '));
  }

  return missing.length > 0 ? { missing } : { values };
}

/** Mask a number for anything that is not the confirmation card. */
function maskPhone(phone: string): string {
  return phone.length <= 4 ? '••••' : `••••${phone.slice(-4)}`;
}

export const proposeWhatsappNudgeTool: AgentTool = {
  name: 'propose_whatsapp_nudge',
  description:
    'Offer to send a short WhatsApp reminder — that an occasion is coming up, ' +
    'that a table is booked, or that you have an idea ready. This does NOT send ' +
    'anything: it shows the user the exact message and it is sent only after they ' +
    'confirm. WhatsApp only allows these three pre-approved messages, so you ' +
    'cannot write your own text; pick the closest one and fill in its ' +
    `parameters. Available: ${describeTemplates()}`,
  input_schema: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description:
          'The phone number to message. Israeli local form ("050-123-4567") or ' +
          'international ("+972501234567") both work. Ask the user for it — never guess.',
      },
      template: {
        type: 'string',
        description: 'Which pre-approved message to send. One of the names listed above.',
      },
      params: {
        type: 'object',
        description:
          'The values for that template, keyed by the parameter names listed above, ' +
          'e.g. {"occasion": "your anniversary", "date": "Saturday 5 September"}.',
      },
    },
    required: ['to', 'template', 'params'],
  },
  service: 'whatsapp',
  requiresConfirmation: true,
  async execute(input, ctx) {
    const rawPhone = typeof input.to === 'string' ? input.to : '';
    const phone = normalisePhone(rawPhone);
    if (!phone) {
      return {
        ok: false,
        summary:
          `"${rawPhone}" is not a phone number I can send to. Ask the user for it in full — ` +
          `a wrong number here means a stranger gets a message about their evening.`,
      };
    }

    const name = typeof input.template === 'string' ? input.template.trim() : '';
    const template = templateByName(name);
    if (!template) {
      return {
        ok: false,
        summary:
          `"${name}" is not an approved WhatsApp message. WhatsApp only permits the ` +
          `pre-approved ones, so pick from: ` +
          `${WHATSAPP_TEMPLATES.map((entry) => entry.name).join(', ')}.`,
      };
    }

    const collected = collectValues(template, input.params);
    if ('missing' in collected) {
      return {
        ok: false,
        summary:
          `The "${template.name}" message needs ${collected.missing.join(' and ')}. ` +
          `Ask the user, or work it out from the conversation, then try again.`,
      };
    }

    const rendered = renderTemplate(template, collected.values);
    const proposal: ActionProposal = {
      id: randomUUID(),
      sessionId: ctx.sessionId,
      service: 'whatsapp',
      title: `WhatsApp to ${maskPhone(phone)}`,
      summary:
        `This is exactly what will arrive:\n\n${rendered}\n\n` +
        `Sent to ${phone}. Nothing is sent until you confirm.`,
      expiresAt: new Date(Date.now() + WHATSAPP_PROPOSAL_TTL_MS).toISOString(),
      // The resolved number and the template name, not the prose — WhatsApp
      // renders the body from its own approved copy at send time.
      payload: { phone, template: template.name, values: collected.values },
    };

    return {
      ok: true,
      summary:
        `I've offered to send the "${template.name}" reminder to ${maskPhone(phone)}. Say what ` +
        `it will say and that it is waiting for their confirmation. Do not say it has been sent.`,
      proposal,
      data: { template: template.name },
    };
  },

  async confirm(proposal): Promise<ToolResult> {
    const payload = proposal.payload ?? {};
    const phone = typeof payload.phone === 'string' ? payload.phone : null;
    const name = typeof payload.template === 'string' ? payload.template : null;
    const values = Array.isArray(payload.values)
      ? payload.values.filter((value): value is string => typeof value === 'string')
      : null;

    const template = name ? templateByName(name) : undefined;
    if (!phone || !template || !values) {
      return {
        ok: false,
        summary:
          `That reminder is missing the details needed to send it, so nothing was sent. ` +
          `Offer to set it up again.`,
      };
    }

    const result = await sendTemplate(phone, template, values);
    if (result.ok) {
      return {
        ok: true,
        summary: `The WhatsApp reminder has been sent to ${maskPhone(phone)}. Say so once, briefly.`,
        data: { messageId: result.messageId, template: template.name },
      };
    }

    // Four failures, four different things to say. Collapsing them into "something
    // went wrong" is what makes an integration feel broken rather than
    // unfinished — and the template case in particular is a configuration state a
    // demo will genuinely be in.
    const explanation: Record<typeof result.reason, string> = {
      'not-configured':
        `WhatsApp is not connected in this build, so nothing was sent. Tell the user the ` +
        `reminder could not go out and offer to put it in the calendar instead.`,
      'template-not-approved':
        `WhatsApp has not approved the "${template.name}" message yet, so nothing was sent. ` +
        `Say the reminder could not be sent yet — this is a setup step on Valentin's side, ` +
        `not anything the user did.`,
      rejected:
        `WhatsApp refused to send that reminder, so nothing was sent. Tell the user plainly ` +
        `and offer to add a calendar reminder instead.`,
      unreachable:
        `WhatsApp did not confirm the reminder, so I cannot say it was sent. Tell the user ` +
        `it may not have gone out rather than claiming it did.`,
    };

    return { ok: false, summary: explanation[result.reason] };
  },
};

export const whatsappTools: AgentTool[] = [proposeWhatsappNudgeTool];
