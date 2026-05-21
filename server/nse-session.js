/**
 * NSE Session Manager — Puppeteer intercept (memory-optimized)
 *
 * The ONLY reliable approach for NSE:
 *   - Navigate to /option-chain page in headless Chrome
 *   - Intercept the XHR response the page makes to NSE's API
 *   - Close the tab after each fetch (browser stays alive)
 *
 * Memory optimizations for Render Free (512MB):
 *   - Minimal Chrome flags to reduce footprint
 *   - Small viewport (800x600)
 *   - Tab closed after each fetch
 *   - --no-zygote instead of --single-process (avoids frame detach)
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
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--js-flags=--max-old-space-size=128',
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
  // Block images, fonts, stylesheets to save memory/bandwidth
  await page.setRequestInterception(true);
  page.on('request', req => {
    const type = req.resourceType();
    if (['image', 'font', 'stylesheet', 'media'].includes(type)) {
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
 * Fetch option chain data.
 * Opens a fresh tab, navigates to /option-chain, intercepts the XHR.
 * Closes the tab afterward (browser stays alive).
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

    console.log(`[NSE API] Fetching ${symbol}...`);

    const data = await new Promise((resolve, reject) => {
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          page.off('response', handler);
          reject(new Error('Timed out waiting for option chain data (25s)'));
        }
      }, 25000);

      const handler = async (response) => {
        if (resolved) return;
        const url = response.url();
        if (url.includes('/api/option-chain') && url.includes(symbol)) {
          try {
            const json = await response.json();
            if (json?.records) {
              resolved = true;
              clearTimeout(timeout);
              page.off('response', handler);
              resolve(json);
            }
          } catch { /* not JSON */ }
        }
      };

      page.on('response', handler);

      page.goto(`${BASE_URL}/option-chain`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      }).catch((navErr) => {
        console.warn(`[NSE API] Nav warning: ${navErr.message.substring(0, 100)}`);
      });
    });

    console.log(
      `[NSE API] ✅ ${symbol}: spot=${data.records.underlyingValue}, ` +
      `${data.records.data?.length} strikes, ts=${data.records.timestamp}`
    );
    return data;

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

export async function closeBrowser() {
  if (browser) {
    try { await browser.close(); } catch { /* ignore */ }
    browser = null;
  }
}

process.on('SIGINT', async () => { await closeBrowser(); process.exit(0); });
process.on('SIGTERM', async () => { await closeBrowser(); process.exit(0); });
