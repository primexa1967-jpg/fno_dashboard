import { useState, useEffect } from 'react';
import { 
  Box, 
  Typography, 
  Paper, 
  Chip, 
  CircularProgress,
  Tooltip,
  IconButton,
  Collapse,
  Grid
} from '@mui/material';
import apiClient from '../api/client';
import { 
  TrendingUp, 
  TrendingDown, 
  RemoveCircleOutline,
  ExpandMore,
  ExpandLess,
  Refresh
} from '@mui/icons-material';

interface CamarillaLevels {
  h4: number;
  h3: number;
  h2: number;
  h1: number;
  pivot: number;
  l1: number;
  l2: number;
  l3: number;
  l4: number;
}

interface CamarillaSignal {
  signal: 'BUY CALL' | 'BUY PUT' | 'NO TRADE' | 'WAIT BREAKOUT' | 'WAIT BREAKDOWN';
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
  reason: string;
  targetLevel: number | null;
  stopLossLevel: number | null;
}

interface CamarillaData {
  symbol: string;
  spotPrice: number;
  levels: CamarillaLevels;
  signal: CamarillaSignal;
  pricePosition: string;
  weeklyOHLC: {
    open: number;
    high: number;
    low: number;
    close: number;
  };
  timestamp: number;
}

interface CamarillaBreakoutCardProps {
  symbol: string;
}

