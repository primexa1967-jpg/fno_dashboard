import { Box, Typography, Tooltip, keyframes } from '@mui/material';
import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, RemoveCircleOutline } from '@mui/icons-material';
import apiClient from '../api/client';

interface VolatilityPressureData {
  ceScore: number;
  peScore: number;
  netScore: number;
  pressurePercent: number;
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  breakdown?: {
    ce: StrikeScore[];
    pe: StrikeScore[];
  };
  timestamp: number;
}

interface StrikeScore {
  strike: number;
  vwapScore: number;
  builtUpScore: number;
  premiumScore: number;
  volumeScore: number;
  totalScore: number;
}

interface VolatilityPressureBarProps {
  symbol: string;
  expiry?: string;
}

// Pulse animation for active signal
const pulse = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
`;

export default function VolatilityPressureBar({ symbol, expiry }: VolatilityPressureBarProps) {
  const [pressureData, setPressureData] = useState<VolatilityPressureData>({
    ceScore: 0,
    peScore: 0,
    netScore: 0,
    pressurePercent: 0,
    signal: 'NEUTRAL',
    timestamp: Date.now(),
  });
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const fetchPressureData = async () => {
      try {
        let url = `/volatility/pressure?symbol=${symbol}`;
        if (expiry) {
          url += `&expiry=${encodeURIComponent(expiry)}`;
        }
        
        const { data: result } = await apiClient.get(url);
        if (result.success && result.data) {
          setPressureData(result.data);
        }
      } catch (error) {
        console.error('Error fetching volatility pressure:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPressureData();
    const interval = setInterval(fetchPressureData, 20000); // Refresh every 20 seconds (staggered to prevent 429s)

    return () => clearInterval(interval);
  }, [symbol, expiry]);

  // Calculate bar segments
  // pressurePercent: -100 to +100
  // Convert to bar positions: center is 0%, left is bearish (red), right is bullish (green)
  const barWidth = Math.abs(pressureData.pressurePercent) / 2; // Max 50% each side
  const isBullish = pressureData.pressurePercent > 0;
  const isBearish = pressureData.pressurePercent < 0;

  const getSignalColor = () => {
    if (pressureData.signal === 'BULLISH') return '#4caf50';
    if (pressureData.signal === 'BEARISH') return '#f44336';
    return '#9e9e9e';
  };

  const getSignalIcon = () => {
    if (pressureData.signal === 'BULLISH') {
      return <TrendingUp sx={{ color: '#4caf50', fontSize: 20 }} />;
    }
    if (pressureData.signal === 'BEARISH') {
      return <TrendingDown sx={{ color: '#f44336', fontSize: 20 }} />;
    }
    return <RemoveCircleOutline sx={{ color: '#9e9e9e', fontSize: 20 }} />;
  };

  const tooltipContent = (
    <Box sx={{ p: 1 }}>
      <Typography variant="caption" sx={{ fontWeight: 'bold', display: 'block', mb: 1 }}>
        Volatility Pressure Analysis
      </Typography>
      <Typography variant="caption" sx={{ display: 'block' }}>
        CE Score: {pressureData.ceScore.toFixed(1)}
      </Typography>
      <Typography variant="caption" sx={{ display: 'block' }}>
        PE Score: {pressureData.peScore.toFixed(1)}
      </Typography>
      <Typography variant="caption" sx={{ display: 'block' }}>
        Net Score: {pressureData.netScore.toFixed(1)}
      </Typography>
      <Typography variant="caption" sx={{ display: 'block', mt: 1, color: getSignalColor() }}>
        Signal: {pressureData.signal}
      </Typography>
    </Box>
  );

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Loading Volatility Pressure...
        </Typography>
      </Box>
    );
  }

  return (
    <Tooltip title={tooltipContent} arrow placement="bottom">
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {/* Header - Centered above bar */}
        <Typography 
          variant="caption" 
          sx={{ 
            color: 'text.secondary', 
            fontWeight: 600, 
            textAlign: 'center',
            fontSize: '1rem',
          }}
        >
          Volatility Pressure Analysis
        </Typography>
        
        {/* Bar Row */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {/* PE Side Label */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 60 }}>
            <TrendingDown sx={{ color: '#f44336', fontSize: 18 }} />
            <Typography variant="caption" sx={{ color: '#f44336', fontWeight: 600 }}>
              PE
            </Typography>
          </Box>

        {/* Pressure Bar Container */}
        <Box
          sx={{
            flex: 1,
            height: 28,
            bgcolor: '#2a2a2a',
            borderRadius: 2,
            position: 'relative',
            overflow: 'hidden',
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          {/* Center Line */}
          <Box
            sx={{
              position: 'absolute',
              left: '50%',
              top: 0,
              bottom: 0,
              width: 2,
              bgcolor: '#ffffff',
              zIndex: 2,
            }}
          />

          {/* Bearish Bar (Left from center) */}
          {isBearish && (
            <Box
              sx={{
                position: 'absolute',
                right: '50%',
                top: 2,
                bottom: 2,
                width: `${barWidth}%`,
                bgcolor: '#f44336',
                borderRadius: '4px 0 0 4px',
                transition: 'width 0.5s ease-in-out',
                animation: pressureData.signal === 'BEARISH' ? `${pulse} 2s ease-in-out infinite` : 'none',
              }}
            />
          )}

          {/* Bullish Bar (Right from center) */}
          {isBullish && (
            <Box
              sx={{
                position: 'absolute',
                left: '50%',
                top: 2,
                bottom: 2,
                width: `${barWidth}%`,
                bgcolor: '#4caf50',
                borderRadius: '0 4px 4px 0',
                transition: 'width 0.5s ease-in-out',
                animation: pressureData.signal === 'BULLISH' ? `${pulse} 2s ease-in-out infinite` : 'none',
              }}
            />
          )}

          {/* Pressure Percent Label */}
          <Box
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 3,
              bgcolor: 'rgba(0, 0, 0, 0.7)',
              px: 1,
              py: 0.25,
              borderRadius: 1,
            }}
          >
            <Typography
              variant="caption"
              sx={{
                color: getSignalColor(),
                fontWeight: 700,
                fontSize: '0.75rem',
              }}
            >
              {pressureData.pressurePercent > 0 ? '+' : ''}{pressureData.pressurePercent.toFixed(1)}%
            </Typography>
          </Box>
        </Box>

        {/* CE Side Label */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 60 }}>
          <Typography variant="caption" sx={{ color: '#4caf50', fontWeight: 600 }}>
            CE
          </Typography>
          <TrendingUp sx={{ color: '#4caf50', fontSize: 18 }} />
        </Box>

        {/* Signal Badge */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: getSignalColor(),
            px: 1,
            py: 0.25,
            borderRadius: 1,
            minWidth: 90,
            justifyContent: 'center',
          }}
        >
          {getSignalIcon()}
          <Typography
            variant="caption"
            sx={{
              color: getSignalColor(),
              fontWeight: 700,
              fontSize: '0.7rem',
            }}
          >
            {pressureData.signal}
          </Typography>
        </Box>
        </Box>{/* End Bar Row */}
      </Box>{/* End Column Container */}
    </Tooltip>
  );
}
