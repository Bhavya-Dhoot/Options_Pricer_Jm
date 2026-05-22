import React, { useState, useEffect } from 'react';
import { DollarSign, Briefcase, Activity, Clock, LogOut } from 'lucide-react';

export default function PaperTradeDashboard({ user, onLogout }) {
  const [profile, setProfile] = useState(user);
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProfileAndTrades();
  }, []);

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
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) return <div className="p-8 text-center text-[#8b949e]">Loading portfolio...</div>;

  const openTrades = trades.filter(t => t.status === 'OPEN');
  const closedTrades = trades.filter(t => t.status === 'CLOSED');

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-[#e6edf3]">Paper Trading Portfolio</h2>
          <p className="text-sm text-[#8b949e]">{profile.email}</p>
        </div>
        <button onClick={onLogout} className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors border border-red-500/20">
          <LogOut size={16} /> Logout
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign size={18} className="text-blue-400" />
            <span className="text-xs font-semibold text-[#8b949e] uppercase">Virtual Capital</span>
          </div>
          <div className="text-2xl font-mono font-bold text-[#e6edf3]">₹{profile.virtualCapital.toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-2">
            <Activity size={18} className={profile.realizedPnL >= 0 ? "text-green-400" : "text-red-400"} />
            <span className="text-xs font-semibold text-[#8b949e] uppercase">Realized P&L</span>
          </div>
          <div className={`text-2xl font-mono font-bold ${profile.realizedPnL >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]'}`}>
            {profile.realizedPnL >= 0 ? '+' : ''}₹{profile.realizedPnL.toLocaleString(undefined, {minimumFractionDigits: 2})}
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

      <h3 className="text-lg font-semibold text-[#e6edf3] mb-4">Active Positions</h3>
      <div className="card overflow-hidden mb-8">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#161b22] border-b border-[#30363d]">
            <tr>
              <th className="p-4 text-[#8b949e] font-semibold">Symbol</th>
              <th className="p-4 text-[#8b949e] font-semibold">Action</th>
              <th className="p-4 text-[#8b949e] font-semibold text-right">Qty</th>
              <th className="p-4 text-[#8b949e] font-semibold text-right">Entry</th>
              <th className="p-4 text-[#8b949e] font-semibold text-right">Manage</th>
            </tr>
          </thead>
          <tbody>
            {openTrades.length === 0 ? (
              <tr><td colSpan="5" className="p-4 text-center text-[#8b949e]">No open positions. Use the Strategy Builder to place a trade.</td></tr>
            ) : openTrades.map(trade => (
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
                <td className="p-4 text-right font-mono">{trade.qty} × {trade.lotSize}</td>
                <td className="p-4 text-right font-mono">₹{trade.entryPrice?.toFixed(2)}</td>
                <td className="p-4 text-right">
                  <button 
                    onClick={() => handleExitTrade(trade._id, trade.qty, trade.entryPrice * 1.05)} // Mocking +5% exit for testing UI
                    className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs font-semibold transition-colors"
                  >
                    Mock Close
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
