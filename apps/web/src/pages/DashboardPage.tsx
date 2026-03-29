import { useState, useEffect, useCallback } from 'react';
import { Box, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../api/auth';
import DynamicNumbersBar from '../components/DynamicNumbersBar';
import IndexTabs from '../components/IndexTabs';
import OptionChainTable from '../components/OptionChainTable';
import SummaryRow from '../components/SummaryRow';
import SignalIndicator from '../components/SignalIndicator';
import DashboardFooter from '../components/DashboardFooter';
import { useOptionChain } from '../hooks/useOptionChain';
import { useIVDEX } from '../hooks/useIVDEX';
import { useCrossTabSymbol } from '../hooks/useCrossTabSymbol';
import apiClient from '../api/client';

export default function DashboardPage() {
  const { logout, user } = useAuthStore();
  const navigate = useNavigate();

  // State for Row 5 + Row 6
  const [selectedSymbol, setSelectedSymbol] = useState<string>('NIFTY');
  const [selectedExpiryDate, setSelectedExpiryDate] = useState<string>('');
  const [selectedInterval, setSelectedInterval] = useState<string>('5m'); // Default 5m per spec
  const [spotPrice, setSpotPrice] = useState<number>(0);

  // Fetch option chain data for summary calculations with interval support
  const { data: optionChainData } = useOptionChain(selectedSymbol, selectedExpiryDate, selectedInterval);
  
  // Fetch IV/VIX data
  const { data: ivData } = useIVDEX(selectedSymbol);
  const volatility = ivData?.currentIV || 15; // Default 15% if not available

  // Cross-tab sync: update local state when another tab changes the symbol
  const onCrossTabSymbol = useCallback((symbol: string) => {
    console.log('📡 Cross-tab sync received:', symbol);
    setSelectedSymbol(symbol);
    setSelectedExpiryDate('');
  }, []);
  const broadcastSymbol = useCrossTabSymbol(onCrossTabSymbol);

  // Handle symbol change from IndexTabs
  const handleSymbolChange = (symbol: string) => {
    console.log('📌 Symbol changed to:', symbol);
    setSelectedSymbol(symbol);
    // Reset expiry when symbol changes
    setSelectedExpiryDate('');
    // Broadcast to other tabs
    broadcastSymbol(symbol);
  };

  // Handle expiry change from IndexTabs
  const handleExpiryChange = (expiry: string) => {
    console.log('📅 Expiry changed to:', expiry);
    setSelectedExpiryDate(expiry);
  };

  // Fetch spot price and previous session data
  useEffect(() => {
    const fetchMarketData = async () => {
      try {
        // Fetch spot price - gracefully handle errors
        try {
          const spotResponse = await apiClient.get(
            `/market/spot-price?symbol=${selectedSymbol}`
          );
          if (spotResponse.data.spotPrice) {
            setSpotPrice(spotResponse.data.spotPrice);
          }
        } catch (spotError: any) {
          // Don't log 503 errors (rate limit) - expected during high load
          if (spotError.response?.status !== 503) {
            console.error('Failed to fetch spot price:', spotError);
          }
        }

      } catch (error) {
        console.error('Failed to fetch market data:', error);
      }
    };

    if (selectedSymbol) {
      fetchMarketData();
    }
  }, [selectedSymbol]);

  // Note: Polling is now handled by React Query hooks (useOptionChain, useIVDEX, etc.)
  // No need for separate backend polling - this reduces duplicate API calls

  const handleLogout = async () => {
    try {
      await authApi.logout();
      logout();
      navigate('/login');
    } catch (error) {
      console.error('Logout failed:', error);
      // Even if API call fails, clear local state
      logout();
      navigate('/login');
    }
  };

  const handleAdmin = () => {
    navigate('/admin');
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      {/* Row 1: Header - Sticky */}
      <Box sx={{ position: 'sticky', top: 0, zIndex: 1100, bgcolor: 'background.paper' }}>
        <Typography variant="h5" align="center" fontWeight="bold" sx={{ py: 1 }}>
          OPTION BUYERS' DASHBOARD
        </Typography>
      </Box>

      {/* Row 2: Golden Subheader - Sticky */}
      <Box
        sx={{
          position: 'sticky',
          top: 40,
          zIndex: 1099,
          bgcolor: 'background.paper', // Remove yellow
          color: 'inherit',
          py: 0.5,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          px: 2,
        }}
      >
        <Box sx={{ width: '100%', display: 'flex', alignItems: 'center' }}>
          <Typography variant="body2" sx={{ color: '#FFD700', fontSize: '1.5rem', fontWeight: 600, flex: 1, textAlign: 'center' }}>
            PRIMEXA Learning Series WhatsApp 9836001579
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 2, justifyContent: 'flex-end' }}>
            <Button 
              variant="outlined" 
              size="small" 
              onClick={() => window.open('/ranges', '_blank')}
              sx={{ 
                backgroundColor: '#ffe400', 
                color: '#000000',
                borderColor: '#ffe400',
                '&:hover': {
                  backgroundColor: '#ffe400',
                  borderColor: '#ffe400',
                }
              }}
            >
              Market Ranges
            </Button>
            <Button 
              variant="outlined" 
              size="small" 
              onClick={() => window.open('/engine', '_blank')}
              sx={{ 
                backgroundColor: '#ce93d8', 
                color: '#000000',
                borderColor: '#ce93d8',
                '&:hover': {
                  backgroundColor: '#ce93d8',
                  borderColor: '#ce93d8',
                }
              }}
            >
              Engine ⚙️
            </Button>
            <Button 
              variant="outlined" 
              size="small" 
              onClick={() => {
                try {
                  sessionStorage.setItem('fno-scanner-symbol', selectedSymbol);
                } catch { /* ignore */ }
                window.open(`/scanner-exit?symbol=${encodeURIComponent(selectedSymbol)}`, '_blank');
              }}
              sx={{ 
                backgroundColor: '#fff9c4', 
                color: '#000000',
                borderColor: '#fbc02d',
                '&:hover': {
                  backgroundColor: '#fff59d',
                  borderColor: '#f9a825',
                }
              }}
            >
              Scanner & Exit
            </Button>
            {user?.role === 'superadmin' || user?.role === 'admin' ? (
              <button onClick={handleAdmin}>Admin</button>
            ) : null}
            <button>Refresh</button>
            <button onClick={handleLogout}>Logout</button>
          </Box>
        </Box>
      </Box>

      {/* Row 3: Dynamic Numbers Bar - Sticky (Now with Volatility Pressure Bar) */}
      <DynamicNumbersBar 
        symbol={selectedSymbol} 
        expiry={selectedExpiryDate}
        selectedInterval={selectedInterval}
        onIntervalChange={setSelectedInterval}
      />

      {/* Row 4: Index Tabs with Live Prices - Sticky */}
      <IndexTabs 
        onSymbolChange={handleSymbolChange}
        onExpiryChange={handleExpiryChange}
        selectedSymbol={selectedSymbol}
      />

      {/* Row 5-6: Option Chain Table */}
      {selectedExpiryDate ? (
        <Box sx={{ 
          overflow: 'auto', 
          p: 2,
          position: 'relative',
          zIndex: 1,
          mb: 0,
          width: '100%'
        }}>
          <OptionChainTable 
            symbol={selectedSymbol} 
            expiry={selectedExpiryDate}
            interval={selectedInterval}
          />
        </Box>
      ) : (
        <Box sx={{ 
          minHeight: '400px', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          p: 2
        }}>
          <Typography variant="h6" color="text.secondary">
            Select an expiry date from the dropdown above
          </Typography>
        </Box>
      )}

      {/* Summary Row with Totals and Greeks */}
      {selectedExpiryDate && (
        <Box sx={{ 
          px: '12px',
          py: 0,
          position: 'relative',
          zIndex: 2,
        }}>
          <SummaryRow
            optionChainData={optionChainData}
            spotPrice={spotPrice}
            expiryDate={selectedExpiryDate}
            volatility={volatility}
          />
        </Box>
      )}

      {/* Real-Time Signal Indicator */}
      {selectedExpiryDate && (
        <Box sx={{ 
          p: 2, 
          mt: 2,
          position: 'relative',
          zIndex: 2,
          mb: 2
        }}>
          <SignalIndicator 
            symbol={selectedSymbol} 
            expiry={selectedExpiryDate}
          />
        </Box>
      )}

      {/* Row 32: Footer Warning */}
      <DashboardFooter />
    </Box>
  );
}
