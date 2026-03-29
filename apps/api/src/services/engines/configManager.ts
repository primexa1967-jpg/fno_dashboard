/**
 * Config Manager — Centralized Configurable Thresholds
 *
 * Spec: §2A, §290 — All thresholds, parameters, and limits are configurable.
 * Dynamic updates without code changes.
 */

// ─────────────────────────────────────────────────────────────
//  DEFAULT CONFIGURATION
// ─────────────────────────────────────────────────────────────

export interface SystemConfig {
  // Range Engine
  range: {
    expansionThreshold: number;    // % diff for EXPANSION (default 10)
    exhaustionThreshold: number;   // % diff for EXHAUSTION (default 10)
    alignmentPartialOverlap: number;  // % for PARTIAL alignment (default 30)
    noTradeOverlap: number;           // below this → NO_TRADE (default 15)
    conflictOverlap: number;          // below this + diff → NO_TRADE (default 30)
    lateMoveOverlap: number;          // threshold for late move (default 40)
    edgeCaseOverlapForce: number;     // force NO_TRADE below this (default 10)
    edgeCaseConflictOverlap: number;  // force CONFLICT below this (default 20)
  };

  // Confidence
  confidence: {
    highThreshold: number;      // 50
    mediumThreshold: number;    // 30
    lowThreshold: number;       // 15
  };

  // Health Engine
  health: {
    maxLatencyMs: number;           // 5000 → BLOCK ENTRY
    haltLatencyMs: number;          // 8000 → HALT SYSTEM
    cacheAgeReduceConfidence: number; // 5 sec
    cacheAgeBlockSystem: number;      // 10 sec
    tickTimeoutSec: number;           // 2 → feed DEAD
    tickStaleSec: number;             // 10 → feed STALE
  };

  // Scanner
  scanner: {
    minOiPercent: number;           // 8 → minimum OI filter
    minMultiTfScore: number;        // 2
    minEntryScore: number;          // varies
    minWinProb: number;             // 65
    minRR: number;                  // 1.5
    minLiquidity: number;           // threshold
  };

  // Decision
  decision: {
    minStrength: 'LOW' | 'MEDIUM' | 'HIGH';
    minProbability: number;         // 60
    probUpgradeThreshold: number;   // 75 → upgrade strength
    probDowngradeThreshold: number; // 65 → downgrade strength
  };

  // Trigger
  trigger: {
    flowStrongThreshold: number;
    maxSpread: number;
    minVolume: number;
    maxLatencyMs: number;
  };

  // Risk Engine
  risk: {
    riskPerTrade: number;           // 0.01-0.02 (1-2%)
    maxCapitalExposure: number;     // 0.30-0.40 (30-40%)
    maxCEPositions: number;
    maxPEPositions: number;
    maxTotalPositions: number;
    dailyLossLimit: number;         // -0.03 (-3%)
    dailyProfitLock: number;        // 0.05 (5%)
    lossStreakReduceAt: number;     // 3
    lossStreakHaltAt: number;       // 5
    /** Pause new simulated trades on a symbol after this many consecutive losses */
    symbolConsecutiveLossPause: number;
    accountDrawdownHalt: number;    // -0.10 (-10%)
    cooldownMinutes: number;        // 3-5
    profitReduceRisk: number;       // 0.03 (3%)
  };

  // Entry Engine
  entry: {
    maxSpread: number;
    minVolume: number;
    minOI: number;
    maxSlippage: number;
    orderFillTimeoutSec: number;
    maxConsecutiveFailures: number;  // 3
    breakoutCandleSizeMultiplier: number; // 1.5
  };

  // Simulation
  simulation: {
    initialCapital: number;
    slippageModel: 'FIXED' | 'DYNAMIC';
    fixedSlippagePct: number;
    maxHoldTimeMinutes: number;
    trailingStopTriggerPct: number;   // 25%
    trailingStopCutPct: number;       // 12%
    partialExitPct: number;           // 50%
    partialExitTriggerPnl: number;    // 50%
    fullExitPnl: number;             // 100%
    hardStopPnl: number;             // -25%
  };

  // Global Market
  global: {
    noTradeThreshold: number;        // 0.60 (60% indices)
  };

