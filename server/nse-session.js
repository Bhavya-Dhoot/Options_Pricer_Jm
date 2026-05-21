/**
 * NSE Session Manager — Multi-symbol support
 *
 * Strategy:
 *   - NIFTY: Navigate to /option-chain → intercept XHR (fastest)
 *   - Other symbols: Navigate to /option-chain → wait for session →
 *     use page.evaluate(fetch()) to call API for the desired symbol
 *
 * The page context after loading /option-chain has all the Akamai
 * cookies (nsit, nseappid, bm_sv) needed for API calls. A direct
 * fetch() from within that context inherits those cookies.
 */

let browser = null;
let fetchInProgress = false;

const BASE_URL = 'https://www.nseindia.com';

const CHROME_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
  '--disable-gpu',
  '--no-zygote',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-sync',
  '--no-first-run',
  '--disable-translate',
  '--js-flags=--max-old-space-size=128',
  '--disable-software-rasterizer',
  '--disable-webgl',
  '--disable-accelerated-2d-canvas',
];

async function ensureBrowser() {
  if (browser) {
    try {
      await browser.version();
      return browser;
    } catch {
      console.warn('[NSE Session] Browser died — restarting...');
      browser = null;
    }
  }

  const puppeteer = await import('puppeteer');
  console.log('[NSE Session] Launching browser...');
  browser = await puppeteer.default.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: CHROME_ARGS,
  });
  console.log('[NSE Session] Browser launched');
  return browser;
}

async function createPage(br) {
  const page = await br.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
  });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  );
  await page.setViewport({ width: 800, height: 600 });
  await page.setCacheEnabled(false);

  // Block heavy resources
  await page.setRequestInterception(true);
  page.on('request', req => {
    const type = req.resourceType();
    if (['image', 'font', 'stylesheet', 'media', 'texttrack', 'manifest'].includes(type)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  return page;
}

export async function refreshSession() {
  try {
    await ensureBrowser();
    return true;
  } catch (err) {
    console.error('[NSE Session] Failed:', err.message);
    return false;
  }
}

/**
 * Fetch option chain for ANY symbol.
 *
 * For NIFTY (default on /option-chain):
 *   → Navigate, intercept XHR naturally
 *
 * For other symbols:
 *   → Navigate to /option-chain (establishes session)
 *   → Wait for page to load
 *   → Use page.evaluate(fetch()) to call the specific API endpoint
 *   → The page context has all Akamai cookies needed
 */
export async function nseApiFetch(path) {
  if (fetchInProgress) {
    throw new Error('A fetch is already in progress — try again shortly');
  }
  fetchInProgress = true;

  const symbolMatch = path.match(/symbol=(\w+)/);
  const symbol = symbolMatch ? symbolMatch[1] : 'NIFTY';
  const isDefaultSymbol = symbol === 'NIFTY';
  let page = null;

  try {
    const br = await ensureBrowser();
    page = await createPage(br);

    console.log(`[NSE API] Fetching ${symbol}${isDefaultSymbol ? ' (intercept)' : ' (evaluate)'}...`);

    if (isDefaultSymbol) {
      // ── NIFTY: intercept the natural XHR ──
      const data = await interceptOptionChain(page, symbol);
      return data;
    } else {
      // ── Other symbols: establish session, then fetch via evaluate ──
      const data = await evaluateFetch(page, path, symbol);
      return data;
    }

  } catch (err) {
    console.error(`[NSE API] ❌ ${symbol}: ${err.message}`);
    if (err.message.includes('Target closed') || err.message.includes('Session closed') || err.message.includes('Protocol error')) {
      console.warn('[NSE API] Browser died — will restart on next call');
      try { await browser?.close(); } catch { /* ignore */ }
      browser = null;
    }
    throw err;
  } finally {
    if (page) {
      try { await page.close(); } catch { /* ignore */ }
    }
    fetchInProgress = false;
  }
}

/**
 * Strategy 1: Navigate to /option-chain and intercept the NIFTY XHR.
 */
async function interceptOptionChain(page, symbol) {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        page.off('response', handler);
        reject(new Error(`Timed out waiting for ${symbol} data (30s)`));
      }
    }, 30000);

    const handler = async (response) => {
      if (resolved) return;
      try {
        const url = response.url();
        if (url.includes('/api/option-chain') && url.includes(symbol)) {
          const json = await response.json();
          if (json?.records) {
            resolved = true;
            clearTimeout(timeout);
            page.off('response', handler);
            console.log(
              `[NSE API] ✅ ${symbol}: spot=${json.records.underlyingValue}, ` +
              `${json.records.data?.length} strikes, ts=${json.records.timestamp}`
            );
            resolve(json);
          }
        }
      } catch { /* ignore */ }
    };

    page.on('response', handler);

    page.goto(`${BASE_URL}/option-chain`, {
      waitUntil: 'domcontentloaded',
      timeout: 25000,
    }).catch(navErr => {
      console.warn(`[NSE API] Nav: ${navErr.message.substring(0, 80)}`);
    });
  });
}

/**
 * Strategy 2: Establish session via /option-chain, then use page.evaluate(fetch)
 * to call the API for a non-NIFTY symbol.
 */
async function evaluateFetch(page, apiPath, symbol) {
  // Step 1: Navigate to /option-chain to establish session
  console.log(`[NSE API] Establishing session for ${symbol}...`);

  // Wait for the NIFTY XHR to fire (proves session is established)
  const sessionReady = new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(false); } }, 20000);

    const handler = async (response) => {
      if (done) return;
      try {
        const url = response.url();
        if (url.includes('/api/option-chain')) {
          const json = await response.json();
          if (json?.records) {
            done = true;
            clearTimeout(timer);
            page.off('response', handler);
            resolve(true);
          }
        }
      } catch { /* ignore */ }
    };

    page.on('response', handler);
  });

  await page.goto(`${BASE_URL}/option-chain`, {
    waitUntil: 'domcontentloaded',
    timeout: 20000,
  }).catch(err => {
    console.warn(`[NSE API] Session nav: ${err.message.substring(0, 80)}`);
  });

  const ready = await sessionReady;
  if (!ready) {
    console.warn(`[NSE API] Session not confirmed — trying fetch anyway...`);
  } else {
    console.log(`[NSE API] Session established, fetching ${symbol}...`);
  }

  // Step 2: Use page.evaluate to fetch the desired symbol's API
  const apiUrl = `${BASE_URL}${apiPath}`;
  const result = await page.evaluate(async (url) => {
    try {
      const res = await fetch(url, {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        cache: 'no-store',
      });
      if (!res.ok) return { _error: `HTTP ${res.status}` };
      return await res.json();
    } catch (e) {
      return { _error: e.message };
    }
  }, apiUrl);

  if (result?._error) {
    throw new Error(`NSE API error for ${symbol}: ${result._error}`);
  }

  if (!result?.records) {
    throw new Error(`No records for ${symbol}: ${JSON.stringify(result).substring(0, 100)}`);
  }

  console.log(
    `[NSE API] ✅ ${symbol}: spot=${result.records.underlyingValue}, ` +
    `${result.records.data?.length} strikes, ts=${result.records.timestamp}`
  );
  return result;
}

export async function closeBrowser() {
  if (browser) {
    try { await browser.close(); } catch { /* ignore */ }
    browser = null;
  }
}

process.on('SIGINT', async () => { await closeBrowser(); process.exit(0); });
process.on('SIGTERM', async () => { await closeBrowser(); process.exit(0); });
