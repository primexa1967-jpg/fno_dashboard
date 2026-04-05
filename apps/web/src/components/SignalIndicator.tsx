import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  LinearProgress,
  Chip,
  Collapse,
  IconButton,
  Divider,
} from '@mui/material';
import { ExpandMore, ExpandLess } from '@mui/icons-material';
import apiClient from '../api/client';

// 
// Types (mirror backend)
// 
type FinalBias = 'Bullish' | 'Mild_Bullish' | 'Neutral' | 'Mild_Bearish' | 'Bearish';
type AlignmentType = 'Strong' | 'Mixed';

interface SignalIndicators {
  spotPrice: number;
  vwap: number;
  pcr: number;
  oiChangeCE: number;
  oiChangePE: number;
  ivChange: number;
  ivChange15m: number;
  volumeChange: number;
  volumeChange15m: number;
  priceChange: number;
  callCluster: number;
  putCluster: number;
  structurePCR: -1 | 0 | 1;
  structureCluster: -1 | 0 | 1;
  structureGamma?: -1 | 0 | 1;
  structureScore: number;
  flowScore: number;
  momentumScore: number;
  vwapDeviation: number;
  vwapScore: -1 | 0 | 1;
  ivScore: -1 | 0 | 1;
  netFlow: number;
  tfScore: number;
  finalScore: number;
  finalBias: FinalBias;
  bias3m: FinalBias;
  bias5m: FinalBias;
  bias15m: FinalBias;
  trend3m: 'UP' | 'DOWN' | 'NEUTRAL';
  trend5m: 'UP' | 'DOWN' | 'NEUTRAL';
  trend15m: 'UP' | 'DOWN' | 'NEUTRAL';
  timestamp: string;
}

type ConfidenceDirection = 'Bullish' | 'Bearish' | 'Neutral';

interface ConfidenceEngineOutput {
  pipelineOrder: string;
  rangeState: string;
  rangeReliability: string;
  overlapPercent: number;
  componentScores: {
    structure: number;
    oiFlow: number;
    gamma: number;
    momentum: number;
    alignment: number;
  };
  weightsUsed: Record<string, number>;
  confidenceRaw: number;
  confidenceBeforeDeepRange?: number;
  confidenceAdjusted: number;
  confidenceTier: string;
  direction: ConfidenceDirection;
  tradeZone: string;
  adjustmentNotes: string[];
  triggerStatus: string;
  triggerType: string;
  triggerLevelHint: string;
  invalidationHint: string;
  targetZoneHint: string;
  extensionZoneHint: string;
  momentumStatus: string;
  marketProfile: string;
  scannerSetupStrength: string;
}

interface SignalData {
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  confidence: number;
  alignment: AlignmentType;
  indicators: SignalIndicators;
  reasons: string[];
  confidenceEngine?: ConfidenceEngineOutput;
}

interface SignalIndicatorProps {
  symbol: string;
  expiry?: string;
}

// 
// Color helpers
// 
const BIAS_COLORS: Record<FinalBias, string> = {
  Bullish:      '#00e676',
  Mild_Bullish: '#69f0ae',
  Neutral:      '#90a4ae',
  Mild_Bearish: '#ff8a65',
  Bearish:      '#f44336',
};

const BIAS_LABELS: Record<FinalBias, string> = {
  Bullish:      ' BULLISH',
  Mild_Bullish: ' MILD BULLISH',
  Neutral:      ' NEUTRAL',
  Mild_Bearish: ' MILD BEARISH',
  Bearish:      ' BEARISH',
};

function biasColor(b: FinalBias): string {
  return BIAS_COLORS[b] || '#90a4ae';
}

function directionColor(d: ConfidenceDirection): string {
  if (d === 'Bullish') return '#00e676';
  if (d === 'Bearish') return '#f44336';
  return '#90a4ae';
}

function formatRangeState(s: string): string {
  return s.replace(/_/g, ' ');
}

function scoreColor(v: number): string {
  if (v > 0) return '#69f0ae';
  if (v < 0) return '#ff8a65';
  return '#90a4ae';
}

function fmt(v: number, decimals = 2, showSign = false): string {
  const s = v.toFixed(decimals);
  return showSign && v > 0 ? `+${s}` : s;
}

