/**
 * Greeks Engine Service
 * Implements Black-Scholes model for calculating:
 * - Implied Volatility (IV) using Newton-Raphson iteration
 * - Delta, Gamma, Theta, Vega, Rho for 17 strikes
 * 
 * Black-Scholes Formula:
 * C = S*N(d1) - K*e^(-rT)*N(d2)  [Call]
 * P = K*e^(-rT)*N(-d2) - S*N(-d1)  [Put]
 * 
 * where:
 * d1 = [ln(S/K) + (r + σ²/2)T] / (σ√T)
 * d2 = d1 - σ√T
 */

// Constants
const RISK_FREE_RATE = 0.065; // 6.5% annual risk-free rate (India)
const TRADING_DAYS_PER_YEAR = 252;
const MAX_IV_ITERATIONS = 100;
const IV_TOLERANCE = 0.0001;
const MIN_IV = 0.01;  // 1%
const MAX_IV = 5.0;   // 500%

export interface GreeksResult {
  iv: number;       // Implied Volatility (as decimal, e.g., 0.20 = 20%)
  delta: number;    // Rate of change of option price vs spot
  gamma: number;    // Rate of change of delta
  theta: number;    // Time decay per day
  vega: number;     // Sensitivity to IV changes
  rho: number;      // Sensitivity to interest rate changes
}

export interface StrikeGreeks {
  strike: number;
  ce: GreeksResult;
  pe: GreeksResult;
}

export interface FullGreeksData {
  symbol: string;
  spotPrice: number;
  expiry: string;
  daysToExpiry: number;
  riskFreeRate: number;
  strikes: StrikeGreeks[];
  timestamp: number;
}

/**
 * Standard Normal Cumulative Distribution Function (CDF)
 * Approximation using Abramowitz and Stegun formula
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Standard Normal Probability Density Function (PDF)
 */
function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Calculate d1 and d2 for Black-Scholes
 */
function calculateD1D2(
  spotPrice: number,
  strikePrice: number,
  timeToExpiry: number,
  volatility: number,
  riskFreeRate: number
): { d1: number; d2: number } {
  const sqrtT = Math.sqrt(timeToExpiry);
  const d1 = (Math.log(spotPrice / strikePrice) + (riskFreeRate + 0.5 * volatility * volatility) * timeToExpiry) / 
             (volatility * sqrtT);
  const d2 = d1 - volatility * sqrtT;
  
  return { d1, d2 };
}

/**
 * Calculate Black-Scholes Call Price
 */
function blackScholesCall(
  spotPrice: number,
  strikePrice: number,
  timeToExpiry: number,
  volatility: number,
  riskFreeRate: number
): number {
  if (timeToExpiry <= 0) {
    return Math.max(0, spotPrice - strikePrice);
  }

  const { d1, d2 } = calculateD1D2(spotPrice, strikePrice, timeToExpiry, volatility, riskFreeRate);
  
  return spotPrice * normalCDF(d1) - strikePrice * Math.exp(-riskFreeRate * timeToExpiry) * normalCDF(d2);
}

/**
 * Calculate Black-Scholes Put Price
 */
function blackScholesPut(
  spotPrice: number,
  strikePrice: number,
  timeToExpiry: number,
  volatility: number,
  riskFreeRate: number
): number {
  if (timeToExpiry <= 0) {
    return Math.max(0, strikePrice - spotPrice);
  }

  const { d1, d2 } = calculateD1D2(spotPrice, strikePrice, timeToExpiry, volatility, riskFreeRate);
  
  return strikePrice * Math.exp(-riskFreeRate * timeToExpiry) * normalCDF(-d2) - spotPrice * normalCDF(-d1);
}

/**
 * Calculate Vega (same for Call and Put)
 */
function calculateVega(
  spotPrice: number,
  strikePrice: number,
  timeToExpiry: number,
  volatility: number,
  riskFreeRate: number
): number {
  if (timeToExpiry <= 0) return 0;

  const { d1 } = calculateD1D2(spotPrice, strikePrice, timeToExpiry, volatility, riskFreeRate);
  
  return spotPrice * normalPDF(d1) * Math.sqrt(timeToExpiry) / 100; // Per 1% change in IV
}

/**
 * Calculate Implied Volatility using Newton-Raphson method
 */
