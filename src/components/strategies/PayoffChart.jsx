import React, { useMemo } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Area
} from 'recharts';
import { strategyPayoffAtExpiry, strategyBSMPnL, findBreakevens } from '../../bsm.js';

export default function PayoffChart({ legs, globalInputs, spotRangePercent }) {
  const chartData = useMemo(() => {
    if (!legs || legs.length === 0) return [];
    
    const spot = globalInputs.spot;
    const range = spot * (spotRangePercent / 100);
    const spotMin = Math.max(0, spot - range);
    const spotMax = spot + range;
    const steps = 150;
    const stepSize = (spotMax - spotMin) / steps;
    
    const maxT = Math.max(...legs.map(l => l.T));
    const halfT = maxT / 2;
    
    const data = [];
    for (let i = 0; i <= steps; i++) {
      const s = spotMin + i * stepSize;
      
      const expiryPnL = strategyPayoffAtExpiry(legs, s);
      const currentPnL = strategyBSMPnL(legs, s, maxT, globalInputs.iv, globalInputs.rate, globalInputs.dividend);
      const halfPnL = maxT > 0 ? strategyBSMPnL(legs, s, halfT, globalInputs.iv, globalInputs.rate, globalInputs.dividend) : expiryPnL;
      
      data.push({
        spot: s,
        expiryPnL,
        currentPnL,
        halfPnL,
        // Helper fields for shaded areas
        profitArea: expiryPnL > 0 ? expiryPnL : 0,
        lossArea: expiryPnL < 0 ? expiryPnL : 0,
      });
    }
    return data;
  }, [legs, globalInputs, spotRangePercent]);

  const breakevens = useMemo(() => {
    const spot = globalInputs.spot;
    const range = spot * (spotRangePercent / 100);
    return findBreakevens(legs, Math.max(0, spot - range), spot + range);
  }, [legs, globalInputs, spotRangePercent]);

  if (chartData.length === 0) return null;

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    return (
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-3 text-xs shadow-xl">
        <p className="text-[#8b949e] mb-2 border-b border-[#30363d] pb-1">
          Spot: <span className="text-[#e6edf3] font-bold">₹{label.toFixed(0)}</span>
        </p>
        {payload.map((entry, idx) => {
          if (entry.dataKey === 'profitArea' || entry.dataKey === 'lossArea') return null;
          return (
            <div key={idx} className="flex justify-between gap-4 py-0.5">
              <span style={{ color: entry.color }}>{entry.name}</span>
              <span className="font-mono font-bold text-[#e6edf3]">
                {entry.value > 0 ? '+' : ''}₹{entry.value.toFixed(0)}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="h-[400px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          
          <XAxis 
            dataKey="spot" 
            type="number"
            domain={['dataMin', 'dataMax']}
            tick={{ fill: '#8b949e', fontSize: 11 }}
            tickFormatter={v => '₹' + v.toFixed(0)}
            label={{ value: 'Spot Price at Expiry', position: 'bottom', fill: '#8b949e', fontSize: 12, offset: 0 }}
          />
          
          <YAxis 
            tick={{ fill: '#8b949e', fontSize: 11 }}
            tickFormatter={v => '₹' + v}
            domain={['auto', 'auto']}
            width={80}
          />
          
          <Tooltip content={<CustomTooltip />} />

          {/* Shaded Zones */}
          <Area type="monotone" dataKey="profitArea" fill="rgba(34, 197, 94, 0.15)" stroke="none" isAnimationActive={false} />
          <Area type="monotone" dataKey="lossArea" fill="rgba(239, 68, 68, 0.15)" stroke="none" isAnimationActive={false} />

          {/* Zero Line */}
          <ReferenceLine y={0} stroke="#8b949e" strokeDasharray="4 4" />

          {/* Current Spot Line */}
          <ReferenceLine 
            x={globalInputs.spot} 
            stroke="#e3b341" 
            strokeDasharray="3 3"
            label={{ value: 'Current Spot', fill: '#e3b341', fontSize: 10, position: 'insideTopLeft' }}
          />

          {/* Breakeven Lines */}
          {breakevens.map((be, i) => (
            <ReferenceLine 
              key={`be-${i}`} 
              x={be} 
              stroke="#58a6ff" 
              strokeDasharray="3 3" 
              label={{ value: `BE: ${Math.round(be)}`, fill: '#58a6ff', fontSize: 10, position: 'insideBottomRight' }}
            />
          ))}

          {/* Lines */}
          <Line 
            type="monotone" 
            dataKey="halfPnL" 
            name="P&L @ 50% DTE" 
            stroke="#8b949e" 
            strokeWidth={2} 
            strokeDasharray="4 4"
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Line 
            type="monotone" 
            dataKey="currentPnL" 
            name="Current P&L (T=Now)" 
            stroke="#a371f7" 
            strokeWidth={2} 
            strokeDasharray="6 2"
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Line 
            type="monotone" 
            dataKey="expiryPnL" 
            name="Payoff at Expiry" 
            stroke="#58a6ff" 
            strokeWidth={3} 
            dot={false} 
            activeDot={{ r: 6 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
