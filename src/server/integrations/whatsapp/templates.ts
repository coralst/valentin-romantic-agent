/**
 * The message templates Valentin may send, and what each one says.
 *
 * ## Why templates at all
 *
 * WhatsApp does not let a business start a conversation with free text. A
 * business-initiated message outside the 24-hour customer-service window — and
 * every message Valentin sends is business-initiated, because nobody messages
 * Valentin first — must use a template that Meta approved in advance. Sending a
 * `text` message instead returns error 131047 and nothing arrives.
 *
 * That is the whole reason this file exists and is checked in rather than being a
 * string built at call time. **The text below is the contract**: it must match
 * what was submitted for approval, character for character apart from the
 * `{{n}}` placeholders, or the send fails. Editing the prose here without
 * re-submitting the template silently breaks the integration.
 *
 * ## Approval is the long-lead item
 *
 * Template review takes minutes to days, and a Meta business account with a
 * verified number is a prerequisite. Until both exist, `propose_whatsapp_nudge`
 * will propose happily and fail at confirm — which is why the failure path is
 * written to say so specifically rather than "something went wrong".
 *
 * ## Why there is no free-text template
 *
 * The obvious shortcut is one template whose entire body is `{{1}}`, turning the
 * approval into a formality. Meta rejects those on review, and rightly: it is a
 * way of getting the permission without accepting the constraint. Each template
 * below therefore carries real fixed prose and takes only the parameters that
 * genuinely vary.
 */

/** A parameter a template needs, in the order `{{1}}`, `{{2}}`, … expects. */
export interface TemplateParam {
  /** The key the tool's `params` object must supply. */
  key: string;
  /** What it holds, for the tool description the model reads. */
  description: string;
}

export interface WhatsappTemplate {
  /** The name registered with Meta. Lower snake case is their convention. */
  name: string;
  /**
   * Language the template was approved in.
   *
   * Approval is per language, so this is not a preference — a template approved
   * as `en` cannot be sent as `he`. A Hebrew version is a separate submission.
   */
  language: string;
  /** The approved body, with `{{n}}` placeholders. Must match Meta exactly. */
  body: string;
  params: TemplateParam[];
}

export const WHATSAPP_TEMPLATES: readonly WhatsappTemplate[] = [
  {
    name: 'valentin_occasion_reminder',
    language: 'en',
    body: 'A quiet reminder: {{1}} is on {{2}}. Would you like me to start planning something?',
    params: [
      { key: 'occasion', description: 'What the occasion is, e.g. "your anniversary"' },
      { key: 'date', description: 'When it falls, e.g. "Saturday 5 September"' },
    ],
  },
  {
    name: 'valentin_reservation_reminder',
    language: 'en',
    body: 'Your table at {{1}} is on {{2}} at {{3}}. Nothing to do — just a reminder.',
    params: [
      { key: 'venue', description: 'Restaurant name' },
      { key: 'date', description: 'Date, e.g. "Saturday 5 September"' },
      { key: 'time', description: 'Time, e.g. "20:30"' },
    ],
  },
  {
    name: 'valentin_plan_ready',
    language: 'en',
    body: 'I have put together an idea for {{1}}. Open Valentin when you have a moment and I will walk you through it.',
    params: [{ key: 'occasion', description: 'What the plan is for, e.g. "next Friday"' }],
  },
] as const;

export function templateByName(name: string): WhatsappTemplate | undefined {
  return WHATSAPP_TEMPLATES.find((template) => template.name === name);
}

/**
 * Fill the approved body for display on the confirmation card.
 *
 * This is *not* what gets sent — WhatsApp renders the template from its own copy
 * and takes only the parameters. It exists so the user can read the actual
 * sentence that will arrive on their phone before agreeing to send it, which is
 * the difference between confirming a message and confirming a template name.
 */
export function renderTemplate(
  template: WhatsappTemplate,
  values: readonly string[],
): string {
  return template.body.replace(/\{\{(\d+)\}\}/g, (match, index: string) => {
    const value = values[Number(index) - 1];
    return value === undefined ? match : value;
  });
}
