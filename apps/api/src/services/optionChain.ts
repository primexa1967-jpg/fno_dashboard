import { OptionChain, OptionChainRow, OptionData, SummaryStats, BuiltUpType } from '@option-dashboard/shared';
import { calculatePCR, classifyBuiltUp, calculateCallGreeks, calculatePutGreeks } from '@option-dashboard/shared';
import { getDhanStream } from './dhanClient';
import { signalEngineService } from './signalEngine';
import { optionSnapshotService } from './optionSnapshotService';
import { computeHighlights } from './gammaHighlightEngine';

/**
 * Standard Normal CDF (Abramowitz & Stegun approximation)
 * Used for Black-Scholes gamma/delta calculation
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + sign * y);
}

// Service-level cache to prevent excessive Dhan API calls
interface CachedData {
  data: OptionChain;
  timestamp: number;
}

const optionChainServiceCache: { [key: string]: CachedData } = {};
const SERVICE_CACHE_TTL_MS = 15000; // 15 seconds - matches frontend polling interval

/**
 * Get option chain for specified index and expiry from Dhan API
 * Uses caching to prevent rate limiting
 * Supports interval-based calculations for Volume, OI Chg, and OI Chg%
 */
export async function getOptionChain(index: string, expiry?: string, interval: string = '1D'): Promise<OptionChain> {
  // Map index to symbol first
  const symbolMap: Record<string, string> = {
    'nifty50': 'NIFTY',
    'nifty': 'NIFTY',
    'banknifty': 'BANKNIFTY',
    'finnifty': 'FINNIFTY',
    'midcapnifty': 'MIDCAPNIFTY',
    'sensex': 'SENSEX',
    'bankex': 'BANKEX'
  };
  
  const symbol = symbolMap[index.toLowerCase()] || 'NIFTY';
  const cacheKey = `${symbol}_${expiry || 'current'}_${interval}`;
  
  // Check service cache first
  const cached = optionChainServiceCache[cacheKey];
  const now = Date.now();
  
  if (cached && (now - cached.timestamp) < SERVICE_CACHE_TTL_MS) {
    console.log(`📦 Using SERVICE cached option chain for ${symbol} (age: ${now - cached.timestamp}ms)`);
    return cached.data;
  }
  
  try {
    console.log(`🔵 getOptionChain called with index=${index}, expiry=${expiry}`);
    const dhanClient = getDhanStream();
    
    console.log(`🔵 Mapped to symbol: ${symbol}`);
    
    // Get spot price and option chain data from Dhan
    const expiryStr = expiry || 'current';
    const [spotPriceRaw, optionChainData] = await Promise.all([
      dhanClient.getSpotPrice(symbol),
      dhanClient.getOptionChain(symbol, expiryStr)
    ]);

    // Use option chain's own last_price as fallback if spot fetch returned 0
    const ocLastPrice = optionChainData?.data?.last_price ?? optionChainData?.last_price ?? 0;
    const spotPrice = spotPriceRaw > 0 ? spotPriceRaw : (ocLastPrice > 0 ? ocLastPrice : 0);
    if (spotPriceRaw === 0 && ocLastPrice > 0) {
      console.log(`🔄 Using option chain last_price as spot fallback for ${symbol}: ₹${ocLastPrice}`);
    }
    
    console.log(`🔵 Fetching option chain for ${index}, expiry: ${expiry}`);
    
    // Transform Dhan API response to our format
    const rows: OptionChainRow[] = [];
    
    // Handle different possible response structures from Dhan API
    let optionData: any = null;
    
    if (optionChainData.data?.oc) {
      // Dhan API v2 structure: { data: { oc: {...}, last_price: ... }, status: "success" }
      optionData = optionChainData.data.oc;
    } else if (optionChainData.data?.option_data) {
      // Alternative structure: { data: { option_data: {...} }, status: "success" }
      optionData = optionChainData.data.option_data;
    } else if (optionChainData.option_data) {
      // Structure: { option_data: {...}, status: "success" }
      optionData = optionChainData.option_data;
    } else if (optionChainData.oc) {
      // Structure: { oc: {...}, status: "success" }
      optionData = optionChainData.oc;
    }
    
    if (!optionData) {
      console.error(`❌ Could not find option chain data in Dhan response`);
      console.error(`Response keys:`, Object.keys(optionChainData));
      if (optionChainData.data) {
        console.error(`data keys:`, Object.keys(optionChainData.data));
      }
    }
    
    if (optionData) {
      // ── Performance: compute time-to-expiry ONCE per cycle (not per strike) ──
      const RISK_FREE_RATE = 0.06;
      let daysToExpiry = 3; // Default fallback
      try {
        const expiryDate = new Date(expiry || '');
        if (!isNaN(expiryDate.getTime())) {
          const now = new Date();
          const diffMs = expiryDate.getTime() - now.getTime();
          daysToExpiry = Math.max(0.5, diffMs / (1000 * 60 * 60 * 24)); // min 0.5 day
        }
      } catch { /* use default */ }
      const T = daysToExpiry / 365;
      const sqrtT = Math.sqrt(T);
      const sqrt2PiT = Math.sqrt(2 * Math.PI * T);

      console.log(`⏱️ Days to expiry: ${daysToExpiry.toFixed(2)}, T=${T.toFixed(6)}`);

      // Convert strike price strings to numbers and sort
      const strikes = Object.keys(optionData)
        .map(strike => parseFloat(strike))
        .sort((a, b) => a - b);
      
      // Log raw Dhan fields from first strike for debugging
      if (strikes.length > 0) {
        const sampleKey = strikes[0].toFixed(6);
        const sample = optionData[sampleKey];
        if (sample?.ce) {
          console.log(`🔍 Raw Dhan CE keys: [${Object.keys(sample.ce).join(', ')}]`);
          console.log(`🔍 Raw Dhan CE volume=${sample.ce.volume}, oi=${sample.ce.oi}, previous_oi=${sample.ce.previous_oi}`);
          console.log(`🔍 Raw Dhan CE greeks:`, JSON.stringify(sample.ce.greeks));
        }
      }

      strikes.forEach((strike) => {
        const strikeKey = strike.toFixed(6);
        const strikeData = optionData[strikeKey];
        
        if (!strikeData) return;
        
        const ce = strikeData.ce;
        const pe = strikeData.pe;
        
        // Skip strikes with no meaningful data
        if (!ce || !pe) return;
        
        // ── Black-Scholes Gamma Calculation ──
        // gamma = exp(-0.5 * d1²) / (S * σ * √(2πT))
        // Must calculate per-strike: gamma ≠ delta, highest at ATM
        const ceIV = (ce.implied_volatility || 10) / 100;   // Convert IV% to decimal
        const peIV = (pe.implied_volatility || 10) / 100;

        // CE Greeks via Black-Scholes
        let ceGamma = 0, ceDelta = 0, ceVega = 0, ceTheta = 0;
        if (ceIV > 0.001 && T > 0) {
          const ceD1 = (Math.log(spotPrice / strike) + (RISK_FREE_RATE + 0.5 * ceIV * ceIV) * T) / (ceIV * sqrtT);
          ceGamma = parseFloat((Math.exp(-0.5 * ceD1 * ceD1) / (spotPrice * ceIV * sqrt2PiT)).toFixed(4));
          // Use Dhan delta if available, else compute from BS
          const nd1 = normalCDF(ceD1);
          ceDelta = ce.greeks?.delta || parseFloat(nd1.toFixed(4));
          ceVega = ce.greeks?.vega || parseFloat((spotPrice * Math.exp(-0.5 * ceD1 * ceD1) / Math.sqrt(2 * Math.PI) * sqrtT / 100).toFixed(4));
          ceTheta = ce.greeks?.theta || 0;
        }

        // PE Greeks via Black-Scholes
        let peGamma = 0, peDelta = 0, peVega = 0, peTheta = 0;
        if (peIV > 0.001 && T > 0) {
          const peD1 = (Math.log(spotPrice / strike) + (RISK_FREE_RATE + 0.5 * peIV * peIV) * T) / (peIV * sqrtT);
          peGamma = parseFloat((Math.exp(-0.5 * peD1 * peD1) / (spotPrice * peIV * sqrt2PiT)).toFixed(4));
          const nd1 = normalCDF(peD1);
          peDelta = pe.greeks?.delta || parseFloat((nd1 - 1).toFixed(4));
          peVega = pe.greeks?.vega || parseFloat((spotPrice * Math.exp(-0.5 * peD1 * peD1) / Math.sqrt(2 * Math.PI) * sqrtT / 100).toFixed(4));
          peTheta = pe.greeks?.theta || 0;
        }

        // ── OI Change with NaN guard ──
        const cePrevOI = ce.previous_oi || 0;
        const pePrevOI = pe.previous_oi || 0;
        const ceOiChg = (ce.oi || 0) - cePrevOI;
        const peOiChg = (pe.oi || 0) - pePrevOI;
        const ceOiChgPct = cePrevOI > 0 ? parseFloat(((ceOiChg / cePrevOI) * 100).toFixed(2)) : 0;
        const peOiChgPct = pePrevOI > 0 ? parseFloat(((peOiChg / pePrevOI) * 100).toFixed(2)) : 0;

        // ── Volume with fallback field names ──
        const ceVolume = ce.volume || ce.traded_volume || ce.total_quantity || 0;
        const peVolume = pe.volume || pe.traded_volume || pe.total_quantity || 0;

        // ── Price change with NaN guard ──
        const cePriceChg = (ce.last_price || 0) - (ce.previous_close_price || 0);
        const pePriceChg = (pe.last_price || 0) - (pe.previous_close_price || 0);

        // Transform CE data
        const ceData: OptionData = {
          strike: strike,
          oi: ce.oi || 0,
          oiChg: ceOiChg,
          oiChgPercent: ceOiChgPct,
          volume: ceVolume,
          iv: ce.implied_volatility || 0,
          ltp: ce.last_price || 0,
          ltpChg: parseFloat(cePriceChg.toFixed(2)),
          ltpChgPercent: (ce.previous_close_price || 0) > 0 ? parseFloat(((cePriceChg / ce.previous_close_price) * 100).toFixed(2)) : 0,
          chg: parseFloat(cePriceChg.toFixed(2)),
          tvItm: Math.max(0, (ce.last_price || 0) - Math.max(0, spotPrice - strike)),
          bid: ce.top_bid_price || 0,
          ask: ce.top_ask_price || 0,
          delta: ceDelta,
          gamma: ceGamma,
          vega: ceVega,
          theta: ceTheta,
          builtUp: classifyBuiltUp(ceOiChg, cePriceChg)
        };
        
        // Transform PE data
        const peData: OptionData = {
          strike: strike,
          oi: pe.oi || 0,
          oiChg: peOiChg,
          oiChgPercent: peOiChgPct,
          volume: peVolume,
          iv: pe.implied_volatility || 0,
          ltp: pe.last_price || 0,
          ltpChg: parseFloat(pePriceChg.toFixed(2)),
          ltpChgPercent: (pe.previous_close_price || 0) > 0 ? parseFloat(((pePriceChg / pe.previous_close_price) * 100).toFixed(2)) : 0,
          chg: parseFloat(pePriceChg.toFixed(2)),
          tvItm: Math.max(0, (pe.last_price || 0) - Math.max(0, strike - spotPrice)),
          bid: pe.top_bid_price || 0,
          ask: pe.top_ask_price || 0,
          delta: peDelta,
          gamma: peGamma,
          vega: peVega,
          theta: peTheta,
          builtUp: classifyBuiltUp(peOiChg, pePriceChg)
        };
        
        const pcr = calculatePCR(peData.oi, ceData.oi);
        const isSpotStrike = Math.abs(strike - spotPrice) < 50; // Within 50 points
        
        rows.push({
          strike,
          pcr,
          ce: ceData,
          pe: peData,
          isSpotStrike
        });
      });
      
      console.log(`🔵 Total rows processed: ${rows.length}`);
      // Log gamma values to verify Black-Scholes calculation
      const atmRow = rows.find(r => Math.abs(r.strike - spotPrice) < 100);
      if (atmRow) {
        console.log(`📐 ATM Gamma check (strike=${atmRow.strike}): CE gamma=${atmRow.ce.gamma}, PE gamma=${atmRow.pe.gamma}, CE delta=${atmRow.ce.delta}, PE delta=${atmRow.pe.delta}`);
        console.log(`📐 ATM Volume: CE=${atmRow.ce.volume}, PE=${atmRow.pe.volume}`);
        console.log(`📐 ATM OI Chg%: CE=${atmRow.ce.oiChgPercent}%, PE=${atmRow.pe.oiChgPercent}%`);
      }
    }
    
    // Find ATM strike (closest to spot) from all rows
    const atmStrike = rows.reduce((closest, row) => {
      const currentDiff = Math.abs(row.strike - spotPrice);
      const closestDiff = Math.abs(closest - spotPrice);
      return currentDiff < closestDiff ? row.strike : closest;
    }, rows[0]?.strike || spotPrice);
    
    // Spec C: Process strikes within ±8 strikes from ATM (17 rows total)
    const atmIndex = rows.findIndex(row => row.strike === atmStrike);
    const startIndex = Math.max(0, atmIndex - 8);
    const endIndex = Math.min(rows.length - 1, atmIndex + 8);
    const filteredRows = rows.slice(startIndex, endIndex + 1);
    
    console.log(`🔵 Filtered to ${filteredRows.length} strikes around ATM (${atmStrike}) — ±8 window`);
    console.log(`🔵 Strike range: ${filteredRows[0]?.strike} - ${filteredRows[filteredRows.length - 1]?.strike}`);
    
    // Calculate overall PCR from filtered rows
    let totalCEOI = 0;
    let totalPEOI = 0;
    filteredRows.forEach(row => {
      totalCEOI += row.ce.oi;
      totalPEOI += row.pe.oi;
    });
    const overallPCR = totalCEOI > 0 ? totalPEOI / totalCEOI : 0;

    // ── Enrich with Gamma Highlight + OI/Vol Ranking + Shifts ──
    // Module 2 & 3: fetch previous snapshot + rolling averages
    const prevStrikeData = optionSnapshotService.getStrikePrevData(symbol, expiry || 'current');
    const rollingAvgVols = optionSnapshotService.getRollingAverageVolumes(symbol, expiry || 'current', 5);

    const highlights = computeHighlights(filteredRows as any, symbol, spotPrice, prevStrikeData, rollingAvgVols);
    const enrichedRows = filteredRows.map(row => {
      const h = highlights.get(row.strike);
      return {
        ...row,
        highlight: h?.highlight || '',
        ceGex: h?.ceGex || 0,
        peGex: h?.peGex || 0,
        ceOiRank: h?.ceOiRank || 0,
        peOiRank: h?.peOiRank || 0,
        ceVolRank: h?.ceVolRank || 0,
        peVolRank: h?.peVolRank || 0,
        ceOiShift: h?.ceOiShift ?? null,
        peOiShift: h?.peOiShift ?? null,
        ceOiChange: h?.ceOiChange || 0,
        peOiChange: h?.peOiChange || 0,
        ceVolShift: h?.ceVolShift || false,
        peVolShift: h?.peVolShift || false,
        ceVolRatio: h?.ceVolRatio || 0,
        peVolRatio: h?.peVolRatio || 0,
      };
    });

    const result: OptionChain = {
      index: index as any,
      spot: spotPrice,
      spotPrice: spotPrice,  // Also include for frontend compatibility
      atmStrike: atmStrike,
      pcr: overallPCR,
      expiry: expiry || 'current',
      rows: enrichedRows as any,
      strikes: enrichedRows as any,  // Also include as 'strikes' for frontend compatibility
      timestamp: new Date().toISOString(),
    };
    
    console.log(`✅ Returning option chain with ${result.rows.length} rows, spot=${result.spot}, pcr=${result.pcr}`);
    console.log(`📊 First strike in result:`, JSON.stringify(result.strikes?.[0], null, 2));
    console.log(`📊 ATM strike in result:`, JSON.stringify(result.strikes?.find(s => s.strike === atmStrike), null, 2));
    
    // Store current snapshot for interval calculations
    try {
      await optionSnapshotService.storeSnapshot(symbol, expiry || 'current', result, spotPrice);
      console.log(`📸 Stored snapshot for ${symbol}/${expiry || 'current'}`);
    } catch (err) {
      console.error('Failed to store snapshot:', err);
    }
    
    // Apply interval-based calculations if interval is not '1D'
    if (interval !== '1D') {
      try {
        console.log(`⏱️ Applying interval-based calculations for interval: ${interval}`);
        const enrichedResult = await optionSnapshotService.calculateIntervalChanges(
          symbol,
          expiry || 'current',
          result,
          interval
        );
        
        // Add interval metadata to response
        enrichedResult.interval = interval;
        
        // Cache the enriched result
        optionChainServiceCache[cacheKey] = {
          data: enrichedResult,
          timestamp: Date.now(),
        };
        console.log(`📦 SERVICE cache updated for ${symbol} with interval ${interval}`);
        
        // Also update signal engine cache
        signalEngineService.updateCache(symbol, expiry, enrichedResult, spotPrice);
        
        return enrichedResult;
      } catch (err) {
        console.error('Failed to apply interval calculations:', err);
        // Fall back to non-interval data
      }
    }
    
    // Add interval metadata
    result.interval = interval;
    
    // Cache the result for next request
    optionChainServiceCache[cacheKey] = {
      data: result,
      timestamp: Date.now(),
    };
    console.log(`📦 SERVICE cache updated for ${symbol}`);
    
    // Also update signal engine cache
    signalEngineService.updateCache(symbol, expiry, result, spotPrice);
    
    return result;
  } catch (error) {
    console.error('❌ Error fetching option chain:', error);
    throw error;
  }
}

