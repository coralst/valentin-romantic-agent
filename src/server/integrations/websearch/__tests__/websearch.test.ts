import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { config } from '../../../config';
import { bingSearch, ddgSearch, readPage, resetWebSearchCacheForTests, webSearch } from '../client';
import { readWebpageTool, searchWebTool } from '../tools';
import { runTool } from '../../tool-registry';

/**
 * Web search, with `fetch` stubbed.
 *
 * Two fixtures, one per tier, both trimmed from real responses with field names
 * kept verbatim — Tavily is documented but the DuckDuckGo HTML page is not, so
 * the markup fixture is the only defence against a class rename there.
 */

const CTX = { sessionId: 'websearch-test', userId: 'user-1' };

/** Trimmed from a real POST https://api.tavily.com/search response. */
const TAVILY_SEARCH = {
  query: 'romantic date ideas tel aviv',
  answer: 'Tel Aviv offers rooftop bars, the old Jaffa port at sunset, and night markets.',
  results: [
    {
      title: '15 Romantic Things to Do in Tel Aviv',
      url: 'https://example.com/tel-aviv-romance',
      content: 'From sunset at Jaffa port to the HaTachana night market...',
      score: 0.98,
    },
    {
      title: 'Tel Aviv Date Night Guide',
      url: 'https://example.com/date-night',
      content: 'Rooftop cocktails, beach picnics and late museum nights.',
      score: 0.91,
    },
  ],
  response_time: 1.2,
};

/** Trimmed from a real POST https://api.tavily.com/extract response. */
const TAVILY_EXTRACT = {
  results: [
    {
      url: 'https://example.com/tel-aviv-romance',
      raw_content:
        'Jaffa port at golden hour is the classic. The flea market stays lively until late. ' +
        'x'.repeat(300),
    },
  ],
  failed_results: [],
};

/**
 * Trimmed from a real html.duckduckgo.com/html results page: the `result__a`
 * anchor with its `uddg` redirect wrapper, and the `result__snippet` anchor.
 */
const DDG_HTML = `
<div class="results">
  <div class="result results_links results_links_deep web-result">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fstargazing&amp;rut=abc123">Stargazing spots near <b>Tel Aviv</b></a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fstargazing">The Negev has the darkest skies within a two hour <b>drive</b>.</a>
  </div>
  <div class="result results_links results_links_deep web-result">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="https://example.com/picnic">Hidden picnic spots</a>
    </h2>
    <a class="result__snippet" href="https://example.com/picnic">Seven quiet parks locals keep to themselves.</a>
  </div>
</div>`;

/**
 * Trimmed from a real bing.com/search results page: the `b_algo` row, the `<h2>`
 * anchor wrapped in the `/ck/a` click redirect (`u=a1<base64url>`), and the
 * `b_lineclamp` caption paragraph.
 */
const BING_HTML = `
<ol id="b_results">
  <li class="b_algo" data-id="1">
    <h2 class=""><a target="_blank" href="https://www.bing.com/ck/a?!&amp;&amp;p=abc123&amp;u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9zdGFyZ2F6aW5n&amp;ntb=1">Stargazing spots near <strong>Tel Aviv</strong></a></h2>
    <div class="b_caption"><p class="b_lineclamp3">The Negev has the darkest skies within a two hour drive.</p></div>
  </li>
</ol>`;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function htmlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' } });
}

const originalTavilyKey = config.integrations.tavilyApiKey;

beforeEach(() => {
  resetWebSearchCacheForTests();
  config.integrations.tavilyApiKey = undefined;
});

