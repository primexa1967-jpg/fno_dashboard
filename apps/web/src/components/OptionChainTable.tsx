import React from 'react';
import { Box, Typography, CircularProgress, Paper } from '@mui/material';
import { useOptionChain } from '../hooks/useOptionChain';
import { useIVDEX } from '../hooks/useIVDEX';

interface OptionChainTableProps {
  symbol: string;
  expiry: string;
  interval?: string;
}

// ── Highlight colour map ──────────────────────────────────
const HIGHLIGHT_COLORS: Record<string, string> = {
  'Gamma Wall CALL':      '#8A2BE2',   // BlueViolet (138, 43, 226)
  'Gamma Wall PUT':       '#FF8C00',   // DarkOrange (255, 140, 0)
  'Gamma Flip':           '#FF00FF',   // Magenta (255, 0, 255)
  'Zero Gamma':           '#FF69B4',   // HotPink (255, 105, 180)
  'Call Gamma Cluster':   '#9370DB',   // MediumPurple (147, 112, 219)
  'Put Gamma Cluster':    '#FFC107',   // Amber (255, 193, 7)
};

// Module 1: OI rank background (top-2 only per spec)
// Rank 1 = Highest OI → Light Green #90EE90
// Rank 2 = Second OI  → Light Yellow #FFFF99
const OI_RANK_COLORS: Record<number, string> = { 1: '#90EE90', 2: '#FFFF99' };

// Module 1: Volume rank background (top-2 only per spec)
// Rank 1 = Highest Volume → Dark Teal #008080
// Rank 2 = Second Volume  → Light Teal #66CCCC
const VOL_RANK_COLORS: Record<number, string> = { 1: '#008080', 2: '#66CCCC' };

// Module 2: OI Shift colors (BUILD / UNWIND per CE/PE side)
const OI_SHIFT_COLORS = {
  CE_BUILD: '#FF6B6B',    // Red
  CE_UNWIND: '#FFC0C0',   // Light Red
  PE_BUILD: '#4DA6FF',    // Blue
  PE_UNWIND: '#BFDFFF',   // Light Blue
};

// Module 3: Volume Shift colors
const VOL_SHIFT_COLORS = {
  CE: '#FFA500',   // Orange
  PE: '#00CED1',   // Cyan
};

/**
 * Row 6: Option Chain Table - Mirrored Layout
 * 17-column table: 8 CE (left) + Strike/PCR (center) + 8 PE (right)
 *
 * Column order per side (CE left → center, PE center → right):
 *   Built Up | TV·itm/IV | Volume | Delta/Gamma | **Highlight** | OI/OI Chg | OI Chg % | LTP/LTP Chg
 *
 * "Alpha/Vega" column replaced by "Highlight" showing Gamma highlight label + GEX.
 */
