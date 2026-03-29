/**
 * Simulation Panel — Paper trading with user-defined secure PIN (server stores hash).
 * Features: capital summary, active simulated positions, rejection log, performance.
 * Lock/unlock toggle, mode switch
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Paper, Chip, Button, TextField, Dialog, DialogTitle,
  DialogContent, DialogActions, Table, TableBody, TableCell, TableHead,
  TableRow, Tabs, Tab, IconButton, Tooltip, Grid,
} from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import RefreshIcon from '@mui/icons-material/Refresh';
import apiClient from '../api/client';

// ─── Types ───────────────────────────────────────────────

interface SimAccount {
  initialCapital: number;
  currentCapital: number;
  lockedCapital: number;
  availableCapital: number;
  totalPnl: number;
  dayPnl: number;
  isLocked: boolean;
  mode: string;
}

interface SimTrade {
  id: string;
  instrument: string;
  direction: string;
  qty: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  target: number;
  pnl: number;
  pnlPercent: number;
  status: string;
  entryTime: string;
  exitTime?: string;
  exitReason?: string;
}

interface Rejection {
  timestamp: string;
  instrument: string;
  stage: string;
  reason: string;
}

interface PerfMetrics {
  totalTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  avgHoldTime: string;
  bestTrade: number;
  worstTrade: number;
  streakWin: number;
  streakLoss: number;
}

const PNL_GREEN = '#4caf50';
const PNL_RED = '#f44336';

// ─── Component ───────────────────────────────────────────

const SimulationPanel: React.FC = () => {
  const [unlocked, setUnlocked] = useState(false);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');

  const [tab, setTab] = useState(0);
  const [account, setAccount] = useState<SimAccount | null>(null);
  const [openTrades, setOpenTrades] = useState<SimTrade[]>([]);
  const [history, setHistory] = useState<SimTrade[]>([]);
  const [rejections, setRejections] = useState<Rejection[]>([]);
  const [performance, setPerformance] = useState<PerfMetrics | null>(null);

  // ─── Fetch Helpers ──────────────────────────────

  const fetchAccount = useCallback(async () => {
    try {
      const r = await apiClient.get('/engine/simulation/account');
      if (r.data?.success) setAccount(r.data.data);
    } catch { /* noop */ }
  }, []);

  const fetchOpen = useCallback(async () => {
    try {
      const r = await apiClient.get('/engine/simulation/trades/open');
      if (r.data?.success) setOpenTrades(r.data.data);
    } catch { /* noop */ }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const r = await apiClient.get('/engine/simulation/trades/history');
      if (r.data?.success) setHistory(r.data.data);
    } catch { /* noop */ }
  }, []);

  const fetchRejections = useCallback(async () => {
    try {
      const r = await apiClient.get('/engine/simulation/rejections');
      if (r.data?.success) setRejections(r.data.data);
    } catch { /* noop */ }
  }, []);

  const fetchPerformance = useCallback(async () => {
    try {
      const r = await apiClient.get('/engine/simulation/performance');
      if (r.data?.success) setPerformance(r.data.data);
    } catch { /* noop */ }
  }, []);

  // Auto-refresh every 5s when unlocked
  useEffect(() => {
    if (!unlocked) return;
    const refresh = () => {
      fetchAccount();
      if (tab === 0) fetchOpen();
      if (tab === 1) fetchHistory();
      if (tab === 2) fetchRejections();
      if (tab === 3) fetchPerformance();
    };
    refresh();
    const iv = setInterval(refresh, 5000);
    return () => clearInterval(iv);
  }, [unlocked, tab, fetchAccount, fetchOpen, fetchHistory, fetchRejections, fetchPerformance]);

  // ─── PIN Auth ──────────────────────────────────

  const verifyPin = async () => {
    setPinError('');
    try {
      const r = await apiClient.post('/engine/simulation/verify-pin', { pin: pinInput });
      if (r.data?.success) {
        setUnlocked(true);
        setPinDialogOpen(false);
        setPinInput('');
      } else {
        setPinError('Invalid PIN');
      }
    } catch {
      setPinError('Verification failed');
    }
  };

  const lockPanel = async () => {
    try {
      await apiClient.post('/engine/simulation/lock');
    } catch { /* noop */ }
    setUnlocked(false);
  };

  // ─── Helpers ───────────────────────────────────

  const pnlColor = (v: number) => (v >= 0 ? PNL_GREEN : PNL_RED);
  const fmtK = (v: number) => `₹${(v / 1000).toFixed(1)}K`;
  const fmtPnl = (v: number) => `${v >= 0 ? '+' : ''}₹${v.toFixed(0)}`;

  // ─── PIN Dialog ────────────────────────────────

  const PinDialog = (
    <Dialog open={pinDialogOpen} onClose={() => setPinDialogOpen(false)} PaperProps={{ sx: { bgcolor: '#1a1a2e', color: '#fff', minWidth: 300 } }}>
      <DialogTitle sx={{ color: '#ffd700', fontWeight: 700 }}>🔒 Secure PIN</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: '#ccc', mb: 2 }}>Enter your user-defined PIN (verified server-side as a secure hash)</Typography>
        <TextField
          value={pinInput}
          onChange={(e) => setPinInput(e.target.value)}
          type="password"
          inputProps={{ maxLength: 6, style: { letterSpacing: 6, textAlign: 'center', color: '#fff', fontSize: '1.2rem' } }}
          fullWidth
          variant="outlined"
          placeholder="● ● ● ● ● ●"
          error={!!pinError}
          helperText={pinError}
          sx={{ '& .MuiOutlinedInput-root': { '& fieldset': { borderColor: '#555' } } }}
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && verifyPin()}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setPinDialogOpen(false)} sx={{ color: '#999' }}>Cancel</Button>
        <Button onClick={verifyPin} variant="contained" sx={{ bgcolor: '#ffd700', color: '#000', fontWeight: 700 }}>Unlock</Button>
      </DialogActions>
    </Dialog>
  );

  // ─── Locked View ───────────────────────────────

  if (!unlocked) {
    return (
      <Paper sx={{ p: 2, bgcolor: '#1a1a2e', borderRadius: 2, border: '1px solid #333', textAlign: 'center' }}>
        {PinDialog}
        <LockIcon sx={{ fontSize: 48, color: '#555', mb: 1 }} />
        <Typography variant="subtitle2" sx={{ color: '#888', mb: 1 }}>Simulation Locked</Typography>
        <Button
          variant="outlined"
          size="small"
          onClick={() => setPinDialogOpen(true)}
          sx={{ color: '#ffd700', borderColor: '#ffd700', fontSize: '0.7rem' }}
        >
          Enter PIN to Unlock
        </Button>
      </Paper>
    );
  }

  // ─── Unlocked View ─────────────────────────────

  return (
    <Paper sx={{ p: 1.5, bgcolor: '#1a1a2e', borderRadius: 2, border: '1px solid #333' }}>
      {PinDialog}

      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2" sx={{ color: '#ffd700', fontWeight: 700, fontSize: '0.85rem' }}>
          📊 SIMULATION
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          {account && (
            <Chip
              label={account.mode}
              size="small"
              sx={{ bgcolor: account.mode === 'LIVE' ? '#4caf50' : '#ff9800', color: '#fff', fontWeight: 700, fontSize: '0.6rem', height: 18 }}
            />
          )}
          <Tooltip title="Refresh">
            <IconButton size="small" sx={{ color: '#888' }} onClick={() => { fetchAccount(); fetchOpen(); }}>
              <RefreshIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Lock Panel">
            <IconButton size="small" sx={{ color: '#ffd700' }} onClick={lockPanel}>
              <LockOpenIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Capital Summary (§227-231) */}
      {account && (
        <Box sx={{ display: 'flex', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
          {[
            { label: 'Capital', value: fmtK(account.currentCapital), color: '#fff' },
            { label: 'Available', value: fmtK(account.availableCapital), color: '#90caf9' },
            { label: 'Locked', value: fmtK(account.lockedCapital), color: '#ff9800' },
            { label: 'Day P&L', value: fmtPnl(account.dayPnl), color: pnlColor(account.dayPnl) },
            { label: 'Total P&L', value: fmtPnl(account.totalPnl), color: pnlColor(account.totalPnl) },
          ].map((item) => (
            <Box key={item.label} sx={{ textAlign: 'center' }}>
              <Typography variant="caption" sx={{ color: '#888', fontSize: '0.55rem', display: 'block' }}>{item.label}</Typography>
              <Typography variant="body2" sx={{ color: item.color, fontWeight: 700, fontSize: '0.75rem' }}>{item.value}</Typography>
            </Box>
          ))}
        </Box>
      )}

      {/* Tabs */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ minHeight: 28, mb: 1, '& .MuiTab-root': { minHeight: 28, py: 0, fontSize: '0.65rem', color: '#999' }, '& .Mui-selected': { color: '#ffd700 !important' } }}>
        <Tab label="Active outputs" />
        <Tab label="History" />
        <Tab label="Rejections" />
        <Tab label="Performance" />
      </Tabs>

      {/* Tab Content */}
      <Box sx={{ maxHeight: 280, overflow: 'auto' }}>
        {tab === 0 && (
          openTrades.length === 0 ? (
            <Typography variant="caption" sx={{ color: '#666' }}>No active simulated positions</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  {['Instrument', 'Dir', 'Qty', 'Entry', 'LTP', 'P&L', 'SL', 'TGT'].map(h => (
                    <TableCell key={h} sx={{ color: '#888', fontSize: '0.55rem', py: 0.3, px: 0.5, borderColor: '#333' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {openTrades.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell sx={{ color: '#fff', fontSize: '0.6rem', py: 0.3, px: 0.5, borderColor: '#333' }}>{t.instrument}</TableCell>
                    <TableCell sx={{ color: t.direction === 'CE' ? PNL_GREEN : PNL_RED, fontSize: '0.6rem', py: 0.3, px: 0.5, borderColor: '#333', fontWeight: 700 }}>{t.direction}</TableCell>
                    <TableCell sx={{ color: '#fff', fontSize: '0.6rem', py: 0.3, px: 0.5, borderColor: '#333' }}>{t.qty}</TableCell>
                    <TableCell sx={{ color: '#fff', fontSize: '0.6rem', py: 0.3, px: 0.5, borderColor: '#333' }}>{t.entryPrice.toFixed(1)}</TableCell>
                    <TableCell sx={{ color: '#fff', fontSize: '0.6rem', py: 0.3, px: 0.5, borderColor: '#333' }}>{t.currentPrice.toFixed(1)}</TableCell>
                    <TableCell sx={{ color: pnlColor(t.pnl), fontSize: '0.6rem', py: 0.3, px: 0.5, borderColor: '#333', fontWeight: 700 }}>{fmtPnl(t.pnl)}</TableCell>
                    <TableCell sx={{ color: '#f44336', fontSize: '0.6rem', py: 0.3, px: 0.5, borderColor: '#333' }}>{t.stopLoss.toFixed(1)}</TableCell>
                    <TableCell sx={{ color: PNL_GREEN, fontSize: '0.6rem', py: 0.3, px: 0.5, borderColor: '#333' }}>{t.target.toFixed(1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        )}

        {tab === 1 && (
          history.length === 0 ? (
            <Typography variant="caption" sx={{ color: '#666' }}>No trade history</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  {['Instrument', 'Dir', 'P&L', 'Exit Reason', 'Time'].map(h => (
                    <TableCell key={h} sx={{ color: '#888', fontSize: '0.55rem', py: 0.3, px: 0.5, borderColor: '#333' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {history.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell sx={{ color: '#fff', fontSize: '0.6rem', py: 0.3, px: 0.5, borderColor: '#333' }}>{t.instrument}</TableCell>
                    <TableCell sx={{ color: t.direction === 'CE' ? PNL_GREEN : PNL_RED, fontSize: '0.6rem', py: 0.3, px: 0.5, borderColor: '#333', fontWeight: 700 }}>{t.direction}</TableCell>
                    <TableCell sx={{ color: pnlColor(t.pnl), fontSize: '0.6rem', py: 0.3, px: 0.5, borderColor: '#333', fontWeight: 700 }}>{fmtPnl(t.pnl)}</TableCell>
                    <TableCell sx={{ color: '#ccc', fontSize: '0.6rem', py: 0.3, px: 0.5, borderColor: '#333' }}>{t.exitReason ?? '—'}</TableCell>
                    <TableCell sx={{ color: '#999', fontSize: '0.55rem', py: 0.3, px: 0.5, borderColor: '#333' }}>{t.exitTime ? new Date(t.exitTime).toLocaleTimeString() : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        )}

        {tab === 2 && (
          rejections.length === 0 ? (
            <Typography variant="caption" sx={{ color: '#666' }}>No rejections</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  {['Time', 'Instrument', 'Stage', 'Reason'].map(h => (
                    <TableCell key={h} sx={{ color: '#888', fontSize: '0.55rem', py: 0.3, px: 0.5, borderColor: '#333' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rejections.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell sx={{ color: '#999', fontSize: '0.55rem', py: 0.3, px: 0.5, borderColor: '#333' }}>{new Date(r.timestamp).toLocaleTimeString()}</TableCell>
                    <TableCell sx={{ color: '#fff', fontSize: '0.6rem', py: 0.3, px: 0.5, borderColor: '#333' }}>{r.instrument}</TableCell>
                    <TableCell sx={{ color: '#ff9800', fontSize: '0.6rem', py: 0.3, px: 0.5, borderColor: '#333' }}>{r.stage}</TableCell>
                    <TableCell sx={{ color: '#ccc', fontSize: '0.6rem', py: 0.3, px: 0.5, borderColor: '#333' }}>{r.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        )}

        {tab === 3 && performance && (
          <Grid container spacing={0.5}>
            {[
              { label: 'Total Trades', value: performance.totalTrades, color: '#fff' },
              { label: 'Win Rate', value: `${(performance.winRate * 100).toFixed(1)}%`, color: performance.winRate >= 0.5 ? PNL_GREEN : PNL_RED },
              { label: 'Avg Win', value: fmtPnl(performance.avgWin), color: PNL_GREEN },
              { label: 'Avg Loss', value: fmtPnl(performance.avgLoss), color: PNL_RED },
              { label: 'Profit Factor', value: performance.profitFactor.toFixed(2), color: performance.profitFactor >= 1 ? PNL_GREEN : PNL_RED },
              { label: 'Max Drawdown', value: `${(performance.maxDrawdown * 100).toFixed(1)}%`, color: PNL_RED },
              { label: 'Sharpe Ratio', value: performance.sharpeRatio.toFixed(2), color: '#90caf9' },
              { label: 'Avg Hold', value: performance.avgHoldTime, color: '#fff' },
              { label: 'Best Trade', value: fmtPnl(performance.bestTrade), color: PNL_GREEN },
              { label: 'Worst Trade', value: fmtPnl(performance.worstTrade), color: PNL_RED },
              { label: 'Win Streak', value: performance.streakWin, color: PNL_GREEN },
              { label: 'Loss Streak', value: performance.streakLoss, color: PNL_RED },
            ].map((item) => (
              <Grid item xs={4} key={item.label}>
                <Box sx={{ textAlign: 'center', p: 0.5, bgcolor: '#0d0d1a', borderRadius: 1 }}>
                  <Typography variant="caption" sx={{ color: '#888', fontSize: '0.5rem', display: 'block' }}>{item.label}</Typography>
                  <Typography variant="body2" sx={{ color: item.color, fontWeight: 700, fontSize: '0.7rem' }}>{item.value}</Typography>
                </Box>
              </Grid>
            ))}
          </Grid>
        )}
      </Box>
    </Paper>
  );
};

export default SimulationPanel;
