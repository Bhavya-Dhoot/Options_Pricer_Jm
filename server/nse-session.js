/**
 * NSE Session Manager — Production-grade approach
 *
 * Architecture:
 *   - Persistent browser (multi-process, no --single-process)
 *   - Fresh tab per fetch (avoids "detached frame" from page reuse)
 *   - --disable-dev-shm-usage handles limited /dev/shm in Docker
 *   - Auto-restarts browser on fatal errors
 *
 * Strategy per fetch:
 *   1. Ensure browser is running
 *   2. Create fresh tab → navigate to /option-chain → intercept XHR
 *   3. Close tab (browser stays alive for next fetch)
 */

let browser = null;
let fetchInProgress = false;

const BASE_URL = 'https://www.nseindia.com';

const CHROME_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',          // Write shared memory to /tmp instead of /dev/shm
  '--disable-blink-features=AutomationControlled',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-sync',
  '--no-first-run',
  '--disable-translate',
  '--no-zygote',                       // Docker: skip zygote process
];

async function ensureBrowser() {
  if (browser) {
    try {
      await browser.version(); // check if alive
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
  await page.setViewport({ width: 1280, height: 720 });
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

    console.log(`[NSE API] Fetching ${symbol} via fresh tab...`);

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
        // Navigation errors (frame detach, redirects) are common on NSE.
        // The interceptor may still capture the response.
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
    // If browser itself died, null it so next call restarts
    if (err.message.includes('Target closed') || err.message.includes('Session closed') || err.message.includes('Protocol error')) {
      console.warn('[NSE API] Browser appears dead — will restart on next call');
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
