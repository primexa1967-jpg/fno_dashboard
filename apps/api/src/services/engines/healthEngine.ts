/**
 * Health Engine — System Health & Data Validation
 *
 * Spec: §10-14A (System Health), §1-6 (Data Validation), §146-181 (Health Panel)
 * HIGHEST PRIORITY — overrides all other engines (§181).
 *
 * Monitors: latency, feed status, cache age, API status, data integrity.
 * Outputs: healthScore (0-100), systemMode, signal impact.
 */

import {
  SYSTEM_STATE, HEALTH_MODE, FEED_STATUS, API_STATUS, DATA_INTEGRITY, LATENCY_CLASS,
  TRADE_ZONE, DECISION,
  type SystemStateType, type HealthModeType, type FeedStatusType,
  type ApiStatusType, type DataIntegrityType, type LatencyClassType,
  type TradeZoneType, type HealthOutput,
} from './constants';
import { configManager } from './configManager';

// ─────────────────────────────────────────────────────────────
//  INTERNAL STATE
// ─────────────────────────────────────────────────────────────

interface HealthState {
  lastTickTime: number;
  lastApiCallTime: number;
  lastApiLatencyMs: number;
  lastCacheUpdateTime: number;
  dataValid: boolean;
  dataCompleteness: number;  // 0-1
  feedActive: boolean;
  apiErrors: number;
  consecutiveApiErrors: number;
  userOverride: boolean;     // §172: Allow override for testing
  overrideMode: HealthModeType | null;
}

// ─────────────────────────────────────────────────────────────
//  HEALTH ENGINE
// ─────────────────────────────────────────────────────────────

class HealthEngine {
  private state: HealthState;
  private rejectionLog: Array<{ timestamp: number; reason: string; ruleNumber: number }> = [];

  constructor() {
    this.state = {
      lastTickTime: Date.now(),
      lastApiCallTime: Date.now(),
      lastApiLatencyMs: 0,
      lastCacheUpdateTime: Date.now(),
      dataValid: true,
      dataCompleteness: 1,
      feedActive: true,
      apiErrors: 0,
      consecutiveApiErrors: 0,
      userOverride: false,
      overrideMode: null,
    };
  }

  // ─── REPORTING ─────────────────────────────────────────────

  /** Record a new tick received */
  recordTick(): void {
    this.state.lastTickTime = Date.now();
    this.state.feedActive = true;
  }

  /** Record API call result */
  recordApiCall(latencyMs: number, success: boolean): void {
    this.state.lastApiCallTime = Date.now();
    this.state.lastApiLatencyMs = latencyMs;
    if (success) {
      this.state.consecutiveApiErrors = 0;
    } else {
      this.state.apiErrors++;
      this.state.consecutiveApiErrors++;
    }
  }

  /** Record cache update */
  recordCacheUpdate(): void {
    this.state.lastCacheUpdateTime = Date.now();
  }

  /** Record data quality */
  recordDataQuality(valid: boolean, completeness: number): void {
    this.state.dataValid = valid;
    this.state.dataCompleteness = Math.max(0, Math.min(1, completeness));
  }

  /** Set override (§172) */
  setOverride(enabled: boolean, mode?: HealthModeType): void {
    this.state.userOverride = enabled;
    this.state.overrideMode = mode || null;
  }

  // ─── CLASSIFICATION ────────────────────────────────────────

  /** §152-154: Classify latency */
  private classifyLatency(latencyMs: number): LatencyClassType {
    const cfg = configManager.getSection('health');
    if (latencyMs <= 1000) return LATENCY_CLASS.GOOD;
    if (latencyMs <= 3000) return LATENCY_CLASS.MODERATE;
    if (latencyMs <= cfg.maxLatencyMs) return LATENCY_CLASS.RISK;
    return LATENCY_CLASS.CRITICAL;
  }

