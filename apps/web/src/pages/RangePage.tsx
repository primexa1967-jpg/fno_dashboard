import { useState, useEffect, useMemo } from 'react';
import apiClient from '../api/client';
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
  IconButton,
  Tooltip,
  Tabs,
  Tab,
  ToggleButton,
  ToggleButtonGroup,
  Divider,
} from '@mui/material';
import { Refresh, ArrowBack } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

type TimeFrame = 'daily' | 'weekly' | 'monthly';

const RANGE_PRIMARY_KEYS = [
  'NIFTY',
  'BANKNIFTY',
  'FINNIFTY',
  'MIDCAPNIFTY',
  'SENSEX',
  'BANKEX',
] as const;

type PrimarySymbol = (typeof RANGE_PRIMARY_KEYS)[number];

/** Display labels (match API symbol keys above) */
const PRIMARY_INDEX_LABELS: Record<PrimarySymbol, string> = {
  NIFTY: 'Nifty50',
  BANKNIFTY: 'BankNifty',
  FINNIFTY: 'FinNifty',
  MIDCAPNIFTY: 'MidcapNifty',
  SENSEX: 'Sensex',
  BANKEX: 'Bankex',
};

interface RangeDecisionPanel {
  primarySymbol: PrimarySymbol;
  timeframe: TimeFrame;
  dataAvailable: boolean;
  dataIssue?: string;
  overlapPercent: number;
  marketState: string;
  confidence: string;
  volatility: string;
  alignment: string;
  distance: string;
  edge: string;
  setup: string;
  strategy: string;
  timing: string;
  volatilityUsage: string;
  reasons: string[];
}

type DecisionsBundle = {
  daily: Record<PrimarySymbol, RangeDecisionPanel>;
  weekly: Record<PrimarySymbol, RangeDecisionPanel>;
  monthly: Record<PrimarySymbol, RangeDecisionPanel>;
};

interface RangeApiPayload {
  indices: unknown[];
  timestamp: number;
  decisions?: DecisionsBundle;
}

const TF_LABELS: Record<TimeFrame, string> = {
  daily: 'Daily (1 day EM)',
  weekly: 'Weekly (5 days EM)',
  monthly: 'Monthly (21 days EM)',
};

function chipColor(label: string): string {
  const u = label.toUpperCase();
  if (u.includes('BREAKOUT UP')) return '#4caf50';
  if (u.includes('BREAKOUT DOWN')) return '#f44336';
  if (u.includes('RANGE') && !u.includes('STRATEGY')) return '#ff9800';
  if (u === 'HIGH') return '#4caf50';
  if (u === 'MEDIUM') return '#2196f3';
  if (u === 'LOW') return '#ff9800';
  if (u.includes('STRONG')) return '#4caf50';
  if (u.includes('PARTIAL')) return '#2196f3';
  if (u.includes('DIVERGENCE')) return '#f44336';
  if (u.includes('EXPANDING')) return '#ba68c8';
  if (u.includes('CONTRACTING')) return '#64b5f6';
  if (u.includes('NEAR EDGE')) return '#ffb74d';
  if (u.includes('MID RANGE')) return '#9e9e9e';
  return '#90a4ae';
}

function setupEmoji(setup: string): string {
  if (setup === 'TREND SETUP') return '🟢';
  if (setup === 'RANGE SETUP') return '🟡';
  return '🔴';
}

function setupColor(setup: string): string {
  if (setup === 'TREND SETUP') return '#2e7d32';
  if (setup === 'RANGE SETUP') return '#f9a825';
  return '#c62828';
}

