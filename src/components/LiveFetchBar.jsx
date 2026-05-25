import React, { useState, useEffect } from 'react';
import { Radio, Wifi, WifiOff, Loader2, AlertTriangle } from 'lucide-react';
import TickerSearch from './TickerSearch.jsx';
import { useLiveData } from '../useLiveData.js';

export default function LiveFetchBar({ live: externalLive, onFetch, onFetchComplete }) {
  const internalLive = useLiveData();
  const live = externalLive || internalLive;
  const [symbol, setSymbol] = useState(live?.data?.symbol || 'NIFTY');
  const [timeSinceUpdate, setTimeSinceUpdate] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      if (live.lastUpdate) {
        setTimeSinceUpdate(Math.floor((Date.now() - live.lastUpdate) / 1000));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [live.lastUpdate]);

  const handleFetchLive = async (sym = symbol) => {
    const s = (typeof sym === 'string' ? sym : symbol).trim().toUpperCase();
    if (!s) return;
    
    if (onFetch) {
      await onFetch(s);
    } else if (live) {
      const chain = await live.fetchNow(s);
      if (chain && onFetchComplete) {
        onFetchComplete(chain, s);
      }
    }
  };

  return (
    <div className="card p-3 mb-5 flex items-center justify-between flex-wrap gap-2">
      <div className="flex items-center gap-2">
        <TickerSearch 
          symbol={symbol}
          onSymbolChange={setSymbol}
          onFetch={handleFetchLive}
        />

        <button
          onClick={() => handleFetchLive(symbol)}
          disabled={live.isLoading || !symbol.trim()}
          className={`flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg font-semibold transition-all cursor-pointer ${
            live.isLoading
              ? 'bg-[#30363d] text-[#8b949e] cursor-wait'
              : 'bg-gradient-to-r from-[#238636] to-[#2ea043] text-white hover:from-[#2ea043] hover:to-[#3fb950] shadow-md shadow-[#23863620]'
          }`}
        >
          {live.isLoading ? <Loader2 size={14} className="animate-spin" /> : <Radio size={14} />}
          {live.isLoading ? 'Fetching...' : 'Fetch Live'}
        </button>

        <button
          onClick={() => live.isLive ? live.stopAutoRefresh() : live.startAutoRefresh(30000, symbol.trim().toUpperCase() || 'NIFTY')}
          title="Auto-refresh Strategy Builder data (Portfolio updates automatically)"
          className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-medium transition-all cursor-pointer border ${
            live.isLive
              ? 'border-[#3fb95040] bg-[#3fb95010] text-[#3fb950]'
              : 'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#58a6ff]'
          }`}
        >
          {live.isLive ? <Wifi size={13} /> : <WifiOff size={13} />}
          {live.isLive ? 'Auto: ON' : 'Auto: OFF'}
        </button>
      </div>

      <div className="flex items-center gap-3 text-xs">
        {live.data && (
          <span className="flex items-center gap-1.5 text-[#3fb950]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950] animate-pulse" />
            {symbol.trim().toUpperCase() || 'NIFTY'}: ₹{live.data.spot?.toFixed(2)}
          </span>
        )}
        {live.lastUpdate && (
          <span className="text-[#8b949e]" title="Time since the strategy builder data was last fetched">
            Strategy updated {timeSinceUpdate}s ago
          </span>
        )}
        {live.error && (
          <span className="flex items-center gap-1 text-[#f85149]">
            <AlertTriangle size={12} />
            {live.error}
          </span>
        )}
      </div>
    </div>
  );
}
