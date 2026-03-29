/**
 * System Health Panel — Real-time system health monitoring
 *
 * Spec: §146-181 (System Health Panel)
 * Displays: latency, cache, feed, API, data integrity, health score, mode
 * Read-only (§65, §70)
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Chip, Paper, LinearProgress, Grid, Tooltip,
} from '@mui/material';
import apiClient from '../api/client';

interface HealthData {
  latencyMs: number;
  latencyClass: string;
  cacheAgeSec: number;
  noTickTimeSec: number;
  feedStatus: string;
  apiStatus: string;
  dataIntegrity: string;
  healthScore: number;
  systemMode: string;
  systemState: string;
  signal: string;
  decision: string;
  topReasons: string[];
}

// ─────── COLORS (§274) ──────────────────────────────────────

const MODE_COLORS: Record<string, string> = {
  NORMAL: '#4caf50',
  CAUTION: '#ff9800',
  RESTRICTED: '#e91e63',
  HALT: '#f44336',
};

const STATUS_COLORS: Record<string, string> = {
  LIVE: '#4caf50', STALE: '#ff9800', DEAD: '#f44336',
  OK: '#4caf50', SLOW: '#ff9800', DEGRADED: '#e91e63', DOWN: '#f44336', FAIL: '#f44336',
  CLEAN: '#4caf50', PARTIAL: '#ff9800', CORRUPT: '#f44336',
  GOOD: '#4caf50', MODERATE: '#ff9800', RISK: '#e91e63', CRITICAL: '#f44336',
  ACTIVE: '#4caf50', HALTED: '#f44336', DISABLED: '#9e9e9e', ERROR: '#f44336',
};

const SystemHealthPanel: React.FC = () => {
  const [health, setHealth] = useState<HealthData | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await apiClient.get('/engine/health');
      if (res.data?.success) setHealth(res.data.data);
    } catch (err) {
      console.error('Health fetch error:', err);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 5000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  if (!health) return null;

  const StatusChip = ({ label, value }: { label: string; value: string }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Typography variant="caption" sx={{ color: '#888', minWidth: 52, fontSize: '0.6rem' }}>{label}</Typography>
      <Chip
        label={value}
        size="small"
        sx={{ bgcolor: STATUS_COLORS[value] || '#616161', color: '#fff', fontWeight: 700, fontSize: '0.6rem', height: 18 }}
      />
    </Box>
  );

  const scoreColor = health.healthScore >= 70 ? '#4caf50' : health.healthScore >= 40 ? '#ff9800' : '#f44336';

  return (
    <Paper sx={{ p: 1.5, bgcolor: '#1a1a2e', borderRadius: 2, border: '1px solid #333' }}>
      {/* Header with Health Score */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2" sx={{ color: '#ffd700', fontWeight: 700, fontSize: '0.85rem' }}>
          🏥 SYSTEM HEALTH
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip
            label={`${health.systemMode}`}
            size="small"
            sx={{ bgcolor: MODE_COLORS[health.systemMode] || '#333', color: '#fff', fontWeight: 700, fontSize: '0.6rem', height: 20 }}
          />
          <Tooltip title={`Health Score: ${health.healthScore}/100`}>
            <Box sx={{ position: 'relative', width: 36, height: 36 }}>
              <svg viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#333" strokeWidth="3" />
                <circle
                  cx="18" cy="18" r="15.9155" fill="none" stroke={scoreColor} strokeWidth="3"
                  strokeDasharray={`${health.healthScore} ${100 - health.healthScore}`}
                  strokeLinecap="round"
                />
              </svg>
              <Typography
                sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', color: scoreColor, fontWeight: 700, fontSize: '0.6rem' }}
              >
                {health.healthScore}
              </Typography>
            </Box>
          </Tooltip>
        </Box>
      </Box>

      {/* Status Grid */}
      <Grid container spacing={0.5} sx={{ mb: 1 }}>
        <Grid item xs={6}>
          <StatusChip label="Feed" value={health.feedStatus} />
          <StatusChip label="API" value={health.apiStatus} />
          <StatusChip label="Data" value={health.dataIntegrity} />
        </Grid>
        <Grid item xs={6}>
          <StatusChip label="Latency" value={health.latencyClass} />
          <StatusChip label="State" value={health.systemState} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="caption" sx={{ color: '#888', minWidth: 52, fontSize: '0.6rem' }}>Cache</Typography>
            <Typography variant="caption" sx={{ color: health.cacheAgeSec > 10 ? '#f44336' : health.cacheAgeSec > 5 ? '#ff9800' : '#4caf50', fontSize: '0.65rem', fontWeight: 600 }}>
              {health.cacheAgeSec.toFixed(0)}s
            </Typography>
          </Box>
        </Grid>
      </Grid>

      {/* Health Bar */}
      <LinearProgress
        variant="determinate"
        value={health.healthScore}
        sx={{
          height: 4, borderRadius: 2, mb: 0.5,
          bgcolor: '#333',
          '& .MuiLinearProgress-bar': { bgcolor: scoreColor },
        }}
      />

      {/* Model output (health) & trade-zone strip */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.5 }}>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Typography variant="caption" sx={{ color: '#888', fontSize: '0.6rem' }}>Model output:</Typography>
          <Typography variant="caption" sx={{
            color: health.signal === 'BUY' ? '#4caf50' : health.signal === 'SELL' ? '#f44336' : '#9e9e9e',
            fontWeight: 700, fontSize: '0.65rem',
          }}>
            {health.signal}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Typography variant="caption" sx={{ color: '#888', fontSize: '0.6rem' }}>Trade zone:</Typography>
          <Typography variant="caption" sx={{
            color: health.decision === 'TRADE' ? '#4caf50' : health.decision === 'WAIT' ? '#ff9800' : '#f44336',
            fontWeight: 700, fontSize: '0.65rem',
          }}>
            {health.decision}
          </Typography>
        </Box>
        <Typography variant="caption" sx={{ color: '#666', fontSize: '0.55rem' }}>
          Lat: {health.latencyMs}ms | Tick: {health.noTickTimeSec.toFixed(0)}s
        </Typography>
      </Box>

      {/* Top Reasons (§180) */}
      {health.topReasons.length > 0 && (
        <Box sx={{ mt: 0.5 }}>
          {health.topReasons.map((r, i) => (
            <Typography key={i} variant="caption" sx={{ color: '#999', fontSize: '0.55rem', display: 'block' }}>
              • {r}
            </Typography>
          ))}
        </Box>
      )}
    </Paper>
  );
};

export default SystemHealthPanel;
