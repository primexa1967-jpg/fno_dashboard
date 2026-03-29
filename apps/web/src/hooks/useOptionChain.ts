import { useQuery } from '@tanstack/react-query';
import { OptionChainData } from '../types/optionChain.types';
import apiClient from '../api/client';

const API_BASE_URL = apiClient.defaults.baseURL || '';

/**
 * Fetch option chain data for a specific symbol and expiry
 * Supports interval parameter for interval-based calculations
 */
async function fetchOptionChain(
  symbol: string,
  expiry: string,
  interval: string = '1D'
): Promise<OptionChainData> {
  const token = localStorage.getItem('token');
  if (!token) {
    throw new Error('Authentication required');
  }

  const url = new URL(`${API_BASE_URL}/market/option-chain/${symbol}/${expiry}`);
  if (interval && interval !== '1D') {
    url.searchParams.set('interval', interval);
  }

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch option chain for ${symbol} ${expiry}`);
  }

  return response.json();
}

/**
 * Hook to fetch option chain with color coding and built-up classification
 * Refreshes every 10 seconds
 * Supports interval-based calculations for Volume, OI Chg, and OI Chg%
 */
export function useOptionChain(
  symbol: string,
  expiry: string,
  interval: string = '1D',
  enabled: boolean = true
) {
  return useQuery<OptionChainData>({
    queryKey: ['optionChain', symbol, expiry, interval],
    queryFn: () => fetchOptionChain(symbol, expiry, interval),
    enabled: enabled && !!symbol && !!expiry,
    refetchInterval: 15000, // Refresh every 15 seconds (reduced from 10s to prevent rate limiting)
    staleTime: 10000, // Consider data stale after 10 seconds
  });
}
