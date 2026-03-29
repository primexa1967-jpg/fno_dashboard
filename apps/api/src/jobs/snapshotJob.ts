/**
 * Background Job: Store option chain snapshots every minute
 * 
 * This job runs during market hours (9:15 AM - 3:30 PM IST) and stores
 * option chain snapshots to Redis for interval-based calculations.
 */

import { getDhanStream } from '../services/dhanClient';
import { optionSnapshotService } from '../services/optionSnapshotService';
import { OptionChain, OptionChainRow } from '@option-dashboard/shared';

// Active symbols to track
const TRACKED_SYMBOLS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY'];

// Weekly expiries for each symbol (updated dynamically)
const expiryMap: { [key: string]: string } = {};

// Market hours (IST): 9:15 AM - 3:30 PM
function isMarketHours(): boolean {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
  const istTime = new Date(now.getTime() + istOffset);
  
  const hour = istTime.getUTCHours();
  const minute = istTime.getUTCMinutes();
  const dayOfWeek = istTime.getUTCDay(); // 0 = Sunday, 6 = Saturday
  
  // Market closed on weekends
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }
  
  // Market hours: 9:15 AM - 3:30 PM
  const currentTimeInMinutes = hour * 60 + minute;
  const marketOpen = 9 * 60 + 15;  // 9:15 AM
  const marketClose = 15 * 60 + 30; // 3:30 PM
  
  return currentTimeInMinutes >= marketOpen && currentTimeInMinutes <= marketClose;
}

/**
 * Store snapshots for all tracked symbols
 */
async function storeSnapshots() {
  if (!isMarketHours()) {
    console.log('⏸️ Market closed - skipping snapshot storage');
    return;
  }
  
  console.log('📸 Starting snapshot storage job...');
  
  const dhanClient = getDhanStream();
  
  for (const symbol of TRACKED_SYMBOLS) {
    try {
      // Get current expiry for this symbol (or use weekly)
      const expiry = expiryMap[symbol] || await getNextExpiry(symbol);
      expiryMap[symbol] = expiry;
      
      console.log(`📸 Fetching option chain for ${symbol}/${expiry}`);
      
      // Fetch current option chain data
      const [spotPrice, optionChainData] = await Promise.all([
        dhanClient.getSpotPrice(symbol),
        dhanClient.getOptionChain(symbol, expiry)
      ]);
      
      // Transform to our format (simplified - reusing logic from optionChain.ts)
      const rows = transformOptionChainData(optionChainData, spotPrice);
      
      if (rows.length === 0) {
        console.warn(`⚠️ No option chain data for ${symbol}/${expiry}`);
        continue;
      }
      
      // Create option chain object
      const optionChain: OptionChain = {
        index: symbol.toLowerCase() as any,
        spot: spotPrice,
        expiry: expiry,
        rows: rows,
        timestamp: new Date().toISOString(),
      };
      
      // Store snapshot (pass spot price as 4th argument)
      await optionSnapshotService.storeSnapshot(symbol, expiry, optionChain, spotPrice);
      console.log(`✅ Stored snapshot for ${symbol}/${expiry} - ${rows.length} strikes`);
      
    } catch (error) {
      console.error(`❌ Failed to store snapshot for ${symbol}:`, error);
    }
  }
  
  console.log('✅ Snapshot storage job completed');
}

/**
 * Transform Dhan API response to OptionChainRow[]
 */
