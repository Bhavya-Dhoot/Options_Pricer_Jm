import React, { useState, useEffect, useCallback } from 'react';
import { ShoppingCart, TrendingUp, TrendingDown, X, Target, Shield, Loader2, BarChart2 } from 'lucide-react';
import TickerSearch from './TickerSearch.jsx';

const API_BASE = '/api';

export default function EquityTerminal({ trades = [], livePrices = {}, onTradeExecuted, onExitTrade }) {
  const [symbol, setSymbol] = useState('RELIANCE');
  const [qty, setQty] = useState(1);
  const [targetPrice, setTargetPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [liveCMP, setLiveCMP] = useState(null);
  const [isFetchingQuote, setIsFetchingQuote] = useState(false);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const equityTrades = trades.filter(t => t.type === 'equity');
  const openTrades = equityTrades.filter(t => t.status === 'OPEN');
  const closedTrades = equityTrades.filter(t => t.status === 'CLOSED');

  // Fetch live CMP when symbol changes
  const fetchQuote = useCallback(async (sym) => {
    const s = (typeof sym === 'string' ? sym : symbol).trim().toUpperCase();
    if (!s) return;
    setIsFetchingQuote(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/equity/quote?symbol=${s}`);
      if (res.ok) {
        const data = await res.json();
        setLiveCMP(data.ltp);
      } else {
        const err = await res.json();
        setError(err.error || 'Quote unavailable');
        setLiveCMP(null);
      }
    } catch (e) {
      setError('Network error fetching quote');
      setLiveCMP(null);
    } finally {
      setIsFetchingQuote(false);
    }
  }, [symbol]);

  useEffect(() => {
    if (symbol) fetchQuote(symbol);
  }, [symbol]);

  // Auto-refresh CMP every 10 seconds
  useEffect(() => {
    if (!symbol) return;
    const interval = setInterval(() => {
      if (!document.hidden) fetchQuote(symbol);
    }, 10000);
    return () => clearInterval(interval);
  }, [symbol, fetchQuote]);

  const handleBuy = async () => {
    if (!symbol || qty <= 0 || !liveCMP) return;
    setIsPlacingOrder(true);
    setError('');
    setSuccess('');
    try {
      const token = localStorage.getItem('auth_token');
      const body = {
        symbol: symbol.trim().toUpperCase(),
        type: 'equity',
        action: 'buy',
        qty: parseInt(qty, 10),
        orderType: 'market',
        expectedPrice: liveCMP,
        slippageTolerance: 2
      };
      if (targetPrice && !isNaN(targetPrice)) body.targetPrice = Number(targetPrice);
      if (stopLoss && !isNaN(stopLoss)) body.stopLoss = Number(stopLoss);

      const res = await fetch(`${API_BASE}/trades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        setSuccess(`Bought ${qty} shares of ${symbol} at ₹${liveCMP.toFixed(2)}`);
        setTargetPrice('');
        setStopLoss('');
        if (onTradeExecuted) onTradeExecuted();
      } else {
        const data = await res.json();
        setError(data.error || 'Order failed');
      }
    } catch (e) {
      setError('Network error placing order');
    } finally {
      setIsPlacingOrder(false);
    }
  };

  const handleSell = async () => {
    if (!symbol || qty <= 0 || !liveCMP) return;
    setIsPlacingOrder(true);
    setError('');
    setSuccess('');
    try {
      const token = localStorage.getItem('auth_token');
      const body = {
        symbol: symbol.trim().toUpperCase(),
        type: 'equity',
        action: 'sell',
        qty: parseInt(qty, 10),
        orderType: 'market',
        expectedPrice: liveCMP,
        slippageTolerance: 2
      };
      if (targetPrice && !isNaN(targetPrice)) body.targetPrice = Number(targetPrice);
      if (stopLoss && !isNaN(stopLoss)) body.stopLoss = Number(stopLoss);

      const res = await fetch(`${API_BASE}/trades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        setSuccess(`Sold ${qty} shares of ${symbol} at ₹${liveCMP.toFixed(2)}`);
        setTargetPrice('');
        setStopLoss('');
        if (onTradeExecuted) onTradeExecuted();
      } else {
        const data = await res.json();
        setError(data.error || 'Order failed');
      }
    } catch (e) {
      setError('Network error placing order');
    } finally {
      setIsPlacingOrder(false);
    }
  };

  const getLivePriceForEquity = (trade) => {
    const data = livePrices[trade.symbol];
    if (data?.spot) return data.spot;
    return trade.entryPrice;
  };

  let totalUnrealizedPnL = 0;
  const augmentedOpenTrades = openTrades.map(trade => {
    const cmp = getLivePriceForEquity(trade);
    const direction = trade.action === 'buy' ? 1 : -1;
    const pnl = direction * (cmp - trade.entryPrice) * trade.qty;
    totalUnrealizedPnL += pnl;
    return { ...trade, cmp, pnl };
  });

  const orderValue = liveCMP ? (liveCMP * qty).toFixed(2) : '—';

  return (
    <div className="space-y-6">
      {/* Buy/Sell Form */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5">
        <h4 className="text-sm font-bold text-[#e6edf3] uppercase tracking-wider mb-4 flex items-center gap-2">
          <BarChart2 size={16} className="text-cyan-400" />
          Equity Order
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Symbol */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] text-[#8b949e] uppercase font-bold tracking-wider">Symbol</label>
            <TickerSearch
              symbol={symbol}
              onSymbolChange={(s) => { setSymbol(s); setLiveCMP(null); }}
              onFetch={(s) => { setSymbol(s); fetchQuote(s); }}
            />
          </div>

          {/* CMP */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] text-[#8b949e] uppercase font-bold tracking-wider">Current Market Price</label>
            <div className="bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm font-mono font-bold text-[#58a6ff] flex items-center gap-2">
              {isFetchingQuote ? (
                <><Loader2 size={14} className="animate-spin" /> Fetching...</>
              ) : liveCMP ? (
                <>₹{liveCMP.toFixed(2)}</>
              ) : (
                <span className="text-[#8b949e]">—</span>
              )}
            </div>
          </div>

          {/* Quantity */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] text-[#8b949e] uppercase font-bold tracking-wider">Qty (Shares)</label>
            <input
              type="number"
              min="1"
              max="10000"
              value={qty}
              onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))}
              className="bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-sm rounded-lg px-3 py-2 font-mono focus:ring-2 focus:ring-cyan-400 focus:border-transparent outline-none"
            />
          </div>

          {/* Order Value */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] text-[#8b949e] uppercase font-bold tracking-wider">Order Value</label>
            <div className="bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm font-mono text-[#e6edf3]">
              ₹{orderValue}
            </div>
          </div>
        </div>

        {/* TP/SL Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div className="flex items-center gap-2">
            <Target size={14} className="text-green-400 shrink-0" />
            <input
              type="number"
              step="0.05"
              placeholder="Target Price (optional)"
              value={targetPrice}
              onChange={e => setTargetPrice(e.target.value)}
              className="bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-sm rounded-lg px-3 py-2 font-mono w-full focus:ring-2 focus:ring-green-400 focus:border-transparent outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <Shield size={14} className="text-red-400 shrink-0" />
            <input
              type="number"
              step="0.05"
              placeholder="Stop Loss (optional)"
              value={stopLoss}
              onChange={e => setStopLoss(e.target.value)}
              className="bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-sm rounded-lg px-3 py-2 font-mono w-full focus:ring-2 focus:ring-red-400 focus:border-transparent outline-none"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 mt-5">
          <button
            onClick={handleBuy}
            disabled={isPlacingOrder || !liveCMP || qty <= 0}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-[#238636] to-[#2ea043] text-white font-bold text-sm rounded-xl hover:from-[#2ea043] hover:to-[#3fb950] disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-green-500/10"
          >
            {isPlacingOrder ? <Loader2 size={16} className="animate-spin" /> : <TrendingUp size={16} />}
            BUY
          </button>
          <button
            onClick={handleSell}
            disabled={isPlacingOrder || !liveCMP || qty <= 0}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-[#da3633] to-[#f85149] text-white font-bold text-sm rounded-xl hover:from-[#f85149] hover:to-[#ff7b72] disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-red-500/10"
          >
            {isPlacingOrder ? <Loader2 size={16} className="animate-spin" /> : <TrendingDown size={16} />}
            SELL
          </button>
        </div>

        {/* Feedback */}
        {error && (
          <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mt-3 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm">
            {success}
          </div>
        )}
      </div>

      {/* Active Equity Positions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-bold text-[#e6edf3] uppercase tracking-wider">
            Equity Positions ({openTrades.length})
          </h4>
          {openTrades.length > 0 && (
            <div className={`text-sm font-mono font-bold ${totalUnrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              Unrealized: {totalUnrealizedPnL >= 0 ? '+' : ''}₹{totalUnrealizedPnL.toFixed(2)}
            </div>
          )}
        </div>
        <div className="card overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#161b22] border-b border-[#30363d]">
              <tr>
                <th className="p-3 text-[#8b949e] font-semibold">Symbol</th>
                <th className="p-3 text-[#8b949e] font-semibold">Action</th>
                <th className="p-3 text-[#8b949e] font-semibold text-right">Shares</th>
                <th className="p-3 text-[#8b949e] font-semibold text-right">Avg Entry</th>
                <th className="p-3 text-[#8b949e] font-semibold text-right">CMP</th>
                <th className="p-3 text-[#8b949e] font-semibold text-right">P&L</th>
                <th className="p-3 text-[#8b949e] font-semibold text-right">Manage</th>
              </tr>
            </thead>
            <tbody>
              {augmentedOpenTrades.length === 0 ? (
                <tr><td colSpan="7" className="p-4 text-center text-[#8b949e]">No open equity positions. Use the form above to buy shares.</td></tr>
              ) : augmentedOpenTrades.map(trade => (
                <tr key={trade._id} className="border-b border-[#30363d]/50 hover:bg-[#161b22]/50 transition-colors">
                  <td className="p-3">
                    <div className="font-bold text-[#e6edf3]">{trade.symbol}</div>
                    <div className="text-[10px] text-[#8b949e]">EQUITY</div>
                    {(trade.targetPrice || trade.stopLoss) && (
                      <div className="flex gap-1.5 mt-1">
                        {trade.targetPrice && (
                          <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/20">
                            TP ₹{trade.targetPrice}
                          </span>
                        )}
                        {trade.stopLoss && (
                          <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/20">
                            SL ₹{trade.stopLoss}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${trade.action === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                      {trade.action.toUpperCase()}
                    </span>
                  </td>
                  <td className="p-3 text-right font-mono text-[#e6edf3]">{trade.qty}</td>
                  <td className="p-3 text-right font-mono text-[#e6edf3]">₹{trade.entryPrice?.toFixed(2)}</td>
                  <td className="p-3 text-right font-mono text-[#58a6ff]">₹{trade.cmp?.toFixed(2)}</td>
                  <td className={`p-3 text-right font-mono font-bold ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    <div>{trade.pnl >= 0 ? '+' : ''}₹{trade.pnl.toFixed(2)}</div>
                    <div className="text-[10px] font-normal text-[#8b949e]">
                      {((trade.action === 'buy' ? 1 : -1) * (trade.cmp - trade.entryPrice)).toFixed(2)}/share
                    </div>
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => onExitTrade(trade._id, trade.qty, trade.cmp)}
                      className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-xs font-semibold transition-colors"
                    >
                      {trade.action === 'buy' ? 'Sell' : 'Cover'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Equity P&L Ledger */}
      {closedTrades.length > 0 && (
        <div>
          <h4 className="text-sm font-bold text-[#e6edf3] uppercase tracking-wider mb-3">
            Equity P&L Ledger ({closedTrades.length} trades)
          </h4>
          <div className="card overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#161b22] border-b border-[#30363d]">
                <tr>
                  <th className="p-3 text-[#8b949e] font-semibold">Symbol</th>
                  <th className="p-3 text-[#8b949e] font-semibold">Action</th>
                  <th className="p-3 text-[#8b949e] font-semibold text-right">Shares</th>
                  <th className="p-3 text-[#8b949e] font-semibold text-right">Entry</th>
                  <th className="p-3 text-[#8b949e] font-semibold text-right">Exit</th>
                  <th className="p-3 text-[#8b949e] font-semibold text-right">Realized P&L</th>
                </tr>
              </thead>
              <tbody>
                {closedTrades.map(trade => (
                  <tr key={trade._id} className="border-b border-[#30363d]/50 hover:bg-[#161b22]/50 transition-colors">
                    <td className="p-3">
                      <div className="font-bold text-[#e6edf3]">{trade.symbol}</div>
                      <div className="text-[10px] text-[#8b949e]">EQUITY</div>
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${trade.action === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                        {trade.action.toUpperCase()}
                      </span>
                    </td>
                    <td className="p-3 text-right font-mono text-[#e6edf3]">{trade.qty}</td>
                    <td className="p-3 text-right">
                      <div className="font-mono text-[#e6edf3]">₹{trade.entryPrice?.toFixed(2)}</div>
                      <div className="text-[10px] text-gray-500">{new Date(trade.entryTime).toLocaleString()}</div>
                    </td>
                    <td className="p-3 text-right">
                      <div className="font-mono text-[#e6edf3]">₹{trade.exitPrice?.toFixed(2)}</div>
                      <div className="text-[10px] text-gray-500">{new Date(trade.exitTime).toLocaleString()}</div>
                    </td>
                    <td className={`p-3 text-right font-mono font-bold ${trade.realizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      <div>{trade.realizedPnL >= 0 ? '+' : ''}₹{trade.realizedPnL?.toFixed(2) || '0.00'}</div>
                      {trade.exitReason && (
                        <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded mt-1 inline-block ${
                          trade.exitReason === 'TARGET_HIT' ? 'bg-green-500/15 text-green-400 border border-green-500/20' :
                          trade.exitReason === 'STOPLOSS_HIT' ? 'bg-red-500/15 text-red-400 border border-red-500/20' :
                          'bg-gray-500/15 text-gray-400 border border-gray-500/20'
                        }`}>
                          {trade.exitReason === 'TARGET_HIT' ? '🎯 Target' : trade.exitReason === 'STOPLOSS_HIT' ? '🛑 Stop Loss' : 'Manual'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
