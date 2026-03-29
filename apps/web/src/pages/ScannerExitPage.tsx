import { useState, useCallback, useEffect } from 'react';
import { Box, Typography, Tabs, Tab, Button } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowBack } from '@mui/icons-material';
import ScannerCard from '../components/ScannerCard';
import ExitEngineCard from '../components/ExitEngineCard';
import SignalIndicator from '../components/SignalIndicator';
import { useCrossTabSymbol } from '../hooks/useCrossTabSymbol';

const INDICES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCAPNIFTY', 'SENSEX', 'BANKEX'] as const;
const INDEX_SET = new Set<string>(INDICES as unknown as string[]);

function normalizeSymbol(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const u = raw.trim().toUpperCase();
  return INDEX_SET.has(u) ? u : null;
}

export default function ScannerExitPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tabIndex, setTabIndex] = useState(0);

  const selectedSymbol = INDICES[tabIndex];

  // URL is source of truth; if missing, restore from sessionStorage once via replaceState
  useEffect(() => {
    const fromUrl = normalizeSymbol(searchParams.get('symbol'));
    if (fromUrl) {
      const idx = INDICES.indexOf(fromUrl as (typeof INDICES)[number]);
      if (idx >= 0) setTabIndex(idx);
      return;
    }
    try {
      const stored = normalizeSymbol(sessionStorage.getItem('fno-scanner-symbol'));
      if (stored) {
        const idx = INDICES.indexOf(stored as (typeof INDICES)[number]);
        if (idx >= 0) {
          setTabIndex(idx);
          setSearchParams({ symbol: stored }, { replace: true });
        }
      }
    } catch {
      /* ignore */
    }
  }, [searchParams, setSearchParams]);

  const onCrossTabSymbol = useCallback((symbol: string) => {
    const norm = normalizeSymbol(symbol);
    if (!norm) return;
    const idx = INDICES.indexOf(norm as (typeof INDICES)[number]);
    if (idx >= 0) {
      setTabIndex(idx);
      setSearchParams({ symbol: norm }, { replace: true });
      try {
        sessionStorage.setItem('fno-scanner-symbol', norm);
      } catch {
        /* ignore */
      }
    }
  }, [setSearchParams]);

  const broadcastSymbol = useCrossTabSymbol(onCrossTabSymbol);

  const handleTabChange = (_e: React.SyntheticEvent, v: number) => {
    const sym = INDICES[v];
    setTabIndex(v);
    setSearchParams({ symbol: sym }, { replace: true });
    try {
      sessionStorage.setItem('fno-scanner-symbol', sym);
    } catch {
      /* ignore */
    }
    broadcastSymbol(sym);
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#0d0d1a', color: '#e0e0e0' }}>
      {/* ── Header ── */}
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
            SCANNER & EXIT
          </Typography>
        </Box>
        <Typography sx={{ fontSize: '0.7rem', color: '#546e7a' }}>
          INTRADAY OPTIONS TRADE DISCOVERY + EXIT MANAGEMENT
        </Typography>
      </Box>

      {/* ── Index Tabs ── */}
      <Box sx={{ px: 3, pt: 1 }}>
        <Tabs
          value={tabIndex}
          onChange={handleTabChange}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            '& .MuiTab-root': {
              color: '#78909c',
              fontWeight: 700,
              fontSize: '0.8rem',
              minWidth: 100,
              '&.Mui-selected': { color: '#FFD700' },
            },
            '& .MuiTabs-indicator': { backgroundColor: '#FFD700' },
          }}
        >
          {INDICES.map((idx) => (
            <Tab key={idx} label={idx} />
          ))}
        </Tabs>
      </Box>

      {/* Confidence engine: OI + gamma → structure; flow → confirmation; price/VWAP → timing (same symbol as tabs) */}
      <Box sx={{ px: 3, pt: 2, maxWidth: 1200 }}>
        <SignalIndicator key={selectedSymbol} symbol={selectedSymbol} />
      </Box>

      {/* ── Scanner + Exit side by side (key forces refetch per symbol) ── */}
      <Box sx={{
        p: 3,
        display: 'flex',
        gap: 2,
        flexDirection: { xs: 'column', lg: 'row' },
        alignItems: 'flex-start',
      }}>
        <Box sx={{ flex: 1, width: '100%' }}>
          <ScannerCard key={selectedSymbol} symbol={selectedSymbol} />
        </Box>
        <Box sx={{ flex: 1, width: '100%' }}>
          <ExitEngineCard key={selectedSymbol} symbol={selectedSymbol} />
        </Box>
      </Box>
    </Box>
  );
}
