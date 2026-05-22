import express from 'express';
import cors from 'cors';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAngelSession, smartApiRequest } from './angelOneAuth.js';
import { 
  initScripMaster, 
  getUnderlyingToken, 
  getOptionTokens, 
  getAvailableExpiries, 
  getFutureToken,
  getAvailableFutureExpiries,
  getLotSize 
} from './scripMaster.js';
import { solveImpliedIV } from '../src/bsm.js';
import { connectDB } from './src/infrastructure/db.js';
import { seedSuperUser } from './src/application/seed.js';
import { startPriceCacheLoop } from './src/application/priceCache.js';
import authRouter from './src/presentation/authRouter.js';
import tradeRouter from './src/presentation/tradeRouter.js';
import strategyRouter from './src/presentation/strategyRouter.js';
import backtestRouter from './src/presentation/backtestRouter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// BSM Optimization: Warm-Start Newton-Raphson cache
const ivCache = new Map();

const app = express();
const PORT = process.env.PORT || 3001;

// Network Optimization: Gzip compress all JSON payloads (reduces 50KB to 3KB)
app.use(compression());
app.use(cors());
app.use(express.json());

connectDB().then(() => {
  seedSuperUser();
  startPriceCacheLoop();
});

app.use('/api/auth', authRouter);
app.use('/api/trades', tradeRouter);
app.use('/api/strategies', strategyRouter);
app.use('/api/backtest', backtestRouter);

// Serve static frontend from 'dist' directory in production
app.use(express.static(path.join(__dirname, '../dist')));

// Initialize Scrip Master on startup
initScripMaster().catch(err => {
  console.error("Failed to initialize Scrip Master:", err);
});

// Authenticate on startup to test credentials
getAngelSession().then(() => {
  console.log("Angel One connection established.");
}).catch(err => {
  console.error("Angel One initial auth failed:", err.message);
});

// Cache
let cache = {
  data: null,
  timestamp: 0,
  symbol: null
};