export default function OptionChainTable({
  symbol,
  expiry,
  interval = '1D',
}: OptionChainTableProps) {
  const { data: restData, isLoading, error } = useOptionChain(symbol, expiry, interval);
  const { data: ivData } = useIVDEX(symbol);

  let data = restData ? {
    ...restData,
    strikes: restData.strikes || restData.rows || []
  } : null;

  // Spec C: backend sends ±8 strikes from ATM (17 rows) — display all received strikes

  if (isLoading && !data) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '40px' }}>
        <CircularProgress />
        <Typography sx={{ ml: 2 }}>Loading Option Chain...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ padding: '20px', textAlign: 'center', color: '#f44336' }}>
        <Typography>Failed to load option chain</Typography>
      </Box>
    );
  }

  if (!data) return null;

  const atmStrike = data.atmStrike || data.spotPrice || data.spot || 0;
  const spotPrice = data.spotPrice || data.spot || 0;

  const hasAnyData = data.strikes?.some((strike: any) => {
    const isNearATM = Math.abs(strike.strike - atmStrike) < 500;
    if (!isNearATM) return false;
    return (strike.ce?.oi > 0 || strike.ce?.ltp > 0.5 || strike.ce?.volume > 0) ||
           (strike.pe?.oi > 0 || strike.pe?.ltp > 0.5 || strike.pe?.volume > 0);
  });

  if (!hasAnyData && data.strikes?.length > 0) {
    return (
      <Box sx={{ padding: '40px', textAlign: 'center', backgroundColor: '#1E1E1E', borderRadius: 2 }}>
        <Typography variant="h6" sx={{ color: '#ff9800', mb: 2 }}>⚠️ No Trading Data Available</Typography>
        <Typography sx={{ color: '#ffffff', mb: 1 }}>
          The market appears to be closed or there is no trading activity for the selected expiry.
        </Typography>
        <Typography variant="body2" sx={{ color: '#9e9e9e' }}>
          Current Date: {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </Typography>
        <Typography variant="body2" sx={{ color: '#9e9e9e', mt: 1 }}>Selected Expiry: {expiry}</Typography>
        <Typography variant="body2" sx={{ color: '#4caf50', mt: 2 }}>💡 Try selecting a different expiry or check back during market hours (9:15 AM - 3:30 PM IST)</Typography>
      </Box>
    );
  }

  // ── Helpers ──
  const getStrikePrice = (strike: any): number => strike.strike || strike.strikePrice || 0;

  const getCE = (strike: any) => ({
    oi: strike.ce?.oi || strike.ceOI || 0,
    oiChg: strike.ce?.oiChg ?? strike.ceOIChange ?? 0,
    oiChgPercent: strike.ce?.oiChgPercent ?? strike.ce?.oiChgPct ?? 0,
    volume: strike.ce?.volume || strike.ceVolume || strike.ce?.traded_volume || 0,
    iv: strike.ce?.iv || strike.ceIV || 0,
    ltp: strike.ce?.ltp || strike.ceLTP || 0,
    chg: strike.ce?.chg ?? strike.ceLTPChange ?? 0,
    delta: strike.ce?.delta || strike.ceDelta || 0,
    gamma: strike.ce?.gamma || strike.ceGamma || 0,
    vega: strike.ce?.vega || strike.ceVega || 0,
    theta: strike.ce?.theta || strike.ceTheta || 0,
    builtUp: strike.ce?.builtUp || strike.ceBuiltUp || '-',
  });

  const getPE = (strike: any) => ({
    oi: strike.pe?.oi || strike.peOI || 0,
    oiChg: strike.pe?.oiChg ?? strike.peOIChange ?? 0,
    oiChgPercent: strike.pe?.oiChgPercent ?? strike.pe?.oiChgPct ?? 0,
    volume: strike.pe?.volume || strike.peVolume || strike.pe?.traded_volume || 0,
    iv: strike.pe?.iv || strike.peIV || 0,
    ltp: strike.pe?.ltp || strike.peLTP || 0,
    chg: strike.pe?.chg ?? strike.peLTPChange ?? 0,
    delta: strike.pe?.delta || strike.peDelta || 0,
    gamma: strike.pe?.gamma || strike.peGamma || 0,
    vega: strike.pe?.vega || strike.peVega || 0,
    theta: strike.pe?.theta || strike.peTheta || 0,
    builtUp: strike.pe?.builtUp || strike.peBuiltUp || '-',
  });

  const getBuiltUpColor = (builtUp: string): string => {
    const n = builtUp.toLowerCase().replace(/\s+/g, ' ').trim();
    if (n.includes('long build') || n.includes('long built')) return '#4caf50';
    if (n.includes('short cover')) return '#4caf50';
    if (n.includes('short build') || n.includes('short built')) return '#f44336';
    if (n.includes('long unwind')) return '#f44336';
    return 'transparent';
  };

  const getBuiltUpTextColor = (_builtUp: string): string => '#ffffff';

  const calculateDelta = (strike: number, spotPrice: number, optionType: string): number => {
    const moneyness = optionType === 'CE'
      ? (spotPrice - strike) / spotPrice
      : (strike - spotPrice) / spotPrice;
    if (optionType === 'CE') {
      return moneyness > 0 ? Math.min(0.5 + (moneyness * 50), 1) : Math.max(0.5 - (Math.abs(moneyness) * 50), 0);
    } else {
      return moneyness > 0 ? Math.max(-0.5 - (moneyness * 50), -1) : Math.min(-0.5 + (Math.abs(moneyness) * 50), 0);
    }
  };

  const calculateOIChangePercent = (oi: number, oiChange: number): number => {
    if (!oi || !oiChange || isNaN(oi) || isNaN(oiChange)) return 0;
    const prevOI = oi - oiChange;
    return prevOI > 0 ? (oiChange / prevOI) * 100 : 0;
  };

  const formatNumber = (num: number): string => {
    const abs = Math.abs(num);
    const sign = num < 0 ? '-' : '';
    if (abs >= 1000000) return `${sign}${(abs / 1000000).toFixed(2)}M`;
    if (abs >= 1000) return `${sign}${Math.round(abs / 1000)}K`;
    return num.toString();
  };

  const calculateTimeValue = (ltp: number, spotPrice: number, strikePrice: number, isCall: boolean): number => {
    const intrinsicValue = isCall ? Math.max(0, spotPrice - strikePrice) : Math.max(0, strikePrice - spotPrice);
    return ltp - intrinsicValue;
  };

  const computeBuiltUp = (chg: number, oiChg: number, apiBuiltUp: string): string => {
    if (apiBuiltUp && apiBuiltUp.length > 2 && apiBuiltUp !== '-') return apiBuiltUp;
    if (apiBuiltUp === 'LB') return 'Long Build Up';
    if (apiBuiltUp === 'SB') return 'Short Build Up';
    if (apiBuiltUp === 'SC') return 'Short Cover';
    if (apiBuiltUp === 'LU') return 'Long Unwinding';
    if (chg > 0 && oiChg > 0) return 'Long Build Up';
    if (chg < 0 && oiChg > 0) return 'Short Build Up';
    if (chg > 0 && oiChg < 0) return 'Short Cover';
    if (chg < 0 && oiChg < 0) return 'Long Unwinding';
    return '-';
  };

  // (Cell BG logic now inline per spec C — rank and shift handled separately)

  return (
    <Box sx={{ width: '100%', overflowX: 'auto', position: 'relative' }}>
      <Paper elevation={2} sx={{ borderRadius: 2 }}>
        {/* Spec: Last Update Timestamp */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, py: 0.5, bgcolor: '#121212' }}>
          <Typography variant="body2" sx={{ fontWeight: 'bold', color: '#fff' }}>
            Spot: ₹{((data.spotPrice || data.spot) ?? 0).toLocaleString()}
          </Typography>
          <Typography variant="caption" sx={{ color: '#78909c' }}>
            Last Updated: {data.timestamp ? new Date(data.timestamp).toLocaleTimeString('en-IN', { hour12: true, timeZone: 'Asia/Kolkata' }) : '-'}
          </Typography>
        </Box>

        {/* 17-column grid */}
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(8, 1fr) 150px repeat(8, 1fr)',
          gap: '1px',
          background: '#e0e0e0',
          p: 0,
          maxHeight: '800px',
          overflowY: 'auto',
          position: 'relative'
        }}>
          {/* ── Sticky Headers ── */}
          {/* CE */}
          <StickyHeaderCell bgColor="#4caf50" color="white">Built Up</StickyHeaderCell>
          <StickyHeaderCell bgColor="#4caf50" color="white">TVitm/IV</StickyHeaderCell>
          <StickyHeaderCell bgColor="#4caf50" color="white">Volume</StickyHeaderCell>
          <StickyHeaderCell bgColor="#4caf50" color="white">Delta/Gamma</StickyHeaderCell>
          <StickyHeaderCell bgColor="#4caf50" color="white">Highlight</StickyHeaderCell>
          <StickyHeaderCell bgColor="#4caf50" color="white">OI/OI Chg</StickyHeaderCell>
          <StickyHeaderCell bgColor="#4caf50" color="white">OI Chg %</StickyHeaderCell>
          <StickyHeaderCell bgColor="#4caf50" color="white">LTP/LTP Chg</StickyHeaderCell>

          {/* Center */}
          <StickyHeaderCell bgColor="#424242" color="white">
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Typography sx={{ fontSize: '0.85rem', fontWeight: 600 }}>Strike/PCR</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, justifyContent: 'center' }}>
                <Typography sx={{ fontSize: '0.7rem' }}>IV: {ivData?.currentIV || '15.5'}</Typography>
                <Typography sx={{ fontSize: '0.85rem', fontWeight: 'bold', color: ivData?.trendColor || '#fff' }}>
                  {ivData?.trend || '→'}
                </Typography>
              </Box>
            </Box>
          </StickyHeaderCell>

          {/* PE */}
          <StickyHeaderCell bgColor="#f44336" color="white">LTP/LTP Chg</StickyHeaderCell>
          <StickyHeaderCell bgColor="#f44336" color="white">OI Chg %</StickyHeaderCell>
          <StickyHeaderCell bgColor="#f44336" color="white">OI/OI Chg</StickyHeaderCell>
          <StickyHeaderCell bgColor="#f44336" color="white">Highlight</StickyHeaderCell>
          <StickyHeaderCell bgColor="#f44336" color="white">Delta/Gamma</StickyHeaderCell>
          <StickyHeaderCell bgColor="#f44336" color="white">Volume</StickyHeaderCell>
          <StickyHeaderCell bgColor="#f44336" color="white">TVitm/IV</StickyHeaderCell>
          <StickyHeaderCell bgColor="#f44336" color="white">Built Up</StickyHeaderCell>

          {/* ── Data Rows ── */}
          {(data.strikes || []).map((strike: any) => {
            const strikePrice = getStrikePrice(strike);
            const ce = getCE(strike);
            const pe = getPE(strike);
            const pcr = ce.oi > 0 ? pe.oi / ce.oi : 0;
            const isATM = strike.isATM || strike.isSpotStrike;

            const ceDelta = ce.delta || calculateDelta(strikePrice, spotPrice, 'CE');
            const peDelta = pe.delta || calculateDelta(strikePrice, spotPrice, 'PE');
            const ceOIChangePercent = (strike.ce?.oiChgPercent ?? strike.ce?.oiChgPct) || calculateOIChangePercent(ce.oi, ce.oiChg);
            const peOIChangePercent = (strike.pe?.oiChgPercent ?? strike.pe?.oiChgPct) || calculateOIChangePercent(pe.oi, pe.oiChg);

            const ceBuildup = computeBuiltUp(ce.chg, ce.oiChg, ce.builtUp);
            const peBuildup = computeBuiltUp(pe.chg, pe.oiChg, pe.builtUp);
            const ceBuiltUpColor = getBuiltUpColor(ceBuildup);
            const peBuiltUpColor = getBuiltUpColor(peBuildup);
            const ceBuiltUpTextColor = getBuiltUpTextColor(ceBuildup);
            const peBuiltUpTextColor = getBuiltUpTextColor(peBuildup);

            // Highlight data from backend
            const hlLabel: string = strike.highlight || '';
            const ceGex: number = strike.ceGex || 0;
            const peGex: number = strike.peGex || 0;
            const ceOiRank: number = strike.ceOiRank || 0;
            const peOiRank: number = strike.peOiRank || 0;
            const ceVolRank: number = strike.ceVolRank || 0;
            const peVolRank: number = strike.peVolRank || 0;

            // Module 2: OI Shift — 'BUILD' | 'UNWIND' | null
            const ceOiShift: string | null = strike.ceOiShift || null;
            const peOiShift: string | null = strike.peOiShift || null;

            // Module 3: Volume Shift — boolean
            const ceVolShift: boolean = strike.ceVolShift || false;
            const peVolShift: boolean = strike.peVolShift || false;

            // ── Cell Background Colours (Spec C) ──

            // Module 1: OI rank (top-2 only) — for OI value cells
            const ceOiBg = OI_RANK_COLORS[ceOiRank] || '#1E1E1E';
            const peOiBg = OI_RANK_COLORS[peOiRank] || '#1E1E1E';

            // Module 2: OI shift (BUILD / UNWIND) — for OI Chg % cells
            const ceOiShiftBg = ceOiShift === 'BUILD' ? OI_SHIFT_COLORS.CE_BUILD
              : ceOiShift === 'UNWIND' ? OI_SHIFT_COLORS.CE_UNWIND
              : '#1E1E1E';
            const peOiShiftBg = peOiShift === 'BUILD' ? OI_SHIFT_COLORS.PE_BUILD
              : peOiShift === 'UNWIND' ? OI_SHIFT_COLORS.PE_UNWIND
              : '#1E1E1E';

            // Module 3: Volume shift overrides volume rank (spec override rule)
            const ceVolBg = ceVolShift ? VOL_SHIFT_COLORS.CE
              : VOL_RANK_COLORS[ceVolRank] || '#1E1E1E';
            const peVolBg = peVolShift ? VOL_SHIFT_COLORS.PE
              : VOL_RANK_COLORS[peVolRank] || '#1E1E1E';

            // ATM row highlight
            const atmBg = isATM ? '#4A90E2' : undefined;

            // Highlight column colour
            const hlColor = HIGHLIGHT_COLORS[hlLabel] || 'transparent';

            return (
              <React.Fragment key={strikePrice}>
                {/* ── CE Side (Left) ── */}

                {/* 1. Built Up */}
                <DataCell bgColor="#1E1E1E" color="#ffffff">
                  {ceBuildup !== '-' && (
                    <Box sx={{ px: 0.5, py: 0.25, borderRadius: 1, background: ceBuiltUpColor, color: ceBuiltUpTextColor, fontWeight: 600, fontSize: '0.75rem', display: 'inline-block' }}>
                      {ceBuildup}
                    </Box>
                  )}
                </DataCell>

                {/* 2. TV/IV */}
                <DataCell bgColor="#1E1E1E" color="#ffffff">
                  <MergedCell
                    top={ce.ltp > 0 ? calculateTimeValue(ce.ltp, spotPrice, strikePrice, true).toFixed(2) : '-'}
                    bottom={ce.iv > 0 ? ce.iv.toFixed(2) : '-'}
                  />
                </DataCell>

                {/* 3. Volume (with vol rank/shift bg) */}
                <DataCell bgColor={ceVolBg} color={ceVolBg !== '#1E1E1E' ? '#000' : '#fff'}>
                  {formatNumber(ce.volume)}
                  {ceVolRank > 0 && <Typography sx={{ fontSize: '0.65rem', color: '#000', opacity: 0.7 }}>#{ceVolRank}</Typography>}
                </DataCell>

                {/* 4. Delta/Gamma */}
                <DataCell bgColor="#1E1E1E" color="#ffffff">
                  <MergedCell
                    top={ce.delta ? ce.delta.toFixed(4) : ceDelta.toFixed(2)}
                    bottom={ce.gamma ? ce.gamma.toFixed(4) : '-'}
                  />
                </DataCell>

                {/* 5. HIGHLIGHT (replaces Alpha/Vega) */}
                <DataCell bgColor={hlColor !== 'transparent' ? hlColor : '#1E1E1E'} color="#ffffff">
                  {hlLabel ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, lineHeight: 1.2 }}>{hlLabel}</Typography>
                      <Typography sx={{ fontSize: '0.65rem', opacity: 0.8 }}>GEX {formatNumber(ceGex)}</Typography>
                    </Box>
                  ) : (
                    <Typography sx={{ fontSize: '0.65rem', opacity: 0.5 }}>-</Typography>
                  )}
                </DataCell>

                {/* 6. OI/OI Chg (with OI rank/shift bg) */}
                <DataCell bgColor={ceOiBg} color={ceOiBg !== '#1E1E1E' ? '#000' : '#fff'}>
                  <MergedCell
                    top={formatNumber(ce.oi)}
                    bottom={`${ce.oiChg > 0 ? '+' : ''}${formatNumber(ce.oiChg)}`}
                    bottomColor={ce.oiChg > 0 ? '#4caf50' : ce.oiChg < 0 ? '#f44336' : undefined}
                    forceTopColor={ceOiBg !== '#1E1E1E' ? '#000' : undefined}
                    forceBottomColor={ceOiBg !== '#1E1E1E' ? (ce.oiChg > 0 ? '#1b5e20' : ce.oiChg < 0 ? '#b71c1c' : '#000') : undefined}
                  />
                  {ceOiRank > 0 && <Typography sx={{ fontSize: '0.6rem', color: '#000', opacity: 0.7 }}>#{ceOiRank}</Typography>}
                </DataCell>

                {/* 7. OI Chg % (Module 2: OI Shift colors) */}
                <DataCell bgColor={ceOiShiftBg} color={ceOiShiftBg !== '#1E1E1E' ? '#000' : '#fff'}>
                  <Typography sx={{ color: ceOiShiftBg !== '#1E1E1E' ? '#000' : (ceOIChangePercent > 0 ? '#4caf50' : ceOIChangePercent < 0 ? '#f44336' : '#ffffff'), fontWeight: 600, fontSize: '1.0rem' }}>
                    {ceOIChangePercent.toFixed(1)}%
                  </Typography>
                  {ceOiShift && <Typography sx={{ fontSize: '0.6rem', color: '#000', opacity: 0.8 }}>{ceOiShift}</Typography>}
                </DataCell>

                {/* 8. LTP/LTP Chg */}
                <DataCell bgColor="#1E1E1E" color="#ffffff">
                  <MergedCell
                    top={`₹${ce.ltp.toFixed(2)}`}
                    bottom={`${ce.chg > 0 ? '+' : ''}${ce.chg.toFixed(2)}`}
                    bottomColor={ce.chg > 0 ? '#4caf50' : ce.chg < 0 ? '#f44336' : undefined}
                  />
                </DataCell>

                {/* ── Center: Strike / PCR ── */}
                <DataCell bgColor={atmBg || (isATM ? '#424242' : '#1E1E1E')} color="#ffffff">
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <Typography variant="body1" sx={{ fontWeight: 700, fontSize: '1.2rem', color: isATM ? '#ffeb3b' : '#ffffff' }}>
                      {strikePrice}
                    </Typography>
                    <Typography variant="caption" sx={{ fontSize: '1.0rem', color: pcr > 1.3 ? '#4caf50' : pcr < 0.6 ? '#f44336' : '#ffffff' }}>
                      {pcr.toFixed(2)}
                    </Typography>
                  </Box>
                </DataCell>

                {/* ── PE Side (Right) ── */}

                {/* 1. LTP/LTP Chg */}
                <DataCell bgColor="#1E1E1E" color="#ffffff">
                  <MergedCell
                    top={`₹${pe.ltp.toFixed(2)}`}
                    bottom={`${pe.chg > 0 ? '+' : ''}${pe.chg.toFixed(2)}`}
                    bottomColor={pe.chg > 0 ? '#4caf50' : pe.chg < 0 ? '#f44336' : undefined}
                  />
                </DataCell>

                {/* 2. OI Chg % (Module 2: OI Shift colors) */}
                <DataCell bgColor={peOiShiftBg} color={peOiShiftBg !== '#1E1E1E' ? '#000' : '#fff'}>
                  <Typography sx={{ color: peOiShiftBg !== '#1E1E1E' ? '#000' : (peOIChangePercent > 0 ? '#4caf50' : peOIChangePercent < 0 ? '#f44336' : '#ffffff'), fontWeight: 600, fontSize: '1.0rem' }}>
                    {peOIChangePercent.toFixed(1)}%
                  </Typography>
                  {peOiShift && <Typography sx={{ fontSize: '0.6rem', color: '#000', opacity: 0.8 }}>{peOiShift}</Typography>}
                </DataCell>

                {/* 3. OI/OI Chg */}
                <DataCell bgColor={peOiBg} color={peOiBg !== '#1E1E1E' ? '#000' : '#fff'}>
                  <MergedCell
                    top={formatNumber(pe.oi)}
                    bottom={`${pe.oiChg > 0 ? '+' : ''}${formatNumber(pe.oiChg)}`}
                    bottomColor={pe.oiChg > 0 ? '#4caf50' : pe.oiChg < 0 ? '#f44336' : undefined}
                    forceTopColor={peOiBg !== '#1E1E1E' ? '#000' : undefined}
                    forceBottomColor={peOiBg !== '#1E1E1E' ? (pe.oiChg > 0 ? '#1b5e20' : pe.oiChg < 0 ? '#b71c1c' : '#000') : undefined}
                  />
                  {peOiRank > 0 && <Typography sx={{ fontSize: '0.6rem', color: '#000', opacity: 0.7 }}>#{peOiRank}</Typography>}
                </DataCell>

                {/* 4. Highlight */}
                <DataCell bgColor={hlColor !== 'transparent' ? hlColor : '#1E1E1E'} color="#ffffff">
                  {hlLabel ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, lineHeight: 1.2 }}>{hlLabel}</Typography>
                      <Typography sx={{ fontSize: '0.65rem', opacity: 0.8 }}>GEX {formatNumber(peGex)}</Typography>
                    </Box>
                  ) : (
                    <Typography sx={{ fontSize: '0.65rem', opacity: 0.5 }}>-</Typography>
                  )}
                </DataCell>

                {/* 5. Delta/Gamma */}
                <DataCell bgColor="#1E1E1E" color="#ffffff">
                  <MergedCell
                    top={pe.delta ? pe.delta.toFixed(4) : peDelta.toFixed(2)}
                    bottom={pe.gamma ? pe.gamma.toFixed(4) : '-'}
                  />
                </DataCell>

                {/* 6. Volume */}
                <DataCell bgColor={peVolBg} color={peVolBg !== '#1E1E1E' ? '#000' : '#fff'}>
                  {formatNumber(pe.volume)}
                  {peVolRank > 0 && <Typography sx={{ fontSize: '0.65rem', color: '#000', opacity: 0.7 }}>#{peVolRank}</Typography>}
                </DataCell>

                {/* 7. TV/IV */}
                <DataCell bgColor="#1E1E1E" color="#ffffff">
                  <MergedCell
                    top={pe.ltp > 0 ? calculateTimeValue(pe.ltp, spotPrice, strikePrice, false).toFixed(2) : '-'}
                    bottom={pe.iv > 0 ? pe.iv.toFixed(2) : '-'}
                  />
                </DataCell>

                {/* 8. Built Up */}
                <DataCell bgColor="#1E1E1E" color="#ffffff">
                  {peBuildup !== '-' && (
                    <Box sx={{ px: 0.5, py: 0.25, borderRadius: 1, background: peBuiltUpColor, color: peBuiltUpTextColor, fontWeight: 600, fontSize: '0.75rem', display: 'inline-block' }}>
                      {peBuildup}
                    </Box>
                  )}
                </DataCell>
              </React.Fragment>
            );
          })}
        </Box>
      </Paper>
    </Box>
  );
}

