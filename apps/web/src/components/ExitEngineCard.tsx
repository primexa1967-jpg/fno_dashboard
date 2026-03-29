import { useState, useEffect, useCallback } from 'react';
import apiClient from '../api/client';
import {
  Box,
  Typography,
  Chip,
  IconButton,
  Collapse,
  Divider,
  LinearProgress,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid,
  Alert,
} from '@mui/material';
import {
  ExpandMore,
  ExpandLess,
  Warning,
  Timer,
  Settings,
  Refresh,
  TrendingUp,
  TrendingDown,
  Shield,
  CheckCircle,
  InfoOutlined,
} from '@mui/icons-material';

// ─────────────────────────────────────────────────────────────
//  Types (mirror backend v3 exactly)
// ─────────────────────────────────────────────────────────────

type ExitType =
  | 'OI_DISTRIBUTION'
  | 'GAMMA_RISK'
  | 'HARD_STOP'
  | 'FINAL_TARGET'
  | 'IV_SPIKE'
  | 'TRAILING_STOP'
  | 'PREMIUM_WEAKNESS'
  | 'THETA_DECAY'
  | 'HOLD';

type Urgency = 'IMMEDIATE' | 'SOON' | 'HOLD';

interface TradePosition {
  id: string;
  symbol: string;
  strike: number;
  optionType: 'CE' | 'PE';
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  entryTime: number;
  entryIV?: number;
  currentIV?: number;
  highestPrice?: number;
  delta?: number;
  gamma?: number;
  bidAskSpreadPct?: number;
  optionVWAP?: number;
}

interface ExitSignal {
  action: 'EXIT' | 'HOLD';
  exitType: ExitType;
  reason: string;
  urgency: Urgency;
  pnlPercent: number;
  pnlAbsolute: number;
  priority: number;
  details?: string;
}

interface RiskParameters {
  hardStopPct: number;
  trailTriggerPct: number;
  trailCutPct: number;
  gammaCutoffHour: number;
  gammaCutoffMinute: number;
  gammaPctThreshold: number;
  gammaPnlGate: number;
  thetaCutoffHour: number;
  thetaCutoffMinute: number;
  thetaPnlThreshold: number;
  finalTargetPct: number;
  ivSpikeMultiplier: number;
  ivSpikePnlThreshold: number;
  oiChangeThresholdPct: number;
  oiLookbackCandles: number;
  premiumWeaknessHour: number;
  premiumWeaknessMinute: number;
  premiumWeaknessPnl: number;
}

interface TimerVal { hours: number; minutes: number; seconds: number }

interface ExitEngineCardProps {
  symbol?: string;
  positions?: TradePosition[];
}

// ─────────────────────────────────────────────────────────────
//  COLOR / LABEL helpers
// ─────────────────────────────────────────────────────────────

const EXIT_COLORS: Record<ExitType, string> = {
  OI_DISTRIBUTION:   '#e91e63',
  GAMMA_RISK:        '#ff5722',
  HARD_STOP:         '#f44336',
  FINAL_TARGET:      '#4caf50',
  IV_SPIKE:          '#ff9800',
  TRAILING_STOP:     '#ffc107',
  PREMIUM_WEAKNESS:  '#ab47bc',
  THETA_DECAY:       '#9c27b0',
  HOLD:              '#546e7a',
};

const EXIT_LABELS: Record<ExitType, string> = {
  OI_DISTRIBUTION:   'OI DISTRIB',
  GAMMA_RISK:        'GAMMA RISK',
  HARD_STOP:         'HARD STOP',
  FINAL_TARGET:      'TARGET HIT',
  IV_SPIKE:          'IV SPIKE',
  TRAILING_STOP:     'TRAIL STOP',
  PREMIUM_WEAKNESS:  'PREM WEAK',
  THETA_DECAY:       'THETA DECAY',
  HOLD:              'HOLD',
};

const PRIORITY_LABELS: Record<number, string> = {
  1: '#1 OI Distribution',
  2: '#2 Gamma Risk',
  3: '#3 Hard Stop',
  4: '#4 Final Target',
  5: '#5 IV Spike',
  6: '#6 Trailing Stop',
  7: '#7 Premium Weakness',
  8: '#8 Theta Decay',
  9: 'HOLD',
};

function fmtTimer(t: TimerVal): string {
  return `${String(t.hours).padStart(2,'0')}:${String(t.minutes).padStart(2,'0')}:${String(t.seconds).padStart(2,'0')}`;
}

