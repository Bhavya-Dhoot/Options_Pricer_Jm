import { smartApiRequest } from '../../angelOneAuth.js';
import { getFutureToken, getOptionTokens, getUnderlyingToken } from '../../scripMaster.js';
import { MarketSnapshot } from '../domain/MarketSnapshot.js';
import { fetchMarketDataChain } from '../../proxy.js';

// Global cache
// { "NIFTY": { spot: 24500, iv: 0.15, optionChain: [...], futures: {...}, timestamp: 123456 } }
const priceCache = {};
const activeSymbols = new Set();
const prioritySymbols = new Set();
const lastSnapshotTime = {};
const lastRequestTime = {}; // For garbage collection
const lastPolledTime = {}; // To prevent spamming the same symbol 3 times a second
let isFetching = false;

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

export const getLatestPrice = (symbol) => {
  return priceCache[symbol.toUpperCase()] || null;
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
    try {
      const now = Date.now();
      // Garbage Collection: Remove symbols not requested in the last 10 minutes
      for (const sym of activeSymbols) {
        if (now - (lastRequestTime[sym] || 0) > 600000) activeSymbols.delete(sym);
      }
      for (const sym of prioritySymbols) {
        if (now - (lastRequestTime[sym] || 0) > 600000) prioritySymbols.delete(sym);
      }

      const pQueue = Array.from(prioritySymbols);
      // Filter out priority symbols from regular active symbols to prevent duplicate polling
      const rQueue = Array.from(activeSymbols).filter(sym => !prioritySymbols.has(sym));
      
      let targetSymbol = null;
      reqCount++;

      // Rule: Every 3rd request (1 out of 3) is dedicated to Priority Queue
      if (reqCount % 3 === 0) {
        if (pQueue.length > 0) {
          pIndex = (pIndex + 1) % pQueue.length;
          targetSymbol = pQueue[pIndex];
        } else if (rQueue.length > 0) {
          rIndex = (rIndex + 1) % rQueue.length;
          targetSymbol = rQueue[rIndex];
        }
      } else {
        // The other 2 out of 3 requests go to Regular Queue
        if (rQueue.length > 0) {
          rIndex = (rIndex + 1) % rQueue.length;
          targetSymbol = rQueue[rIndex];
        } else if (pQueue.length > 0) {
          pIndex = (pIndex + 1) % pQueue.length;
          targetSymbol = pQueue[pIndex];
        }
      }

      if (targetSymbol) {
        const now = Date.now();
        // Prevent polling the identical symbol faster than 1000ms to save API quota
        if (!lastPolledTime[targetSymbol] || (now - lastPolledTime[targetSymbol] >= 1000)) {
          lastPolledTime[targetSymbol] = now;
          
          const data = await fetchMarketDataChain(targetSymbol, null, null);
          
          priceCache[targetSymbol] = {
            data: data,
            timestamp: Date.now()
          };
          
          // Save snapshot to DB if 60 seconds have passed for this symbol
          const now = Date.now();
          if (!lastSnapshotTime[targetSymbol] || now - lastSnapshotTime[targetSymbol] >= 60000) {
            lastSnapshotTime[targetSymbol] = now;
            MarketSnapshot.create({
              symbol: targetSymbol,
              timestamp: new Date(now),
              data: data
            }).catch(e => console.error(`[PriceCache] Failed to save snapshot for ${targetSymbol}:`, e.message));
          }
        }
      }
    } catch (err) {
      console.error(`[PriceCache] Fetch Error: ${err.message}`);
    } finally {
      // Throttle the daemon to exactly 900ms per request.
      // 1 req / 900ms = 4000 requests per hour.
      // This strictly reserves 1000 requests per hour (20% of the quota) exclusively for UI bursts!
      setTimeout(fetchLoop, 900);
    }
  };

  fetchLoop();
};
