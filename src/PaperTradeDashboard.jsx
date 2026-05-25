import React, { useState, useEffect } from 'react';
import { DollarSign, Briefcase, Activity, Clock, LogOut, ArrowUpRight, AlertTriangle } from 'lucide-react';
import LiveStrategyBuilder from './LiveStrategyBuilder.jsx';
import { estimateMargin } from './utils/marginCalculator.js';

const parseExpiry = (expiryStr) => {
  if (!expiryStr) return 0;
  try {
    const day = parseInt(expiryStr.slice(0, 2), 10);
    const monthStr = expiryStr.slice(3, 6);
    const year = parseInt(expiryStr.slice(7), 10);
    const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
    const month = months[monthStr];
    if (month === undefined) return 0;
    return new Date(year, month, day).getTime();
  } catch (e) {
    return 0;
  }
};

export default function PaperTradeDashboard({ user, live, onLogout }) {
  const [profile, setProfile] = useState(user);
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isEditingCapital, setIsEditingCapital] = useState(false);
  const [newCapital, setNewCapital] = useState('');
  const [livePrices, setLivePrices] = useState({});
  const [injectedLegs, setInjectedLegs] = useState([]);
  const [lastPortfolioUpdate, setLastPortfolioUpdate] = useState(null);
  const [portfolioTimeSinceUpdate, setPortfolioTimeSinceUpdate] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      if (lastPortfolioUpdate) {
        setPortfolioTimeSinceUpdate(Math.floor((Date.now() - lastPortfolioUpdate) / 1000));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [lastPortfolioUpdate]);

  useEffect(() => {
    fetchProfileAndTrades();
  }, []);

  useEffect(() => {
    if (!profile) return;
    
    // Tiered polling: 1s for 'admin', 5s for 'user'
    const intervalMs = profile.role === 'admin' ? 1000 : 5000;
    
    const fetchLivePrices = async () => {
      if (document.hidden) return; // Prevent background tab memory/bandwidth leaks
      const openSymbols = [...new Set(trades.filter(t => t.status === 'OPEN').map(t => t.symbol))];
      if (openSymbols.length === 0) return;

      try {
        const token = localStorage.getItem('auth_token');
        const priorityParam = profile.role === 'admin' ? '&priority=true' : '';
        const res = await fetch(`/api/trades/live-prices?symbols=${openSymbols.join(',')}${priorityParam}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          setLivePrices(await res.json());
          setLastPortfolioUpdate(Date.now());
        }
      } catch (err) {}
    };

    const interval = setInterval(fetchLivePrices, intervalMs);
    fetchLivePrices(); // initial fetch

    return () => clearInterval(interval);
  }, [profile, trades]);

  const fetchProfileAndTrades = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const headers = { 'Authorization': `Bearer ${token}` };
      
      const [profileRes, tradesRes] = await Promise.all([
        fetch('/api/auth/profile', { headers }),
        fetch('/api/trades', { headers })
      ]);
      
      if (profileRes.ok) setProfile(await profileRes.json());
      if (tradesRes.ok) setTrades(await tradesRes.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleExitTrade = async (tradeId, qty, price) => {
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/trades/exit', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ tradeId, exitQty: qty, exitPrice: price })
      });
      if (res.ok) {
        fetchProfileAndTrades();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to exit trade');
      }
    } catch (err) {
      console.error(err);
      alert('Network error while closing trade');
    }
  };

  const handleCloseAll = async () => {
    if (!window.confirm("Are you sure you want to close ALL open positions at Market Price?")) return;
    
    // Close each position sequentially (or could be Promise.all)
    for (const trade of openTrades) {
      const liveLTP = getLivePriceForTrade(trade);
      await handleExitTrade(trade._id, trade.qty, liveLTP);
    }
  };

  const handleUpdateCapital = async (amount) => {
    const targetCapital = amount !== undefined && typeof amount !== 'object' ? amount : newCapital;
    if (!targetCapital || isNaN(targetCapital)) return;
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/auth/capital', {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ virtualCapital: Number(targetCapital) })
      });
      if (res.ok) {
        setProfile(await res.json());
        setIsEditingCapital(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddCapital = async (amount) => {
    if (!amount || isNaN(amount)) return;
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/auth/add-capital', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ amount: Number(amount) })
      });
      if (res.ok) {
        setProfile(await res.json());
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to add capital');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleInjectToBuilder = (trade) => {
    // Generate a comparative leg
    const leg = {
      id: `compare-${trade._id}`,
      type: trade.type,
      action: trade.action,
      strike: trade.strike,
      qty: trade.qty,
      premium: trade.entryPrice,
      lotSize: trade.lotSize,
      T: trade.type === 'future' ? 0.05 : 0.05, // Default approx
      expiry: trade.expiry,
      isComparative: true // Special flag
    };
    setInjectedLegs([leg]);
  };

  if (loading) return <div className="p-8 text-center text-[#8b949e]">Loading portfolio...</div>;

  const openTrades = trades.filter(t => t.status === 'OPEN');
  const closedTrades = trades.filter(t => t.status === 'CLOSED');

  // Calculate real-time Unrealized PnL mathematically
  let totalUnrealizedPnL = 0;
  
  const getLivePriceForTrade = (trade) => {
    const data = livePrices[trade.symbol];
    if (!data) return trade.entryPrice;

    if (trade.type === 'future') {
      return data.futurePrices?.[trade.expiry] || data.spot || trade.entryPrice;
    } else if (trade.type === 'underlying') {
      return data.spot || trade.entryPrice;
    } else {
      const chain = data.byExpiry?.[trade.expiry];
      if (!chain) {
        // If chain is completely missing, check if it expired!
        const expiryTime = parseExpiry(trade.expiry);
        if (expiryTime && Date.now() > expiryTime + 86400000) {
          // It has expired. Settle at intrinsic value
          const spot = data.spot || trade.entryPrice;
          return trade.type === 'call' ? Math.max(spot - trade.strike, 0) : Math.max(trade.strike - spot, 0);
        }
        return trade.entryPrice;
      }
      const strikeData = chain.find(s => (s.strikePrice || s.strike) === trade.strike);
      if (!strikeData) return trade.entryPrice;
      const optData = trade.type === 'call' ? strikeData.call : strikeData.put;
      if (!optData) return trade.entryPrice;
      // Mark-to-market uses the opposite side to close
      return trade.action === 'buy' ? (optData.bidPrice || optData.ltp) : (optData.askPrice || optData.ltp);
    }
  };

  const augmentedOpenTrades = openTrades.map(trade => {
    const liveLTP = getLivePriceForTrade(trade);
    const direction = trade.action === 'buy' ? 1 : -1;
    
    let lotSize = trade.lotSize;
    if (!lotSize) {
      if (trade.symbol === 'BANKNIFTY') lotSize = 15;
      else if (trade.symbol === 'FINNIFTY') lotSize = 40;
      else if (trade.symbol === 'MIDCPNIFTY') lotSize = 75;
      else if (trade.symbol === 'SENSEX') lotSize = 10;
      else if (trade.symbol === 'BANKEX') lotSize = 15;
      else lotSize = 25;
    }

    const pnl = direction * (liveLTP - trade.entryPrice) * trade.qty * lotSize;
    totalUnrealizedPnL += pnl;
    return { ...trade, liveLTP, pnl, lotSize };
  });

  let usedMargin = 0;
  const tradesBySymbol = openTrades.reduce((acc, trade) => {
    if (!acc[trade.symbol]) acc[trade.symbol] = [];
    acc[trade.symbol].push(trade);
    return acc;
  }, {});

  Object.entries(tradesBySymbol).forEach(([symbol, tradesForSymbol]) => {
    const marginPortfolioLegs = tradesForSymbol.map(t => ({
      type: t.type,
      action: t.action,
      qty: t.qty,
      lotSize: t.lotSize,
      strike: t.strike,
      expiry: t.expiry,
      premium: t.entryPrice
    }));
    const spotForMargin = livePrices[symbol]?.spot || live.data?.spot || tradesForSymbol[0].entryPrice;
    usedMargin += estimateMargin(marginPortfolioLegs, spotForMargin, symbol).totalMarginRequired;
  });

  const virtualCapital = profile?.virtualCapital || 0;
  const marginUtilizationPct = virtualCapital > 0 ? (usedMargin / virtualCapital) * 100 : 0;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-[#e6edf3]">Paper Trading Portfolio</h2>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-sm text-[#8b949e]">{profile.username}</p>
            {lastPortfolioUpdate && (
              <span className="flex items-center gap-1.5 text-xs text-[#8b949e]" title="Time since your open positions were last updated">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950] animate-pulse" />
                Portfolio updated {portfolioTimeSinceUpdate}s ago
              </span>
            )}
          </div>
        </div>
        <button onClick={onLogout} className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors border border-red-500/20">
          <LogOut size={16} /> Logout
        </button>
      </div>

      {marginUtilizationPct >= 90 && (
        <div className="mb-6 bg-red-500/10 border border-red-500/50 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="text-red-500" size={24} />
            <div>
              <h3 className="text-red-500 font-bold">Margin Call Warning (Utilization: {marginUtilizationPct.toFixed(1)}%)</h3>
              <p className="text-red-400 text-sm mt-0.5">Your open positions are dangerously close to exhausting your Available Cash margin. If you hit 100%, you cannot open new positions or hedge.</p>
            </div>
          </div>
          <button 
            onClick={() => handleAddCapital(100000)}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-bold rounded-lg transition-colors whitespace-nowrap shadow-lg shadow-red-500/20"
          >
            + Add ₹1,00,000
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="card p-5 relative group">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign size={18} className="text-blue-400" />
            <span className="text-xs font-semibold text-[#8b949e] uppercase">Virtual Capital</span>
          </div>
          {isEditingCapital ? (
            <div className="flex gap-2 mt-1">
              <input 
                type="number"
                value={newCapital}
                onChange={e => setNewCapital(e.target.value)}
                className="bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-sm rounded px-2 w-full"
                placeholder="Enter new capital"
              />
              <button onClick={handleUpdateCapital} className="bg-blue-500 text-white text-xs px-2 py-1 rounded">Save</button>
              <button onClick={() => setIsEditingCapital(false)} className="bg-gray-600 text-white text-xs px-2 py-1 rounded">Cancel</button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="text-2xl font-mono font-bold text-[#e6edf3]">₹{profile.virtualCapital.toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
              <div className="opacity-0 group-hover:opacity-100 flex gap-3 transition-opacity">
                <button onClick={() => handleUpdateCapital(1000000)} className="text-[#8b949e] hover:text-red-400 text-xs underline">Reset</button>
                <button onClick={() => { setNewCapital(profile.virtualCapital); setIsEditingCapital(true); }} className="text-[#8b949e] hover:text-white text-xs underline">Edit</button>
              </div>
            </div>
          )}
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Activity size={18} className={profile.realizedPnL >= 0 ? "text-green-400" : "text-red-400"} />
              <span className="text-xs font-semibold text-[#8b949e] uppercase">Realized P&L</span>
            </div>
            <div className={`text-2xl font-mono font-bold ${profile.realizedPnL >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]'}`}>
              {profile.realizedPnL >= 0 ? '+' : ''}₹{profile.realizedPnL.toLocaleString(undefined, {minimumFractionDigits: 2})}
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-[#30363d] pt-2 mt-2">
            <div className="text-xs font-semibold text-[#8b949e] uppercase">Unrealized MTM</div>
            <div className={`text-lg font-mono font-bold ${totalUnrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {totalUnrealizedPnL >= 0 ? '+' : ''}₹{totalUnrealizedPnL.toLocaleString(undefined, {minimumFractionDigits: 2})}
            </div>
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-2">
            <Briefcase size={18} className="text-purple-400" />
            <span className="text-xs font-semibold text-[#8b949e] uppercase">Open Positions</span>
          </div>
          <div className="text-2xl font-mono font-bold text-[#e6edf3]">{openTrades.length}</div>
        </div>
      </div>

      <div className="mb-8">
        <h3 className="text-lg font-semibold text-[#e6edf3] mb-4">Strategy Terminal</h3>
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden shadow-2xl">
          <LiveStrategyBuilder 
            live={live} 
            riskFreeRate={6.5} 
            isPaperTradeMode={true} 
            onTradeExecuted={fetchProfileAndTrades}
            injectedLegs={injectedLegs}
          />
        </div>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-[#e6edf3]">Active Positions</h3>
        {augmentedOpenTrades.length > 0 && (
          <button 
            onClick={handleCloseAll}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-lg shadow-lg shadow-red-500/20 transition-colors"
          >
            Close All Positions
          </button>
        )}
      </div>
      <div className="card overflow-hidden mb-8">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#161b22] border-b border-[#30363d]">
            <tr>
              <th className="p-4 text-[#8b949e] font-semibold">Symbol</th>
              <th className="p-4 text-[#8b949e] font-semibold">Action</th>
              <th className="p-4 text-[#8b949e] font-semibold text-right">Qty</th>
              <th className="p-4 text-[#8b949e] font-semibold text-right">Avg Entry</th>
              <th className="p-4 text-[#8b949e] font-semibold text-right">LTP</th>
              <th className="p-4 text-[#8b949e] font-semibold text-right">P&L</th>
              <th className="p-4 text-[#8b949e] font-semibold text-right">Manage</th>
            </tr>
          </thead>
          <tbody>
            {augmentedOpenTrades.length === 0 ? (
              <tr><td colSpan="7" className="p-4 text-center text-[#8b949e]">No open positions. Use the Strategy Builder to place a trade.</td></tr>
            ) : augmentedOpenTrades.map(trade => (
              <tr key={trade._id} className="border-b border-[#30363d]/50 hover:bg-[#161b22]/50 transition-colors">
                <td className="p-4">
                  <div className="font-bold text-[#e6edf3]">{trade.symbol}</div>
                  <div className="text-xs text-[#8b949e]">{trade.expiry || 'SPOT'} {trade.type.toUpperCase()} {trade.strike ? trade.strike : ''}</div>
                </td>
                <td className="p-4">
                  <span className={`px-2 py-1 rounded text-xs font-bold ${trade.action === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {trade.action.toUpperCase()}
                  </span>
                </td>
                <td className="p-4 text-right">
                  <div className="font-mono text-[#e6edf3]">{trade.qty * trade.lotSize}</div>
                  <div className="text-xs text-[#8b949e]">{trade.qty} Lots</div>
                </td>
                <td className="p-4 text-right font-mono text-[#e6edf3]">₹{trade.entryPrice?.toFixed(2)}</td>
                <td className="p-4 text-right font-mono text-[#58a6ff]">₹{trade.liveLTP?.toFixed(2)}</td>
                <td className={`p-4 text-right font-mono font-bold ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {trade.pnl >= 0 ? '+' : ''}₹{trade.pnl.toFixed(2)}
                </td>
                <td className="p-4 text-right flex items-center justify-end gap-2">
                  <button 
                    onClick={() => handleInjectToBuilder(trade)}
                    className="p-1 text-[#8b949e] hover:text-[#58a6ff] hover:bg-[#58a6ff]/10 rounded transition-colors"
                    title="Load to Strategy Builder to Compare"
                  >
                    <ArrowUpRight size={16} />
                  </button>
                  <button 
                    onClick={() => handleExitTrade(trade._id, trade.qty, trade.liveLTP)} 
                    className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-xs font-semibold transition-colors"
                  >
                    Close MTM
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
