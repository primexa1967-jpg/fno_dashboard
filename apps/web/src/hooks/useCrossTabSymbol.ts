import { useEffect, useCallback, useRef } from 'react';

/**
 * Cross-tab symbol synchronization using BroadcastChannel API.
 *
 * When the user changes the selected index (NIFTY, BANKNIFTY, etc.)
 * in one browser tab, it broadcasts the change so all other open tabs
 * (e.g. /dashboard and /scanner-exit) stay in sync.
 *
 * Usage:
 *   const broadcastSymbol = useCrossTabSymbol(setSelectedSymbol);
 *   // call broadcastSymbol('BANKNIFTY') when user clicks a tab
 */

const CHANNEL_NAME = 'fno-dashboard-symbol-sync';

export function useCrossTabSymbol(
  onSymbolChange: (symbol: string) => void
): (symbol: string) => void {
  const channelRef = useRef<BroadcastChannel | null>(null);

  // Open channel once on mount
  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;

    // Listen for symbol changes from OTHER tabs
    channel.onmessage = (event: MessageEvent) => {
      const { symbol } = event.data || {};
      if (symbol && typeof symbol === 'string') {
        console.log(`📡 Cross-tab sync: received symbol change → ${symbol}`);
        onSymbolChange(symbol);
      }
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [onSymbolChange]);

  // Broadcast to other tabs (does NOT trigger own listener)
  const broadcastSymbol = useCallback((symbol: string) => {
    channelRef.current?.postMessage({ symbol });
  }, []);

  return broadcastSymbol;
}