export default function RangePage() {
  const navigate = useNavigate();
  const [payload, setPayload] = useState<RangeApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTimeFrame, setSelectedTimeFrame] = useState<TimeFrame>('daily');
  const [primary, setPrimary] = useState<PrimarySymbol>('NIFTY');
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchRangeData = async () => {
    try {
      setLoading(true);
      setError(null);
      const { data: result } = await apiClient.get('/ranges/all');
      if (result.success && result.data) {
        setPayload(result.data);
        setLastRefresh(new Date());
      } else {
        throw new Error('Invalid response format');
      }
    } catch (err) {
      console.error('Error fetching range data:', err);
      setError('Failed to load range analysis. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRangeData();
    const interval = setInterval(fetchRangeData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const panel = useMemo(() => {
    if (!payload?.decisions) return null;
    return payload.decisions[selectedTimeFrame]?.[primary] ?? null;
  }, [payload, selectedTimeFrame, primary]);

  const handleTimeFrameChange = (_event: React.SyntheticEvent, newValue: TimeFrame) => {
    setSelectedTimeFrame(newValue);
  };

  if (loading && !payload) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', flexDirection: 'column', gap: 2 }}>
        <CircularProgress size={60} />
        <Typography variant="h6" color="text.secondary">
          Loading range + expected move analysis…
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', p: { xs: 2, md: 3 }, pb: 6 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <IconButton onClick={() => navigate('/')} sx={{ color: 'primary.main' }} aria-label="Back">
            <ArrowBack />
          </IconButton>
          <Typography variant="h4" fontWeight="bold" color="primary" sx={{ fontSize: { xs: '1.35rem', sm: '2rem' } }}>
            RANGE + EXPECTED MOVE ANALYSIS
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="caption" color="text.secondary">
            Last updated: {lastRefresh.toLocaleTimeString()}
          </Typography>
          <Tooltip title="Refresh">
            <IconButton onClick={fetchRangeData} disabled={loading} aria-label="Refresh">
              <Refresh sx={{ animation: loading ? 'spin 1s linear infinite' : 'none', '@keyframes spin': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } } }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Paper sx={{ mb: 2 }}>
        <Tabs value={selectedTimeFrame} onChange={handleTimeFrameChange} indicatorColor="primary" textColor="primary" variant="scrollable" scrollButtons="auto">
          <Tab label={TF_LABELS.daily} value="daily" />
          <Tab label={TF_LABELS.weekly} value="weekly" />
          <Tab label={TF_LABELS.monthly} value="monthly" />
        </Tabs>
      </Paper>

      <Box sx={{ mb: 2, display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="body2" color="text.secondary" fontWeight={600} sx={{ pt: 0.75 }}>
          Primary index
        </Typography>
        <ToggleButtonGroup
          exclusive
          value={primary}
          onChange={(_, v) => v && setPrimary(v)}
          size="small"
          color="primary"
          sx={{ flexWrap: 'wrap', justifyContent: 'flex-start', maxWidth: '100%' }}
        >
          {RANGE_PRIMARY_KEYS.map((key) => (
            <ToggleButton key={key} value={key} sx={{ textTransform: 'none', fontWeight: 600 }}>
              {PRIMARY_INDEX_LABELS[key]}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      {error && (
        <Paper sx={{ p: 2, mb: 2, bgcolor: 'error.dark' }}>
          <Typography color="error.contrastText">{error}</Typography>
        </Paper>
      )}

      {!payload?.decisions && !error && (
        <Paper sx={{ p: 3, mb: 2, bgcolor: '#1e1e1e' }}>
          <Typography color="warning.light">
            Decision panel requires an updated API. Restart the backend so <code>/ranges/all</code> includes <code>decisions</code>.
          </Typography>
        </Paper>
      )}

      {panel && (
        <>
          {!panel.dataAvailable && panel.dataIssue && (
            <Paper sx={{ p: 2, mb: 2, borderLeft: 4, borderColor: 'warning.main', bgcolor: '#1e1e1e' }}>
              <Typography color="warning.light">{panel.dataIssue}</Typography>
            </Paper>
          )}

          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Analysis uses live spot, ATR(14) bands, and IV-based expected move from the same pipeline as the rest of the dashboard. Outputs describe a single <strong>setup state</strong> for study only — not trade instructions.
          </Typography>

          <Paper elevation={3} sx={{ p: 2.5, mb: 2, bgcolor: '#1a1f2e', border: '1px solid rgba(100,149,237,0.25)' }}>
            <Typography variant="overline" sx={{ color: '#7e8ffa', letterSpacing: 2, fontWeight: 700 }}>
              Decision context
            </Typography>
            <Divider sx={{ my: 1.5, borderColor: 'rgba(255,255,255,0.08)' }} />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(5, 1fr)' }, gap: 2 }}>
              <MetricBlock title="Market state" value={panel.marketState} hint="Spot vs combined ATR ∪ EM band" />
              <MetricBlock title="Confidence" value={panel.confidence} hint="From ATR ∩ EM overlap %" />
              <MetricBlock title="Alignment" value={panel.alignment} hint="All indices, same timeframe" />
              <MetricBlock title="Volatility" value={panel.volatility} hint="ATR width vs EM width" />
              <MetricBlock title="Distance" value={panel.distance} hint="Near edge within 20% of band width" />
            </Box>
          </Paper>

          <Paper elevation={3} sx={{ p: 2.5, mb: 2, bgcolor: '#1f1a24', border: '1px solid rgba(186,104,200,0.25)' }}>
            <Typography variant="overline" sx={{ color: '#ce93d8', letterSpacing: 2, fontWeight: 700 }}>
              Setup summary
            </Typography>
            <Divider sx={{ my: 1.5, borderColor: 'rgba(255,255,255,0.08)' }} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                  Setup
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Typography sx={{ fontSize: '1.75rem', lineHeight: 1 }}>{setupEmoji(panel.setup)}</Typography>
                  <Typography variant="h5" fontWeight="bold" sx={{ color: setupColor(panel.setup) }}>
                    {panel.setup}
                  </Typography>
                </Box>
              </Box>
              <Row label="Strategy" value={panel.strategy} />
              <Row label="Timing" value={panel.timing} />
              <Box>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                  Volatility usage (context)
                </Typography>
                <Typography variant="body2" color="text.primary">
                  {panel.volatilityUsage}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                  Reasons (3–4 drivers)
                </Typography>
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {panel.reasons.map((r, i) => (
                    <Typography key={i} component="li" variant="body2" color="text.primary" sx={{ mb: 0.75 }}>
                      {r}
                    </Typography>
                  ))}
                </Box>
              </Box>
            </Box>
          </Paper>
        </>
      )}

      <Paper sx={{ p: 2, mt: 1, bgcolor: '#12151f', border: '1px solid rgba(255,255,255,0.06)' }}>
        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
          For educational purposes only. Not investment advice.
        </Typography>
        <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 1 }}>
          Fail-safes: low overlap confidence, cross-index divergence, or mid-range position (when price is inside the band but not near an edge) collapse the view to NO CLEAR SETUP. Raw ATR/EM figures and tables are omitted here by design; they remain available to other API consumers.
        </Typography>
      </Paper>
    </Box>
  );
}

function MetricBlock({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
        {title}
      </Typography>
      <Typography
        variant="body1"
        fontWeight="bold"
        sx={{
          display: 'inline-block',
          px: 1.25,
          py: 0.5,
          borderRadius: 1,
          bgcolor: chipColor(value),
          color: value.includes('MID') || value.includes('NEUTRAL') ? '#111' : '#fff',
        }}
      >
        {value}
      </Typography>
      <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 0.75, lineHeight: 1.3 }}>
        {hint}
      </Typography>
    </Box>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72 }}>
        {label}
      </Typography>
      <Typography variant="body1" fontWeight={600}>
        {value}
      </Typography>
    </Box>
  );
}
