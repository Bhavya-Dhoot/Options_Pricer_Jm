import React, { useState, useEffect, useMemo } from 'react';
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

export default function LiveStrategyBuilder({ live, riskFreeRate = 6.5 }) {
  const [legs, setLegs] = useState([]);
  const [targetExpiry, setTargetExpiry] = useState('');
  const [targetFutExpiry, setTargetFutExpiry] = useState('');
  
  // Custom hook to fetch expiries
  const { optExpiries = [], futExpiries = [] } = useAvailableExpiries(live.data?.symbol || 'NIFTY') || {};
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
        newPremium = live.data.futurePrice || live.data.spot || 0;
      } else if (live.data.currentExpiry) {
        const strikeData = live.data.strikeRecords?.find(s => s.strike === leg.strike);
        if (strikeData) {
          const optData = leg.type === 'call' ? strikeData.call : strikeData.put;
          if (optData) {
            const bid = optData.bidPrice || optData.ltp || 0;
            const ask = optData.askPrice || optData.ltp || 0;
            newPremium = leg.action === 'sell' ? bid : ask;
          }
        }
      }
      
      return { ...leg, premium: newPremium, T: newT };
    }));
  }, [live.data, globalInputs.dte, globalInputs.farDte]);

  const handleFetch = async (symbol) => {
    // When they click fetch, fetch the specific expiry
    await live.fetchNow(symbol, { 
      force: true, 
      expiry: targetExpiry || null,
      futExpiry: targetFutExpiry || null
    });
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
    return records.map(s => s.strike);
  }, [live.data, targetExpiry]);

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
      
    const exp = targetExpiry || live.data?.expiryDates?.[0];
    
    let initialPremium = 0;
    if (type === 'future') {
      initialPremium = live.data?.futurePrice || live.data?.spot || 0;
    } else if (live.data?.byExpiry && exp) {
      const records = live.data.byExpiry[exp];
      if (records) {
        const strikeData = records.find(s => s.strike === defaultStrike);
        if (strikeData) {
          const optData = type === 'call' ? strikeData.call : strikeData.put;
          if (optData) {
            initialPremium = optData.askPrice || optData.ltp || 0;
          }
        }
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
      T: type === 'future' ? (globalInputs.farDte / 365) : (calculateDTE(exp) / 365),
      expiry: exp
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
          updated.premium = live.data?.futurePrice || live.data?.spot || 0;
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
            const strikeData = records.find(s => s.strike === updated.strike);
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

  const estimatedMargin = useMemo(() => {
    return estimateMargin(legs, live.data?.spot || 24500, live.data?.symbol || 'NIFTY');
  }, [legs, live.data]);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 pb-24 space-y-6">
      
      {/* Top Bar: Controls */}
      <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
        <LiveFetchBar onFetch={handleFetch} isLoading={live.isLoading} error={live.error} />
        
        <div className="flex gap-4">
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
      <StrategyMetricsBar legs={legs} globalInputs={globalInputs} />

      {/* Margin Warning */}
      {estimatedMargin > 0 && (
        <div className="flex items-start justify-between gap-2 text-xs text-[#8b949e] bg-[#30363d]/30 p-3 rounded border border-[#30363d]">
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <p>
              Estimated Margin Blocked: <strong className="text-[#e3b341]">₹{(estimatedMargin / 100000).toFixed(2)}L</strong>. Actual margin by your broker involves SPAN/Exposure and will differ.
            </p>
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
            byExpiry={live.data?.byExpiry || {}}
            onUpdateLeg={updateLeg}
            onAddLeg={addLeg}
            onRemoveLeg={removeLeg}
            futurePrice={live.data?.futurePrice}
            fetchExpiry={(exp) => {
              if (live.data?.symbol && !live.data?.byExpiry?.[exp]) {
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
          <GreeksSurfaceChart legs={legs} globalInputs={globalInputs} spotRangePercent={15} />
        </div>

        {/* Scenario Heatmap */}
        <div className="card p-4">
          <ScenarioHeatmap legs={legs} globalInputs={globalInputs} />
        </div>

      </div>
    </div>
  );
}
