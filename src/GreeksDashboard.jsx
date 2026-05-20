import React, { useState } from 'react';
import { Info, ChevronDown, ChevronUp } from 'lucide-react';

const GREEKS_CONFIG = [
  { symbol: 'Δ', name: 'Delta', key: 'delta', color: '#58a6ff', maxAbs: 1, tooltip: 'Rate of change of option price per ₹1 move in the underlying.' },
  { symbol: 'Γ', name: 'Gamma', key: 'gamma', color: '#a371f7', maxAbs: 0.05, tooltip: 'Rate of change of Delta per ₹1 move in the underlying.' },
  { symbol: 'Θ', name: 'Theta', key: 'theta', color: '#e3b341', maxAbs: 50, tooltip: 'Daily time decay — how much premium the option loses per day.' },
  { symbol: 'ν', name: 'Vega', key: 'vega', color: '#39d0d8', maxAbs: 50, tooltip: 'Sensitivity to a 1% change in implied volatility.' },
  { symbol: 'ρ', name: 'Rho', key: 'rho', color: '#8b949e', maxAbs: 50, tooltip: 'Sensitivity to a 1% change in the risk-free interest rate.' },
];

function GreekRow({ config, value }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const absVal = Math.abs(value);
  const barWidth = Math.min((absVal / config.maxAbs) * 100, 100);

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-[#30363d]/50 last:border-b-0">
      {/* Symbol */}
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center text-lg font-bold shrink-0"
        style={{ backgroundColor: config.color + '18', color: config.color }}
      >
        {config.symbol}
      </div>

      {/* Name + tooltip */}
      <div
        className="tooltip-container flex-1 min-w-0"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <span className="text-sm text-[#e6edf3] cursor-help">{config.name}</span>
        {showTooltip && (
          <div className="tooltip-content max-w-[260px] whitespace-normal">{config.tooltip}</div>
        )}
      </div>

      {/* Bar */}
      <div className="w-20 h-1.5 bg-[#0d1117] rounded-full overflow-hidden shrink-0">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${barWidth}%`, backgroundColor: config.color }}
        />
      </div>

      {/* Value */}
      <span className="font-mono text-sm text-right w-20 shrink-0 tabular-nums" style={{ color: config.color }}>
        {value >= 0 ? '+' : ''}{value.toFixed(4)}
      </span>
    </div>
  );
}

export default function GreeksDashboard({ greeks, S, optionType }) {
  const [showExplain, setShowExplain] = useState(false);

  if (!greeks) return null;

  const explanations = [
    {
      greek: 'Delta',
      text: `Your Delta of ${greeks.delta.toFixed(4)} means for every ₹1 the index moves ${optionType === 'CALL' ? 'up' : 'down'}, your option ${greeks.delta > 0 ? 'gains' : 'loses'} approximately ₹${Math.abs(greeks.delta).toFixed(2)}.`,
    },
    {
      greek: 'Gamma',
      text: `Your Gamma of ${greeks.gamma.toFixed(4)} means Delta itself changes by ~${greeks.gamma.toFixed(4)} for every ₹1 move. Higher Gamma = more convexity.`,
    },
    {
      greek: 'Theta',
      text: `Your Theta of ${greeks.theta.toFixed(2)} means this option loses approximately ₹${Math.abs(greeks.theta).toFixed(2)} every calendar day due to time decay alone.`,
    },
    {
      greek: 'Vega',
      text: `Your Vega of ${greeks.vega.toFixed(2)} means a 1% rise in implied volatility would increase the premium by approximately ₹${greeks.vega.toFixed(2)}.`,
    },
    {
      greek: 'Rho',
      text: `Your Rho of ${greeks.rho.toFixed(4)} means a 1% rise in interest rates would ${greeks.rho > 0 ? 'increase' : 'decrease'} the premium by approximately ₹${Math.abs(greeks.rho).toFixed(2)}.`,
    },
  ];

  return (
    <div className="card p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-lg font-semibold text-[#e6edf3]">Option Greeks</h2>
        <div className="tooltip-container">
          <Info size={15} className="text-[#8b949e] cursor-help" />
          <div className="tooltip-content">Sensitivities of option premium to various parameters</div>
        </div>
      </div>

      {/* Greeks rows */}
      <div>
        {GREEKS_CONFIG.map((cfg) => (
          <GreekRow key={cfg.key} config={cfg} value={greeks[cfg.key]} />
        ))}
      </div>

      {/* Explain toggle */}
      <button
        onClick={() => setShowExplain(!showExplain)}
        className="mt-4 flex items-center gap-1.5 text-sm text-[#58a6ff] hover:text-[#79b8ff] transition-colors cursor-pointer"
      >
        {showExplain ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {showExplain ? 'Hide' : 'Explain'} Greeks in context
      </button>

      {showExplain && (
        <div className="mt-3 space-y-2 p-3 rounded-lg bg-[#0d1117] border border-[#30363d]">
          {explanations.map((e) => (
            <p key={e.greek} className="text-xs text-[#8b949e] leading-relaxed">
              <span className="text-[#e6edf3] font-medium">{e.greek}:</span> {e.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
