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
// CENTRAL CHOKE POINT: TRI-WINDOW RATE LIMITER
// Limits for /quote: 10/sec, 500/min, 5000/hour
// ==========================================
const requestQueue = [];
let isProcessingQueue = false;
let requestTimestamps = []; // Stores timestamps of executed requests

const getRequiredDelay = () => {
  const now = Date.now();
  // Prune timestamps older than 1 hour (3600000 ms)
  requestTimestamps = requestTimestamps.filter(t => now - t <= 3600000);

  // Filter timestamps into the 3 windows
  const last1Sec = requestTimestamps.filter(t => now - t <= 1000);
  const last60Sec = requestTimestamps.filter(t => now - t <= 60000);
  const last3600Sec = requestTimestamps; // Already pruned to 1 hr

  let requiredDelay = 0;

  // Window 1: 10 per second
  if (last1Sec.length >= 10) {
    const oldestIn1Sec = last1Sec[last1Sec.length - 10]; // 10th most recent
    const delayToClear1Sec = 1000 - (now - oldestIn1Sec);
    if (delayToClear1Sec > requiredDelay) requiredDelay = delayToClear1Sec;
  }

  // Window 2: 500 per minute
  if (last60Sec.length >= 500) {
    const oldestIn60Sec = last60Sec[last60Sec.length - 500];
    const delayToClear60Sec = 60000 - (now - oldestIn60Sec);
    if (delayToClear60Sec > requiredDelay) requiredDelay = delayToClear60Sec;
  }

  // Window 3: 5000 per hour
  if (last3600Sec.length >= 5000) {
    const oldestIn3600Sec = last3600Sec[last3600Sec.length - 5000];
    const delayToClear3600Sec = 3600000 - (now - oldestIn3600Sec);
    if (delayToClear3600Sec > requiredDelay) requiredDelay = delayToClear3600Sec;
  }

  return requiredDelay;
};

const processQueue = async () => {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (requestQueue.length > 0) {
    const requiredDelay = getRequiredDelay();
    
    if (requiredDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, requiredDelay + 10)); // +10ms padding
    }
    
    const { requestFn, resolve, reject } = requestQueue.shift();
    requestTimestamps.push(Date.now());
    
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
