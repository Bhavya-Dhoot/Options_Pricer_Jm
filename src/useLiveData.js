/**
 * useLiveData — React hook for fetching live NIFTY data from the local proxy.
 *
 * Returns:
 *   { data, isLoading, error, isLive, lastUpdate, fetchNow, startAutoRefresh, stopAutoRefresh }
 *
 * data shape:
 *   { spot, futurePrice, expiryDates, byExpiry, timestamp }
 */

import { useState, useCallback, useRef, useEffect } from 'react';

const API_BASE = '/api'; // Vite proxy forwards to localhost:3001

// IST market hours: 9:15 AM – 3:30 PM (UTC+5:30)
function isMarketHours() {
  const now = new Date();
  const istOffset = 5.5 * 60; // minutes
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istMinutes = utcMinutes + istOffset;
  const marketOpen = 9 * 60 + 15;  // 9:15 AM
  const marketClose = 15 * 60 + 30; // 3:30 PM
  const day = now.getUTCDay();
  // Adjust day for IST (UTC+5:30)
  const istDay = (utcMinutes + istOffset >= 1440) ? (day + 1) % 7 : day;
  return istDay >= 1 && istDay <= 5 && istMinutes >= marketOpen && istMinutes <= marketClose;
}

export function useLiveData() {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [isLive, setIsLive] = useState(false);
  const intervalRef = useRef(null);

  const fetchNow = useCallback(async (symbol = 'NIFTY', { force = true, expiry = null, futExpiry = null } = {}) => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ symbol });
      if (force) params.set('force', 'true');
      if (expiry) params.set('optExpiry', expiry);
      if (futExpiry) params.set('futExpiry', futExpiry);

      const res = await fetch(`${API_BASE}/option-chain?${params}`, {
        cache: 'no-store',                    // bypass browser HTTP cache
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server returned ${res.status}`);
      }

      const json = await res.json();
      console.log(`[useLiveData] Got ${symbol}: spot=${json.spot}, cached=${json.cached}, timestamp=${json.timestamp}`);
      setData(json);
      setLastUpdate(new Date());
      setIsLoading(false);
      return json;
    } catch (err) {
      setError(err.message);
      setIsLoading(false);
      return null;
    }
  }, []);

  const startAutoRefresh = useCallback((intervalMs = 30000, symbol = 'NIFTY') => {
    stopAutoRefresh();
    setIsLive(true);

    // Fetch immediately with force (user-initiated)
    fetchNow(symbol, { force: true });

    intervalRef.current = setInterval(() => {
      // Only fetch during market hours to avoid unnecessary requests
      if (isMarketHours()) {
        fetchNow(symbol, { force: false }); // cache ok for background polling
      }
    }, intervalMs);
  }, [fetchNow]);

  const stopAutoRefresh = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsLive(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return {
    data,
    isLoading,
    error,
    isLive,
    lastUpdate,
    fetchNow,
    startAutoRefresh,
    stopAutoRefresh,
  };
}

export function useAvailableExpiries(symbol = 'NIFTY') {
  const [optExpiries, setOptExpiries] = useState([]);
  const [futExpiries, setFutExpiries] = useState([]);
  
  useEffect(() => {
    let mounted = true;
    fetch(`${API_BASE}/expiries?symbol=${symbol}`)
      .then(res => res.json())
      .then(data => {
        if (mounted) {
          if (data.optExpiries) setOptExpiries(data.optExpiries);
          else if (data.expiries) setOptExpiries(data.expiries); // backwards compatibility
          
          if (data.futExpiries) setFutExpiries(data.futExpiries);
        }
      })
      .catch(err => console.error('Failed to fetch expiries:', err));
      
    return () => { mounted = false; };
  }, [symbol]);

  return { optExpiries, futExpiries };
}

/**
 * Helper: find the ATM strike from chain data for a given expiry.
 */
export function findATMStrike(chain, expiryDate, spot) {
  const strikes = chain?.byExpiry?.[expiryDate];
  if (!strikes || strikes.length === 0) return null;

  let closest = strikes[0];
  let minDiff = Math.abs(strikes[0].strikePrice - spot);

  for (const s of strikes) {
    const diff = Math.abs(s.strikePrice - spot);
    if (diff < minDiff) {
      minDiff = diff;
      closest = s;
    }
  }

  return closest;
}

/**
 * Helper: convert NSE date format "28-May-2026" to "2026-05-28".
 */
export function nseToISODate(nseDate) {
  if (!nseDate) return '';
  const months = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  };
  const parts = nseDate.split('-');
  if (parts.length !== 3) return nseDate;
  const [day, mon, year] = parts;
  return `${year}-${months[mon] || '01'}-${day.padStart(2, '0')}`;
}
