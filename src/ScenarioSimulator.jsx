import React, { useState, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceDot,
} from 'recharts';
import { TrendingUp, Clock, Layers } from 'lucide-react';
import { premiumAt, generateThetaDecayCurve } from './bsm.js';

function fmt(v) { return '₹' + v.toFixed(2); }
function sign(v) { return v >= 0 ? '+' : ''; }

// ── Sub-card A — Price Scenario ──
function PriceScenario({ S, K, T, r, sigma, optionType, currentPremium, q }) {
  const [scenarioPrice, setScenarioPrice] = useState(S);

  // Sync when parent recalculates
  React.useEffect(() => { setScenarioPrice(S); }, [S]);

  const result = useMemo(() => {
    const newPrem = premiumAt(scenarioPrice, K, T, r, sigma, optionType, q);
    const change = newPrem - currentPremium;
    const pnl = change; // P&L if bought at currentPremium
    return { newPrem, change, pnl };
  }, [scenarioPrice, K, T, r, sigma, optionType, currentPremium, q]);

  const adjust = (delta) => setScenarioPrice((p) => Math.max(0, p + delta));

  return (
    <div className="card p-4 flex-1 min-w-[260px]">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp size={16} className="text-[#58a6ff]" />
        <h3 className="text-sm font-semibold text-[#e6edf3]">Price Scenario</h3>
      </div>
      <p className="text-xs text-[#8b949e] mb-3">If the index opens at…</p>

      <input
        type="number"
        value={scenarioPrice}
        onChange={(e) => setScenarioPrice(Number(e.target.value))}
        className="text-center text-xl font-bold mb-2"
      />

      <div className="flex gap-1.5 mb-4 flex-wrap">
        {[-100, -50, +50, +100].map((d) => (
          <button
            key={d}
            onClick={() => adjust(d)}
            className="flex-1 text-xs py-1 rounded-md border border-[#30363d] hover:border-[#58a6ff] text-[#8b949e] hover:text-[#58a6ff] transition-colors cursor-pointer"
          >
            {d > 0 ? '+' : ''}{d}
          </button>
        ))}
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-[#8b949e]">New Premium</span>
          <span className="font-mono text-[#e6edf3]">{fmt(result.newPrem)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#8b949e]">Change</span>
          <span className={`font-mono ${result.change >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]'}`}>
            {sign(result.change)}{fmt(result.change).replace('₹-', '-₹')}
          </span>
        </div>
        <div className="flex justify-between border-t border-[#30363d] pt-2">
          <span className="text-[#8b949e]">P&L (if bought)</span>
          <span className={`font-mono font-bold ${result.pnl >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]'}`}>
            {sign(result.pnl)}{fmt(result.pnl).replace('₹-', '-₹')}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Sub-card B — Theta Decay Chart ──
function ThetaDecay({ S, K, calendarDays, r, sigma, optionType, currentPremium, q }) {
  const curveData = useMemo(
    () => generateThetaDecayCurve(S, K, calendarDays, r, sigma, optionType, q),
    [S, K, calendarDays, r, sigma, optionType, q]
  );

  // Key timeframes for table
  const timeframes = useMemo(() => {
    const frames = [
      { label: 'Today EOD', daysForward: 0.5 },
      { label: 'Tomorrow', daysForward: 1 },
      { label: '3 Days', daysForward: 3 },
      { label: '1 Week', daysForward: 7 },
      { label: '2 Weeks', daysForward: 14 },
    ];
    return frames
      .filter((f) => calendarDays - f.daysForward > 0)
      .map((f) => {
        const remainingT = Math.max((calendarDays - f.daysForward) / 365, 0);
        const prem = premiumAt(S, K, remainingT, r, sigma, optionType, q);
        const loss = prem - currentPremium;
        return { ...f, premium: prem, loss };
      });
  }, [S, K, calendarDays, r, sigma, optionType, currentPremium, q]);

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-xs">
        <p className="text-[#8b949e]">Days remaining: {payload[0].payload.daysRemaining}</p>
        <p className="text-[#e3b341] font-mono">{fmt(payload[0].value)}</p>
      </div>
    );
  };

  return (
    <div className="card p-4 flex-1 min-w-[320px]">
      <div className="flex items-center gap-2 mb-3">
        <Clock size={16} className="text-[#e3b341]" />
        <h3 className="text-sm font-semibold text-[#e6edf3]">Theta Decay Over Time</h3>
      </div>

      <div className="h-[180px] -ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={curveData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="thetaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#e3b341" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#e3b341" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
            <XAxis
              dataKey="daysRemaining"
              reversed
              tick={{ fill: '#8b949e', fontSize: 11 }}
              label={{ value: 'Days Remaining', position: 'insideBottom', offset: -2, fill: '#8b949e', fontSize: 10 }}
            />
            <YAxis tick={{ fill: '#8b949e', fontSize: 11 }} tickFormatter={(v) => '₹' + v.toFixed(0)} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="premium" stroke="#e3b341" strokeWidth={2} fill="url(#thetaGrad)" />
            <ReferenceLine x={calendarDays} stroke="#58a6ff" strokeDasharray="4 4" strokeWidth={1} />
            <ReferenceDot x={calendarDays} y={currentPremium} r={5} fill="#58a6ff" stroke="#0d1117" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Decay table */}
      {timeframes.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[#8b949e] border-b border-[#30363d]">
                <th className="text-left py-1.5 font-medium">Timeframe</th>
                <th className="text-right py-1.5 font-medium">Est. Premium</th>
                <th className="text-right py-1.5 font-medium">Loss from Now</th>
              </tr>
            </thead>
            <tbody>
              {timeframes.map((tf) => (
                <tr key={tf.label} className="border-b border-[#30363d]/30">
                  <td className="py-1.5 text-[#e6edf3]">{tf.label}</td>
                  <td className="py-1.5 text-right font-mono text-[#e6edf3]">{fmt(tf.premium)}</td>
                  <td className={`py-1.5 text-right font-mono ${tf.loss >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]'}`}>
                    {sign(tf.loss)}{fmt(tf.loss).replace('₹-', '-₹')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Sub-card C — Combined Scenario ──
function CombinedScenario({ S, K, calendarDays, r, sigma, optionType, currentPremium, q }) {
  const [comboPrice, setComboPrice] = useState(S);
  const [comboDays, setComboDays] = useState(1);

  React.useEffect(() => { setComboPrice(S); }, [S]);

  const result = useMemo(() => {
    const newCalendarDays = Math.max(calendarDays - comboDays, 0);
    const newT = newCalendarDays / 365;
    const newPrem = premiumAt(comboPrice, K, newT, r, sigma, optionType, q);
    const totalPnl = newPrem - currentPremium;

    // Decompose: price effect (hold time constant) + time effect (hold price constant)
    const priceOnly = premiumAt(comboPrice, K, calendarDays / 365, r, sigma, optionType, q) - currentPremium;
    const timeOnly = premiumAt(S, K, newT, r, sigma, optionType, q) - currentPremium;

    return { newPrem, totalPnl, priceOnly, timeOnly };
  }, [comboPrice, comboDays, S, K, calendarDays, r, sigma, optionType, currentPremium, q]);

  return (
    <div className="card p-4 flex-1 min-w-[260px]">
      <div className="flex items-center gap-2 mb-3">
        <Layers size={16} className="text-[#a371f7]" />
        <h3 className="text-sm font-semibold text-[#e6edf3]">Price + Time Combined</h3>
      </div>

      <div className="space-y-3 mb-4">
        <div>
          <label className="text-xs text-[#8b949e] block mb-1">Scenario Price (₹)</label>
          <input
            type="number"
            value={comboPrice}
            onChange={(e) => setComboPrice(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="text-xs text-[#8b949e] block mb-1">Days Forward (trading)</label>
          <input
            type="number"
            value={comboDays}
            min={0}
            max={calendarDays}
            onChange={(e) => setComboDays(Math.max(0, Math.min(calendarDays, Number(e.target.value))))}
          />
        </div>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-[#8b949e]">New Premium</span>
          <span className="font-mono text-[#e6edf3]">{fmt(result.newPrem)}</span>
        </div>
        <div className="flex justify-between border-t border-[#30363d] pt-2">
          <span className="text-[#8b949e]">Total P&L</span>
          <span className={`font-mono font-bold ${result.totalPnl >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]'}`}>
            {sign(result.totalPnl)}{fmt(result.totalPnl).replace('₹-', '-₹')}
          </span>
        </div>
      </div>

      <div className="mt-3 p-2.5 rounded-lg bg-[#0d1117] border border-[#30363d]">
        <p className="text-xs text-[#8b949e]">
          <span className={result.priceOnly >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]'}>
            Price effect: {sign(result.priceOnly)}₹{Math.abs(result.priceOnly).toFixed(2)}
          </span>
          <span className="mx-1.5 text-[#30363d]">|</span>
          <span className={result.timeOnly >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]'}>
            Time decay: {sign(result.timeOnly)}₹{Math.abs(result.timeOnly).toFixed(2)}
          </span>
          <span className="mx-1.5 text-[#30363d]">|</span>
          <span className="text-[#8b949e]">IV effect: ₹0 (held constant)</span>
        </p>
      </div>
    </div>
  );
}

// ── Main Scenario Simulator ──
export default function ScenarioSimulator({ S, K, calendarDays, r, sigma, optionType, currentPremium, q }) {
  if (!currentPremium || calendarDays <= 0) return null;
  const T = calendarDays / 365;

  return (
    <div className="card p-5">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-[#e6edf3]">What-If Scenario Simulator</h2>
        <p className="text-xs text-[#8b949e] mt-0.5">
          See how your option behaves under different market conditions
        </p>
      </div>
      <div className="flex flex-wrap gap-4">
        <PriceScenario S={S} K={K} T={T} r={r} sigma={sigma} optionType={optionType} currentPremium={currentPremium} q={q} />
        <ThetaDecay S={S} K={K} calendarDays={calendarDays} r={r} sigma={sigma} optionType={optionType} currentPremium={currentPremium} q={q} />
        <CombinedScenario S={S} K={K} calendarDays={calendarDays} r={r} sigma={sigma} optionType={optionType} currentPremium={currentPremium} q={q} />
      </div>
    </div>
  );
}
