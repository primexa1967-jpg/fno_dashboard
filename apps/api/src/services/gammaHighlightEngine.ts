/**
 * Option Chain Highlight & Shift Detection Engine (v2 — Spec Corrections)
 *
 * Fixes applied per spec documents:
 *   1. GammaExposure = Gamma × OI × LotSize × SpotPrice (was missing ×SpotPrice)
 *   2. Gamma Wall threshold → 0.95 (was 0.90)
 *   3. Gamma Flip + Zero Gamma → merged as "Gamma Pivot" (single label)
 *   4. Cluster category → hidden (removed from display, used only internally)
 *   5. Top-3 limit on gamma highlights per chain
 *   6. Distance filter: only highlight strikes within ±3% of spot
 *
 * Modules:
 *   Module 1 — Cell Background Highlight (OI / Volume Ranking, top-2 with duplicate handling)
 *   Module 2 — OI Shift Detection (Build / Unwind via snapshot cache, absolute thresholds)
 *   Module 3 — Volume Shift Detection (Rolling average ratio ≥ 2)
 *   + Gamma Highlights (Wall / Pivot — no Cluster in display)
 *
 * All data from real Dhan APIs — no dummy data.
 */

// ── Per-Index Configuration ────────────────────────────────

export const INDEX_CONFIG: Record<string, {
  strikeStep: number;
  lotSize: number;
  minOiChange: number;   // Module 2: absolute OI change threshold
}> = {
  NIFTY:       { strikeStep: 50,  lotSize: 50,  minOiChange: 15000 },
  BANKNIFTY:   { strikeStep: 100, lotSize: 15,  minOiChange: 8000  },
  FINNIFTY:    { strikeStep: 50,  lotSize: 25,  minOiChange: 6000  },
  MIDCAPNIFTY: { strikeStep: 25,  lotSize: 75,  minOiChange: 4000  },
  SENSEX:      { strikeStep: 100, lotSize: 10,  minOiChange: 3000  },
  BANKEX:      { strikeStep: 100, lotSize: 15,  minOiChange: 2500  },
};

// ── Types ──────────────────────────────────────────────────

export type GammaHighlightType =
  | 'Gamma Wall CALL'
  | 'Gamma Wall PUT'
  | 'Gamma Pivot'      // Merged: was Gamma Flip + Zero Gamma
  | '';                 // Clusters are hidden (internal use only)

export interface StrikeHighlight {
  // Gamma highlights
  highlight: GammaHighlightType;
  ceGex: number;
  peGex: number;

  // Module 1: OI Ranking (1 = highest, 2 = second, 0 = not ranked)
  ceOiRank: number;
  peOiRank: number;

  // Module 1: Volume Ranking (1 = highest, 2 = second, 0 = not ranked)
  ceVolRank: number;
  peVolRank: number;

  // Module 2: OI Shift Detection
  ceOiShift: 'BUILD' | 'UNWIND' | null;
  peOiShift: 'BUILD' | 'UNWIND' | null;
  ceOiChange: number;
  peOiChange: number;

  // Module 3: Volume Shift Detection
  ceVolShift: boolean;
  peVolShift: boolean;
  ceVolRatio: number;
  peVolRatio: number;
}

export interface RowLike {
  strike: number;
  ce: { oi: number; gamma: number; volume: number; oiChg?: number; oiChgPercent?: number };
  pe: { oi: number; gamma: number; volume: number; oiChg?: number; oiChgPercent?: number };
}

export interface PrevStrikeData {
  ceOi: number;
  peOi: number;
  ceVol: number;
  peVol: number;
}

// ── Main Entry Point ───────────────────────────────────────

/**
 * Compute highlight data for every strike in the option chain.
 *
 * @param rows            Current OptionChainRow[] (±8 strikes around ATM)
 * @param symbol          Index symbol (NIFTY, BANKNIFTY…)
 * @param spotPrice       Current spot price (for GEX calculation and distance filter)
 * @param prevData        Previous snapshot per-strike data (Module 2 / 3)
 * @param rollingAvgVols  Rolling average volumes per strike/type (Module 3)
 */