function calculateIV(
  optionPrice: number,
  spotPrice: number,
  strikePrice: number,
  timeToExpiry: number,
  riskFreeRate: number,
  isCall: boolean
): number {
  if (timeToExpiry <= 0) return 0;
  if (optionPrice <= 0) return 0;

  // Initial guess
  let iv = 0.3; // Start at 30%

  // Intrinsic value check
  const intrinsicValue = isCall 
    ? Math.max(0, spotPrice - strikePrice)
    : Math.max(0, strikePrice - spotPrice);
  
  if (optionPrice < intrinsicValue) {
    return MIN_IV;
  }

  for (let i = 0; i < MAX_IV_ITERATIONS; i++) {
    const theoreticalPrice = isCall
      ? blackScholesCall(spotPrice, strikePrice, timeToExpiry, iv, riskFreeRate)
      : blackScholesPut(spotPrice, strikePrice, timeToExpiry, iv, riskFreeRate);

    const vega = calculateVega(spotPrice, strikePrice, timeToExpiry, iv, riskFreeRate) * 100;

    if (Math.abs(vega) < 0.0001) {
      break;
    }

    const priceDiff = theoreticalPrice - optionPrice;

    if (Math.abs(priceDiff) < IV_TOLERANCE) {
      break;
    }

    // Newton-Raphson update
    iv = iv - priceDiff / vega;

    // Bound IV
    iv = Math.max(MIN_IV, Math.min(MAX_IV, iv));
  }

  return iv;
}

/**
 * Calculate all Greeks for a Call option
 */
