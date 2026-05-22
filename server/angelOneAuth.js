import axios from 'axios';
import { TOTP } from 'totp-generator';
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.ANGEL_API_KEY;
const CLIENT_ID = process.env.ANGEL_CLIENT_ID;
const PIN = process.env.ANGEL_PIN;
const TOTP_SECRET = process.env.ANGEL_TOTP_SECRET;

const BASE_URL = 'https://apiconnect.angelbroking.com';

let session = null;

const getHeaders = () => ({
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'X-UserType': 'USER',
  'X-SourceID': 'WEB',
  'X-ClientLocalIP': '127.0.0.1',
  'X-ClientPublicIP': '127.0.0.1',
  'X-MACAddress': '00-00-00-00-00-00',
  'X-PrivateKey': API_KEY,
});

export async function getAngelSession() {
  if (session && session.jwtToken) {
    // Optionally check if token is expired, but for now just return it
    // If API calls fail with 401, we can clear session and retry
    return session;
  }

  if (!API_KEY || !CLIENT_ID || !PIN || !TOTP_SECRET) {
    throw new Error('Angel One credentials missing in .env');
  }

  const { otp } = await TOTP.generate(TOTP_SECRET);

  try {
    console.log('[Angel One] Authenticating...');
    const response = await axios.post(`${BASE_URL}/rest/auth/angelbroking/user/v1/loginByPassword`, {
      clientcode: CLIENT_ID,
      password: PIN,
      totp: otp
    }, {
      headers: getHeaders()
    });

    if (response.data.status && response.data.data) {
      session = response.data.data;
      console.log('[Angel One] Authentication successful!');
      return session;
    } else {
      throw new Error(response.data.message || 'Authentication failed');
    }
  } catch (error) {
    console.error('[Angel One] Auth Error:', error.response?.data || error.message);
    throw error;
  }
}

export function clearSession() {
  session = null;
}

// ==========================================
// CENTRAL CHOKE POINT: ENDPOINT-AWARE RATE LIMITER
// ==========================================

const API_LIMITS = {
  '/rest/auth/angelbroking/user/v1/loginByPassword': { s: 1, m: Infinity, h: Infinity },
  '/rest/auth/angelbroking/jwt/v1//generateTokens': { s: 1, m: Infinity, h: 1000 },
  '/rest/secure/angelbroking/user/v1/getProfile': { s: 3, m: Infinity, h: 1000 },
  '/rest/secure/angelbroking/user/v1/logout': { s: 1, m: Infinity, h: Infinity },
  '/rest/secure/angelbroking/user/v1/getRMS': { s: 2, m: Infinity, h: Infinity },
  '/rest/secure/angelbroking/order/v1/getOrderBook': { s: 1, m: Infinity, h: Infinity },
  '/rest/secure/angelbroking/order/v1/getLtpData': { s: 10, m: 500, h: 5000 },
  '/rest/secure/angelbroking/order/v1/getPosition': { s: 1, m: Infinity, h: Infinity },
  '/rest/secure/angelbroking/order/v1/getTradeBook': { s: 1, m: Infinity, h: Infinity },
  '/rest/secure/angelbroking/order/v1/searchScrip': { s: 1, m: Infinity, h: Infinity },
  '/rest/secure/angelbroking/portfolio/v1/getHolding': { s: 1, m: Infinity, h: Infinity },
  '/rest/secure/angelbroking/portfolio/v1/getAllHolding': { s: 1, m: Infinity, h: Infinity },
  '/rest/secure/angelbroking/market/v1/quote': { s: 10, m: 500, h: 5000 },
  '/rest/secure/angelbroking/margin/v1/batch': { s: 10, m: 500, h: 5000 },
  '/rest/secure/angelbroking/gtt/v1/ruleDetails': { s: 10, m: 500, h: 5000 },
  '/rest/secure/angelbroking/gtt/v1/ruleList': { s: 10, m: 500, h: 5000 },
  '/rest/secure/angelbroking/historical/v1/getCandleData': { s: 3, m: 180, h: 5000 },
  '/rest/secure/angelbroking/marketData/v1/optionGreek': { s: 1, m: Infinity, h: Infinity }
};