/** Get current IST time (avoids system timezone issues) */
function nowIST(): Date {
  const utc = new Date();
  return new Date(utc.getTime() + (5.5 * 60 * 60 * 1000 - utc.getTimezoneOffset() * 60 * 1000));
}

function timeGTE_IST(h: number, m: number): boolean {
  const now = nowIST();
  return now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
}

// ─────────────────────────────────────────────────────────────
//  CLIENT-SIDE FALLBACK (mirrors backend cascade without IV / gamma / theta exits)
//  OI distribution requires server candles; rest matches simplified priority order.
// ─────────────────────────────────────────────────────────────

function clientEvaluate(pos: TradePosition, risk: RiskParameters): ExitSignal {
  const diff = pos.currentPrice - pos.entryPrice;
  const pnlPct = Number(((diff / pos.entryPrice) * 100).toFixed(2));
  const pnlAbs = Number((diff * pos.quantity).toFixed(2));

  if (pnlPct <= -risk.hardStopPct) {
    return { action: 'EXIT', exitType: 'HARD_STOP', reason: `Loss of ${Math.abs(pnlPct).toFixed(1)}% exceeds hard stop (${risk.hardStopPct}%)`, urgency: 'IMMEDIATE', pnlPercent: pnlPct, pnlAbsolute: pnlAbs, priority: 2 };
  }

  if (pnlPct >= risk.finalTargetPct) {
    return { action: 'EXIT', exitType: 'FINAL_TARGET', reason: `Target of +${risk.finalTargetPct}% hit!`, urgency: 'SOON', pnlPercent: pnlPct, pnlAbsolute: pnlAbs, priority: 3 };
  }

  if (pnlPct >= risk.trailTriggerPct) {
    const peak = pos.highestPrice || pos.currentPrice;
    const floor = peak * (1 - risk.trailCutPct / 100);
    if (pos.currentPrice <= floor) {
      return { action: 'EXIT', exitType: 'TRAILING_STOP', reason: `Price fell below trail floor`, urgency: 'SOON', pnlPercent: pnlPct, pnlAbsolute: pnlAbs, priority: 4, details: `Peak=${peak.toFixed(2)} Floor=${floor.toFixed(2)}` };
    }
  }

  if (timeGTE_IST(risk.premiumWeaknessHour, risk.premiumWeaknessMinute) &&
    pos.optionVWAP && pos.optionVWAP > 0 && pos.currentPrice < pos.optionVWAP && pnlPct < risk.premiumWeaknessPnl) {
    return { action: 'EXIT', exitType: 'PREMIUM_WEAKNESS', reason: `Premium below VWAP — weak momentum`, urgency: 'SOON', pnlPercent: pnlPct, pnlAbsolute: pnlAbs, priority: 5 };
  }

  return { action: 'HOLD', exitType: 'HOLD', reason: 'Structure Intact', urgency: 'HOLD', pnlPercent: pnlPct, pnlAbsolute: pnlAbs, priority: 6 };
}

// ─────────────────────────────────────────────────────────────
//  COMPONENT — No dummy data, uses only real positions
// ─────────────────────────────────────────────────────────────

