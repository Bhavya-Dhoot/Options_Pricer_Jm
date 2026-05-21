/**
 * NSE Proxy Server
 * Lightweight Express server that proxies requests to NSE India API.
 *
 * Endpoints:
 *   GET /api/nifty-spot                    → { spot, timestamp }
 *   GET /api/option-chain?symbol=NIFTY     → parsed option chain
 *   GET /api/health                        → { ok, cacheAge }
 *
 * Features:
 *   - Session cookie management (auto-refresh)
 *   - Response caching (30s default)
 *   - Rate limiting (max 1 NSE request per 3s)
 *   - Graceful error handling with stale cache fallback
 */

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { nseApiFetch, refreshSession, closeBrowser } from './nse-session.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// ── CORS (allow Vite dev server + any origin) ──
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// ── Serve static frontend in production ──
const distPath = join(__dirname, '..', 'dist');
if (existsSync(distPath)) {
  console.log('[Proxy] Serving static frontend from', distPath);
  app.use(express.static(distPath));
}

// ── Cache store ──
const cache = {};
const CACHE_TTL_MS = 15 * 1000; // 15 seconds
const MIN_REQUEST_INTERVAL_MS = 3000; // Rate limit: 1 request per 3s
let lastNseRequestTime = 0;

function getCached(key) {
  const entry = cache[key];
  if (!entry) return null;
  const age = Date.now() - entry.timestamp;
  return { data: entry.data, age, stale: age > CACHE_TTL_MS };
}

function setCache(key, data) {
  cache[key] = { data, timestamp: Date.now() };
}

async function rateLimitedFetch(path) {
  const now = Date.now();
  const elapsed = now - lastNseRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastNseRequestTime = Date.now();
  return nseApiFetch(path);
}

// ── Normalize NSE expiry date formats ──
// CE.expiryDate = "26-05-2026" (DD-MM-YYYY)
// records.expiryDates = ["26-May-2026"] (DD-Mon-YYYY)
// We normalize to DD-Mon-YYYY to match the expiryDates array
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function normalizeExpiry(dateStr) {
  if (!dateStr) return dateStr;
  // If already in DD-Mon-YYYY format, return as-is
  if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(dateStr)) return dateStr;
  // Convert DD-MM-YYYY to DD-Mon-YYYY
  const [dd, mm, yyyy] = dateStr.split('-');
  const monthIdx = parseInt(mm, 10) - 1;
  if (monthIdx >= 0 && monthIdx < 12) {
    return `${dd}-${MONTHS[monthIdx]}-${yyyy}`;
  }
  return dateStr;
}

// ── Parse NSE option chain into clean format ──
function parseOptionChain(raw) {
  const records = raw?.records;
  if (!records) throw new Error('Invalid NSE response: no records field');

  const spot = records.underlyingValue;
  const expiryDates = records.expiryDates || [];
  const data = records.data || [];
  const timestamp = records.timestamp || new Date().toISOString();

  // Group by expiry (normalized to DD-Mon-YYYY)
  const byExpiry = {};
  for (const row of data) {
    const rawExp = row.CE?.expiryDate || row.PE?.expiryDate;
    if (!rawExp) continue;
    const exp = normalizeExpiry(rawExp);
    if (!byExpiry[exp]) byExpiry[exp] = [];

    const strike = {
      strikePrice: row.strikePrice,
      call: row.CE ? {
        ltp: row.CE.lastPrice,
        iv: row.CE.impliedVolatility,
        oi: row.CE.openInterest,
        oiChange: row.CE.changeinOpenInterest,
        volume: row.CE.totalTradedVolume,
        bid: row.CE.buyPrice1,
        ask: row.CE.sellPrice1,
      } : null,
      put: row.PE ? {
        ltp: row.PE.lastPrice,
        iv: row.PE.impliedVolatility,
        oi: row.PE.openInterest,
        oiChange: row.PE.changeinOpenInterest,
        volume: row.PE.totalTradedVolume,
        bid: row.PE.buyPrice1,
        ask: row.PE.sellPrice1,
      } : null,
    };
    byExpiry[exp].push(strike);
  }

  return { spot, expiryDates, byExpiry, timestamp };
}

