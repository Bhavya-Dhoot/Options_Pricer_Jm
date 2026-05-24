import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceDot, Legend,
} from 'recharts';
import {
  Clock, TrendingDown, BarChart3, Grid3x3, Zap,
  Radio, Loader2, AlertTriangle, DollarSign, ArrowUpDown,
  Activity, Timer, Layers,
} from 'lucide-react';
import {
  calculateBSM,
  premiumAt,
  generateThetaDecayCurve,
  countTradingDays,
  getDefaultExpiry,
  solveImpliedIV,
} from './bsm.js';
import { useLiveData, useAvailableExpiries, findATMStrike, nseToISODate } from './useLiveData.js';
import LiveFetchBar from './components/LiveFetchBar.jsx';
import BsmWorker from './bsm.worker.js?worker';

function fmt(v) { return '₹' + v.toFixed(2); }
function sign(v) { return v >= 0 ? '+' : ''; }
function pct(v) { return (v * 100).toFixed(1) + '%'; }

//  Default values (mirrors OptionsPricer) 
const DEFAULTS = {
  spotPrice: 24500,
  strikePrice: 24500,
  optionType: 'CALL',
  iv: 14,
  riskFreeRate: 6.5,
  dividendYield: 1.2,
};

//  Summary Metric Card 
function MetricCard({ icon: Icon, iconColor, label, value, subtext }) {
  return (
    <div className="card p-3.5 flex-1 min-w-[140px]">
      <div className="flex items-center gap-2 mb-1.5">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: iconColor + '18', color: iconColor }}
        >
          <Icon size={14} />
        </div>
        <span className="text-[10px] text-[#8b949e] uppercase tracking-wider font-medium">{label}</span>
      </div>
      <p className="font-mono text-lg font-bold text-[#e6edf3]">{value}</p>
      {subtext && <p className="text-[10px] text-[#8b949e] mt-0.5">{subtext}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// FEATURE 0  -  What-If Scenario Simulator (3-panel)
// ═══════════════════════════════════════════════════════════
function WhatIfScenarioSection({ S, K, calendarDays, r, sigma, optionType, q, marketPremium, bsmPremium }) {
  const [scenarioPrice, setScenarioPrice] = useState(S);
  const [comboPrice, setComboPrice] = useState(S);
  const [comboDays, setComboDays] = useState(1);
  const [comboDaysRaw, setComboDaysRaw] = useState('1'); // raw text for natural typing

  const costBasis = marketPremium > 0 ? marketPremium : bsmPremium;
  const hasMarket = marketPremium > 0;

  // Keep scenario prices in sync when spot changes
  React.useEffect(() => { setScenarioPrice(S); setComboPrice(S); }, [S]);

  // Helper: format negative ₹ values as -₹X.XX instead of ₹-X.XX
  const fmtPnl = (v) => fmt(v).replace('₹-', '-₹');
  const pnlColor = (v) => v >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]';

  // Days forward handlers  -  allow free typing, clamp only on blur
  const handleDaysChange = (e) => {
    const raw = e.target.value;
    setComboDaysRaw(raw);
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= 1 && n < calendarDays) {
      setComboDays(n);
    }
  };
  const handleDaysBlur = () => {
    const n = parseInt(comboDaysRaw, 10);
    const clamped = isNaN(n) ? 1 : Math.max(1, Math.min(calendarDays - 1, n));
    setComboDays(clamped);
    setComboDaysRaw(String(clamped));
  };

  //  Panel 1: Price Scenario (spot change only, same DTE) 
  const priceScenario = useMemo(() => {
    const T = calendarDays / 365;
    const newPrem = premiumAt(scenarioPrice, K, T, r, sigma, optionType, q);
    const change = newPrem - bsmPremium;
    const pnl = newPrem - costBasis;
    return { newPremium: newPrem, change, pnl };
  }, [scenarioPrice, K, calendarDays, r, sigma, optionType, q, bsmPremium, costBasis]);

  const quickAdjust = (delta) => setScenarioPrice(prev => Math.max(0, prev + delta));

  //  Panel 2: Theta Decay Over Time (spot constant, time forward) 
  const timeframes = useMemo(() => {
    const labels = [
      { label: 'Today EOD', days: 1 },
      { label: 'Tomorrow', days: 2 },
      { label: '3 Days', days: 3 },
      { label: '1 Week', days: 7 },
      { label: '2 Weeks', days: 14 },
    ];
    return labels
      .filter(tf => tf.days < calendarDays)
      .map(tf => {
        const remaining = calendarDays - tf.days;
        const T = remaining / 365;
        const prem = premiumAt(S, K, T, r, sigma, optionType, q);
        const loss = prem - costBasis;
        return { ...tf, premium: prem, loss };
      });
  }, [S, K, calendarDays, r, sigma, optionType, q, costBasis]);

  // Solve market-implied IV for the purple decay curve
  const [impliedIV, setImpliedIV] = useState(null);
  
  useEffect(() => {
    if (!hasMarket || calendarDays <= 0) {
      setImpliedIV(null);
      return;
    }
    const T = calendarDays / 365;
    solveImpliedIV(S, K, T, r, marketPremium, optionType, q).then(setImpliedIV);
  }, [S, K, calendarDays, r, marketPremium, optionType, q, hasMarket]);

  // Mini decay chart  -  dual curves (BSM yellow + market-implied purple)
  const miniChartData = useMemo(() => {
    const points = [];
    const maxDays = Math.min(calendarDays, 21);
    for (let d = 0; d <= maxDays; d++) {
      const T = d / 365;
      const point = {
        daysRemaining: d,
        bsmPremium: premiumAt(S, K, T, r, sigma, optionType, q),
      };
      if (impliedIV) {
        point.marketPremium = premiumAt(S, K, T, r, impliedIV, optionType, q);
      }
      points.push(point);
    }
    return points;
  }, [S, K, calendarDays, r, sigma, optionType, q, impliedIV]);

  //  Panel 3: Price + Time Combined 
  const combo = useMemo(() => {
    const remaining = Math.max(calendarDays - comboDays, 0);
    const T = remaining / 365;
    const newPrem = premiumAt(comboPrice, K, T, r, sigma, optionType, q);
    const totalPnl = newPrem - costBasis;

    // Decompose P&L
    const T0 = calendarDays / 365;
    const priceEffect = premiumAt(comboPrice, K, T0, r, sigma, optionType, q) - bsmPremium;
    const timeEffect = premiumAt(S, K, T, r, sigma, optionType, q) - bsmPremium;

    return { newPremium: newPrem, totalPnl, priceEffect, timeEffect };
  }, [comboPrice, comboDays, K, calendarDays, r, sigma, optionType, q, S, bsmPremium, costBasis]);

  const maxDaysChart = Math.min(calendarDays, 21);

  return (
    <div className="card p-5 mb-5">
      <div className="flex items-center gap-2 mb-1">
        <Activity size={18} className="text-[#58a6ff]" />
        <h2 className="text-lg font-semibold text-[#e6edf3]">What-If Scenario Simulator</h2>
      </div>
      <p className="text-xs text-[#8b949e] mb-4">
        See how your option behaves under different market conditions
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/*  Panel 1: Price Scenario  */}
        <div className="bg-[#0d1117] rounded-xl border border-[#30363d] p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <TrendingDown size={14} className="text-[#58a6ff]" />
            <span className="text-sm font-semibold text-[#e6edf3]">Price Scenario</span>
          </div>
          <p className="text-[10px] text-[#8b949e] mb-2">If the index opens at..</p>

          <input
            type="number"
            value={scenarioPrice}
            onChange={(e) => setScenarioPrice(Number(e.target.value))}
            className="text-center text-lg font-bold mb-2"
          />

          <div className="flex gap-1.5 mb-3">
            {[-100, -50, 50, 100].map(d => (
              <button
                key={d}
                onClick={() => quickAdjust(d)}
                className="flex-1 py-1.5 text-[10px] font-mono font-semibold rounded-md border border-[#30363d] bg-[#161b22] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#58a6ff40] transition-colors cursor-pointer"
              >
                {d > 0 ? '+' : ''}{d}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-[#8b949e]">New Premium</span>
              <span className="font-mono font-bold text-[#e6edf3]">{fmt(priceScenario.newPremium)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#8b949e]">Change</span>
              <span className={`font-mono font-semibold ${pnlColor(priceScenario.change)}`}>
                {sign(priceScenario.change)}{fmtPnl(priceScenario.change)}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#8b949e]">P&L (if bought)</span>
              <span className={`font-mono font-semibold ${pnlColor(priceScenario.pnl)}`}>
                {sign(priceScenario.pnl)}{fmtPnl(priceScenario.pnl)}
              </span>
            </div>
          </div>
        </div>

        {/*  Panel 2: Theta Decay Over Time  */}
        <div className="bg-[#0d1117] rounded-xl border border-[#30363d] p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <Timer size={14} className="text-[#e3b341]" />
            <span className="text-sm font-semibold text-[#e6edf3]">Theta Decay Over Time</span>
          </div>

          {/* Mini chart  -  dual curves */}
          <div className="h-[130px] -ml-2 mb-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={miniChartData} margin={{ top: 2, right: 8, left: 0, bottom: 12 }}>
                <defs>
                  <linearGradient id="miniGradBsm" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#e3b341" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#e3b341" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="miniGradMkt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a371f7" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#a371f7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="daysRemaining"
                  reversed
                  tick={{ fill: '#6e7681', fontSize: 8 }}
                  axisLine={false}
                  tickLine={false}
                  label={{ value: 'Days Remaining', fill: '#6e7681', fontSize: 7, position: 'insideBottom', offset: -4 }}
                />
                <YAxis
                  tick={{ fill: '#6e7681', fontSize: 8 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => '₹' + v.toFixed(0)}
                  width={38}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-[#161b22] border border-[#30363d] rounded-lg px-2.5 py-1.5 text-[10px] shadow-lg">
                        <p className="text-[#8b949e] mb-0.5">{d.daysRemaining} days remaining</p>
                        <p className="text-[#e3b341] font-mono font-bold">BSM: {fmt(d.bsmPremium)}</p>
                        {d.marketPremium != null && (
                          <p className="text-[#a371f7] font-mono font-bold">Market: {fmt(d.marketPremium)}</p>
                        )}
                      </div>
                    );
                  }}
                />
                <ReferenceDot
                  x={maxDaysChart}
                  y={miniChartData[miniChartData.length - 1]?.bsmPremium || 0}
                  r={4}
                  fill="#58a6ff"
                  stroke="#0d1117"
                  strokeWidth={2}
                />
                {/* BSM decay curve (yellow) */}
                <Area
                  type="monotone"
                  dataKey="bsmPremium"
                  stroke="#e3b341"
                  strokeWidth={2}
                  fill="url(#miniGradBsm)"
                  dot={false}
                  activeDot={{ r: 3, fill: '#e3b341', stroke: '#0d1117', strokeWidth: 1 }}
                  name="BSM"
                />
                {/* Market-implied decay curve (purple) */}
                {impliedIV && (
                  <Area
                    type="monotone"
                    dataKey="marketPremium"
                    stroke="#a371f7"
                    strokeWidth={2}
                    strokeDasharray="4 2"
                    fill="url(#miniGradMkt)"
                    dot={false}
                    activeDot={{ r: 3, fill: '#a371f7', stroke: '#0d1117', strokeWidth: 1 }}
                    name="Market"
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex gap-3 text-[9px] text-[#8b949e] mb-2">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5 bg-[#e3b341] rounded" /> BSM ({(sigma * 100).toFixed(1)}%)
            </span>
            {impliedIV && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-0.5 bg-[#a371f7] rounded" /> Market ({(impliedIV * 100).toFixed(1)}%)
              </span>
            )}
          </div>

          {/* Timeframe table */}
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-[#6e7681] border-b border-[#30363d]/50">
                <th className="text-left py-1 font-medium">Timeframe</th>
                <th className="text-right py-1 font-medium">Est. Premium</th>
                <th className="text-right py-1 font-medium">Loss from Now</th>
              </tr>
            </thead>
            <tbody>
              {timeframes.map(tf => (
                <tr key={tf.label} className="border-b border-[#30363d]/20">
                  <td className="py-1 text-[#e6edf3] font-medium">{tf.label}</td>
                  <td className="py-1 text-right font-mono text-[#8b949e]">{fmt(tf.premium)}</td>
                  <td className={`py-1 text-right font-mono font-semibold ${pnlColor(tf.loss)}`}>
                    {fmtPnl(tf.loss)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/*  Panel 3: Price + Time Combined  */}
        <div className="bg-[#0d1117] rounded-xl border border-[#30363d] p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <Layers size={14} className="text-[#39d0d8]" />
            <span className="text-sm font-semibold text-[#e6edf3]">Price + Time Combined</span>
          </div>

          <div className="space-y-2.5 mb-3">
            <div>
              <label className="text-[10px] text-[#8b949e] block mb-0.5">Scenario Price (₹)</label>
              <input
                type="number"
                value={comboPrice}
                onChange={(e) => setComboPrice(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="text-[10px] text-[#8b949e] block mb-0.5">Days Forward (trading)</label>
              <input
                type="number"
                value={comboDaysRaw}
                step={1}
                min={1}
                max={calendarDays - 1}
                onChange={handleDaysChange}
                onBlur={handleDaysBlur}
              />
              <span className="text-[9px] text-[#6e7681] mt-0.5 block">
                Range: 1 - {Math.max(calendarDays - 1, 1)} days
              </span>
            </div>
          </div>

          <div className="space-y-1.5 mb-3">
            <div className="flex justify-between text-xs">
              <span className="text-[#8b949e]">New Premium</span>
              <span className="font-mono font-bold text-[#e6edf3]">{fmt(combo.newPremium)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[#8b949e]">Total P&L</span>
              <span className={`font-mono font-bold ${pnlColor(combo.totalPnl)}`}>
                {fmtPnl(combo.totalPnl)}
              </span>
            </div>
          </div>

          {/* P&L Decomposition */}
          <div className="rounded-lg bg-[#161b22] border border-[#30363d]/50 p-2.5">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
              <span className={`font-mono ${pnlColor(combo.priceEffect)}`}>
                Price effect: {sign(combo.priceEffect)}{fmtPnl(combo.priceEffect)}
              </span>
              <span className={`font-mono ${pnlColor(combo.timeEffect)}`}>
                Time decay: {fmtPnl(combo.timeEffect)}
              </span>
              <span className="font-mono text-[#8b949e]">
                IV effect: ₹0 (held constant)
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}



// ═══════════════════════════════════════════════════════════
// FEATURE 1  -  Interactive Decay Curve (Dual: BSM + Market)
// ═══════════════════════════════════════════════════════════
function DecayCurveSection({ S, K, calendarDays, r, sigma, optionType, q, marketPremium }) {
  const [hoverDay, setHoverDay] = useState(null);

  const hasMarket = marketPremium > 0;

  // Solve for the market-implied IV
  const [impliedIV, setImpliedIV] = useState(null);
  
  useEffect(() => {
    if (!hasMarket || calendarDays <= 0) {
      setImpliedIV(null);
      return;
    }
    const T = calendarDays / 365;
    solveImpliedIV(S, K, T, r, marketPremium, optionType, q).then(setImpliedIV);
  }, [S, K, calendarDays, r, marketPremium, optionType, q, hasMarket]);

  const workerRef = useRef(null);
  const [bsmCurve, setBsmCurve] = useState([]);
  const [marketCurve, setMarketCurve] = useState(null);

  useEffect(() => {
    workerRef.current = new BsmWorker();
    workerRef.current.onmessage = (e) => {
      const { id, result, error } = e.data;
      if (error) {
        console.error("BSM Worker Error:", error);
        return;
      }
      if (id === 'bsm') setBsmCurve(result);
      if (id === 'market') setMarketCurve(result);
    };
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  // Generate BSM decay curve (yellow - using user's input IV)
  useEffect(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({
        id: 'bsm',
        type: 'GENERATE_CURVE',
        params: { S, K, calendarDays, r, sigma, optionType, q }
      });
    }
  }, [S, K, calendarDays, r, sigma, optionType, q]);

  // Generate market-implied decay curve (purple - using solved IV)
  useEffect(() => {
    if (workerRef.current && impliedIV) {
      workerRef.current.postMessage({
        id: 'market',
        type: 'GENERATE_CURVE',
        params: { S, K, calendarDays, r, sigma: impliedIV, optionType, q }
      });
    } else {
      setMarketCurve(null);
    }
  }, [S, K, calendarDays, r, impliedIV, optionType, q]);

  // Merge both curves into one dataset for the chart
  const curveData = useMemo(() => {
    return bsmCurve.map((point, i) => ({
      daysRemaining: point.daysRemaining,
      bsmPremium: point.premium,
      marketPremium: marketCurve ? marketCurve[i]?.premium ?? null : null,
    }));
  }, [bsmCurve, marketCurve]);

  const intrinsicValue = optionType === 'CALL' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  const currentBSM = bsmCurve.find(p => p.daysRemaining === calendarDays)?.premium || 0;

  // Hover data for both curves
  const hoverData = useMemo(() => {
    if (hoverDay === null) return null;
    const T = hoverDay / 365;
    const bsmPrem = premiumAt(S, K, T, r, sigma, optionType, q);
    const bsm = T > 0 ? calculateBSM(S, K, T, r, sigma, optionType, q) : null;
    const mktPrem = impliedIV && T > 0 ? premiumAt(S, K, T, r, impliedIV, optionType, q) : null;
    return {
      bsmPremium: bsmPrem,
      marketPremium: mktPrem,
      theta: bsm?.theta || 0,
      delta: bsm?.delta || 0,
    };
  }, [hoverDay, S, K, r, sigma, optionType, q, impliedIV]);

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-xs shadow-lg">
        <p className="text-[#8b949e] mb-1">{d.daysRemaining} days remaining</p>
        <p className="text-[#e3b341] font-mono font-bold">
          BSM (IV {(sigma * 100).toFixed(1)}%): {fmt(d.bsmPremium)}
        </p>
        {d.marketPremium !== null && (
          <p className="text-[#a371f7] font-mono font-bold">
            Market (IV {impliedIV ? (impliedIV * 100).toFixed(1) : '?'}%): {fmt(d.marketPremium)}
          </p>
        )}
        {d.marketPremium !== null && (
          <p className="text-[#8b949e] mt-1">
            Gap: {fmt(d.marketPremium - d.bsmPremium).replace('₹-', '-₹')}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <TrendingDown size={18} className="text-[#e3b341]" />
          <h2 className="text-lg font-semibold text-[#e6edf3]">Premium Decay Curve</h2>
        </div>
        <div className="flex items-center gap-3">
          {impliedIV && (
            <span className="text-xs text-[#a371f7] font-mono">
              Market IV: {(impliedIV * 100).toFixed(1)}%
            </span>
          )}
          <span className="text-xs text-[#8b949e]">
            {calendarDays} calendar days to expiry
          </span>
        </div>
      </div>
      <p className="text-xs text-[#8b949e] mb-4">
        {hasMarket
          ? <>
              <span className="text-[#e3b341]">Yellow</span> = BSM theoretical (your IV {(sigma * 100).toFixed(1)}%)
              {' · '}
              <span className="text-[#a371f7]">Purple</span> = market-implied decay (IV {impliedIV ? (impliedIV * 100).toFixed(1) : '?'}%)
            </>
          : 'How your option premium erodes as time passes  -  assuming spot and IV stay constant'
        }
      </p>

      <div className="h-[300px] -ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={curveData} margin={{ top: 5, right: 15, left: 5, bottom: 5 }}>
            <defs>
              <linearGradient id="thetaDecayGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#e3b341" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#e3b341" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="marketDecayGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#a371f7" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#a371f7" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
            <XAxis
              dataKey="daysRemaining"
              reversed
              tick={{ fill: '#8b949e', fontSize: 11 }}
              label={{ value: 'Days Remaining', position: 'insideBottom', offset: -2, fill: '#8b949e', fontSize: 10 }}
            />
            <YAxis
              tick={{ fill: '#8b949e', fontSize: 11 }}
              tickFormatter={(v) => '₹' + v.toFixed(0)}
            />
            <Tooltip content={<CustomTooltip />} />

            {/* BSM theoretical curve (yellow) */}
            <Area
              type="monotone"
              dataKey="bsmPremium"
              stroke="#e3b341"
              strokeWidth={2.5}
              fill="url(#thetaDecayGrad)"
              dot={false}
              activeDot={{ r: 5, fill: '#e3b341', stroke: '#0d1117', strokeWidth: 2 }}
              name={`BSM (IV ${(sigma * 100).toFixed(1)}%)`}
            />

            {/* Market-implied decay curve (purple) */}
            {hasMarket && (
              <Area
                type="monotone"
                dataKey="marketPremium"
                stroke="#a371f7"
                strokeWidth={2.5}
                fill="url(#marketDecayGrad)"
                dot={false}
                activeDot={{ r: 5, fill: '#a371f7', stroke: '#0d1117', strokeWidth: 2 }}
                name={`Market (IV ${impliedIV ? (impliedIV * 100).toFixed(1) : '?'}%)`}
              />
            )}

            {/* Intrinsic value floor */}
            {intrinsicValue > 0 && (
              <ReferenceLine
                y={intrinsicValue}
                stroke="#58a6ff"
                strokeDasharray="6 3"
                strokeWidth={1}
                label={{ value: `Intrinsic: ${fmt(intrinsicValue)}`, fill: '#58a6ff', fontSize: 10, position: 'insideTopRight' }}
              />
            )}

            {/* Today BSM marker */}
            <ReferenceDot
              x={calendarDays}
              y={currentBSM}
              r={6}
              fill="#e3b341"
              stroke="#0d1117"
              strokeWidth={2}
            />
            {/* Today Market marker */}
            {hasMarket && (
              <ReferenceDot
                x={calendarDays}
                y={marketPremium}
                r={6}
                fill="#a371f7"
                stroke="#0d1117"
                strokeWidth={2}
              />
            )}

            <Legend
              wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
              formatter={(value) => <span style={{ color: '#8b949e' }}>{value}</span>}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Slider scrubber */}
      <div className="mt-3 px-2">
        <label className="text-xs text-[#8b949e] block mb-1">
          Scrub time: {hoverDay !== null ? `${hoverDay} days remaining` : 'drag to explore'}
        </label>
        <input
          type="range"
          min={0}
          max={calendarDays}
          value={hoverDay ?? calendarDays}
          onChange={(e) => setHoverDay(Number(e.target.value))}
          className="w-full"
        />
        {hoverData && (
          <div className="flex flex-wrap gap-4 mt-2 text-xs">
            <span className="text-[#e3b341] font-mono">BSM: {fmt(hoverData.bsmPremium)}</span>
            {hoverData.marketPremium !== null && (
              <span className="text-[#a371f7] font-mono">Market: {fmt(hoverData.marketPremium)}</span>
            )}
            <span className="text-[#f85149] font-mono">Θ: {hoverData.theta.toFixed(2)}/day</span>
            <span className="text-[#58a6ff] font-mono">Δ: {hoverData.delta.toFixed(4)}</span>
            {hoverData.marketPremium !== null && (
              <span className={`font-mono ${hoverData.marketPremium >= marketPremium ? 'text-[#3fb950]' : 'text-[#f85149]'}`}>
                Real P&L: {fmt(hoverData.marketPremium - marketPremium).replace('₹-', '-₹')}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// FEATURE 2  -  Daily Theta Breakdown Table
// ═══════════════════════════════════════════════════════════
function DailyBreakdownSection({ S, K, calendarDays, r, sigma, optionType, q, marketPremium }) {
  const [showAll, setShowAll] = useState(false);

  const hasMarket = marketPremium > 0;

  const breakdown = useMemo(() => {
    const rows = [];
    const currentPremium = premiumAt(S, K, calendarDays / 365, r, sigma, optionType, q);
    let prevPremium = currentPremium;

    for (let d = 1; d <= calendarDays; d++) {
      const remaining = calendarDays - d;
      const T = remaining / 365;
      const prem = premiumAt(S, K, T, r, sigma, optionType, q);
      const bsm = T > 0 ? calculateBSM(S, K, T, r, sigma, optionType, q) : null;
      const dailyLoss = prem - prevPremium;
      const cumLoss = prem - currentPremium;
      const totalDecay = currentPremium - (optionType === 'CALL' ? Math.max(S - K, 0) : Math.max(K - S, 0));
      const pctOfDecay = totalDecay > 0 ? ((currentPremium - prem) / totalDecay) * 100 : 0;
      const realPnl = hasMarket ? prem - marketPremium : null;

      rows.push({
        day: d,
        remaining,
        premium: prem,
        dailyLoss,
        cumLoss,
        realPnl,
        theta: bsm?.theta || 0,
        pctOfDecay: Math.min(pctOfDecay, 100),
        zone: remaining <= 7 ? 'danger' : remaining <= 14 ? 'warning' : 'safe',
      });

      prevPremium = prem;
    }

    return rows;
  }, [S, K, calendarDays, r, sigma, optionType, q, marketPremium, hasMarket]);

  const displayRows = showAll ? breakdown : breakdown.filter(r =>
    r.day <= 7 || r.day === 14 || r.day === 21 || r.day === calendarDays || r.remaining <= 7 || r.remaining === 14
  );

  const zoneColor = (zone) =>
    zone === 'danger' ? '#f85149' : zone === 'warning' ? '#e3b341' : '#3fb950';

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <BarChart3 size={18} className="text-[#a371f7]" />
          <h2 className="text-lg font-semibold text-[#e6edf3]">Daily Theta Breakdown</h2>
        </div>
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-xs text-[#58a6ff] hover:text-[#79b8ff] transition-colors cursor-pointer"
        >
          {showAll ? 'Show key dates' : `Show all ${calendarDays} days`}
        </button>
      </div>
      <p className="text-xs text-[#8b949e] mb-3">
        Theta accelerates near expiry  -  the <span className="text-[#f85149]">last 7 days</span> are the most destructive
      </p>

      <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[#161b22] z-10">
            <tr className="text-[#8b949e] border-b border-[#30363d]">
              <th className="text-left py-2 px-2 font-medium">Day</th>
              <th className="text-right py-2 px-2 font-medium">Days Left</th>
              <th className="text-right py-2 px-2 font-medium">BSM Prem.</th>
              <th className="text-right py-2 px-2 font-medium">Daily Loss</th>
              <th className="text-right py-2 px-2 font-medium">Cum. Loss</th>
              {hasMarket && <th className="text-right py-2 px-2 font-medium">Real P&L</th>}
              <th className="text-right py-2 px-2 font-medium">Θ/day</th>
              <th className="text-right py-2 px-2 font-medium">% Decayed</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row) => (
              <tr
                key={row.day}
                className="border-b border-[#30363d]/30 hover:bg-[#0d1117]/50 transition-colors"
              >
                <td className="py-1.5 px-2 text-[#e6edf3]">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full mr-1.5"
                    style={{ backgroundColor: zoneColor(row.zone) }}
                  />
                  {row.day}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-[#8b949e]">{row.remaining}</td>
                <td className="py-1.5 px-2 text-right font-mono text-[#e6edf3]">{fmt(row.premium)}</td>
                <td className="py-1.5 px-2 text-right font-mono text-[#f85149]">
                  {fmt(row.dailyLoss).replace('₹-', '-₹')}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-[#f85149]">
                  {fmt(row.cumLoss).replace('₹-', '-₹')}
                </td>
                {hasMarket && (
                  <td className={`py-1.5 px-2 text-right font-mono font-semibold ${row.realPnl >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]'}`}>
                    {sign(row.realPnl)}{fmt(row.realPnl).replace('₹-', '-₹')}
                  </td>
                )}
                <td className="py-1.5 px-2 text-right font-mono text-[#e3b341]">
                  {row.theta.toFixed(2)}
                </td>
                <td className="py-1.5 px-2 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <div className="w-12 h-1.5 bg-[#0d1117] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${row.pctOfDecay}%`,
                          backgroundColor: row.pctOfDecay > 75 ? '#f85149' : row.pctOfDecay > 50 ? '#e3b341' : '#3fb950',
                        }}
                      />
                    </div>
                    <span className="font-mono text-[#8b949e] w-10 text-right">{row.pctOfDecay.toFixed(0)}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// FEATURE 3  -  Multi-Strike Comparison
// ═══════════════════════════════════════════════════════════
function MultiStrikeSection({ S, K, calendarDays, r, sigma, optionType, q }) {
  const stepSize = S > 10000 ? 100 : S > 1000 ? 50 : 10;
  const strikes = [K - stepSize, K, K + stepSize];
  const labels = ['1 Strike ITM', 'ATM', '1 Strike OTM'];
  const colors = ['#3fb950', '#e3b341', '#f85149'];

  if (optionType === 'PUT') {
    labels.reverse();
    strikes.reverse();
  }

  const chartData = useMemo(() => {
    const maxDay = calendarDays;
    const points = [];
    for (let d = maxDay; d >= 0; d--) {
      const T = d / 365;
      const row = { daysRemaining: d };
      strikes.forEach((strike, idx) => {
        row[`strike_${idx}`] = premiumAt(S, strike, T, r, sigma, optionType, q);
      });
      points.push(row);
    }
    return points;
  }, [S, K, calendarDays, r, sigma, optionType, q]);

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-xs shadow-lg">
        <p className="text-[#8b949e] mb-1.5">{d.daysRemaining} days remaining</p>
        {strikes.map((strike, idx) => (
          <p key={idx} className="font-mono" style={{ color: colors[idx] }}>
            {labels[idx]} ({strike}): {fmt(d[`strike_${idx}`])}
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-1">
        <Zap size={18} className="text-[#39d0d8]" />
        <h2 className="text-lg font-semibold text-[#e6edf3]">Multi-Strike Comparison</h2>
      </div>
      <p className="text-xs text-[#8b949e] mb-4">
        How moneyness affects decay  -  ITM retains intrinsic value, OTM decays to zero
      </p>

      <div className="h-[260px] -ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 15, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
            <XAxis
              dataKey="daysRemaining"
              reversed
              tick={{ fill: '#8b949e', fontSize: 11 }}
              label={{ value: 'Days Remaining', position: 'insideBottom', offset: -2, fill: '#8b949e', fontSize: 10 }}
            />
            <YAxis tick={{ fill: '#8b949e', fontSize: 11 }} tickFormatter={(v) => '₹' + v.toFixed(0)} />
            <Tooltip content={<CustomTooltip />} />
            {strikes.map((strike, idx) => (
              <Line
                key={idx}
                type="monotone"
                dataKey={`strike_${idx}`}
                stroke={colors[idx]}
                strokeWidth={2}
                dot={false}
                name={`${labels[idx]} (${strike})`}
              />
            ))}
            <Legend
              wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
              formatter={(value) => <span style={{ color: '#8b949e' }}>{value}</span>}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// FEATURE 4  -  Theta P&L Heatmap
// ═══════════════════════════════════════════════════════════
function HeatmapSection({ S, K, calendarDays, r, sigma, optionType, q, marketPremium }) {
  const bsmPremium = premiumAt(S, K, calendarDays / 365, r, sigma, optionType, q);
  const costBasis = marketPremium > 0 ? marketPremium : bsmPremium;

  const daysForward = [1, 3, 5, 7, 14, 21].filter(d => d < calendarDays);
  const priceSteps = [-5, -3, -2, -1, 0, 1, 2, 3, 5];
  const priceScenarios = priceSteps.map(pct => ({
    label: `${pct >= 0 ? '+' : ''}${pct}%`,
    spot: Math.round(S * (1 + pct / 100)),
  }));

  const heatmapData = useMemo(() => {
    return daysForward.map(df => {
      const remaining = calendarDays - df;
      const T = remaining / 365;
      const cells = priceScenarios.map(ps => {
        const prem = premiumAt(ps.spot, K, T, r, sigma, optionType, q);
        const pnl = prem - costBasis;
        return { pnl, premium: prem };
      });
      return { days: df, cells };
    });
  }, [S, K, calendarDays, r, sigma, optionType, q, costBasis]);

  const allPnls = heatmapData.flatMap(r => r.cells.map(c => c.pnl));
  const maxAbsPnl = Math.max(Math.abs(Math.min(...allPnls)), Math.abs(Math.max(...allPnls)), 1);

  const pnlColor = (pnl) => {
    const intensity = Math.min(Math.abs(pnl) / maxAbsPnl, 1);
    if (pnl >= 0) return `rgba(63, 185, 80, ${0.12 + intensity * 0.55})`;
    return `rgba(248, 81, 73, ${0.12 + intensity * 0.55})`;
  };

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-1">
        <Grid3x3 size={18} className="text-[#f0883e]" />
        <h2 className="text-lg font-semibold text-[#e6edf3]">P&L Heatmap</h2>
      </div>
      <p className="text-xs text-[#8b949e] mb-4">
        P&L based on {marketPremium > 0 ? `market price ₹${marketPremium.toFixed(2)}` : 'BSM premium'}  -  rows = days held, columns = spot price change
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-left py-2 px-1.5 text-[#8b949e] font-medium sticky left-0 bg-[#161b22] z-10">
                Days  / Spot ...
              </th>
              {priceScenarios.map((ps) => (
                <th key={ps.label} className="py-2 px-1 text-center text-[#8b949e] font-medium whitespace-nowrap">
                  <div>{ps.label}</div>
                  <div className="font-mono text-[9px] text-[#6e7681]">{ps.spot}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heatmapData.map((row) => (
              <tr key={row.days}>
                <td className="py-1.5 px-1.5 text-[#e6edf3] font-medium sticky left-0 bg-[#161b22] z-10 whitespace-nowrap">
                  +{row.days}d
                </td>
                {row.cells.map((cell, idx) => (
                  <td key={idx} className="py-1 px-0.5">
                    <div
                      className="heatmap-cell"
                      style={{ backgroundColor: pnlColor(cell.pnl), color: cell.pnl >= 0 ? '#3fb950' : '#f85149' }}
                      title={`Premium: ${fmt(cell.premium)}`}
                    >
                      {cell.pnl >= 0 ? '+' : ''}{cell.pnl.toFixed(1)}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-center gap-4 mt-3 text-[10px] text-[#8b949e]">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(248, 81, 73, 0.5)' }} />
          Loss (theta + price move)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(63, 185, 80, 0.5)' }} />
          Profit (price move &gt; theta cost)
        </span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════
export default function ThetaDecaySimulator() {
  //  Inputs (own state, independent from OptionsPricer) 
  const [spotPrice, setSpotPrice] = useState(DEFAULTS.spotPrice);
  const [strikePrice, setStrikePrice] = useState(DEFAULTS.strikePrice);
  const [optionType, setOptionType] = useState(DEFAULTS.optionType);
  const [expiryDate, setExpiryDate] = useState(getDefaultExpiry());
  const [iv, setIv] = useState(DEFAULTS.iv);
  const [riskFreeRate, setRiskFreeRate] = useState(DEFAULTS.riskFreeRate);
  const [dividendYield, setDividendYield] = useState(DEFAULTS.dividendYield);
  const [marketPremium, setMarketPremium] = useState(0);
  const [chainStrikes, setChainStrikes] = useState([]);

  //  Live data 
  const live = useLiveData();
  const { optExpiries: availableExpiries = [] } = useAvailableExpiries('NIFTY');

  const handleDataFetched = useCallback((chain, sym) => {
    if (!chain) return;
    if (chain.spot) setSpotPrice(Math.round(chain.spot * 100) / 100);
    const expiries = chain.expiryDates || [];
    if (expiries.length > 0) {
      setExpiryDate(nseToISODate(expiries[0]));
      // Populate chain strikes for dropdown
      const strikes = chain.byExpiry?.[expiries[0]] || [];
      setChainStrikes(strikes);
      
      // Keep existing strike if it exists in the new chain, otherwise find ATM
      let targetStrike = null;
      if (strikePrice > 0) {
        targetStrike = strikes.find(s => s.strikePrice === strikePrice);
      }
      if (!targetStrike) {
        targetStrike = findATMStrike(chain, expiries[0], chain.spot);
        if (targetStrike) setStrikePrice(targetStrike.strikePrice);
      }

      if (targetStrike) {
        const relevantIV = optionType === 'CALL' ? targetStrike.call?.iv : targetStrike.put?.iv;
        if (relevantIV && relevantIV > 0) setIv(Math.round(relevantIV * 100) / 100);
        // Auto-fill market premium from the live LTP
        const ltp = optionType === 'CALL' ? targetStrike.call?.ltp : targetStrike.put?.ltp;
        if (ltp && ltp > 0) setMarketPremium(Math.round(ltp * 100) / 100);
      }
    }
  }, [optionType, strikePrice]);

  // When user picks a different expiry from dropdown
  const handleChainExpiryChange = useCallback((newExpiryISO) => {
    setExpiryDate(newExpiryISO);
    
    // Convert ISO to NSE format for the fetch call
    const nseExpiry = availableExpiries.find(d => nseToISODate(d) === newExpiryISO);
    if (!nseExpiry) return;

    live.fetchNow('NIFTY', { force: true, expiry: nseExpiry }).then(chain => {
      if (chain) {
        const strikes = chain.byExpiry?.[nseExpiry] || [];
        setChainStrikes(strikes);
        
        let targetStrike = null;
        if (strikePrice > 0) targetStrike = strikes.find(s => s.strikePrice === strikePrice);
        if (!targetStrike) targetStrike = findATMStrike(chain, nseExpiry, chain.spot);
        
        if (targetStrike) {
          setStrikePrice(targetStrike.strikePrice);
          const relevantIV = optionType === 'CALL' ? targetStrike.call?.iv : targetStrike.put?.iv;
          if (relevantIV && relevantIV > 0) setIv(Math.round(relevantIV * 100) / 100);
          const ltp = optionType === 'CALL' ? targetStrike.call?.ltp : targetStrike.put?.ltp;
          if (ltp && ltp > 0) setMarketPremium(Math.round(ltp * 100) / 100);
        }
      }
    });
  }, [live, strikePrice, optionType, availableExpiries]);

  // When user picks a different strike from chain dropdown, update IV + market premium
  const handleChainStrikeChange = useCallback((newStrike) => {
    setStrikePrice(newStrike);
    const strikeData = chainStrikes.find(s => s.strikePrice === newStrike);
    if (strikeData) {
      const relevantIV = optionType === 'CALL' ? strikeData.call?.iv : strikeData.put?.iv;
      if (relevantIV && relevantIV > 0) setIv(Math.round(relevantIV * 100) / 100);
      const ltp = optionType === 'CALL' ? strikeData.call?.ltp : strikeData.put?.ltp;
      if (ltp && ltp > 0) setMarketPremium(Math.round(ltp * 100) / 100);
    }
  }, [chainStrikes, optionType]);

  // When user toggles CALL/PUT, update IV + market premium
  const handleTypeChange = useCallback((newType) => {
    setOptionType(newType);
    const strikeData = chainStrikes.find(s => s.strikePrice === strikePrice);
    if (strikeData) {
      const relevantIV = newType === 'CALL' ? strikeData.call?.iv : strikeData.put?.iv;
      if (relevantIV && relevantIV > 0) setIv(Math.round(relevantIV * 100) / 100);
      const ltp = newType === 'CALL' ? strikeData.call?.ltp : strikeData.put?.ltp;
      if (ltp && ltp > 0) setMarketPremium(Math.round(ltp * 100) / 100);
    }
  }, [chainStrikes, strikePrice]);

  //  Derived 
  const todayStr = new Date().toISOString().split('T')[0];
  const calendarDays = useMemo(() => {
    const diff = new Date(expiryDate) - new Date(todayStr);
    return Math.max(Math.ceil(diff / 86400000), 0);
  }, [expiryDate, todayStr]);

  const isExpired = calendarDays <= 0;
  const canShow = spotPrice > 0 && strikePrice > 0 && iv > 0 && !isExpired;

  //  BSM for summary metrics 
  const metrics = useMemo(() => {
    if (!canShow) return null;
    const T = calendarDays / 365;
    const r = riskFreeRate / 100;
    const sigma = iv / 100;
    const q = dividendYield / 100;
    const bsm = calculateBSM(spotPrice, strikePrice, T, r, sigma, optionType, q);
    if (!bsm) return null;

    const timeValue = bsm.timeValue;
    const thetaPerDay = Math.abs(bsm.theta);
    const thetaPctOfPremium = bsm.premium > 0 ? (thetaPerDay / bsm.premium) * 100 : 0;

    // Find days until 50% and 75% of time value is lost
    let days50 = null, days75 = null;
    for (let d = 1; d <= calendarDays; d++) {
      const remaining = calendarDays - d;
      const prem = premiumAt(spotPrice, strikePrice, remaining / 365, r, sigma, optionType, q);
      const currentTV = Math.max(prem - bsm.intrinsicValue, 0);
      const decayed = timeValue - currentTV;
      if (days50 === null && decayed >= timeValue * 0.5) days50 = d;
      if (days75 === null && decayed >= timeValue * 0.75) days75 = d;
      if (days50 !== null && days75 !== null) break;
    }

    // Break-even daily move: how much spot needs to move per day to offset theta
    const breakEvenMove = bsm.delta !== 0 ? thetaPerDay / Math.abs(bsm.delta) : 0;

    // Mispricing vs market
    const mispricing = marketPremium > 0 ? marketPremium - bsm.premium : 0;
    const mispricingPct = marketPremium > 0 ? (mispricing / bsm.premium) * 100 : 0;

    return {
      premium: bsm.premium,
      timeValue,
      thetaPerDay,
      thetaPctOfPremium,
      days50: days50 || calendarDays,
      days75: days75 || calendarDays,
      breakEvenMove,
      mispricing,
      mispricingPct,
      r, sigma, q,
    };
  }, [spotPrice, strikePrice, calendarDays, riskFreeRate, iv, dividendYield, optionType, canShow, marketPremium]);

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
      {/*  Header  */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-2xl font-bold text-[#e6edf3] flex items-center gap-2">
            <Clock size={24} className="text-[#e3b341]" />
            Theta Decay Simulator
          </h1>
          <p className="text-xs text-[#8b949e] mt-0.5">Visualize how time erodes option premiums</p>
        </div>
      </div>

      <LiveFetchBar onFetchComplete={handleDataFetched} />

      {/*  Layout Wrapper  */}
      <div className="flex flex-col lg:flex-row gap-6 mt-5 items-start">
        {/*  Parameter Bar (Sidebar)  */}
        <div className="card p-5 w-full lg:w-[320px] shrink-0 lg:sticky lg:top-4 z-10">
          <span className="text-xs font-medium text-[#8b949e] uppercase tracking-wider block mb-4">Parameters</span>
          <div className="flex flex-col gap-4">
            {/* Spot */}
          <div className="flex-1 min-w-[120px]">
            <label className="block text-xs font-medium text-[#e6edf3] mb-1">Spot Price (₹)</label>
            <input type="number" value={spotPrice} onChange={(e) => setSpotPrice(Number(e.target.value))} />
          </div>
          {/* Strike  -  with chain dropdown if available */}
          <div className="flex-1 min-w-[140px]">
            <label className="block text-xs font-medium text-[#e6edf3] mb-1">Strike Price (₹)</label>
            {chainStrikes.length > 0 ? (
              <select
                value={strikePrice}
                onChange={(e) => handleChainStrikeChange(Number(e.target.value))}
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-[#e6edf3] focus:border-[#58a6ff] focus:outline-none"
              >
                {chainStrikes.map(s => (
                  <option key={s.strikePrice} value={s.strikePrice}>
                    {s.strikePrice}
                    {optionType === 'CALL' && s.call?.iv ? ` (IV: ${s.call.iv.toFixed(1)}%)` : ''}
                    {optionType === 'PUT' && s.put?.iv ? ` (IV: ${s.put.iv.toFixed(1)}%)` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input type="number" value={strikePrice} onChange={(e) => setStrikePrice(Number(e.target.value))} />
            )}
            <span className="text-[10px] text-[#8b949e] mt-0.5 block">
              {chainStrikes.length > 0 ? `${chainStrikes.length} strikes from chain` : 'Option strike'}
            </span>
          </div>
          {/* Type */}
          <div className="min-w-[130px]">
            <label className="block text-xs font-medium text-[#e6edf3] mb-1">Type</label>
            <div className="flex rounded-lg overflow-hidden border border-[#30363d]">
              <button
                onClick={() => handleTypeChange('CALL')}
                className={`flex-1 py-2 text-xs font-bold transition-colors cursor-pointer ${
                  optionType === 'CALL'
                    ? 'bg-[#3fb95020] text-[#3fb950] border-r border-[#30363d]'
                    : 'bg-[#0d1117] text-[#8b949e] border-r border-[#30363d] hover:text-[#e6edf3]'
                }`}
              >CALL</button>
              <button
                onClick={() => handleTypeChange('PUT')}
                className={`flex-1 py-2 text-xs font-bold transition-colors cursor-pointer ${
                  optionType === 'PUT'
                    ? 'bg-[#f8514920] text-[#f85149]'
                    : 'bg-[#0d1117] text-[#8b949e] hover:text-[#e6edf3]'
                }`}
              >PUT</button>
            </div>
          </div>
          {/* Expiry */}
          <div className="flex-1 min-w-[140px]">
            <label className="block text-xs font-medium text-[#e6edf3] mb-1">Expiry Date</label>
            {availableExpiries.length > 0 ? (
              <select
                value={expiryDate}
                onChange={(e) => handleChainExpiryChange(e.target.value)}
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-[#e6edf3] focus:border-[#58a6ff] focus:outline-none"
              >
                {availableExpiries.map(exp => (
                  <option key={exp} value={nseToISODate(exp)}>{exp}</option>
                ))}
              </select>
            ) : (
              <select
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-[#e6edf3] focus:border-[#58a6ff] focus:outline-none"
              >
                <option value={expiryDate}>{expiryDate}</option>
              </select>
            )}
            <span className="text-[10px] text-[#8b949e] mt-0.5 block">
              {calendarDays > 0 ? `${calendarDays} calendar days` : 'Expired'}
            </span>
          </div>
          {/* IV */}
          <div className="flex-1 min-w-[100px]">
            <label className="block text-xs font-medium text-[#e6edf3] mb-1">IV (%)</label>
            <input type="number" value={iv} step="0.5" onChange={(e) => setIv(Number(e.target.value))} />
          </div>
          {/* RFR */}
          <div className="flex-1 min-w-[100px]">
            <label className="block text-xs font-medium text-[#e6edf3] mb-1">RFR (%)</label>
            <input type="number" value={riskFreeRate} step="0.1" onChange={(e) => setRiskFreeRate(Number(e.target.value))} />
          </div>
          {/* Div Yield */}
          <div className="flex-1 min-w-[100px]">
            <label className="block text-xs font-medium text-[#e6edf3] mb-1">Div Yield (%)</label>
            <input type="number" value={dividendYield} step="0.1" onChange={(e) => setDividendYield(Number(e.target.value))} />
          </div>
          {/* Market Premium */}
          <div className="flex-1 min-w-[140px]">
            <label className="block text-xs font-medium text-[#a371f7] mb-1 flex items-center gap-1">
              <DollarSign size={12} /> Market Premium (₹)
            </label>
            <input
              type="number"
              value={marketPremium || ''}
              placeholder="e.g. 253.15"
              step="0.05"
              onChange={(e) => setMarketPremium(Number(e.target.value))}
              className="!border-[#a371f740] focus:!border-[#a371f7]"
            />
            <span className="text-[10px] text-[#8b949e] mt-0.5 block">
              {marketPremium > 0 && metrics
                ? metrics.mispricing >= 0
                  ? `Overpriced by ${fmt(metrics.mispricing)} (${metrics.mispricingPct.toFixed(1)}%)`
                  : `Underpriced by ${fmt(Math.abs(metrics.mispricing))} (${Math.abs(metrics.mispricingPct).toFixed(1)}%)`
                : 'Actual price you paid or see in market'}
            </span>
          </div>
        </div>
      </div>

      {/* RIGHT CONTENT */}
      <div className="flex-1 min-w-0 flex flex-col gap-6 w-full">
        {/*  Expired Banner  */}
      {isExpired && expiryDate && (
        <div className="mb-4 p-3 rounded-xl bg-[#f8514915] border border-[#f8514940] flex items-center gap-2">
          <AlertTriangle size={16} className="text-[#f85149] shrink-0" />
          <span className="text-sm text-[#f85149]">Option has expired. Select a future expiry date.</span>
        </div>
      )}

      {/*  Content (only when valid)  */}
      {canShow && metrics && (
        <>
          {/*  Summary Metrics  */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-2">
            <MetricCard
              icon={Clock}
              iconColor="#e3b341"
              label="Time Value at Risk"
              value={fmt(metrics.timeValue)}
              subtext={`${pct(metrics.timeValue / metrics.premium)} of premium`}
            />
            <MetricCard
              icon={TrendingDown}
              iconColor="#f85149"
              label="Theta (Θ/day)"
              value={`-₹${metrics.thetaPerDay.toFixed(2)}`}
              subtext={`${metrics.thetaPctOfPremium.toFixed(1)}% of premium/day`}
            />
            <MetricCard
              icon={Zap}
              iconColor="#a371f7"
              label="50% Decay In"
              value={`${metrics.days50} days`}
              subtext="Half of time value lost"
            />
            <MetricCard
              icon={BarChart3}
              iconColor="#39d0d8"
              label="75% Decay In"
              value={`${metrics.days75} days`}
              subtext="Three-quarters lost"
            />
            {marketPremium > 0 && (
              <MetricCard
                icon={ArrowUpDown}
                iconColor="#a371f7"
                label={metrics.mispricing >= 0 ? 'Overpriced' : 'Underpriced'}
                value={fmt(Math.abs(metrics.mispricing))}
                subtext={`Market ₹${marketPremium.toFixed(2)} vs BSM ₹${metrics.premium.toFixed(2)} (${Math.abs(metrics.mispricingPct).toFixed(1)}%)`}
              />
            )}
            <MetricCard
              icon={TrendingDown}
              iconColor="#f0883e"
              label="Break-Even (Δ)"
              value={`₹${metrics.breakEvenMove.toFixed(1)}/day`}
              subtext="Spot must move this much to offset theta"
            />
          </div>

          {/*  What-If Scenario Simulator  */}
          <WhatIfScenarioSection
            S={spotPrice} K={strikePrice} calendarDays={calendarDays}
            r={metrics.r} sigma={metrics.sigma} optionType={optionType} q={metrics.q}
            marketPremium={marketPremium} bsmPremium={metrics.premium}
          />

          {/*  Feature 1: Decay Curve  */}
          <div className="mb-5">
            <DecayCurveSection
              S={spotPrice} K={strikePrice} calendarDays={calendarDays}
              r={metrics.r} sigma={metrics.sigma} optionType={optionType} q={metrics.q}
              marketPremium={marketPremium}
            />
          </div>

          {/*  Feature 3 + 4: Multi-Strike + Heatmap side by side on desktop  */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
            <MultiStrikeSection
              S={spotPrice} K={strikePrice} calendarDays={calendarDays}
              r={metrics.r} sigma={metrics.sigma} optionType={optionType} q={metrics.q}
            />
            <HeatmapSection
              S={spotPrice} K={strikePrice} calendarDays={calendarDays}
              r={metrics.r} sigma={metrics.sigma} optionType={optionType} q={metrics.q}
              marketPremium={marketPremium}
            />
          </div>

          {/*  Feature 2: Daily Breakdown  */}
          <div className="mb-5">
            <DailyBreakdownSection
              S={spotPrice} K={strikePrice} calendarDays={calendarDays}
              r={metrics.r} sigma={metrics.sigma} optionType={optionType} q={metrics.q}
              marketPremium={marketPremium}
            />
          </div>
        </>
      )}
      </div>
      </div>

      {/*  Footer  */}
      <footer className="text-center py-6 border-t border-[#30363d]">
        <p className="text-xs text-[#8b949e] max-w-2xl mx-auto leading-relaxed">
          Theta decay simulation assumes constant spot price and implied volatility.
          In reality, price movement and IV changes interact with theta.
          The heatmap shows combined effects. Use the Pricer tab for single-point pricing. Not financial advice.
        </p>
      </footer>
    </div>
  );
}