afterEach(() => {
  config.integrations.tavilyApiKey = originalTavilyKey;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('webSearch', () => {
  it('answers from Tavily when a key is present', async () => {
    config.integrations.tavilyApiKey = 'tvly-test';
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(TAVILY_SEARCH)));

    const found = await webSearch('romantic date ideas tel aviv');
    expect(found?.source).toBe('tavily');
    expect(found?.answer).toContain('rooftop bars');
    expect(found?.results).toHaveLength(2);
    expect(found?.results[0].url).toBe('https://example.com/tel-aviv-romance');
  });

  it('falls back to DuckDuckGo when no key is configured', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL) => htmlResponse(DDG_HTML));
    vi.stubGlobal('fetch', fetchMock);

    const found = await webSearch('stargazing near tel aviv');
    expect(found?.source).toBe('duckduckgo');
    // The redirect wrapper is unwrapped to the real destination.
    expect(found?.results[0].url).toBe('https://example.com/stargazing');
    expect(found?.results[0].title).toContain('Stargazing spots');
    expect(found?.results[1].url).toBe('https://example.com/picnic');
    // Only DDG was called — Tavily must not be tried with no key.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('duckduckgo.com');
  });

  it('falls back to DuckDuckGo when Tavily answers with a quota error', async () => {
    config.integrations.tavilyApiKey = 'tvly-test';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) =>
        String(url).includes('tavily') ? new Response('', { status: 429 }) : htmlResponse(DDG_HTML),
      ),
    );

    const found = await webSearch('stargazing near tel aviv');
    expect(found?.source).toBe('duckduckgo');
    expect(found?.results.length).toBeGreaterThan(0);
  });

  it('returns null when both tiers fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('network down'))));
    expect(await webSearch('anything')).toBeNull();
  });

  it('caches a search so a repeat does not refetch', async () => {
    const fetchMock = vi.fn(async () => htmlResponse(DDG_HTML));
    vi.stubGlobal('fetch', fetchMock);

    await webSearch('stargazing near tel aviv');
    await webSearch('stargazing near tel aviv');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('ddgSearch', () => {
  it('returns null on markup it cannot read, never an invented result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse('<html><body>consent wall</body></html>')));
    expect(await ddgSearch('anything', 5)).toBeNull();
  });
});

describe('bingSearch', () => {
  it('parses b_algo rows and decodes the /ck/a redirect wrapper', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(BING_HTML)));

    const found = await bingSearch('stargazing near tel aviv', 5);
    expect(found?.source).toBe('bing');
    expect(found?.results[0].url).toBe('https://example.com/stargazing');
    expect(found?.results[0].title).toContain('Stargazing');
    expect(found?.results[0].snippet).toContain('darkest skies');
  });

  it('is the last free tier: DDG challenged (202) falls through to Bing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) =>
        String(url).includes('duckduckgo')
          ? new Response('challenge', { status: 202 })
          : htmlResponse(BING_HTML),
      ),
    );

    const found = await webSearch('stargazing near tel aviv');
    expect(found?.source).toBe('bing');
    expect(found?.results.length).toBeGreaterThan(0);
  });
});

describe('readPage', () => {
  it('uses Tavily Extract when keyed', async () => {
    config.integrations.tavilyApiKey = 'tvly-test';
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(TAVILY_EXTRACT)));

    const page = await readPage('https://example.com/tel-aviv-romance');
    expect(page?.source).toBe('tavily');
    expect(page?.text).toContain('Jaffa port at golden hour');
  });

  it('falls back to a plain fetch and strips markup', async () => {
    const body =
      '<html><head><style>.x{color:red}</style><script>var a=1;</script></head>' +
      `<body><h1>Open air cinema</h1><p>Screenings every Thursday at sunset. ${'y '.repeat(200)}</p></body></html>`;
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(body)));

    const page = await readPage('https://example.com/cinema');
    expect(page?.source).toBe('fetch');
    expect(page?.text).toContain('Open air cinema');
    expect(page?.text).not.toContain('color:red');
    expect(page?.text).not.toContain('var a=1');
  });

  it('returns null when the page cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('refused'))));
    expect(await readPage('https://example.com/gone')).toBeNull();
  });
});

describe('search_web tool', () => {
  it('summarises results with their URLs and points at read_webpage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(DDG_HTML)));

    const result = await runTool(searchWebTool, { query: 'stargazing near tel aviv' }, CTX);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('https://example.com/stargazing');
    expect(result.summary).toContain('read_webpage');
    const data = result.data as { source: string; results: unknown[] };
    expect(data.source).toBe('duckduckgo');
    expect(data.results).toHaveLength(2);
  });

  it('tells the model not to invent results when the web is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('network down'))));

    const result = await runTool(searchWebTool, { query: 'anything' }, CTX);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('Do not invent results');
  });

  it('refuses an empty query', async () => {
    const result = await runTool(searchWebTool, {}, CTX);
    expect(result.ok).toBe(false);
  });
});

describe('read_webpage tool', () => {
  it('hands back page text', async () => {
    config.integrations.tavilyApiKey = 'tvly-test';
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(TAVILY_EXTRACT)));

    const result = await runTool(
      readWebpageTool,
      { url: 'https://example.com/tel-aviv-romance' },
      CTX,
    );
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Jaffa port at golden hour');
  });

  it('rejects a non-http URL without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await runTool(readWebpageTool, { url: 'file:///etc/passwd' }, CTX);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an unreadable page honestly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('refused'))));

    const result = await runTool(readWebpageTool, { url: 'https://example.com/gone' }, CTX);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('example.com');
  });
});
