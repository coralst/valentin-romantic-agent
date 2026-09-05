/**
 * Transport for the open web — the tier that lets Valentin be creative beyond
 * its service catalogues.
 *
 * Every other integration answers a specific question (a table, a florist, a
 * flight). This one answers "what's out there?": events, articles, "best hidden
 * picnic spots" lists — the raw material for an idea none of the specialised
 * tools would ever surface.
 *
 * ## Two tiers, one shape
 *
 * - **Tavily** (`TAVILY_API_KEY` set): an LLM-oriented search API. `/search`
 *   returns clean snippets, `/extract` returns readable page text. One key,
 *   both calls.
 * - **Keyless HTML results** (always available): a plain `fetch` against a
 *   search engine's server-rendered results page — DuckDuckGo first, Bing when
 *   DDG serves its bot challenge (a 202, which some networks always get). No
 *   key, no JavaScript, no Chromium. This is the free fallback whenever Tavily
 *   is unconfigured, times out, or answers with a quota error — so the
 *   capability never goes dark, it only gets worse.
 *
 * Both tiers normalise to the same {@link WebSearchResult} shape and mark which
 * one answered, so `tools.ts` and the model never care.
 *
 * ## What this deliberately does not do
 *
 * Nothing here writes anything anywhere. Search and read are the whole surface;
 * there is no form-filling, no login, no checkout. Results are handed to the
 * model with their URLs so a human can always see the source.
 */

import { config } from '../../config';
import { logger } from '../../logging';
import { browserReadyCached, fetchRendered } from '../browser/session';

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const TAVILY_EXTRACT_URL = 'https://api.tavily.com/extract';
const DDG_HTML_URL = 'https://html.duckduckgo.com/html/';
const BING_URL = 'https://www.bing.com/search';

const TIMEOUT_MS = 8_000;

/** Web results go stale slowly; 15 minutes just stops a chatty loop re-paying. */
const SEARCH_TTL_MS = 15 * 60_000;
const PAGE_TTL_MS = 15 * 60_000;

/** Enough to choose from, few enough to read. Matches Wolt and Places. */
export const MAX_RESULTS = 5;

/**
 * Page text handed to the model is capped hard. A page can be megabytes; the
 * model context and the 512MB task both pay for every byte, and nothing below
 * this line was going to change the answer.
 */
const MAX_PAGE_CHARS = 6_000;

/**
 * The same plausible desktop UA the browser tier presents, for the same reason:
 * DuckDuckGo's HTML endpoint and many content sites answer a bare `node` UA
 * with an empty shell or a consent wall. Everything read here is a public page.
 */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchAnswer {
  /** Which tier actually answered — the honesty bit the panel and tests read. */
  source: 'tavily' | 'duckduckgo' | 'bing';
  /** Tavily's one-paragraph synthesis, when it gave one. */
  answer: string | null;
  results: WebSearchResult[];
}

export interface WebPageText {
  source: 'tavily' | 'fetch' | 'browser';
  url: string;
  text: string;
}

interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
}

const searchCache = new Map<string, CacheEntry<WebSearchAnswer>>();
const pageCache = new Map<string, CacheEntry<WebPageText>>();

function fresh<T>(entry: CacheEntry<T> | undefined, ttlMs: number): T | null {
  if (!entry) return null;
  return Date.now() - entry.fetchedAt < ttlMs ? entry.value : null;
}

export function resetWebSearchCacheForTests(): void {
  searchCache.clear();
  pageCache.clear();
}

function tavilyKey(): string | null {
  const key = config.integrations.tavilyApiKey;
  return typeof key === 'string' && key.trim() ? key.trim() : null;
}

/**
 * POST JSON, return parsed JSON or null. Never throws: an HTTP error or a
 * transport fault is logged once and becomes `null`, so callers distinguish
 * "could not ask" from "asked, nothing there" and fall to the next tier.
 */