function fmtK(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000)     return `${Math.round(v / 1000)}K`;
  return String(v);
}

// 
// Sub-components
// 
function ScoreBar({ label, value, max = 2 }: { label: string; value: number; max?: number }) {
  const pct = Math.round(((value + max) / (max * 2)) * 100);
  const color = scoreColor(value);
  return (
    <Box sx={{ mb: 0.8 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
        <Typography variant="caption" sx={{ color: '#b0bec5', fontSize: '0.72rem' }}>{label}</Typography>
        <Typography variant="caption" sx={{ color, fontWeight: 700, fontSize: '0.72rem' }}>
          {fmt(value, 2, true)}
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{
          height: 5,
          borderRadius: 3,
          backgroundColor: 'rgba(255,255,255,0.08)',
          '& .MuiLinearProgress-bar': { backgroundColor: color, borderRadius: 3 },
        }}
      />
    </Box>
  );
}

function StatCell({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <Box sx={{
      flex: '1 1 100px',
      bgcolor: 'rgba(255,255,255,0.04)',
      borderRadius: 1,
      p: '6px 10px',
      minWidth: 90,
    }}>
      <Typography sx={{ fontSize: '0.65rem', color: '#78909c', mb: 0.2 }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: color || '#cfd8dc' }}>{value}</Typography>
    </Box>
  );
}

