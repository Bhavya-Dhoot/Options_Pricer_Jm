import React, { useState, useMemo, useCallback } from 'react';
import {
  RotateCcw, Calculator, Copy, Check, AlertTriangle,
  Radio, Wifi, WifiOff, RefreshCw, Loader2,
} from 'lucide-react';
import { calculateBSM, countTradingDays, getDefaultExpiry } from './bsm.js';
import { useLiveData, findATMStrike, nseToISODate } from './useLiveData.js';
import GreeksDashboard from './GreeksDashboard.jsx';
import ScenarioSimulator from './ScenarioSimulator.jsx';

function fmt(v) { return '₹' + v.toFixed(2); }

// ── Default values ──
const DEFAULTS = {
  spotPrice: 24500,
  strikePrice: 24500,
  optionType: 'CALL',
  iv: 14,
  riskFreeRate: 6.5,
  dividendYield: 1.2,
};

export default function OptionsPricer() {
  // ── Inputs ──
  const [spotPrice, setSpotPrice] = useState(DEFAULTS.spotPrice);
  const [strikePrice, setStrikePrice] = useState(DEFAULTS.strikePrice);
  const [optionType, setOptionType] = useState(DEFAULTS.optionType);
  const [expiryDate, setExpiryDate] = useState(getDefaultExpiry());
  const [iv, setIv] = useState(DEFAULTS.iv);
  const [riskFreeRate, setRiskFreeRate] = useState(DEFAULTS.riskFreeRate);
  const [dividendYield, setDividendYield] = useState(DEFAULTS.dividendYield);
  const [openInterest, setOpenInterest] = useState('');
  const [selectedExpiry, setSelectedExpiry] = useState(null); // NSE format expiry
  const [chainStrikes, setChainStrikes] = useState([]); // strikes from chain for current expiry

  // ── Results state ──
  const [results, setResults] = useState(null);
  const [calcParams, setCalcParams] = useState(null);
  const [isFresh, setIsFresh] = useState(false);
  const [copied, setCopied] = useState(false);

  // ── Live Data ──
  const live = useLiveData();

  const handleFetchLive = useCallback(async () => {
    const chain = await live.fetchNow('NIFTY');
    if (!chain) return;

    // Set spot price
    if (chain.spot) setSpotPrice(Math.round(chain.spot * 100) / 100);

    // Set nearest expiry
    const expiries = chain.expiryDates || [];
    if (expiries.length > 0) {
      const nearestExpiry = expiries[0];
      setSelectedExpiry(nearestExpiry);
      setExpiryDate(nseToISODate(nearestExpiry));

      // Get strikes for this expiry
      const strikes = chain.byExpiry?.[nearestExpiry] || [];
      setChainStrikes(strikes);

      // Find ATM and set strike + IV
      const atm = findATMStrike(chain, nearestExpiry, chain.spot);
      if (atm) {
        setStrikePrice(atm.strikePrice);
        const callIV = atm.call?.iv;
        const putIV = atm.put?.iv;
        const relevantIV = optionType === 'CALL' ? callIV : putIV;
        if (relevantIV && relevantIV > 0) setIv(Math.round(relevantIV * 100) / 100);
        const oi = optionType === 'CALL' ? atm.call?.oi : atm.put?.oi;
        if (oi) setOpenInterest(oi.toLocaleString());
      }
    }
  }, [live, optionType]);

  // When user picks a different strike from the chain dropdown, update IV
  const handleChainStrikeChange = useCallback((newStrike) => {
    setStrikePrice(newStrike);
    const strikeData = chainStrikes.find(s => s.strikePrice === newStrike);
    if (strikeData) {
      const relevantIV = optionType === 'CALL' ? strikeData.call?.iv : strikeData.put?.iv;
      if (relevantIV && relevantIV > 0) setIv(Math.round(relevantIV * 100) / 100);
      const oi = optionType === 'CALL' ? strikeData.call?.oi : strikeData.put?.oi;
      if (oi) setOpenInterest(oi.toLocaleString());
    }
  }, [chainStrikes, optionType]);

  // When expiry changes from chain dropdown, update strikes and IV
  const handleChainExpiryChange = useCallback((nseExpiry) => {
    setSelectedExpiry(nseExpiry);
    setExpiryDate(nseToISODate(nseExpiry));
    const strikes = live.data?.byExpiry?.[nseExpiry] || [];
    setChainStrikes(strikes);
    const spot = live.data?.spot || spotPrice;
    const atm = findATMStrike(live.data, nseExpiry, spot);
    if (atm) {
      setStrikePrice(atm.strikePrice);
      const relevantIV = optionType === 'CALL' ? atm.call?.iv : atm.put?.iv;
      if (relevantIV && relevantIV > 0) setIv(Math.round(relevantIV * 100) / 100);
    }
  }, [live.data, spotPrice, optionType]);

  const timeSinceUpdate = live.lastUpdate
    ? Math.round((Date.now() - live.lastUpdate.getTime()) / 1000)
    : null;

  // ── Derived ──
  // todayStr changes once per calendar day, forcing memos to recompute
  const todayStr = new Date().toISOString().split('T')[0]; // e.g. "2026-05-20"
  const tradingDays = useMemo(() => countTradingDays(new Date(todayStr), new Date(expiryDate)), [expiryDate, todayStr]);
  const calendarDays = useMemo(() => {
    const diff = new Date(expiryDate) - new Date(todayStr);
    return Math.max(Math.ceil(diff / 86400000), 0);
  }, [expiryDate, todayStr]);
  const isExpired = calendarDays <= 0;
  const canCalculate = spotPrice > 0 && strikePrice > 0 && iv > 0 && riskFreeRate >= 0 && !isExpired;

  // ── Calculate ──
  const handleCalculate = useCallback(() => {
    if (!canCalculate) return;

    const S = spotPrice;
    const K = strikePrice;
    const T = calendarDays / 365;
    const r = riskFreeRate / 100;
    const sigma = iv / 100;
    const q = dividendYield / 100;

    const bsm = calculateBSM(S, K, T, r, sigma, optionType, q);
    if (bsm) {
      setResults(bsm);
      setCalcParams({ S, K, calendarDays, r, sigma, optionType, q });
      setIsFresh(true);
      setTimeout(() => setIsFresh(false), 5000);
    }
  }, [spotPrice, strikePrice, calendarDays, riskFreeRate, iv, dividendYield, optionType, canCalculate]);

  // ── Auto-calculate on first mount ──
  React.useEffect(() => {
    handleCalculate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reset ──
  const handleReset = () => {
    setSpotPrice(DEFAULTS.spotPrice);
    setStrikePrice(DEFAULTS.strikePrice);
    setOptionType(DEFAULTS.optionType);
    setExpiryDate(getDefaultExpiry());
    setIv(DEFAULTS.iv);
    setRiskFreeRate(DEFAULTS.riskFreeRate);
    setDividendYield(DEFAULTS.dividendYield);
    setOpenInterest('');
    setResults(null);
    setCalcParams(null);
  };

  // ── Copy results ──
  const handleCopy = async () => {
    if (!results) return;
    const text = [
      `── Black-Scholes Options Pricer ──`,
      `Type: ${optionType} | Spot: ₹${spotPrice} | Strike: ₹${strikePrice}`,
      `IV: ${iv}% | Risk-Free Rate: ${riskFreeRate}% | Div Yield: ${dividendYield}% | Days: ${calendarDays} cal / ${tradingDays} trd`,
      `──────────────────────────────`,
      `Fair Premium: ${fmt(results.premium)}`,
      `Intrinsic: ${fmt(results.intrinsicValue)} | Time Value: ${fmt(results.timeValue)}`,
      `Moneyness: ${results.moneyness}`,
      `──────────────────────────────`,
      `Greeks:`,
      `  Delta: ${results.delta.toFixed(4)}`,
      `  Gamma: ${results.gamma.toFixed(4)}`,
      `  Theta: ${results.theta.toFixed(4)}`,
      `  Vega:  ${results.vega.toFixed(4)}`,
      `  Rho:   ${results.rho.toFixed(4)}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  // ── Moneyness color ──
  const moneynessColor = results
    ? results.moneyness === 'ITM' ? '#3fb950'
    : results.moneyness === 'OTM' ? '#f85149'
    : '#e3b341'
    : '#8b949e';

  // ── Missing fields ──
  const missingFields = [];
  if (!spotPrice || spotPrice <= 0) missingFields.push('spot');
  if (!strikePrice || strikePrice <= 0) missingFields.push('strike');
  if (!iv || iv <= 0) missingFields.push('iv');

  return (
    <div className="min-h-screen bg-[#0d1117] p-4 md:p-6 max-w-7xl mx-auto">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-2xl font-bold text-[#e6edf3] flex items-center gap-2">
            <Calculator size={24} className="text-[#58a6ff]" />
            Options Pricer
          </h1>
          <p className="text-xs text-[#8b949e] mt-0.5">Black-Scholes Model • Indian Equity Markets</p>
        </div>
        <div className="flex items-center gap-2">
          {results && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#58a6ff] transition-colors cursor-pointer"
            >
              {copied ? <Check size={13} className="text-[#3fb950]" /> : <Copy size={13} />}
              {copied ? 'Copied!' : 'Copy Results'}
            </button>
          )}
        </div>
      </div>

      {/* ── Live Data Bar ── */}
      <div className="card p-3 mb-5 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <button
            id="btn-fetch-live"
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

          <button
            id="btn-auto-refresh"
            onClick={() => live.isLive ? live.stopAutoRefresh() : live.startAutoRefresh(30000, 'NIFTY')}
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
              NIFTY: ₹{live.data.spot?.toFixed(2)}
            </span>
          )}
          {live.lastUpdate && (
            <span className="text-[#8b949e]">
              Updated {timeSinceUpdate}s ago
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

      {/* ── Expired banner ── */}
      {isExpired && expiryDate && (
        <div className="mb-4 p-3 rounded-xl bg-[#f8514915] border border-[#f8514940] flex items-center gap-2">
          <AlertTriangle size={16} className="text-[#f85149] shrink-0" />
          <span className="text-sm text-[#f85149]">Option has expired. Select a future expiry date.</span>
        </div>
      )}

      {/* ═══════════════ SECTION 1 — INPUT BAR ═══════════════ */}
      <div className="card p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-[#8b949e] uppercase tracking-wider">
            Parameters {live.data ? <span className="text-[#3fb950] normal-case font-normal">• Live from NSE</span> : ''}
          </span>
          <button
            onClick={() => { handleReset(); setChainStrikes([]); setSelectedExpiry(null); live.stopAutoRefresh(); }}
            className="flex items-center gap-1 text-xs text-[#8b949e] hover:text-[#f85149] transition-colors cursor-pointer"
          >
            <RotateCcw size={12} />
            Reset
          </button>
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          {/* Spot */}
          <div className="flex-1 min-w-[140px]">
            <label className="block text-xs font-medium text-[#e6edf3] mb-1">Underlying Price (₹)</label>
            <input
              id="input-spot"
              type="number"
              value={spotPrice}
              onChange={(e) => setSpotPrice(Number(e.target.value))}
              className={missingFields.includes('spot') ? 'border-[#f85149]!' : ''}
            />
            <span className="text-[10px] text-[#8b949e] mt-0.5 block">Current market price</span>
          </div>

          {/* Strike — with chain dropdown if available */}
          <div className="flex-1 min-w-[140px]">
            <label className="block text-xs font-medium text-[#e6edf3] mb-1">Strike Price (₹)</label>
            {chainStrikes.length > 0 ? (
              <select
                id="input-strike"
                value={strikePrice}
                onChange={(e) => handleChainStrikeChange(Number(e.target.value))}
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-[#e6edf3] focus:border-[#58a6ff] focus:outline-none"
              >
                {chainStrikes.map(s => (
                  <option key={s.strikePrice} value={s.strikePrice}>
                    {s.strikePrice}
                    {s.call?.iv ? ` (IV: ${s.call.iv.toFixed(1)}%)` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="input-strike"
                type="number"
                value={strikePrice}
                onChange={(e) => setStrikePrice(Number(e.target.value))}
                className={missingFields.includes('strike') ? 'border-[#f85149]!' : ''}
              />
            )}
            <span className="text-[10px] text-[#8b949e] mt-0.5 block">
              {chainStrikes.length > 0 ? `${chainStrikes.length} strikes from chain` : 'Option strike'}
            </span>
          </div>

          {/* Option Type Toggle */}
          <div className="min-w-[150px]">
            <label className="block text-xs font-medium text-[#e6edf3] mb-1">Option Type</label>
            <div className="flex rounded-lg overflow-hidden border border-[#30363d]">
              <button
                id="btn-call"
                onClick={() => setOptionType('CALL')}
                className={`flex-1 py-2 text-xs font-bold transition-colors cursor-pointer ${
                  optionType === 'CALL'
                    ? 'bg-[#3fb95020] text-[#3fb950] border-r border-[#30363d]'
                    : 'bg-[#0d1117] text-[#8b949e] border-r border-[#30363d] hover:text-[#e6edf3]'
                }`}
              >
                CALL
              </button>
              <button
                id="btn-put"
                onClick={() => setOptionType('PUT')}
                className={`flex-1 py-2 text-xs font-bold transition-colors cursor-pointer ${
                  optionType === 'PUT'
                    ? 'bg-[#f8514920] text-[#f85149]'
                    : 'bg-[#0d1117] text-[#8b949e] hover:text-[#e6edf3]'
                }`}
              >
                PUT
              </button>
            </div>
            <span className="text-[10px] text-[#8b949e] mt-0.5 block">Call or Put</span>
          </div>

          {/* Expiry — with chain dropdown if available */}
          <div className="flex-1 min-w-[150px]">
            <label className="block text-xs font-medium text-[#e6edf3] mb-1">Expiry Date</label>
            {live.data?.expiryDates?.length > 0 ? (
              <select
                id="input-expiry"
                value={selectedExpiry || ''}
                onChange={(e) => handleChainExpiryChange(e.target.value)}
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-[#e6edf3] focus:border-[#58a6ff] focus:outline-none"
              >
                {live.data.expiryDates.map(exp => (
                  <option key={exp} value={exp}>{exp}</option>
                ))}
              </select>
            ) : (
              <input
                id="input-expiry"
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            )}
            <span className="text-[10px] text-[#8b949e] mt-0.5 block">
              {calendarDays > 0 ? `${calendarDays} calendar days (${tradingDays} trading) remaining` : 'Expired'}
            </span>
          </div>

          {/* IV */}
          <div className="flex-1 min-w-[120px]">
            <label className="block text-xs font-medium text-[#e6edf3] mb-1">Implied Volatility (%)</label>
            <input
              id="input-iv"
              type="number"
              value={iv}
              step="0.5"
              onChange={(e) => setIv(Number(e.target.value))}
              className={missingFields.includes('iv') ? 'border-[#f85149]!' : ''}
            />
            <span className="text-[10px] text-[#8b949e] mt-0.5 block">Annualized IV</span>
          </div>

          {/* Risk-free Rate */}
          <div className="flex-1 min-w-[120px]">
            <label className="block text-xs font-medium text-[#e6edf3] mb-1">Risk-Free Rate (%)</label>
            <input
              id="input-rfr"
              type="number"
              value={riskFreeRate}
              step="0.1"
              onChange={(e) => setRiskFreeRate(Number(e.target.value))}
            />
            <span className="text-[10px] text-[#8b949e] mt-0.5 block">Govt bond yield</span>
          </div>

          {/* Dividend Yield */}
          <div className="flex-1 min-w-[120px]">
            <label className="block text-xs font-medium text-[#e6edf3] mb-1">Dividend Yield (%)</label>
            <input
              id="input-divyield"
              type="number"
              value={dividendYield}
              step="0.1"
              onChange={(e) => setDividendYield(Number(e.target.value))}
            />
            <span className="text-[10px] text-[#8b949e] mt-0.5 block">Continuous yield</span>
          </div>

          {/* Calculate Button */}
          <button
            id="btn-calculate"
            onClick={handleCalculate}
            disabled={!canCalculate}
            className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer self-center ${
              canCalculate
                ? 'bg-[#58a6ff] text-[#0d1117] hover:bg-[#79b8ff] shadow-lg shadow-[#58a6ff20]'
                : 'bg-[#30363d] text-[#8b949e] cursor-not-allowed'
            }`}
          >
            CALCULATE
          </button>
        </div>
      </div>

      {/* ═══════════════ SECTION 2 — RESULTS GRID ═══════════════ */}
      {results && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
          {/* ── Left: Premium Breakdown ── */}
          <div className="card p-5">
            <h2 className="text-sm font-medium text-[#8b949e] uppercase tracking-wider mb-4">Premium Breakdown</h2>

            {/* Fair Premium */}
            <div className="flex items-center gap-2 mb-4">
              {isFresh && (
                <span className="pulse-dot w-2.5 h-2.5 rounded-full bg-[#58a6ff] shrink-0" />
              )}
              <div>
                <span className="text-xs text-[#8b949e]">Fair Premium</span>
                <div className="text-4xl md:text-5xl font-bold text-[#58a6ff] font-mono tracking-tight">
                  {fmt(results.premium)}
                </div>
              </div>
            </div>

            {/* Intrinsic + Time Value pills */}
            <div className="flex flex-wrap gap-2 mb-4">
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-[#3fb95015] text-[#3fb950] border border-[#3fb95030]">
                Intrinsic Value: {fmt(results.intrinsicValue)}
              </span>
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-[#e3b34115] text-[#e3b341] border border-[#e3b34130]">
                Time Value: {fmt(results.timeValue)}
              </span>
            </div>

            {/* Moneyness badge */}
            <div className="mb-4">
              <span
                className="inline-flex items-center px-3 py-1 rounded-lg text-xs font-bold"
                style={{
                  backgroundColor: moneynessColor + '15',
                  color: moneynessColor,
                  border: `1px solid ${moneynessColor}40`,
                }}
              >
                {results.moneyness === 'ITM' && '● In The Money'}
                {results.moneyness === 'ATM' && '◉ At The Money'}
                {results.moneyness === 'OTM' && '○ Out of The Money'}
              </span>
            </div>

            {/* Trading days progress */}
            <div className="mb-4">
              <div className="flex justify-between text-xs text-[#8b949e] mb-1">
                <span>Calendar Days Remaining</span>
                <span className="font-mono">{calendarDays} cal / {tradingDays} trd</span>
              </div>
              <div className="w-full h-2 bg-[#0d1117] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#58a6ff] to-[#3fb950] transition-all duration-500"
                  style={{
                    width: `${Math.max(5, Math.min(100, (calendarDays / Math.max(calendarDays + 7, 28)) * 100))}%`,
                  }}
                />
              </div>
            </div>

            {/* OI input */}
            <div>
              <label className="block text-xs text-[#8b949e] mb-1">Open Interest</label>
              <input
                id="input-oi"
                type="text"
                value={openInterest}
                onChange={(e) => setOpenInterest(e.target.value)}
                placeholder="e.g. 12,50,000"
              />
              <span className="text-[10px] text-[#8b949e] mt-0.5 block italic">
                Used for context only (OI does not affect BSM pricing)
              </span>
            </div>
          </div>

          {/* ── Right: Greeks ── */}
          <GreeksDashboard greeks={results} S={spotPrice} optionType={optionType} />
        </div>
      )}

      {/* ═══════════════ SECTION 3 — SCENARIO SIMULATOR ═══════════════ */}
      {results && calcParams && (
        <div className="mb-5">
          <ScenarioSimulator
            S={calcParams.S}
            K={calcParams.K}
            calendarDays={calcParams.calendarDays}
            r={calcParams.r}
            sigma={calcParams.sigma}
            optionType={calcParams.optionType}
            currentPremium={results.premium}
            q={calcParams.q}
          />
        </div>
      )}

      {/* ── Footer Disclaimer ── */}
      <footer className="text-center py-6 border-t border-[#30363d]">
        <p className="text-xs text-[#8b949e] max-w-2xl mx-auto leading-relaxed">
          This tool uses the Black-Scholes-Merton model (with continuous dividend yield) for
          indicative purposes only. BSM assumes constant volatility and log-normal returns.
          Real market premiums may differ due to volatility skew, liquidity, and discrete events. Not financial advice.
        </p>
      </footer>
    </div>
  );
}
