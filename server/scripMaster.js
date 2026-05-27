import axios from 'axios';

let scripMaster = [];
let nseMaster = [];

// Hash Maps for O(1) lookups
const optionsIndex = {}; // { NIFTY: { '25MAY2026': [tokenObj, ...] } }
const futuresIndex = {}; // { NIFTY: { '25MAY2026': tokenObj } }
const expiriesCache = {}; // { NIFTY: ['25MAY2026', ...] }
const futureExpiriesCache = {}; // { NIFTY: ['25MAY2026', ...] }
const lotSizeCache = {}; // { NIFTY: 25 }

const SCRIP_MASTER_URL = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';

const parseDate = (dStr) => {
  if (!dStr) return 0;
  const match = dStr.match(/(\d+)([a-zA-Z]+)(\d+)/);
  if (!match) return 0;
  const day = parseInt(match[1], 10);
  const monthStr = match[2].toUpperCase().substring(0, 3);
  const year = parseInt(match[3], 10);
  const months = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
  return new Date(year, months[monthStr] || 0, day).getTime();
};

let initPromise = null;
let isInitializing = false;

export function ensureScripMasterInitialized() {
  if (!initPromise) {
    initPromise = initScripMaster();
  }
  return initPromise;
}

export async function initScripMaster() {
  if (isInitializing) return;
  isInitializing = true;
  console.log('[ScripMaster] Downloading OpenAPIScripMaster.json... (this may take a moment)');
  try {
    const response = await axios.get(SCRIP_MASTER_URL);
    scripMaster = response.data;
    
    // Clear existing caches for fresh update
    nseMaster.length = 0;
    for (const key in optionsIndex) delete optionsIndex[key];
    for (const key in futuresIndex) delete futuresIndex[key];
    for (const key in expiriesCache) delete expiriesCache[key];
    for (const key in futureExpiriesCache) delete futureExpiriesCache[key];
    for (const key in lotSizeCache) delete lotSizeCache[key];
    
    // Hash map building
    const expSet = {};
    const futExpSet = {};

    for (let i = 0; i < scripMaster.length; i++) {
      const s = scripMaster[i];
      if (s.exch_seg === 'NSE' || s.exch_seg === 'BSE') {
        nseMaster.push({ symbol: s.symbol, name: s.name, token: s.token });
      } else if (s.exch_seg === 'NFO' || s.exch_seg === 'BFO') {
        const sym = s.name;
        
        // Filter out BFO for everything except SENSEX/BANKEX
        // Filter out NFO for SENSEX/BANKEX just in case
        const isBSEIndex = (sym === 'SENSEX' || sym === 'BANKEX');
        if (s.exch_seg === 'BFO' && !isBSEIndex) continue;
        if (s.exch_seg === 'NFO' && isBSEIndex) continue;
        
        if (!lotSizeCache[sym] && s.lotsize) {
          lotSizeCache[sym] = parseInt(s.lotsize, 10);
        }
        
        // Trim fat: Keep only required fields to save 150MB+ RAM
        const trimmedScrip = {
          token: s.token,
          symbol: s.symbol,
          name: s.name,
          expiry: s.expiry,
          strike: s.strike,
          lotsize: s.lotsize,
          instrumenttype: s.instrumenttype,
          tick_size: s.tick_size
        };

        if (s.instrumenttype.startsWith('OPT')) {
          if (!optionsIndex[sym]) { optionsIndex[sym] = {}; expSet[sym] = new Set(); }
          if (!optionsIndex[sym][s.expiry]) { optionsIndex[sym][s.expiry] = []; }
          
          optionsIndex[sym][s.expiry].push(trimmedScrip);
          expSet[sym].add(s.expiry);
          
        } else if (s.instrumenttype.startsWith('FUT')) {
          if (!futuresIndex[sym]) { futuresIndex[sym] = {}; futExpSet[sym] = new Set(); }
          if (!futuresIndex[sym][s.expiry]) { futuresIndex[sym][s.expiry] = trimmedScrip; }
          
          futExpSet[sym].add(s.expiry);
        }
      }
    }
    
    // Pre-sort expiries
    for (const sym of Object.keys(expSet)) {
      expiriesCache[sym] = Array.from(expSet[sym]).sort((a, b) => parseDate(a) - parseDate(b));
    }
    for (const sym of Object.keys(futExpSet)) {
      futureExpiriesCache[sym] = Array.from(futExpSet[sym]).sort((a, b) => parseDate(a) - parseDate(b));
    }

    console.log(`[ScripMaster] Loaded ${nseMaster.length} Spot equities and indexed ${Object.keys(optionsIndex).length} NFO/BFO derivatives into O(1) maps.`);
    
    // Aggressive Garbage Collection: Sever the reference to the 20MB raw JSON blob
    scripMaster.length = 0;
  } catch (err) {
    console.error('[ScripMaster] Failed to download Scrip Master:', err.message);
    throw err;
  } finally {
    isInitializing = false;
  }
}

export function getUnderlyingToken(symbol) {
  // Try to find the exact symbol in NSE
  const nseSymbol = `${symbol}-EQ`;
  const tokenObj = nseMaster.find(s => s.symbol === nseSymbol || s.name === symbol);
  
  if (tokenObj) {
    return tokenObj.token;
  }
  
  // Hardcoded index tokens if not found (NIFTY is usually 26000)
  if (symbol === 'NIFTY') return '26000';
  if (symbol === 'BANKNIFTY') return '26009';
  if (symbol === 'FINNIFTY') return '26037';
  if (symbol === 'MIDCPNIFTY') return '26074';
  if (symbol === 'SENSEX') return '99919000';
  if (symbol === 'BANKEX') return '99919013';
  
  return null;
}

export function getOptionTokens(symbol, expiryDate = null) {
  if (!optionsIndex[symbol]) return [];
  if (expiryDate) {
    return optionsIndex[symbol][expiryDate] || [];
  }
  return Object.values(optionsIndex[symbol]).flat();
}

export function getFutureToken(symbol, expiryDate) {
  if (!futuresIndex[symbol]) return null;
  if (expiryDate) {
    return futuresIndex[symbol][expiryDate]?.token || null;
  }
  const firstExp = Object.keys(futuresIndex[symbol])[0];
  return firstExp ? futuresIndex[symbol][firstExp].token : null;
}

export function getAvailableExpiries(symbol) {
  return expiriesCache[symbol] || [];
}

export function getAvailableFutureExpiries(symbol) {
  return futureExpiriesCache[symbol] || [];
}

export function getLotSize(symbol) {
  return lotSizeCache[symbol] || 1;
}

// Schedule updates at 9:00 AM (540 mins) and 12:30 PM (750 mins) IST
let lastUpdateMinute = -1;
setInterval(() => {
  const now = new Date();
  const istMinutes = now.getUTCHours() * 60 + now.getUTCMinutes() + 330;
  const currentMinuteOfDay = ((istMinutes % 1440) + 1440) % 1440;
  
  if ((currentMinuteOfDay === 540 || currentMinuteOfDay === 750) && lastUpdateMinute !== currentMinuteOfDay) {
    lastUpdateMinute = currentMinuteOfDay;
    console.log(`[ScripMaster] Scheduled update triggered at IST minute ${currentMinuteOfDay}`);
    initPromise = initScripMaster().catch(err => {
      console.error('[ScripMaster] Scheduled update failed:', err.message);
    });
  }
}, 30000); // Check every 30 seconds
