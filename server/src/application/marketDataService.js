import { smartApiRequest } from '../../angelOneAuth.js';
import { 
  getUnderlyingToken, 
  getOptionTokens, 
  getAvailableExpiries, 
  getFutureToken,
  getAvailableFutureExpiries,
  getLotSize,
  ensureScripMasterInitialized
} from '../../scripMaster.js';
import { solveImpliedIV } from '../../../src/bsm.js';
import { io } from '../../proxy.js';

// Fallback Map Cache if Redis is unavailable
export const chainCache = new Map();

// BSM Optimization: Warm-Start Newton-Raphson cache
const ivCache = new Map();

// Helper to format Angel One expiry strings (e.g. 26MAY2026 -> 26-May-2026)
export function formatExpiry(angelExp) {
  if (!angelExp || angelExp.length < 9) return angelExp;
  const day = angelExp.slice(0, 2);
  const month = angelExp.slice(2, 5);
  const year = angelExp.slice(5);
  const formattedMonth = month.charAt(0) + month.slice(1).toLowerCase();
  return `${day}-${formattedMonth}-${year}`;
}

const flightPromises = new Map();

export async function fetchMarketDataChain(symbol, targetExpiry, futureExpiry) {
  await ensureScripMasterInitialized();
  symbol = symbol?.toUpperCase() || 'NIFTY';
  
  const cacheKey = `${symbol}_${targetExpiry || 'DEFAULT'}_${futureExpiry || 'DEFAULT'}`;
  
  if (flightPromises.has(cacheKey)) {
    return flightPromises.get(cacheKey);
  }
  
  const fetchPromise = (async () => {
    try {
      const spotToken = getUnderlyingToken(symbol);
  if (!spotToken) throw new Error(`Underlying token not found for ${symbol}`);

  const spotExchange = (symbol === 'SENSEX' || symbol === 'BANKEX') ? 'BSE' : 'NSE';

  const cached = chainCache.get(symbol);
  let approxSpot = cached ? cached.data.spot : null;
  
  if (!approxSpot) {
    const spotQuote = await smartApiRequest('/rest/secure/angelbroking/market/v1/quote/', {
      mode: 'FULL',
      exchangeTokens: {
        [spotExchange]: [spotToken]
      }
    });
      const spotData = spotQuote?.data?.fetched?.[0];
      if (!spotData) {
        throw new Error(`Could not fetch spot price for ${symbol}`);
      }
      approxSpot = spotData.ltp;
  }

  // 2. Find Requested or Nearest Expiry
  const expiries = getAvailableExpiries(symbol);
  if (expiries.length === 0) {
    throw new Error(`No expiries found for ${symbol}`);
  }
  
  const finalTargetExpiryFormatted = targetExpiry || formatExpiry(expiries[0]);
  // Find the raw Angel expiry string that matches the formatted one (case-insensitive to support uppercase UI payloads)
  const finalTargetExpiryRaw = expiries.find(e => formatExpiry(e).toLowerCase() === finalTargetExpiryFormatted.toLowerCase()) || expiries[0];
  
  // 3. Find Options Tokens around Spot
  const optionsForExpiry = getOptionTokens(symbol, finalTargetExpiryRaw);
  
  const optionsWithStrike = optionsForExpiry.map(opt => ({
    ...opt,
    parsedStrike: parseFloat(opt.strike) / 100
  }));

  const strikesMap = {};
  optionsWithStrike.forEach(opt => {
    const k = opt.parsedStrike;
    if (!strikesMap[k]) strikesMap[k] = {};
    if (opt.symbol.endsWith('CE')) strikesMap[k].CE = opt;
    if (opt.symbol.endsWith('PE')) strikesMap[k].PE = opt;
  });

  const allStrikes = Object.keys(strikesMap).map(Number).sort((a, b) => a - b);
  
  let closestIndex = 0;
  let minDiff = Infinity;
  allStrikes.forEach((k, i) => {
    const diff = Math.abs(k - approxSpot);
    if (diff < minDiff) {
      minDiff = diff;
      closestIndex = i;
    }
  });

  // OPTIMIZATION: Expand to ±30 strikes for deep OTM analysis, dynamically chunked via Engine
  const startIndex = Math.max(0, closestIndex - 30);
  const endIndex = Math.min(allStrikes.length - 1, closestIndex + 30);
  const relevantStrikes = allStrikes.slice(startIndex, endIndex + 1);

  const tokensToFetch = [];
  const tokenMap = new Map();

  const futExpiries = getAvailableFutureExpiries(symbol);
  futExpiries.forEach(exp => {
    const futToken = getFutureToken(symbol, exp);
    if (futToken) {
      tokensToFetch.push(futToken);
      tokenMap.set(futToken, { type: 'FUT', expiry: exp });
    }
  });

  relevantStrikes.forEach(k => {
    if (strikesMap[k].CE) {
      tokensToFetch.push(strikesMap[k].CE.token);
      tokenMap.set(strikesMap[k].CE.token, { strike: k, type: 'CE' });
    }
    if (strikesMap[k].PE) {
      tokensToFetch.push(strikesMap[k].PE.token);
      tokenMap.set(strikesMap[k].PE.token, { strike: k, type: 'PE' });
    }
  });

  // 4. Unified Chunked Fetch! (Bundle Spot + Options via Promise.all)
  const optExchange = (symbol === 'SENSEX' || symbol === 'BANKEX') ? 'BFO' : 'NFO';
  const chunkSize = 49; // Max 50 per request, reserving 1 for Spot
  const fetchPromises = [];

  for (let i = 0; i < tokensToFetch.length; i += chunkSize) {
    const chunk = tokensToFetch.slice(i, i + chunkSize);
    const exchangeTokens = { [optExchange]: chunk };
    // BUG-6 Fix: Only attach spot token to the FIRST chunk to avoid wasting API quota.
    // Previously spot was attached to every chunk, costing 2 extra credits per cycle.
    if (i === 0) {
      exchangeTokens[spotExchange] = [spotToken];
    }
    fetchPromises.push(
      smartApiRequest('/rest/secure/angelbroking/market/v1/quote', {
        mode: 'FULL',
        exchangeTokens
      })
    );
  }

  const fetchedOptions = [];
  let spotPrice = approxSpot;
  
  const responses = await Promise.all(fetchPromises);
  
  responses.forEach(unifiedQuote => {
    if (unifiedQuote?.data?.fetched) {
      unifiedQuote.data.fetched.forEach(item => {
        if (item.symbolToken === spotToken && (item.exchange === 'NSE' || item.exchange === 'BSE')) {
          spotPrice = item.ltp; // Gets updated multiple times perfectly in sync
        } else {
          fetchedOptions.push(item);
        }
      });
    }
  });

  // 5. Construct NSE-like Response
  const futExpTarget = futureExpiry || finalTargetExpiryRaw;
  const futExpTargetFormat = formatExpiry(futExpTarget);
  
  // Map fetched options by token for fast lookup
  const optQuoteMap = {};
  let futurePrice = null; // fallback single future price
  const futurePrices = {}; // mapped future prices by formatted expiry
  
  fetchedOptions.forEach(opt => {
    const meta = tokenMap.get(opt.symbolToken);
    if (meta?.type === 'FUT') {
      const formattedExp = formatExpiry(meta.expiry);
      futurePrices[formattedExp] = opt.ltp;
      if (formattedExp === futExpTargetFormat || !futurePrice) {
        futurePrice = opt.ltp;
      }
    } else {
      optQuoteMap[opt.symbolToken] = opt;
    }
  });

  const nseTargetExpiry = formatExpiry(finalTargetExpiryRaw);
  const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
  const parts = nseTargetExpiry.split('-');
  const expiryDateObj = new Date(parseInt(parts[2]), months[parts[1]], parseInt(parts[0]));
  
  const T = Math.max(0.5, (expiryDateObj.getTime() - Date.now()) / 86400000) / 365;

  // Helper: Find "true" LTP. Angel One LTP is often extremely stale (e.g., 157 when bid/ask is 182).
  const getTrueLtp = (quote) => {
    const bid = quote.depth?.buy?.[0]?.price || 0;
    const ask = quote.depth?.sell?.[0]?.price || 0;
    let ltp = quote.ltp;
    
    // If order book is active but LTP is outside the spread, it's stale. Use mid-price.
    if (bid > 0 && ask > 0 && ask >= bid) {
      // BUG-10 Fix: For illiquid options with very wide spreads (e.g., bid=0.05, ask=5.00),
      // mid-price is wildly inaccurate. Only use mid-price if spread is reasonable (<50% of ask).
      const spreadRatio = (ask - bid) / ask;
      if (ltp < bid || ltp > ask) {
        if (spreadRatio < 0.5) {
          ltp = (bid + ask) / 2;
        }
        // If spread is too wide, keep the original LTP as-is (it's more realistic than mid-price)
      }
    }
    return ltp;
  };

  const strikeRecords = [];
  let bsmLoopCount = 0;
  
  for (const strike of relevantStrikes) {
    // Event Loop Yielding (DoS Prevention): Yield CPU every 10 strikes to process concurrent web requests
    if (++bsmLoopCount % 10 === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
    
    const record = { strikePrice: strike, call: null, put: null };
    
    const ceToken = strikesMap[strike].CE?.token;
    const peToken = strikesMap[strike].PE?.token;
    
    const ceQuote = ceToken ? optQuoteMap[ceToken] : null;
    const peQuote = peToken ? optQuoteMap[peToken] : null;

    if (ceQuote) {
      const bestBuy = ceQuote.depth?.buy?.[0];
      const bestSell = ceQuote.depth?.sell?.[0];
      const trueLtp = getTrueLtp(ceQuote);
      
      let prevCalcIV = ivCache.get(ceToken) || 0.20;
      let calcIV = (await solveImpliedIV(spotPrice, strike, T, 0.065, trueLtp, 'CALL', 0.012, prevCalcIV)) || 0.15;
      ivCache.set(ceToken, calcIV);
      
      record.call = {
        ltp: trueLtp,
        oi: ceQuote.openInterest,
        bidPrice: bestBuy?.price || 0,
        bidQty: bestBuy?.quantity || 0,
        askPrice: bestSell?.price || 0,
        askQty: bestSell?.quantity || 0,
        iv: calcIV * 100 
      };
    }
    
    if (peQuote) {
      const bestBuy = peQuote.depth?.buy?.[0];
      const bestSell = peQuote.depth?.sell?.[0];
      const trueLtp = getTrueLtp(peQuote);

      let prevCalcIV = ivCache.get(peToken) || 0.20;
      let calcIV = (await solveImpliedIV(spotPrice, strike, T, 0.065, trueLtp, 'PUT', 0.012, prevCalcIV)) || 0.15;
      ivCache.set(peToken, calcIV);

      record.put = {
        ltp: trueLtp,
        oi: peQuote.openInterest,
        bidPrice: bestBuy?.price || 0,
        bidQty: bestBuy?.quantity || 0,
        askPrice: bestSell?.price || 0,
        askQty: bestSell?.quantity || 0,
        iv: calcIV * 100
      };
    }
    
    strikeRecords.push(record);
  }

  const finalResponse = {
    symbol: symbol,
    spot: spotPrice,
    lotSize: getLotSize(symbol),
    futurePrice: futurePrice,
    futurePrices: futurePrices,
    timestamp: new Date().toISOString(),
    expiryDates: expiries.map(formatExpiry),
    byExpiry: {
      [nseTargetExpiry]: strikeRecords
    }
  };

  chainCache.set(symbol, { data: finalResponse, timestamp: Date.now() });

  // Broadcast tick diffs (1KB) instead of 100KB polling payload
  io.emit('market_tick', { symbol, spot: spotPrice, timestamp: finalResponse.timestamp });
  
  return finalResponse;
    } finally {
      flightPromises.delete(cacheKey);
    }
  })();
  
  flightPromises.set(cacheKey, fetchPromise);
  return fetchPromise;
}
