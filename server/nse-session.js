/**
 * NSE Session Manager — Hybrid approach
 *
 * 1. Launch browser (persistent)
 * 2. For each fetch, open a new tab -> navigate to option-chain page
 * 3. Set up response interception BEFORE navigation
 * 4. If interception works, great. If not, try page.evaluate(fetch).
 * 5. Close the tab after each fetch.
 *
 * Avoids "detached frame" by:
 *   - NOT reusing pages across fetches
 *   - NOT using --single-process
 *   - Handling navigation errors gracefully
 */

let browser = null;
let fetchInProgress = false;

const BASE_URL = 'https://www.nseindia.com';

async function ensureBrowser() {
  if (browser) {
    try {
      // Check if browser is still alive
      await browser.version();
      return browser;
    } catch {
      browser = null;
    }
  }

  const puppeteer = await import('puppeteer');
  console.log('[NSE Session] Launching headless browser...');
  browser = await puppeteer.default.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-gpu',
    ],
  });
  console.log('[NSE Session] Browser ready');
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
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setCacheEnabled(false);
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
 * Fetch option chain data. Opens a fresh tab, navigates to the
 * option-chain page, and intercepts the API response. Falls back
 * to a direct fetch from within the page context.
 */
export async function nseApiFetch(path) {
  if (fetchInProgress) {
    throw new Error('A fetch is already in progress — try again shortly');
  }
  fetchInProgress = true;

  const symbolMatch = path.match(/symbol=(\w+)/);
  const symbol = symbolMatch ? symbolMatch[1] : 'NIFTY';
  let page = null;

  try {
    const br = await ensureBrowser();
    page = await createPage(br);

    console.log(`[NSE API] Fetching ${symbol} via fresh tab...`);

    // ── Strategy 1: Navigate to option-chain page and intercept the XHR ──
    const interceptedData = await new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) { done = true; resolve(null); }
      }, 20000);

      const handler = async (response) => {
        if (done) return;
        const url = response.url();
        if (url.includes('/api/option-chain') && url.includes(symbol)) {
          try {
            const json = await response.json();
            if (json?.records) {
              done = true;
              clearTimeout(timer);
              page.off('response', handler);
              resolve(json);
            }
          } catch { /* ignore */ }
        }
      };

      page.on('response', handler);

      page.goto(`${BASE_URL}/option-chain`, {
        waitUntil: 'domcontentloaded',
        timeout: 18000,
      }).catch((err) => {
        console.warn(`[NSE API] Navigation warning: ${err.message.substring(0, 80)}`);
        // Not fatal — interceptor may still work
      });
    });

    if (interceptedData) {
      console.log(
        `[NSE API] ✅ Intercepted ${symbol}: spot=${interceptedData.records.underlyingValue}, ` +
        `${interceptedData.records.data?.length} strikes, ts=${interceptedData.records.timestamp}`
      );
      return interceptedData;
    }

    // ── Strategy 2: Direct fetch from within the page context ──
    console.log(`[NSE API] Interception timed out — trying direct fetch from page context...`);

    const apiUrl = `${BASE_URL}${path}`;
    const directData = await page.evaluate(async (url) => {
      try {
        const res = await fetch(url, {
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          cache: 'no-store',
        });
        if (!res.ok) return { error: `HTTP ${res.status}` };
        return await res.json();
      } catch (e) {
        return { error: e.message };
      }
    }, apiUrl);

    if (directData?.records) {
      console.log(
        `[NSE API] ✅ Direct fetch ${symbol}: spot=${directData.records.underlyingValue}, ` +
        `${directData.records.data?.length} strikes, ts=${directData.records.timestamp}`
      );
      return directData;
    }

    // Both strategies failed
    const detail = directData?.error || JSON.stringify(directData)?.substring(0, 200);
    throw new Error(`NSE returned no data. Direct fetch result: ${detail}`);

  } catch (err) {
    if (err.message.includes('Target closed') || err.message.includes('Session closed')) {
      console.warn('[NSE API] Browser died — will restart on next call');
      await closeBrowser();
    }
    throw err;
  } finally {
    if (page) {
      try { await page.close(); } catch { /* ignore */ }
    }
    fetchInProgress = false;
  }
}

export async function closeBrowser() {
  if (browser) {
    try { await browser.close(); } catch { /* ignore */ }
    browser = null;
  }
}

process.on('SIGINT', async () => { await closeBrowser(); process.exit(0); });
process.on('SIGTERM', async () => { await closeBrowser(); process.exit(0); });
