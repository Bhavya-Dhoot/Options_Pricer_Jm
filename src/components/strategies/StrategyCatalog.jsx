import React, { useState, useMemo } from 'react';
import { Search, ChevronDown, Activity, TrendingUp, TrendingDown, Target, Zap } from 'lucide-react';

const CATEGORIES = ['All', 'Single-Leg', 'Vertical Spreads', 'Neutral / Volatility', 'Calendar & Diagonal', 'Ratio Spreads', 'Synthetic & Advanced'];

export default function StrategyCatalog({ strategies, selectedId, onSelect }) {
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('All');
  const [isExpanded, setIsExpanded] = useState(false);

  const filtered = useMemo(() => {
    return strategies.filter(s => {
      const matchSearch = s.name.toLowerCase().includes(search.toLowerCase());
      const matchCat = filterCat === 'All' || s.category === filterCat;
      return matchSearch && matchCat;
    });
  }, [strategies, search, filterCat]);

  const selectedStrat = strategies.find(s => s.id === selectedId);

  const getSentimentStyle = (sentiment) => {
    switch (sentiment) {
      case 'bullish': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'bearish': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'neutral': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'volatility': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      case 'income': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getSentimentIcon = (sentiment) => {
    switch (sentiment) {
      case 'bullish': return <TrendingUp size={12} className="mr-1 inline" />;
      case 'bearish': return <TrendingDown size={12} className="mr-1 inline" />;
      case 'neutral': return <Target size={12} className="mr-1 inline" />;
      case 'volatility': return <Activity size={12} className="mr-1 inline" />;
      case 'income': return <Zap size={12} className="mr-1 inline" />;
      default: return null;
    }
  };

  return (
    <div className="card flex flex-col h-full">
      <div 
        className="p-4 border-b border-[#30363d] cursor-pointer hover:bg-[#161b22] transition-colors flex justify-between items-center"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div>
          <h2 className="text-sm font-semibold text-[#e6edf3]">Strategy Selection</h2>
          <p className="text-xs text-[#58a6ff] font-medium mt-0.5">{selectedStrat?.name}</p>
        </div>
        <ChevronDown size={16} className={`text-[#8b949e] transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
      </div>

      {isExpanded && (
        <div className="p-4 flex flex-col gap-3 max-h-[500px] overflow-y-auto">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-[#8b949e]" />
            <input 
              type="text" 
              placeholder="Search strategies..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-xs text-[#e6edf3] focus:border-[#58a6ff] focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map(c => (
              <button
                key={c}
                onClick={() => setFilterCat(c)}
                className={`px-2 py-1 text-[10px] rounded-full font-medium transition-colors ${
                  filterCat === c ? 'bg-[#58a6ff20] text-[#58a6ff] border border-[#58a6ff40]' : 'bg-[#21262d] text-[#8b949e] border border-transparent hover:text-[#c9d1d9]'
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          <div className="space-y-2 mt-2">
            {filtered.map(s => (
              <div 
                key={s.id}
                onClick={() => { onSelect(s.id); setIsExpanded(false); }}
                className={`p-3 rounded-xl border transition-all cursor-pointer ${
                  selectedId === s.id 
                    ? 'bg-[#1f6feb15] border-[#58a6ff60]' 
                    : 'bg-[#161b22] border-[#30363d] hover:border-[#8b949e60]'
                }`}
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="text-xs font-semibold text-[#e6edf3]">{s.name}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border uppercase tracking-wider font-bold ${getSentimentStyle(s.sentiment)}`}>
                    {getSentimentIcon(s.sentiment)}
                    {s.sentiment}
                  </span>
                </div>
                <p className="text-[10px] text-[#8b949e] mb-1.5 leading-snug">{s.description}</p>
                <div className="flex gap-3 text-[9px] font-mono">
                  <span className={s.riskProfile.maxProfit === 'unlimited' ? 'text-[#3fb950]' : 'text-[#8b949e]'}>
                    Profit: {s.riskProfile.maxProfit}
                  </span>
                  <span className={s.riskProfile.maxLoss === 'unlimited' ? 'text-[#f85149]' : 'text-[#8b949e]'}>
                    Loss: {s.riskProfile.maxLoss}
                  </span>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="text-xs text-[#8b949e] text-center py-4">No strategies found.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
