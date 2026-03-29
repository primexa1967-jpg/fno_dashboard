/**
 * Range Engine Panel — Read-only display of Range Analysis
 *
 * Spec: §64-65A (UI Display Read-Only), §37-38B (Output Structure)
 * Shows: Trade Zone (execution gate), Market context, Bias (display), Timing, Confidence, Guidance
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Chip, Paper, Grid, CircularProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import apiClient from '../api/client';

// ─────── TYPES (matching backend constants) ─────────────────

interface RangeData {
  tradeZone: string;
  marketZone: string;
  biasZone: string;
  timingZone: string;
  confidenceZone: string;
  expansionZone: string;
  alignmentZone: string;
  lateMove: boolean;
  guidance: string;
  input?: {
    atrPosition: string;
    emPosition: string;
    overlap: number;
    atrWidth: number;
    emWidth: number;
    rangeType: string;
  };
  raw?: {
    spotPrice: number;
    atrHigh: number;
    atrLow: number;
    emHigh: number;
    emLow: number;
    overlap: number;
  };
}

interface GlobalData {
  globalTradeZone: string;
  globalGuidance: string;
  indexResults: Record<string, RangeData>;
}

// ─────── COLOR MAPS ─────────────────────────────────────────

const TRADE_ZONE_COLORS: Record<string, string> = {
  TRADE: '#4caf50',
  WAIT: '#ff9800',
  NO_TRADE: '#f44336',
};

const CONFIDENCE_COLORS: Record<string, string> = {
  HIGH: '#4caf50',
  MEDIUM: '#2196f3',
  LOW: '#ff9800',
  VERY_LOW: '#f44336',
};

const BIAS_COLORS: Record<string, string> = {
  BULLISH: '#4caf50',
  BEARISH: '#f44336',
  NEUTRAL: '#9e9e9e',
};

const MARKET_ZONE_COLORS: Record<string, string> = {
  TREND_UP: '#4caf50',
  TREND_DOWN: '#f44336',
  WEAK_UP: '#81c784',
  WEAK_DOWN: '#e57373',
  SIDEWAYS: '#ff9800',
  CONFLICT: '#9e9e9e',
};

// ─────── COMPONENT ──────────────────────────────────────────

interface Props {
  symbol?: string;
}

const RangeEnginePanel: React.FC<Props> = ({ symbol }) => {
  const [rangeData, setRangeData] = useState<RangeData | null>(null);
  const [globalData, setGlobalData] = useState<GlobalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'single' | 'global'>('single');
  const [timeframe, setTimeframe] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  const fetchRange = useCallback(async () => {
    if (!symbol && view === 'single') return;
    setLoading(true);
    try {
      if (view === 'global') {
        const res = await apiClient.get('/engine/range/global');
        if (res.data?.success) setGlobalData(res.data.data);
      } else {
        const res = await apiClient.get(`/engine/range/${symbol}?timeframe=${timeframe}`);
        if (res.data?.success) setRangeData(res.data.data);
      }
    } catch (err) {
      console.error('Range fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [symbol, view, timeframe]);

  useEffect(() => {
    fetchRange();
    const interval = setInterval(fetchRange, 30000);
    return () => clearInterval(interval);
  }, [fetchRange]);

  const ZoneChip = ({ label, value, colorMap }: { label: string; value: string; colorMap: Record<string, string> }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
      <Typography variant="caption" sx={{ color: '#999', minWidth: 75, fontSize: '0.7rem' }}>{label}</Typography>
      <Chip
        label={value || '—'}
        size="small"
        sx={{
          bgcolor: colorMap[value] || '#616161',
          color: '#fff',
          fontWeight: 700,
          fontSize: '0.65rem',
          height: 20,
        }}
      />
    </Box>
  );

  return (
    <Paper sx={{ p: 1.5, bgcolor: '#1a1a2e', borderRadius: 2, border: '1px solid #333' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2" sx={{ color: '#ffd700', fontWeight: 700, fontSize: '0.85rem' }}>
          ⚡ RANGE ENGINE
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <ToggleButtonGroup
            value={view}
            exclusive
            onChange={(_, v) => v && setView(v)}
            size="small"
            sx={{ '& .MuiToggleButton-root': { px: 1, py: 0.2, fontSize: '0.6rem', color: '#aaa', '&.Mui-selected': { color: '#ffd700', bgcolor: 'rgba(255,215,0,0.1)' } } }}
          >
            <ToggleButton value="single">INDEX</ToggleButton>
            <ToggleButton value="global">GLOBAL</ToggleButton>
          </ToggleButtonGroup>
          {view === 'single' && (
            <ToggleButtonGroup
              value={timeframe}
              exclusive
              onChange={(_, v) => v && setTimeframe(v)}
              size="small"
              sx={{ '& .MuiToggleButton-root': { px: 1, py: 0.2, fontSize: '0.6rem', color: '#aaa', '&.Mui-selected': { color: '#ffd700', bgcolor: 'rgba(255,215,0,0.1)' } } }}
            >
              <ToggleButton value="daily">D</ToggleButton>
              <ToggleButton value="weekly">W</ToggleButton>
              <ToggleButton value="monthly">M</ToggleButton>
            </ToggleButtonGroup>
          )}
        </Box>
      </Box>

      {loading && <CircularProgress size={16} sx={{ color: '#ffd700', display: 'block', mx: 'auto', my: 1 }} />}

      {/* Single Index View */}
      {view === 'single' && rangeData && (
        <Box>
          {/* Trade Zone Banner */}
          <Box
            sx={{
              textAlign: 'center', py: 0.8, mb: 1, borderRadius: 1,
              bgcolor: TRADE_ZONE_COLORS[rangeData.tradeZone] || '#333',
              color: '#fff',
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.8rem' }}>
              {rangeData.tradeZone === 'TRADE' ? '✅ TRADE ALLOWED' :
               rangeData.tradeZone === 'WAIT' ? '⏳ WAIT' :
               '🚫 NO TRADE'}
            </Typography>
            <Typography variant="caption" sx={{ fontSize: '0.65rem', opacity: 0.9 }}>
              {rangeData.guidance}
            </Typography>
          </Box>

          {/* Zone Grid */}
          <Grid container spacing={1}>
            <Grid item xs={6}>
              <ZoneChip label="Market" value={rangeData.marketZone} colorMap={MARKET_ZONE_COLORS} />
              <ZoneChip label="Bias (display)" value={rangeData.biasZone} colorMap={BIAS_COLORS} />
              <ZoneChip label="Timing" value={rangeData.timingZone} colorMap={{ EARLY: '#4caf50', EARLY_TREND: '#2196f3', LATE: '#ff9800', UNDEFINED: '#9e9e9e' }} />
            </Grid>
            <Grid item xs={6}>
              <ZoneChip label="Confidence" value={rangeData.confidenceZone} colorMap={CONFIDENCE_COLORS} />
              <ZoneChip label="Expansion" value={rangeData.expansionZone} colorMap={{ EXPANSION: '#4caf50', EXHAUSTION: '#f44336', BALANCED: '#ff9800' }} />
              <ZoneChip label="Alignment" value={rangeData.alignmentZone} colorMap={{ STRONG: '#4caf50', PARTIAL: '#ff9800', CONFLICT: '#f44336' }} />
            </Grid>
          </Grid>

          {/* Raw Data */}
          {rangeData.raw && (
            <Box sx={{ mt: 1, p: 0.8, bgcolor: '#0d0d1a', borderRadius: 1, fontSize: '0.6rem' }}>
              <Typography variant="caption" sx={{ color: '#666', fontSize: '0.6rem' }}>
                Spot: {rangeData.raw.spotPrice?.toFixed(1)} | ATR: {rangeData.raw.atrLow?.toFixed(0)}-{rangeData.raw.atrHigh?.toFixed(0)} |
                EM: {rangeData.raw.emLow?.toFixed(0)}-{rangeData.raw.emHigh?.toFixed(0)} | Overlap: {rangeData.raw.overlap?.toFixed(1)}%
                {rangeData.lateMove && ' | ⚠️ LATE MOVE'}
              </Typography>
            </Box>
          )}
        </Box>
      )}

      {/* Global View */}
      {view === 'global' && globalData && (
        <Box>
          <Box
            sx={{
              textAlign: 'center', py: 0.5, mb: 1, borderRadius: 1,
              bgcolor: globalData.globalTradeZone === 'NO_TRADE' ? '#f44336' :
                       globalData.globalTradeZone === 'ALIGNED' ? '#4caf50' : '#ff9800',
              color: '#fff',
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.75rem' }}>
              GLOBAL: {globalData.globalTradeZone}
            </Typography>
            <Typography variant="caption" sx={{ fontSize: '0.6rem' }}>{globalData.globalGuidance}</Typography>
          </Box>

          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {['Index', 'Trade', 'Market', 'Bias', 'Conf'].map(h => (
                    <TableCell key={h} sx={{ color: '#999', fontSize: '0.6rem', py: 0.3, px: 0.5, borderBottom: '1px solid #333' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.entries(globalData.indexResults).map(([idx, r]) => (
                  <TableRow key={idx}>
                    <TableCell sx={{ color: '#fff', fontSize: '0.65rem', py: 0.2, px: 0.5, borderBottom: '1px solid #222' }}>{idx}</TableCell>
                    <TableCell sx={{ py: 0.2, px: 0.5, borderBottom: '1px solid #222' }}>
                      <Chip label={r.tradeZone} size="small" sx={{ bgcolor: TRADE_ZONE_COLORS[r.tradeZone] || '#333', color: '#fff', fontSize: '0.55rem', height: 18 }} />
                    </TableCell>
                    <TableCell sx={{ py: 0.2, px: 0.5, borderBottom: '1px solid #222' }}>
                      <Chip label={r.marketZone} size="small" sx={{ bgcolor: MARKET_ZONE_COLORS[r.marketZone] || '#333', color: '#fff', fontSize: '0.55rem', height: 18 }} />
                    </TableCell>
                    <TableCell sx={{ py: 0.2, px: 0.5, borderBottom: '1px solid #222' }}>
                      <Chip label={r.biasZone} size="small" sx={{ bgcolor: BIAS_COLORS[r.biasZone] || '#333', color: '#fff', fontSize: '0.55rem', height: 18 }} />
                    </TableCell>
                    <TableCell sx={{ py: 0.2, px: 0.5, borderBottom: '1px solid #222' }}>
                      <Chip label={r.confidenceZone} size="small" sx={{ bgcolor: CONFIDENCE_COLORS[r.confidenceZone] || '#333', color: '#fff', fontSize: '0.55rem', height: 18 }} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {!loading && !rangeData && !globalData && (
        <Typography variant="caption" sx={{ color: '#666', display: 'block', textAlign: 'center', py: 1 }}>
          {view === 'single' ? 'Select an index to view range analysis' : 'Loading global data...'}
        </Typography>
      )}
    </Paper>
  );
};

export default RangeEnginePanel;
