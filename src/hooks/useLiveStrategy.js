import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { estimateMargin } from '../utils/marginCalculator.js';
import { useAvailableExpiries } from '../useLiveData.js';

function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => { setDebouncedValue(value); }, delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

export function calculateDTE(expiryStr) {
  if (!expiryStr) return 30;
  try {
    const day = parseInt(expiryStr.slice(0, 2), 10);
    const monthStr = expiryStr.slice(3, 6);
    const year = parseInt(expiryStr.slice(7), 10);
    const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
    const month = months[monthStr];
    if (month === undefined) return 30;
    const expiryDate = new Date(year, month, day, 15, 30, 0); // 3:30 PM
    const diff = expiryDate.getTime() - Date.now();
    return Math.max(diff / (1000 * 60 * 60 * 24), 1);
  } catch (e) {
    return 30;
  }
}

export function getLotSize(sym, liveDataLotSize) {
  if (liveDataLotSize) return liveDataLotSize;
  if (sym === 'BANKNIFTY') return 15;
  if (sym === 'FINNIFTY') return 40;
  if (sym === 'MIDCPNIFTY') return 75;
  if (sym === 'SENSEX') return 10;
  if (sym === 'BANKEX') return 15;
  if (sym === 'NIFTY') return 25;
  return 1; // Default for equities
}

