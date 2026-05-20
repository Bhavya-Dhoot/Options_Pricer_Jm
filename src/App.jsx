import React, { useState } from 'react';
import { Calculator, Clock } from 'lucide-react';
import OptionsPricer from './OptionsPricer.jsx';
import ThetaDecaySimulator from './ThetaDecaySimulator.jsx';

const TABS = [
  { id: 'pricer', label: 'Options Pricer', icon: Calculator },
  { id: 'theta',  label: 'Theta Decay',   icon: Clock },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('pricer');

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
    </div>
  );
}
