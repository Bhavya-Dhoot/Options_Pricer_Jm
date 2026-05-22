import axios from 'axios';

let scripMaster = [];
let nfoMaster = [];
let nseMaster = [];

const SCRIP_MASTER_URL = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';

export async function initScripMaster() {
  if (scripMaster.length > 0) return;
  console.log('[ScripMaster] Downloading OpenAPIScripMaster.json... (this may take a moment)');
  try {
    const response = await axios.get(SCRIP_MASTER_URL);
    scripMaster = response.data;
    
    // Filter to just NSE/BSE and NFO/BFO for fast lookups
    nfoMaster = scripMaster.filter(s => (s.exch_seg === 'NFO' || s.exch_seg === 'BFO') && 
      (s.instrumenttype === 'OPTIDX' || s.instrumenttype === 'OPTSTK' || 
       s.instrumenttype === 'FUTIDX' || s.instrumenttype === 'FUTSTK'));
    nseMaster = scripMaster.filter(s => s.exch_seg === 'NSE' || s.exch_seg === 'BSE');
    
    console.log(`[ScripMaster] Loaded ${nseMaster.length} Spot equities/indices and ${nfoMaster.length} Options/Futures.`);
  } catch (err) {
    console.error('[ScripMaster] Failed to download Scrip Master:', err.message);
    throw err;
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
  if (symbol === 'BANKEX') return '99919013'; // Typically 99919013, though relies on nseMaster fallback too
  
  return null;
}

export function getOptionTokens(symbol, expiryDate = null) {
  // expiryDate format expected in NFO is usually DDMMMYYYY (e.g., 25MAY2026)
  let filtered = nfoMaster.filter(s => s.name === symbol && s.instrumenttype.startsWith('OPT'));
  
  if (expiryDate) {
    filtered = filtered.filter(s => s.expiry === expiryDate);
  }
  
  return filtered;
}

export function getFutureToken(symbol, expiryDate) {
  let filtered = nfoMaster.filter(s => s.name === symbol && s.instrumenttype.startsWith('FUT'));
  if (expiryDate) {
    filtered = filtered.filter(s => s.expiry === expiryDate);
  }
  // There is usually only one future per expiry, return the first one's token
  return filtered.length > 0 ? filtered[0].token : null;
}

export function getAvailableExpiries(symbol) {
  const options = nfoMaster.filter(s => s.name === symbol && s.instrumenttype.startsWith('OPT'));
  const expiries = new Set(options.map(s => s.expiry));
  
  // Sort expiries chronologically
  // Angel One expiry format is usually DDMMMYYYY (e.g., "28MAY2026")
  const parseDate = (dStr) => {
    if (!dStr) return 0;
    const day = parseInt(dStr.slice(0, 2), 10);
    const monthStr = dStr.slice(2, 5);
    const year = parseInt(dStr.slice(5), 10);
    const months = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
    return new Date(year, months[monthStr], day).getTime();
  };

  return Array.from(expiries).sort((a, b) => parseDate(a) - parseDate(b));
}
