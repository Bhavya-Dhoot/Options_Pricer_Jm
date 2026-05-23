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

export const forceFetchLatestPrice = async (symbol) => {
  const sym = symbol.toUpperCase();
  const data = await fetchMarketDataChain(sym, null, null);
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

      // Dynamic Ratio: Increase priority intensity if there are many priority symbols
      let ratio = 3; // default 1 priority out of every 3
      if (pQueue.length > 0 && rQueue.length > 0) {
        if (pQueue.length >= rQueue.length) ratio = 2; // 1 out of 2
        if (pQueue.length >= rQueue.length * 3) ratio = 1; // 100% priority
      }

      const isPriorityTurn = pQueue.length > 0 && (rQueue.length === 0 || reqCount % ratio === 0 || ratio === 1);

      if (isPriorityTurn) {
        pIndex = (pIndex + 1) % pQueue.length;
        targetSymbol = pQueue[pIndex];
      } else if (rQueue.length > 0) {
        rIndex = (rIndex + 1) % rQueue.length;
        targetSymbol = rQueue[rIndex];
      }

      let delayForNext = 900; // Base sustainable rate to protect 5000/hr limit

      if (targetSymbol) {
        const now = Date.now();
        const timeSinceLast = now - (lastPolledTime[targetSymbol] || 0);
        
        // Prevent polling the identical symbol faster than 1000ms to save API quota
        if (timeSinceLast >= 1000) {
          lastPolledTime[targetSymbol] = now;
          
          const data = await fetchMarketDataChain(targetSymbol, null, null);
          
          priceCache[targetSymbol] = {
            data: data,
            timestamp: Date.now()
          };
          
          // Save snapshot to DB if 60 seconds have passed for this symbol
          const snapshotNow = Date.now();
          if (!lastSnapshotTime[targetSymbol] || snapshotNow - lastSnapshotTime[targetSymbol] >= 60000) {
            lastSnapshotTime[targetSymbol] = snapshotNow;
            MarketSnapshot.create({
              symbol: targetSymbol,
              timestamp: new Date(snapshotNow),
              data: data
            }).catch(e => console.error(`[PriceCache] Failed to save snapshot for ${targetSymbol}:`, e.message));
          }
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