function transformOptionChainData(optionChainData: any, spotPrice: number): OptionChainRow[] {
  const rows: OptionChainRow[] = [];
  
  // Handle different response structures
  let optionData: any = null;
  if (optionChainData.data?.oc) {
    optionData = optionChainData.data.oc;
  } else if (optionChainData.data?.option_data) {
    optionData = optionChainData.data.option_data;
  } else if (optionChainData.option_data) {
    optionData = optionChainData.option_data;
  } else if (optionChainData.oc) {
    optionData = optionChainData.oc;
  }
  
  if (!optionData) {
    return rows;
  }
  
  // Convert strikes to numbers and sort
  const strikes = Object.keys(optionData)
    .map(strike => parseFloat(strike))
    .sort((a, b) => a - b);
  
  strikes.forEach((strike) => {
    const strikeKey = strike.toFixed(6);
    const strikeData = optionData[strikeKey];
    
    if (!strikeData || !strikeData.ce || !strikeData.pe) {
      return;
    }
    
    const ce = strikeData.ce;
    const pe = strikeData.pe;
    
    rows.push({
      strike,
      pcr: pe.oi > 0 && ce.oi > 0 ? pe.oi / ce.oi : 0,
      ce: {
        strike: strike,
        oi: ce.oi || 0,
        oiChg: (ce.oi || 0) - (ce.previous_oi || 0),
        oiChgPercent: (ce.previous_oi || 0) > 0 ? (((ce.oi || 0) - (ce.previous_oi || 0)) / (ce.previous_oi || 1)) * 100 : 0,
        volume: ce.volume || 0,
        iv: ce.implied_volatility || 0,
        ltp: ce.last_price || 0,
        ltpChg: (ce.last_price || 0) - (ce.previous_close_price || 0),
        ltpChgPercent: (ce.previous_close_price || 0) > 0 ? (((ce.last_price || 0) - (ce.previous_close_price || 0)) / (ce.previous_close_price || 1)) * 100 : 0,
        tvItm: 0,
        delta: ce.greeks?.delta || 0,
        gamma: ce.greeks?.gamma || 0,
        vega: ce.greeks?.vega || 0,
        theta: ce.greeks?.theta || 0,
        chg: (ce.last_price || 0) - (ce.previous_close_price || 0),
        bid: ce.top_bid_price || 0,
        ask: ce.top_ask_price || 0,
        builtUp: null,
      },
      pe: {
        strike: strike,
        oi: pe.oi || 0,
        oiChg: (pe.oi || 0) - (pe.previous_oi || 0),
        oiChgPercent: (pe.previous_oi || 0) > 0 ? (((pe.oi || 0) - (pe.previous_oi || 0)) / (pe.previous_oi || 1)) * 100 : 0,
        volume: pe.volume || 0,
        iv: pe.implied_volatility || 0,
        ltp: pe.last_price || 0,
        ltpChg: (pe.last_price || 0) - (pe.previous_close_price || 0),
        ltpChgPercent: (pe.previous_close_price || 0) > 0 ? (((pe.last_price || 0) - (pe.previous_close_price || 0)) / (pe.previous_close_price || 1)) * 100 : 0,
        tvItm: 0,
        delta: pe.greeks?.delta || 0,
        gamma: pe.greeks?.gamma || 0,
        vega: pe.greeks?.vega || 0,
        theta: pe.greeks?.theta || 0,
        chg: (pe.last_price || 0) - (pe.previous_close_price || 0),
        bid: pe.top_bid_price || 0,
        ask: pe.top_ask_price || 0,
        builtUp: null,
      },
      isSpotStrike: Math.abs(strike - spotPrice) < 50,
    });
  });
  
  return rows;
}

/**
 * Find ATM strike (closest to spot)
 */
function findATMStrike(rows: OptionChainRow[], spotPrice: number): number {
  return rows.reduce((closest, row) => {
    const currentDiff = Math.abs(row.strike - spotPrice);
    const closestDiff = Math.abs(closest - spotPrice);
    return currentDiff < closestDiff ? row.strike : closest;
  }, rows[0]?.strike || spotPrice);
}

/**
 * Calculate overall PCR
 */
function calculateOverallPCR(rows: OptionChainRow[]): number {
  let totalCEOI = 0;
  let totalPEOI = 0;
  
  rows.forEach(row => {
    totalCEOI += row.ce.oi;
    totalPEOI += row.pe.oi;
  });
  
  return totalCEOI > 0 ? totalPEOI / totalCEOI : 0;
}

/**
 * Get next weekly expiry for a symbol
 */
async function getNextExpiry(symbol: string): Promise<string> {
  // For now, return next Thursday (weekly expiry)
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysUntilThursday = (4 - dayOfWeek + 7) % 7 || 7;
  const nextThursday = new Date(today);
  nextThursday.setDate(today.getDate() + daysUntilThursday);
  return nextThursday.toISOString().split('T')[0];
}

/**
 * Start the snapshot job (runs every minute)
 */
export function startSnapshotJob() {
  console.log('🚀 Starting snapshot job (runs every 60 seconds during market hours)');
  
  // Run immediately
  storeSnapshots().catch(err => {
    console.error('Failed to run snapshot job:', err);
  });
  
  // Then run every minute
  const intervalId = setInterval(() => {
    storeSnapshots().catch(err => {
      console.error('Failed to run snapshot job:', err);
    });
  }, 60 * 1000); // 60 seconds
  
  return intervalId;
}

/**
 * Stop the snapshot job
 */
export function stopSnapshotJob(intervalId: NodeJS.Timeout) {
  clearInterval(intervalId);
  console.log('⏹️ Stopped snapshot job');
}
