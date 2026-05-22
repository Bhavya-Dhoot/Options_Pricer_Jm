import React from 'react';
import { Trash2, Plus } from 'lucide-react';
import { calculateBSM, premiumAt } from '../../bsm.js';

export default function LegConfigurator({ legs, onUpdateLeg, onAddLeg, onRemoveLeg }) {
  const getBadgeColor = (type, action) => {
    if (type === 'call' && action === 'buy') return 'text-green-400';
    if (type === 'put' && action === 'buy') return 'text-red-400';
    if (type === 'call' && action === 'sell') return 'text-orange-400';
    if (type === 'put' && action === 'sell') return 'text-blue-400';
    return 'text-gray-400';
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-[#30363d] text-[10px] text-[#8b949e] uppercase tracking-wider">
            <th className="pb-2 font-medium w-6">#</th>
            <th className="pb-2 font-medium w-32">Leg</th>
            <th className="pb-2 font-medium w-24">Strike</th>
            <th className="pb-2 font-medium w-20">DTE</th>
            <th className="pb-2 font-medium w-20">Lots</th>
            <th className="pb-2 font-medium w-24">Entry Price</th>
            <th className="pb-2 font-medium w-24">Breakeven</th>
            <th className="pb-2 font-medium w-8"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#30363d]/50">
          {legs.map((leg, idx) => (
            <tr key={leg.id} className="text-xs">
              <td className="py-2.5 text-[#8b949e]">{idx + 1}</td>
              <td className="py-2.5">
                <div className="flex gap-1">
                  <select 
                    value={leg.action} 
                    onChange={e => onUpdateLeg(leg.id, { action: e.target.value })}
                    className={`bg-[#0d1117] border border-[#30363d] rounded px-1 py-1 text-[10px] uppercase font-bold focus:outline-none ${getBadgeColor(leg.type, leg.action)}`}
                  >
                    <option value="buy">Buy</option>
                    <option value="sell">Sell</option>
                  </select>
                  <select 
                    value={leg.type} 
                    onChange={e => onUpdateLeg(leg.id, { type: e.target.value })}
                    className="bg-[#0d1117] border border-[#30363d] rounded px-1 py-1 text-[10px] uppercase font-bold text-[#e6edf3] focus:outline-none min-w-[70px]"
                  >
                    <option value="call">Call</option>
                    <option value="put">Put</option>
                    <option value="future">Future</option>
                    <option value="underlying">Spot</option>
                  </select>
                </div>
              </td>
              <td className="py-2.5">
                {leg.type === 'underlying' || leg.type === 'future' ? (
                  <span className="text-[#e6edf3] font-mono px-2 py-1 bg-[#161b22] rounded border border-[#30363d] text-xs">
                    {leg.type === 'future' ? 'FUT' : 'SPOT'}
                  </span>
                ) : (
                  <input 
                    type="number" 
                    value={leg.strike} 
                    onChange={e => onUpdateLeg(leg.id, { strike: Number(e.target.value) })}
                    className="w-20 bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-[#e6edf3] font-mono focus:border-[#58a6ff] focus:outline-none"
                  />
                )}
              </td>
              <td className="py-2.5">
                {leg.type === 'underlying' ? (
                  <span className="text-[#8b949e]">-</span>
                ) : (
                  <input 
                    type="number" 
                    value={Math.round(leg.T * 365)} 
                    onChange={e => onUpdateLeg(leg.id, { T: Number(e.target.value) / 365 })}
                    className="w-16 bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-[#e6edf3] font-mono focus:border-[#58a6ff] focus:outline-none"
                  />
                )}
              </td>
              <td className="py-2.5">
                <input 
                  type="number" 
                  min="1" max="100"
                  value={leg.qty} 
                  onChange={e => onUpdateLeg(leg.id, { qty: Number(e.target.value) })}
                  className="w-16 bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-[#e6edf3] font-mono focus:border-[#58a6ff] focus:outline-none"
                />
              </td>
              <td className="py-2.5">
                <div className="flex items-center gap-1">
                  <span className="text-[#8b949e]">₹</span>
                  <input 
                    type="number" 
                    step="0.05"
                    value={leg.premium} 
                    onChange={e => onUpdateLeg(leg.id, { premium: Number(e.target.value) })}
                    className="w-24 bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-[#e3b341] font-mono focus:border-[#e3b341] focus:outline-none"
                  />
                </div>
              </td>
              <td className="py-2.5">
                <span className="text-[#58a6ff] font-mono font-semibold">
                  {leg.type === 'call' 
                    ? (leg.strike + leg.premium).toFixed(2) 
                    : leg.type === 'put' 
                      ? (leg.strike - leg.premium).toFixed(2) 
                      : leg.premium.toFixed(2)}
                </span>
              </td>
              <td className="py-2.5 text-right">
                <button 
                  onClick={() => onRemoveLeg(leg.id)}
                  className="p-1.5 text-[#8b949e] hover:text-[#f85149] hover:bg-[#f85149]/10 rounded transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
          {legs.length === 0 && (
            <tr>
              <td colSpan="6" className="py-4 text-center text-xs text-[#8b949e]">
                No strategy selected.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="mt-3">
        <button 
          onClick={onAddLeg}
          className="flex items-center gap-1 text-xs text-[#58a6ff] hover:text-[#79c0ff] bg-[#58a6ff]/10 hover:bg-[#58a6ff]/20 px-3 py-1.5 rounded-lg transition-colors font-semibold"
        >
          <Plus size={14} />
          Add Leg
        </button>
      </div>
    </div>
  );
}
