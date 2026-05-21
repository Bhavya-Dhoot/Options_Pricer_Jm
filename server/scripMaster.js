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
    
    // Filter to just NSE and NFO for fast lookups
    nfoMaster = scripMaster.filter(s => s.exch_seg === 'NFO' && (s.instrumenttype === 'OPTIDX' || s.instrumenttype === 'OPTSTK'));
    nseMaster = scripMaster.filter(s => s.exch_seg === 'NSE');
    
    console.log(`[ScripMaster] Loaded ${nseMaster.length} NSE equities and ${nfoMaster.length} NFO options.`);
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
  
  return null;
}

export function getOptionTokens(symbol, expiryDate = null) {
  // expiryDate format expected in NFO is usually DDMMMYYYY (e.g., 25MAY2026)
  let filtered = nfoMaster.filter(s => s.name === symbol);
  
  if (expiryDate) {
    filtered = filtered.filter(s => s.expiry === expiryDate);
  }
  
  return filtered;
}

export function getAvailableExpiries(symbol) {
  const options = nfoMaster.filter(s => s.name === symbol);
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
