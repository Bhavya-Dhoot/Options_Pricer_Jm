import React, { useState, useEffect } from 'react';
import { Calculator, Clock, BarChart2 } from 'lucide-react';
import OptionsPricer from './OptionsPricer.jsx';
import ThetaDecaySimulator from './ThetaDecaySimulator.jsx';
import OptionsStrategies from './OptionsStrategies.jsx';
import LiveStrategyBuilder from './LiveStrategyBuilder.jsx';
import { useLiveData } from './useLiveData.js';

const TABS = [
  { id: 'pricer', label: 'Options Pricer', icon: Calculator },
  { id: 'theta',  label: 'Theta Decay',   icon: Clock },
  { id: 'live_strategy', label: 'Strategy Builder', icon: BarChart2 },
  { id: 'strategies', label: 'Options Strategies', icon: BarChart2 },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('pricer');
  const live = useLiveData();
  const riskFreeRate = 6.5;

  // Auto-fetch in background to hydrate liveData if available
  useEffect(() => {
    live.fetchNow('NIFTY', { force: false }).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-[#0d1117]">
      {/* ── Tab Bar ── */}
      <div className="tab-bar">
        <div className="max-w-7xl mx-auto px-4 md:px-6 flex items-center gap-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`tab-item ${isActive ? 'active' : ''}`}
              >
                <Icon size={15} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab Panels ── */}
      {/* Both are always mounted to preserve state; hidden with CSS */}
      <div style={{ display: activeTab === 'pricer' ? 'block' : 'none' }}>
        <OptionsPricer />
      </div>
      <div style={{ display: activeTab === 'theta' ? 'block' : 'none' }}>
        <ThetaDecaySimulator />
      </div>
      <div style={{ display: activeTab === 'live_strategy' ? 'block' : 'none' }}>
        <LiveStrategyBuilder live={live} />
      </div>
      <div style={{ display: activeTab === 'strategies' ? 'block' : 'none' }}>
        <OptionsStrategies 
          liveSpot={live.data?.spot ?? 24500}
          liveIV={live.data?.iv ?? 0.15}
          riskFreeRate={riskFreeRate}
        />
      </div>
    </div>
  );
}
