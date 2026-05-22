import React from 'react';
import { LayoutTemplate, ChevronRight } from 'lucide-react';

const TEMPLATES = [
  {
    id: 'straddle',
    name: 'Long Straddle',
    desc: 'Buy ATM Call & ATM Put. Profits from high volatility in either direction.',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/20',
    buildLegs: (spot, step) => {
      const atm = Math.round(spot / step) * step;
      return [
        { type: 'call', action: 'buy', strike: atm, qty: 1 },
        { type: 'put', action: 'buy', strike: atm, qty: 1 }
      ];
    }
  },
  {
    id: 'strangle',
    name: 'Long Strangle',
    desc: 'Buy OTM Call & OTM Put. Cheaper than straddle, needs larger move.',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    buildLegs: (spot, step) => {
      const atm = Math.round(spot / step) * step;
      return [
        { type: 'call', action: 'buy', strike: atm + step, qty: 1 },
        { type: 'put', action: 'buy', strike: atm - step, qty: 1 }
      ];
    }
  },
  {
    id: 'bull-call',
    name: 'Bull Call Spread',
    desc: 'Buy ATM Call, Sell OTM Call. Limited risk/reward bullish trade.',
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    border: 'border-green-500/20',
    buildLegs: (spot, step) => {
      const atm = Math.round(spot / step) * step;
      return [
        { type: 'call', action: 'buy', strike: atm, qty: 1 },
        { type: 'call', action: 'sell', strike: atm + step, qty: 1 }
      ];
    }
  },
  {
    id: 'bear-put',
    name: 'Bear Put Spread',
    desc: 'Buy ATM Put, Sell OTM Put. Limited risk/reward bearish trade.',
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    buildLegs: (spot, step) => {
      const atm = Math.round(spot / step) * step;
      return [
        { type: 'put', action: 'buy', strike: atm, qty: 1 },
        { type: 'put', action: 'sell', strike: atm - step, qty: 1 }
      ];
    }
  },
  {
    id: 'iron-condor',
    name: 'Iron Condor',
    desc: 'Sell OTM Put & Call, Buy further OTM Put & Call. Market neutral.',
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/20',
    buildLegs: (spot, step) => {
      const atm = Math.round(spot / step) * step;
      return [
        { type: 'put', action: 'sell', strike: atm - step, qty: 1 },
        { type: 'put', action: 'buy', strike: atm - (step * 2), qty: 1 },
        { type: 'call', action: 'sell', strike: atm + step, qty: 1 },
        { type: 'call', action: 'buy', strike: atm + (step * 2), qty: 1 }
      ];
    }
  }
];

export default function StrategyTemplates({ onApply, spotPrice, symbol }) {
  const handleApply = (template) => {
    // Determine step size based on symbol or spot price heuristics
    let stepSize = 50;
    if (symbol === 'BANKNIFTY') stepSize = 100;
    else if (symbol === 'SENSEX') stepSize = 100;
    else if (spotPrice > 50000) stepSize = 100;
    else if (spotPrice < 5000) stepSize = 10;
    
    const newLegs = template.buildLegs(spotPrice || 24500, stepSize);
    onApply(newLegs);
  };

  return (
    <div className="card p-5 mb-5">
      <div className="flex items-center gap-2 mb-4">
        <LayoutTemplate size={18} className="text-[#58a6ff]" />
        <h2 className="text-lg font-semibold text-[#e6edf3]">Pre-made Strategies</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
        {TEMPLATES.map(tpl => (
          <div 
            key={tpl.id}
            onClick={() => handleApply(tpl)}
            className={`border ${tpl.border} bg-[#0d1117] hover:${tpl.bg} transition-colors rounded-lg p-4 cursor-pointer group`}
          >
            <div className="flex justify-between items-start mb-2">
              <h3 className={`font-bold text-sm ${tpl.color}`}>{tpl.name}</h3>
              <ChevronRight size={14} className="text-[#8b949e] group-hover:text-white transition-colors" />
            </div>
            <p className="text-xs text-[#8b949e] leading-relaxed">
              {tpl.desc}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
