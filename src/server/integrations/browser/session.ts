import { logger } from '../../logging';

/**
 * The one headless browser this process drives, and the only way to get a page.
 *
 * Several capabilities have no usable API — event listings, cinema seat maps,
 * Ontopo's venue discovery since its search endpoints started returning 404 — so
 * they are read by driving a real page. That is a heavier and more fragile thing
 * than an HTTP call, and it needs a lifecycle:
 *
 * - **One browser, launched lazily.** Launching Chromium costs a second or two and
 *   ~100MB. Doing it per call would dominate every scrape; doing it at boot would
 *   pay for it on deployments that never scrape anything.
 * - **A page per call, always closed.** Pages leak memory and cookies into each
 *   other. A context per call also means one site's consent banner cannot affect
 *   the next.
 * - **A hard concurrency cap.** A page is tens of MB. The Fargate task has 512MB
 *   and also holds the model conversation; unbounded pages is how the container
 *   gets OOM-killed mid-demo, which looks like the agent hanging.
 * - **Idle shutdown.** A browser held open for the one scrape someone did an hour
 *   ago is memory nobody is using.
 *
 * ### Why the import is dynamic
 *
 * Playwright is a devDependency and Chromium is a ~150MB download, so a deployment
 * may legitimately not have either. A static import would make the whole server
 * fail to boot on such a deployment — for a capability it was never going to use.
 * Instead the import is attempted on first use and its failure is a *readiness*
 * answer: `browserReady()` returns false, the browser-backed tools are never
 * registered, and the panel draws the Browser node dark. That is the same
 * "absent rather than broken" contract every credential-gated integration follows.
 */

/** Minimal shapes, so this file needs no Playwright types at compile time. */
interface BrowserPage {
  goto(url: string, opts?: Record<string, unknown>): Promise<unknown>;
  content(): Promise<string>;
  title(): Promise<string>;
  waitForTimeout(ms: number): Promise<void>;
  route(pattern: string, handler: (route: PageRoute) => unknown): Promise<void>;
  locator(selector: string): {
    evaluateAll<T>(fn: (els: Element[]) => T): Promise<T>;
    first(): { innerText(): Promise<string>; isVisible(): Promise<boolean> };
  };
  evaluate<T>(fn: () => T): Promise<T>;
  url(): string;
}

interface PageRoute {
  request(): { resourceType(): string };
  abort(): Promise<void>;
  continue(): Promise<void>;
}

interface BrowserContext {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

interface BrowserHandle {
  newContext(opts?: Record<string, unknown>): Promise<BrowserContext>;
  close(): Promise<void>;
  isConnected(): boolean;
}

/** How long any single page operation may take before it is abandoned. */
const NAV_TIMEOUT_MS = 20_000;

/** Pages in flight at once. Two is enough to overlap two scrapes without risk. */
const MAX_CONCURRENT_PAGES = 2;

/** Close the browser after this long with nothing to do. */
const IDLE_SHUTDOWN_MS = 5 * 60_000;

/**
 * A plausible desktop user agent.
 *
 * Playwright's default announces HeadlessChrome, which a number of Israeli sites
 * answer with a consent wall or an empty shell. This is not evasion of a paywall
 * or a login — everything read here is a public page a visitor sees without
 * signing in — it is asking for the same HTML a person would be served.
 */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

let browser: BrowserHandle | null = null;
let launching: Promise<BrowserHandle | null> | null = null;
let inFlight = 0;
let idleTimer: NodeJS.Timeout | null = null;

/** Cached across calls: a missing Chromium will still be missing next time. */
let unavailableReason: string | null = null;

/**
 * Load Playwright, whichever package provides it here.
 *
 * `playwright` is the right runtime dependency; `@playwright/test` is what this
 * repo has for e2e and re-exports the same `chromium`. Trying both means the
 * browser tier works in development without forcing a second copy of a large
 * dependency into the image before anyone has decided to ship it.
 */
async function loadChromium(): Promise<{ launch(opts: unknown): Promise<BrowserHandle> } | null> {
  for (const moduleName of ['playwright', '@playwright/test']) {
    try {
      const mod = (await import(moduleName)) as {
        chromium?: { launch(opts: unknown): Promise<BrowserHandle> };
      };
      if (mod.chromium) return mod.chromium;
    } catch {
      // Not installed under this name — try the next.
    }
  }
  return null;
}

function armIdleShutdown(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (inFlight === 0) void closeBrowser('idle');
  }, IDLE_SHUTDOWN_MS);
  // Do not hold the process open just to close a browser later.
  idleTimer.unref?.();
}

