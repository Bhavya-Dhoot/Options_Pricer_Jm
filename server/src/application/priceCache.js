import { smartApiRequest } from '../../angelOneAuth.js';
import { getFutureToken, getOptionTokens, getUnderlyingToken } from '../../scripMaster.js';
import { MarketSnapshot } from '../domain/MarketSnapshot.js';
import { fetchMarketDataChain, chainCache } from './marketDataService.js';
import { checkTPSL } from './tpslEngine.js';
import Trade from '../domain/Trade.js';

// Global cache
// { "NIFTY": { spot: 24500, iv: 0.15, optionChain: [...], futures: {...}, timestamp: 123456 } }
const priceCache = {};
const activeSymbols = new Set();
const prioritySymbols = new Set();
const lastSnapshotTime = {};
const lastRequestTime = {}; // For garbage collection
const lastPolledTime = {}; // To prevent spamming the same symbol 3 times a second
let isFetching = false;

// Multi-Expiry Support: Track which expiries are actively held for each symbol
// { NIFTY: ['26-May-2026', '26-Jun-2026'], BANKNIFTY: ['29-May-2026'] }
const activeExpiries = {};
const expiryRotationIndex = {}; // Round-robin index per symbol
let lastExpiryRefreshTime = 0;

// Refresh active expiries from open trades every 30 seconds
async function refreshActiveExpiries() {
  const now = Date.now();
  if (now - lastExpiryRefreshTime < 30000) return;
  lastExpiryRefreshTime = now;
  try {
    const openTrades = await Trade.find({ status: 'OPEN' }).select('symbol expiry').lean();
    // Reset
    for (const key of Object.keys(activeExpiries)) delete activeExpiries[key];
    for (const t of openTrades) {
      if (!t.expiry) continue;
      const sym = t.symbol.toUpperCase();
      if (!activeExpiries[sym]) activeExpiries[sym] = new Set();
      activeExpiries[sym].add(t.expiry);
    }
  } catch (e) {
    // Non-critical, will retry next cycle
  }
}

// Register symbols that users have in their portfolios
export const registerSymbol = (symbol, isPriority = false) => {
  const sym = symbol.toUpperCase();
  lastRequestTime[sym] = Date.now();
  if (isPriority) {
    prioritySymbols.add(sym);
  } else {
    activeSymbols.add(sym);
  }
};

export const getLatestPrice = async (symbol) => {
  return priceCache[symbol.toUpperCase()] || null;
};

const getMockData = (sym, targetExpiry) => {
  const baseSpot = sym === 'NIFTY' ? 24500 : (sym === 'BANKNIFTY' ? 51000 : 3800);
  const expiry = targetExpiry || '25-JUN-2026';
  return {
    symbol: sym,
    spot: baseSpot,
    byExpiry: {
        [expiry]: [
            { strikePrice: baseSpot, strike: baseSpot, call: { askPrice: 100, bidPrice: 95, ltp: 98 }, put: { askPrice: 100, bidPrice: 95, ltp: 98 } }
        ]
    },
    futurePrices: { [expiry]: baseSpot + 50 }
  };
};

export const forceFetchLatestPrice = async (symbol, targetExpiry = null, futureExpiry = null) => {
  const sym = symbol.toUpperCase();
  let data;
  try {
    data = await fetchMarketDataChain(sym, targetExpiry, futureExpiry);
  } catch (e) {
    if (e.message.includes('403') || e.message.includes('Access denied')) {
      console.warn(`[PriceCache] Using mock data for ${sym} (Rate Limited)`);
      data = getMockData(sym, targetExpiry);
    } else {
      throw e;
    }
  }
  
  // CRITICAL: Merge byExpiry and futurePrices into existing cache to support
  // multi-expiry positions. Without this, fetching expiry B wipes expiry A's data.
  const existing = priceCache[sym];
  if (existing && existing.data) {
    data.byExpiry = { ...existing.data.byExpiry, ...data.byExpiry };
    data.futurePrices = { ...existing.data.futurePrices, ...data.futurePrices };
  }
  
  priceCache[sym] = {
    data: data,
    timestamp: Date.now()
  };
  lastPolledTime[sym] = Date.now();
  return priceCache[sym];
};

let pIndex = 0;
let rIndex = 0;
let reqCount = 0;

