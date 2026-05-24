import React, { useState, useMemo } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts';
import { strategyPayoffAtExpiry, findMaxProfitLoss, probabilityOfProfit } from '../../bsm.js';

const COLORS = ['#58a6ff', '#3fb950', '#a371f7'];

export default function CompareMode({ strategies, globalInputs, spotRangePercent }) {
  const [selectedIds, setSelectedIds] = useState([]);
  
  const toggleStrategy = (id) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(x => x !== id));
    } else {
      if (selectedIds.length < 3) setSelectedIds([...selectedIds, id]);
    }
  };

  const compiledStrategies = useMemo(() => {
    return selectedIds.map(id => {
      const strat = strategies.find(s => s.id === id);
      if (!strat) return null;
      
      const legs = strat.legs.map((leg, idx) => {
        let strike = globalInputs.spot;
        if (leg.type !== 'underlying') {
          strike = Math.round(globalInputs.spot / strat.strikeSeparation) * strat.strikeSeparation + leg.strikeOffset;
        }
        const T = leg.dteIndex === 1 ? globalInputs.farDte / 365 : globalInputs.dte / 365;
        // Simplified premium for comparison (assumes 0 to compute intrinsic metrics, or we calculate it)
        return { ...leg, strike, T, premium: 0, lotSize: globalInputs.lotSize || 25 }; 
        // Note: For an accurate comparison, we should calculate premium, but we only need intrinsic payoff shape
      });
      return { ...strat, legs };
    }).filter(Boolean);
  }, [selectedIds, strategies, globalInputs]);

  const chartData = useMemo(() => {
    if (compiledStrategies.length === 0) return [];
    
    const spot = globalInputs.spot;
    const range = spot * (spotRangePercent / 100);
    const spotMin = Math.max(0, spot - range);
    const spotMax = spot + range;
    const steps = 100;
    const stepSize = (spotMax - spotMin) / steps;
    
    const data = [];
    for (let i = 0; i <= steps; i++) {
      const s = spotMin + i * stepSize;
      const point = { spot: s };
      
      compiledStrategies.forEach((strat, idx) => {
        // Just plotting the pure intrinsic shape for comparison
        point[`strat${idx}`] = strategyPayoffAtExpiry(strat.legs, s);
      });
      data.push(point);
    }
    return data;
  }, [compiledStrategies, globalInputs, spotRangePercent]);

  return (
    <div className="space-y-6">
      <div className="card p-4">
        <h3 className="text-sm font-semibold text-[#e6edf3] mb-4">Select up to 3 strategies to compare</h3>
        <div className="flex flex-wrap gap-2">
          {strategies.map(s => (
            <button
              key={s.id}
              onClick={() => toggleStrategy(s.id)}
              disabled={!selectedIds.includes(s.id) && selectedIds.length >= 3}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                selectedIds.includes(s.id)
                  ? 'bg-[#58a6ff20] text-[#58a6ff] border-[#58a6ff40]'
                  : 'bg-[#161b22] text-[#8b949e] border-[#30363d] hover:border-[#8b949e60] disabled:opacity-50 disabled:cursor-not-allowed'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>

      {compiledStrategies.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="card p-4 h-[400px]">
            <h3 className="text-sm font-semibold text-[#e6edf3] mb-4">Payoff Comparison</h3>
            <ResponsiveContainer width="100%" height="90%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis 
                  dataKey="spot" 
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tick={{ fill: '#8b949e', fontSize: 11 }}
                  tickFormatter={v => '₹' + v.toFixed(0)}
                />
                <YAxis tick={{ fill: '#8b949e', fontSize: 11 }} width={60} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#161b22', borderColor: '#30363d', color: '#e6edf3', borderRadius: '8px' }}
                  itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                />
                <ReferenceLine y={0} stroke="#8b949e" strokeDasharray="4 4" />
                <ReferenceLine x={globalInputs.spot} stroke="#e3b341" strokeDasharray="3 3" />
                
                {compiledStrategies.map((strat, idx) => (
                  <Line 
                    key={strat.id}
                    type="monotone" 
                    dataKey={`strat${idx}`} 
                    name={strat.name}
                    stroke={COLORS[idx]} 
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="card p-4 overflow-x-auto">
            <h3 className="text-sm font-semibold text-[#e6edf3] mb-4">Metrics Comparison</h3>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#30363d] text-[10px] text-[#8b949e] uppercase tracking-wider">
                  <th className="pb-2 font-medium">Strategy</th>
                  <th className="pb-2 font-medium">Max Profit</th>
                  <th className="pb-2 font-medium">Max Loss</th>
                  <th className="pb-2 font-medium">PoP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]/50">
                {compiledStrategies.map((strat, idx) => {
                  const { maxProfit, maxLoss } = findMaxProfitLoss(strat.legs, globalInputs.spot * 0.2, globalInputs.spot * 3);
                  const maxT = Math.max(...strat.legs.map(l => l.T));
                  const { pop } = probabilityOfProfit(strat.legs, globalInputs.spot, maxT, globalInputs.rate, globalInputs.dividend, globalInputs.iv);
                  
                  return (
                    <tr key={strat.id} className="text-xs">
                      <td className="py-3 font-semibold" style={{ color: COLORS[idx] }}>{strat.name}</td>
                      <td className="py-3 font-mono text-[#e6edf3]">
                        {maxProfit === Infinity ? 'Unlimited' : `₹${Math.round(maxProfit).toLocaleString('en-IN')}`}
                      </td>
                      <td className="py-3 font-mono text-[#e6edf3]">
                        {maxLoss === -Infinity ? 'Unlimited' : `₹${Math.round(maxLoss).toLocaleString('en-IN')}`}
                      </td>
                      <td className="py-3 font-mono text-[#e6edf3]">
                        {(pop * 100).toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
