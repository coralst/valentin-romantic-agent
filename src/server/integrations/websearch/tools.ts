import type { AgentTool } from '../tool-registry';
import { MAX_RESULTS, readPage, webSearch } from './client';

/**
 * The open web, as two read-only tools.
 *
 * Everything else Valentin can call is a catalogue with edges — Ontopo knows
 * restaurants, Wolt knows shops, Places knows a radius. These two exist so an
 * *idea* can come from anywhere: a listicle of hidden beaches, a museum's
 * late-night opening, a pop-up nobody has an API for. One tool finds candidates,
 * the other reads the details; neither can book, buy, or submit anything, which
 * is why neither needs a confirmation card.
 */

export const searchWebTool: AgentTool = {
  name: 'search_web',
  description:
    'Search the open web. Use this freely and creatively — for date ideas beyond ' +
    'the built-in catalogues, local events and festivals, seasonal activities, ' +
    '"best of" articles, opening hours, anything the specialised tools cannot ' +
    'answer. Returns result titles, URLs and snippets (and sometimes a short ' +
    'synthesised answer). Snippets are teasers: use read_webpage on a promising ' +
    'result to get the actual details before recommending it.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'What to search for, as you would type it into a search engine, e.g. ' +
          '"unusual romantic date ideas Tel Aviv autumn 2026".',
      },
      max_results: {
        type: 'number',
        description: `How many results. Defaults to ${MAX_RESULTS}, which is also the cap.`,
      },
      topic: {
        type: 'string',
        description: 'Either "general" (default) or "news" for current events.',
      },
    },
    required: ['query'],
  },
  service: 'web-search',
  requiresConfirmation: false,
  async execute(input) {
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    if (!query) {
      return { ok: false, summary: 'search_web needs a query. Ask what to look for.' };
    }
    const maxResults =
      typeof input.max_results === 'number' && input.max_results > 0
        ? Math.round(input.max_results)
        : MAX_RESULTS;
    const topic = input.topic === 'news' ? 'news' : 'general';

    const found = await webSearch(query, { maxResults, topic });
    if (!found) {
      return {
        ok: false,
        summary:
          `The web search for "${query}" did not answer — say you could not search the ` +
          `web right now and work from what you already know instead. Do not invent results.`,
      };
    }

    const lines = found.results
      .map((r, i) => `${i + 1}. ${r.title} — ${r.url}${r.snippet ? ` — ${r.snippet}` : ''}`)
      .join(' | ');
    return {
      ok: true,
      summary:
        (found.answer ? `${found.answer} ` : '') +
        `${found.results.length} result(s): ${lines}. ` +
        `Use read_webpage on a URL for details before promising anything from a snippet.`,
      data: { query, source: found.source, answer: found.answer, results: found.results },
    };
  },
};

export const readWebpageTool: AgentTool = {
  name: 'read_webpage',
  description:
    'Read a web page and return its text. Use it on a search_web result, or on a ' +
    'link the user shared, to get concrete details — event dates, menus, prices, ' +
    'opening hours — before recommending something. Read-only: it never fills ' +
    'forms or buys anything.',
  input_schema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The full http(s) URL to read, exactly as search_web returned it.',
      },
    },
    required: ['url'],
  },
  service: 'web-search',
  requiresConfirmation: false,
  async execute(input) {
    const raw = typeof input.url === 'string' ? input.url.trim() : '';
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return { ok: false, summary: `"${raw}" is not a valid URL. Use one from search_web.` };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, summary: 'Only http(s) pages can be read.' };
    }

    const page = await readPage(url.toString());
    if (!page) {
      return {
        ok: false,
        summary:
          `Could not read ${url.hostname} — the page did not answer or had no readable ` +
          `text. Say so and rely on the search snippet, or try another result.`,
      };
    }
    return {
      ok: true,
      summary: `Text of ${url.hostname} (truncated): ${page.text}`,
      data: { url: page.url, source: page.source },
    };
  },
};

export const webSearchTools: readonly AgentTool[] = [searchWebTool, readWebpageTool];
