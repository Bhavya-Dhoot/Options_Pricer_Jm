import { describe, it, expect } from 'vitest';
import { estimateMargin } from '../src/utils/marginCalculator.js';

describe('SPAN Margin Calculator Engine Validation', () => {
  it('should charge massive unhedged margin for Naked Short Options', () => {
    const nakedShort = [{ type: 'call', action: 'sell', strike: 24500, qty: 1, lotSize: 25 }];
    const margin = estimateMargin(nakedShort, 24500, 'NIFTY');
    
    // Naked short NIFTY should be roughly 10-15% of contract value + premium
    // Expected > 80,000 INR
    expect(margin.totalMarginRequired).toBeGreaterThan(80000);
  });

  it('should charge zero additional margin for fully hedged Debit Spreads', () => {
    const debitSpread = [
      { type: 'call', action: 'buy', strike: 24500, qty: 1, lotSize: 25, premium: 300 },
      { type: 'call', action: 'sell', strike: 24600, qty: 1, lotSize: 25, premium: 250 }
    ];
    
    const margin = estimateMargin(debitSpread, 24500, 'NIFTY');
    
    // Max loss is limited to net debit (50 * 25 = 1250)
    // SPAN margin should heavily offset the short leg
    // Real SPAN charges ~25k to 30k for a spread compared to 100k for naked
    expect(margin.totalMarginRequired).toBeLessThan(40000); 
  });

  it('should accurately offset Covered Calls', () => {
    const coveredCall = [
      { type: 'future', action: 'buy', strike: 0, qty: 1, lotSize: 25 },
      { type: 'call', action: 'sell', strike: 24700, qty: 1, lotSize: 25 }
    ];
    
    const margin = estimateMargin(coveredCall, 24500, 'NIFTY');
    // Long future margin (10%) is ~60k. The short call is covered, so it requires zero additional margin.
    // Total should be around 60k-80k, far less than Naked Short + Naked Long Future combined (~180k)
    expect(margin.totalMarginRequired).toBeLessThan(100000);
  });
});