export default function CamarillaBreakoutCard({ symbol }: CamarillaBreakoutCardProps) {
  const [data, setData] = useState<CamarillaData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<boolean>(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const { data: result } = await apiClient.get(`/camarilla/${symbol}`);
      if (result.success && result.data) {
        setData(result.data);
      } else {
        throw new Error('Invalid response format');
      }
    } catch (err) {
      console.error('Error fetching Camarilla data:', err);
      setError('Failed to load Camarilla data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [symbol]);

  const getSignalColor = (signal: string): string => {
    if (signal === 'BUY CALL') return '#4caf50';
    if (signal === 'BUY PUT') return '#f44336';
    if (signal === 'WAIT BREAKOUT' || signal === 'WAIT BREAKDOWN') return '#ff9800';
    return '#9e9e9e';
  };

  const getSignalIcon = (signal: string) => {
    if (signal === 'BUY CALL' || signal === 'WAIT BREAKOUT') {
      return <TrendingUp sx={{ color: signal === 'BUY CALL' ? '#4caf50' : '#ff9800' }} />;
    }
    if (signal === 'BUY PUT' || signal === 'WAIT BREAKDOWN') {
      return <TrendingDown sx={{ color: signal === 'BUY PUT' ? '#f44336' : '#ff9800' }} />;
    }
    return <RemoveCircleOutline sx={{ color: '#9e9e9e' }} />;
  };

  const getStrengthColor = (strength: string): string => {
    if (strength === 'STRONG') return '#4caf50';
    if (strength === 'MODERATE') return '#ff9800';
    return '#9e9e9e';
  };

  const formatNumber = (num: number): string => {
    return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  };

  if (loading && !data) {
    return (
      <Paper sx={{ p: 2, bgcolor: '#1e1e1e', borderRadius: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <CircularProgress size={24} />
          <Typography color="text.secondary">Loading Camarilla data...</Typography>
        </Box>
      </Paper>
    );
  }

  if (error) {
    return (
      <Paper sx={{ p: 2, bgcolor: '#1e1e1e', borderRadius: 2 }}>
        <Typography color="error">{error}</Typography>
      </Paper>
    );
  }

  if (!data) return null;

  return (
    <Paper sx={{ bgcolor: '#1e1e1e', borderRadius: 2, overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        p: 2,
        bgcolor: '#2a2a2a',
        borderBottom: '1px solid rgba(255,255,255,0.1)'
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6" fontWeight="bold" color="primary">
            Camarilla Breakout
          </Typography>
          <Chip 
            label={data.symbol}
            size="small"
            sx={{ bgcolor: '#424242', color: 'white' }}
          />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title="Refresh">
            <IconButton onClick={fetchData} size="small" disabled={loading}>
              <Refresh sx={{ fontSize: 20 }} />
            </IconButton>
          </Tooltip>
          <IconButton onClick={() => setExpanded(prev => !prev)} size="small">
            {expanded ? <ExpandLess /> : <ExpandMore />}
          </IconButton>
        </Box>
      </Box>

      {/* Signal Display */}
      <Box sx={{ p: 2 }}>
        <Grid container spacing={2} alignItems="center">
          {/* Spot Price */}
          <Grid item xs={3}>
            <Typography variant="caption" color="text.secondary">Spot Price</Typography>
            <Typography variant="h5" fontWeight="bold" color="#ffc107">
              ₹{formatNumber(data.spotPrice)}
            </Typography>
          </Grid>

          {/* Signal */}
          <Grid item xs={4}>
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 1,
              p: 1.5,
              borderRadius: 2,
              bgcolor: `${getSignalColor(data.signal.signal)}20`,
              border: `1px solid ${getSignalColor(data.signal.signal)}`
            }}>
              {getSignalIcon(data.signal.signal)}
              <Box>
                <Typography variant="h6" fontWeight="bold" sx={{ color: getSignalColor(data.signal.signal) }}>
                  {data.signal.signal}
                </Typography>
                <Chip 
                  label={data.signal.strength}
                  size="small"
                  sx={{ 
                    bgcolor: getStrengthColor(data.signal.strength),
                    color: 'white',
                    fontSize: '0.65rem',
                    height: 20
                  }}
                />
              </Box>
            </Box>
          </Grid>

          {/* Target & Stop Loss */}
          <Grid item xs={5}>
            {data.signal.targetLevel && (
              <Box sx={{ display: 'flex', gap: 3 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Target</Typography>
                  <Typography variant="body1" fontWeight="bold" color="#4caf50">
                    ₹{formatNumber(data.signal.targetLevel)}
                  </Typography>
                </Box>
                {data.signal.stopLossLevel && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">Stop Loss</Typography>
                    <Typography variant="body1" fontWeight="bold" color="#f44336">
                      ₹{formatNumber(data.signal.stopLossLevel)}
                    </Typography>
                  </Box>
                )}
              </Box>
            )}
          </Grid>
        </Grid>

        {/* Reason */}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, fontStyle: 'italic' }}>
          {data.signal.reason}
        </Typography>
      </Box>

      {/* Expanded Levels */}
      <Collapse in={expanded}>
        <Box sx={{ p: 2, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <Typography variant="subtitle2" color="primary" gutterBottom>
            Camarilla Levels
          </Typography>
          
          <Grid container spacing={1}>
            {/* Resistance Levels */}
            <Grid item xs={6}>
              <Box sx={{ bgcolor: 'rgba(76, 175, 80, 0.1)', p: 1, borderRadius: 1 }}>
                <Typography variant="caption" color="#4caf50" fontWeight="bold">Resistance</Typography>
                {[
                  { label: 'H4', value: data.levels.h4, desc: 'Breakout' },
                  { label: 'H3', value: data.levels.h3, desc: 'Strong' },
                  { label: 'H2', value: data.levels.h2, desc: '' },
                  { label: 'H1', value: data.levels.h1, desc: '' },
                ].map(level => (
                  <Box key={level.label} sx={{ 
                    display: 'flex', 
                    justifyContent: 'space-between',
                    py: 0.5,
                    borderBottom: '1px solid rgba(255,255,255,0.05)'
                  }}>
                    <Typography variant="body2" color="text.secondary">
                      {level.label} {level.desc && `(${level.desc})`}
                    </Typography>
                    <Typography variant="body2" fontWeight="bold" color="#4caf50">
                      ₹{formatNumber(level.value)}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Grid>

            {/* Support Levels */}
            <Grid item xs={6}>
              <Box sx={{ bgcolor: 'rgba(244, 67, 54, 0.1)', p: 1, borderRadius: 1 }}>
                <Typography variant="caption" color="#f44336" fontWeight="bold">Support</Typography>
                {[
                  { label: 'L1', value: data.levels.l1, desc: '' },
                  { label: 'L2', value: data.levels.l2, desc: '' },
                  { label: 'L3', value: data.levels.l3, desc: 'Strong' },
                  { label: 'L4', value: data.levels.l4, desc: 'Breakdown' },
                ].map(level => (
                  <Box key={level.label} sx={{ 
                    display: 'flex', 
                    justifyContent: 'space-between',
                    py: 0.5,
                    borderBottom: '1px solid rgba(255,255,255,0.05)'
                  }}>
                    <Typography variant="body2" color="text.secondary">
                      {level.label} {level.desc && `(${level.desc})`}
                    </Typography>
                    <Typography variant="body2" fontWeight="bold" color="#f44336">
                      ₹{formatNumber(level.value)}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Grid>
          </Grid>

          {/* Price Position */}
          <Box sx={{ mt: 2, p: 1, bgcolor: '#2a2a2a', borderRadius: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Current Position: <strong>{data.pricePosition}</strong>
            </Typography>
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
}
