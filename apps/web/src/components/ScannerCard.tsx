/**
 * INTRADAY OPTION TRADE DISCOVERY — ScannerCard.tsx
 *
 * Dashboard Display Modules (per spec):
 *  1. Top 3 CALL trades
 *  2. Top 3 PUT trades
 *  3. Institutional setups
 *  4. Liquidity traps
 *  5. Gamma pressure strikes
 *  6. High probability trades
 *  7. Volatility regime status
 *  8. Market structure (Trend / Range / Breakout)
 *  + 31-step pipeline details
 */
import { useState, useEffect } from 'react';
import apiClient from '../api/client';
import {
  Box,
  Typography,
  Chip,
  CircularProgress,
  IconButton,
  Tooltip,
  Collapse,
  LinearProgress,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TableHead,
} from '@mui/material';
import {
  Refresh,
  ExpandMore,
  ExpandLess,
  TrendingUp,
  TrendingDown,
  RemoveCircle,
  ShowChart,
  Security,
  Whatshot,
  WarningAmber,
} from '@mui/icons-material';

// ── Types (mirror backend) ──────────────────────────────────

interface StrikeTrade {
  strike: number;
  optionType: 'CE' | 'PE';
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  riskReward: number;
  entryScore: number;
  winProbability: number;
  confidence: string;
  delta: number;
  gamma: number;
  iv: number;
  oi: number;
  volume: number;
  volumeRatio: number;
  oiChangePercent: number;
  distancePercent: number;
  gammaExposure: number;
  expectedOptionMove: number;
  freshPosition: boolean;
  institutionalFlow: boolean;
  deltaScore: number;
  distanceScore: number;
  volumeScore: number;
  volumeAccelScore: number;
  oiScore: number;
  flowScore: number;
  gammaScore: number;
  trapScore: number;
}

interface LiquidityTrap {
  type: 'BULL_TRAP' | 'BEAR_TRAP';
  strike: number;
  suggestedTrade: 'CALL' | 'PUT';
  trapScore: number;
  details: string;
}

interface GammaPressureStrike {
  strike: number;
  gammaExposure: number;
  gammaScore: number;
  distancePercent: number;
}

interface MarketContext {
  spotPrice: number;
  previousClose: number;
  vwap: number;
  atr: number;
  indiaVIX: number;
  expectedMove: number;
  trendDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  marketStructure: 'TRENDING' | 'RANGE' | 'BREAKOUT_PREP';
  volatilityRegime: 'HIGH' | 'NORMAL' | 'LOW';
  multiTFScore: number;
  rangePercent: number;
  inSession: boolean;
}

interface ScanStep {
  id: number;
  name: string;
  pass: boolean;
  value: string;
  weight: number;
}

interface ScanResult {
  symbol: string;
  signal: 'BUY CE' | 'BUY PE' | 'NO TRADE';
  score: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  strikeRecommendation: number;
  spotPrice: number;
  steps: ScanStep[];
  reason: string;
  timestamp: number;
  market: MarketContext;
  topCalls: StrikeTrade[];
  topPuts: StrikeTrade[];
  institutionalSetups: StrikeTrade[];
  liquidityTraps: LiquidityTrap[];
  gammaPressure: GammaPressureStrike[];
  highProbabilityTrades: StrikeTrade[];
}

// ── Colors ──────────────────────────────────────────────────

const SIGNAL_COLORS: Record<string, string> = {
  'BUY CE': '#4caf50', 'BUY PE': '#f44336', 'NO TRADE': '#ff9800',
};
const CONFIDENCE_COLORS: Record<string, string> = {
  HIGH: '#4caf50', MEDIUM: '#ff9800', LOW: '#9e9e9e',
};
const CONF_BADGE_COLORS: Record<string, string> = {
  Institutional: '#e040fb', Strong: '#4caf50', Normal: '#ff9800', Weak: '#9e9e9e',
};
const STRUCTURE_COLORS: Record<string, string> = {
  TRENDING: '#4caf50', RANGE: '#ff9800', BREAKOUT_PREP: '#29b6f6',
};
const REGIME_COLORS: Record<string, string> = {
  HIGH: '#f44336', NORMAL: '#4caf50', LOW: '#29b6f6',
};

