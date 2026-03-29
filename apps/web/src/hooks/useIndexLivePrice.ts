import { useQuery } from '@tanstack/react-query';
import { IndexQuote } from '../types/market.types';
import { useState, useEffect } from 'react';
import apiClient from '../api/client';

const API_BASE_URL = apiClient.defaults.baseURL || '';

/**
 * Fetch quote for a specific index symbol
 */
async function fetchIndexQuote(symbol: string): Promise<IndexQuote> {
  const token = localStorage.getItem('token');
  if (!token) {
    throw new Error('Authentication required');
  }

  const response = await fetch(`${API_BASE_URL}/market/quotes/${symbol}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch quote for ${symbol}`);
  }

  return response.json();
}

/**
 * Custom hook to fetch and manage live price data for an index
 * Uses polling for real-time updates (every 5 seconds)
 */
export function useIndexLivePrice(symbol: string, enabled: boolean = true) {
  return useQuery<IndexQuote>({
    queryKey: ['indexQuote', symbol],
    queryFn: () => fetchIndexQuote(symbol),
    enabled: enabled && symbol !== 'FNO', // Don't fetch for placeholder tabs
    refetchInterval: 15000, // Refetch every 15 seconds (staggered to prevent 429s)
    staleTime: 12000, // Consider data stale after 12 seconds
    retry: 2,
    retryDelay: 1000,
  });
}

/**
 * Custom hook with WebSocket support for real-time price updates
 * Falls back to polling if WebSocket is unavailable
 */
export function useIndexLivePriceWebSocket(symbol: string, enabled: boolean = true) {
  const [wsPrice] = useState<IndexQuote | null>(null);
  const [wsConnected] = useState(false);

  // Polling fallback
  const pollingQuery = useQuery<IndexQuote>({
    queryKey: ['indexQuote', symbol],
    queryFn: () => fetchIndexQuote(symbol),
    enabled: enabled && !wsConnected && symbol !== 'FNO',
    refetchInterval: 5000,
    staleTime: 4000,
    retry: 2,
  });

  // WebSocket connection (to be implemented)
  useEffect(() => {
    if (!enabled || symbol === 'FNO') {
      return;
    }

    // TODO: Implement WebSocket connection
    // For now, use polling fallback
    console.log(`WebSocket for ${symbol} - coming soon, using polling`);

    return () => {
      // Cleanup WebSocket connection
    };
  }, [symbol, enabled]);

  // Return WebSocket data if available, otherwise polling data
  return {
    data: wsPrice || pollingQuery.data,
    isLoading: pollingQuery.isLoading,
    error: pollingQuery.error,
    isConnected: wsConnected,
  };
}