  /**
   * Feed status with adaptive latency thresholds (wider when VIX elevated, tighter when calm).
   */
  private classifyFeed(marketContext?: { vix?: number }): FeedStatusType {
    const cfg = configManager.getSection('health');
    const vix = marketContext?.vix;
    let staleSec = cfg.tickTimeoutSec;
    let deadSec = cfg.tickStaleSec;
    if (vix != null && vix > 22) {
      staleSec = Math.round(staleSec * 1.5);
      deadSec = Math.round(deadSec * 1.35);
    } else if (vix != null && vix < 14) {
      staleSec = Math.max(1, Math.round(staleSec * 0.85));
      deadSec = Math.max(5, Math.round(deadSec * 0.9));
    }
    const noTickSec = (Date.now() - this.state.lastTickTime) / 1000;
    if (noTickSec > deadSec) return FEED_STATUS.DEAD;
    if (noTickSec > staleSec) return FEED_STATUS.STALE;
    return FEED_STATUS.LIVE;
  }

  /** §159-160: API status */
  private classifyApi(): ApiStatusType {
    if (this.state.consecutiveApiErrors >= 5) return API_STATUS.DOWN;
    if (this.state.consecutiveApiErrors >= 3) return API_STATUS.FAIL;
    if (this.state.lastApiLatencyMs > 3000) return API_STATUS.DEGRADED;
    if (this.state.lastApiLatencyMs > 1500) return API_STATUS.SLOW;
    return API_STATUS.OK;
  }

  /** §161-162: Data integrity */
  private classifyDataIntegrity(): DataIntegrityType {
    if (!this.state.dataValid) return DATA_INTEGRITY.CORRUPT;
    if (this.state.dataCompleteness < 0.8) return DATA_INTEGRITY.PARTIAL;
    return DATA_INTEGRITY.CLEAN;
  }

  // ─── HEALTH SCORE (§163-165) ─────────────────────────────

  private computeHealthScore(
    latencyClass: LatencyClassType,
    feedStatus: FeedStatusType,
    apiStatus: ApiStatusType,
    dataIntegrity: DataIntegrityType,
    cacheAgeSec: number
  ): number {
    let score = 100;

    // Latency impact
    switch (latencyClass) {
      case LATENCY_CLASS.MODERATE: score -= 10; break;
      case LATENCY_CLASS.RISK: score -= 25; break;
      case LATENCY_CLASS.CRITICAL: score -= 50; break;
    }

    // Feed impact
    switch (feedStatus) {
      case FEED_STATUS.STALE: score -= 20; break;
      case FEED_STATUS.DEAD: score -= 50; break;
    }

    // API impact
    switch (apiStatus) {
      case API_STATUS.SLOW: score -= 5; break;
      case API_STATUS.DEGRADED: score -= 15; break;
      case API_STATUS.FAIL: score -= 30; break;
      case API_STATUS.DOWN: score -= 50; break;
    }

    // Data impact
    switch (dataIntegrity) {
      case DATA_INTEGRITY.PARTIAL: score -= 15; break;
      case DATA_INTEGRITY.CORRUPT: score -= 40; break;
    }

    // Cache age impact
    const cfg = configManager.getSection('health');
    if (cacheAgeSec > cfg.cacheAgeBlockSystem) score -= 30;
    else if (cacheAgeSec > cfg.cacheAgeReduceConfidence) score -= 10;

    return Math.max(0, Math.min(100, score));
  }

  // ─── SYSTEM MODE (§166-169) ──────────────────────────────

  private classifyMode(healthScore: number): HealthModeType {
    if (this.state.userOverride && this.state.overrideMode) {
      return this.state.overrideMode;
    }
    if (healthScore <= 20) return HEALTH_MODE.HALT;
    if (healthScore <= 40) return HEALTH_MODE.RESTRICTED;
    if (healthScore <= 60) return HEALTH_MODE.CAUTION;
    return HEALTH_MODE.NORMAL;
  }

  /** Derive system state from mode */
  private classifySystemState(mode: HealthModeType, feedStatus: FeedStatusType): SystemStateType {
    if (mode === HEALTH_MODE.HALT) return SYSTEM_STATE.HALTED;
    if (feedStatus === FEED_STATUS.DEAD) return SYSTEM_STATE.HALTED;
    return SYSTEM_STATE.ACTIVE;
  }

  // ─── TOP REASONS (§180) ──────────────────────────────────

