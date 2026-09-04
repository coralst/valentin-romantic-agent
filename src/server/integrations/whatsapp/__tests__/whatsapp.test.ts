import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../../config';
import { normalisePhone, sendTemplate } from '../client';
import { WHATSAPP_TEMPLATES, renderTemplate, templateByName } from '../templates';
import { proposeWhatsappNudgeTool, whatsappTools } from '../tools';

/**
 * WhatsApp, with `fetch` stubbed.
 *
 * The assertions worth reading are the ones about the constraint rather than the
 * happy path: that no free-text message can be sent, that a template is never
 * sent with the prose rather than the parameters, and that each distinct failure
 * produces a distinct thing to say. The last one matters because "template not
 * approved" is a state a demo will genuinely be in.
 */

interface Call {
  url: string;
  method: string;
  body: string | null;
  headers: Record<string, string>;
}

let calls: Call[] = [];

function stubFetch(responder: () => { status: number; payload: unknown }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : null,
        headers: (init?.headers ?? {}) as Record<string, string>,
      });

      const { status, payload } = responder();
      return { ok: status < 400, status, json: async () => payload };
    }),
  );
}

function stubOk(): void {
  stubFetch(() => ({
    status: 200,
    payload: { messaging_product: 'whatsapp', messages: [{ id: 'wamid.ABC' }] },
  }));
}

const ctx = { sessionId: 'session-1', userId: 'user-1' };
const occasionTemplate = templateByName('valentin_occasion_reminder')!;

beforeEach(() => {
  calls = [];
  config.integrations.whatsappPhoneNumberId = '111222333';
  config.integrations.whatsappToken = 'EAAG-fake-token';
});

afterEach(() => {
  vi.unstubAllGlobals();
  config.integrations.whatsappPhoneNumberId = undefined;
  config.integrations.whatsappToken = undefined;
});

describe('normalisePhone', () => {
  it('drops the Israeli trunk zero and adds the country code', () => {
    // `9720501234567` — trunk zero kept — fails with an unhelpful error, so this
    // is the case that actually breaks in practice.
    expect(normalisePhone('050-123-4567')).toBe('972501234567');
    expect(normalisePhone('0501234567')).toBe('972501234567');
  });

  it('accepts an international number with or without a plus', () => {
    expect(normalisePhone('+972 50-123-4567')).toBe('972501234567');
    expect(normalisePhone('972501234567')).toBe('972501234567');
  });

  it('returns null rather than guessing at anything else', () => {
    // A wrong number means a stranger reads about someone's anniversary, so a
    // best-effort guess is the wrong default here.
    expect(normalisePhone('12345')).toBeNull();
    expect(normalisePhone('call me')).toBeNull();
    expect(normalisePhone('')).toBeNull();
  });
});

describe('templates', () => {
  it('has no template whose body is a single free parameter', () => {
    // A `{{1}}`-only template is how you get the permission without accepting the
    // constraint, and Meta rejects it on review.
    for (const template of WHATSAPP_TEMPLATES) {
      expect(template.body.replace(/\{\{\d+\}\}/g, '').trim().length).toBeGreaterThan(20);
    }
  });

  it('declares a parameter for every placeholder in its body, and no more', () => {
    for (const template of WHATSAPP_TEMPLATES) {
      const placeholders = new Set(template.body.match(/\{\{\d+\}\}/g) ?? []);
      expect(placeholders.size).toBe(template.params.length);
      for (let index = 1; index <= template.params.length; index += 1) {
        expect(template.body).toContain(`{{${index}}}`);
      }
    }
  });

  it('names a language, since approval is per language', () => {
    for (const template of WHATSAPP_TEMPLATES) expect(template.language).toBeTruthy();
  });

  it('fills placeholders in order', () => {
    expect(renderTemplate(occasionTemplate, ['your anniversary', 'Saturday 5 September'])).toBe(
      'A quiet reminder: your anniversary is on Saturday 5 September. Would you like me to start planning something?',
    );
  });

  it('leaves a placeholder alone when no value was supplied', () => {
    expect(renderTemplate(occasionTemplate, ['your anniversary'])).toContain('{{2}}');
  });
});