  // Exit Engine (new thresholds to complement existing)
  exit: {
    hardStopPnl: number;             // -25%
    trailingTriggerPnl: number;      // 25%
    trailingCutFromPeak: number;     // 12%
    partialBookPnl: number;          // 50%
    fullExitPnl: number;             // 100%
    maxHoldMinutes: number;
  };
}

// ─────────────────────────────────────────────────────────────
//  DEFAULTS
// ─────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: SystemConfig = {
  range: {
    expansionThreshold: 10,
    exhaustionThreshold: 10,
    alignmentPartialOverlap: 30,
    noTradeOverlap: 15,
    conflictOverlap: 30,
    lateMoveOverlap: 40,
    edgeCaseOverlapForce: 10,
    edgeCaseConflictOverlap: 20,
  },
  confidence: {
    highThreshold: 50,
    mediumThreshold: 30,
    lowThreshold: 15,
  },
  health: {
    maxLatencyMs: 5000,
    haltLatencyMs: 8000,
    cacheAgeReduceConfidence: 5,
    cacheAgeBlockSystem: 10,
    tickTimeoutSec: 2,
    tickStaleSec: 10,
  },
  scanner: {
    minOiPercent: 8,
    minMultiTfScore: 2,
    minEntryScore: 12,
    minWinProb: 65,
    minRR: 1.5,
    minLiquidity: 1000,
  },
  decision: {
    minStrength: 'LOW',
    minProbability: 60,
    probUpgradeThreshold: 75,
    probDowngradeThreshold: 65,
  },
  trigger: {
    flowStrongThreshold: 70,
    maxSpread: 5,
    minVolume: 500,
    maxLatencyMs: 3000,
  },
  risk: {
    riskPerTrade: 0.02,
    maxCapitalExposure: 0.35,
    maxCEPositions: 3,
    maxPEPositions: 3,
    maxTotalPositions: 5,
    dailyLossLimit: -0.03,
    dailyProfitLock: 0.05,
    lossStreakReduceAt: 3,
    lossStreakHaltAt: 5,
    symbolConsecutiveLossPause: 2,
    accountDrawdownHalt: -0.10,
    cooldownMinutes: 5,
    profitReduceRisk: 0.03,
  },
  entry: {
    maxSpread: 5,
    minVolume: 500,
    minOI: 1000,
    maxSlippage: 2,
    orderFillTimeoutSec: 30,
    maxConsecutiveFailures: 3,
    breakoutCandleSizeMultiplier: 1.5,
  },
  simulation: {
    initialCapital: 500000,
    slippageModel: 'FIXED',
    fixedSlippagePct: 0.1,
    maxHoldTimeMinutes: 360,
    trailingStopTriggerPct: 25,
    trailingStopCutPct: 12,
    partialExitPct: 50,
    partialExitTriggerPnl: 50,
    fullExitPnl: 100,
    hardStopPnl: -25,
  },
  global: {
    noTradeThreshold: 0.60,
  },
  exit: {
    hardStopPnl: -25,
    trailingTriggerPnl: 25,
    trailingCutFromPeak: 12,
    partialBookPnl: 50,
    fullExitPnl: 100,
    maxHoldMinutes: 360,
  },
};

// ─────────────────────────────────────────────────────────────
//  CONFIG MANAGER SINGLETON
// ─────────────────────────────────────────────────────────────

class ConfigManager {
  private config: SystemConfig;

  constructor() {
    this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  /** Get full config (read-only copy) */
  getConfig(): Readonly<SystemConfig> {
    return this.config;
  }

  /** Get a specific section */
  getSection<K extends keyof SystemConfig>(section: K): Readonly<SystemConfig[K]> {
    return this.config[section];
  }

  /** Update a section dynamically (spec §290) */
  updateSection<K extends keyof SystemConfig>(section: K, updates: Partial<SystemConfig[K]>): void {
    this.config[section] = { ...this.config[section], ...updates };
    console.log(`⚙️  Config updated: ${section}`, updates);
  }

  /** Update full config */
  updateConfig(updates: Partial<SystemConfig>): void {
    for (const key of Object.keys(updates) as (keyof SystemConfig)[]) {
      if (updates[key]) {
        this.config[key] = { ...this.config[key], ...updates[key] } as any;
      }
    }
    console.log(`⚙️  Full config updated`);
  }

  /** Reset to defaults */
  reset(): void {
    this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    console.log(`⚙️  Config reset to defaults`);
  }
}

export const configManager = new ConfigManager();