  private collectReasons(
    latencyClass: LatencyClassType,
    feedStatus: FeedStatusType,
    apiStatus: ApiStatusType,
    dataIntegrity: DataIntegrityType,
    cacheAgeSec: number
  ): string[] {
    const reasons: string[] = [];
    const cfg = configManager.getSection('health');

    if (latencyClass === LATENCY_CLASS.CRITICAL) reasons.push(`Latency critical (>${cfg.haltLatencyMs}ms)`);
    else if (latencyClass === LATENCY_CLASS.RISK) reasons.push(`Latency high (>${cfg.maxLatencyMs}ms)`);

    if (feedStatus === FEED_STATUS.DEAD) reasons.push('Data feed DEAD');
    else if (feedStatus === FEED_STATUS.STALE) reasons.push('Data feed STALE');

    if (apiStatus === API_STATUS.DOWN) reasons.push('API DOWN');
    else if (apiStatus === API_STATUS.FAIL) reasons.push('API FAILED');
    else if (apiStatus === API_STATUS.DEGRADED) reasons.push('API degraded');

    if (dataIntegrity === DATA_INTEGRITY.CORRUPT) reasons.push('Data CORRUPT');
    else if (dataIntegrity === DATA_INTEGRITY.PARTIAL) reasons.push('Data incomplete');

    if (cacheAgeSec > cfg.cacheAgeBlockSystem) reasons.push(`Cache stale (${cacheAgeSec.toFixed(0)}s)`);

    if (reasons.length === 0) reasons.push('System healthy');
    return reasons.slice(0, 5);
  }

  // ─── MAIN EVALUATION ─────────────────────────────────────

  /** Evaluate current system health (§176-180) */
  evaluate(marketContext?: { vix?: number }): HealthOutput {
    const now = Date.now();
    const cfg = configManager.getSection('health');

    const latencyMs = this.state.lastApiLatencyMs;
    const latencyClass = this.classifyLatency(latencyMs);
    const cacheAgeSec = (now - this.state.lastCacheUpdateTime) / 1000;
    const noTickTimeSec = (now - this.state.lastTickTime) / 1000;
    const feedStatus = this.classifyFeed(marketContext);
    const apiStatus = this.classifyApi();
    const dataIntegrity = this.classifyDataIntegrity();

    const healthScore = this.computeHealthScore(latencyClass, feedStatus, apiStatus, dataIntegrity, cacheAgeSec);
    const systemMode = this.classifyMode(healthScore);
    const systemState = this.classifySystemState(systemMode, feedStatus);
    const topReasons = this.collectReasons(latencyClass, feedStatus, apiStatus, dataIntegrity, cacheAgeSec);

    // §170-171: Health affects confidence and entryScore
    // Determine signal/decision based on system state
    let signal: HealthOutput['signal'] = 'NONE';
    let decision: TradeZoneType = TRADE_ZONE.NO_TRADE;
    if (systemState === SYSTEM_STATE.ACTIVE && systemMode === HEALTH_MODE.NORMAL) {
      decision = TRADE_ZONE.TRADE;
    } else if (systemMode === HEALTH_MODE.CAUTION || systemMode === HEALTH_MODE.RESTRICTED) {
      decision = TRADE_ZONE.WAIT;
    }

    return {
      latencyMs,
      latencyClass,
      cacheAgeSec: Number(cacheAgeSec.toFixed(1)),
      noTickTimeSec: Number(noTickTimeSec.toFixed(1)),
      feedStatus,
      apiStatus,
      dataIntegrity,
      healthScore,
      systemMode,
      systemState,
      signal,
      decision,
      topReasons,
    };
  }

  /** §174: Log rejection with rule number */
  logRejection(reason: string, ruleNumber: number): void {
    this.rejectionLog.push({ timestamp: Date.now(), reason, ruleNumber });
    // Keep last 100 entries
    if (this.rejectionLog.length > 100) this.rejectionLog.shift();
  }

  /** §175: Get last N decisions/rejections */
  getRecentRejections(count: number = 10): typeof this.rejectionLog {
    return this.rejectionLog.slice(-count);
  }

  /** Check if system allows entry (shorthand) */
  canEnter(): boolean {
    const health = this.evaluate();
    return health.systemState === SYSTEM_STATE.ACTIVE && health.systemMode !== HEALTH_MODE.HALT;
  }

  /** Check if system should halt */
  isHalted(): boolean {
    const health = this.evaluate();
    return health.systemState === SYSTEM_STATE.HALTED || health.systemMode === HEALTH_MODE.HALT;
  }
}

export const healthEngine = new HealthEngine();