describe('sendTemplate', () => {
  it('posts a template message, never free text', async () => {
    stubOk();
    await sendTemplate('972501234567', occasionTemplate, ['your anniversary', 'Saturday']);

    const body = JSON.parse(calls[0].body!) as Record<string, unknown>;
    expect(body.type).toBe('template');
    expect(body.messaging_product).toBe('whatsapp');
    expect(body.to).toBe('972501234567');
    // A `text` body outside the 24-hour window fails with 131047 and nothing
    // arrives, so there is deliberately no code path that can produce one.
    expect(body.text).toBeUndefined();
  });

  it('sends the parameters, not the rendered prose', async () => {
    stubOk();
    await sendTemplate('972501234567', occasionTemplate, ['your anniversary', 'Saturday']);

    const body = JSON.parse(calls[0].body!) as {
      template: { name: string; language: { code: string }; components: Array<Record<string, unknown>> };
    };
    expect(body.template.name).toBe('valentin_occasion_reminder');
    expect(body.template.language.code).toBe('en');
    expect(body.template.components[0]).toEqual({
      type: 'body',
      parameters: [
        { type: 'text', text: 'your anniversary' },
        { type: 'text', text: 'Saturday' },
      ],
    });
  });

  it('hits the phone number id from config with a bearer token', async () => {
    stubOk();
    await sendTemplate('972501234567', occasionTemplate, ['a', 'b']);

    expect(calls[0].url).toBe('https://graph.facebook.com/v23.0/111222333/messages');
    expect(calls[0].headers.authorization).toBe('Bearer EAAG-fake-token');
  });

  it('reports the sentence that will have arrived', async () => {
    stubOk();
    const result = await sendTemplate('972501234567', occasionTemplate, ['your anniversary', 'Saturday']);

    expect(result).toMatchObject({
      ok: true,
      messageId: 'wamid.ABC',
      rendered: expect.stringContaining('your anniversary is on Saturday'),
    });
  });

  it('separates an unapproved template from any other refusal', async () => {
    stubFetch(() => ({ status: 400, payload: { error: { code: 132001, message: 'no such template' } } }));
    await expect(sendTemplate('972501234567', occasionTemplate, ['a', 'b'])).resolves.toEqual({
      ok: false,
      reason: 'template-not-approved',
    });

    calls = [];
    stubFetch(() => ({ status: 400, payload: { error: { code: 131026 } } }));
    await expect(sendTemplate('972501234567', occasionTemplate, ['a', 'b'])).resolves.toEqual({
      ok: false,
      reason: 'rejected',
    });
  });

  it('does not claim success when Graph returns no message id', async () => {
    stubFetch(() => ({ status: 200, payload: { messaging_product: 'whatsapp' } }));
    await expect(sendTemplate('972501234567', occasionTemplate, ['a', 'b'])).resolves.toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });

  it('reports not-configured without making a request', async () => {
    config.integrations.whatsappToken = undefined;
    stubOk();

    await expect(sendTemplate('972501234567', occasionTemplate, ['a', 'b'])).resolves.toEqual({
      ok: false,
      reason: 'not-configured',
    });
    expect(calls).toHaveLength(0);
  });
});

