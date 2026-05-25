import React from 'react';
import { LayoutTemplate, ChevronRight } from 'lucide-react';
import { STRATEGIES } from '../../strategyDefinitions.js';

const getColors = (sentiment) => {
  switch (sentiment) {
    case 'bullish': return { color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/20' };
    case 'bearish': return { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' };
    case 'volatility': return { color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' };
    case 'income': return { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' };
    case 'neutral': 
    default: return { color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' };
  }
};

export default function StrategyTemplates({ onApply, spotPrice, symbol }) {
  const handleApply = (strat) => {
    // Determine step size based on symbol or spot price heuristics
    let stepSize = 50;
    if (symbol === 'BANKNIFTY') stepSize = 100;
    else if (symbol === 'SENSEX') stepSize = 100;
    else if (spotPrice > 50000) stepSize = 100;
    else if (spotPrice < 5000) stepSize = 10;
    
    const atm = Math.round((spotPrice || 24500) / stepSize) * stepSize;
    
    const newLegs = strat.legs.map(leg => {
      // Scale the strikeOffset (which is relative to 50 in definitions) to the actual step size
      const stepsAway = leg.type !== 'underlying' ? (leg.strikeOffset || 0) / (strat.strikeSeparation || 50) : 0;
      const strike = atm + (stepsAway * stepSize);
      
      return {
        type: leg.type === 'underlying' ? 'future' : leg.type,
        action: leg.action,
        strike: leg.type === 'underlying' ? 0 : strike,
        qty: leg.qty || 1
      };
    });
    
    onApply(newLegs);
  };

  return (
    <div className="card p-5 mb-5">
      <div className="flex items-center gap-2 mb-4">
        <LayoutTemplate size={18} className="text-[#58a6ff]" />
        <h2 className="text-lg font-semibold text-[#e6edf3]">Pre-made Strategies</h2>
      </div>
      <div className="flex overflow-x-auto pb-4 gap-4 snap-x snap-mandatory" style={{ scrollbarWidth: 'thin', scrollbarColor: '#30363d transparent' }}>
        {STRATEGIES.map(strat => {
          const style = getColors(strat.sentiment);
          return (
            <div 
              key={strat.id}
              onClick={() => handleApply(strat)}
              className={`min-w-[260px] max-w-[280px] snap-start flex-shrink-0 border ${style.border} bg-[#0d1117] hover:${style.bg} transition-colors rounded-lg p-4 cursor-pointer group`}
            >
              <div className="flex justify-between items-start mb-2">
                <h3 className={`font-bold text-sm ${style.color}`}>{strat.name}</h3>
                <ChevronRight size={14} className="text-[#8b949e] group-hover:text-white transition-colors" />
              </div>
              <p className="text-xs text-[#8b949e] leading-relaxed">
                {strat.description}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
