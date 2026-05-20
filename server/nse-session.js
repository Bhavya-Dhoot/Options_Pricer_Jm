/**
 * NSE Session Manager — Intercept approach
 * 
 * Instead of making our own API call, we intercept the XHR request that 
 * the NSE website itself makes when loading the option chain page.
 * This is the most reliable method since it uses the EXACT same request
 * the website makes.
 */

let browser = null;
let page = null;
let cachedData = {}; // { symbol: { data, timestamp } }

const BASE_URL = 'https://www.nseindia.com';

/**
 * Launch the browser and intercept API responses.
 */
export async function refreshSession() {
  try {
    const puppeteer = await import('puppeteer');

    if (!browser) {
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
          '--single-process',
        ],
      });
      page = await browser.newPage();

      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.chrome = { runtime: {} };
      });

      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      );
      await page.setViewport({ width: 1920, height: 1080 });
    }

    console.log('[NSE Session] Browser ready');
    return true;
  } catch (err) {
    console.error('[NSE Session] Failed:', err.message);
    return false;
  }
}

/**
 * Fetch option chain by navigating to the page and intercepting the API response.
 */
export async function nseApiFetch(path) {
  if (!page) await refreshSession();

  // Determine the page URL based on the API path
  let pageUrl = `${BASE_URL}/option-chain`;
  const symbolMatch = path.match(/symbol=(\w+)/);
  const symbol = symbolMatch ? symbolMatch[1] : 'NIFTY';

  console.log(`[NSE API] Fetching ${symbol} via page navigation + intercept...`);

  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for option chain data (30s)'));
    }, 30000);

    // Set up response interception
    const handler = async (response) => {
      const url = response.url();
      if (url.includes('/api/option-chain') && url.includes(symbol)) {
        try {
          const json = await response.json();
          if (json && json.records) {
            clearTimeout(timeout);
            page.off('response', handler);
            console.log(`[NSE API] ✅ Intercepted ${symbol} chain: spot=${json.records.underlyingValue}, ${json.records.data?.length} strikes`);
            cachedData[symbol] = { data: json, timestamp: Date.now() };
            resolve(json);
          }
        } catch {
          // Not JSON or incomplete, ignore
        }
      }
    };

    page.on('response', handler);

    try {
      // Navigate to the option chain page — this triggers the API call automatically
      await page.goto(pageUrl, {
        waitUntil: 'networkidle2',
        timeout: 25000,
      });

      // If data wasn't intercepted during navigation, try selecting the symbol
      // (the page might need interaction to trigger the API call)
      await new Promise(r => setTimeout(r, 3000));

      // Check if we already resolved
      if (cachedData[symbol]?.timestamp > Date.now() - 5000) return;

      // Try selecting the symbol explicitly on the page
      console.log(`[NSE API] Waiting for data... (page loaded, checking for delayed XHR)`);
      await new Promise(r => setTimeout(r, 5000));

    } catch (navErr) {
      // Navigation timeout is OK if we already got the data
      if (!cachedData[symbol] || Date.now() - cachedData[symbol].timestamp > 10000) {
        clearTimeout(timeout);
        page.off('response', handler);
        reject(new Error(`Navigation failed: ${navErr.message}`));
      }
    }
  });
}

/**
 * Get cached data for a symbol without making a new request.
 */
export function getCachedData(symbol) {
  return cachedData[symbol] || null;
}

/**
 * Cleanup.
 */
export async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
}

process.on('SIGINT', async () => { await closeBrowser(); process.exit(0); });
process.on('SIGTERM', async () => { await closeBrowser(); process.exit(0); });