async function getBrowser(): Promise<BrowserHandle | null> {
  if (browser?.isConnected()) return browser;
  if (unavailableReason) return null;
  // Concurrent first calls must not launch two browsers.
  if (launching) return launching;

  launching = (async () => {
    const chromium = await loadChromium();
    if (!chromium) {
      unavailableReason = 'Playwright is not installed in this deployment';
      logger.warn('browser.unavailable', { cause: unavailableReason });
      return null;
    }
    try {
      const launched = await chromium.launch({
        args: [
          // Required in a container: Chromium's sandbox needs privileges a task
          // definition does not grant, and without this it exits immediately.
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
      logger.info('browser.launched', {});
      browser = launched;
      return launched;
    } catch (err) {
      // Almost always "Executable doesn't exist" — the package is present but
      // `playwright install chromium` was never run. A readiness answer, not a
      // crash.
      unavailableReason = err instanceof Error ? err.message : String(err);
      logger.warn('browser.unavailable', { cause: unavailableReason.slice(0, 200) });
      return null;
    } finally {
      launching = null;
    }
  })();

  return launching;
}

async function closeBrowser(why: string): Promise<void> {
  const handle = browser;
  browser = null;
  if (!handle) return;
  try {
    await handle.close();
    logger.info('browser.closed', { why });
  } catch {
    // A browser that will not close is already gone for our purposes.
  }
}

/** Whether a page can actually be opened here. Cheap after the first call. */
export async function browserReady(): Promise<boolean> {
  const ok = (await getBrowser()) !== null;
  readinessCache = ok;
  return ok;
}

/**
 * The last known answer to "can this deployment open a page", without waiting.
 *
 * `integrationReadiness()` is synchronous and read on every `GET /api/integrations`,
 * while finding out whether Chromium exists means trying to launch it — a second or
 * two, once. Making the whole readiness chain async to accommodate that would ripple
 * through the registry, both server entry points and their tests, to answer a
 * question whose value changes at most once per process.
 *
 * So the truth is cached and {@link probeBrowserReadiness} fills it at boot. Before
 * that lands this reports `false`, which is the right way to be wrong: a panel that
 * briefly says a capability is unavailable and then lights up is honest, where one
 * that claims availability it has not verified is not.
 */
let readinessCache = false;

export function browserReadyCached(): boolean {
  return readinessCache;
}

/**
 * Work out whether the browser is usable, and cache it.
 *
 * Called once at startup. Deliberately launches and closes rather than only
 * checking that the package imports: a present package with no downloaded browser
 * binary is the most common broken state, and only a launch attempt distinguishes
 * it.
 */
export async function probeBrowserReadiness(): Promise<boolean> {
  const ok = await browserReady();
  if (ok) {
    // Nothing is queued behind this probe, so hand the memory straight back. The
    // first real scrape will relaunch, paying the second it costs then.
    await closeBrowser('probe-complete');
  }
  logger.info('browser.readiness', {
    ready: ok,
    ...(ok ? {} : { cause: (unavailableReason ?? 'unknown').slice(0, 200) }),
  });
  return ok;
}

/** Why the browser is unavailable, for a log or a status line. Never a stack. */
export function browserUnavailableReason(): string | null {
  return unavailableReason;
}

/** Drop cached state so a test — or a retry after installing Chromium — starts clean. */
export async function resetBrowserForTests(): Promise<void> {
  unavailableReason = null;
  readinessCache = false;
  await closeBrowser('reset');
}

export class BrowserBusyError extends Error {
  readonly code = 'BROWSER_BUSY';
  constructor() {
    super('The browser is already handling as much as it can right now');
    this.name = 'BrowserBusyError';
  }
}

export class BrowserUnavailableError extends Error {
  readonly code = 'BROWSER_UNAVAILABLE';
  constructor(reason: string) {
    super(reason);
    this.name = 'BrowserUnavailableError';
  }
}

/**
 * Open a page, hand it to `visit`, and close it whatever happens.
 *
 * Images, fonts, media and stylesheets are aborted before they are fetched. Every
 * caller here reads text or hrefs out of the DOM, so a megabyte of hero imagery is
 * pure latency — this typically halves the time a scrape takes and cuts the
 * bandwidth by an order of magnitude. Scripts are *not* blocked: the sites worth
 * reading render their content client-side, and blocking JS would leave an empty
 * shell.
 */
export async function withPage<T>(
  visit: (page: BrowserPage) => Promise<T>,
): Promise<T> {
  const handle = await getBrowser();
  if (!handle) {
    throw new BrowserUnavailableError(
      unavailableReason ?? 'No browser is available in this deployment',
    );
  }
  if (inFlight >= MAX_CONCURRENT_PAGES) throw new BrowserBusyError();

  inFlight += 1;
  if (idleTimer) clearTimeout(idleTimer);

  let context: BrowserContext | null = null;
  try {
    context = await handle.newContext({
      userAgent: USER_AGENT,
      locale: 'en-US',
      // Israeli sites serve local results off this, and every consumer of this
      // module is asking about Israel.
      timezoneId: 'Asia/Jerusalem',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    await page.route('**/*', async (route) => {
      const type = route.request().resourceType();
      if (type === 'image' || type === 'font' || type === 'media' || type === 'stylesheet') {
        await route.abort();
        return;
      }
      await route.continue();
    });

    return await visit(page);
  } finally {
    inFlight -= 1;
    if (context) {
      // Closing the context closes its pages. Swallowed because a failed cleanup
      // must not mask the error the caller is already handling.
      await context.close().catch(() => {});
    }
    armIdleShutdown();
  }
}

/** Load a URL and hand back its rendered HTML. The common case, in one call. */
export async function fetchRendered(
  url: string,
  opts: { waitMs?: number } = {},
): Promise<string> {
  return withPage(async (page) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    // Client-rendered lists need a beat after DOMContentLoaded before the items
    // exist. Deliberately a fixed pause rather than a selector wait: each site
    // this serves has different markup, and a per-site selector belongs in the
    // per-site module, not here.
    if (opts.waitMs) await page.waitForTimeout(opts.waitMs);
    return page.content();
  });
}

export const BROWSER_NAV_TIMEOUT_MS = NAV_TIMEOUT_MS;
export type { BrowserPage };