// Start a background loop to fetch data for all active symbols respecting 3 req/sec (e.g. 333ms interval)
export const startPriceCacheLoop = () => {
  if (isFetching) return;
  isFetching = true;

  console.log('[PriceCache] Starting background fetch loop with Priority Queueing...');
  
  const fetchLoop = async () => {
    let delayForNext = 900; // Base sustainable rate to protect 5000/hr limit
    try {
      const now = Date.now();
      // Garbage Collection: Remove symbols not requested in the last 10 minutes
      for (const sym of activeSymbols) {
        if (now - (lastRequestTime[sym] || 0) > 600000) {
          activeSymbols.delete(sym);
          delete lastRequestTime[sym];
          delete lastPolledTime[sym];
          delete lastSnapshotTime[sym];
        }
      }
      for (const sym of prioritySymbols) {
        if (now - (lastRequestTime[sym] || 0) > 600000) {
          prioritySymbols.delete(sym);
          delete lastRequestTime[sym];
          delete lastPolledTime[sym];
          delete lastSnapshotTime[sym];
        }
      }

      const pQueue = Array.from(prioritySymbols);
      // Filter out priority symbols from regular active symbols to prevent duplicate polling
      const rQueue = Array.from(activeSymbols).filter(sym => !prioritySymbols.has(sym));
      
      let targetSymbol = null;
      reqCount++;

      // Dynamic Ratio: Ensure priority gets faster updates but NEVER starves regular users
      let priorityWeight = 1; // default 1 priority for every 1 regular (50% slice)
      if (pQueue.length > 0 && rQueue.length > 0) {
        if (pQueue.length >= rQueue.length) priorityWeight = 2; // 2 priority for 1 regular (66% slice)
        if (pQueue.length >= rQueue.length * 3) priorityWeight = 3; // 3 priority for 1 regular (75% slice max)
      }

      // If priorityWeight is 3, then reqCount % 4 will be 1, 2, 3 (priority) and 0 (regular)
      const cycleLength = priorityWeight + 1;
      const isPriorityTurn = pQueue.length > 0 && (rQueue.length === 0 || (reqCount % cycleLength !== 0));

      if (isPriorityTurn) {
        pIndex = (pIndex + 1) % pQueue.length;
        targetSymbol = pQueue[pIndex];
      } else if (rQueue.length > 0) {
        rIndex = (rIndex + 1) % rQueue.length;
        targetSymbol = rQueue[rIndex];
      }

      if (targetSymbol) {
        const now = Date.now();
        const timeSinceLast = now - (lastPolledTime[targetSymbol] || 0);
        
        // Prevent polling the identical symbol faster than 1000ms to save API quota
        if (timeSinceLast >= 1000) {
          lastPolledTime[targetSymbol] = now;
          
          // Determine which expiry to fetch: rotate through active trade expiries
          await refreshActiveExpiries();
          let targetExpiry = null;
          const symExpiries = activeExpiries[targetSymbol];
          if (symExpiries && symExpiries.size > 1) {
            const expArr = Array.from(symExpiries);
            if (!expiryRotationIndex[targetSymbol]) expiryRotationIndex[targetSymbol] = 0;
            expiryRotationIndex[targetSymbol] = (expiryRotationIndex[targetSymbol] + 1) % expArr.length;
            targetExpiry = expArr[expiryRotationIndex[targetSymbol]];
          }
          
          let data;
          try {
            data = await fetchMarketDataChain(targetSymbol, targetExpiry, null);
          } catch (e) {
            if (e.message.includes('403') || e.message.includes('Access denied')) {
              console.warn(`[PriceCache] Using mock data for ${targetSymbol} (Rate Limited)`);
              data = getMockData(targetSymbol);
            } else {
              throw e;
            }
          }
          
          // Merge byExpiry and futurePrices to preserve multi-expiry data
          const existingBg = priceCache[targetSymbol];
          if (existingBg && existingBg.data) {
            data.byExpiry = { ...existingBg.data.byExpiry, ...data.byExpiry };
            data.futurePrices = { ...existingBg.data.futurePrices, ...data.futurePrices };
          }
          
          priceCache[targetSymbol] = {
            data: data,
            timestamp: Date.now()
          };
          
          // Save snapshot to DB if 60 seconds have passed for this symbol
          const snapshotNow = Date.now();
          if (!lastSnapshotTime[targetSymbol] || snapshotNow - lastSnapshotTime[targetSymbol] >= 60000) {
            lastSnapshotTime[targetSymbol] = snapshotNow;
            // Fire and forget (Non-blocking)
            MarketSnapshot.create({
              symbol: targetSymbol,
              timestamp: new Date(snapshotNow),
              data: data
            }).catch(e => console.error(`[PriceCache] Snapshot Failed:`, e.message));
          }
          
          // TP/SL Engine: Check if any open trades need auto-exit
          checkTPSL(priceCache).catch(e => console.error(`[PriceCache] TPSL Check Error:`, e.message));
        } else {
          // Request was skipped because it's too fresh! NO quota consumed.
          // Don't punish the background loop with a 900ms delay if we didn't hit the API.
          // Just wait the exact remaining time to unlock it (or 50ms if many symbols are waiting).
          const remainingWait = 1000 - timeSinceLast;
          delayForNext = (pQueue.length + rQueue.length > 1) ? 50 : Math.max(10, remainingWait);
        }
      } else {
        delayForNext = 1000; // No symbols in queue
      }
    } catch (err) {
      console.error(`[PriceCache] Fetch Error: ${err.message}`);
    } finally {
      // Throttle the daemon to strictly protect the 5000/hr quota, but dynamically 
      // speed up if the request was skipped to prevent artificial latency!
      setTimeout(fetchLoop, delayForNext);
    }
  };

  fetchLoop();
};
