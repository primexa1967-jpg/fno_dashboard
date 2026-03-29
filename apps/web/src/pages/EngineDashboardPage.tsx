/**
 * Engine Dashboard Page — Unified engine monitoring & simulation
 *
 * Houses: SystemHealthPanel, DecisionPanel, RangeEnginePanel, SimulationPanel
 * Grid layout responsive (§264-277)
 */

import { useState, useCallback } from 'react';
import { Box, Typography, Button, Tabs, Tab } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { ArrowBack } from '@mui/icons-material';
import SystemHealthPanel from '../components/SystemHealthPanel';
import DecisionPanel from '../components/DecisionPanel';
import RangeEnginePanel from '../components/RangeEnginePanel';
import SimulationPanel from '../components/SimulationPanel';
import { useCrossTabSymbol } from '../hooks/useCrossTabSymbol';

const INDICES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCAPNIFTY', 'SENSEX', 'BANKEX'];

export default function EngineDashboardPage() {
  const navigate = useNavigate();
  const [tabIndex, setTabIndex] = useState(0);
  const selectedSymbol = INDICES[tabIndex];

  // Cross-tab sync
  const onCrossTabSymbol = useCallback((symbol: string) => {
    const idx = INDICES.indexOf(symbol);
    if (idx >= 0) setTabIndex(idx);
  }, []);
  const broadcastSymbol = useCrossTabSymbol(onCrossTabSymbol);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#0d0d1a', color: '#e0e0e0' }}>
      {/* Header */}
      <Box sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        px: 3, py: 1.5, bgcolor: '#1a1a2e',
        borderBottom: '2px solid rgba(255,255,255,0.08)',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Button
            startIcon={<ArrowBack />}
            onClick={() => navigate('/dashboard')}
            size="small"
            sx={{ color: '#90caf9', textTransform: 'none' }}
          >
            Dashboard
          </Button>
          <Typography sx={{ fontWeight: 900, fontSize: '1.2rem', letterSpacing: 1, color: '#FFD700' }}>
            ⚙️ ENGINE CONTROL CENTER
          </Typography>
        </Box>
        <Typography sx={{ fontSize: '0.7rem', color: '#546e7a' }}>
          RANGE · HEALTH · DECISION · SIMULATION
        </Typography>
      </Box>

      {/* Index Tabs */}
      <Box sx={{ px: 3, pt: 1 }}>
        <Tabs
          value={tabIndex}
          onChange={(_e, v) => { setTabIndex(v); broadcastSymbol(INDICES[v]); }}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            '& .MuiTab-root': {
              color: '#78909c', fontWeight: 700, fontSize: '0.8rem', minWidth: 100,
              '&.Mui-selected': { color: '#FFD700' },
            },
            '& .MuiTabs-indicator': { backgroundColor: '#FFD700' },
          }}
        >
          {INDICES.map(idx => <Tab key={idx} label={idx} />)}
        </Tabs>
      </Box>

      {/* Grid Layout */}
      <Box sx={{ p: 2, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
        {/* Left Column */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <SystemHealthPanel />
          <DecisionPanel symbol={selectedSymbol} />
        </Box>

        {/* Right Column */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <RangeEnginePanel />
          <SimulationPanel />
        </Box>
      </Box>
    </Box>
  );
}
