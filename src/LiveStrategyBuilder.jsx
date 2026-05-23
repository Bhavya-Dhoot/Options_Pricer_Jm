import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw, Play, Settings, AlertTriangle, TrendingUp, Save, FolderOpen, BarChart2, Clock } from 'lucide-react';
import LiveFetchBar from './components/LiveFetchBar.jsx';
import LiveLegConfigurator from './components/strategies/LiveLegConfigurator.jsx';
import PayoffChart from './components/strategies/PayoffChart.jsx';
import StrategyMetricsBar from './components/strategies/StrategyMetricsBar.jsx';
import ProbabilityPanel from './components/strategies/ProbabilityPanel.jsx';
import ThetaDecayChart from './components/strategies/ThetaDecayChart.jsx';
import GreeksSurfaceChart from './components/strategies/GreeksSurfaceChart.jsx';
import ScenarioHeatmap from './components/strategies/ScenarioHeatmap.jsx';
import { estimateMargin } from './utils/marginCalculator.js';
import { useAvailableExpiries } from './useLiveData.js';
import { AlertCircle } from 'lucide-react';
import StrategyTemplates from './components/strategies/StrategyTemplates.jsx';

function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => { setDebouncedValue(value); }, delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

function calculateDTE(expiryStr) {
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
    const dte = Math.max(diff / (1000 * 60 * 60 * 24), 1);
    return dte;
  } catch (e) {
    return 30;
  }
}