async function postJson(url: string, body: unknown, key: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      // 429/432 are Tavily quota answers — the exact case the free tier exists
      // for, so this is a warn, not an error.
      logger.warn('integration.web-search.http', { url, status: response.status });
      return null;
    }
    return (await response.json()) as unknown;
  } catch (error) {
    logger.warn('integration.web-search.http', {
      url,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}

/** Tavily `/search`, normalised. Null means "try the free tier". */
async function tavilySearch(
  query: string,
  maxResults: number,
  topic: 'general' | 'news',
): Promise<WebSearchAnswer | null> {
  const key = tavilyKey();
  if (!key) return null;

  const parsed = await postJson(
    TAVILY_SEARCH_URL,
    {
      query,
      max_results: maxResults,
      topic,
      search_depth: 'basic',
      include_answer: true,
    },
    key,
  );
  if (!parsed || typeof parsed !== 'object') return null;

  const raw = parsed as { answer?: unknown; results?: unknown };
  const rows = Array.isArray(raw.results) ? raw.results : [];
  const results: WebSearchResult[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as { title?: unknown; url?: unknown; content?: unknown };
    if (typeof item.url !== 'string' || !item.url) continue;
    results.push({
      title: typeof item.title === 'string' ? item.title : item.url,
      url: item.url,
      snippet: typeof item.content === 'string' ? item.content.slice(0, 500) : '',
    });
    if (results.length >= maxResults) break;
  }
  if (results.length === 0) return null;

  return {
    source: 'tavily',
    answer: typeof raw.answer === 'string' && raw.answer.trim() ? raw.answer.trim() : null,
    results,
  };
}

/** Tavily `/extract` for one URL. Null means "read it ourselves". */
async function tavilyExtract(url: string): Promise<string | null> {
  const key = tavilyKey();
  if (!key) return null;

  const parsed = await postJson(TAVILY_EXTRACT_URL, { urls: [url] }, key);
  if (!parsed || typeof parsed !== 'object') return null;

  const raw = parsed as { results?: unknown };
  const rows = Array.isArray(raw.results) ? raw.results : [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as { raw_content?: unknown };
    if (typeof item.raw_content === 'string' && item.raw_content.trim()) {
      return item.raw_content;
    }
  }
  return null;
}

/** Minimal entity decoding — the handful DDG's markup actually emits. */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * DDG result links are redirect wrappers (`//duckduckgo.com/l/?uddg=<real>`).
 * Handing the model a tracking redirect would make `read_webpage` read DDG's
 * bounce page, so the real URL is unwrapped here.
 */
function unwrapDdgHref(href: string): string | null {
  const absolute = href.startsWith('//') ? `https:${href}` : href;
  try {
    const url = new URL(absolute);
    if (url.hostname.endsWith('duckduckgo.com') && url.pathname.startsWith('/l/')) {
      const real = url.searchParams.get('uddg');
      return real ? decodeURIComponent(real) : null;
    }
    return url.protocol === 'http:' || url.protocol === 'https:' ? absolute : null;
  } catch {
    return null;
  }
}

/**
 * The free tier: parse DuckDuckGo's server-rendered HTML results page.
 *
 * A regex parser over two stable class names (`result__a`, `result__snippet`)
 * rather than a DOM library: the page is flat, the classes have been stable for
 * years, and when they do change the failure is an honest empty result — which
 * the tool reports as "the web is unreachable", never an invented answer.
 */
export async function ddgSearch(
  query: string,
  maxResults: number,
): Promise<WebSearchAnswer | null> {
  let html: string;
  try {
    const response = await fetch(`${DDG_HTML_URL}?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn('integration.web-search.http', { url: DDG_HTML_URL, status: response.status });
      return null;
    }
    html = await response.text();
  } catch (error) {
    logger.warn('integration.web-search.http', {
      url: DDG_HTML_URL,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }

  const results: WebSearchResult[] = [];
  const anchorRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const snippets: string[] = [];
  for (let m = snippetRe.exec(html); m; m = snippetRe.exec(html)) {
    snippets.push(stripTags(m[1]));
  }
  let index = 0;
  for (let m = anchorRe.exec(html); m && results.length < maxResults; m = anchorRe.exec(html)) {
    const url = unwrapDdgHref(decodeEntities(m[1]));
    const title = stripTags(m[2]);
    if (url && title) {
      results.push({ title, url, snippet: snippets[index] ?? '' });
    }
    index += 1;
  }

  return results.length ? { source: 'duckduckgo', answer: null, results } : null;
}

/**
 * Bing wraps every organic result in a `/ck/a` click-tracking redirect whose
 * `u` parameter is the real URL, base64url-encoded behind an `a1` prefix.
 * Handing the model the wrapper would make `read_webpage` read a redirect, so
 * it is decoded here; a wrapper that will not decode is dropped, not guessed at.
 */
function unwrapBingHref(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.hostname.endsWith('bing.com') && url.pathname.startsWith('/ck/')) {
      const packed = url.searchParams.get('u');
      if (!packed?.startsWith('a1')) return null;
      const b64 = packed.slice(2).replace(/-/g, '+').replace(/_/g, '/');
      const real = Buffer.from(b64, 'base64').toString('utf8');
      return /^https?:\/\//.test(real) ? real : null;
    }
    return url.protocol === 'http:' || url.protocol === 'https:' ? href : null;
  } catch {
    return null;
  }
}

/**
 * The second keyless engine, for networks where DuckDuckGo's challenge fires.
 * Same contract as {@link ddgSearch}: two stable markers (`b_algo` rows, `<h2>`
 * anchors), an honest null when the markup stops matching.
 */
export async function bingSearch(
  query: string,
  maxResults: number,
): Promise<WebSearchAnswer | null> {
  let html: string;
  try {
    const response = await fetch(`${BING_URL}?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn('integration.web-search.http', { url: BING_URL, status: response.status });
      return null;
    }
    html = await response.text();
  } catch (error) {
    logger.warn('integration.web-search.http', {
      url: BING_URL,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }

  const results: WebSearchResult[] = [];
  const rows = html.split(/<li class="b_algo[^"]*"/).slice(1);
  for (const row of rows) {
    if (results.length >= maxResults) break;
    const anchor = /<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(row);
    if (!anchor) continue;
    const url = unwrapBingHref(decodeEntities(anchor[1]));
    const title = stripTags(anchor[2]);
    if (!url || !title) continue;
    const caption = /<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(row);
    results.push({ title, url, snippet: caption ? stripTags(caption[1]).slice(0, 500) : '' });
  }

  return results.length ? { source: 'bing', answer: null, results } : null;
}

/**
 * Search the open web: Tavily when a key is present and answering, then the
 * keyless engines in order. Null only when every tier failed — the tool then
 * tells the model the web is unreachable right now, in as many words.
 */
export async function webSearch(
  query: string,
  opts: { maxResults?: number; topic?: 'general' | 'news' } = {},
): Promise<WebSearchAnswer | null> {
  const maxResults = Math.min(Math.max(opts.maxResults ?? MAX_RESULTS, 1), MAX_RESULTS);
  const topic = opts.topic === 'news' ? 'news' : 'general';
  const cacheKey = `${topic}:${maxResults}:${query.trim().toLowerCase()}`;

  const cached = fresh(searchCache.get(cacheKey), SEARCH_TTL_MS);
  if (cached) return cached;

  const answer =
    (await tavilySearch(query, maxResults, topic)) ??
    (await ddgSearch(query, maxResults)) ??
    (await bingSearch(query, maxResults));
  if (answer) searchCache.set(cacheKey, { value: answer, fetchedAt: Date.now() });
  return answer;
}

/** Plain fetch + tag-strip. The zero-dependency way to read a static page. */
async function plainReadPage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!response.ok) {
      logger.warn('integration.web-search.http', { url, status: response.status });
      return null;
    }
    const html = await response.text();
    const withoutScripts = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ');
    return stripTags(withoutScripts);
  } catch (error) {
    logger.warn('integration.web-search.http', {
      url,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}

/**
 * Below this, a "page" is almost certainly a client-rendered shell — worth one
 * retry through the browser tier where Chromium exists.
 */
const EMPTY_SHELL_CHARS = 200;

/**
 * Read a page as text: Tavily Extract first (clean, works everywhere), then a
 * plain fetch, then — for client-rendered shells, and only where Chromium is
 * actually installed — one rendered pass through the shared browser tier.
 */
export async function readPage(url: string): Promise<WebPageText | null> {
  const cached = fresh(pageCache.get(url), PAGE_TTL_MS);
  if (cached) return cached;

  let result: WebPageText | null = null;

  const extracted = await tavilyExtract(url);
  if (extracted && extracted.trim().length >= EMPTY_SHELL_CHARS) {
    result = { source: 'tavily', url, text: extracted.trim().slice(0, MAX_PAGE_CHARS) };
  }

  if (!result) {
    const plain = await plainReadPage(url);
    if (plain && plain.length >= EMPTY_SHELL_CHARS) {
      result = { source: 'fetch', url, text: plain.slice(0, MAX_PAGE_CHARS) };
    } else if (browserReadyCached()) {
      try {
        const rendered = await fetchRendered(url, { waitMs: 1_000 });
        const text = stripTags(
          rendered
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' '),
        );
        if (text.length >= EMPTY_SHELL_CHARS) {
          result = { source: 'browser', url, text: text.slice(0, MAX_PAGE_CHARS) };
        }
      } catch (error) {
        logger.warn('integration.web-search.render', {
          url,
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
    // A tiny plain-fetch result with no browser available is still better than
    // nothing — hand it over rather than claiming the page was unreadable.
    if (!result && plain && plain.length > 0) {
      result = { source: 'fetch', url, text: plain.slice(0, MAX_PAGE_CHARS) };
    }
  }

  if (result) pageCache.set(url, { value: result, fetchedAt: Date.now() });
  return result;
}