export function useLiveStrategy({ live, riskFreeRate, onTradeExecuted, injectedLegs }) {
  const [legs, setLegs] = useState([]);
  const [targetExpiry, setTargetExpiry] = useState('');
  const [targetFutExpiry, setTargetFutExpiry] = useState('');

  // Backtest Mode State
  const [isBacktestMode, setIsBacktestMode] = useState(false);
  const [backtestTimestamps, setBacktestTimestamps] = useState([]);
  const [selectedTimestamp, setSelectedTimestamp] = useState('');

  // Custom hook to fetch expiries
  const { optExpiries = [], futExpiries = [] } = useAvailableExpiries(live.data?.symbol || 'NIFTY') || {};

  // Modals & Loaders
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDesc, setSaveDesc] = useState('');
  const [savedStrategies, setSavedStrategies] = useState([]);
  const [showLoadModal, setShowLoadModal] = useState(false);

  // Inject read-only comparative legs from PaperTradeDashboard
  useEffect(() => {
    if (injectedLegs && injectedLegs.length > 0) {
      setLegs(prev => {
        const userLegs = prev.filter(l => !l.isComparative);
        return [...injectedLegs, ...userLegs];
      });
    }
  }, [injectedLegs]);

  const prevSymbolData = useRef({ symbol: '', spot: 0 });

  // Transpose strategy completely if the underlying symbol changes to prevent strike/expiry mismatch
  useEffect(() => {
    if (!live.data?.symbol) return;
    
    if (prevSymbolData.current.symbol && prevSymbolData.current.symbol !== live.data.symbol) {
      const oldSpot = prevSymbolData.current.spot;
      const newSpot = live.data.spot;
      
      const getStep = (sym, spot) => {
        if (sym === 'BANKNIFTY' || sym === 'SENSEX' || spot > 50000) return 100;
        if (spot < 5000) return 10;
        return 50;
      };
      
      const oldStep = getStep(prevSymbolData.current.symbol, oldSpot);
      const newStep = getStep(live.data.symbol, newSpot);
      
      const oldAtm = Math.round(oldSpot / oldStep) * oldStep;
      const newAtm = Math.round(newSpot / newStep) * newStep;
      
      const newLotSize = getLotSize(live.data.symbol, live.data.lotSize);
      
      setLegs(prev => prev.map(leg => {
        if (leg.isComparative) return leg; // Leave injected legs alone (or they get filtered by UI)
        
        const newLeg = { ...leg, lotSize: newLotSize };
        
        if (leg.type === 'future') {
           newLeg.premium = newSpot; // Approximate reset
        } else {
           const offsetSteps = Math.round((leg.strike - oldAtm) / oldStep);
           newLeg.strike = newAtm + (offsetSteps * newStep);
           newLeg.premium = 0; // Reset premium to wait for next tick
        }
        return newLeg;
      }));
      
      setTargetExpiry('');
      setTargetFutExpiry('');
    }
    
    prevSymbolData.current = { symbol: live.data.symbol, spot: live.data.spot };
  }, [live.data?.symbol]);

  // Fetch backtest timestamps when toggled on
  useEffect(() => {
    if (isBacktestMode) {
      const sym = live.data?.symbol || 'NIFTY';
      fetch(`/api/backtest/timestamps?symbol=${sym}`)
        .then(res => res.json())
        .then(data => {
          setBacktestTimestamps(data);
          if (data.length > 0 && !selectedTimestamp) setSelectedTimestamp(data[0]);
        })
        .catch(console.error);
    }
  }, [isBacktestMode, live.data?.symbol]);

  // Fetch snapshot when timestamp changes
  useEffect(() => {
    if (isBacktestMode && selectedTimestamp) {
      live.fetchNow(live.data?.symbol || 'NIFTY', { backtestTimestamp: selectedTimestamp });
    }
  }, [isBacktestMode, selectedTimestamp]);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      fetch('/api/strategies', { headers: { 'Authorization': `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setSavedStrategies(data);
        })
        .catch(() => {});
    }
  }, []);

  const isExpiriesLoading = optExpiries.length === 0;

  const globalInputs = useMemo(() => {
    const spot = live.data?.spot || 24500;
    let iv = 0.15;
    if (live.data?.strikeRecords && live.data?.currentExpiry === targetExpiry) {
      const strikes = live.data.strikeRecords.map(s => s.strike);
      if (strikes.length > 0) {
        const atm = strikes.reduce((prev, curr) => Math.abs(curr - spot) < Math.abs(prev - spot) ? curr : prev, strikes[0]);
        const atmData = live.data.strikeRecords.find(s => s.strike === atm);
        if (atmData) {
          iv = (atmData.call?.iv || atmData.put?.iv || 15) / 100;
        }
      }
    }
    const dte = calculateDTE(targetExpiry);
    const farDte = calculateDTE(targetFutExpiry);
    const lotSize = getLotSize(live.data?.symbol, live.data?.lotSize);

    return { spot, iv, rate: riskFreeRate / 100, dividend: 0.012, dte, farDte, lotSize };
  }, [live.data, targetExpiry, targetFutExpiry, riskFreeRate]);

  const debouncedLegs = useDebounce(legs, 300);
  const debouncedGlobalInputs = useDebounce(globalInputs, 300);

  useEffect(() => {
    if (optExpiries.length > 0 && !targetExpiry) setTargetExpiry(optExpiries[0]);
    if (futExpiries.length > 0 && !targetFutExpiry) setTargetFutExpiry(futExpiries[0]);
  }, [optExpiries, futExpiries, targetExpiry, targetFutExpiry]);

  // When live data updates, bind the exact premiums to the legs
  useEffect(() => {
    if (!live.data) return;
    setLegs(prevLegs => prevLegs.map(leg => {
      let newPremium = leg.premium;
      let newT = leg.type === 'future' ? (globalInputs.farDte / 365) : (globalInputs.dte / 365);
      
      if (leg.type === 'future') {
        const futExp = leg.expiry || targetFutExpiry || futExpiries?.[0];
        newPremium = live.data.futurePrices?.[futExp] || live.data.futurePrice || live.data.spot || 0;
      } else if (live.data.byExpiry && leg.expiry) {
        const records = live.data.byExpiry[leg.expiry];
        if (records) {
          const strikeData = records.find(s => Number(s.strikePrice || s.strike) === Number(leg.strike));
          if (strikeData) {
            const optData = leg.type === 'call' ? strikeData.call : strikeData.put;
            if (optData) {
              const bid = optData.bidPrice || optData.ltp || 0;
              const ask = optData.askPrice || optData.ltp || 0;
              newPremium = leg.action === 'sell' ? bid : ask;
            }
          }
        }
      }
      return { ...leg, premium: newPremium, T: newT };
    }));
  }, [live.data, globalInputs.dte, globalInputs.farDte]);

  const handleFetch = async (symbol) => {
    if (isBacktestMode && selectedTimestamp) {
      await live.fetchNow(symbol, { backtestTimestamp: selectedTimestamp, expiry: targetExpiry || null, futExpiry: targetFutExpiry || null });
    } else {
      await live.fetchNow(symbol, { force: true, expiry: targetExpiry || null, futExpiry: targetFutExpiry || null });
    }
  };

  const handleExpiryChange = (e) => {
    const newExp = e.target.value;
    setTargetExpiry(newExp);
    if (live.data?.symbol) {
      live.fetchNow(live.data.symbol, { force: false, expiry: newExp, futExpiry: targetFutExpiry });
    }
  };

  const handleFutExpiryChange = (e) => {
    const newExp = e.target.value;
    setTargetFutExpiry(newExp);
    if (live.data?.symbol) {
      live.fetchNow(live.data.symbol, { force: false, expiry: targetExpiry, futExpiry: newExp });
    }
  };

  const availableStrikes = useMemo(() => {
    if (!live.data?.byExpiry) return [];
    const targetExp = targetExpiry || live.data.expiryDates?.[0];
    const records = live.data.byExpiry[targetExp];
    if (!records) return [];
    return records.map(s => s.strikePrice || s.strike);
  }, [live.data, targetExpiry]);

  const addLeg = (type = 'call') => {
    let step = 50;
    const sym = live.data?.symbol || 'NIFTY';
    if (sym === 'BANKNIFTY' || sym === 'SENSEX' || sym === 'BANKEX') step = 100;
    else if (sym === 'FINNIFTY') step = 50;
    else if (sym === 'MIDCPNIFTY') step = 25;
    else if (sym !== 'NIFTY') step = 10; // Default for equities

    const defaultStrike = live.data?.spot ? Math.round(live.data.spot / step) * step : 24500;
    const exp = targetExpiry || live.data?.expiryDates?.[0];
    let initialPremium = 0;
    if (type === 'future') {
      const futExp = targetFutExpiry || futExpiries?.[0];
      initialPremium = live.data?.futurePrices?.[futExp] || live.data?.futurePrice || live.data?.spot || 0;
    } else if (live.data?.byExpiry && exp) {
      const records = live.data.byExpiry[exp];
      if (records) {
        const strikeData = records.find(s => Number(s.strikePrice || s.strike) === Number(defaultStrike));
        if (strikeData) {
          const optData = type === 'call' ? strikeData.call : strikeData.put;
          if (optData) initialPremium = optData.askPrice || optData.ltp || 0;
        }
      }
    }
    setLegs(prev => [...prev, {
      id: `leg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      type: type, action: 'buy', strike: type === 'future' ? 0 : defaultStrike, qty: 1, premium: initialPremium,
      lotSize: getLotSize(live.data?.symbol, live.data?.lotSize),
      T: type === 'future' ? (calculateDTE(targetFutExpiry || futExpiries?.[0]) / 365) : (calculateDTE(exp) / 365),
      expiry: type === 'future' ? (targetFutExpiry || futExpiries?.[0]) : exp
    }]);
  };

  const updateLeg = (id, updates) => {
    setLegs(prev => prev.map(l => {
      if (l.id !== id) return l;
      const updated = { ...l, ...updates };
      const exp = updated.expiry || targetExpiry || live.data?.expiryDates?.[0];
      if (updates.expiry !== undefined) updated.T = calculateDTE(updates.expiry) / 365;
      if (updates.strike !== undefined || updates.type !== undefined || updates.action !== undefined || updates.expiry !== undefined) {
        if (updated.type === 'future') {
          const futExp = updated.expiry || targetFutExpiry || futExpiries?.[0];
          updated.premium = live.data?.futurePrices?.[futExp] || live.data?.futurePrice || live.data?.spot || 0;
          updated.strike = 0;
        } else if (live.data?.byExpiry && exp) {
          const records = live.data.byExpiry[exp];
          if (records) {
            if (updated.strike === 0) {
              updated.strike = live.data?.spot ? Math.round(live.data.spot / 50) * 50 : 24500;
            }
            const strikeData = records.find(s => Number(s.strikePrice || s.strike) === Number(updated.strike));
            if (strikeData) {
              const optData = updated.type === 'call' ? strikeData.call : strikeData.put;
              if (optData) {
                const bid = optData.bidPrice || optData.ltp || 0;
                const ask = optData.askPrice || optData.ltp || 0;
                updated.premium = updated.action === 'sell' ? bid : ask;
              }
            }
          }
        }
      }
      return updated;
    }));
  };

  const removeLeg = (id) => setLegs(prev => prev.filter(l => l.id !== id));

  const handlePaperTrade = async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return alert('You must be logged in to Paper Trade! Please click the Paper Trading tab.');
    if (legs.length === 0) return alert('Add at least one leg to the strategy first.');

    try {
      const legsToExecute = legs.filter(leg => !leg.isComparative);
      if (legsToExecute.length === 0) return alert('No valid new legs to execute. Comparative legs cannot be traded again.');

      const formattedLegs = legsToExecute.map(leg => ({
        symbol: live.data?.symbol || 'NIFTY', type: leg.type, strike: leg.strike,
        expiry: leg.type === 'future' ? (leg.expiry || targetFutExpiry || futExpiries?.[0]) : (leg.expiry || targetExpiry || live.data?.expiryDates?.[0]),
        action: leg.action, orderType: 'market', qty: leg.qty, lotSize: leg.lotSize || getLotSize(live.data?.symbol, live.data?.lotSize), entryPrice: leg.premium
      }));

      const res = await fetch('/api/trades/batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ symbol: live.data?.symbol || 'NIFTY', legs: formattedLegs })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Batch trade execution failed');
      }

      alert('Strategy successfully executed in Paper Trading Portfolio!');
      setLegs([]);
      if (onTradeExecuted) onTradeExecuted();
    } catch (err) {
      alert(err.message || 'Failed to place paper trade. Check your connection.');
    }
  };

  const handleSaveStrategy = async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return alert('You must be logged in to save strategies.');
    if (!saveName) return alert('Name is required');

    try {
      const res = await fetch('/api/strategies', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          name: saveName, description: saveDesc,
          legs: legs.map(l => ({
            type: l.type, strike: l.strike, action: l.action, qty: l.qty,
            expiry: l.type === 'future' ? (targetFutExpiry || futExpiries?.[0]) : (l.expiry || targetExpiry || live.data?.expiryDates?.[0]),
            lotSize: l.lotSize
          }))
        })
      });
      if (res.ok) {
        const strat = await res.json();
        setSavedStrategies(prev => [strat, ...prev]);
        setShowSaveModal(false);
        setSaveName('');
        setSaveDesc('');
        alert('Strategy saved successfully!');
      }
    } catch (err) {
      alert('Failed to save strategy.');
    }
  };

  const loadStrategy = (strat) => {
    const loadedLegs = strat.legs.map((l, idx) => ({
      ...l, id: `loaded-${Date.now()}-${idx}`, premium: live.data?.spot || 0, iv: 0.15,
      T: l.expiry ? calculateDTE(l.expiry) / 365 : 0
    }));
    setLegs(loadedLegs);
    setShowLoadModal(false);
  };

  const estimatedMargin = useMemo(() => {
    return estimateMargin(legs, live.data?.spot || 24500, live.data?.symbol || 'NIFTY');
  }, [legs, live.data]);

  return {
    legs, setLegs, debouncedLegs,
    targetExpiry, setTargetExpiry, targetFutExpiry, setTargetFutExpiry,
    isBacktestMode, setIsBacktestMode, backtestTimestamps, selectedTimestamp, setSelectedTimestamp,
    optExpiries, futExpiries, isExpiriesLoading,
    showSaveModal, setShowSaveModal, saveName, setSaveName, saveDesc, setSaveDesc,
    savedStrategies, showLoadModal, setShowLoadModal,
    globalInputs, debouncedGlobalInputs,
    handleFetch, handleExpiryChange, handleFutExpiryChange,
    availableStrikes, addLeg, updateLeg, removeLeg, handlePaperTrade, handleSaveStrategy, loadStrategy,
    estimatedMargin
  };
}
