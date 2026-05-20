import React, { useState, useMemo, useCallback } from 'react';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceDot, Legend,
} from 'recharts';
import {
  Clock, TrendingDown, BarChart3, Grid3x3, Zap,
  Radio, Loader2, AlertTriangle, DollarSign, ArrowUpDown,
} from 'lucide-react';
import { calculateBSM, premiumAt, generateThetaDecayCurve, countTradingDays, getDefaultExpiry } from './bsm.js';
import { useLiveData, findATMStrike, nseToISODate } from './useLiveData.js';

function fmt(v) { return '₹' + v.toFixed(2); }
function sign(v) { return v >= 0 ? '+' : ''; }
function pct(v) { return (v * 100).toFixed(1) + '%'; }

// ── Default values (mirrors OptionsPricer) ──
const DEFAULTS = {
  spotPrice: 24500,
  strikePrice: 24500,
  optionType: 'CALL',
  iv: 14,
  riskFreeRate: 6.5,
  dividendYield: 1.2,
};

// ── Summary Metric Card ──
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
// IMPLIED IV SOLVER (Newton-Raphson)
// Back-solves the IV that produces the given market premium.
// ═══════════════════════════════════════════════════════════
function solveImpliedIV(S, K, T, r, marketPrice, optionType, q = 0) {
  if (T <= 0 || marketPrice <= 0) return null;
  const intrinsic = optionType === 'CALL' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  if (marketPrice < intrinsic) return null;

  let sigma = 0.20; // initial guess: 20%
  for (let i = 0; i < 50; i++) {
    const bsm = calculateBSM(S, K, T, r, sigma, optionType, q);
    if (!bsm) return null;
    const diff = bsm.premium - marketPrice;
    // vega is per 1% IV change, so derivative w.r.t. sigma = vega * 100
    const vegaSigma = bsm.vega * 100;
    if (Math.abs(vegaSigma) < 1e-12) break;
    sigma -= diff / vegaSigma;
    if (sigma <= 0.001) sigma = 0.001;
    if (sigma > 5) sigma = 5;
    if (Math.abs(diff) < 0.001) break;
  }
  return sigma;
}

