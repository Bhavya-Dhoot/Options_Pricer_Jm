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

export async function smartApiRequest(endpoint, payload) {
  const sessionData = await getAngelSession();
  
  try {
    const response = await axios.post(`${BASE_URL}${endpoint}`, payload, {
      headers: {
        ...getHeaders(),
        'Authorization': `Bearer ${sessionData.jwtToken}`
      }
    });

    if (!response.data.status) {
      if (response.data.errorcode === 'AB1004' || response.data.message.includes('Invalid Token')) {
        console.log('[Angel One] Token expired, renewing...');
        clearSession();
        // Retry once
        const newSession = await getAngelSession();
        const retryResponse = await axios.post(`${BASE_URL}${endpoint}`, payload, {
          headers: {
            ...getHeaders(),
            'Authorization': `Bearer ${newSession.jwtToken}`
          }
        });
        return retryResponse.data;
      }
      throw new Error(response.data.message || 'SmartAPI request failed');
    }

    return response.data;
  } catch (error) {
    console.error(`[Angel One] Request Error (${endpoint}):`, error.response?.data || error.message);
    throw error;
  }
}
