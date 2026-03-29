/**
 * Engine Module — Barrel Export
 *
 * All engines are imported from here.
 * No engine logic is duplicated outside this directory (§52A).
 */

// Constants & Types (shared by all engines)
export * from './constants';

// Config Manager (centralized thresholds)
export { configManager } from './configManager';

// Core Engines
export { computeRange, computeGlobal, classifyPosition, calculateOverlap } from './rangeEngine';
export { healthEngine } from './healthEngine';
export { decisionEngine } from './decisionEngine';
export type { ScannerModelOutput, ScannerSignal } from './decisionEngine';
export { triggerEngine } from './triggerEngine';
export type { TriggerContext } from './triggerEngine';
export { riskEngine } from './riskEngine';
export { entryEngine } from './entryEngine';
export type { EntryContext } from './entryEngine';
export { simulationEngine } from './simulationEngine';

// Pipeline
export { pipelineOrchestrator } from './pipeline';
export type { PipelineResult, MarketDataSnapshot } from './pipeline';
