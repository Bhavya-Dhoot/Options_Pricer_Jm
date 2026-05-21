import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { probabilityOfProfit, strategyPayoffAtExpiry } from '../../bsm.js';

export default function ProbabilityPanel({ legs, globalInputs }) {
  const probData = useMemo(() => {
    if (!legs || legs.length === 0) return null;
    
    const maxT = Math.max(...legs.map(l => l.T));
    if (maxT <= 0) return null;

    const S = globalInputs.spot;
    const r = globalInputs.rate;
    const q = globalInputs.dividend;
    const iv = globalInputs.iv;
    
    // Get summary metrics
    const stats = probabilityOfProfit(legs, S, maxT, r, q, iv);
    
    // Generate distribution curve data for chart
    const mu = Math.log(S) + (r - q - (iv * iv) / 2) * maxT;
    const sigmaRootT = iv * Math.sqrt(maxT);
    
    const logMin = mu - 3 * sigmaRootT;
    const logMax = mu + 3 * sigmaRootT;
    const spotMin = Math.exp(logMin);
    const spotMax = Math.exp(logMax);
    
    const steps = 100;
    const dx = (spotMax - spotMin) / steps;
    const data = [];
    
    for (let i = 0; i <= steps; i++) {
      const spot = spotMin + i * dx;
      const pdf = Math.exp(-Math.pow(Math.log(spot) - mu, 2) / (2 * sigmaRootT * sigmaRootT)) 
                  / (spot * sigmaRootT * Math.sqrt(2 * Math.PI));
      const pnl = strategyPayoffAtExpiry(legs, spot);
      
      data.push({
        spot,
        pdf,
        profitPdf: pnl > 0 ? pdf : 0,
        lossPdf: pnl < 0 ? pdf : 0,
        pnl
      });
    }
    
    return { stats, data, S };
  }, [legs, globalInputs]);

  if (!probData) return (
    <div className="h-full flex items-center justify-center text-xs text-[#8b949e]">
      Invalid Expiry / No strategy selected
    </div>
  );

  const { stats, data, S } = probData;

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const pnl = payload[0].payload.pnl;
    return (
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-2 text-xs shadow-xl font-mono">
        <div>Spot: <span className="text-[#e6edf3]">₹{Number(label).toFixed(0)}</span></div>
        <div className={pnl > 0 ? 'text-[#3fb950]' : 'text-[#f85149]'}>P&L: {pnl > 0 ? '+' : ''}₹{pnl.toFixed(0)}</div>
      </div>
    );
  };

  return (
    <div className="w-full h-full flex flex-col">
      <h3 className="text-sm font-semibold text-[#e6edf3] mb-4">Probability Analysis</h3>
      
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Expected Value</div>
          <div className={`font-mono text-xl font-bold ${stats.ev > 0 ? 'text-[#3fb950]' : 'text-[#f85149]'}`}>
            {stats.ev > 0 ? '+' : ''}₹{stats.ev.toFixed(0)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Prob. of Profit</div>
          <div className="font-mono text-xl font-bold text-[#e6edf3]">
            {(stats.pop * 100).toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Prob. Max Profit</div>
          <div className="font-mono text-lg font-bold text-[#58a6ff]">
            {(stats.pMaxProfit * 100).toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">Prob. Max Loss</div>
          <div className="font-mono text-lg font-bold text-[#f85149]">
            {(stats.pMaxLoss * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-[150px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
            <XAxis 
              dataKey="spot" 
              type="number"
              domain={['dataMin', 'dataMax']}
              tick={{ fill: '#8b949e', fontSize: 10 }}
              tickFormatter={v => Math.round(v)}
              label={{ value: 'Implied Distribution at Expiry', position: 'bottom', fill: '#8b949e', fontSize: 10, offset: 5 }}
            />
            <Tooltip content={<CustomTooltip />} />
            
            {/* Loss Area (Red) */}
            <Area type="monotone" dataKey="lossPdf" stroke="none" fill="#f85149" fillOpacity={0.3} isAnimationActive={false} />
            {/* Profit Area (Green) */}
            <Area type="monotone" dataKey="profitPdf" stroke="none" fill="#3fb950" fillOpacity={0.3} isAnimationActive={false} />
            
            {/* Full PDF outline */}
            <Area type="monotone" dataKey="pdf" stroke="#8b949e" strokeWidth={1} fill="none" isAnimationActive={false} />
            
            <ReferenceLine x={S} stroke="#e3b341" strokeDasharray="3 3" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