/**
 * Get summary statistics for option chain
 */
export async function getSummaryStats(index: string, expiry?: string): Promise<SummaryStats> {
  const chain = await getOptionChain(index, expiry);
  
  let volCE = 0, volPE = 0, callOI = 0, putOI = 0;
  let totalDelta = 0, totalGamma = 0, totalVega = 0, totalRho = 0, totalTheta = 0;
  
  chain.rows.forEach(row => {
    volCE += row.ce.volume;
    volPE += row.pe.volume;
    callOI += row.ce.oi;
    putOI += row.pe.oi;
    
    // Sum all Greeks (using actual Black-Scholes values)
    totalDelta += row.ce.delta + row.pe.delta;
    totalGamma += row.ce.gamma + row.pe.gamma;
    totalVega += (row.ce.vega || 0) + (row.pe.vega || 0);
    totalTheta += (row.ce.theta || 0) + (row.pe.theta || 0);
  });
  
  const pcr = calculatePCR(putOI, callOI);
  
  return {
    volCE,
    volPE,
    totalVol: volCE + volPE,
    callOI,
    putOI,
    totalOI: callOI + putOI,
    pcr,
    alpha: totalVega > 0 ? totalTheta / totalVega : 0,  // Theta/Vega ratio as alpha proxy
    beta: totalDelta !== 0 ? totalGamma / Math.abs(totalDelta) : 0,  // Gamma/Delta ratio as beta proxy
    gamma: totalGamma,
    delta: totalDelta,
    rho: totalRho,
  };
}
