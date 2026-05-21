import React, { useMemo, useState, useEffect } from 'react';
import { strategyBSMPnL } from '../../bsm.js';

export default function ScenarioHeatmap({ legs, globalInputs }) {
  const [data, setData] = useState([]);
  const [isComputing, setIsComputing] = useState(false);

  // Spot changes: -15% to +15% in 2% steps (16 rows)
  const spotChanges = Array.from({ length: 16 }, (_, i) => -0.15 + (i * 0.02)).reverse();
  
  // Days Held: 0, 5, 10, 15, 20, 30 DTE remaining. But wait, DTE remaining means T decreases.
  // Actually, days held means days passed. If max DTE is 30, days held = [0, 5, 10, 15, 20, 30].
  // Remaining = maxDTE - daysHeld.
  const daysHeldList = [0, 5, 10, 15, 20, 30];

  useEffect(() => {
    if (!legs || legs.length === 0) {
      setData([]);
      return;
    }

    setIsComputing(true);
    
    // Use setTimeout to allow UI to render the computing state
    const timer = setTimeout(() => {
      const maxT = Math.max(...legs.map(l => l.T));
      const maxDays = Math.round(maxT * 365);
      
      const matrix = spotChanges.map(change => {
        const spot = globalInputs.spot * (1 + change);
        
        const row = daysHeldList.map(daysHeld => {
          if (daysHeld > maxDays) return null; // Strategy already expired
          const tRemaining = (maxDays - daysHeld) / 365;
          const pnl = strategyBSMPnL(legs, spot, tRemaining, globalInputs.iv, globalInputs.rate, globalInputs.dividend);
          return pnl;
        });
        
        return { change, row };
      });
      
      setData(matrix);
      setIsComputing(false);
    }, 50);
    
    return () => clearTimeout(timer);
  }, [legs, globalInputs]);

  if (!legs || legs.length === 0) return null;

  // Find absolute max to scale colors
  let maxAbs = 0;
  data.forEach(row => {
    row.row.forEach(val => {
      if (val !== null && Math.abs(val) > maxAbs) maxAbs = Math.abs(val);
    });
  });

  const getBgColor = (val) => {
    if (val === null) return 'transparent';
    if (val === 0) return 'rgba(255,255,255,0.02)';
    
    // Scale opacity logarithmically or linearly. Let's do linear up to 0.7 max opacity
    const ratio = Math.min(Math.abs(val) / (maxAbs || 1), 1);
    const alpha = 0.1 + ratio * 0.6;
    
    return val > 0 ? `rgba(63, 185, 80, ${alpha})` : `rgba(248, 81, 73, ${alpha})`;
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[#e6edf3]">P&L Scenario Heatmap</h3>
        <p className="text-[10px] text-[#8b949e]">Spot % vs Days Held</p>
      </div>
      
      {isComputing ? (
        <div className="h-[300px] flex items-center justify-center text-[#8b949e] animate-pulse">
          Computing matrix...
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-center text-[10px] font-mono">
            <thead>
              <tr>
                <th className="p-1 border border-[#30363d] bg-[#161b22] text-[#8b949e] font-normal w-16">
                  Spot Δ
                </th>
                {daysHeldList.map(dh => (
                  <th key={dh} className="p-1 border border-[#30363d] bg-[#161b22] text-[#e6edf3] font-normal min-w-[60px]">
                    +{dh}d
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i}>
                  <td className={`p-1 border border-[#30363d] font-bold ${row.change > 0 ? 'text-[#3fb950]' : (row.change < 0 ? 'text-[#f85149]' : 'text-[#e6edf3]')}`}>
                    {row.change > 0 ? '+' : ''}{(row.change * 100).toFixed(0)}%
                  </td>
                  {row.row.map((val, j) => (
                    <td 
                      key={j} 
                      className="p-1.5 border border-[#30363d]/50 transition-colors hover:border-[#e6edf3]"
                      style={{ backgroundColor: getBgColor(val) }}
                    >
                      {val === null ? (
                        <span className="text-[#8b949e]/30">-</span>
                      ) : (
                        <span className={val > 0 ? 'text-[#e6edf3]' : (val < 0 ? 'text-white' : 'text-[#8b949e]')}>
                          {val > 0 ? '+' : ''}{Math.round(val)}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