// ── Endpoints ──

// Health check
app.get('/api/health', (req, res) => {
  const chainCache = getCached('option-chain-NIFTY');
  res.json({
    ok: true,
    cacheAge: chainCache ? Math.round(chainCache.age / 1000) + 's' : 'empty',
    stale: chainCache?.stale ?? null,
  });
});

// NIFTY spot price
app.get('/api/nifty-spot', async (req, res) => {
  try {
    const cached = getCached('option-chain-NIFTY');
    if (cached && !cached.stale) {
      return res.json({ spot: cached.data.spot, timestamp: cached.data.timestamp, cached: true });
    }

    const raw = await rateLimitedFetch('/api/option-chain-indices?symbol=NIFTY');
    const parsed = parseOptionChain(raw);
    setCache('option-chain-NIFTY', parsed);

    res.json({ spot: parsed.spot, timestamp: parsed.timestamp, cached: false });
  } catch (err) {
    console.error('[/api/nifty-spot] Error:', err.message);
    // Fallback to stale cache
    const stale = getCached('option-chain-NIFTY');
    if (stale) {
      return res.json({ spot: stale.data.spot, timestamp: stale.data.timestamp, cached: true, stale: true });
    }
    res.status(502).json({ error: 'Failed to fetch NIFTY spot', detail: err.message });
  }
});

// Full option chain
app.get('/api/option-chain', async (req, res) => {
  const symbol = (req.query.symbol || 'NIFTY').toUpperCase();
  const force = req.query.force === 'true';
  const cacheKey = `option-chain-${symbol}`;

  try {
    // Skip cache if force=true
    if (!force) {
      const cached = getCached(cacheKey);
      if (cached && !cached.stale) {
        console.log(`[/api/option-chain] Serving ${symbol} from cache (age: ${Math.round(cached.age / 1000)}s)`);
        return res.json({ ...cached.data, cached: true, cacheAge: Math.round(cached.age / 1000) });
      }
    } else {
      console.log(`[/api/option-chain] Force refresh requested for ${symbol}`);
    }

    const apiPath = symbol === 'NIFTY' || symbol === 'BANKNIFTY' || symbol === 'FINNIFTY' || symbol === 'MIDCPNIFTY'
      ? `/api/option-chain-indices?symbol=${symbol}`
      : `/api/option-chain-equities?symbol=${symbol}`;

    const raw = await rateLimitedFetch(apiPath);
    const parsed = parseOptionChain(raw);
    setCache(cacheKey, parsed);

    console.log(`[/api/option-chain] Fresh ${symbol} data: spot=${parsed.spot}, timestamp=${parsed.timestamp}`);
    res.json({ ...parsed, cached: false });
  } catch (err) {
    console.error(`[/api/option-chain] Error for ${symbol}:`, err.message);
    const stale = getCached(cacheKey);
    if (stale) {
      return res.json({ ...stale.data, cached: true, stale: true, cacheAge: Math.round(stale.age / 1000) });
    }
    res.status(502).json({ error: `Failed to fetch option chain for ${symbol}`, detail: err.message });
  }
});

// ── SPA fallback: serve index.html for all non-API routes (production) ──
if (existsSync(distPath)) {
  app.get('{*path}', (req, res) => {
    res.sendFile(join(distPath, 'index.html'));
  });
}

// ── Startup ──
async function start() {
  console.log('[Proxy] Initializing NSE session...');
  const ok = await refreshSession();
  if (!ok) {
    console.warn('[Proxy] Initial session failed — will retry on first request');
  }

  app.listen(PORT, () => {
    console.log(`[Proxy] NSE proxy server running on http://localhost:${PORT}`);
    console.log(`[Proxy] Endpoints:`);
    console.log(`  GET /api/health`);
    console.log(`  GET /api/nifty-spot`);
    console.log(`  GET /api/option-chain?symbol=NIFTY`);
  });
}

start();