// ═══════════════════════════════════════════════════════════
// FEATURE 1 — Interactive Decay Curve (Dual: BSM + Market)
// ═══════════════════════════════════════════════════════════
function DecayCurveSection({ S, K, calendarDays, r, sigma, optionType, q, marketPremium }) {
  const [hoverDay, setHoverDay] = useState(null);

  const hasMarket = marketPremium > 0;

  // Solve for the market-implied IV
  const impliedIV = useMemo(() => {
    if (!hasMarket || calendarDays <= 0) return null;
    const T = calendarDays / 365;
    return solveImpliedIV(S, K, T, r, marketPremium, optionType, q);
  }, [S, K, calendarDays, r, marketPremium, optionType, q, hasMarket]);

  // Generate BSM decay curve (yellow — using user's input IV)
  const bsmCurve = useMemo(
    () => generateThetaDecayCurve(S, K, calendarDays, r, sigma, optionType, q),
    [S, K, calendarDays, r, sigma, optionType, q]
  );

  // Generate market-implied decay curve (purple — using solved IV)
  const marketCurve = useMemo(() => {
    if (!impliedIV) return null;
    return generateThetaDecayCurve(S, K, calendarDays, r, impliedIV, optionType, q);
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
          : 'How your option premium erodes as time passes — assuming spot and IV stay constant'
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
// FEATURE 2 — Daily Theta Breakdown Table
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
        Theta accelerates near expiry — the <span className="text-[#f85149]">last 7 days</span> are the most destructive
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
// FEATURE 3 — Multi-Strike Comparison
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
        How moneyness affects decay — ITM retains intrinsic value, OTM decays to zero
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
// FEATURE 4 — Theta P&L Heatmap
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
        P&L based on {marketPremium > 0 ? `market price ₹${marketPremium.toFixed(2)}` : 'BSM premium'} — rows = days held, columns = spot price change
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-left py-2 px-1.5 text-[#8b949e] font-medium sticky left-0 bg-[#161b22] z-10">
                Days ↓ / Spot →
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
  // ── Inputs (own state, independent from OptionsPricer) ──
  const [spotPrice, setSpotPrice] = useState(DEFAULTS.spotPrice);
  const [strikePrice, setStrikePrice] = useState(DEFAULTS.strikePrice);
  const [optionType, setOptionType] = useState(DEFAULTS.optionType);
  const [expiryDate, setExpiryDate] = useState(getDefaultExpiry());
  const [iv, setIv] = useState(DEFAULTS.iv);
  const [riskFreeRate, setRiskFreeRate] = useState(DEFAULTS.riskFreeRate);
  const [dividendYield, setDividendYield] = useState(DEFAULTS.dividendYield);
  const [marketPremium, setMarketPremium] = useState(0);

  // ── Live data ──
  const live = useLiveData();

  const handleFetchLive = useCallback(async () => {
    const chain = await live.fetchNow('NIFTY');
    if (!chain) return;
    if (chain.spot) setSpotPrice(Math.round(chain.spot * 100) / 100);
    const expiries = chain.expiryDates || [];
    if (expiries.length > 0) {
      setExpiryDate(nseToISODate(expiries[0]));
      const atm = findATMStrike(chain, expiries[0], chain.spot);
      if (atm) {
        setStrikePrice(atm.strikePrice);
        const relevantIV = optionType === 'CALL' ? atm.call?.iv : atm.put?.iv;
        if (relevantIV && relevantIV > 0) setIv(Math.round(relevantIV * 100) / 100);
        // Auto-fill market premium from the live LTP
        const ltp = optionType === 'CALL' ? atm.call?.ltp : atm.put?.ltp;
        if (ltp && ltp > 0) setMarketPremium(Math.round(ltp * 100) / 100);
      }
    }
  }, [live, optionType]);

  // ── Derived ──
  const todayStr = new Date().toISOString().split('T')[0];
  const calendarDays = useMemo(() => {
    const diff = new Date(expiryDate) - new Date(todayStr);
    return Math.max(Math.ceil(diff / 86400000), 0);
  }, [expiryDate, todayStr]);

  const isExpired = calendarDays <= 0;
  const canShow = spotPrice > 0 && strikePrice > 0 && iv > 0 && !isExpired;

  // ── BSM for summary metrics ──
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
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-2xl font-bold text-[#e6edf3] flex items-center gap-2">
            <Clock size={24} className="text-[#e3b341]" />
            Theta Decay Simulator
          </h1>
          <p className="text-xs text-[#8b949e] mt-0.5">Visualize how time erodes option premiums</p>
        </div>
        <button
          onClick={handleFetchLive}
          disabled={live.isLoading}
          className={`flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg font-semibold transition-all cursor-pointer ${
            live.isLoading
              ? 'bg-[#30363d] text-[#8b949e] cursor-wait'
              : 'bg-gradient-to-r from-[#238636] to-[#2ea043] text-white hover:from-[#2ea043] hover:to-[#3fb950] shadow-md shadow-[#23863620]'
          }`}
        >
          {live.isLoading ? <Loader2 size={14} className="animate-spin" /> : <Radio size={14} />}
          {live.isLoading ? 'Fetching...' : 'Fetch Live'}
        </button>
      </div>

      {/* ── Live data status ── */}
      {(live.data || live.error) && (
        <div className="flex items-center gap-3 mb-3 text-xs">
          {live.data && (
            <span className="flex items-center gap-1.5 text-[#3fb950]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950] animate-pulse" />
              NIFTY: ₹{live.data.spot?.toFixed(2)}
            </span>
          )}
          {live.error && (
            <span className="flex items-center gap-1 text-[#f85149]">
              <AlertTriangle size={12} /> {live.error}
            </span>
          )}
        </div>
      )}

      {/* ── Parameter Bar ── */}
      <div className="card p-4 mb-5">
        <span className="text-xs font-medium text-[#8b949e] uppercase tracking-wider block mb-3">Parameters</span>
        <div className="flex flex-wrap gap-3 items-end">
          {/* Spot */}
          <div className="flex-1 min-w-[120px]">
            <label className="block text-xs font-medium text-[#e6edf3] mb-1">Spot Price (₹)</label>
            <input type="number" value={spotPrice} onChange={(e) => setSpotPrice(Number(e.target.value))} />
          </div>
          {/* Strike */}
          <div className="flex-1 min-w-[120px]">
            <label className="block text-xs font-medium text-[#e6edf3] mb-1">Strike Price (₹)</label>
            <input type="number" value={strikePrice} onChange={(e) => setStrikePrice(Number(e.target.value))} />
          </div>
          {/* Type */}
          <div className="min-w-[130px]">
            <label className="block text-xs font-medium text-[#e6edf3] mb-1">Type</label>
            <div className="flex rounded-lg overflow-hidden border border-[#30363d]">
              <button
                onClick={() => setOptionType('CALL')}
                className={`flex-1 py-2 text-xs font-bold transition-colors cursor-pointer ${
                  optionType === 'CALL'
                    ? 'bg-[#3fb95020] text-[#3fb950] border-r border-[#30363d]'
                    : 'bg-[#0d1117] text-[#8b949e] border-r border-[#30363d] hover:text-[#e6edf3]'
                }`}
              >CALL</button>
              <button
                onClick={() => setOptionType('PUT')}
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
            <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
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

      {/* ── Expired Banner ── */}
      {isExpired && expiryDate && (
        <div className="mb-4 p-3 rounded-xl bg-[#f8514915] border border-[#f8514940] flex items-center gap-2">
          <AlertTriangle size={16} className="text-[#f85149] shrink-0" />
          <span className="text-sm text-[#f85149]">Option has expired. Select a future expiry date.</span>
        </div>
      )}

      {/* ── Content (only when valid) ── */}
      {canShow && metrics && (
        <>
          {/* ── Summary Metrics ── */}
          <div className="flex flex-wrap gap-3 mb-5">
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
              label="Theta per Day"
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
              label="Break-Even Move"
              value={`₹${metrics.breakEvenMove.toFixed(1)}/day`}
              subtext="Spot must move this much to offset theta"
            />
          </div>

          {/* ── Feature 1: Decay Curve ── */}
          <div className="mb-5">
            <DecayCurveSection
              S={spotPrice} K={strikePrice} calendarDays={calendarDays}
              r={metrics.r} sigma={metrics.sigma} optionType={optionType} q={metrics.q}
              marketPremium={marketPremium}
            />
          </div>

          {/* ── Feature 3 + 4: Multi-Strike + Heatmap side by side on desktop ── */}
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

          {/* ── Feature 2: Daily Breakdown ── */}
          <div className="mb-5">
            <DailyBreakdownSection
              S={spotPrice} K={strikePrice} calendarDays={calendarDays}
              r={metrics.r} sigma={metrics.sigma} optionType={optionType} q={metrics.q}
              marketPremium={marketPremium}
            />
          </div>
        </>
      )}

      {/* ── Footer ── */}
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
