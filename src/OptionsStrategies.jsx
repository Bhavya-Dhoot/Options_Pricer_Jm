import React, { useState, useEffect, useMemo } from 'react';
import { STRATEGIES } from './strategyDefinitions.js';
import { premiumAt, calculateBSM } from './bsm.js';
import { findATMStrike } from './useLiveData.js';
import { estimateMargin } from './utils/marginCalculator.js';

import LiveFetchBar from './components/LiveFetchBar.jsx';
import StrategyCatalog from './components/strategies/StrategyCatalog.jsx';
import LegConfigurator from './components/strategies/LegConfigurator.jsx';
import StrategyMetricsBar from './components/strategies/StrategyMetricsBar.jsx';
import PayoffChart from './components/strategies/PayoffChart.jsx';
import GreeksSurfaceChart from './components/strategies/GreeksSurfaceChart.jsx';
import ThetaDecayChart from './components/strategies/ThetaDecayChart.jsx';
import ScenarioHeatmap from './components/strategies/ScenarioHeatmap.jsx';
import ProbabilityPanel from './components/strategies/ProbabilityPanel.jsx';
import CompareMode from './components/strategies/CompareMode.jsx';

export default function OptionsStrategies({ liveSpot, liveIV, riskFreeRate }) {
  const [selectedStrategyId, setSelectedStrategyId] = useState('iron_condor');
  const [legs, setLegs] = useState([]);
  const [globalInputs, setGlobalInputs] = useState({
    spot: liveSpot || 24500,
    iv: liveIV || 0.15,
    rate: riskFreeRate / 100 || 0.065,
    dividend: 0.012,
    dte: 30,
    farDte: 60,
  });
  
  const [spotRangePercent, setSpotRangePercent] = useState(20);
  const [compareMode, setCompareMode] = useState(false);
  const [comparedStrategies, setComparedStrategies] = useState([]);
  
  const [savedStrategies, setSavedStrategies] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('nifty_saved_strategies') || '[]');
    } catch {
      return [];
    }
  });

  // Sync with live spot if it updates and we haven't touched it (or just always for now)
  useEffect(() => {
    if (liveSpot) {
      setGlobalInputs(prev => ({ ...prev, spot: liveSpot }));
    }
  }, [liveSpot]);

  const handleDataFetched = React.useCallback((chain, sym) => {
    if (!chain) return;
    const updates = {};
    if (chain.spot) updates.spot = Math.round(chain.spot * 100) / 100;
    
    const expiries = chain.expiryDates || [];
    if (expiries.length > 0) {
      const nearestExpiry = expiries[0];
      const atm = findATMStrike(chain, nearestExpiry, chain.spot);
      if (atm) {
        const relevantIV = atm.call?.iv || atm.put?.iv;
        if (relevantIV && relevantIV > 0) {
          updates.iv = relevantIV / 100; // IV needs to be decimal for Strategies
        }
      }
    }
    
    if (Object.keys(updates).length > 0) {
      setGlobalInputs(prev => ({ ...prev, ...updates }));
    }
  }, []);

  useEffect(() => {
    if (liveIV) {
      setGlobalInputs(prev => ({ ...prev, iv: liveIV }));
    }
  }, [liveIV]);

  const allStrategies = useMemo(() => [...STRATEGIES, ...savedStrategies], [savedStrategies]);

  // When strategy changes, populate legs
  useEffect(() => {
    const strat = allStrategies.find(s => s.id === selectedStrategyId);
    if (strat) {
      const newLegs = strat.legs.map((leg, idx) => {
        let strike = globalInputs.spot;
        if (leg.type !== 'underlying') {
          strike = Math.round(globalInputs.spot / (strat.strikeSeparation || 50)) * (strat.strikeSeparation || 50);
          strike += (leg.strikeOffset || 0);
        }
        
        // If leg already has an absolute strike (e.g. custom loaded), use it
        if (leg.absoluteStrike) strike = leg.absoluteStrike;
        
        const dte = leg.dteIndex === 1 ? globalInputs.farDte : globalInputs.dte;
        const T = leg.T !== undefined ? leg.T : dte / 365;
        
        let premium = leg.premium || 0;
        if (!leg.premium && premium === 0) {
          if (leg.type === 'underlying') premium = globalInputs.spot;
          else premium = premiumAt(globalInputs.spot, strike, T, globalInputs.rate, globalInputs.iv, leg.type.toUpperCase(), globalInputs.dividend);
        }
        
        return {
          ...leg,
          id: `leg_${idx}_${Date.now()}`,
          strike,
          T,
          premium
        };
      });
      setLegs(newLegs);
    }
  }, [selectedStrategyId, globalInputs.spot, globalInputs.dte, globalInputs.farDte, globalInputs.iv, globalInputs.rate, globalInputs.dividend]); // Note: In a real app we might want to prevent overwriting user edits on spot change, but this matches the previous behavior.

  const updateLeg = (id, updates) => setLegs(prev => prev.map(l => {
    if (l.id !== id) return l;
    const updated = { ...l, ...updates };
    
    // Recalculate theoretical premium if strike, DTE, or type changes
    if (updates.strike !== undefined || updates.T !== undefined || updates.type !== undefined) {
      if (updated.type === 'underlying') {
        updated.premium = globalInputs.spot;
      } else {
        updated.premium = premiumAt(globalInputs.spot, updated.strike, updated.T, globalInputs.rate, globalInputs.iv, updated.type.toUpperCase(), globalInputs.dividend);
      }
    }
    return updated;
  }));
  const removeLeg = (id) => setLegs(prev => prev.filter(l => l.id !== id));
  const addLeg = () => {
    setLegs(prev => [...prev, {
      id: `leg_${Date.now()}`,
      type: 'call',
      action: 'buy',
      strike: Math.round(globalInputs.spot / 50) * 50,
      T: globalInputs.dte / 365,
      qty: 1,
      premium: 0
    }]);
  };

  const handleGlobalChange = (key, val) => setGlobalInputs(prev => ({ ...prev, [key]: Number(val) }));

  const handleSaveCustom = () => {
    const name = prompt("Enter a name for this custom strategy:");
    if (!name) return;
    
    const newStrat = {
      id: `custom_${Date.now()}`,
      name: name,
      category: 'Synthetic & Advanced',
      sentiment: 'neutral',
      description: 'Custom user-defined strategy.',
      riskProfile: { maxProfit: 'calculated', maxLoss: 'calculated' },
      legs: legs.map(l => ({ ...l, absoluteStrike: l.strike })) // save absolute strikes
    };
    
    const updated = [...savedStrategies, newStrat];
    setSavedStrategies(updated);
    localStorage.setItem('nifty_saved_strategies', JSON.stringify(updated));
    setSelectedStrategyId(newStrat.id);
  };

  const currentStrategy = allStrategies.find(s => s.id === selectedStrategyId);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#e6edf3]">Options Strategies</h1>
          <p className="text-xs text-[#8b949e] mt-0.5">Build, analyze, and compare complex multi-leg setups</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSaveCustom}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#21262d] text-[#c9d1d9] hover:bg-[#30363d] transition-colors border border-[#30363d]"
          >
            Save as Custom
          </button>
          <button
            onClick={() => setCompareMode(!compareMode)}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
              compareMode ? 'bg-[#58a6ff20] text-[#58a6ff] border border-[#58a6ff40]' : 'bg-[#21262d] text-[#c9d1d9] hover:bg-[#30363d]'
            }`}
          >
            {compareMode ? 'Exit Compare Mode' : 'Compare Strategies'}
          </button>
        </div>
      </div>

      <LiveFetchBar onFetchComplete={handleDataFetched} />

      {!compareMode ? (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
            {/* Left Sidebar: Catalog & Config */}
            <div className="xl:col-span-1 space-y-6">
              <StrategyCatalog 
                strategies={allStrategies} 
                selectedId={selectedStrategyId} 
                onSelect={setSelectedStrategyId} 
              />
              <div className="card p-4">
                <h3 className="text-sm font-semibold text-[#e6edf3] mb-3">Global Variables</h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] text-[#8b949e]">Spot Price (₹)</label>
                    <input type="number" className="w-full text-sm" value={globalInputs.spot} onChange={e => handleGlobalChange('spot', e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#8b949e]">Implied Volatility (%)</label>
                    <input type="range" min="5" max="100" className="w-full" value={globalInputs.iv * 100} onChange={e => handleGlobalChange('iv', e.target.value / 100)} />
                    <div className="text-right text-xs font-mono text-[#e6edf3]">{(globalInputs.iv * 100).toFixed(1)}%</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-[#8b949e]">DTE</label>
                      <input type="number" className="w-full text-sm" value={globalInputs.dte} onChange={e => handleGlobalChange('dte', e.target.value)} />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#8b949e]">Far DTE</label>
                      <input type="number" className="w-full text-sm" value={globalInputs.farDte} onChange={e => handleGlobalChange('farDte', e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="xl:col-span-3 space-y-6">
              <StrategyMetricsBar 
                legs={legs} 
                globalInputs={globalInputs} 
                marginRequired={useMemo(() => estimateMargin(legs, globalInputs.spot, 'NIFTY'), [legs, globalInputs.spot])}
              />
              
              <div className="card p-4">
                <LegConfigurator 
                  legs={legs} 
                  onUpdateLeg={updateLeg} 
                  onAddLeg={addLeg} 
                  onRemoveLeg={removeLeg} 
                />
              </div>

              <div className="card p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-[#e6edf3]">Payoff Diagram</h3>
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-[#8b949e]">Spot Range ±%</label>
                    <input type="range" min="5" max="50" step="1" value={spotRangePercent} onChange={e => setSpotRangePercent(Number(e.target.value))} className="w-24" />
                    <span className="text-[10px] text-[#e6edf3] font-mono">{spotRangePercent}%</span>
                  </div>
                </div>
                <PayoffChart legs={legs} globalInputs={globalInputs} spotRangePercent={spotRangePercent} />
              </div>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card p-4">
                  <ProbabilityPanel legs={legs} globalInputs={globalInputs} />
                </div>
                <div className="card p-4">
                  <ThetaDecayChart legs={legs} globalInputs={globalInputs} />
                </div>
              </div>

              <div className="card p-4">
                <GreeksSurfaceChart legs={legs} globalInputs={globalInputs} spotRangePercent={spotRangePercent} />
              </div>

              <div className="card p-4">
                <ScenarioHeatmap legs={legs} globalInputs={globalInputs} />
              </div>
            </div>
          </div>
        </>
      ) : (
        <CompareMode 
          strategies={allStrategies}
          globalInputs={globalInputs}
          spotRangePercent={spotRangePercent}
        />
      )}
    </div>
  );
}