describe('propose_whatsapp_nudge', () => {
  const good = {
    to: '050-123-4567',
    template: 'valentin_occasion_reminder',
    params: { occasion: 'your anniversary', date: 'Saturday 5 September' },
  };

  it('proposes without sending', async () => {
    stubOk();
    const result = await proposeWhatsappNudgeTool.execute(good, ctx);

    expect(result.ok).toBe(true);
    expect(result.proposal?.service).toBe('whatsapp');
    expect(calls).toHaveLength(0);
  });

  it('shows the user the exact sentence that will arrive', async () => {
    stubOk();
    const result = await proposeWhatsappNudgeTool.execute(good, ctx);

    expect(result.proposal?.summary).toContain(
      'A quiet reminder: your anniversary is on Saturday 5 September.',
    );
    expect(result.proposal?.summary).toContain('Nothing is sent until you confirm');
  });

  it('normalises the number onto the payload and masks it in the title', async () => {
    stubOk();
    const result = await proposeWhatsappNudgeTool.execute(good, ctx);

    expect(result.proposal?.payload).toMatchObject({ phone: '972501234567' });
    expect(result.proposal?.title).toBe('WhatsApp to ••••4567');
    // The full number belongs on the card the user reads, so they can check it —
    // but not in the line the model repeats back into the conversation.
    expect(result.summary).not.toContain('972501234567');
  });

  it('refuses a number it cannot read', async () => {
    stubOk();
    const result = await proposeWhatsappNudgeTool.execute({ ...good, to: '12345' }, ctx);

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('a stranger gets a message');
    expect(result.proposal).toBeUndefined();
  });

  it('refuses an invented template and lists the real ones', async () => {
    stubOk();
    const result = await proposeWhatsappNudgeTool.execute({ ...good, template: 'valentin_free_text' }, ctx);

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('valentin_occasion_reminder');
  });

  it('names the parameters it is missing', async () => {
    stubOk();
    const result = await proposeWhatsappNudgeTool.execute(
      { ...good, params: { occasion: 'your anniversary' } },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('date');
  });

  it('flattens newlines out of a parameter', async () => {
    stubOk();
    const result = await proposeWhatsappNudgeTool.execute(
      { ...good, params: { occasion: 'your\n\nanniversary', date: 'Saturday' } },
      ctx,
    );

    // WhatsApp 400s on a parameter containing a newline, with no useful message.
    expect(result.proposal?.payload?.values).toEqual(['your anniversary', 'Saturday']);
  });

  it('lists the approved messages in its description, so the model cannot invent one', () => {
    for (const template of WHATSAPP_TEMPLATES) {
      expect(proposeWhatsappNudgeTool.description).toContain(template.name);
    }
  });
});

describe('propose_whatsapp_nudge confirm', () => {
  function proposal(payload: Record<string, unknown>) {
    return {
      id: 'p1',
      sessionId: 'session-1',
      service: 'whatsapp' as const,
      title: 't',
      summary: '',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      payload,
    };
  }

  const good = {
    phone: '972501234567',
    template: 'valentin_occasion_reminder',
    values: ['your anniversary', 'Saturday 5 September'],
  };

  it('sends on confirm and reports it once', async () => {
    stubOk();
    const result = await proposeWhatsappNudgeTool.confirm!(proposal(good), ctx);

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('••••4567');
    expect(calls).toHaveLength(1);
  });

  it('blames the setup, not the user, when the template is unapproved', async () => {
    stubFetch(() => ({ status: 400, payload: { error: { code: 132001 } } }));
    const result = await proposeWhatsappNudgeTool.confirm!(proposal(good), ctx);

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("not anything the user did");
  });

  it('offers the calendar instead when WhatsApp is not connected', async () => {
    config.integrations.whatsappToken = undefined;
    stubOk();
    const result = await proposeWhatsappNudgeTool.confirm!(proposal(good), ctx);

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('calendar');
  });

  it('says it may not have gone out when Graph does not confirm', async () => {
    stubFetch(() => ({ status: 200, payload: {} }));
    const result = await proposeWhatsappNudgeTool.confirm!(proposal(good), ctx);

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('may not have gone out');
  });

  it('fails closed on a payload that lost its template', async () => {
    stubOk();
    const result = await proposeWhatsappNudgeTool.confirm!(
      proposal({ phone: good.phone, values: good.values }),
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('fails closed on a template name that is no longer approved', async () => {
    stubOk();
    const result = await proposeWhatsappNudgeTool.confirm!(
      proposal({ ...good, template: 'valentin_removed' }),
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('registration', () => {
  it('exports one tool, and it writes', () => {
    expect(whatsappTools.map((tool) => tool.name)).toEqual(['propose_whatsapp_nudge']);
    expect(whatsappTools[0].requiresConfirmation).toBe(true);
    expect(typeof whatsappTools[0].confirm).toBe('function');
    expect(whatsappTools[0].service).toBe('whatsapp');
  });
});