export default function ExitEngineCard({ symbol = 'NIFTY', positions: externalPositions = [] }: ExitEngineCardProps) {
  const [risk, setRisk] = useState<RiskParameters | null>(null);
  const [thetaTimer, setThetaTimer] = useState<TimerVal>({ hours: 0, minutes: 0, seconds: 0 });
  const [gammaTimer, setGammaTimer] = useState<TimerVal>({ hours: 0, minutes: 0, seconds: 0 });
  const [premiumTimer, setPremiumTimer] = useState<TimerVal>({ hours: 0, minutes: 0, seconds: 0 });
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editRisk, setEditRisk] = useState<RiskParameters | null>(null);
  const [fetchedPositions, setFetchedPositions] = useState<TradePosition[]>([]);
  const [serverSignals, setServerSignals] = useState<Array<{ position: TradePosition; signal: ExitSignal }>>([]);

  // Use externally provided positions OR fetched real positions from Dhan
  const activePositions = externalPositions.length > 0 ? externalPositions : fetchedPositions;

  // ── Fetch risk parameters from backend ──
  const fetchRisk = useCallback(async () => {
    try {
      setLoading(true);
      const { data: json } = await apiClient.get('/exit/risk');
      if (json.success && json.data) {
        setRisk(json.data.risk);
        setThetaTimer(json.data.timeToThetaCutoff);
        setGammaTimer(json.data.timeToGammaCutoff);
        if (json.data.timeToPremiumCutoff) {
          setPremiumTimer(json.data.timeToPremiumCutoff);
        }
        setEditRisk(json.data.risk);
      }
    } catch {
      // fallback defaults (same as backend DEFAULT_RISK)
      const defaults: RiskParameters = {
        hardStopPct: 25, trailTriggerPct: 25, trailCutPct: 12,
        gammaCutoffHour: 14, gammaCutoffMinute: 15, gammaPctThreshold: 0.1, gammaPnlGate: 40,
        thetaCutoffHour: 14, thetaCutoffMinute: 30, thetaPnlThreshold: 25,
        finalTargetPct: 100, ivSpikeMultiplier: 1.5, ivSpikePnlThreshold: 20,
        oiChangeThresholdPct: 3, oiLookbackCandles: 3,
        premiumWeaknessHour: 13, premiumWeaknessMinute: 45, premiumWeaknessPnl: 20,
      };
      setRisk(defaults);
      setEditRisk(defaults);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRisk();

    // Fetch real positions from Dhan API
    const fetchPositions = async () => {
      try {
        const { data: json } = await apiClient.get('/exit/positions');
        if (json.success && json.data) {
          // Filter positions for current symbol
          const allPositions: TradePosition[] = json.data.positions || [];
          const symbolPositions = allPositions.filter(
            (p: TradePosition) => p.symbol.toUpperCase() === symbol.toUpperCase()
          );
          setFetchedPositions(symbolPositions);

          // Use server-evaluated exit analysis if available (OI flow, stops, trail, premium weakness)
          if (json.data.evaluated) {
            const symbolEvaluated = (json.data.evaluated as Array<{ position: TradePosition; signal: ExitSignal }>)
              .filter(e => e.position.symbol.toUpperCase() === symbol.toUpperCase());
            setServerSignals(symbolEvaluated);
          }
        }
      } catch {
        // No positions available — this is normal when market is closed or no trades
        console.log('No positions available from Dhan API');
      }
    };

    fetchPositions();

    // Refresh positions every 15 seconds during market hours
    const posInterval = setInterval(fetchPositions, 15000);

    const id = setInterval(() => {
      setThetaTimer(prev => tickDown(prev));
      setGammaTimer(prev => tickDown(prev));
      setPremiumTimer(prev => tickDown(prev));
    }, 1000);
    return () => {
      clearInterval(id);
      clearInterval(posInterval);
    };
  }, [fetchRisk, symbol]);

  const saveRisk = async () => {
    if (!editRisk) return;
    try {
      const res = await apiClient.post('/exit/risk', editRisk);
      if (res.status === 200) { setRisk(editRisk); setSettingsOpen(false); }
    } catch { /* ignore */ }
  };

  // ── Evaluate REAL positions — prefer server exit evaluation when available ──
  const signals = risk && activePositions.length > 0
    ? (serverSignals.length > 0
        ? serverSignals
        : activePositions.map(pos => ({ position: pos, signal: clientEvaluate(pos, risk) })))
    : [];

  const immediateExits = signals.filter(s => s.signal.urgency === 'IMMEDIATE');
  const soonExits = signals.filter(s => s.signal.urgency === 'SOON' && s.signal.action === 'EXIT');
  const inProfit = signals.filter(s => s.signal.pnlPercent > 0);
  const thetaActive = thetaTimer.hours === 0 && thetaTimer.minutes === 0 && thetaTimer.seconds === 0;
  const gammaActive = gammaTimer.hours === 0 && gammaTimer.minutes === 0 && gammaTimer.seconds === 0;
  const premiumActive = premiumTimer.hours === 0 && premiumTimer.minutes === 0 && premiumTimer.seconds === 0;

  if (loading && !risk) {
    return (
      <Box sx={{ p: 2, bgcolor: '#1a1a2e', borderRadius: 2 }}>
        <Typography variant="caption" color="text.secondary">Loading Exit Engine...</Typography>
      </Box>
    );
  }

  return (
    <>
      <Box sx={{
        bgcolor: '#1a1a2e',
        borderRadius: 2,
        overflow: 'hidden',
        border: immediateExits.length > 0 ? '1.5px solid #f4433644' : '1.5px solid rgba(255,255,255,0.06)',
        boxShadow: immediateExits.length > 0 ? '0 0 20px rgba(244,67,54,0.15)' : 'none',
        transition: 'all 0.3s',
      }}>

        {/* ── HEADER ── */}
        <Box sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          px: 2, py: 1.2,
          bgcolor: immediateExits.length > 0 ? 'rgba(244,67,54,0.08)' : 'rgba(255,255,255,0.03)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Shield sx={{ color: '#7c4dff', fontSize: 22 }} />
            <Typography sx={{ fontWeight: 800, fontSize: '0.9rem', color: '#e0e0e0', letterSpacing: 0.5 }}>
              EXIT ENGINE — {symbol}
            </Typography>
            {immediateExits.length > 0 && (
              <Chip icon={<Warning sx={{ fontSize: '14px !important' }} />} label={`${immediateExits.length} URGENT`}
                size="small" sx={{ bgcolor: 'rgba(244,67,54,0.15)', color: '#f44336', fontWeight: 700, fontSize: '0.68rem', height: 22 }} />
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title="Risk Settings">
              <IconButton size="small" onClick={() => setSettingsOpen(true)} sx={{ color: '#78909c' }}>
                <Settings sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Refresh">
              <IconButton size="small" onClick={fetchRisk} sx={{ color: '#78909c' }}>
                <Refresh sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <IconButton size="small" onClick={() => setExpanded(x => !x)} sx={{ color: '#78909c' }}>
              {expanded ? <ExpandLess sx={{ fontSize: 18 }} /> : <ExpandMore sx={{ fontSize: 18 }} />}
            </IconButton>
          </Box>
        </Box>

        {/* ── COMPACT STATS BAR ── */}
        <Box sx={{ display: 'flex', px: 2, py: 1.2, gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Timers */}
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <TimerBox label="Gamma" timer={gammaTimer} active={gammaActive} color="#ff5722" />
            <TimerBox label="Premium" timer={premiumTimer} active={premiumActive} color="#ab47bc" />
            <TimerBox label="Theta" timer={thetaTimer} active={thetaActive} color="#9c27b0" />
          </Box>

          <Divider orientation="vertical" flexItem sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />

          {/* Counters */}
          <Box sx={{ display: 'flex', gap: 2 }}>
            <CountBox label="Positions" value={activePositions.length} color="#90caf9" />
            <CountBox label="In Profit" value={inProfit.length} color="#4caf50" />
            <CountBox label="In Loss" value={signals.length - inProfit.length} color="#f44336" />
            <CountBox label="Need Exit" value={immediateExits.length + soonExits.length} color="#ff9800" />
          </Box>

          <Divider orientation="vertical" flexItem sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />

          {/* Risk badges */}
          {risk && (
            <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap' }}>
              <RiskBadge label="Hard Stop" value={`-${risk.hardStopPct}%`} color="#f44336" />
              <RiskBadge label="Trail" value={`+${risk.trailTriggerPct}%/${risk.trailCutPct}%`} color="#ffc107" />
              <RiskBadge label="Target" value={`+${risk.finalTargetPct}%`} color="#4caf50" />
              <RiskBadge label="OI Lookback" value={`${risk.oiLookbackCandles}m`} color="#e91e63" />
            </Box>
          )}
        </Box>

        {/* ── URGENT ALERT ── */}
        {immediateExits.length > 0 && (
          <Alert severity="error" sx={{ mx: 2, mb: 1, py: 0.5, '& .MuiAlert-message': { fontSize: '0.75rem' } }}>
            <strong>IMMEDIATE EXIT:</strong> {immediateExits.map(s =>
              `${s.position.strike} ${s.position.optionType} (${EXIT_LABELS[s.signal.exitType]})`
            ).join(' | ')}
          </Alert>
        )}

        {/* ── NO POSITIONS STATE ── */}
        {activePositions.length === 0 && (
          <Box sx={{ px: 2, py: 2, textAlign: 'center' }}>
            <InfoOutlined sx={{ fontSize: 32, color: '#546e7a', mb: 0.5 }} />
            <Typography sx={{ fontSize: '0.78rem', color: '#78909c', fontWeight: 600 }}>
              No Active Positions
            </Typography>
            <Typography sx={{ fontSize: '0.65rem', color: '#546e7a', mt: 0.3 }}>
              Exit engine will evaluate positions when trades are opened via the scanner.
              Expand to view risk parameters, exit cascade rules, and entry conditions.
            </Typography>
          </Box>
        )}

        {/* ── POSITIONS LIST (only shown when real positions exist) ── */}
        {signals.length > 0 && (
          <Box sx={{ px: 2, pb: 1 }}>
            {signals.map(({ position: pos, signal: sig }) => {
              const ec = EXIT_COLORS[sig.exitType];
              return (
                <Box key={pos.id} sx={{
                  mb: 1, borderRadius: 1.5, overflow: 'hidden',
                  bgcolor: 'rgba(255,255,255,0.02)',
                  borderLeft: `4px solid ${ec}`,
                  transition: 'background 0.2s',
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.04)' },
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, py: 1, gap: 1.5, flexWrap: 'wrap' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 140 }}>
                      {pos.optionType === 'CE'
                        ? <TrendingUp sx={{ color: '#4caf50', fontSize: 16 }} />
                        : <TrendingDown sx={{ color: '#f44336', fontSize: 16 }} />}
                      <Typography sx={{ fontWeight: 800, fontSize: '0.82rem', color: '#e0e0e0' }}>
                        {pos.symbol} {pos.strike} {pos.optionType}
                      </Typography>
                    </Box>

                    <MiniStat label="Entry" value={`₹${pos.entryPrice.toFixed(1)}`} />
                    <MiniStat label="Current" value={`₹${pos.currentPrice.toFixed(1)}`} />
                    <MiniStat label="P&L"
                      value={`${sig.pnlPercent >= 0 ? '+' : ''}${sig.pnlPercent.toFixed(1)}%`}
                      color={sig.pnlPercent >= 0 ? '#4caf50' : '#f44336'} />
                    <MiniStat label="Abs P&L"
                      value={`₹${sig.pnlAbsolute >= 0 ? '+' : ''}${sig.pnlAbsolute.toFixed(0)}`}
                      color={sig.pnlAbsolute >= 0 ? '#4caf50' : '#f44336'} />
                    {pos.optionVWAP && (
                      <MiniStat label="VWAP" value={`₹${pos.optionVWAP.toFixed(1)}`} color={pos.currentPrice >= pos.optionVWAP ? '#4caf50' : '#ab47bc'} />
                    )}

                    <Chip label={EXIT_LABELS[sig.exitType]}
                      size="small"
                      sx={{
                        bgcolor: `${ec}22`,
                        color: ec,
                        fontWeight: 800,
                        fontSize: '0.68rem',
                        height: 22,
                        border: `1px solid ${ec}66`,
                        ml: 'auto',
                      }}
                    />

                    <Box sx={{
                      px: 1, py: 0.3, borderRadius: 1,
                      bgcolor: sig.action === 'EXIT' ? 'rgba(244,67,54,0.15)' : 'rgba(84,110,122,0.15)',
                      color: sig.action === 'EXIT' ? '#f44336' : '#78909c',
                      fontWeight: 800, fontSize: '0.72rem',
                    }}>
                      {sig.action}
                    </Box>
                  </Box>

                  <Box sx={{ px: 1.5, pb: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Typography sx={{ fontSize: '0.65rem', color: '#90a4ae' }}>
                      {sig.reason}
                    </Typography>
                    {sig.details && (
                      <Typography sx={{ fontSize: '0.62rem', color: '#546e7a', fontStyle: 'italic' }}>
                        {sig.details}
                      </Typography>
                    )}
                  </Box>

                  <LinearProgress
                    variant="determinate"
                    value={Math.min(100, Math.max(0, sig.pnlPercent + 50))}
                    sx={{
                      height: 3,
                      bgcolor: 'rgba(255,255,255,0.04)',
                      '& .MuiLinearProgress-bar': {
                        bgcolor: sig.pnlPercent >= 0 ? '#4caf50' : '#f44336',
                      },
                    }}
                  />
                </Box>
              );
            })}
          </Box>
        )}

        {/* ── EXPANDED: RISK PANEL + CASCADE + ENTRY CONDITIONS ── */}
        <Collapse in={expanded}>
          <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)' }} />
          <Box sx={{ px: 2, py: 1.5 }}>

            {/* ── Priority Cascade Legend (8 conditions) ── */}
            <Typography sx={{ fontSize: '0.68rem', color: '#546e7a', fontWeight: 700, mb: 0.8, letterSpacing: 1 }}>
              EXIT PRIORITY CASCADE (FIRST MATCH WINS)
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, mb: 1.5, flexWrap: 'wrap' }}>
              {([1,2,3,4,5,6,7,8] as const).map(p => (
                <Box key={p} sx={{
                  px: 1, py: 0.3, borderRadius: 1, fontSize: '0.62rem', fontWeight: 700,
                  bgcolor: `${EXIT_COLORS[exitTypeFromPriority(p)]}18`,
                  color: EXIT_COLORS[exitTypeFromPriority(p)],
                  border: `1px solid ${EXIT_COLORS[exitTypeFromPriority(p)]}44`,
                }}>
                  {PRIORITY_LABELS[p]}
                </Box>
              ))}
            </Box>

            <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)', my: 1.5 }} />

            {/* ── RISK & SYSTEM PANEL ── */}
            <Typography sx={{ fontSize: '0.68rem', color: '#546e7a', fontWeight: 700, mb: 0.8, letterSpacing: 1 }}>
              RISK PANEL
            </Typography>
            {risk && (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
                <StatCell label="Hard Stop" value={`-${risk.hardStopPct}%`} color="#f44336" />
                <StatCell label="Trail Trigger" value={`+${risk.trailTriggerPct}%`} color="#ffc107" />
                <StatCell label="Trail Cut" value={`-${risk.trailCutPct}%`} color="#ff9800" />
                <StatCell label="Gamma Cutoff" value={`${risk.gammaCutoffHour}:${String(risk.gammaCutoffMinute).padStart(2,'0')}`} color="#ff5722" />
                <StatCell label="Gamma P&L Gate" value={`<${risk.gammaPnlGate}%`} color="#ff5722" />
                <StatCell label="Premium Cutoff" value={`${risk.premiumWeaknessHour}:${String(risk.premiumWeaknessMinute).padStart(2,'0')}`} color="#ab47bc" />
                <StatCell label="Theta Cutoff" value={`${risk.thetaCutoffHour}:${String(risk.thetaCutoffMinute).padStart(2,'0')}`} color="#9c27b0" />
                <StatCell label="Final Target" value={`+${risk.finalTargetPct}%`} color="#4caf50" />
                <StatCell label="IV Spike" value={`${risk.ivSpikeMultiplier}× (2-candle)`} color="#ff9800" />
                <StatCell label="OI Lookback" value={`${risk.oiLookbackCandles}m ago`} color="#e91e63" />
              </Box>
            )}

            {/* ── ENGINE TIMING ── */}
            <Typography sx={{ fontSize: '0.68rem', color: '#546e7a', fontWeight: 700, mb: 0.8, letterSpacing: 1 }}>
              ENGINE TIMING
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
              <StatCell label="Entry Eval" value="1m candle close" />
              <StatCell label="OI Calc" value="1m candle close" />
              <StatCell label="IV Calc" value="1m candle close" />
              <StatCell label="Trailing Stop" value="Tick level" />
              <StatCell label="Gamma Distance" value="Real-time" />
              <StatCell label="Time Rules" value="IST system clock" />
            </Box>

            <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)', my: 1.5 }} />

            {/* ── ENHANCED ENTRY VALIDATION CONDITIONS ── */}
            <Typography sx={{ fontSize: '0.68rem', color: '#546e7a', fontWeight: 700, mb: 0.8, letterSpacing: 1 }}>
              ENTRY CONDITIONS (ALL MUST BE TRUE)
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, mb: 1 }}>
              <EntryColumn title="CALL (CE) Entry" checks={[
                'Session 09:20 – 14:30 IST',
                'Spot Trend = Bullish (EMA9 > EMA21)',
                'Spot > VWAP',
                'VWAP Distance ≤ Index Limit %',
                'MomentumConfirmed (Range ≥ 1.2× Avg10)',
                'CurrentClose > PreviousHigh',
                'OI Structure = Long Buildup',
                'Volume ≥ 1.3× Volume_SMA20',
                'Delta ≥ 0.45',
                'No IV Spike (IV ≤ 1.5× Avg)',
                'Spread ≤ 3%',
                '|Strike − Spot| ≤ 0.6% × Spot',
                'OI ≥ Index_Min_OI',
                'Max 2 CE / 4 total positions',
              ]} color="#4caf50" />
              <EntryColumn title="PUT (PE) Entry" checks={[
                'Session 09:20 – 14:30 IST',
                'Spot Trend = Bearish (EMA9 < EMA21)',
                'Spot < VWAP',
                'VWAP Distance ≤ Index Limit %',
                'MomentumConfirmed (Range ≥ 1.2× Avg10)',
                'CurrentClose < PreviousLow',
                'OI Structure = Short Buildup',
                'Volume ≥ 1.3× Volume_SMA20',
                'Delta ≤ -0.45',
                'No IV Spike (IV ≤ 1.5× Avg)',
                'Spread ≤ 3%',
                '|Strike − Spot| ≤ 0.6% × Spot',
                'OI ≥ Index_Min_OI',
                'Max 2 PE / 4 total positions',
              ]} color="#f44336" />
            </Box>

            {/* ── POSITION LIMITS ── */}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
              <StatCell label="Max CE Positions" value="2" color="#4caf50" />
              <StatCell label="Max PE Positions" value="2" color="#f44336" />
              <StatCell label="Max Total" value="4" color="#ff9800" />
            </Box>

          </Box>
        </Collapse>
      </Box>

      {/* ── SETTINGS DIALOG ── */}
      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth="md" fullWidth
        PaperProps={{ sx: { bgcolor: '#1e1e2e', color: '#e0e0e0' } }}>
        <DialogTitle sx={{ fontWeight: 700 }}>Exit Engine Risk Settings</DialogTitle>
        <DialogContent>
          {editRisk && (
            <Grid container spacing={2} sx={{ mt: 0.5 }}>
              <Grid item xs={12}><Typography sx={{ fontSize: '0.75rem', color: '#78909c', fontWeight: 700 }}>STOP LOSS & TARGET</Typography></Grid>
              <Grid item xs={4}><RiskField label="Hard Stop %" value={editRisk.hardStopPct} onChange={v => setEditRisk({...editRisk, hardStopPct: v})} /></Grid>
              <Grid item xs={4}><RiskField label="Trail Trigger %" value={editRisk.trailTriggerPct} onChange={v => setEditRisk({...editRisk, trailTriggerPct: v})} /></Grid>
              <Grid item xs={4}><RiskField label="Trail Cut %" value={editRisk.trailCutPct} onChange={v => setEditRisk({...editRisk, trailCutPct: v})} /></Grid>
              <Grid item xs={4}><RiskField label="Final Target %" value={editRisk.finalTargetPct} onChange={v => setEditRisk({...editRisk, finalTargetPct: v})} /></Grid>

              <Grid item xs={12}><Typography sx={{ fontSize: '0.75rem', color: '#78909c', fontWeight: 700, mt: 1 }}>GAMMA RISK</Typography></Grid>
              <Grid item xs={3}><RiskField label="Gamma Hour" value={editRisk.gammaCutoffHour} onChange={v => setEditRisk({...editRisk, gammaCutoffHour: v})} /></Grid>
              <Grid item xs={3}><RiskField label="Gamma Minute" value={editRisk.gammaCutoffMinute} onChange={v => setEditRisk({...editRisk, gammaCutoffMinute: v})} /></Grid>
              <Grid item xs={3}><RiskField label="Gamma P&L Gate %" value={editRisk.gammaPnlGate} onChange={v => setEditRisk({...editRisk, gammaPnlGate: v})} /></Grid>

              <Grid item xs={12}><Typography sx={{ fontSize: '0.75rem', color: '#78909c', fontWeight: 700, mt: 1 }}>THETA & PREMIUM</Typography></Grid>
              <Grid item xs={3}><RiskField label="Theta Hour" value={editRisk.thetaCutoffHour} onChange={v => setEditRisk({...editRisk, thetaCutoffHour: v})} /></Grid>
              <Grid item xs={3}><RiskField label="Theta Minute" value={editRisk.thetaCutoffMinute} onChange={v => setEditRisk({...editRisk, thetaCutoffMinute: v})} /></Grid>
              <Grid item xs={3}><RiskField label="Theta P&L %" value={editRisk.thetaPnlThreshold} onChange={v => setEditRisk({...editRisk, thetaPnlThreshold: v})} /></Grid>
              <Grid item xs={3}><RiskField label="Premium P&L %" value={editRisk.premiumWeaknessPnl} onChange={v => setEditRisk({...editRisk, premiumWeaknessPnl: v})} /></Grid>
              <Grid item xs={3}><RiskField label="Prem Hour" value={editRisk.premiumWeaknessHour} onChange={v => setEditRisk({...editRisk, premiumWeaknessHour: v})} /></Grid>
              <Grid item xs={3}><RiskField label="Prem Minute" value={editRisk.premiumWeaknessMinute} onChange={v => setEditRisk({...editRisk, premiumWeaknessMinute: v})} /></Grid>

              <Grid item xs={12}><Typography sx={{ fontSize: '0.75rem', color: '#78909c', fontWeight: 700, mt: 1 }}>IV & OI</Typography></Grid>
              <Grid item xs={4}><RiskField label="IV Spike Multiplier" value={editRisk.ivSpikeMultiplier} onChange={v => setEditRisk({...editRisk, ivSpikeMultiplier: v})} /></Grid>
              <Grid item xs={4}><RiskField label="IV P&L Threshold %" value={editRisk.ivSpikePnlThreshold} onChange={v => setEditRisk({...editRisk, ivSpikePnlThreshold: v})} /></Grid>
              <Grid item xs={4}><RiskField label="OI Lookback (min)" value={editRisk.oiLookbackCandles} onChange={v => setEditRisk({...editRisk, oiLookbackCandles: v})} /></Grid>
              <Grid item xs={4}><RiskField label="OI Change %" value={editRisk.oiChangeThresholdPct} onChange={v => setEditRisk({...editRisk, oiChangeThresholdPct: v})} /></Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)} sx={{ color: '#90a4ae' }}>Cancel</Button>
          <Button onClick={saveRisk} variant="contained" color="primary">Save</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
