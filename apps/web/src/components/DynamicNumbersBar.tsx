import { Box, Select, MenuItem, FormControl, Typography, keyframes, SelectChangeEvent } from '@mui/material';
import { useState, useEffect } from 'react';
import VolatilityPressureBar from './VolatilityPressureBar';
import apiClient from '../api/client';

interface MoodData {
  bull: number;
  bear: number;
  neutral: number;
}

interface OISpurt {
  active: boolean;
  strike: string;
  percent: number;
  timestamp: number;
}

interface DashboardData {
  mood: MoodData;
  oiSpurt: OISpurt;
  nextUpdate: number;
  symbol: string;
  interval: string;
}

// Blinking animation for timer
const blink = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
`;

// Sky blue glow animation for OI spurt
const skyBlueGlow = keyframes`
  0%, 100% { box-shadow: 0 0 0 rgba(135, 206, 235, 0); }
  50% { box-shadow: 0 0 20px rgba(135, 206, 235, 0.8); }
`;

interface DynamicNumbersBarProps {
  symbol?: string;
  expiry?: string;
  selectedInterval?: string;
  onIntervalChange?: (interval: string) => void;
}

export default function DynamicNumbersBar({ 
  symbol = 'NIFTY', 
  expiry,
  selectedInterval = '5m',
  onIntervalChange
}: DynamicNumbersBarProps) {
  const [selectedValue, setSelectedValue] = useState<string>(selectedInterval);
  const [dashboardData, setDashboardData] = useState<DashboardData>({
    mood: { bull: 0, bear: 0, neutral: 0 },
    oiSpurt: { active: false, strike: '', percent: 0, timestamp: 0 },
    nextUpdate: 300,
    symbol: 'NIFTY',
    interval: selectedInterval,
  });
  const [timer, setTimer] = useState<number>(10); // Always start at 10 seconds (frontend fetch interval)
  const [showOIGlow, setShowOIGlow] = useState<boolean>(false);

  // Sync local state with prop
  useEffect(() => {
    setSelectedValue(selectedInterval);
  }, [selectedInterval]);

  // Determine the actual interval to use for API calls
  const interval = selectedValue === 'auto' ? '5m' : selectedValue;

  // Fetch dashboard data
  useEffect(() => {
    // Don't fetch if interval is not set
    if (!interval) return;

    const fetchData = async () => {
      try {
        let url = `/mood/dashboard-data?symbol=${symbol}&interval=${interval}`;
        if (expiry) {
          url += `&expiry=${encodeURIComponent(expiry)}`;
        }
        const response = await apiClient.get(url);
        const data = response.data;
        
        // Safely update dashboard data with defaults
        setDashboardData({
          mood: data.mood || { bull: 0, bear: 0, neutral: 0 },
          oiSpurt: data.oiSpurt || { active: false, strike: '', percent: 0, timestamp: 0 },
          nextUpdate: data.nextUpdate || 300,
          symbol: data.symbol || symbol,
          interval: data.interval || interval,
        });
        // Reset timer to 10 seconds (frontend fetch interval) on each data fetch
        setTimer(10);

        // Show OI glow if spurt detected
        if (data.oiSpurt?.active) {
          setShowOIGlow(true);
          setTimeout(() => setShowOIGlow(false), 3000);
        }
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
        // Don't update state on error - keep existing data
      }
    };

    fetchData();
    const fetchInterval = setInterval(fetchData, 15000); // Refresh every 15 seconds (staggered to prevent 429s)

    return () => clearInterval(fetchInterval);
  }, [interval, symbol, expiry]);

  // Update timer countdown - counts down from 10 to 0, then resets to 10
  useEffect(() => {
    const timerInterval = setInterval(() => {
      setTimer(prev => (prev > 0 ? prev - 1 : 10));
    }, 1000);

    return () => clearInterval(timerInterval);
  }, []); // No dependencies needed - timer is independent

  const handleIntervalChange = (event: SelectChangeEvent<string>) => {
    const value = event.target.value;
    setSelectedValue(value);
    // Notify parent component
    if (onIntervalChange) {
      const actualInterval = value === 'auto' ? '5m' : value;
      onIntervalChange(actualInterval);
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Box
      sx={{
        position: 'sticky',
        top: 72,
        zIndex: 1098,
        bgcolor: 'background.default',
        p: 1.5,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        borderBottom: '1px solid',
        borderColor: 'divider',
        animation: showOIGlow ? `${skyBlueGlow} 3s ease-in-out` : 'none',
      }}
    >
      {/* Time Frequency Dropdown */}
      <FormControl size="small" sx={{ minWidth: 120 }}>
        <Select
          value={selectedValue}
          onChange={handleIntervalChange}
          sx={{ 
            fontSize: '0.875rem',
            bgcolor: 'background.paper',
            '& .MuiSelect-select': {
              color: 'text.primary',
              py: 0.75,
            },
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: 'divider',
            },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: 'primary.main',
            },
          }}
          MenuProps={{
            PaperProps: {
              sx: {
                bgcolor: 'background.paper',
                '& .MuiMenuItem-root': {
                  color: 'text.primary',
                  fontSize: '0.875rem',
                  '&:hover': {
                    bgcolor: 'action.hover',
                  },
                  '&.Mui-selected': {
                    bgcolor: 'action.selected',
                    '&:hover': {
                      bgcolor: 'action.selected',
                    },
                  },
                },
              },
            },
          }}
        >
          <MenuItem value="auto">Auto Mode</MenuItem>
          <MenuItem value="1m">1m</MenuItem>
          <MenuItem value="3m">3m</MenuItem>
          <MenuItem value="5m">5m</MenuItem>
          <MenuItem value="15m">15m</MenuItem>
          <MenuItem value="30m">30m</MenuItem>
          <MenuItem value="60m">60m</MenuItem>
          <MenuItem value="1D">1D</MenuItem>
        </Select>
      </FormControl>

      {/* Volatility Pressure Bar - Replaces Mood Index */}
      <VolatilityPressureBar symbol={symbol} expiry={expiry} />

      {/* Next Update Timer */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          animation: timer < 3 ? `${blink} 0.5s linear infinite` : 'none',
        }}
      >
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Next:
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 'bold', minWidth: 45, textAlign: 'center' }}>
          {formatTime(timer)}
        </Typography>
      </Box>

      {/* OI Spurt Alert - Always visible */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          bgcolor: dashboardData.oiSpurt.active ? 'info.light' : 'background.paper',
          border: dashboardData.oiSpurt.active ? 'none' : '1px solid',
          borderColor: 'divider',
          px: 1.5,
          py: 0.5,
          borderRadius: 1,
        }}
      >
        <Typography variant="caption" sx={{ color: dashboardData.oiSpurt.active ? 'info.dark' : 'text.secondary', fontWeight: 'bold' }}>
          OI Spurt:
        </Typography>
        {dashboardData.oiSpurt.active ? (
          <>
            <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'info.dark' }}>
              {dashboardData.oiSpurt.strike}
            </Typography>
            <Typography variant="caption" sx={{ color: 'success.dark' }}>
              +{dashboardData.oiSpurt.percent}%
            </Typography>
          </>
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            No Spurt
          </Typography>
        )}
      </Box>
    </Box>
  );
}