function calculateCallGreeks(
  spotPrice: number,
  strikePrice: number,
  timeToExpiry: number,
  volatility: number,
  riskFreeRate: number
): GreeksResult {
  if (timeToExpiry <= 0 || volatility <= 0) {
    return { iv: volatility, delta: spotPrice > strikePrice ? 1 : 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }

  const { d1, d2 } = calculateD1D2(spotPrice, strikePrice, timeToExpiry, volatility, riskFreeRate);
  const sqrtT = Math.sqrt(timeToExpiry);

  // Delta
  const delta = normalCDF(d1);

  // Gamma
  const gamma = normalPDF(d1) / (spotPrice * volatility * sqrtT);

  // Theta (per day)
  const theta = (-(spotPrice * normalPDF(d1) * volatility / (2 * sqrtT)) -
                 riskFreeRate * strikePrice * Math.exp(-riskFreeRate * timeToExpiry) * normalCDF(d2)) / 365;

  // Vega (per 1% change)
  const vega = spotPrice * normalPDF(d1) * sqrtT / 100;

  // Rho (per 1% change)
  const rho = strikePrice * timeToExpiry * Math.exp(-riskFreeRate * timeToExpiry) * normalCDF(d2) / 100;

  return {
    iv: volatility,
    delta: Number(delta.toFixed(4)),
    gamma: Number(gamma.toFixed(6)),
    theta: Number(theta.toFixed(4)),
    vega: Number(vega.toFixed(4)),
    rho: Number(rho.toFixed(4)),
  };
}

/**
 * Calculate all Greeks for a Put option
 */
function calculatePutGreeks(
  spotPrice: number,
  strikePrice: number,
  timeToExpiry: number,
  volatility: number,
  riskFreeRate: number
): GreeksResult {
  if (timeToExpiry <= 0 || volatility <= 0) {
    return { iv: volatility, delta: spotPrice < strikePrice ? -1 : 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }

  const { d1, d2 } = calculateD1D2(spotPrice, strikePrice, timeToExpiry, volatility, riskFreeRate);
  const sqrtT = Math.sqrt(timeToExpiry);

  // Delta
  const delta = normalCDF(d1) - 1;

  // Gamma (same as call)
  const gamma = normalPDF(d1) / (spotPrice * volatility * sqrtT);

  // Theta (per day)
  const theta = (-(spotPrice * normalPDF(d1) * volatility / (2 * sqrtT)) +
                 riskFreeRate * strikePrice * Math.exp(-riskFreeRate * timeToExpiry) * normalCDF(-d2)) / 365;

  // Vega (same as call, per 1% change)
  const vega = spotPrice * normalPDF(d1) * sqrtT / 100;

  // Rho (per 1% change)
  const rho = -strikePrice * timeToExpiry * Math.exp(-riskFreeRate * timeToExpiry) * normalCDF(-d2) / 100;

  return {
    iv: volatility,
    delta: Number(delta.toFixed(4)),
    gamma: Number(gamma.toFixed(6)),
    theta: Number(theta.toFixed(4)),
    vega: Number(vega.toFixed(4)),
    rho: Number(rho.toFixed(4)),
  };
}

/**
 * Calculate days to expiry from expiry date string
 */
function calculateDaysToExpiry(expiryDate: string): number {
  const expiry = new Date(expiryDate);
  const now = new Date();
  
  // Set both dates to midnight for accurate day calculation
  expiry.setHours(15, 30, 0, 0); // Market close time
  now.setHours(0, 0, 0, 0);
  
  const diffTime = expiry.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return Math.max(0, diffDays);
}

/**
 * Convert days to expiry to years (for Black-Scholes time parameter)
 */
function daysToYears(days: number): number {
  return days / 365;
}

class GreeksEngineService {
  /**
   * Calculate Greeks for all strikes in an option chain
   */
  calculateFullGreeks(
    spotPrice: number,
    strikes: Array<{ strike: number; ceLTP: number; peLTP: number }>,
    expiryDate: string
  ): FullGreeksData {
    const daysToExpiry = calculateDaysToExpiry(expiryDate);
    const timeToExpiry = daysToYears(daysToExpiry);
    
    const strikeGreeks: StrikeGreeks[] = strikes.map(({ strike, ceLTP, peLTP }) => {
      // Calculate IV from market prices
      const ceIV = calculateIV(ceLTP, spotPrice, strike, timeToExpiry, RISK_FREE_RATE, true);
      const peIV = calculateIV(peLTP, spotPrice, strike, timeToExpiry, RISK_FREE_RATE, false);
      
      // Calculate Greeks using the implied volatility
      const ceGreeks = calculateCallGreeks(spotPrice, strike, timeToExpiry, ceIV, RISK_FREE_RATE);
      const peGreeks = calculatePutGreeks(spotPrice, strike, timeToExpiry, peIV, RISK_FREE_RATE);
      
      return {
        strike,
        ce: { ...ceGreeks, iv: Number((ceIV * 100).toFixed(2)) }, // Convert to percentage
        pe: { ...peGreeks, iv: Number((peIV * 100).toFixed(2)) },
      };
    });
    
    return {
      symbol: '',
      spotPrice,
      expiry: expiryDate,
      daysToExpiry,
      riskFreeRate: RISK_FREE_RATE * 100,
      strikes: strikeGreeks,
      timestamp: Date.now(),
    };
  }

  /**
   * Calculate Greeks for a single option
   */
  calculateSingleGreeks(
    spotPrice: number,
    strikePrice: number,
    optionPrice: number,
    expiryDate: string,
    isCall: boolean
  ): GreeksResult {
    const daysToExpiry = calculateDaysToExpiry(expiryDate);
    const timeToExpiry = daysToYears(daysToExpiry);
    
    // Calculate IV
    const iv = calculateIV(optionPrice, spotPrice, strikePrice, timeToExpiry, RISK_FREE_RATE, isCall);
    
    // Calculate Greeks
    if (isCall) {
      const greeks = calculateCallGreeks(spotPrice, strikePrice, timeToExpiry, iv, RISK_FREE_RATE);
      return { ...greeks, iv: Number((iv * 100).toFixed(2)) };
    } else {
      const greeks = calculatePutGreeks(spotPrice, strikePrice, timeToExpiry, iv, RISK_FREE_RATE);
      return { ...greeks, iv: Number((iv * 100).toFixed(2)) };
    }
  }

  /**
   * Calculate theoretical option price given IV
   */
  calculateTheoreticalPrice(
    spotPrice: number,
    strikePrice: number,
    expiryDate: string,
    iv: number, // as percentage, e.g., 20 for 20%
    isCall: boolean
  ): number {
    const daysToExpiry = calculateDaysToExpiry(expiryDate);
    const timeToExpiry = daysToYears(daysToExpiry);
    const ivDecimal = iv / 100;
    
    if (isCall) {
      return Number(blackScholesCall(spotPrice, strikePrice, timeToExpiry, ivDecimal, RISK_FREE_RATE).toFixed(2));
    } else {
      return Number(blackScholesPut(spotPrice, strikePrice, timeToExpiry, ivDecimal, RISK_FREE_RATE).toFixed(2));
    }
  }
}

export const greeksEngineService = new GreeksEngineService();

// Export individual functions for use in other modules
export {
  calculateIV,
  calculateCallGreeks,
  calculatePutGreeks,
  blackScholesCall,
  blackScholesPut,
  normalCDF,
  normalPDF,
  calculateDaysToExpiry,
};