//  SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────

function tickDown(t: TimerVal): TimerVal {
  if (t.hours === 0 && t.minutes === 0 && t.seconds === 0) return t;
  let s = t.seconds - 1, m = t.minutes, h = t.hours;
  if (s < 0) { s = 59; m--; }
  if (m < 0) { m = 59; h--; }
  if (h < 0) return { hours: 0, minutes: 0, seconds: 0 };
  return { hours: h, minutes: m, seconds: s };
}

function exitTypeFromPriority(p: number): ExitType {
  const map: Record<number, ExitType> = {
    1: 'OI_DISTRIBUTION',
    2: 'HARD_STOP',
    3: 'FINAL_TARGET',
    4: 'TRAILING_STOP',
    5: 'PREMIUM_WEAKNESS',
  };
  return map[p] || 'HOLD';
}

function TimerBox({ label, timer, active, color }: { label: string; timer: TimerVal; active: boolean; color: string }) {
  return (
    <Box sx={{ textAlign: 'center' }}>
      <Typography sx={{ fontSize: '0.58rem', color: '#78909c', mb: 0.2 }}>{label} Cutoff</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Timer sx={{ fontSize: 14, color: active ? color : '#546e7a' }} />
        <Typography sx={{
          fontFamily: 'monospace', fontWeight: 800, fontSize: '0.88rem',
          color: active ? color : '#78909c',
        }}>
          {active ? 'ACTIVE' : fmtTimer(timer)}
        </Typography>
      </Box>
    </Box>
  );
}

function CountBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Box sx={{ textAlign: 'center' }}>
      <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, color }}>{value}</Typography>
      <Typography sx={{ fontSize: '0.58rem', color: '#78909c' }}>{label}</Typography>
    </Box>
  );
}

function RiskBadge({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Box sx={{
      px: 0.8, py: 0.2, borderRadius: 1,
      bgcolor: `${color}14`, border: `1px solid ${color}33`,
    }}>
      <Typography sx={{ fontSize: '0.58rem', color: '#78909c' }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color }}>{value}</Typography>
    </Box>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box sx={{ minWidth: 55 }}>
      <Typography sx={{ fontSize: '0.55rem', color: '#546e7a' }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: color || '#b0bec5' }}>{value}</Typography>
    </Box>
  );
}

function StatCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box sx={{
      flex: '1 1 100px', bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 1,
      p: '6px 10px', minWidth: 90,
    }}>
      <Typography sx={{ fontSize: '0.62rem', color: '#78909c', mb: 0.2 }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: color || '#cfd8dc' }}>{value}</Typography>
    </Box>
  );
}

function EntryColumn({ title, checks, color }: { title: string; checks: string[]; color: string }) {
  return (
    <Box sx={{ flex: 1, bgcolor: 'rgba(255,255,255,0.02)', borderRadius: 1, p: 1.2 }}>
      <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, color, mb: 0.8 }}>{title}</Typography>
      {checks.map((c, i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.4 }}>
          <CheckCircle sx={{ fontSize: 12, color: '#546e7a' }} />
          <Typography sx={{ fontSize: '0.62rem', color: '#90a4ae' }}>{c}</Typography>
        </Box>
      ))}
    </Box>
  );
}

function RiskField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <TextField
      label={label}
      type="number"
      fullWidth
      size="small"
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      InputProps={{ sx: { color: '#e0e0e0', fontSize: '0.85rem' } }}
      InputLabelProps={{ sx: { color: '#78909c' } }}
      sx={{
        '& .MuiOutlinedInput-root': {
          '& fieldset': { borderColor: 'rgba(255,255,255,0.15)' },
          '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.3)' },
        },
      }}
    />
  );
}
