import { BuiltUpType } from '../types/market';
/**
 * Configuration for built-up classification
 */
export interface BuiltUpConfig {
    priceChangeThreshold: number;
    oiChangeThreshold: number;
}
/**
 * Classify option built-up based on price and OI changes
 *
 * Rules:
 * - Price ↑ & OI ↑ → Call OI Increase
 * - Price ↑ & OI ↓ → buy back
 * - Price ↓ & OI ↑ → Put OI Increase
 * - Price ↓ & OI ↓ → profit booking
 *
 * @param ltpChange - Change in Last Traded Price (percentage)
 * @param oiChange - Change in Open Interest (percentage)
 * @param config - Optional configuration for thresholds
 * @returns Built-up classification or null if insignificant changes
 */
export declare function classifyBuiltUp(ltpChange: number, oiChange: number, config?: BuiltUpConfig): BuiltUpType | null;
/**
 * Get color/style for built-up type (for UI rendering)
 */
export declare function getBuiltUpStyle(builtUp: BuiltUpType | null): {
    color: string;
    backgroundColor: string;
};
//# sourceMappingURL=builtUp.d.ts.map