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
const equitySymbols = new Set(); // Tier 3: lowest priority, spot-only fetch
const lastSnapshotTime = {};
const lastRequestTime = {}; // For garbage collection
const lastPolledTime = {}; // To prevent spamming the same symbol 3 times a second
let isFetching = false;
let hasTPSLTrades = true; // Default true so first DB check runs on startup; engine sets to false if none found
export const setHasTPSLTrades = (val) => { hasTPSLTrades = val; };

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
// tier: 'priority' | 'regular' | 'equity'
export const registerSymbol = (symbol, tierOrLegacy = 'regular') => {
  const sym = symbol.toUpperCase();
  lastRequestTime[sym] = Date.now();
  // Backwards compatibility: old boolean isPriority param
  let tier = tierOrLegacy;
  if (tier === true) tier = 'priority';
  if (tier === false) tier = 'regular';
  
  if (tier === 'priority') {
    prioritySymbols.add(sym);
  } else if (tier === 'equity') {
    equitySymbols.add(sym);
  } else {
    activeSymbols.add(sym);
  }
};

export const getLatestPrice = (symbol) => {
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

// Lightweight equity-only spot price fetch (1 API credit, no option chain/IV/Greeks)
export async function fetchEquitySpotPrice(symbol) {
  const sym = symbol.toUpperCase();
  const token = getUnderlyingToken(sym);
  if (!token) return null;
  try {
    const quote = await smartApiRequest('/rest/secure/angelbroking/market/v1/quote/', {
      mode: 'LTP',
      exchangeTokens: { NSE: [token] }
    });
    const ltp = quote?.data?.fetched?.[0]?.ltp;
    if (ltp) {
      // Store in priceCache as a minimal entry
      if (!priceCache[sym]) {
        priceCache[sym] = { data: { symbol: sym, spot: ltp }, timestamp: Date.now() };
      } else {
        priceCache[sym].data.spot = ltp;
        priceCache[sym].timestamp = Date.now();
      }
      lastPolledTime[sym] = Date.now();
    }
    return ltp;
  } catch (e) {
    console.error(`[PriceCache] Equity spot fetch failed for ${sym}:`, e.message);
    return null;
  }
}

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
  // We MUST shallow clone `data` to prevent mutating the shared object returned by flightPromises.
  const existing = priceCache[sym];
  const mergedData = { ...data };
  
  if (existing && existing.data) {
    mergedData.byExpiry = { ...existing.data.byExpiry, ...mergedData.byExpiry };
    mergedData.futurePrices = { ...existing.data.futurePrices, ...mergedData.futurePrices };
  }
  
  priceCache[sym] = {
    data: mergedData,
    timestamp: Date.now()
  };
  lastPolledTime[sym] = Date.now();
  return priceCache[sym];
};

let pIndex = 0;
let rIndex = 0;
let eIndex = 0; // Equity round-robin index
let reqCount = 0;

// Start a background loop to fetch data for all active symbols respecting 3 req/sec (e.g. 333ms interval)
export const startPriceCacheLoop = () => {
  if (isFetching) return;
  isFetching = true;

  console.log('[PriceCache] Starting background fetch loop with 3-Tier Priority Queueing...');
  
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
      for (const sym of equitySymbols) {
        if (now - (lastRequestTime[sym] || 0) > 600000) {
          equitySymbols.delete(sym);
          delete lastRequestTime[sym];
          delete lastPolledTime[sym];
        }
      }

      const pQueue = Array.from(prioritySymbols);
      // Filter out priority symbols from regular active symbols to prevent duplicate polling
      const rQueue = Array.from(activeSymbols).filter(sym => !prioritySymbols.has(sym));
      const eQueue = Array.from(equitySymbols).filter(sym => !prioritySymbols.has(sym) && !activeSymbols.has(sym));
      
      let targetSymbol = null;
      let isEquityFetch = false;
      reqCount++;

      // 3-Tier Scheduling with Anti-Starvation Guarantee:
      // Tier 1 (Priority F&O):  Gets priorityWeight slots per cycle
      // Tier 2 (Regular F&O):   Gets 1 slot per cycle
      // Tier 3 (Equity):        Gets 1 slot every 5 cycles (anti-starvation guarantee)
      
      // Check if this is an equity turn (every 5th cycle)
      const isEquityTurn = eQueue.length > 0 && (reqCount % 5 === 0);
      
      if (isEquityTurn) {
        // Tier 3: Equity turn (guaranteed 1 slot per 5 cycles = anti-starvation)
        eIndex = (eIndex + 1) % eQueue.length;
        targetSymbol = eQueue[eIndex];
        isEquityFetch = true;
      } else {
        // Tier 1 vs Tier 2: Dynamic ratio scheduling (unchanged logic)
        let priorityWeight = 1;
        if (pQueue.length > 0 && rQueue.length > 0) {
          if (pQueue.length >= rQueue.length) priorityWeight = 2;
          if (pQueue.length >= rQueue.length * 3) priorityWeight = 3;
        }

        const cycleLength = priorityWeight + 1;
        const isPriorityTurn = pQueue.length > 0 && (rQueue.length === 0 || (reqCount % cycleLength !== 0));

        if (isPriorityTurn) {
          pIndex = (pIndex + 1) % pQueue.length;
          targetSymbol = pQueue[pIndex];
        } else if (rQueue.length > 0) {
          rIndex = (rIndex + 1) % rQueue.length;
          targetSymbol = rQueue[rIndex];
        }
      }

      if (targetSymbol) {
        const now = Date.now();
        const timeSinceLast = now - (lastPolledTime[targetSymbol] || 0);
        
        // Equity: enforce minimum 5000ms between polls for same symbol
        // F&O: enforce minimum 1000ms
        const minPollInterval = isEquityFetch ? 5000 : 1000;
        
        if (timeSinceLast >= minPollInterval) {
          lastPolledTime[targetSymbol] = now;
          
          if (isEquityFetch) {
            // Tier 3: Lightweight LTP-only fetch (1 API credit vs ~4 for full chain)
            await fetchEquitySpotPrice(targetSymbol);
          } else {
            // Tier 1/2: Full option chain fetch with IV, Greeks, etc.
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
            
            // CRITICAL (BUG-4 fix): Clone data before merging to prevent mutating the
            // shared object returned by flightPromises in-flight dedup.
            const existingBg = priceCache[targetSymbol];
            const mergedData = { ...data };
            if (existingBg && existingBg.data) {
              mergedData.byExpiry = { ...existingBg.data.byExpiry, ...mergedData.byExpiry };
              mergedData.futurePrices = { ...existingBg.data.futurePrices, ...mergedData.futurePrices };
            }
            
            priceCache[targetSymbol] = {
              data: mergedData,
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
          }
          
          // TP/SL Engine: Only check if we know TP/SL trades exist (skip DB query otherwise)
          if (hasTPSLTrades) {
            checkTPSL(priceCache).catch(e => console.error(`[PriceCache] TPSL Check Error:`, e.message));
          }
        } else {
          // Request was skipped because it's too fresh! NO quota consumed.
          // Don't punish the background loop with a 900ms delay if we didn't hit the API.
          // Just wait the exact remaining time to unlock it (or 50ms if many symbols are waiting).
          const remainingWait = minPollInterval - timeSinceLast;
          const totalQueueLen = pQueue.length + rQueue.length + eQueue.length;
          delayForNext = (totalQueueLen > 1) ? 50 : Math.max(10, remainingWait);
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