// ── Sub-components ─────────────────────────────────────────

function StickyHeaderCell({ children, bgColor, color = '#000' }: { children?: React.ReactNode; bgColor: string; color?: string }) {
  return (
    <Box sx={{ position: 'sticky', top: 0, zIndex: 10, background: bgColor, color, p: 1, textAlign: 'center', fontWeight: 600, fontSize: '0.85rem', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
      {children}
    </Box>
  );
}

function DataCell({ children, bgColor, color = '#ffffff' }: { children?: React.ReactNode; bgColor: string; color?: string }) {
  return (
    <Box sx={{ background: bgColor, color, p: 1, textAlign: 'center', fontSize: '1.0rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50px', fontWeight: 500 }}>
      {children}
    </Box>
  );
}

function MergedCell({
  top,
  bottom,
  bottomColor,
  forceTopColor,
  forceBottomColor,
}: {
  top: string;
  bottom: string;
  bottomColor?: string;
  forceTopColor?: string;
  forceBottomColor?: string;
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '1.0rem', color: forceTopColor || '#ffffff' }}>
        {top}
      </Typography>
      <Typography variant="caption" sx={{ fontSize: '0.85rem', color: forceBottomColor || bottomColor || '#b0b0b0', fontWeight: 500 }}>
        {bottom}
      </Typography>
    </Box>
  );
}