export default function LiveStrategyBuilder({ live, riskFreeRate = 6.5, isPaperTradeMode = false, onTradeExecuted, injectedLegs }) {
  const [legs, setLegs] = useState([]);
  
  // Inject read-only comparative legs from PaperTradeDashboard
  useEffect(() => {
    if (injectedLegs && injectedLegs.length > 0) {
      setLegs(prev => {
        // Filter out previously injected comparative legs to prevent duplicates
        const userLegs = prev.filter(l => !l.isComparative);
        return [...injectedLegs, ...userLegs];
      });
    }
  }, [injectedLegs]);
  const [targetExpiry, setTargetExpiry] = useState('');
  const [targetFutExpiry, setTargetFutExpiry] = useState('');

  // Backtest Mode State
  const [isBacktestMode, setIsBacktestMode] = useState(false);
  const [backtestTimestamps, setBacktestTimestamps] = useState([]);
  const [selectedTimestamp, setSelectedTimestamp] = useState('');

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

  
  // Custom hook to fetch expiries
  const { optExpiries = [], futExpiries = [] } = useAvailableExpiries(live.data?.symbol || 'NIFTY') || {};
  // ----- Modals & Loaders -----
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDesc, setSaveDesc] = useState('');
  const [savedStrategies, setSavedStrategies] = useState([]);
  const [showLoadModal, setShowLoadModal] = useState(false);

  useEffect(() => {
    // Only load if logged in
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

    return {
      spot,
      iv,
      rate: riskFreeRate / 100,
      dividend: 0.012,
      dte,
      farDte
    };
  }, [live.data, targetExpiry, targetFutExpiry, riskFreeRate]);

  // Apply debouncing to heavy UI chart inputs
  const debouncedLegs = useDebounce(legs, 300);
  const debouncedGlobalInputs = useDebounce(globalInputs, 300);

  useEffect(() => {
    if (optExpiries.length > 0 && !targetExpiry) {
      setTargetExpiry(optExpiries[0]);
    }
    if (futExpiries.length > 0 && !targetFutExpiry) {
      setTargetFutExpiry(futExpiries[0]);
    }
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
          const strikeData = records.find(s => (s.strikePrice || s.strike) === leg.strike);
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
    // When they click fetch, fetch the specific expiry
    if (isBacktestMode && selectedTimestamp) {
      await live.fetchNow(symbol, {
        backtestTimestamp: selectedTimestamp,
        expiry: targetExpiry || null,
        futExpiry: targetFutExpiry || null
      });
    } else {
      await live.fetchNow(symbol, { 
        force: true, 
        expiry: targetExpiry || null,
        futExpiry: targetFutExpiry || null
      });
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

  const getLotSize = (sym) => {
    if (live.data?.lotSize) return live.data.lotSize;
    if (sym === 'BANKNIFTY') return 15;
    if (sym === 'FINNIFTY') return 40;
    if (sym === 'MIDCPNIFTY') return 75;
    if (sym === 'SENSEX') return 10;
    if (sym === 'BANKEX') return 15;
    return 25; // Default NIFTY
  };

  const addLeg = (type = 'call') => {
    const defaultStrike = live.data?.spot 
      ? Math.round(live.data.spot / 50) * 50 
      : 24500;
      
    const exp = targetExpiry || live.data?.expiryDates?.[0];
    
    let initialPremium = 0;
    if (type === 'future') {
      const futExp = targetFutExpiry || futExpiries?.[0];
      initialPremium = live.data?.futurePrices?.[futExp] || live.data?.futurePrice || live.data?.spot || 0;
    } else if (live.data?.byExpiry && exp) {
      const records = live.data.byExpiry[exp];
      if (records) {
        const strikeData = records.find(s => (s.strikePrice || s.strike) === defaultStrike);
        if (strikeData) {
          const optData = type === 'call' ? strikeData.call : strikeData.put;
          if (optData) {
            initialPremium = optData.askPrice || optData.ltp || 0;
          }
        }
      }
    }

    setLegs(prev => [...prev, {
      id: `leg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      type: type,
      action: 'buy',
      strike: type === 'future' ? 0 : defaultStrike,
      qty: 1,
      premium: initialPremium,
      lotSize: getLotSize(live.data?.symbol),
      T: type === 'future' ? (calculateDTE(targetFutExpiry || futExpiries?.[0]) / 365) : (calculateDTE(exp) / 365),
      expiry: type === 'future' ? (targetFutExpiry || futExpiries?.[0]) : exp
    }]);
  };

  const updateLeg = (id, updates) => {
    setLegs(prev => prev.map(l => {
      if (l.id !== id) return l;
      
      const updated = { ...l, ...updates };
      const exp = updated.expiry || targetExpiry || live.data?.expiryDates?.[0];
      
      // If expiry changed, we might need to fetch it (handled by LiveLegConfigurator calling fetchNow), 
      // but let's recompute T
      if (updates.expiry !== undefined) {
        updated.T = calculateDTE(updates.expiry) / 365;
      }
      
      // Auto-bind premium if strike, type, action, or expiry changes
      if (updates.strike !== undefined || updates.type !== undefined || updates.action !== undefined || updates.expiry !== undefined) {
        if (updated.type === 'future') {
          const futExp = updated.expiry || targetFutExpiry || futExpiries?.[0];
          updated.premium = live.data?.futurePrices?.[futExp] || live.data?.futurePrice || live.data?.spot || 0;
          updated.strike = 0; // Futures don't have a strike
        } else if (live.data?.byExpiry && exp) {
          const records = live.data.byExpiry[exp];
          if (records) {
            // If switching from Future to Option, assign an ATM strike
            if (updated.strike === 0) {
              const defaultStrike = live.data?.spot 
                ? Math.round(live.data.spot / 50) * 50 
                : 24500;
              updated.strike = defaultStrike;
            }
            const strikeData = records.find(s => (s.strikePrice || s.strike) === updated.strike);
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
    if (!token) {
      alert('You must be logged in to Paper Trade! Please click the Paper Trading tab.');
      return;
    }
    
    if (legs.length === 0) {
      alert('Add at least one leg to the strategy first.');
      return;
    }

    try {
      const legsToExecute = legs.filter(leg => !leg.isComparative);
      
      if (legsToExecute.length === 0) {
        alert('No valid new legs to execute. Comparative legs cannot be traded again.');
        return;
      }

      const formattedLegs = legsToExecute.map(leg => ({
        symbol: live.data?.symbol || 'NIFTY',
        type: leg.type,
        strike: leg.strike,
        expiry: leg.type === 'future' ? (leg.expiry || targetFutExpiry || futExpiries?.[0]) : (leg.expiry || targetExpiry || live.data?.expiryDates?.[0]),
        action: leg.action,
        orderType: 'market',
        qty: leg.qty,
        lotSize: leg.lotSize || 25,
        entryPrice: leg.premium
      }));

      const res = await fetch('/api/trades/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ legs: formattedLegs })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Batch trade execution failed');
      }

      alert('Strategy successfully executed in Paper Trading Portfolio!');
      setLegs([]); // Clear the builder after execution
      if (onTradeExecuted) onTradeExecuted();
    } catch (err) {
      alert(err.message || 'Failed to place paper trade. Check your connection.');
    }
  };

  const handleSaveStrategy = async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      alert('You must be logged in to save strategies.');
      return;
    }
    if (!saveName) return alert('Name is required');

    try {
      const res = await fetch('/api/strategies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: saveName,
          description: saveDesc,
          legs: legs.map(l => ({
            type: l.type,
            strike: l.strike,
            action: l.action,
            qty: l.qty,
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
      ...l,
      id: `loaded-${Date.now()}-${idx}`,
      premium: live.data?.spot || 0, // Gets auto-updated by premium binding if prices change
      iv: 0.15,
      T: l.expiry ? calculateDTE(l.expiry) / 365 : 0
    }));
    setLegs(loadedLegs);
    setShowLoadModal(false);
  };

  const estimatedMargin = useMemo(() => {
    return estimateMargin(legs, live.data?.spot || 24500, live.data?.symbol || 'NIFTY');
  }, [legs, live.data]);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 pb-24 space-y-6">
      
      {/* Top Bar: Controls */}
      <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
        <LiveFetchBar onFetch={handleFetch} isLoading={live.isLoading} error={live.error} />
        
        <div className="flex gap-4 flex-wrap">
          <div className="flex flex-col gap-2 min-w-[160px] bg-[#161b22] border border-[#30363d] p-2 rounded-xl">
            <label className="flex items-center gap-2 cursor-pointer">
              <input 
                type="checkbox" 
                checked={isBacktestMode} 
                onChange={(e) => {
                  setIsBacktestMode(e.target.checked);
                  if (!e.target.checked) live.fetchNow(live.data?.symbol || 'NIFTY', { force: true });
                }} 
                className="rounded bg-[#0d1117] border-[#30363d] text-blue-500 focus:ring-blue-500" 
              />
              <span className="text-[10px] text-[#58a6ff] uppercase font-bold tracking-wider flex items-center gap-1">
                <Clock size={12} /> Backtest Engine
              </span>
            </label>
            {isBacktestMode && (
              <select 
                value={selectedTimestamp}
                onChange={(e) => setSelectedTimestamp(e.target.value)}
                className="bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-sm rounded-lg px-2 py-1 outline-none"
              >
                <option value="" disabled>Select Time...</option>
                {backtestTimestamps.map(ts => (
                  <option key={ts} value={ts}>{new Date(ts).toLocaleTimeString()}</option>
                ))}
              </select>
            )}
          </div>

          <div className="flex flex-col gap-2 min-w-[160px]">
            <label className="text-[10px] text-[#8b949e] uppercase font-bold tracking-wider">Target Options Expiry</label>
            <select 
              value={targetExpiry}
              onChange={handleExpiryChange}
              disabled={isExpiriesLoading}
              className="bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#58a6ff] focus:border-transparent outline-none"
            >
              {isExpiriesLoading ? (
                <option value="">Loading...</option>
              ) : optExpiries.length > 0 ? (
                optExpiries.map(exp => (
                  <option key={exp} value={exp}>{exp}</option>
                ))
              ) : (
                <option value="">No options expiries</option>
              )}
            </select>
          </div>

          <div className="flex flex-col gap-2 min-w-[160px]">
            <label className="text-[10px] text-purple-400 uppercase font-bold tracking-wider">Target Futures Expiry</label>
            <select 
              value={targetFutExpiry}
              onChange={handleFutExpiryChange}
              disabled={isExpiriesLoading}
              className="bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none"
            >
              {isExpiriesLoading ? (
                <option value="">Loading...</option>
              ) : futExpiries.length > 0 ? (
                futExpiries.map(exp => (
                  <option key={exp} value={exp}>{exp}</option>
                ))
              ) : (
                <option value="">No futures expiries</option>
              )}
            </select>
          </div>
        </div>
      </div>

      {/* Metrics Bar */}
      <div className="flex flex-col lg:flex-row gap-4 items-center">
        <div className="flex-1 w-full">
          <StrategyMetricsBar legs={legs} globalInputs={globalInputs} marginRequired={estimatedMargin} />
        </div>
        {isPaperTradeMode && (
          <div className="flex gap-2 w-full lg:w-auto mt-4 lg:mt-0">
            <button 
              onClick={() => setShowLoadModal(true)}
              className="flex-1 lg:flex-none px-4 py-4 bg-[#1f2937] hover:bg-[#374151] text-[#e6edf3] font-bold rounded-xl border border-[#30363d] transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <FolderOpen size={18} /> Load
            </button>
            <button 
              onClick={() => setShowSaveModal(true)}
              className="flex-1 lg:flex-none px-4 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <Save size={18} /> Save
            </button>
            <button 
              onClick={handlePaperTrade}
              className="flex-1 lg:flex-none px-4 py-4 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl shadow-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <BarChart2 size={18} /> Execute
            </button>
          </div>
        )}
      </div>

      {isPaperTradeMode && (
        <StrategyTemplates 
          spotPrice={live.data?.spot} 
          symbol={live.data?.symbol}
          onApply={(newLegs) => {
            const appliedLegs = newLegs.map((l, idx) => ({
              ...l,
              id: `tpl-${Date.now()}-${idx}`,
              qty: 1,
              lotSize: getLotSize(live.data?.symbol),
              expiry: targetExpiry || live.data?.expiryDates?.[0],
              premium: live.data?.spot || 0 // auto-updates from useEffect binding
            }));
            setLegs(appliedLegs);
          }} 
        />
      )}

      {/* Save Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#161b22] border border-[#30363d] p-6 rounded-xl w-[400px]">
            <h3 className="text-xl font-bold text-white mb-4">Save Strategy</h3>
            <input 
              className="w-full bg-[#0d1117] border border-[#30363d] text-white p-2 rounded mb-3" 
              placeholder="Strategy Name (e.g. Iron Condor)" 
              value={saveName} onChange={e => setSaveName(e.target.value)} 
            />
            <textarea 
              className="w-full bg-[#0d1117] border border-[#30363d] text-white p-2 rounded mb-4 text-sm" 
              placeholder="Description / Tags" 
              rows={3}
              value={saveDesc} onChange={e => setSaveDesc(e.target.value)} 
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowSaveModal(false)} className="px-4 py-2 bg-gray-600 rounded text-white">Cancel</button>
              <button onClick={handleSaveStrategy} className="px-4 py-2 bg-blue-600 rounded text-white">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Load Modal */}
      {showLoadModal && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#161b22] border border-[#30363d] p-6 rounded-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-white">Load Strategy Template</h3>
              <button onClick={() => setShowLoadModal(false)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            {savedStrategies.length === 0 ? (
              <p className="text-gray-400">No saved strategies found.</p>
            ) : (
              <div className="space-y-3">
                {savedStrategies.map(strat => (
                  <div key={strat._id} className="p-4 border border-[#30363d] bg-[#0d1117] rounded hover:border-blue-500 cursor-pointer flex justify-between items-center" onClick={() => loadStrategy(strat)}>
                    <div>
                      <div className="font-bold text-blue-400">{strat.name}</div>
                      <div className="text-xs text-gray-400 mt-1">{strat.description}</div>
                    </div>
                    <div className="text-xs text-gray-500">{new Date(strat.createdAt).toLocaleDateString()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Full Width Layout */}
      <div className="space-y-6">
        
        {/* Legs Configurator */}
        <div className="card p-4">
          <LiveLegConfigurator 
            legs={legs}
            expiryDates={live.data?.expiryDates || []}
            futExpiryDates={futExpiries || []}
            byExpiry={live.data?.byExpiry || {}}
            onUpdateLeg={updateLeg}
            onAddLeg={addLeg}
            onRemoveLeg={removeLeg}
            futurePrice={live.data?.futurePrice}
            fetchExpiry={(exp, isFut) => {
              if (isFut) {
                live.fetchNow(live.data.symbol, { force: false, expiry: targetExpiry, futExpiry: exp });
              } else {
                live.fetchNow(live.data.symbol, { force: false, expiry: exp, futExpiry: targetFutExpiry });
              }
            }}
          />
        </div>

        {/* Payoff Chart */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#e6edf3]">Payoff Diagram (Live Data)</h3>
          </div>
          {legs.length > 0 ? (
            <PayoffChart 
              legs={legs} 
              globalInputs={globalInputs}
              spotRangePercent={15} 
            />
          ) : (
            <div className="h-[300px] flex items-center justify-center text-[#8b949e] border border-dashed border-[#30363d] rounded">
              Add legs to see payoff chart
            </div>
          )}
        </div>

        {/* Probabilities and Theta */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card p-4">
            <ProbabilityPanel legs={legs} globalInputs={globalInputs} />
          </div>
          <div className="card p-4">
            <ThetaDecayChart legs={legs} globalInputs={globalInputs} />
          </div>
        </div>

        {/* Greeks Surface */}
        <div className="card p-4">
          <GreeksSurfaceChart legs={debouncedLegs} globalInputs={debouncedGlobalInputs} spotRangePercent={15} />
        </div>

        {/* Scenario Heatmap */}
        <div className="card p-4">
          <ScenarioHeatmap legs={debouncedLegs} globalInputs={debouncedGlobalInputs} />
        </div>

      </div>
      {/* Detailed Margin Breakdown */}
      {estimatedMargin?.totalMarginRequired > 0 && (
        <div className="card p-4 space-y-4">
          <div className="flex items-center gap-2 border-b border-[#30363d] pb-2">
            <AlertCircle size={16} className="text-[#e3b341]" />
            <h3 className="text-sm font-semibold text-[#e6edf3]">Margin Requirements</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-xs text-[#8b949e]">
            {/* Column 1 */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span>Span Margin:</span>
                <span className="font-mono text-[#e6edf3] bg-[#0d1117] border border-[#30363d] px-2 py-1 rounded min-w-[100px] text-right">
                  {estimatedMargin.spanMargin.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span>Additional Margin:</span>
                <span className="font-mono text-[#e6edf3] bg-[#0d1117] border border-[#30363d] px-2 py-1 rounded min-w-[100px] text-right">
                  {estimatedMargin.additionalMargin.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span>Pre Expiry Margin:</span>
                <span className="font-mono text-[#e6edf3] bg-[#0d1117] border border-[#30363d] px-2 py-1 rounded min-w-[100px] text-right">
                  {estimatedMargin.preExpiryMargin.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Column 2 */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span>Exposure Margin:</span>
                <span className="font-mono text-[#e6edf3] bg-[#0d1117] border border-[#30363d] px-2 py-1 rounded min-w-[100px] text-right">
                  {estimatedMargin.exposureMargin.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span>Special Margin:</span>
                <span className="font-mono text-[#e6edf3] bg-[#0d1117] border border-[#30363d] px-2 py-1 rounded min-w-[100px] text-right">
                  {estimatedMargin.specialMargin.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span>Tender Margin:</span>
                <span className="font-mono text-[#e6edf3] bg-[#0d1117] border border-[#30363d] px-2 py-1 rounded min-w-[100px] text-right">
                  {estimatedMargin.tenderMargin.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Column 3 */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span>Exposure Spread Benefit:</span>
                <span className="font-mono text-[#e6edf3] bg-[#0d1117] border border-[#30363d] px-2 py-1 rounded min-w-[100px] text-right">
                  {estimatedMargin.exposureSpreadBenefit.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span>Delivery Margin:</span>
                <span className="font-mono text-[#e6edf3] bg-[#0d1117] border border-[#30363d] px-2 py-1 rounded min-w-[100px] text-right">
                  {estimatedMargin.deliveryMargin.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center font-bold text-[#e6edf3] mt-2 pt-2 border-t border-[#30363d]/50">
                <span>Total Margin Required:</span>
                <span className="font-mono text-[#58a6ff] bg-[#58a6ff]/10 border border-[#58a6ff]/30 px-2 py-1 rounded min-w-[100px] text-right">
                  {estimatedMargin.totalMarginRequired.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
          
          <p className="text-[10px] text-[#8b949e] italic mt-4">
            *This is an estimated rule-based approximation for strategy building purposes. Actual broker margins will vary based on live volatility parameters and exchange SPAN files.
          </p>
        </div>
      )}

    </div>
  );
}