export async function fetchMarketDataChain(symbol, targetExpiry, futureExpiry) {
  symbol = symbol?.toUpperCase() || 'NIFTY';
  
  const spotToken = getUnderlyingToken(symbol);
  if (!spotToken) throw new Error(`Underlying token not found for ${symbol}`);

  const spotExchange = (symbol === 'SENSEX' || symbol === 'BANKEX') ? 'BSE' : 'NSE';

  // OPTIMIZATION: Use cached spot price to estimate ATM strikes to save an API call
  let approxSpot = (cache.data && cache.symbol === symbol) ? cache.data.spot : null;
  
  if (!approxSpot) {
    const spotQuote = await smartApiRequest('/rest/secure/angelbroking/market/v1/quote/', {
      mode: 'FULL',
      exchangeTokens: {
        [spotExchange]: [spotToken]
      }
    });
      const spotData = spotQuote?.data?.fetched?.[0];
      if (!spotData) {
        return res.status(500).json({ error: `Could not fetch spot price for ${symbol}` });
      }
      approxSpot = spotData.ltp;
    }

    // 2. Find Requested or Nearest Expiry
    const expiries = getAvailableExpiries(symbol);
    if (expiries.length === 0) {
      return res.status(404).json({ error: `No expiries found for ${symbol}` });
    }
    
    const finalTargetExpiry = targetExpiry || expiries[0];
    
    // 3. Find Options Tokens around Spot
    const optionsForExpiry = getOptionTokens(symbol, finalTargetExpiry);
    
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

    // OPTIMIZATION: Reduce to ±10 strikes so total payload fits in 1 API call (limit 50)
    const startIndex = Math.max(0, closestIndex - 10);
    const endIndex = Math.min(allStrikes.length - 1, closestIndex + 10);
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

    // Enforce 49 max so spotToken makes it exactly 50 max
    const finalOptTokens = tokensToFetch.slice(0, 49);

    // 4. Unified Fetch! (Bundle Spot + Options)
    const fetchedOptions = [];
    let spotPrice = approxSpot;
    const optExchange = (symbol === 'SENSEX' || symbol === 'BANKEX') ? 'BFO' : 'NFO';
    
    const unifiedQuote = await smartApiRequest('/rest/secure/angelbroking/market/v1/quote/', {
      mode: 'FULL',
      exchangeTokens: {
        [spotExchange]: [spotToken],
        [optExchange]: finalOptTokens
      }
    });

    if (unifiedQuote?.data?.fetched) {
      unifiedQuote.data.fetched.forEach(item => {
        if (item.symbolToken === spotToken && (item.exchange === 'NSE' || item.exchange === 'BSE')) {
          spotPrice = item.ltp;
        } else {
          fetchedOptions.push(item);
        }
      });
    }

    // 5. Construct NSE-like Response
    const formatExpiry = (angelExp) => {
      if (!angelExp || angelExp.length < 9) return angelExp;
      const day = angelExp.slice(0, 2);
      const month = angelExp.slice(2, 5);
      const year = angelExp.slice(5);
      const formattedMonth = month.charAt(0) + month.slice(1).toLowerCase();
      return `${day}-${formattedMonth}-${year}`;
    };

    const futExpTarget = futureExpiry || finalTargetExpiry;
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

    const nseTargetExpiry = formatExpiry(finalTargetExpiry);
    const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
    const parts = nseTargetExpiry.split('-');
    const expiryDateObj = new Date(parseInt(parts[2]), months[parts[1]], parseInt(parts[0]));
    
    const T = Math.max(0.5, (expiryDateObj.getTime() - Date.now()) / 86400000) / 365;

    const strikeRecords = relevantStrikes.map(strike => {
      const record = { strikePrice: strike, call: null, put: null };
      
      const ceToken = strikesMap[strike].CE?.token;
      const peToken = strikesMap[strike].PE?.token;
      
      const ceQuote = ceToken ? optQuoteMap[ceToken] : null;
      const peQuote = peToken ? optQuoteMap[peToken] : null;

      if (ceQuote) {
        const bestBuy = ceQuote.depth?.buy?.[0];
        const bestSell = ceQuote.depth?.sell?.[0];
        
        let prevCalcIV = ivCache.get(ceToken) || 0.20;
        let calcIV = solveImpliedIV(spotPrice, strike, T, 0.065, ceQuote.ltp, 'CALL', 0.012, prevCalcIV) || 0.15;
        ivCache.set(ceToken, calcIV);
        
        record.call = {
          ltp: ceQuote.ltp,
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

        let prevCalcIV = ivCache.get(peToken) || 0.20;
        let calcIV = solveImpliedIV(spotPrice, strike, T, 0.065, peQuote.ltp, 'PUT', 0.012, prevCalcIV) || 0.15;
        ivCache.set(peToken, calcIV);

        record.put = {
          ltp: peQuote.ltp,
          oi: peQuote.openInterest,
          bidPrice: bestBuy?.price || 0,
          bidQty: bestBuy?.quantity || 0,
          askPrice: bestSell?.price || 0,
          askQty: bestSell?.quantity || 0,
          iv: calcIV * 100
        };
      }
      
      return record;
    });

    const finalResponse = {
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

    cache = { data: finalResponse, timestamp: Date.now(), symbol };
    return finalResponse;
}

app.get('/api/option-chain', async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase() || 'NIFTY';
  const force = req.query.force === 'true';
  const targetExpiry = req.query.optExpiry || req.query.expiry;
  const futureExpiry = req.query.futExpiry;

  console.log(`[/api/option-chain] Request for ${symbol}`);

  if (!force && cache.data && cache.symbol === symbol && (Date.now() - cache.timestamp < 15000)) {
    return res.json(cache.data);
  }

  try {
    const finalResponse = await fetchMarketDataChain(symbol, targetExpiry, futureExpiry);
    res.json(finalResponse);
  } catch (error) {
    console.error(`[/api/option-chain] Error for ${symbol}:`, error.message);
    res.status(error.message.includes('not found') ? 404 : 500).json({ error: error.message });
  }
});

app.get('/api/expiries', (req, res) => {
  try {
    const symbol = req.query.symbol || 'NIFTY';
    const optExpiries = getAvailableExpiries(symbol);
    const futExpiries = getAvailableFutureExpiries(symbol);

    const formatExpiry = (angelExp) => {
      if (!angelExp || angelExp.length < 9) return angelExp;
      const day = angelExp.slice(0, 2);
      const month = angelExp.slice(2, 5);
      const year = angelExp.slice(5);
      const formattedMonth = month.charAt(0) + month.slice(1).toLowerCase();
      return `${day}-${formattedMonth}-${year}`;
    };

    res.json({ 
      expiries: optExpiries.map(formatExpiry),
      optExpiries: optExpiries.map(formatExpiry), 
      futExpiries: futExpiries.map(formatExpiry) 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// All other GET requests not handled by API will return the React app
app.get('/*path', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`[Proxy] Server running on port ${PORT}`);
  console.log(`[Proxy] Using Angel One SmartAPI`);
});
