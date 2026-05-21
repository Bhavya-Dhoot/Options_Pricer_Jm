import React, { useMemo, useState } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine
} from 'recharts';
import { calculateBSM, NIFTY_LOT_SIZE } from '../../bsm.js';

export default function GreeksSurfaceChart({ legs, globalInputs, spotRangePercent }) {
  const [visible, setVisible] = useState({
    delta: true,
    gamma: false,
    theta: true,
    vega: false
  });

  const chartData = useMemo(() => {
    if (!legs || legs.length === 0) return [];
    
    const spot = globalInputs.spot;
    const range = spot * (spotRangePercent / 100);
    const spotMin = Math.max(0, spot - range);
    const spotMax = spot + range;
    const steps = 100;
    const stepSize = (spotMax - spotMin) / steps;
    
    const data = [];
    for (let i = 0; i <= steps; i++) {
      const s = spotMin + i * stepSize;
      
      let netDelta = 0, netGamma = 0, netTheta = 0, netVega = 0;
      
      legs.forEach(leg => {
        if (leg.type === 'underlying') {
          const sign = leg.action === 'buy' ? 1 : -1;
          netDelta += sign * leg.qty * NIFTY_LOT_SIZE;
        } else {
          const bsm = calculateBSM(
            s, leg.strike, leg.T, globalInputs.rate, 
            leg.iv || globalInputs.iv, leg.type.toUpperCase(), globalInputs.dividend
          );
          if (bsm) {
            const sign = leg.action === 'buy' ? 1 : -1;
            netDelta += sign * bsm.delta * leg.qty * NIFTY_LOT_SIZE;
            netGamma += sign * bsm.gamma * leg.qty * NIFTY_LOT_SIZE;
            netTheta += sign * bsm.theta * leg.qty * NIFTY_LOT_SIZE;
            netVega += sign * bsm.vega * leg.qty * NIFTY_LOT_SIZE;
          }
        }
      });
      
      data.push({
        spot: s,
        delta: netDelta,
        gamma: netGamma,
        theta: netTheta,
        vega: netVega
      });
    }
    return data;
  }, [legs, globalInputs, spotRangePercent]);

  if (chartData.length === 0) return null;

  const toggle = (key) => setVisible(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[#e6edf3]">Net Greeks vs Spot Price</h3>
        <div className="flex gap-2">
          {['delta', 'gamma', 'theta', 'vega'].map(g => (
            <button
              key={g}
              onClick={() => toggle(g)}
              className={`px-3 py-1 rounded text-xs font-semibold capitalize border transition-colors ${
                visible[g] 
                  ? 'bg-[#58a6ff20] text-[#58a6ff] border-[#58a6ff40]' 
                  : 'bg-[#161b22] text-[#8b949e] border-[#30363d]'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>
      
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            
            <XAxis 
              dataKey="spot" 
              type="number"
              domain={['dataMin', 'dataMax']}
              tick={{ fill: '#8b949e', fontSize: 11 }}
              tickFormatter={v => '₹' + v.toFixed(0)}
              label={{ value: 'Spot Price', position: 'bottom', fill: '#8b949e', fontSize: 12, offset: 0 }}
            />
            
            <YAxis yAxisId="left" tick={{ fill: '#8b949e', fontSize: 11 }} domain={['auto', 'auto']} width={60} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: '#8b949e', fontSize: 11 }} domain={['auto', 'auto']} width={60} />
            
            <Tooltip 
              contentStyle={{ backgroundColor: '#161b22', borderColor: '#30363d', color: '#e6edf3', borderRadius: '8px' }}
              itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
              labelStyle={{ color: '#8b949e', marginBottom: '4px' }}
              formatter={(value) => value.toFixed(2)}
              labelFormatter={(label) => `Spot: ₹${Number(label).toFixed(0)}`}
            />
            
            <ReferenceLine y={0} yAxisId="left" stroke="#8b949e" strokeDasharray="4 4" />
            <ReferenceLine x={globalInputs.spot} yAxisId="left" stroke="#e3b341" strokeDasharray="3 3" />

            {visible.delta && <Line yAxisId="left" type="monotone" dataKey="delta" name="Delta" stroke="#3fb950" strokeWidth={2} dot={false} />}
            {visible.gamma && <Line yAxisId="right" type="monotone" dataKey="gamma" name="Gamma" stroke="#f85149" strokeWidth={2} dot={false} />}
            {visible.theta && <Line yAxisId="right" type="monotone" dataKey="theta" name="Theta" stroke="#a371f7" strokeWidth={2} dot={false} />}
            {visible.vega && <Line yAxisId="right" type="monotone" dataKey="vega" name="Vega" stroke="#58a6ff" strokeWidth={2} dot={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
