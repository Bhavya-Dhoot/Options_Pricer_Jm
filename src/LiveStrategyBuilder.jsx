import React, { useState, useEffect, useMemo } from 'react';
import LiveFetchBar from './components/LiveFetchBar.jsx';
import LiveLegConfigurator from './components/strategies/LiveLegConfigurator.jsx';
import PayoffChart from './components/strategies/PayoffChart.jsx';
import { estimateMargin } from './utils/marginCalculator.js';
import { useAvailableExpiries } from './useLiveData.js';
import { AlertCircle } from 'lucide-react';

export default function LiveStrategyBuilder({ live }) {
  const [legs, setLegs] = useState([]);
  const [targetExpiry, setTargetExpiry] = useState('');
  
  // Custom hook to fetch expiries
  const { expiries, isLoading: isExpiriesLoading } = useAvailableExpiries(live.data?.symbol || 'NIFTY');

  useEffect(() => {
    if (expiries.length > 0 && !targetExpiry) {
      setTargetExpiry(expiries[0]);
    }
  }, [expiries, targetExpiry]);

  // When live data updates, bind the exact premiums to the legs
  useEffect(() => {
    if (!live.data) return;

    setLegs(prevLegs => prevLegs.map(leg => {
      if (leg.type === 'future') {
        return { ...leg, premium: live.data.futurePrice || live.data.spot || 0 };
      }
      
      // For options, we only bind if the leg is part of the currently fetched expiry chain
      // The user sees the chain for `live.data.currentExpiry`.
      if (live.data.currentExpiry) {
        const strikeData = live.data.strikeRecords?.find(s => s.strike === leg.strike);
        if (strikeData) {
          const optData = leg.type === 'call' ? strikeData.call : strikeData.put;
          if (optData?.ltp) {
            return { ...leg, premium: optData.ltp };
          }
        }
      }
      
      return leg;
    }));
  }, [live.data]);

  const handleFetch = async (symbol) => {
    // When they click fetch, fetch the specific expiry
    if (targetExpiry) {
      await live.fetchNow(symbol, { force: true, expiry: targetExpiry });
    } else {
      await live.fetchNow(symbol, { force: true });
    }
  };

  const handleExpiryChange = (e) => {
    const newExp = e.target.value;
    setTargetExpiry(newExp);
    if (live.data?.symbol) {
      live.fetchNow(live.data.symbol, { force: false, expiry: newExp });
    }
  };

  const availableStrikes = useMemo(() => {
    if (!live.data?.strikeRecords) return [];
    return live.data.strikeRecords.map(s => s.strike);
  }, [live.data]);

  const getLotSize = (sym) => {
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
      
    let initialPremium = 0;
    if (type === 'future') {
      initialPremium = live.data?.futurePrice || live.data?.spot || 0;
    } else if (live.data?.strikeRecords) {
      const strikeData = live.data.strikeRecords.find(s => s.strike === defaultStrike);
      if (strikeData) {
        initialPremium = type === 'call' ? (strikeData.call?.ltp || 0) : (strikeData.put?.ltp || 0);
      }
    }

    setLegs(prev => [...prev, {
      id: `leg_${Date.now()}`,
      type: type,
      action: 'buy',
      strike: type === 'future' ? 0 : defaultStrike,
      qty: 1,
      premium: initialPremium,
      lotSize: getLotSize(live.data?.symbol),
      T: 30 / 365 // Used strictly for Greek estimation if PayoffChart uses BSM
    }]);
  };

  const updateLeg = (id, updates) => {
    setLegs(prev => prev.map(l => {
      if (l.id !== id) return l;
      const updated = { ...l, ...updates };
      
      // Auto-bind premium if strike or type changes
      if (updates.strike || updates.type) {
        if (updated.type === 'future') {
          updated.premium = live.data?.futurePrice || live.data?.spot || 0;
          updated.strike = 0; // Futures don't have a strike
        } else if (live.data?.strikeRecords && updated.strike) {
          const strikeData = live.data.strikeRecords.find(s => s.strike === updated.strike);
          if (strikeData) {
            updated.premium = updated.type === 'call' ? (strikeData.call?.ltp || 0) : (strikeData.put?.ltp || 0);
          }
        }
      }
      return updated;
    }));
  };

  const removeLeg = (id) => setLegs(prev => prev.filter(l => l.id !== id));

  // Compute Net Premium & Margin
  const netPremium = useMemo(() => {
    const lotSize = live.data?.symbol === 'BANKNIFTY' ? 15 : (live.data?.symbol === 'SENSEX' ? 10 : 25);
    return legs.reduce((acc, leg) => {
      // Future legs don't pay premium in the same way, but for strategy cost purposes we ignore future contract value here.
      // Wait, a future P&L is just (Exit - Entry). It costs margin, not premium.
      if (leg.type === 'future') return acc;
      
      const cost = leg.premium * leg.qty * lotSize;
      return leg.action === 'buy' ? acc - cost : acc + cost;
    }, 0);
  }, [legs, live.data?.symbol]);

  const estimatedMargin = useMemo(() => {
    return estimateMargin(legs, live.data?.spot || 24500, live.data?.symbol || 'NIFTY');
  }, [legs, live.data]);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 pb-24 space-y-6">
      
      {/* Top Bar: Controls */}
      <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
        <LiveFetchBar onFetch={handleFetch} isLoading={live.isLoading} error={live.error} />
        
        <div className="flex flex-col gap-2 min-w-[200px]">
          <label className="text-[10px] text-[#8b949e] uppercase font-bold tracking-wider">Target Expiry</label>
          <select 
            value={targetExpiry}
            onChange={handleExpiryChange}
            disabled={isExpiriesLoading}
            className="bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#58a6ff] focus:border-transparent outline-none"
          >
            {isExpiriesLoading ? (
              <option value="">Loading...</option>
            ) : expiries.length > 0 ? (
              expiries.map(exp => (
                <option key={exp} value={exp}>{exp}</option>
              ))
            ) : (
              <option value="">No expiries available</option>
            )}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Side: Legs & Stats */}
        <div className="lg:col-span-5 space-y-6">
          <div className="panel p-0 overflow-hidden">
            <div className="p-4 border-b border-[#30363d] bg-[#161b22]">
              <h2 className="text-sm font-semibold text-[#e6edf3]">Live Strategy Builder</h2>
              <p className="text-xs text-[#8b949e] mt-1">
                Construct strategies using exact live market premiums and future prices.
              </p>
            </div>
            <div className="p-4">
              <LiveLegConfigurator 
                legs={legs}
                availableStrikes={availableStrikes}
                onUpdateLeg={updateLeg}
                onAddLeg={addLeg}
                onRemoveLeg={removeLeg}
                futurePrice={live.data?.futurePrice}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="panel p-4 flex flex-col justify-center items-center">
              <span className="text-xs text-[#8b949e] uppercase tracking-wider mb-1">Net Premium</span>
              <span className={`text-xl font-bold font-mono ${netPremium > 0 ? 'text-[#3fb950]' : netPremium < 0 ? 'text-[#f85149]' : 'text-[#e6edf3]'}`}>
                {netPremium > 0 ? '+' : ''}{netPremium.toFixed(2)}
              </span>
              <span className="text-[10px] text-[#8b949e] mt-1">
                {netPremium > 0 ? 'Credit Received' : 'Debit Paid'}
              </span>
            </div>
            
            <div className="panel p-4 flex flex-col justify-center items-center">
              <span className="text-xs text-[#8b949e] uppercase tracking-wider mb-1 flex items-center gap-1">
                Margin Required
              </span>
              <span className="text-xl font-bold font-mono text-[#e3b341]">
                ₹{(estimatedMargin / 100000).toFixed(2)}L
              </span>
              <span className="text-[10px] text-[#8b949e] mt-1">
                Approximate
              </span>
            </div>
          </div>

          {estimatedMargin > 0 && (
            <div className="flex items-start gap-2 text-xs text-[#8b949e] bg-[#30363d]/30 p-3 rounded border border-[#30363d]">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <p>
                Margin calculations are rule-based approximations. Actual margin blocked by your broker involves SPAN and Exposure algorithms and will differ.
              </p>
            </div>
          )}
        </div>

        {/* Right Side: Payoff */}
        <div className="lg:col-span-7">
          <div className="panel p-4 h-full min-h-[400px]">
            <h3 className="text-sm font-semibold text-[#e6edf3] mb-4">Payoff at Expiry</h3>
            {legs.length > 0 ? (
              <PayoffChart 
                legs={legs} 
                spotPrice={live.data?.spot || 24500} 
                spotRangePercent={15} 
              />
            ) : (
              <div className="h-[300px] flex items-center justify-center text-[#8b949e] border border-dashed border-[#30363d] rounded">
                Add legs to see payoff chart
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
