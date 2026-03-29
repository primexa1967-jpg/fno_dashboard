import { useState, useEffect } from 'react';
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
  Tabs,
  Tab,
  IconButton,
  Tooltip,
} from '@mui/material';
import { TrendingUp, TrendingDown, Refresh, ArrowBack } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

// ── Types matching new backend ──────────────────────────────

interface ATRData {
  atr14: number;
  atrPercent: number;
  pivot: number;
  highRange: number;
  lowRange: number;
  rangeWidth: number;
}

interface ExpectedMoveData {
  expectedMove: number;
  expectedMovePercent: number;
  upperBound: number;
  lowerBound: number;
  iv: number;
  daysUsed: number;
}

interface CombinedRangeData {
  atr: ATRData;
  expectedMove: ExpectedMoveData;
}

interface IndexRangeData {
  symbol: string;
  spotPrice: number;
  daily: CombinedRangeData;
  weekly: CombinedRangeData;
  monthly: CombinedRangeData;
  lastUpdated: number;
}

interface AllIndicesRangeData {
  indices: IndexRangeData[];
  timestamp: number;
}

type TimeFrame = 'daily' | 'weekly' | 'monthly';

export default function RangePage() {
  const navigate = useNavigate();
  const [rangeData, setRangeData] = useState<AllIndicesRangeData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTimeFrame, setSelectedTimeFrame] = useState<TimeFrame>('daily');
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchRangeData = async () => {
    try {
      setLoading(true);
      setError(null);
      const { data: result } = await apiClient.get('/ranges/all');
      if (result.success && result.data) {
        setRangeData(result.data);
        setLastRefresh(new Date());
      } else {
        throw new Error('Invalid response format');
      }
    } catch (err) {
      console.error('Error fetching range data:', err);
      setError('Failed to load range data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRangeData();
    const interval = setInterval(fetchRangeData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const handleTimeFrameChange = (_event: React.SyntheticEvent, newValue: TimeFrame) => {
    setSelectedTimeFrame(newValue);
  };

  const getPosition = (
    spot: number,
    high: number,
    low: number
  ): 'above' | 'below' | 'within' => {
    if (spot > high) return 'above';
    if (spot < low) return 'below';
    return 'within';
  };

  const posColor = (p: 'above' | 'below' | 'within') =>
    p === 'above' ? '#4caf50' : p === 'below' ? '#f44336' : '#ff9800';

  const posLabel = (p: 'above' | 'below' | 'within') =>
    p === 'above' ? 'ABOVE HIGH' : p === 'below' ? 'BELOW LOW' : 'IN RANGE';

  const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

  // ── Loading ──
  if (loading && !rangeData) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', flexDirection: 'column', gap: 2 }}>
        <CircularProgress size={60} />
        <Typography variant="h6" color="text.secondary">Loading Market Ranges...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <IconButton onClick={() => navigate('/')} sx={{ color: 'primary.main' }}>
            <ArrowBack />
          </IconButton>
          <Typography variant="h4" fontWeight="bold" color="primary">
            RANGE + EXPECTED MOVE ANALYSIS
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="caption" color="text.secondary">
            Last Updated: {lastRefresh.toLocaleTimeString()}
          </Typography>
          <Tooltip title="Refresh Data">
            <IconButton onClick={fetchRangeData} disabled={loading}>
              <Refresh sx={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Timeframe Tabs */}
      <Paper sx={{ mb: 3 }}>
        <Tabs value={selectedTimeFrame} onChange={handleTimeFrameChange} indicatorColor="primary" textColor="primary" centered>
          <Tab label="Daily (1 Day)" value="daily" />
          <Tab label="Weekly (5 Days)" value="weekly" />
          <Tab label="Monthly (21 Days)" value="monthly" />
        </Tabs>
      </Paper>

      {error && (
        <Paper sx={{ p: 2, mb: 3, bgcolor: 'error.dark' }}>
          <Typography color="error.contrastText">{error}</Typography>
        </Paper>
      )}

      {/* ── ATR(14) Range Table ── */}
      {rangeData && (
        <>
          <Typography variant="h6" sx={{ color: '#90caf9', mb: 1, fontWeight: 700 }}>
            📊 ATR(14) Range
          </Typography>
          <TableContainer component={Paper} sx={{ bgcolor: '#1e1e1e', mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: '#2a2a2a' }}>
                  <TH>Index</TH>
                  <TH align="right">Spot</TH>
                  <TH align="right">Pivot</TH>
                  <TH align="right" sx={{ color: '#4caf50' }}>ATR High</TH>
                  <TH align="right" sx={{ color: '#f44336' }}>ATR Low</TH>
                  <TH align="right">ATR(14)</TH>
                  <TH align="right">ATR %</TH>
                  <TH align="right">Range Width</TH>
                  <TH align="center">Position</TH>
                </TableRow>
              </TableHead>
              <TableBody>
                {rangeData.indices.map((idx) => {
                  const tf = idx[selectedTimeFrame];
                  const pos = getPosition(idx.spotPrice, tf.atr.highRange, tf.atr.lowRange);
                  return (
                    <TableRow key={idx.symbol} sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' } }}>
                      <TD bold>{idx.symbol}</TD>
                      <TD align="right" sx={{ color: '#ffc107' }}>₹{fmt(idx.spotPrice)}</TD>
                      <TD align="right" sx={{ color: '#90caf9' }}>₹{fmt(tf.atr.pivot)}</TD>
                      <TD align="right" sx={{ color: '#4caf50' }}>₹{fmt(tf.atr.highRange)}</TD>
                      <TD align="right" sx={{ color: '#f44336' }}>₹{fmt(tf.atr.lowRange)}</TD>
                      <TD align="right">{fmt(tf.atr.atr14)}</TD>
                      <TD align="right">{tf.atr.atrPercent}%</TD>
                      <TD align="right">{fmt(tf.atr.rangeWidth)}</TD>
                      <TD align="center">
                        <Chip
                          icon={pos === 'above' ? <TrendingUp /> : pos === 'below' ? <TrendingDown /> : undefined}
                          label={posLabel(pos)}
                          size="small"
                          sx={{ bgcolor: posColor(pos), color: 'white', fontWeight: 'bold', '& .MuiChip-icon': { color: 'white' } }}
                        />
                      </TD>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          {/* ── Expected Move Table ── */}
          <Typography variant="h6" sx={{ color: '#ce93d8', mb: 1, fontWeight: 700 }}>
            🎯 Expected Move (IV-Based)
          </Typography>
          <TableContainer component={Paper} sx={{ bgcolor: '#1e1e1e', mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: '#2a2a2a' }}>
                  <TH>Index</TH>
                  <TH align="right">Spot</TH>
                  <TH align="right" sx={{ color: '#4caf50' }}>Upper Bound</TH>
                  <TH align="right" sx={{ color: '#f44336' }}>Lower Bound</TH>
                  <TH align="right">Expected Move</TH>
                  <TH align="right">EM %</TH>
                  <TH align="right">IV Used</TH>
                  <TH align="center">Position</TH>
                </TableRow>
              </TableHead>
              <TableBody>
                {rangeData.indices.map((idx) => {
                  const tf = idx[selectedTimeFrame];
                  const pos = getPosition(idx.spotPrice, tf.expectedMove.upperBound, tf.expectedMove.lowerBound);
                  return (
                    <TableRow key={idx.symbol} sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' } }}>
                      <TD bold>{idx.symbol}</TD>
                      <TD align="right" sx={{ color: '#ffc107' }}>₹{fmt(idx.spotPrice)}</TD>
                      <TD align="right" sx={{ color: '#4caf50' }}>₹{fmt(tf.expectedMove.upperBound)}</TD>
                      <TD align="right" sx={{ color: '#f44336' }}>₹{fmt(tf.expectedMove.lowerBound)}</TD>
                      <TD align="right">{fmt(tf.expectedMove.expectedMove)}</TD>
                      <TD align="right">{tf.expectedMove.expectedMovePercent}%</TD>
                      <TD align="right">{tf.expectedMove.iv}%</TD>
                      <TD align="center">
                        <Chip
                          icon={pos === 'above' ? <TrendingUp /> : pos === 'below' ? <TrendingDown /> : undefined}
                          label={posLabel(pos)}
                          size="small"
                          sx={{ bgcolor: posColor(pos), color: 'white', fontWeight: 'bold', '& .MuiChip-icon': { color: 'white' } }}
                        />
                      </TD>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          {/* ── Combined Analysis ── */}
          <Typography variant="h6" sx={{ color: '#ffcc80', mb: 1, fontWeight: 700 }}>
            🔀 Combined Range Analysis
          </Typography>
          <TableContainer component={Paper} sx={{ bgcolor: '#1e1e1e', mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: '#2a2a2a' }}>
                  <TH>Index</TH>
                  <TH align="right">Spot</TH>
                  <TH align="right" sx={{ color: '#4caf50' }}>Upper (Max)</TH>
                  <TH align="right" sx={{ color: '#f44336' }}>Lower (Min)</TH>
                  <TH align="right">ATR Width</TH>
                  <TH align="right">EM Width</TH>
                  <TH align="center">Overlap</TH>
                </TableRow>
              </TableHead>
              <TableBody>
                {rangeData.indices.map((idx) => {
                  const tf = idx[selectedTimeFrame];
                  const upper = Math.max(tf.atr.highRange, tf.expectedMove.upperBound);
                  const lower = Math.min(tf.atr.lowRange, tf.expectedMove.lowerBound);
                  const intHigh = Math.min(tf.atr.highRange, tf.expectedMove.upperBound);
                  const intLow = Math.max(tf.atr.lowRange, tf.expectedMove.lowerBound);
                  const intersection = Math.max(0, intHigh - intLow);
                  const union = upper - lower;
                  const overlapPct = union > 0 ? ((intersection / union) * 100).toFixed(0) : '0';
                  return (
                    <TableRow key={idx.symbol} sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' } }}>
                      <TD bold>{idx.symbol}</TD>
                      <TD align="right" sx={{ color: '#ffc107' }}>₹{fmt(idx.spotPrice)}</TD>
                      <TD align="right" sx={{ color: '#4caf50' }}>₹{fmt(upper)}</TD>
                      <TD align="right" sx={{ color: '#f44336' }}>₹{fmt(lower)}</TD>
                      <TD align="right">{fmt(tf.atr.rangeWidth)}</TD>
                      <TD align="right">{fmt(tf.expectedMove.expectedMove * 2)}</TD>
                      <TD align="center">
                        <Chip
                          label={`${overlapPct}%`}
                          size="small"
                          sx={{
                            bgcolor: Number(overlapPct) > 70 ? '#4caf50' : Number(overlapPct) > 40 ? '#ff9800' : '#f44336',
                            color: 'white',
                            fontWeight: 'bold',
                          }}
                        />
                      </TD>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      {/* Legend */}
      <Paper sx={{ p: 2, mt: 2, bgcolor: '#1e1e1e' }}>
        <Typography variant="h6" color="primary" gutterBottom>
          How to Read Range + Expected Move
        </Typography>
        <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <Box>
            <Typography variant="body2" color="text.secondary">
              <strong>ATR(14)</strong> — Average of (High − Low) over last 14 periods.
              Pivot = (H+L+C)/3. High = Pivot + ATR, Low = Pivot − ATR
            </Typography>
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary">
              <strong>Expected Move</strong> — Spot × IV × √(Days / 365).
              Daily=1d, Weekly=5d, Monthly=21d
            </Typography>
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary">
              <strong>Overlap %</strong> — Intersection of ATR and EM ranges.
              Higher overlap = more agreement between methods
            </Typography>
          </Box>
        </Box>
        <Box sx={{ mt: 2, display: 'flex', gap: 3 }}>
          <Chip label="ABOVE HIGH" sx={{ bgcolor: '#4caf50', color: 'white' }} size="small" />
          <Typography variant="caption" color="text.secondary">Bullish — Price above resistance</Typography>
          <Chip label="IN RANGE" sx={{ bgcolor: '#ff9800', color: 'white' }} size="small" />
          <Typography variant="caption" color="text.secondary">Neutral — Wait for breakout</Typography>
          <Chip label="BELOW LOW" sx={{ bgcolor: '#f44336', color: 'white' }} size="small" />
          <Typography variant="caption" color="text.secondary">Bearish — Price below support</Typography>
        </Box>
      </Paper>
    </Box>
  );
}

// ── Styled helper components ──

function TH({ children, align, sx, ...props }: any) {
  return (
    <TableCell
      align={align || 'left'}
      sx={{ color: 'white', fontWeight: 'bold', fontSize: '0.9rem', ...sx }}
      {...props}
    >
      {children}
    </TableCell>
  );
}

function TD({ children, align, bold, sx, ...props }: any) {
  return (
    <TableCell
      align={align || 'left'}
      sx={{
        color: '#e0e0e0',
        fontWeight: bold ? 'bold' : 500,
        fontSize: bold ? '1.05rem' : '0.95rem',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        ...sx,
      }}
      {...props}
    >
      {children}
    </TableCell>
  );
}