const requestQueue = [];
let isProcessingQueue = false;
const endpointTimestamps = new Map(); // Stores timestamps per endpoint

const getRequiredDelay = (endpoint) => {
  // Normalize dynamic endpoints like details/{GuiOrderID} if needed, but for now exact match is fine
  // Fallback limit for unknown endpoints
  const limits = API_LIMITS[endpoint] || { s: 1, m: 60, h: 1000 };
  
  if (!endpointTimestamps.has(endpoint)) {
    endpointTimestamps.set(endpoint, []);
  }
  
  let timestamps = endpointTimestamps.get(endpoint);
  const now = Date.now();
  
  // Prune timestamps older than 1 hour (3600000 ms)
  timestamps = timestamps.filter(t => now - t <= 3600000);
  endpointTimestamps.set(endpoint, timestamps);

  // Filter timestamps into the 3 windows
  const last1Sec = timestamps.filter(t => now - t <= 1000);
  const last60Sec = timestamps.filter(t => now - t <= 60000);
  const last3600Sec = timestamps; // Already pruned to 1 hr

  let requiredDelay = 0;

  // Window 1: Limit per second
  if (last1Sec.length >= limits.s) {
    const oldest = last1Sec[last1Sec.length - limits.s]; 
    const delay = 1000 - (now - oldest);
    if (delay > requiredDelay) requiredDelay = delay;
  }

  // Window 2: Limit per minute
  if (limits.m !== Infinity && last60Sec.length >= limits.m) {
    const oldest = last60Sec[last60Sec.length - limits.m];
    const delay = 60000 - (now - oldest);
    if (delay > requiredDelay) requiredDelay = delay;
  }

  // Window 3: Limit per hour
  if (limits.h !== Infinity && last3600Sec.length >= limits.h) {
    const oldest = last3600Sec[last3600Sec.length - limits.h];
    const delay = 3600000 - (now - oldest);
    if (delay > requiredDelay) requiredDelay = delay;
  }

  return requiredDelay;
};

const processQueue = async () => {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (requestQueue.length > 0) {
    const nextRequest = requestQueue[0];
    const requiredDelay = getRequiredDelay(nextRequest.endpoint);
    
    if (requiredDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, requiredDelay + 10)); // +10ms padding
    }
    
    const { endpoint, requestFn, resolve, reject } = requestQueue.shift();
    endpointTimestamps.get(endpoint).push(Date.now());
    
    try {
      const result = await requestFn();
      resolve(result);
    } catch (error) {
      reject(error);
    }
  }

  isProcessingQueue = false;
};

const executeAxiosRequest = async (endpoint, payload, jwtToken) => {
  const response = await axios.post(`${BASE_URL}${endpoint}`, payload, {
    headers: {
      ...getHeaders(),
      'Authorization': `Bearer ${jwtToken}`
    }
  });

  if (!response.data.status) {
    if (response.data.errorcode === 'AB1004' || response.data.message.includes('Invalid Token')) {
      throw { isTokenExpired: true };
    }
    throw new Error(response.data.message || 'SmartAPI request failed');
  }

  return response.data;
};

export async function smartApiRequest(endpoint, payload) {
  const sessionData = await getAngelSession();
  
  return new Promise((resolve, reject) => {
    requestQueue.push({
      endpoint,
      requestFn: async () => {
        try {
          const data = await executeAxiosRequest(endpoint, payload, sessionData.jwtToken);
          return data;
        } catch (error) {
          if (error.isTokenExpired) {
            console.log('[Angel One] Token expired, renewing...');
            clearSession();
            const newSession = await getAngelSession();
            // Retry once immediately
            return await executeAxiosRequest(endpoint, payload, newSession.jwtToken);
          }
          console.error(`[Angel One] Request Error (${endpoint}):`, error.response?.data || error.message);
          throw error;
        }
      },
      resolve,
      reject
    });
    
    // Trigger the pump
    processQueue();
  });
}