// ── Component ───────────────────────────────────────────────

export default function ScannerCard({ symbol }: { symbol: string }) {
  const [data, setData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const { data: json } = await apiClient.get(`/scanner/${symbol}`);
      if (json.success && json.data) setData(json.data);
      else throw new Error('Invalid response');
    } catch (err) {
      console.error('Scanner fetch error:', err);
      setError('Failed to load scanner data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 60000);
    return () => clearInterval(id);
  }, [symbol]);

  if (loading && !data) {
    return (
      <Box sx={{ p: 2, bgcolor: '#1a1a2e', borderRadius: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={20} />
          <Typography color="text.secondary">Scanning {symbol}...</Typography>
        </Box>
      </Box>
    );
  }

  if (error && !data) {
    return (
      <Box sx={{ p: 2, bgcolor: '#1a1a2e', borderRadius: 2 }}>
        <Typography color="error">{error}</Typography>
      </Box>
    );
  }

  if (!data) return null;

  const sc = SIGNAL_COLORS[data.signal] || '#9e9e9e';
  const cc = CONFIDENCE_COLORS[data.confidence] || '#9e9e9e';
  const m = data.market;

  return (
    <Box sx={{ bgcolor: '#1a1a2e', borderRadius: 2, overflow: 'hidden', border: '1.5px solid rgba(255,255,255,0.06)' }}>

      {/* ═══ HEADER ═══ */}
      <Box sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        px: 2, py: 1.2,
        bgcolor: 'rgba(255,255,255,0.03)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ShowChart sx={{ color: '#29b6f6', fontSize: 22 }} />
          <Typography sx={{ fontWeight: 800, fontSize: '0.9rem', color: '#e0e0e0', letterSpacing: 0.5 }}>
            TRADE SCANNER — {symbol}
          </Typography>
          <Chip
            label={data.signal}
            icon={data.signal === 'BUY CE' ? <TrendingUp /> : data.signal === 'BUY PE' ? <TrendingDown /> : <RemoveCircle />}
            size="small"
            sx={{ bgcolor: sc, color: '#fff', fontWeight: 700, fontSize: '0.7rem', height: 24, '& .MuiChip-icon': { color: '#fff' } }}
          />
          <Chip label={data.confidence} size="small" sx={{ bgcolor: cc, color: '#fff', fontWeight: 600, fontSize: '0.65rem', height: 20 }} />
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title="Refresh">
            <IconButton onClick={fetchData} size="small" sx={{ color: '#78909c' }}>
              <Refresh sx={{ fontSize: 18, animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            </IconButton>
          </Tooltip>
          <IconButton onClick={() => setExpanded(prev => !prev)} size="small" sx={{ color: '#78909c' }}>
            {expanded ? <ExpandLess sx={{ fontSize: 18 }} /> : <ExpandMore sx={{ fontSize: 18 }} />}
          </IconButton>
        </Box>
      </Box>

      {/* ═══ MARKET CONTEXT BAR (Module 7+8: Volatility + Market Structure) ═══ */}
      <Box sx={{ display: 'flex', px: 2, py: 1, gap: 1.5, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <MiniStat label="Spot" value={`₹${m.spotPrice.toLocaleString()}`} />
        <MiniStat label="VWAP" value={`₹${m.vwap.toFixed(0)}`} color={m.spotPrice > m.vwap ? '#4caf50' : '#f44336'} />
        <MiniStat label="ATR" value={m.atr.toFixed(1)} />
        <MiniStat label="VIX" value={m.indiaVIX.toFixed(1)} color={REGIME_COLORS[m.volatilityRegime]} />
        <MiniStat label="EM" value={`±${m.expectedMove.toFixed(0)}`} />
        <Chip label={m.trendDirection} size="small" sx={{ bgcolor: m.trendDirection === 'BULLISH' ? '#4caf5022' : m.trendDirection === 'BEARISH' ? '#f4433622' : '#78909c22', color: m.trendDirection === 'BULLISH' ? '#4caf50' : m.trendDirection === 'BEARISH' ? '#f44336' : '#78909c', fontWeight: 700, fontSize: '0.6rem', height: 20 }} />
        <Chip label={m.marketStructure} size="small" sx={{ bgcolor: `${STRUCTURE_COLORS[m.marketStructure] || '#78909c'}22`, color: STRUCTURE_COLORS[m.marketStructure] || '#78909c', fontWeight: 700, fontSize: '0.6rem', height: 20 }} />
        <Chip label={`Vol: ${m.volatilityRegime}`} size="small" sx={{ bgcolor: `${REGIME_COLORS[m.volatilityRegime]}22`, color: REGIME_COLORS[m.volatilityRegime], fontWeight: 700, fontSize: '0.6rem', height: 20 }} />
        <MiniStat label="Multi-TF" value={`${m.multiTFScore}/2`} color={m.multiTFScore >= 2 ? '#4caf50' : '#ff9800'} />
      </Box>

      {/* ═══ SCORE BAR ═══ */}
      <Box sx={{ px: 2, py: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ fontSize: '0.72rem', color: '#b0b0b0' }}>
            Pipeline: <strong style={{ color: data.score >= 65 ? '#4caf50' : data.score >= 50 ? '#ff9800' : '#f44336' }}>{data.score}%</strong>
          </Typography>
          <Typography sx={{ fontSize: '0.72rem', color: '#b0b0b0' }}>
            Reco Strike: <strong style={{ color: '#ffc107' }}>{data.strikeRecommendation || 'N/A'}</strong>
          </Typography>
        </Box>
        <LinearProgress variant="determinate" value={data.score} sx={{
          height: 6, borderRadius: 3, bgcolor: 'rgba(255,255,255,0.08)',
          '& .MuiLinearProgress-bar': { bgcolor: data.score >= 65 ? '#4caf50' : data.score >= 50 ? '#ff9800' : '#f44336', borderRadius: 3 },
        }} />
        <Typography sx={{ fontSize: '0.65rem', color: '#78909c', mt: 0.5 }}>{data.reason}</Typography>
      </Box>

      {/* ═══ TOP 3 CALLS (Module 1) ═══ */}
      {data.topCalls.length > 0 && (
        <TradeTable title="TOP 3 CALL TRADES" trades={data.topCalls} color="#4caf50" icon={<TrendingUp sx={{ fontSize: 16, color: '#4caf50' }} />} />
      )}

      {/* ═══ TOP 3 PUTS (Module 2) ═══ */}
      {data.topPuts.length > 0 && (
        <TradeTable title="TOP 3 PUT TRADES" trades={data.topPuts} color="#f44336" icon={<TrendingDown sx={{ fontSize: 16, color: '#f44336' }} />} />
      )}

      {/* ═══ INSTITUTIONAL SETUPS (Module 3) ═══ */}
      {data.institutionalSetups.length > 0 && (
        <Box sx={{ px: 2, py: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
            <Security sx={{ fontSize: 14, color: '#e040fb' }} />
            <Typography sx={{ fontSize: '0.68rem', color: '#e040fb', fontWeight: 700, letterSpacing: 0.5 }}>INSTITUTIONAL SETUPS</Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {data.institutionalSetups.map((t, i) => (
              <Chip key={i} label={`${t.strike} ${t.optionType} | Score ${t.entryScore} | Win ${t.winProbability}%`}
                size="small" sx={{ bgcolor: '#e040fb22', color: '#e040fb', fontWeight: 600, fontSize: '0.62rem', height: 22 }} />
            ))}
          </Box>
        </Box>
      )}

      {/* ═══ LIQUIDITY TRAPS (Module 4) ═══ */}
      {data.liquidityTraps.length > 0 && (
        <Box sx={{ px: 2, py: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
            <WarningAmber sx={{ fontSize: 14, color: '#ff9800' }} />
            <Typography sx={{ fontSize: '0.68rem', color: '#ff9800', fontWeight: 700, letterSpacing: 0.5 }}>LIQUIDITY TRAPS</Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {data.liquidityTraps.map((t, i) => (
              <Chip key={i} label={`${t.type} @${t.strike} → ${t.suggestedTrade}`}
                size="small" sx={{ bgcolor: '#ff980022', color: '#ff9800', fontWeight: 600, fontSize: '0.62rem', height: 22 }} />
            ))}
          </Box>
        </Box>
      )}

      {/* ═══ GAMMA PRESSURE (Module 5) ═══ */}
      {data.gammaPressure.length > 0 && (
        <Box sx={{ px: 2, py: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
            <Whatshot sx={{ fontSize: 14, color: '#ff5722' }} />
            <Typography sx={{ fontSize: '0.68rem', color: '#ff5722', fontWeight: 700, letterSpacing: 0.5 }}>GAMMA PRESSURE</Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {data.gammaPressure.map((g, i) => (
              <Chip key={i} label={`${g.strike} | GEX ${(g.gammaExposure / 1e6).toFixed(1)}M | ${g.distancePercent.toFixed(1)}%`}
                size="small" sx={{ bgcolor: '#ff572222', color: '#ff5722', fontWeight: 600, fontSize: '0.62rem', height: 22 }} />
            ))}
          </Box>
        </Box>
      )}

      {/* ═══ HIGH PROBABILITY TRADES (Module 6) ═══ */}
      {data.highProbabilityTrades.length > 0 && (
        <Box sx={{ px: 2, py: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
            <Typography sx={{ fontSize: '0.68rem', color: '#00e676', fontWeight: 700, letterSpacing: 0.5 }}>🎯 HIGH PROBABILITY TRADES</Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {data.highProbabilityTrades.map((t, i) => (
              <Chip key={i} label={`${t.strike} ${t.optionType} | Win ${t.winProbability}% | RR ${t.riskReward}:1`}
                size="small" sx={{ bgcolor: '#00e67622', color: '#00e676', fontWeight: 600, fontSize: '0.62rem', height: 22 }} />
            ))}
          </Box>
        </Box>
      )}

      {/* ═══ NO TRADES MESSAGE ═══ */}
      {data.topCalls.length === 0 && data.topPuts.length === 0 && (
        <Box sx={{ px: 2, py: 2, textAlign: 'center' }}>
          <Typography sx={{ fontSize: '0.78rem', color: '#78909c' }}>
            No trades pass all filters (EntryScore ≥ 11, Win ≥ 65%, RR ≥ 1.5)
          </Typography>
        </Box>
      )}

      {/* ═══ EXPANDED: 31-Step Pipeline ═══ */}
      <Collapse in={expanded}>
        <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)' }} />
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography sx={{ fontSize: '0.68rem', color: '#29b6f6', fontWeight: 700, mb: 1, letterSpacing: 0.5 }}>
            31-STEP DISCOVERY PIPELINE
          </Typography>
          <Table size="small" sx={{ '& td, & th': { borderColor: 'rgba(255,255,255,0.04)', py: 0.4, px: 1 } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ color: '#546e7a', fontSize: '0.6rem', fontWeight: 700 }}>#</TableCell>
                <TableCell sx={{ color: '#546e7a', fontSize: '0.6rem', fontWeight: 700 }}>Step</TableCell>
                <TableCell sx={{ color: '#546e7a', fontSize: '0.6rem', fontWeight: 700 }}>Value</TableCell>
                <TableCell sx={{ color: '#546e7a', fontSize: '0.6rem', fontWeight: 700, textAlign: 'center' }}>Pass</TableCell>
                <TableCell sx={{ color: '#546e7a', fontSize: '0.6rem', fontWeight: 700 }}>W</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.steps.map(step => (
                <TableRow key={step.id}>
                  <TableCell sx={{ color: '#78909c', fontSize: '0.68rem' }}>#{step.id}</TableCell>
                  <TableCell sx={{ color: '#e0e0e0', fontSize: '0.72rem' }}>{step.name}</TableCell>
                  <TableCell sx={{ color: '#b0b0b0', fontSize: '0.68rem' }}>{step.value}</TableCell>
                  <TableCell sx={{ textAlign: 'center' }}>
                    <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: step.pass ? '#4caf50' : '#f44336', display: 'inline-block' }} />
                  </TableCell>
                  <TableCell sx={{ color: '#546e7a', fontSize: '0.65rem' }}>{step.weight > 0 ? `w${step.weight}` : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Collapse>
    </Box>
  );
}

// ── Sub-components ──────────────────────────────────────────

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box sx={{ minWidth: 40 }}>
      <Typography sx={{ fontSize: '0.52rem', color: '#546e7a' }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: color || '#b0bec5' }}>{value}</Typography>
    </Box>
  );
}

function TradeTable({ title, trades, color, icon }: { title: string; trades: StrikeTrade[]; color: string; icon: React.ReactNode }) {
  return (
    <Box sx={{ px: 2, py: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
        {icon}
        <Typography sx={{ fontSize: '0.68rem', color, fontWeight: 700, letterSpacing: 0.5 }}>{title}</Typography>
      </Box>
      <Table size="small" sx={{ '& td, & th': { borderColor: 'rgba(255,255,255,0.04)', py: 0.3, px: 0.8 } }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ color: '#546e7a', fontSize: '0.58rem', fontWeight: 700 }}>Strike</TableCell>
            <TableCell sx={{ color: '#546e7a', fontSize: '0.58rem', fontWeight: 700 }}>Entry</TableCell>
            <TableCell sx={{ color: '#546e7a', fontSize: '0.58rem', fontWeight: 700 }}>Target</TableCell>
            <TableCell sx={{ color: '#546e7a', fontSize: '0.58rem', fontWeight: 700 }}>SL</TableCell>
            <TableCell sx={{ color: '#546e7a', fontSize: '0.58rem', fontWeight: 700 }}>RR</TableCell>
            <TableCell sx={{ color: '#546e7a', fontSize: '0.58rem', fontWeight: 700 }}>Score</TableCell>
            <TableCell sx={{ color: '#546e7a', fontSize: '0.58rem', fontWeight: 700 }}>Win%</TableCell>
            <TableCell sx={{ color: '#546e7a', fontSize: '0.58rem', fontWeight: 700 }}>Conf</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {trades.map((t, i) => (
            <TableRow key={i} sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' } }}>
              <TableCell sx={{ color: '#e0e0e0', fontSize: '0.72rem', fontWeight: 700 }}>
                {t.strike} {t.optionType}
              </TableCell>
              <TableCell sx={{ color: '#b0bec5', fontSize: '0.72rem' }}>₹{t.entryPrice.toFixed(1)}</TableCell>
              <TableCell sx={{ color: '#4caf50', fontSize: '0.72rem', fontWeight: 600 }}>₹{t.targetPrice.toFixed(1)}</TableCell>
              <TableCell sx={{ color: '#f44336', fontSize: '0.72rem' }}>₹{t.stopLoss.toFixed(1)}</TableCell>
              <TableCell sx={{ color: t.riskReward >= 2 ? '#4caf50' : '#ff9800', fontSize: '0.72rem', fontWeight: 700 }}>{t.riskReward.toFixed(1)}</TableCell>
              <TableCell sx={{ fontSize: '0.72rem', fontWeight: 700, color: t.entryScore >= 17 ? '#e040fb' : t.entryScore >= 14 ? '#4caf50' : '#ff9800' }}>
                {t.entryScore}/20
              </TableCell>
              <TableCell sx={{ color: t.winProbability >= 75 ? '#4caf50' : '#ff9800', fontSize: '0.72rem', fontWeight: 600 }}>
                {t.winProbability}%
              </TableCell>
              <TableCell>
                <Chip label={t.confidence} size="small" sx={{
                  bgcolor: `${CONF_BADGE_COLORS[t.confidence] || '#9e9e9e'}22`,
                  color: CONF_BADGE_COLORS[t.confidence] || '#9e9e9e',
                  fontWeight: 700, fontSize: '0.58rem', height: 18,
                }} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