export function computeHighlights(
  rows: RowLike[],
  symbol: string,
  spotPrice?: number,
  prevData?: Map<number, PrevStrikeData>,
  rollingAvgVols?: Map<string, number>,
): Map<number, StrikeHighlight> {
  const cfg = INDEX_CONFIG[symbol] || INDEX_CONFIG.NIFTY;
  const map = new Map<number, StrikeHighlight>();
  const spot = spotPrice || 0;

  if (rows.length === 0) return map;

  // ─── DATA VALIDATION (spec: discard rows with missing strike, OI<0, Vol<0) ───
  const validRows = rows.filter(
    r =>
      r.strike != null &&
      r.strike > 0 &&
      r.ce.oi >= 0 &&
      r.pe.oi >= 0 &&
      r.ce.volume >= 0 &&
      r.pe.volume >= 0,
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  GAMMA HIGHLIGHTS — Spec E Pipeline (Steps 2-10)
  //  FIX: GEX = Gamma × OI × LotSize × SpotPrice
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  interface StrikeGamma {
    strike: number;
    ceGex: number;
    peGex: number;
    ceRatio: number;
    peRatio: number;
    netGamma: number;
    distancePct: number; // Distance from spot as percentage
  }

  const gammaData: StrikeGamma[] = validRows.map(r => {
    // FIX: Include × SpotPrice in GEX calculation
    const ceGex = r.ce.gamma * r.ce.oi * cfg.lotSize * (spot > 0 ? spot : 1);
    const peGex = r.pe.gamma * r.pe.oi * cfg.lotSize * (spot > 0 ? spot : 1);
    const distancePct = spot > 0 ? Math.abs(r.strike - spot) / spot * 100 : 0;
    return { strike: r.strike, ceGex, peGex, ceRatio: 0, peRatio: 0, netGamma: 0, distancePct };
  });

  // ── Step 4: Max Gamma Exposure (exclude zero-OI strikes) ──
  const maxCeGex = Math.max(...gammaData.filter(g => g.ceGex > 0).map(g => g.ceGex), 0);
  const maxPeGex = Math.max(...gammaData.filter(g => g.peGex > 0).map(g => g.peGex), 0);

  // ── Step 5: Gamma Ratios (clamp 0–1, protect divide-by-zero) ──
  for (const g of gammaData) {
    g.ceRatio = maxCeGex > 0 ? Math.min(Math.max(g.ceGex / maxCeGex, 0), 1) : 0;
    g.peRatio = maxPeGex > 0 ? Math.min(Math.max(g.peGex / maxPeGex, 0), 1) : 0;
  }

  // ── Step 6: Net Gamma = CE_GEX − PE_GEX ──
  for (const g of gammaData) {
    g.netGamma = g.ceGex - g.peGex;
  }

  // ── Step 8 prep: Zero Gamma threshold (5% of MaxNetGamma) ──
  const maxNetGamma = Math.max(...gammaData.map(g => Math.abs(g.netGamma)), 0);
  const zeroGammaThreshold = 0.05 * maxNetGamma;

  // ── Steps 7–10: Assign highlights per strike ──
  // Priority: 1. Gamma Wall → 2. Gamma Pivot (Flip+Zero merged)
  // FIX: Cluster removed from display, Wall threshold → 0.95
  // FIX: Distance filter — only within ±3% of spot
  // FIX: Top-3 limit on total highlights
  interface HighlightEntry {
    strike: number;
    highlight: GammaHighlightType;
    ceGex: number;
    peGex: number;
    gexStrength: number; // For sorting to pick top-3
  }

  const allHighlights: HighlightEntry[] = [];

  for (let i = 0; i < gammaData.length; i++) {
    const g = gammaData[i];
    let highlight: GammaHighlightType = '';

    // FIX: Distance filter — skip strikes > 3% from spot
    if (g.distancePct > 3) {
      // Still record in map with empty highlight
      allHighlights.push({ strike: g.strike, highlight: '', ceGex: g.ceGex, peGex: g.peGex, gexStrength: 0 });
      continue;
    }

    // ── Priority 1: Gamma Wall (ratio ≥ 0.95) — FIX: was 0.90 ──
    if (g.ceRatio >= 0.95 && g.peRatio >= 0.95) {
      highlight = g.ceRatio > g.peRatio ? 'Gamma Wall CALL' : 'Gamma Wall PUT';
    } else if (g.ceRatio >= 0.95) {
      highlight = 'Gamma Wall CALL';
    } else if (g.peRatio >= 0.95) {
      highlight = 'Gamma Wall PUT';
    }

    // ── Priority 2: Gamma Pivot (merged Flip + Zero) ──
    if (!highlight) {
      // Flip: NetGamma sign change between consecutive strikes
      if (i > 0) {
        const prevNet = gammaData[i - 1].netGamma;
        const currNet = g.netGamma;
        if ((prevNet * currNet) < 0) {
          highlight = 'Gamma Pivot';
        }
      }

      // Zero: |NetGamma| ≤ threshold
      if (!highlight && maxNetGamma > 0 && Math.abs(g.netGamma) <= zeroGammaThreshold) {
        highlight = 'Gamma Pivot';
      }
    }

    // Clusters: computed internally but NOT displayed (per spec fix)
    // (No highlight assignment for clusters)

    const gexStrength = Math.max(g.ceGex, g.peGex, Math.abs(g.netGamma));
    allHighlights.push({
      strike: g.strike,
      highlight,
      ceGex: Number(g.ceGex.toFixed(2)),
      peGex: Number(g.peGex.toFixed(2)),
      gexStrength: highlight ? gexStrength : 0,
    });
  }

  // ── FIX: Top-3 limit — only keep top 3 highlights by GEX strength ──
  const highlighted = allHighlights.filter(h => h.highlight !== '');
  highlighted.sort((a, b) => b.gexStrength - a.gexStrength);
  const top3Strikes = new Set(highlighted.slice(0, 3).map(h => h.strike));

  // Clear highlights for non-top-3 strikes
  const gammaHighlights = new Map<number, { highlight: GammaHighlightType; ceGex: number; peGex: number }>();
  for (const h of allHighlights) {
    gammaHighlights.set(h.strike, {
      highlight: top3Strikes.has(h.strike) ? h.highlight : '',
      ceGex: h.ceGex,
      peGex: h.peGex,
    });
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  MODULE 1 — OI & Volume Ranking (Top-2 with Duplicate Handling)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const ceOiRankMap = rankTop2WithDuplicates(
    validRows.filter(r => r.ce.oi > 0).map(r => ({ strike: r.strike, value: r.ce.oi })),
  );
  const peOiRankMap = rankTop2WithDuplicates(
    validRows.filter(r => r.pe.oi > 0).map(r => ({ strike: r.strike, value: r.pe.oi })),
  );
  const ceVolRankMap = rankTop2WithDuplicates(
    validRows.filter(r => r.ce.volume > 0).map(r => ({ strike: r.strike, value: r.ce.volume })),
  );
  const peVolRankMap = rankTop2WithDuplicates(
    validRows.filter(r => r.pe.volume > 0).map(r => ({ strike: r.strike, value: r.pe.volume })),
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  BUILD PER-STRIKE HIGHLIGHTS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  for (const r of validRows) {
    const gh = gammaHighlights.get(r.strike);
    const ceGex = gh?.ceGex ?? 0;
    const peGex = gh?.peGex ?? 0;
    const highlight: GammaHighlightType = gh?.highlight || '';

    // ── MODULE 2: OI Shift Detection ──
    let ceOiShift: 'BUILD' | 'UNWIND' | null = null;
    let peOiShift: 'BUILD' | 'UNWIND' | null = null;
    let ceOiChange = 0;
    let peOiChange = 0;

    if (prevData) {
      const prev = prevData.get(r.strike);
      if (prev) {
        ceOiChange = r.ce.oi - prev.ceOi;
        peOiChange = r.pe.oi - prev.peOi;

        if (ceOiChange !== 0) {
          if (ceOiChange >= cfg.minOiChange) ceOiShift = 'BUILD';
          else if (ceOiChange <= -cfg.minOiChange) ceOiShift = 'UNWIND';
        }
        if (peOiChange !== 0) {
          if (peOiChange >= cfg.minOiChange) peOiShift = 'BUILD';
          else if (peOiChange <= -cfg.minOiChange) peOiShift = 'UNWIND';
        }
      }
    }

    // ── MODULE 3: Volume Shift Detection ──
    let ceVolShift = false;
    let peVolShift = false;
    let ceVolRatio = 0;
    let peVolRatio = 0;

    if (prevData && rollingAvgVols) {
      const prev = prevData.get(r.strike);
      if (prev) {
        const ceVolChange = r.ce.volume - prev.ceVol;
        const peVolChange = r.pe.volume - prev.peVol;

        const avgCeVol = rollingAvgVols.get(`${r.strike}_CE`) || 0;
        const avgPeVol = rollingAvgVols.get(`${r.strike}_PE`) || 0;

        if (avgCeVol > 0) {
          ceVolRatio = ceVolChange / avgCeVol;
          ceVolShift = ceVolRatio >= 2;
        }
        if (avgPeVol > 0) {
          peVolRatio = peVolChange / avgPeVol;
          peVolShift = peVolRatio >= 2;
        }
      }
    }

    map.set(r.strike, {
      highlight,
      ceGex: Number(ceGex.toFixed(2)),
      peGex: Number(peGex.toFixed(2)),
      ceOiRank: ceOiRankMap.get(r.strike) || 0,
      peOiRank: peOiRankMap.get(r.strike) || 0,
      ceVolRank: ceVolRankMap.get(r.strike) || 0,
      peVolRank: peVolRankMap.get(r.strike) || 0,
      ceOiShift,
      peOiShift,
      ceOiChange,
      peOiChange,
      ceVolShift,
      peVolShift,
      ceVolRatio,
      peVolRatio,
    });
  }

  return map;
}

// ── Helper: Rank Top-2 with Duplicate Handling ─────────────

function rankTop2WithDuplicates(
  items: { strike: number; value: number }[],
): Map<number, number> {
  const result = new Map<number, number>();
  if (items.length === 0) return result;

  const sorted = [...items].sort((a, b) => b.value - a.value);

  const highestValue = sorted[0].value;
  let secondValue: number | null = null;

  for (const item of sorted) {
    if (item.value < highestValue) {
      secondValue = item.value;
      break;
    }
  }

  for (const item of items) {
    if (item.value === highestValue) {
      result.set(item.strike, 1);
    } else if (secondValue !== null && item.value === secondValue) {
      result.set(item.strike, 2);
    }
  }

  return result;
}
