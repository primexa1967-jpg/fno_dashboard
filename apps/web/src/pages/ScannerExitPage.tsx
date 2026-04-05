import { useState, useCallback, useEffect } from 'react';
import { Box, Typography, Tabs, Tab, Button, Paper, Divider } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowBack } from '@mui/icons-material';
import ScannerCard, { type ScanResult } from '../components/ScannerCard';
import ExitEngineCard from '../components/ExitEngineCard';
import SignalIndicator from '../components/SignalIndicator';
import { useCrossTabSymbol } from '../hooks/useCrossTabSymbol';
import { useIndexExpiries } from '../hooks/useIndexExpiries';

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
  const [scanSnap, setScanSnap] = useState<ScanResult | null>(null);

  const selectedSymbol = INDICES[tabIndex];
  const { data: expData, isLoading: expiriesLoading } = useIndexExpiries(selectedSymbol, true);
  const autoExpiry = expData?.expiries?.[0]?.date ?? '';

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

      {/* Range → Confidence → Bias: uses first listed expiry for chain-backed metrics */}
      <Box sx={{ px: 3, pt: 2, maxWidth: 1200 }}>
        {expiriesLoading && !autoExpiry && (
          <Typography sx={{ fontSize: '0.75rem', color: '#78909c', mb: 1 }}>Loading expiries…</Typography>
        )}
        {!expiriesLoading && !autoExpiry && (
          <Typography sx={{ fontSize: '0.75rem', color: '#ff9800', mb: 1 }}>
            No expiry calendar for {selectedSymbol}; confidence engine needs an expiry when data is available.
          </Typography>
        )}
        <SignalIndicator key={`${selectedSymbol}-${autoExpiry}`} symbol={selectedSymbol} expiry={autoExpiry} />
      </Box>

      {scanSnap && (
        <Box sx={{ px: 3, maxWidth: 1200 }}>
          <Paper sx={{ p: 1.5, mb: 2, bgcolor: '#151525', border: '1px solid rgba(255,193,7,0.2)' }}>
            <Typography sx={{ fontSize: '0.65rem', color: '#ffc107', fontWeight: 800, letterSpacing: 1, mb: 0.8 }}>
              SCANNER OUTPUT (LIMITED)
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: '#e0e0e0', mb: 0.8 }}>
              Setup strength (pipeline):{' '}
              <strong style={{ color: scanSnap.confidence === 'HIGH' ? '#4caf50' : scanSnap.confidence === 'MEDIUM' ? '#ff9800' : '#9e9e9e' }}>
                {scanSnap.confidence}
              </strong>
              {' · '}
              Signal: {scanSnap.signal}
            </Typography>
            <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)', my: 1 }} />
            <Typography sx={{ fontSize: '0.65rem', color: '#90caf9', fontWeight: 700, mb: 0.5 }}>Top setups (max 3)</Typography>
            <Box component="ul" sx={{ m: 0, pl: 2, color: '#b0bec5', fontSize: '0.68rem', lineHeight: 1.6 }}>
              {scanSnap.topCalls[0] && (
                <li>
                  ATM / CE: strike {scanSnap.topCalls[0].strike} — {scanSnap.reason || 'Pipeline + OI context'}
                </li>
              )}
              {scanSnap.topPuts[0] && (
                <li>
                  ATM / PE: strike {scanSnap.topPuts[0].strike} — momentum / structure alignment
                </li>
              )}
              {scanSnap.topCalls[1] && (
                <li>Near OTM CE: strike {scanSnap.topCalls[1].strike} — secondary candidate</li>
              )}
              {!scanSnap.topCalls[0] && !scanSnap.topPuts[0] && (
                <li>No ranked strikes in this scan window — see full scanner below.</li>
              )}
            </Box>
            <Typography sx={{ fontSize: '0.58rem', color: '#546e7a', mt: 1, fontStyle: 'italic' }}>
              Scanner surfaces opportunity context only — not entry/exit instructions.
            </Typography>
          </Paper>
        </Box>
      )}

      {/* ── Scanner + Exit side by side (key forces refetch per symbol) ── */}
      <Box sx={{
        p: 3,
        display: 'flex',
        gap: 2,
        flexDirection: { xs: 'column', lg: 'row' },
        alignItems: 'flex-start',
      }}>
        <Box sx={{ flex: 1, width: '100%' }}>
          <ScannerCard key={selectedSymbol} symbol={selectedSymbol} onScanLoaded={setScanSnap} />
        </Box>
        <Box sx={{ flex: 1, width: '100%' }}>
          <ExitEngineCard key={selectedSymbol} symbol={selectedSymbol} />
        </Box>
      </Box>
    </Box>
  );
}
