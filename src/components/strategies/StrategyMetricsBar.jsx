import React, { useMemo } from 'react';
import { 
  findMaxProfitLoss, findBreakevens, probabilityOfProfit, calculateBSM
} from '../../bsm.js';

function fmt(v) { 
  if (v === Infinity || v === -Infinity) return 'Unlimited';
  return '₹' + Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 0 }); 
}

function MetricBox({ label, value, isPositive, subtext, infiniteStyle }) {
  const color = infiniteStyle 
    ? 'text-[#58a6ff] border-[#58a6ff]' 
    : (isPositive === true ? 'text-[#3fb950] border-[#3fb950]' : (isPositive === false ? 'text-[#f85149] border-[#f85149]' : 'text-[#e6edf3] border-[#30363d]'));
  const bgColor = infiniteStyle 
    ? 'bg-[#58a6ff]/10' 
    : (isPositive === true ? 'bg-[#3fb950]/10' : (isPositive === false ? 'bg-[#f85149]/10' : 'bg-[#161b22]'));
    
  return (
    <div className={`p-3 rounded-xl border-t-2 ${color} ${bgColor} flex-1 min-w-[120px]`}>
      <div className="text-[10px] text-[#8b949e] uppercase tracking-wider mb-1">{label}</div>
      <div className="font-mono text-lg font-bold">{value}</div>
      {subtext && <div className="text-[9px] text-[#8b949e] mt-0.5">{subtext}</div>}
    </div>
  );
}

export default function StrategyMetricsBar({ legs, globalInputs, marginRequired }) {
  const metrics = useMemo(() => {
    if (!legs || legs.length === 0) return null;
    
    // Net Premium
    const netPremium = legs.reduce((total, leg) => {
      if (leg.type === 'future' || leg.type === 'underlying' || leg.type === 'equity') return total;
      const sign = leg.action === 'buy' ? -1 : 1;
      return total + sign * leg.premium * leg.qty * (leg.lotSize || 25);
    }, 0);
    
    // Greeks
    let netDelta = 0, netTheta = 0, netVega = 0;
    legs.forEach(leg => {
      const sign = leg.action === 'buy' ? 1 : -1;
      if (leg.type === 'underlying' || leg.type === 'equity') {
        // Equity: Delta = 1 per share (lotSize is always 1 for equity)
        netDelta += sign * leg.qty * (leg.lotSize || 1);
      } else if (leg.type === 'future') {
        // Futures: Delta ≈ 1 per lot
        netDelta += sign * leg.qty * (leg.lotSize || 25);
      } else {
        // Options: Use BSM greeks
        const bsm = calculateBSM(
          globalInputs.spot, leg.strike, leg.T, globalInputs.rate, 
          leg.iv || globalInputs.iv, leg.type.toUpperCase(), globalInputs.dividend
        );
        if (bsm) {
          netDelta += sign * bsm.delta * leg.qty * (leg.lotSize || 25);
          netTheta += sign * bsm.theta * leg.qty * (leg.lotSize || 25);
          netVega += sign * bsm.vega * leg.qty * (leg.lotSize || 25);
        }
      }
    });

    // P&L and Probabilities
    const { maxProfit, maxLoss } = findMaxProfitLoss(legs, Math.max(0, globalInputs.spot * 0.2), globalInputs.spot * 3);
    const breakevens = findBreakevens(legs, Math.max(0, globalInputs.spot * 0.2), globalInputs.spot * 3);
    
    const { pop } = probabilityOfProfit(
      legs, globalInputs.spot, Math.max(...legs.map(l => l.T)), 
      globalInputs.rate, globalInputs.dividend, globalInputs.iv
    );
    
    // Calculate range width
    let rangeWidth = null;
    let rangeText = 'None';
    if (breakevens.length > 0) {
      if (breakevens.length === 2) {
        rangeWidth = Math.abs(breakevens[1] - breakevens[0]);
        rangeText = `${Math.min(...breakevens).toFixed(0)} - ${Math.max(...breakevens).toFixed(0)} (${rangeWidth.toFixed(0)} pts)`;
      } else {
        rangeText = breakevens.map(b => Math.round(b)).join(' & ');
      }
    }

    return { netPremium, netDelta, netTheta, netVega, maxProfit, maxLoss, breakevens, pop, rangeText };
  }, [legs, globalInputs]);

  if (!metrics) return null;

  return (
    <div className="flex flex-wrap gap-4">
      <MetricBox 
        label="Net Premium" 
        value={(metrics.netPremium >= 0 ? '+' : '-') + fmt(metrics.netPremium)} 
        isPositive={metrics.netPremium >= 0}
        subtext={metrics.netPremium >= 0 ? 'Credit received' : 'Debit paid'}
      />
      <MetricBox 
        label="Max Profit" 
        value={metrics.maxProfit === Infinity ? 'Unlimited' : fmt(metrics.maxProfit)} 
        isPositive={metrics.maxProfit > 0 ? true : null}
        infiniteStyle={metrics.maxProfit === Infinity}
      />
      <MetricBox 
        label="Max Loss" 
        value={metrics.maxLoss === -Infinity ? 'Unlimited' : fmt(metrics.maxLoss)} 
        isPositive={metrics.maxLoss < 0 ? false : null}
        infiniteStyle={metrics.maxLoss === -Infinity}
      />
      <MetricBox 
        label="Prob. of Profit" 
        value={`${(metrics.pop * 100).toFixed(1)}%`} 
        isPositive={metrics.pop > 0.5}
      />
      <MetricBox 
        label="Range Level" 
        value={metrics.rangeText} 
      />
      {marginRequired !== undefined && (
        <MetricBox 
          label="Risk Cover (Margin)" 
          value={fmt(marginRequired)} 
          isPositive={false}
        />
      )}
      <MetricBox 
        label="Net Delta" 
        value={metrics.netDelta.toFixed(2)} 
        isPositive={metrics.netDelta > 0}
      />
      <MetricBox 
        label="Net Theta (₹/d)" 
        value={metrics.netTheta.toFixed(2)} 
        isPositive={metrics.netTheta > 0}
      />
      <MetricBox 
        label="Net Vega" 
        value={metrics.netVega.toFixed(2)} 
        isPositive={metrics.netVega > 0}
      />
    </div>
  );
}