// 
// Main component
// 
const SignalIndicator: React.FC<SignalIndicatorProps> = ({ symbol, expiry }) => {
  const [data, setData] = useState<SignalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expiry) {
      setLoading(false);
      setError('Select an expiry to view Confidence Engine');
      return;
    }

    const fetchSignal = async () => {
      try {
        const url = `/signal/live?symbol=${encodeURIComponent(symbol)}&expiry=${encodeURIComponent(expiry)}`;
        const { data: json } = await apiClient.get(url);
        setData(json);
        setError(null);
      } catch (e) {
        console.error('Signal fetch error:', e);
        setError('Failed to fetch Confidence Engine');
      } finally {
        setLoading(false);
      }
    };

    fetchSignal();
    const id = setInterval(fetchSignal, 20000); // Refresh every 20s (staggered to prevent 429s)
    return () => clearInterval(id);
  }, [symbol, expiry]);

  //  NO TRADE ZONE detection 
  const isNTZ = (): boolean => {
    if (!data) return false;
    const { pcr, spotPrice, vwap, oiChangeCE, oiChangePE } = data.indicators;
    return (
      pcr >= 0.95 && pcr <= 1.10 &&
      Math.abs(oiChangeCE - oiChangePE) < 10 &&
      (vwap > 0 ? Math.abs(vwap - spotPrice) / spotPrice < 0.005 : false)
    );
  };

  const ntZone = data ? isNTZ() : false;
  const bias: FinalBias = data?.indicators.finalBias || 'Neutral';
  const ce = data?.confidenceEngine;
  const rangeNoTrade = ce?.tradeZone === 'NO_TRADE_ZONE';
  const displayDir = ce?.direction;
  const bColor =
    rangeNoTrade || ntZone
      ? '#ff9800'
      : displayDir
        ? directionColor(displayDir)
        : biasColor(bias);
  const confidence = data?.confidence ?? 20;
  const alignment: AlignmentType = data?.alignment || 'Mixed';

  const headerLabel =
    rangeNoTrade
      ? ' NO TRADE (RANGE)'
      : ntZone
        ? ' NO TRADE ZONE'
        : displayDir
          ? ` ${displayDir.toUpperCase()}`
          : BIAS_LABELS[bias];

  if (loading) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Typography variant="caption" color="text.secondary">Loading Confidence Engine</Typography>
      </Box>
    );
  }

  if (error || !data) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Typography variant="caption" color="text.secondary">{error || 'No data'}</Typography>
      </Box>
    );
  }

  const ind = data.indicators;

  return (
    <Box sx={{
      width: '100%',
      background: 'linear-gradient(135deg, rgba(18,18,28,0.97) 0%, rgba(22,22,35,0.97) 100%)',
      borderRadius: 2,
      border: `1.5px solid ${bColor}44`,
      boxShadow: `0 0 18px ${bColor}22`,
      overflow: 'hidden',
      transition: 'border-color 0.3s',
    }}>

      {/*  Compact Header  */}
      <Box
        onClick={() => setExpanded(x => !x)}
        sx={{ cursor: 'pointer', px: 2, py: 1.2, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}
      >
        {/* Bias pill */}
        <Box sx={{
          px: 1.4, py: 0.4, borderRadius: '20px',
          bgcolor: `${bColor}22`,
          border: `1px solid ${bColor}66`,
          display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 140,
        }}>
          <Typography sx={{ color: bColor, fontWeight: 800, fontSize: '0.82rem', letterSpacing: 1 }}>
            {headerLabel}
          </Typography>
        </Box>

        {/* Confidence bar */}
        <Box sx={{ flex: 1, minWidth: 120, maxWidth: 220 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
            <Typography sx={{ fontSize: '0.65rem', color: '#78909c' }}>Confidence (adj.)</Typography>
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: bColor }}>{confidence}%</Typography>
          </Box>
          {ce && (
            <Typography sx={{ fontSize: '0.58rem', color: '#546e7a', mb: 0.3 }}>
              Raw {ce.confidenceRaw}% (weighted baseline)
              {ce.rangeState === 'DEEP_RANGE' &&
              typeof ce.confidenceBeforeDeepRange === 'number' &&
              ce.confidenceBeforeDeepRange !== ce.confidenceAdjusted
                ? ` · before deep-range rule: ${ce.confidenceBeforeDeepRange}%`
                : ''}
              {' · '}{ce.confidenceTier} · {ce.pipelineOrder}
            </Typography>
          )}
          <LinearProgress
            variant="determinate"
            value={Math.min(100, Math.max(0, confidence))}
            sx={{
              height: 6, borderRadius: 3,
              backgroundColor: 'rgba(255,255,255,0.08)',
              '& .MuiLinearProgress-bar': { backgroundColor: bColor, borderRadius: 3 },
            }}
          />
        </Box>

        {/* Alignment chip */}
        <Chip
          label={`${alignment === 'Strong' ? '' : '~'} ${alignment}`}
          size="small"
          sx={{
            bgcolor: alignment === 'Strong' ? 'rgba(0,230,118,0.12)' : 'rgba(255,152,0,0.12)',
            color: alignment === 'Strong' ? '#00e676' : '#ff9800',
            fontWeight: 700, fontSize: '0.7rem', height: 22,
          }}
        />

        {/* TF Score */}
        <Box sx={{ textAlign: 'center', minWidth: 60 }}>
          <Typography sx={{ fontSize: '0.62rem', color: '#78909c' }}>TF Score</Typography>
          <Typography sx={{ fontSize: '0.85rem', fontWeight: 800, color: scoreColor(ind.finalScore) }}>
            {fmt(ind.finalScore, 2, true)}
          </Typography>
        </Box>

        {/* PCR chip */}
        <Chip
          label={`PCR ${ind.pcr.toFixed(2)}`}
          size="small"
          sx={{
            bgcolor: ind.pcr < 0.7 ? 'rgba(244,67,54,0.15)' :
                     ind.pcr > 1.1 ? 'rgba(0,230,118,0.15)' : 'rgba(144,164,174,0.15)',
            color: ind.pcr < 0.7 ? '#f44336' :
                   ind.pcr > 1.1 ? '#00e676' : '#90a4ae',
            fontWeight: 700, fontSize: '0.7rem', height: 22,
          }}
        />

        {/* Timeframe bias chips */}
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {(['bias3m', 'bias5m', 'bias15m'] as const).map((k, i) => (
            <Box key={k} sx={{
              px: 0.7, py: 0.2, borderRadius: 1,
              bgcolor: `${biasColor(ind[k])}18`,
              border: `1px solid ${biasColor(ind[k])}44`,
            }}>
              <Typography sx={{ fontSize: '0.62rem', color: biasColor(ind[k]), fontWeight: 700 }}>
                {['3m','5m','15m'][i]}
              </Typography>
            </Box>
          ))}
        </Box>

        <IconButton
          size="small"
          onClick={e => { e.stopPropagation(); setExpanded(x => !x); }}
          sx={{ color: '#78909c', p: 0, ml: 'auto' }}
        >
          {expanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
        </IconButton>
      </Box>

      {ce && (
        <>
          <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)' }} />
          <Box sx={{ px: 2, py: 1.25, bgcolor: 'rgba(0,0,0,0.15)' }}>
            <Typography sx={{ fontSize: '0.62rem', color: '#7e8ffa', fontWeight: 800, letterSpacing: 1.2, mb: 0.8 }}>
              TRADE STRUCTURE
            </Typography>
            <Typography sx={{ fontSize: '0.68rem', color: '#cfd8dc', fontFamily: 'monospace', lineHeight: 1.6 }}>
              Trigger Status&nbsp;&nbsp;: {ce.triggerStatus}
              <br />
              Trigger Type&nbsp;&nbsp;&nbsp;&nbsp;: {ce.triggerType}
              <br />
              Trigger Level&nbsp;&nbsp;: {ce.triggerLevelHint}
              <br />
              Invalidation&nbsp;&nbsp;&nbsp;: {ce.invalidationHint}
              <br />
              Target Zone&nbsp;&nbsp;&nbsp;&nbsp;: {ce.targetZoneHint}
              <br />
              Extension Zone&nbsp;: {ce.extensionZoneHint}
              <br />
              Momentum Status: {ce.momentumStatus}
            </Typography>
            <Typography sx={{ fontSize: '0.62rem', color: '#546e7a', fontWeight: 700, letterSpacing: 1.2, mt: 1.2, mb: 0.5 }}>
              MARKET OVERVIEW
            </Typography>
            <Typography sx={{ fontSize: '0.68rem', color: '#cfd8dc', fontFamily: 'monospace', lineHeight: 1.6 }}>
              Selected Index&nbsp;&nbsp;&nbsp;: {symbol}
              <br />
              Profile&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: {ce.marketProfile}
              <br />
              Market State&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: {formatRangeState(ce.rangeState)}
              <br />
              Range Reliability : {ce.rangeReliability}
              <br />
              Confidence&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: {ce.confidenceAdjusted}% ({ce.confidenceTier}){ce.rangeState === 'DEEP_RANGE' && typeof ce.confidenceBeforeDeepRange === 'number' ? ` · was ${ce.confidenceBeforeDeepRange}% pre gate` : ''}
              <br />
              Bias&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: {ce.direction}
              <br />
              Momentum&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: {ce.momentumStatus}
              <br />
              Scanner Strength&nbsp;: {ce.scannerSetupStrength}
            </Typography>
            <Typography sx={{ fontSize: '0.58rem', color: '#546e7a', mt: 1, fontStyle: 'italic' }}>
              General information only — not financial advice. Analytical context from live range + options data.
            </Typography>
          </Box>
        </>
      )}

      {/*  Expanded Panel  */}
      <Collapse in={expanded}>
        <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)' }} />

        <Box sx={{ px: 2, py: 1.5 }}>

          {ce && (
            <>
              <Typography sx={{ fontSize: '0.68rem', color: '#546e7a', fontWeight: 700, mb: 0.8, letterSpacing: 1 }}>
                CONFIDENCE COMPONENTS (+1 / 0 / −1) & WEIGHTS
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
                {(['structure', 'oiFlow', 'gamma', 'momentum', 'alignment'] as const).map((k) => (
                  <StatCell
                    key={k}
                    label={`${k} (${((ce.weightsUsed[k] ?? 0) * 100).toFixed(0)}%)`}
                    value={`${ce.componentScores[k]}`}
                    color={scoreColor(ce.componentScores[k])}
                  />
                ))}
                <StatCell label="Overlap %" value={`${ce.overlapPercent}%`} color="#90caf9" />
              </Box>
              <Typography sx={{ fontSize: '0.65rem', color: '#78909c', mb: 1 }}>
                Adjustments: {ce.adjustmentNotes.length ? ce.adjustmentNotes.join(' · ') : 'None'}
              </Typography>
              <Typography sx={{ fontSize: '0.6rem', color: '#607d8b', mb: 1, lineHeight: 1.45 }}>
                Discrete buckets use −1/0/+1 (OI Δ needs prior snapshot — 0% until history builds).
                Legacy “Strong” alignment = same bias on 3m/5m/15m (e.g. all Neutral); discrete alignment
                needs all three price trends UP or all DOWN.
              </Typography>
              <Typography sx={{ fontSize: '0.68rem', color: '#546e7a', fontWeight: 700, mb: 0.8, letterSpacing: 1 }}>
                RISK MANAGEMENT (CONTEXT)
              </Typography>
              <Typography sx={{ fontSize: '0.65rem', color: '#b0bec5', lineHeight: 1.5, mb: 1.5 }}>
                Support / resistance: use combined ATR–EM band edges and session VWAP proxy as indicative zones only.
                Profit logic: scale near opposing structure; on momentum slowdown treat as caution.
                Trailing: strong momentum → hold context; weakening → partial reduction; reversal → defensive.
              </Typography>
              <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)', mb: 1.2 }} />
            </>
          )}

          {/*  Score Breakdown bars  */}
          <Typography sx={{ fontSize: '0.68rem', color: '#546e7a', fontWeight: 700, mb: 0.8, letterSpacing: 1 }}>
            SCORE BREAKDOWN
          </Typography>
          <Box sx={{ mb: 1.5 }}>
            <ScoreBar label="Structure  (OI + Gamma + PCR)"    value={ind.structureScore} />
            <ScoreBar label="Flow       (Net OI Δ%)"           value={ind.flowScore} />
            <ScoreBar label="Momentum   (VWAP + IV + Volume)"  value={ind.momentumScore} />
          </Box>

          {/* Score cells */}
          <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
            <StatCell label="Structure"   value={fmt(ind.structureScore, 2, true)}  color={scoreColor(ind.structureScore)} />
            <StatCell label="Flow"        value={fmt(ind.flowScore, 2, true)}       color={scoreColor(ind.flowScore)} />
            <StatCell label="Momentum"    value={fmt(ind.momentumScore, 2, true)}   color={scoreColor(ind.momentumScore)} />
            <StatCell label="TF Score"    value={fmt(ind.tfScore, 3, true)}         color={scoreColor(ind.tfScore)} />
            <StatCell label="Final Score" value={fmt(ind.finalScore, 3, true)}      color={bColor} />
          </Box>

          <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)', mb: 1.2 }} />

          {/*  Structure detail  */}
          <Typography sx={{ fontSize: '0.68rem', color: '#546e7a', fontWeight: 700, mb: 0.8, letterSpacing: 1 }}>
            STRUCTURE  (CONDITION 1)
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
            <StatCell label="PCR"           value={ind.pcr.toFixed(2)}
              color={ind.structurePCR === 1 ? '#00e676' : ind.structurePCR === -1 ? '#f44336' : '#90a4ae'} />
            <StatCell label="PCR Score"     value={`${ind.structurePCR > 0 ? '+' : ''}${ind.structurePCR}`}
              color={scoreColor(ind.structurePCR)} />
            <StatCell label="Call Cluster"  value={fmtK(ind.callCluster)}  color="#ff8a65" />
            <StatCell label="Put Cluster"   value={fmtK(ind.putCluster)}   color="#69f0ae" />
            <StatCell label="Cluster Score" value={`${ind.structureCluster > 0 ? '+' : ''}${ind.structureCluster}`}
              color={scoreColor(ind.structureCluster)} />
            {ind.structureGamma !== undefined && (
              <StatCell
                label="Gamma (ATM)"
                value={`${ind.structureGamma > 0 ? '+' : ''}${ind.structureGamma}`}
                color={scoreColor(ind.structureGamma)}
              />
            )}
          </Box>

          <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)', mb: 1.2 }} />

          {/*  Flow detail  */}
          <Typography sx={{ fontSize: '0.68rem', color: '#546e7a', fontWeight: 700, mb: 0.8, letterSpacing: 1 }}>
            FLOW  (CONDITION 2)
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
            <StatCell label="CE OI Chg%"  value={`${fmt(ind.oiChangeCE, 2, true)}%`}  color={scoreColor(-ind.oiChangeCE)} />
            <StatCell label="PE OI Chg%"  value={`${fmt(ind.oiChangePE, 2, true)}%`}  color={scoreColor(ind.oiChangePE)} />
            <StatCell label="Net Flow"    value={`${fmt(ind.netFlow, 2, true)}%`}      color={scoreColor(ind.netFlow)} />
            <StatCell label="Flow Score"  value={`${ind.flowScore > 0 ? '+' : ''}${ind.flowScore}`}
              color={scoreColor(ind.flowScore)} />
          </Box>

          <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)', mb: 1.2 }} />

          {/*  Momentum detail  */}
          <Typography sx={{ fontSize: '0.68rem', color: '#546e7a', fontWeight: 700, mb: 0.8, letterSpacing: 1 }}>
            MOMENTUM  (CONDITION 3)
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
            <StatCell label="VWAP Dev%"    value={`${fmt(ind.vwapDeviation, 2, true)}%`}    color={scoreColor(ind.vwapScore)} />
            <StatCell label="VWAP Score"   value={`${ind.vwapScore > 0 ? '+' : ''}${ind.vwapScore}`}   color={scoreColor(ind.vwapScore)} />
            <StatCell label="IV Chg%"      value={`${fmt(ind.ivChange, 2, true)}%`}          color={scoreColor(ind.ivScore)} />
            <StatCell label="IV Score"     value={`${ind.ivScore > 0 ? '+' : ''}${ind.ivScore}`}    color={scoreColor(ind.ivScore)} />
            <StatCell label="Vol Chg%"     value={`${fmt(ind.volumeChange, 1, true)}%`}      color={scoreColor(ind.volumeChange)} />
            <StatCell label="IV 15m Chg%"  value={`${fmt(ind.ivChange15m, 2, true)}%`}      color={scoreColor(ind.ivChange15m)} />
            <StatCell label="Vol 15m Chg%" value={`${fmt(ind.volumeChange15m, 1, true)}%`}  color={scoreColor(ind.volumeChange15m)} />
          </Box>

          <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)', mb: 1.2 }} />

          {/*  Confidence & Alignment  */}
          <Typography sx={{ fontSize: '0.68rem', color: '#546e7a', fontWeight: 700, mb: 0.8, letterSpacing: 1 }}>
            CONFIDENCE  (C6)  &  ALIGNMENT  (C7)
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
            <StatCell label="Confidence"  value={`${confidence}%`}   color={bColor} />
            <StatCell label="Alignment"   value={alignment}
              color={alignment === 'Strong' ? '#00e676' : '#ff9800'} />
            <StatCell label="Final Bias"  value={bias.replace('_', ' ')}  color={bColor} />
          </Box>

          <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)', mb: 1.2 }} />

          {/*  TF Bias strip  */}
          <Typography sx={{ fontSize: '0.68rem', color: '#546e7a', fontWeight: 700, mb: 0.8, letterSpacing: 1 }}>
            TIMEFRAME ALIGNMENT  (C7)
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
            {(['bias3m', 'bias5m', 'bias15m'] as const).map((k, i) => {
              const b = ind[k];
              const bc = biasColor(b);
              return (
                <Box key={k} sx={{
                  flex: 1, textAlign: 'center', py: 0.8, borderRadius: 1,
                  bgcolor: `${bc}14`, border: `1px solid ${bc}44`,
                }}>
                  <Typography sx={{ fontSize: '0.65rem', color: '#78909c', mb: 0.3 }}>
                    {['3m', '5m', '15m'][i]}
                  </Typography>
                  <Typography sx={{ fontSize: '0.73rem', fontWeight: 800, color: bc }}>
                    {b.replace('_', ' ')}
                  </Typography>
                </Box>
              );
            })}
          </Box>

          {/*  Reasons  */}
          {data.reasons.length > 0 && (
            <>
              <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)', mb: 1.2 }} />
              <Typography sx={{ fontSize: '0.68rem', color: '#546e7a', fontWeight: 700, mb: 0.8, letterSpacing: 1 }}>
                SIGNAL REASONS
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
                {data.reasons.map((r, i) => (
                  <Chip key={i} label={r} size="small" variant="outlined"
                    sx={{ fontSize: '0.65rem', height: 20, borderColor: 'rgba(255,255,255,0.12)', color: '#b0bec5' }} />
                ))}
              </Box>
            </>
          )}

          {/* Timestamp */}
          <Typography variant="caption" sx={{
            color: '#546e7a', display: 'block', mt: 1.5, textAlign: 'right', fontSize: '0.62rem',
          }}>
            Updated: {new Date(ind.timestamp).toLocaleTimeString()}
          </Typography>
        </Box>
      </Collapse>
    </Box>
  );
};

export default SignalIndicator;
