import React, { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceArea, ReferenceLine
} from 'recharts';
import { strategyBSMPnL } from '../../bsm.js';

export default function ThetaDecayChart({ legs, globalInputs }) {
  const chartData = useMemo(() => {
    if (!legs || legs.length === 0) return [];
    
    // Find the max DTE among all legs
    const maxT = Math.max(...legs.map(l => l.T));
    if (maxT <= 0) return [];
    
    const maxDays = Math.round(maxT * 365);
    const spot = globalInputs.spot;
    
    const data = [];
    for (let d = maxDays; d >= 0; d--) {
      const t = d / 365;
      data.push({
        dte: d,
        currentSpot: strategyBSMPnL(legs, spot, t, globalInputs.iv, globalInputs.rate, globalInputs.dividend),
        up5: strategyBSMPnL(legs, spot * 1.05, t, globalInputs.iv, globalInputs.rate, globalInputs.dividend),
        down5: strategyBSMPnL(legs, spot * 0.95, t, globalInputs.iv, globalInputs.rate, globalInputs.dividend),
        up10: strategyBSMPnL(legs, spot * 1.10, t, globalInputs.iv, globalInputs.rate, globalInputs.dividend),
        down10: strategyBSMPnL(legs, spot * 0.90, t, globalInputs.iv, globalInputs.rate, globalInputs.dividend),
      });
    }
    return data;
  }, [legs, globalInputs]);

  if (chartData.length === 0) return (
    <div className="h-[300px] flex items-center justify-center text-xs text-[#8b949e]">
      Invalid Expiry / No strategy selected
    </div>
  );

  const maxDays = chartData[0].dte;

  return (
    <div className="w-full">
      <h3 className="text-sm font-semibold text-[#e6edf3] mb-4">Theta Decay P&L Curve</h3>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            
            {/* Reverse X-Axis so DTE counts down to 0 */}
            <XAxis 
              dataKey="dte" 
              type="number" 
              domain={[0, maxDays]} 
              reversed={true}
              tick={{ fill: '#8b949e', fontSize: 11 }}
              label={{ value: 'Days to Expiry (DTE)', position: 'bottom', fill: '#8b949e', fontSize: 12, offset: 0 }}
            />
            
            <YAxis tick={{ fill: '#8b949e', fontSize: 11 }} domain={['auto', 'auto']} width={60} />
            
            <Tooltip 
              contentStyle={{ backgroundColor: '#161b22', borderColor: '#30363d', color: '#e6edf3', borderRadius: '8px' }}
              itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
              labelStyle={{ color: '#8b949e', marginBottom: '4px' }}
              formatter={(value) => value.toFixed(0)}
              labelFormatter={(label) => `${label} DTE`}
            />

            {/* Decay Zones */}
            <ReferenceArea x1={maxDays} x2={Math.max(30, Math.min(maxDays, 30))} fill="rgba(34, 197, 94, 0.05)" />
            <ReferenceArea x1={Math.min(maxDays, 30)} x2={15} fill="rgba(234, 179, 8, 0.05)" />
            <ReferenceArea x1={Math.min(maxDays, 15)} x2={0} fill="rgba(239, 68, 68, 0.05)" />

            <ReferenceLine y={0} stroke="#8b949e" strokeDasharray="4 4" />

            <Line type="monotone" dataKey="up10" name="Spot +10%" stroke="#3fb950" strokeWidth={1} strokeDasharray="3 3" dot={false} />
            <Line type="monotone" dataKey="up5" name="Spot +5%" stroke="#3fb950" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="currentSpot" name="Current Spot" stroke="#e3b341" strokeWidth={3} dot={false} />
            <Line type="monotone" dataKey="down5" name="Spot -5%" stroke="#f85149" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="down10" name="Spot -10%" stroke="#f85149" strokeWidth={1} strokeDasharray="3 3" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-center gap-4 mt-2 text-[9px] uppercase tracking-wider font-bold">
        <span className="text-green-500/70">Safe (&gt;30)</span>
        <span className="text-yellow-500/70">Warning (15-30)</span>
        <span className="text-red-500/70">Danger (&lt;15)</span>
      </div>
    </div>
  );
}
