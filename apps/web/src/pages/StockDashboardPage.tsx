import { useState, useEffect, Fragment } from 'react';
import apiClient from '../api/client';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Chip,
  IconButton,
  Tooltip,
  Collapse,
  Grid,
  LinearProgress,
} from '@mui/material';
import {
  Refresh, ArrowBack, ExpandMore, ExpandLess,
  TrendingUp, TrendingDown,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

// ═══════════════════════════════════════════════════════════════
//  TYPES (match backend StockDashboardData)
// ═══════════════════════════════════════════════════════════════

interface EngineOutput {
  id: number;
  name: string;
  status: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  value: string;
  detail: string;
  numericValue: number;
}

interface TradeSignal {
  symbol: string;
  sector: string;
  spotPrice: number;
  change: number;
  changePercent: number;
  volume: number;
  atmIV: number;
  pcr: number;
  signal: 'BUY' | 'SELL' | 'WATCH' | 'NEUTRAL' | 'IGNORE';
  tradeScore: number;
  probability: number;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  target3: number;
  riskReward: number;
  oiInterpretation: string;
  engines: EngineOutput[];
  timestamp: number;
}

interface SectorData {
  name: string;
  sectorChange: number;
  heatScore: number;
  advancingStocks: number;
  decliningStocks: number;
  topStock: string;
}

interface SmartMoneyEntry {
  symbol: string;
  volumeRatio: number;
  oiSpurtPercent: number;
  blockTradeDetected: boolean;
  premiumFlowSignal: 'Strong' | 'Active' | 'Moderate' | 'Weak';
}

interface LiquiditySignal {
  symbol: string;
  event: string;
  strength: 'Strong' | 'Medium' | 'Weak';
  detail: string;
}

interface OptionsPositioning {
  callWall: number;
  putWall: number;
  gammaExposure: 'Positive' | 'Negative' | 'Neutral';
  unusualActivity: boolean;
  deltaPressure: 'Call Buying' | 'Put Buying' | 'Neutral';
}

interface MarketContext {
  marketTrend: 'Bullish' | 'Bearish' | 'Neutral';
  indexChangePercent: number;
  niftyPrice: number;
  bankNiftyPrice: number;
  niftyChange: number;
  bankNiftyChange: number;
  vix: number;
  vwapStatus: string;
  gammaState: string;
  totalGamma: number;
  marketPhase: string;
  timeStrength: 'Strong' | 'Moderate' | 'Weak';
}

interface SystemStatus {
  marketDataFeed: 'Active' | 'Delayed' | 'Inactive';
  apiStatus: 'OK' | 'Error';
  engineStatus: 'Running' | 'Stopped';
  latencyMs: number;
  lastUpdate: string;
  cacheAge?: number;
  snapshotId?: number;
}

interface StockDashboardData {
  marketContext: MarketContext;
  sectors: SectorData[];
  smartMoney: SmartMoneyEntry[];
  optionsPositioning: OptionsPositioning;
  liquiditySignals: LiquiditySignal[];
  trades: TradeSignal[];
  systemStatus: SystemStatus;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
//  COLOURS
// ═══════════════════════════════════════════════════════════════

const SIGNAL_COLORS: Record<string, string> = {
  BUY: '#4caf50', SELL: '#f44336', WATCH: '#ff9800', NEUTRAL: '#78909c', IGNORE: '#616161',
  BULLISH: '#4caf50', BEARISH: '#f44336',
  Strong: '#4caf50', Medium: '#ff9800', Weak: '#78909c',
  Active: '#4caf50', Delayed: '#ff9800', Inactive: '#f44336',
  OK: '#4caf50', Error: '#f44336', Running: '#4caf50', Stopped: '#f44336',
};

const trendColor = (v: number) => (v > 0 ? '#4caf50' : v < 0 ? '#f44336' : '#fff');
const fmt = (n: number) => n?.toLocaleString('en-IN', { maximumFractionDigits: 2 }) ?? '0';

// ═══════════════════════════════════════════════════════════════
//  PANEL HEADER HELPER
// ═══════════════════════════════════════════════════════════════

function PanelTitle({ title }: { title: string }) {
  return (
    <Typography variant="subtitle1" sx={{ color: '#90caf9', fontWeight: 700, mb: 1, borderBottom: '1px solid #333', pb: 0.5 }}>
      {title}
    </Typography>
  );
}

function TH({ children, align, sx, ...props }: any) {
  return (
    <TableCell align={align || 'left'} sx={{ color: '#b0bec5', fontWeight: 700, fontSize: '0.78rem', py: 0.5, ...sx }} {...props}>
      {children}
    </TableCell>
  );
}

// ═══════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function StockDashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<StockDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedStock, setExpandedStock] = useState<string | null>(null);

  const fetchData = async (isInitial = false) => {
    try {
      if (isInitial) setLoading(true);
      setError(null);
      const { data: result } = await apiClient.get('/stocks/dashboard');
      if (result.success) setData(result.data);
      else throw new Error('Invalid response');
    } catch {
      setError('Failed to load stock dashboard');
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(true);
    const iv = setInterval(() => fetchData(false), 15000); // 15s refresh (backend cache refreshes every 30s)
    return () => clearInterval(iv);
  }, []);

  if (loading && !data) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', gap: 2 }}>
        <CircularProgress size={60} />
        <Typography variant="h6" color="text.secondary">Loading Stock Dashboard…</Typography>
      </Box>
    );
  }

  const mc = data?.marketContext;
  const sys = data?.systemStatus;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', p: 2 }}>
      {/* HEADER */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <IconButton onClick={() => navigate('/dashboard')} sx={{ color: 'primary.main' }}><ArrowBack /></IconButton>
          <Typography variant="h5" fontWeight="bold" color="primary">INTRADAY STOCK OPTION DASHBOARD</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {sys && (
            <Chip size="small" label={`${sys.latencyMs}ms · Cache ${sys.cacheAge != null ? `${(sys.cacheAge / 1000).toFixed(1)}s` : '—'} · ${sys.lastUpdate}`}
              sx={{ bgcolor: '#263238', color: '#90caf9', fontSize: '0.7rem' }} />
          )}
          <Tooltip title="Refresh"><IconButton onClick={() => fetchData(true)} disabled={loading}>
            <Refresh sx={{ animation: loading ? 'spin 1s linear infinite' : 'none', color: '#90caf9' }} />
          </IconButton></Tooltip>
        </Box>
      </Box>

      {error && <Paper sx={{ p: 1, mb: 1, bgcolor: '#b71c1c' }}><Typography color="#fff" variant="body2">{error}</Typography></Paper>}

      <Grid container spacing={1.5}>

        {/* ─────────── PANEL 1 — Market Bias ─────────── */}
        <Grid item xs={12} md={6} lg={4}>
          <Paper sx={{ p: 1.5, bgcolor: '#1e1e1e', height: '100%' }}>
            <PanelTitle title="📊 Panel 1 — Market Bias" />
            {mc && (
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                <StatBox label="Market Trend" value={mc.marketTrend} color={mc.marketTrend === 'Bullish' ? '#4caf50' : mc.marketTrend === 'Bearish' ? '#f44336' : '#ff9800'} />
                <StatBox label="Index Chg" value={`${mc.indexChangePercent >= 0 ? '+' : ''}${mc.indexChangePercent}%`} color={trendColor(mc.indexChangePercent)} />
                <StatBox label="NIFTY" value={`₹${fmt(mc.niftyPrice)}`} color="#ffc107" />
                <StatBox label="BANKNIFTY" value={`₹${fmt(mc.bankNiftyPrice)}`} color="#ffc107" />
                <StatBox label="VIX" value={mc.vix.toFixed(1)} color={mc.vix > 18 ? '#f44336' : '#4caf50'} />
                <StatBox label="VWAP" value={mc.vwapStatus} color={mc.vwapStatus.includes('Above') ? '#4caf50' : mc.vwapStatus.includes('Below') ? '#f44336' : '#fff'} />
                <StatBox label="Gamma" value={mc.gammaState} color={mc.gammaState === 'Positive' ? '#4caf50' : mc.gammaState === 'Negative' ? '#f44336' : '#ff9800'} />
                <StatBox label="Phase" value={mc.marketPhase} color="#b0bec5" />
                <StatBox label="Time Strength" value={mc.timeStrength} color={SIGNAL_COLORS[mc.timeStrength]} />
              </Box>
            )}
          </Paper>
        </Grid>

        {/* ─────────── PANEL 2 — Sector Capital Flow ─────────── */}
        <Grid item xs={12} md={6} lg={4}>
          <Paper sx={{ p: 1.5, bgcolor: '#1e1e1e', height: '100%' }}>
            <PanelTitle title="🏭 Panel 2 — Sector Capital Flow" />
            <Table size="small">
              <TableHead><TableRow>
                <TH>#</TH><TH>Sector</TH><TH align="right">Change</TH><TH align="right">HeatScore</TH><TH>A/D</TH><TH>Top</TH>
              </TableRow></TableHead>
              <TableBody>
                {(data?.sectors || []).slice(0, 5).map((s, i) => (
                  <TableRow key={s.name}>
                    <TableCell sx={{ color: '#78909c', py: 0.3 }}>{i + 1}</TableCell>
                    <TableCell sx={{ color: '#fff', fontWeight: 600, py: 0.3 }}>{s.name}</TableCell>
                    <TableCell align="right" sx={{ color: trendColor(s.sectorChange), py: 0.3 }}>{s.sectorChange >= 0 ? '+' : ''}{s.sectorChange}%</TableCell>
                    <TableCell align="right" sx={{ color: s.heatScore > 0 ? '#4caf50' : '#f44336', fontWeight: 700, py: 0.3 }}>{s.heatScore}</TableCell>
                    <TableCell sx={{ color: '#b0b0b0', py: 0.3 }}>{s.advancingStocks}/{s.decliningStocks}</TableCell>
                    <TableCell sx={{ color: '#ffc107', py: 0.3, fontSize: '0.75rem' }}>{s.topStock}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </Grid>

        {/* ─────────── PANEL 7 — System Status ─────────── */}
        <Grid item xs={12} md={12} lg={4}>
          <Paper sx={{ p: 1.5, bgcolor: '#1e1e1e', height: '100%' }}>
            <PanelTitle title="🖥️ Panel 7 — System Status" />
            {sys && (
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                <StatBox label="Data Feed" value={sys.marketDataFeed} color={SIGNAL_COLORS[sys.marketDataFeed]} />
                <StatBox label="API" value={sys.apiStatus} color={SIGNAL_COLORS[sys.apiStatus]} />
                <StatBox label="Engine" value={sys.engineStatus} color={SIGNAL_COLORS[sys.engineStatus]} />
                <StatBox label="Latency" value={`${sys.latencyMs}ms`} color={sys.latencyMs < 5000 ? '#4caf50' : '#f44336'} />
                <StatBox label="Cache Age" value={sys.cacheAge != null ? `${(sys.cacheAge / 1000).toFixed(1)}s` : '—'} color={sys.cacheAge != null && sys.cacheAge < 10000 ? '#4caf50' : '#ff9800'} />
                <StatBox label="Last Update" value={sys.lastUpdate} color="#b0bec5" />
              </Box>
            )}
          </Paper>
        </Grid>

        {/* ─────────── PANEL 3 — Smart Money Stock Scanner ─────────── */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 1.5, bgcolor: '#1e1e1e' }}>
            <PanelTitle title="💰 Panel 3 — Smart Money Stock Scanner" />
            <TableContainer sx={{ maxHeight: 260 }}>
              <Table size="small" stickyHeader>
                <TableHead><TableRow sx={{ '& th': { bgcolor: '#2a2a2a' } }}>
                  <TH>Symbol</TH><TH align="right">VolumeX</TH><TH align="right">OI Chg%</TH><TH>Block</TH><TH>Prem Flow</TH>
                </TableRow></TableHead>
                <TableBody>
                  {(data?.smartMoney || []).map(s => (
                    <TableRow key={s.symbol}>
                      <TableCell sx={{ color: '#fff', fontWeight: 600, py: 0.3 }}>{s.symbol}</TableCell>
                      <TableCell align="right" sx={{ color: s.volumeRatio > 2 ? '#4caf50' : '#b0b0b0', py: 0.3 }}>{s.volumeRatio}x</TableCell>
                      <TableCell align="right" sx={{ color: trendColor(s.oiSpurtPercent), py: 0.3 }}>{s.oiSpurtPercent >= 0 ? '+' : ''}{s.oiSpurtPercent}%</TableCell>
                      <TableCell sx={{ py: 0.3 }}>
                        {s.blockTradeDetected
                          ? <Chip label="YES" size="small" sx={{ bgcolor: '#4caf50', color: '#fff', height: 20, fontSize: '0.7rem' }} />
                          : <Typography variant="caption" color="#616161">—</Typography>}
                      </TableCell>
                      <TableCell sx={{ py: 0.3 }}>
                        <Chip label={s.premiumFlowSignal} size="small"
                          sx={{ bgcolor: SIGNAL_COLORS[s.premiumFlowSignal] || '#616161', color: '#fff', height: 20, fontSize: '0.7rem' }} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!data?.smartMoney?.length) && (
                    <TableRow><TableCell colSpan={5} sx={{ color: '#616161', textAlign: 'center' }}>No smart money activity</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>

        {/* ─────────── PANEL 4 — Options Positioning ─────────── */}
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 1.5, bgcolor: '#1e1e1e' }}>
            <PanelTitle title="📈 Panel 4 — Options Positioning" />
            {data?.optionsPositioning && (
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1 }}>
                <StatBox label="Call Wall" value={data.optionsPositioning.callWall ? `₹${fmt(data.optionsPositioning.callWall)}` : '—'} color="#f44336" />
                <StatBox label="Put Wall" value={data.optionsPositioning.putWall ? `₹${fmt(data.optionsPositioning.putWall)}` : '—'} color="#4caf50" />
                <StatBox label="Gamma" value={data.optionsPositioning.gammaExposure}
                  color={data.optionsPositioning.gammaExposure === 'Positive' ? '#4caf50' : data.optionsPositioning.gammaExposure === 'Negative' ? '#f44336' : '#ff9800'} />
                <StatBox label="Unusual Activity" value={data.optionsPositioning.unusualActivity ? 'DETECTED' : 'Normal'}
                  color={data.optionsPositioning.unusualActivity ? '#ffc107' : '#616161'} />
                <StatBox label="Delta Pressure" value={data.optionsPositioning.deltaPressure}
                  color={data.optionsPositioning.deltaPressure === 'Call Buying' ? '#4caf50' : data.optionsPositioning.deltaPressure === 'Put Buying' ? '#f44336' : '#ff9800'} />
              </Box>
            )}
          </Paper>
        </Grid>

        {/* ─────────── PANEL 5 — Liquidity Signals ─────────── */}
        <Grid item xs={12}>
          <Paper sx={{ p: 1.5, bgcolor: '#1e1e1e' }}>
            <PanelTitle title="🌊 Panel 5 — Liquidity Signals" />
            {data?.liquiditySignals?.length ? (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {data.liquiditySignals.map((ls, i) => (
                  <Chip key={i}
                    label={`${ls.symbol} — ${ls.event} (${ls.strength})`}
                    sx={{ bgcolor: SIGNAL_COLORS[ls.strength], color: '#fff', fontWeight: 600 }} />
                ))}
              </Box>
            ) : (
              <Typography variant="body2" color="#616161">No liquidity events detected</Typography>
            )}
          </Paper>
        </Grid>

        {/* ─────────── PANEL 6 — Trade Decision Panel (main table) ─────────── */}
        <Grid item xs={12}>
          <Paper sx={{ p: 1.5, bgcolor: '#1e1e1e' }}>
            <PanelTitle title="🎯 Panel 6 — Trade Decision Panel" />
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ '& th': { bgcolor: '#2a2a2a' } }}>
                    <TH>Signal</TH><TH>Symbol</TH><TH>Sector</TH><TH align="right">Spot</TH>
                    <TH align="right">Chg%</TH><TH align="right">Score</TH><TH align="right">Prob</TH>
                    <TH align="right">Entry</TH><TH align="right">SL</TH><TH align="right">T1</TH>
                    <TH align="right">R:R</TH><TH>OI Interp</TH><TH align="center">Detail</TH>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(data?.trades || []).map((t) => (
                    <Fragment key={t.symbol}>
                      <TableRow sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.04)' } }}>
                        <TableCell sx={{ py: 0.4 }}>
                          <Chip label={t.signal} size="small"
                            icon={t.signal === 'BUY' ? <TrendingUp /> : t.signal === 'SELL' ? <TrendingDown /> : undefined}
                            sx={{ bgcolor: SIGNAL_COLORS[t.signal], color: '#fff', fontWeight: 700, '& .MuiChip-icon': { color: '#fff' } }} />
                        </TableCell>
                        <TableCell sx={{ color: '#fff', fontWeight: 700, py: 0.4 }}>{t.symbol}</TableCell>
                        <TableCell sx={{ color: '#78909c', fontSize: '0.78rem', py: 0.4 }}>{t.sector}</TableCell>
                        <TableCell align="right" sx={{ color: '#ffc107', fontWeight: 600, py: 0.4 }}>₹{fmt(t.spotPrice)}</TableCell>
                        <TableCell align="right" sx={{ color: trendColor(t.changePercent), fontWeight: 600, py: 0.4 }}>
                          {t.changePercent >= 0 ? '+' : ''}{t.changePercent}%
                        </TableCell>
                        <TableCell align="right" sx={{ py: 0.4 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
                            <LinearProgress variant="determinate" value={t.tradeScore}
                              sx={{ width: 40, height: 6, borderRadius: 3,
                                bgcolor: '#333',
                                '& .MuiLinearProgress-bar': { bgcolor: t.tradeScore >= 60 ? '#4caf50' : t.tradeScore >= 40 ? '#ff9800' : '#f44336' } }} />
                            <Typography variant="caption" sx={{ color: t.tradeScore >= 60 ? '#4caf50' : t.tradeScore >= 40 ? '#ff9800' : '#f44336', fontWeight: 700 }}>
                              {t.tradeScore}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell align="right" sx={{ color: '#b0bec5', py: 0.4 }}>{(t.probability * 100).toFixed(0)}%</TableCell>
                        <TableCell align="right" sx={{ color: '#fff', py: 0.4 }}>₹{fmt(t.entryPrice)}</TableCell>
                        <TableCell align="right" sx={{ color: '#f44336', py: 0.4 }}>₹{fmt(t.stopLoss)}</TableCell>
                        <TableCell align="right" sx={{ color: '#4caf50', py: 0.4 }}>₹{fmt(t.target1)}</TableCell>
                        <TableCell align="right" sx={{ color: t.riskReward >= 1.5 ? '#4caf50' : '#ff9800', fontWeight: 600, py: 0.4 }}>{t.riskReward}:1</TableCell>
                        <TableCell sx={{ color: '#b0bec5', fontSize: '0.75rem', py: 0.4 }}>{t.oiInterpretation}</TableCell>
                        <TableCell align="center" sx={{ py: 0.4 }}>
                          <IconButton size="small" onClick={() => setExpandedStock(expandedStock === t.symbol ? null : t.symbol)} sx={{ color: '#90caf9' }}>
                            {expandedStock === t.symbol ? <ExpandLess /> : <ExpandMore />}
                          </IconButton>
                        </TableCell>
                      </TableRow>
                      {expandedStock === t.symbol && (
                        <TableRow>
                          <TableCell colSpan={13} sx={{ p: 0 }}>
                            <Collapse in>
                              <Box sx={{ p: 1.5, bgcolor: '#263238' }}>
                                <Typography variant="caption" sx={{ color: '#90caf9', fontWeight: 700 }}>
                                  Engine Analysis — {t.symbol} | T2: ₹{fmt(t.target2)} | T3: ₹{fmt(t.target3)}
                                </Typography>
                                <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap', mt: 0.5 }}>
                                  {t.engines.map(e => (
                                    <Paper key={e.id} sx={{ p: 0.8, bgcolor: '#1e1e1e', minWidth: 130 }}>
                                      <Typography sx={{ color: '#9e9e9e', fontSize: '0.65rem' }}>#{e.id} {e.name}</Typography>
                                      <Typography sx={{ color: SIGNAL_COLORS[e.status] || '#fff', fontWeight: 700, fontSize: '0.8rem' }}>{e.value}</Typography>
                                      <Typography sx={{ color: '#616161', fontSize: '0.6rem' }}>{e.detail}</Typography>
                                    </Paper>
                                  ))}
                                </Box>
                              </Box>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}

// ═══════════════════════════════════════════════════════════════
//  HELPER COMPONENTS
// ═══════════════════════════════════════════════════════════════

function StatBox({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <Box sx={{ p: 0.8, bgcolor: '#263238', borderRadius: 1 }}>
      <Typography variant="caption" sx={{ color: '#78909c', fontSize: '0.65rem' }}>{label}</Typography>
      <Typography variant="body2" sx={{ color, fontWeight: 700, fontSize: '0.85rem' }}>{value}</Typography>
    </Box>
  );
}
