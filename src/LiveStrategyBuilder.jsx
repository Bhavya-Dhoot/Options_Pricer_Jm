import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw, Play, Settings, AlertTriangle, TrendingUp, Save, FolderOpen, BarChart2, Clock } from 'lucide-react';
import LiveFetchBar from './components/LiveFetchBar.jsx';
import LiveLegConfigurator from './components/strategies/LiveLegConfigurator.jsx';
import PayoffChart from './components/strategies/PayoffChart.jsx';
import StrategyMetricsBar from './components/strategies/StrategyMetricsBar.jsx';
import ProbabilityPanel from './components/strategies/ProbabilityPanel.jsx';
import ThetaDecayChart from './components/strategies/ThetaDecayChart.jsx';
import GreeksSurfaceChart from './components/strategies/GreeksSurfaceChart.jsx';
import ScenarioHeatmap from './components/strategies/ScenarioHeatmap.jsx';
import { estimateMargin } from './utils/marginCalculator.js';
import { useAvailableExpiries } from './useLiveData.js';
import { AlertCircle } from 'lucide-react';
import StrategyTemplates from './components/strategies/StrategyTemplates.jsx';

import { useLiveStrategy } from './hooks/useLiveStrategy.js';

export default function LiveStrategyBuilder({ live, riskFreeRate = 6.5, isPaperTradeMode = false, onTradeExecuted, injectedLegs }) {
  const {
    legs, debouncedLegs,
    targetExpiry, setTargetExpiry, targetFutExpiry, setTargetFutExpiry,
    isBacktestMode, setIsBacktestMode, backtestTimestamps, selectedTimestamp, setSelectedTimestamp,
    optExpiries, futExpiries, isExpiriesLoading,
    showSaveModal, setShowSaveModal, saveName, setSaveName, saveDesc, setSaveDesc,
    savedStrategies, showLoadModal, setShowLoadModal,
    globalInputs, debouncedGlobalInputs,
    handleFetch, handleExpiryChange, handleFutExpiryChange,
    availableStrikes, addLeg, updateLeg, removeLeg, handlePaperTrade, handleSaveStrategy, loadStrategy,
    estimatedMargin
  } = useLiveStrategy({ live, riskFreeRate, onTradeExecuted, injectedLegs });

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 pb-24 space-y-6">
      
      {/* Top Bar: Controls */}
      <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
        <LiveFetchBar onFetch={handleFetch} isLoading={live.isLoading} error={live.error} />
        
        <div className="flex gap-4 flex-wrap">
          <div className="flex flex-col gap-2 min-w-[160px] bg-[#161b22] border border-[#30363d] p-2 rounded-xl">
            <label className="flex items-center gap-2 cursor-pointer">
              <input 
                type="checkbox" 
                checked={isBacktestMode} 
                onChange={(e) => {
                  setIsBacktestMode(e.target.checked);
                  if (!e.target.checked) live.fetchNow(live.data?.symbol || 'NIFTY', { force: true });
                }} 
                className="rounded bg-[#0d1117] border-[#30363d] text-blue-500 focus:ring-blue-500" 
              />
              <span className="text-[10px] text-[#58a6ff] uppercase font-bold tracking-wider flex items-center gap-1">
                <Clock size={12} /> Backtest Engine
              </span>
            </label>
            {isBacktestMode && (
              <select 
                value={selectedTimestamp}
                onChange={(e) => setSelectedTimestamp(e.target.value)}
                className="bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-sm rounded-lg px-2 py-1 outline-none"
              >
                <option value="" disabled>Select Time...</option>
                {backtestTimestamps.map(ts => (
                  <option key={ts} value={ts}>{new Date(ts).toLocaleTimeString()}</option>
                ))}
              </select>
            )}
          </div>

          <div className="flex flex-col gap-2 min-w-[160px]">
            <label className="text-[10px] text-[#8b949e] uppercase font-bold tracking-wider">Target Options Expiry</label>
            <select 
              value={targetExpiry}
              onChange={handleExpiryChange}
              disabled={isExpiriesLoading}
              className="bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#58a6ff] focus:border-transparent outline-none"
            >
              {isExpiriesLoading ? (
                <option value="">Loading...</option>
              ) : optExpiries.length > 0 ? (
                optExpiries.map(exp => (
                  <option key={exp} value={exp}>{exp}</option>
                ))
              ) : (
                <option value="">No options expiries</option>
              )}
            </select>
          </div>

          <div className="flex flex-col gap-2 min-w-[160px]">
            <label className="text-[10px] text-purple-400 uppercase font-bold tracking-wider">Target Futures Expiry</label>
            <select 
              value={targetFutExpiry}
              onChange={handleFutExpiryChange}
              disabled={isExpiriesLoading}
              className="bg-[#0d1117] border border-[#30363d] text-[#e6edf3] text-sm rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none"
            >
              {isExpiriesLoading ? (
                <option value="">Loading...</option>
              ) : futExpiries.length > 0 ? (
                futExpiries.map(exp => (
                  <option key={exp} value={exp}>{exp}</option>
                ))
              ) : (
                <option value="">No futures expiries</option>
              )}
            </select>
          </div>
        </div>
      </div>

      {/* Pre-made Strategies (Templates) */}
      {isPaperTradeMode && (
        <StrategyTemplates 
          spotPrice={live.data?.spot} 
          symbol={live.data?.symbol}
          onApply={(newLegs) => {
            setLegs(prev => {
              return newLegs.map((l, idx) => ({
                ...l,
                id: `tpl-${Date.now()}-${idx}`,
                qty: 1,
                lotSize: getLotSize(live.data?.symbol, live.data?.lotSize),
                T: calculateDTE(targetExpiry || live.data?.expiryDates?.[0]) / 365,
                expiry: targetExpiry || live.data?.expiryDates?.[0],
                premium: 0
              }));
            });
          }} 
        />
      )}

      {/* Full Width Layout */}
      <div className="space-y-6">
        
        {/* Legs Configurator */}
        <div className="card p-4">
          <LiveLegConfigurator 
            legs={legs}
            expiryDates={live.data?.expiryDates || []}
            futExpiryDates={futExpiries || []}
            byExpiry={live.data?.byExpiry || {}}
            onUpdateLeg={updateLeg}
            onAddLeg={addLeg}
            onRemoveLeg={removeLeg}
            futurePrice={live.data?.futurePrice}
            fetchExpiry={(exp, isFut) => {
              if (isFut) {
                live.fetchNow(live.data.symbol, { force: false, expiry: targetExpiry, futExpiry: exp });
              } else {
                live.fetchNow(live.data.symbol, { force: false, expiry: exp, futExpiry: targetFutExpiry });
              }
            }}
          />
        </div>

        {/* Action Buttons & Metrics Bar */}
        <div className="flex flex-col lg:flex-row gap-4 items-center">
          <div className="flex-1 w-full">
            <StrategyMetricsBar legs={legs} globalInputs={globalInputs} marginRequired={estimatedMargin} />
          </div>
          {isPaperTradeMode && (
            <div className="flex gap-2 w-full lg:w-auto mt-4 lg:mt-0">
              <button 
                onClick={() => setShowLoadModal(true)}
                className="flex-1 lg:flex-none px-4 py-4 bg-[#1f2937] hover:bg-[#374151] text-[#e6edf3] font-bold rounded-xl border border-[#30363d] transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <FolderOpen size={18} /> Load
              </button>
              <button 
                onClick={() => setShowSaveModal(true)}
                className="flex-1 lg:flex-none px-4 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <Save size={18} /> Save
              </button>
              <button 
                onClick={handlePaperTrade}
                className="flex-1 lg:flex-none px-4 py-4 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl shadow-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <BarChart2 size={18} /> Execute
              </button>
            </div>
          )}
        </div>

        {/* Detailed Margin Breakdown */}
        {estimatedMargin?.totalMarginRequired > 0 && (
          <div className="card p-4 space-y-4">
            <div className="flex items-center gap-2 border-b border-[#30363d] pb-2">
              <AlertCircle size={16} className="text-[#e3b341]" />
              <h3 className="text-sm font-semibold text-[#e6edf3]">Margin Requirements</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-xs text-[#8b949e]">
              {/* Column 1 */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span>Span Margin:</span>
                  <span className="font-mono text-[#e6edf3] bg-[#0d1117] border border-[#30363d] px-2 py-1 rounded min-w-[100px] text-right">
                    {estimatedMargin.spanMargin.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span>Additional Margin:</span>
                  <span className="font-mono text-[#e6edf3] bg-[#0d1117] border border-[#30363d] px-2 py-1 rounded min-w-[100px] text-right">
                    {estimatedMargin.additionalMargin.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span>Pre Expiry Margin:</span>
                  <span className="font-mono text-[#e6edf3] bg-[#0d1117] border border-[#30363d] px-2 py-1 rounded min-w-[100px] text-right">
                    {estimatedMargin.preExpiryMargin.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Column 2 */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span>Exposure Margin:</span>
                  <span className="font-mono text-[#e6edf3] bg-[#0d1117] border border-[#30363d] px-2 py-1 rounded min-w-[100px] text-right">
                    {estimatedMargin.exposureMargin.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span>Special Margin:</span>
                  <span className="font-mono text-[#e6edf3] bg-[#0d1117] border border-[#30363d] px-2 py-1 rounded min-w-[100px] text-right">
                    {estimatedMargin.specialMargin.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span>Tender Margin:</span>
                  <span className="font-mono text-[#e6edf3] bg-[#0d1117] border border-[#30363d] px-2 py-1 rounded min-w-[100px] text-right">
                    {estimatedMargin.tenderMargin.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Column 3 */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span>Exposure Spread Benefit:</span>
                  <span className="font-mono text-[#e6edf3] bg-[#0d1117] border border-[#30363d] px-2 py-1 rounded min-w-[100px] text-right">
                    {estimatedMargin.exposureSpreadBenefit.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span>Delivery Margin:</span>
                  <span className="font-mono text-[#e6edf3] bg-[#0d1117] border border-[#30363d] px-2 py-1 rounded min-w-[100px] text-right">
                    {estimatedMargin.deliveryMargin.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between items-center font-bold text-[#e6edf3] mt-2 pt-2 border-t border-[#30363d]/50">
                  <span>Total Margin Required:</span>
                  <span className="font-mono text-[#58a6ff] bg-[#58a6ff]/10 border border-[#58a6ff]/30 px-2 py-1 rounded min-w-[100px] text-right">
                    {estimatedMargin.totalMarginRequired.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
            
            <p className="text-[10px] text-[#8b949e] italic mt-4">
              *This is an estimated rule-based approximation for strategy building purposes. Actual broker margins will vary based on live volatility parameters and exchange SPAN files.
            </p>
          </div>
        )}

        {/* Payoff Chart */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#e6edf3]">Payoff Diagram (Live Data)</h3>
          </div>
          {legs.length > 0 ? (
            <PayoffChart 
              legs={legs} 
              globalInputs={globalInputs}
              spotRangePercent={15} 
            />
          ) : (
            <div className="h-[300px] flex items-center justify-center text-[#8b949e] border border-dashed border-[#30363d] rounded">
              Add legs to see payoff chart
            </div>
          )}
        </div>

        {/* Probabilities and Theta */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card p-4">
            <ProbabilityPanel legs={legs} globalInputs={globalInputs} />
          </div>
          <div className="card p-4">
            <ThetaDecayChart legs={legs} globalInputs={globalInputs} />
          </div>
        </div>

        {/* Greeks Surface */}
        <div className="card p-4">
          <GreeksSurfaceChart legs={debouncedLegs} globalInputs={debouncedGlobalInputs} spotRangePercent={15} />
        </div>

        {/* Scenario Heatmap */}
        <div className="card p-4">
          <ScenarioHeatmap legs={debouncedLegs} globalInputs={debouncedGlobalInputs} />
        </div>

      </div>

      {/* Save Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#161b22] border border-[#30363d] p-6 rounded-xl w-[400px]">
            <h3 className="text-xl font-bold text-white mb-4">Save Strategy</h3>
            <input 
              className="w-full bg-[#0d1117] border border-[#30363d] text-white p-2 rounded mb-3" 
              placeholder="Strategy Name (e.g. Iron Condor)" 
              value={saveName} onChange={e => setSaveName(e.target.value)} 
            />
            <textarea 
              className="w-full bg-[#0d1117] border border-[#30363d] text-white p-2 rounded mb-4 text-sm" 
              placeholder="Description / Tags" 
              rows={3}
              value={saveDesc} onChange={e => setSaveDesc(e.target.value)} 
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowSaveModal(false)} className="px-4 py-2 bg-gray-600 rounded text-white">Cancel</button>
              <button onClick={handleSaveStrategy} className="px-4 py-2 bg-blue-600 rounded text-white">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Load Modal */}
      {showLoadModal && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#161b22] border border-[#30363d] p-6 rounded-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-white">Load Strategy Template</h3>
              <button onClick={() => setShowLoadModal(false)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            {savedStrategies.length === 0 ? (
              <p className="text-gray-400">No saved strategies found.</p>
            ) : (
              <div className="space-y-3">
                {savedStrategies.map(strat => (
                  <div key={strat._id} className="p-4 border border-[#30363d] bg-[#0d1117] rounded hover:border-blue-500 cursor-pointer flex justify-between items-center" onClick={() => loadStrategy(strat)}>
                    <div>
                      <div className="font-bold text-blue-400">{strat.name}</div>
                      <div className="text-xs text-gray-400 mt-1">{strat.description}</div>
                    </div>
                    <div className="text-xs text-gray-500">{new Date(strat.createdAt).toLocaleDateString()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
