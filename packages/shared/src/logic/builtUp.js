"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyBuiltUp = classifyBuiltUp;
exports.getBuiltUpStyle = getBuiltUpStyle;
const DEFAULT_CONFIG = {
    priceChangeThreshold: 0,
    oiChangeThreshold: 0,
};
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
function classifyBuiltUp(ltpChange, oiChange, config = DEFAULT_CONFIG) {
    const { priceChangeThreshold, oiChangeThreshold } = config;
    // Check if changes are significant enough
    const priceSignificant = Math.abs(ltpChange) >= priceChangeThreshold;
    const oiSignificant = Math.abs(oiChange) >= oiChangeThreshold;
    if (!priceSignificant && !oiSignificant) {
        return null;
    }
    const priceUp = ltpChange > 0;
    const oiUp = oiChange > 0;
    if (priceUp && oiUp) {
        return 'Call OI Increase';
    }
    else if (priceUp && !oiUp) {
        return 'buy back';
    }
    else if (!priceUp && oiUp) {
        return 'Put OI Increase';
    }
    else {
        return 'profit booking';
    }
}
/**
 * Get color/style for built-up type (for UI rendering)
 */
function getBuiltUpStyle(builtUp) {
    switch (builtUp) {
        case 'Call OI Increase':
            return { color: '#fff', backgroundColor: '#2e7d32' }; // Dark green
        case 'buy back':
            return { color: '#000', backgroundColor: '#81c784' }; // Light green
        case 'Put OI Increase':
            return { color: '#fff', backgroundColor: '#c62828' }; // Dark red
        case 'profit booking':
            return { color: '#000', backgroundColor: '#ef9a9a' }; // Light red
        default:
            return { color: '#000', backgroundColor: 'transparent' };
    }
}
//# sourceMappingURL=builtUp.js.map