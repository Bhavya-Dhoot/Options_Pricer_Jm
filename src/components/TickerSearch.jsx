import React, { useState, useRef, useEffect } from 'react';
import { Search } from 'lucide-react';
import { NSE_FO_SYMBOLS } from '../nseSymbols.js';

export default function TickerSearch({ symbol, onSymbolChange, onFetch }) {
  const [query, setQuery] = useState(symbol);
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef(null);

  // Keep query in sync with external symbol changes
  useEffect(() => {
    setQuery(symbol);
  }, [symbol]);

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleInputChange = (e) => {
    const val = e.target.value.toUpperCase();
    setQuery(val);
    onSymbolChange(val);
    setIsOpen(true);
  };

  const handleSelect = (selectedSymbol) => {
    setQuery(selectedSymbol);
    onSymbolChange(selectedSymbol);
    setIsOpen(false);
    if (onFetch) {
      setTimeout(() => onFetch(selectedSymbol), 0); // Trigger fetch on next tick
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      setIsOpen(false);
      if (onFetch) onFetch(query);
    }
  };

  // Filter recommendations based on fuzzy matching (starts with or includes)
  const recommendations = NSE_FO_SYMBOLS.filter(s => s.includes(query)).sort((a, b) => {
    // Prioritize exact matches or "starts with" over "includes"
    if (a.startsWith(query) && !b.startsWith(query)) return -1;
    if (!a.startsWith(query) && b.startsWith(query)) return 1;
    return a.localeCompare(b);
  }).slice(0, 8); // Show top 8 suggestions

  return (
    <div className="relative" ref={wrapperRef}>
      <div className="relative flex items-center">
        <Search size={14} className="absolute left-3 text-[#8b949e] pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsOpen(true)}
          placeholder="Search Ticker..."
          className="w-[160px] text-xs pl-8 pr-3 py-2 rounded-lg bg-[#0d1117] border border-[#30363d] text-[#e6edf3] font-mono font-semibold tracking-wide focus:border-[#58a6ff] focus:outline-none transition-colors uppercase placeholder-[#484f58]"
        />
      </div>
      
      {isOpen && query && recommendations.length > 0 && (
        <div className="absolute top-full left-0 mt-1 w-full bg-[#161b22] border border-[#30363d] rounded-lg shadow-xl shadow-black/50 z-50 overflow-hidden">
          <ul className="max-h-48 overflow-y-auto divide-y divide-[#30363d]/50">
            {recommendations.map(s => (
              <li 
                key={s}
                onClick={() => handleSelect(s)}
                className="px-3 py-2 text-xs font-mono font-semibold text-[#e6edf3] hover:bg-[#58a6ff]/10 hover:text-[#58a6ff] cursor-pointer transition-colors"
              >
                {/* Highlight matching part */}
                {s.split(new RegExp(`(${query})`, 'gi')).map((part, i) => 
                  part.toUpperCase() === query.toUpperCase() 
                    ? <span key={i} className="text-[#58a6ff]">{part}</span> 
                    : part
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
