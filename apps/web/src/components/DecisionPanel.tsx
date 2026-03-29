/**
 * Decision Panel — Trade decision + pipeline trace display (§182-211)
 *
 * Displays: direction, strength (from confidence score), confidence score, pipeline trace.
 * Uses /engine/decision/:symbol and /engine/pipeline/:symbol endpoints
 * Read-only (§65, §70)
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Paper, Chip, Grid, LinearProgress, Tooltip,
} from '@mui/material';
import apiClient from '../api/client';

// ─── Types ───────────────────────────────────────────────

interface DecisionData {
  decision: string;
  strength: string;
  confidenceScore?: number;
  probability?: number;
  direction: string;
  analyticalDirection?: string | null;
  tradeZone?: string;
  mtfExecutionBlocked?: boolean;
  explanation: string;
  scores?: {
    scanner: number;
    range: number;
    health: number;
    flow: number;
    htf: number;
    total: number;
  };
}

interface PipelineData {
  symbol: string;
  stages: {
    name: string;
    status: string;
    latencyMs: number;
    result?: string;
    rejectionReason?: string;
  }[];
  finalResult: string;
  totalLatencyMs: number;
  timestamp: string;
}

// ─── Colors ──────────────────────────────────────────────

const DECISION_COLORS: Record<string, string> = {
  TRADE: '#4caf50',
  WAIT: '#ff9800',
  AVOID: '#f44336',
  HALT: '#f44336',
};

const STRENGTH_COLORS: Record<string, string> = {
  HIGH: '#4caf50',
  MEDIUM: '#ff9800',
  LOW: '#e91e63',
  VERY_LOW: '#f44336',
};

const STAGE_COLORS: Record<string, string> = {
  PASS: '#4caf50',
  FAIL: '#f44336',
  SKIP: '#9e9e9e',
  WARN: '#ff9800',
};

const DIRECTION_COLORS: Record<string, string> = {
  CE: '#4caf50',
  PE: '#f44336',
  NEUTRAL: '#9e9e9e',
};

// ─── Component ───────────────────────────────────────────

interface Props {
  symbol?: string;
}

const DecisionPanel: React.FC<Props> = ({ symbol = 'NIFTY' }) => {
  const [decision, setDecision] = useState<DecisionData | null>(null);
  const [pipeline, setPipeline] = useState<PipelineData | null>(null);

  const fetch = useCallback(async () => {
    try {
      const [dRes, pRes] = await Promise.all([
        apiClient.get(`/engine/decision/${symbol}`),
        apiClient.get(`/engine/pipeline/${symbol}`),
      ]);
      if (dRes.data?.success) setDecision(dRes.data.data);
      if (pRes.data?.success) setPipeline(pRes.data.data);
    } catch (err) {
      console.error('Decision fetch error:', err);
    }
  }, [symbol]);

  useEffect(() => {
    fetch();
    const iv = setInterval(fetch, 10000);
    return () => clearInterval(iv);
  }, [fetch]);

  if (!decision) return null;

  const conf = decision.confidenceScore ?? decision.probability ?? 0;
  const probColor = conf >= 75 ? '#4caf50' : conf >= 60 ? '#ff9800' : '#f44336';

  return (
    <Paper sx={{ p: 1.5, bgcolor: '#1a1a2e', borderRadius: 2, border: '1px solid #333' }}>
      {/* Header Row */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2" sx={{ color: '#ffd700', fontWeight: 700, fontSize: '0.85rem' }}>
          🎯 ANALYTICAL DIRECTION — {symbol}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          <Chip
            label={decision.decision}
            size="small"
            sx={{ bgcolor: DECISION_COLORS[decision.decision] || '#333', color: '#fff', fontWeight: 700, fontSize: '0.65rem', height: 20 }}
          />
          <Chip
            label={decision.direction}
            size="small"
            sx={{ bgcolor: DIRECTION_COLORS[decision.direction] || '#333', color: '#fff', fontWeight: 700, fontSize: '0.65rem', height: 20 }}
          />
          <Chip
            label={`${decision.strength} (from score)`}
            size="small"
            sx={{ bgcolor: STRENGTH_COLORS[decision.strength] || '#333', color: '#fff', fontWeight: 700, fontSize: '0.6rem', height: 18 }}
          />
        </Box>
      </Box>

      {(decision.tradeZone || decision.mtfExecutionBlocked) && (
        <Typography variant="caption" sx={{ color: '#888', fontSize: '0.55rem', display: 'block', mb: 0.5 }}>
          Trade zone: {decision.tradeZone ?? '—'}
          {decision.mtfExecutionBlocked ? ' · HTF≠MTF blocks simulated execution' : ''}
          {decision.analyticalDirection ? ` · Model bias: ${decision.analyticalDirection}` : ''}
        </Typography>
      )}

      {/* Confidence score */}
      <Box sx={{ mb: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
          <Typography variant="caption" sx={{ color: '#888', fontSize: '0.6rem' }}>Confidence score</Typography>
          <Typography variant="caption" sx={{ color: probColor, fontWeight: 700, fontSize: '0.7rem' }}>{conf}%</Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={Math.min(100, conf)}
          sx={{
            height: 6, borderRadius: 3, bgcolor: '#333',
            '& .MuiLinearProgress-bar': { bgcolor: probColor, borderRadius: 3 },
          }}
        />
      </Box>

      {/* Score breakdown (optional — from enriched API only) */}
      <Grid container spacing={0.5} sx={{ mb: 1 }}>
        {[
          { label: 'Scanner', value: decision.scores?.scanner ?? 0, max: 100 },
          { label: 'Range', value: decision.scores?.range ?? 0, max: 100 },
          { label: 'Health', value: decision.scores?.health ?? 0, max: 100 },
          { label: 'Flow', value: decision.scores?.flow ?? 0, max: 100 },
          { label: 'HTF', value: decision.scores?.htf ?? 0, max: 100 },
        ].map((s) => {
          const pct = Math.min((s.value / s.max) * 100, 100);
          const c = pct >= 70 ? '#4caf50' : pct >= 40 ? '#ff9800' : '#f44336';
          return (
            <Grid item xs key={s.label}>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="caption" sx={{ color: '#888', fontSize: '0.5rem', display: 'block' }}>{s.label}</Typography>
                <Typography variant="caption" sx={{ color: c, fontWeight: 700, fontSize: '0.7rem' }}>{s.value}</Typography>
                <LinearProgress
                  variant="determinate"
                  value={pct}
                  sx={{ height: 3, borderRadius: 2, bgcolor: '#333', mt: 0.3, '& .MuiLinearProgress-bar': { bgcolor: c } }}
                />
              </Box>
            </Grid>
          );
        })}
      </Grid>

      {/* Explanation (§200) */}
      <Box sx={{ mb: 1, p: 0.5, bgcolor: '#0d0d1a', borderRadius: 1 }}>
        <Typography variant="caption" sx={{ color: '#ccc', fontSize: '0.6rem', lineHeight: 1.4 }}>
          {decision.explanation}
        </Typography>
      </Box>

      {/* Pipeline Trace (§201-208) */}
      {pipeline && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
            <Typography variant="caption" sx={{ color: '#888', fontSize: '0.55rem', fontWeight: 700 }}>
              PIPELINE TRACE
            </Typography>
            <Typography variant="caption" sx={{ color: '#666', fontSize: '0.5rem' }}>
              {pipeline.totalLatencyMs}ms total
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.3, flexWrap: 'wrap' }}>
            {pipeline.stages.map((stage, i) => (
              <Tooltip
                key={i}
                title={
                  <Box>
                    <Typography variant="caption">{stage.name}: {stage.status}</Typography>
                    {stage.result && <Typography variant="caption" display="block">Result: {stage.result}</Typography>}
                    {stage.rejectionReason && <Typography variant="caption" display="block" color="error">Rejected: {stage.rejectionReason}</Typography>}
                    <Typography variant="caption" display="block">Latency: {stage.latencyMs}ms</Typography>
                  </Box>
                }
              >
                <Box sx={{
                  display: 'flex', alignItems: 'center', gap: 0.3, p: '2px 6px',
                  bgcolor: '#0d0d1a', borderRadius: 1,
                  border: `1px solid ${STAGE_COLORS[stage.status] || '#333'}`,
                }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: STAGE_COLORS[stage.status] || '#666' }} />
                  <Typography variant="caption" sx={{ color: '#ccc', fontSize: '0.5rem' }}>{stage.name}</Typography>
                  <Typography variant="caption" sx={{ color: '#666', fontSize: '0.45rem' }}>{stage.latencyMs}ms</Typography>
                </Box>
              </Tooltip>
            ))}
          </Box>

          {/* Rejected stages (§209) */}
          {pipeline.stages.filter(s => s.status === 'FAIL').map((s, i) => (
            <Typography key={i} variant="caption" sx={{ color: '#f44336', fontSize: '0.55rem', display: 'block', mt: 0.3 }}>
              ✗ {s.name}: {s.rejectionReason}
            </Typography>
          ))}
        </Box>
      )}
    </Paper>
  );
};

export default DecisionPanel;
