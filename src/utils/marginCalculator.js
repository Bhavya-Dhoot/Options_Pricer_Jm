/**
 * marginCalculator.js
 * 
 * Provides rule-based margin estimation for Options and Futures strategies.
 * Note: Actual margin is calculated by the broker using SPAN + Exposure. 
 * This is an approximation for UI planning purposes.
 */

export const getLotSize = (symbol) => {
  if (symbol === 'NIFTY') return 25;
  if (symbol === 'BANKNIFTY') return 15;
  if (symbol === 'FINNIFTY') return 40;
  if (symbol === 'MIDCPNIFTY') return 75;
  if (symbol === 'SENSEX') return 10;
  if (symbol === 'BANKEX') return 15;
  return 1;
};

export function estimateMargin(legs, spotPrice, symbol = 'NIFTY') {
  const zeroMargin = {
    spanMargin: 0,
    exposureMargin: 0,
    additionalMargin: 0,
    preExpiryMargin: 0,
    exposureSpreadBenefit: 0,
    specialMargin: 0,
    tenderMargin: 0,
    deliveryMargin: 0,
    totalMarginRequired: 0
  };

  if (!legs || legs.length === 0 || !spotPrice) return zeroMargin;
  
  const lotSize = legs[0]?.lotSize || getLotSize(symbol);
  
  let totalMargin = 0;
  
  // Naked margin percentages (approximate for indices)
  const NAKED_SHORT_OPT_PERCENT = 0.15; // 15% of contract value
  const FUTURE_MARGIN_PERCENT = 0.12;   // 12% of contract value
  
  // Separate legs by type and action
  const longCalls = legs.filter(l => l.type === 'call' && l.action === 'buy');
  const shortCalls = legs.filter(l => l.type === 'call' && l.action === 'sell');
  const longPuts = legs.filter(l => l.type === 'put' && l.action === 'buy');
  const shortPuts = legs.filter(l => l.type === 'put' && l.action === 'sell');
  const futures = legs.filter(l => l.type === 'future');
  
  // 1. Long Options (Premium is paid in cash, NOT held as Margin)
  // We no longer add leg.premium to totalMargin here, because totalMargin
  // represents Span + Exposure, which only apply to Short options and Futures.
  // The net premium is already calculated and displayed separately in the UI.
  
  // 2. Short Options & Hedging (Spreads)
  // We pair short calls with long calls to find spreads and reduce margin.
  const processShorts = (shorts, longs, isCall) => {
    let margin = 0;
    
    // Sort shorts from most ATM to OTM to pair logically
    const sortedShorts = [...shorts].sort((a, b) => isCall ? a.strike - b.strike : b.strike - a.strike);
    const availableLongs = [...longs].sort((a, b) => isCall ? a.strike - b.strike : b.strike - a.strike);
    
    sortedShorts.forEach(shortLeg => {
      let remainingShortQty = shortLeg.qty;
      
      // Try to find a hedge
      for (let i = 0; i < availableLongs.length; i++) {
        const longLeg = availableLongs[i];
        if (longLeg.qty <= 0) continue;
        
        // A valid hedge must protect the risk direction
        const isValidHedge = isCall ? longLeg.strike > shortLeg.strike : longLeg.strike < shortLeg.strike;
        
        if (isValidHedge) {
          const hedgedQty = Math.min(remainingShortQty, longLeg.qty);
          
          // Spread max loss = Width of spread * lotsize * qty
          const width = Math.abs(longLeg.strike - shortLeg.strike);
          const spreadRisk = width * lotSize * hedgedQty;
          
          // Margin for a spread is usually close to Max Loss
          margin += spreadRisk;
          
          remainingShortQty -= hedgedQty;
          longLeg.qty -= hedgedQty; // consume the hedge
          
          if (remainingShortQty === 0) break;
        }
      }
      
      // Any unhedged remaining quantity is a naked short
      if (remainingShortQty > 0) {
        const nakedMargin = spotPrice * lotSize * remainingShortQty * NAKED_SHORT_OPT_PERCENT;
        margin += nakedMargin;
      }
    });
    
    return margin;
  };

  // Deep copy for quantity mutation during hedge matching
  const _longCalls = JSON.parse(JSON.stringify(longCalls));
  const _longPuts = JSON.parse(JSON.stringify(longPuts));
  
  totalMargin += processShorts(shortCalls, _longCalls, true);
  totalMargin += processShorts(shortPuts, _longPuts, false);
  
  // 3. Futures
  futures.forEach(leg => {
    // Basic directional future margin (long or short usually similar)
    const futureMargin = (leg.premium || spotPrice) * lotSize * leg.qty * FUTURE_MARGIN_PERCENT;
    totalMargin += futureMargin;
  });
  
  // Split into SPAN and Exposure (Approximation: 80% SPAN, 20% Exposure)
  const spanMargin = totalMargin * 0.80;
  const exposureMargin = totalMargin * 0.20;
  
  return {
    spanMargin: spanMargin,
    exposureMargin: exposureMargin,
    additionalMargin: 0,
    preExpiryMargin: 0,
    exposureSpreadBenefit: 0,
    specialMargin: 0,
    tenderMargin: 0,
    deliveryMargin: 0,
    totalMarginRequired: totalMargin
  };
}
