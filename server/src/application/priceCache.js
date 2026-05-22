import { smartApiRequest } from '../../angelOneAuth.js';
import { getFutureToken, getOptionTokens, getUnderlyingToken } from '../../scripMaster.js';

// Global cache
// { "NIFTY": { spot: 24500, iv: 0.15, optionChain: [...], futures: {...}, timestamp: 123456 } }
const priceCache = {};
const activeSymbols = new Set();
const prioritySymbols = new Set();
let isFetching = false;

// Register symbols that users have in their portfolios
export const registerSymbol = (symbol, isPriority = false) => {
  if (isPriority) {
    prioritySymbols.add(symbol.toUpperCase());
  } else {
    activeSymbols.add(symbol.toUpperCase());
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
      const pQueue = Array.from(prioritySymbols);
      const rQueue = Array.from(activeSymbols);
      
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
        const port = process.env.PORT || 3001;
        const res = await fetch(`http://localhost:${port}/api/option-chain?symbol=${targetSymbol}&force=true`);
        if (res.ok) {
          const data = await res.json();
          priceCache[targetSymbol] = {
            data: data,
            timestamp: Date.now()
          };
        }
      }
    } catch (err) {
      console.error(`[PriceCache] Fetch Error: ${err.message}`);
    } finally {
      // Strictly wait 335ms to ensure we do not exceed 3 requests per second
      setTimeout(fetchLoop, 335);
    }
  };

  fetchLoop();
};
