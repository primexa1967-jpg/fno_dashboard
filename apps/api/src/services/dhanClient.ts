import { TickData } from '@option-dashboard/shared';
import axios from 'axios';
import WebSocket from 'ws';
import { getTimeToExpiry } from '../utils/optionsPricing';

/**
 * Dhan API client for real market data streaming
 * Documentation: https://api.dhan.co/docs
 */

interface DhanConfig {
  apiKey: string;
  apiSecret: string;
  accessToken?: string; // JWT access token from Dhan API
  clientId: string;
  feedUrl?: string;
}

interface Subscription {
  callback: (tick: TickData) => void;
  unsubscribe: () => void;
}

interface DhanAuthResponse {
  status: string;
  data: {
    session_token: string;
  };
}

interface DhanMarketFeedMessage {
  type: string;
  data?: any;
  ExchangeSegment?: number;
  SecurityId?: string;
  LTP?: number;
  LastTradeTime?: number;
  LastTradeQty?: number;
  Volume?: number;
  BidPrice?: number;
  AskPrice?: number;
  OI?: number;
  OpenInterest?: number;
}

/** Snapshot from POST /v2/marketfeed/quote — net_change is vs previous day close (Dhan docs) */
export interface IndexMarketQuote {
  lastPrice: number;
  netChange: number;
}

interface SecurityIdMap {
  [key: string]: string;
}

class DhanClient {
  private config: DhanConfig;
  private connected: boolean = false;
  private sessionToken: string | null = null;
  private subscribers: Set<(tick: TickData) => void> = new Set();
  private ws: WebSocket | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 5000;
  
  // Rate limiting — Dhan enforces ~5 req/sec; 600ms keeps us safe with margin
  private lastApiCallTime: number = 0;
  private minApiCallInterval: number = 600; // 600ms between API calls (~1.7/sec, safe)
  private apiCallQueue: Array<() => Promise<any>> = [];
  private isProcessingQueue: boolean = false;
  private consecutiveRateLimitErrors: number = 0;
  private backoffMultiplier: number = 1;

  // ── In-memory caches to prevent redundant API calls ──
  // LTP cache: 5-second TTL (spot prices)
  private ltpCache: Record<string, { price: number; ts: number }> = {};
  private readonly LTP_CACHE_TTL = 5000; // 5 seconds

  // Stale LTP cache: keeps last-known-good price for 24h as fallback
  private staleLtpCache: Record<string, { price: number; ts: number }> = {};
  private readonly STALE_LTP_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  // Failure cooldown: after a failed LTP fetch, don't retry for 30s
  private ltpFailureCache: Record<string, number> = {};
  private readonly LTP_FAILURE_COOLDOWN = 30000; // 30 seconds

  // Expiry cache: 1-hour TTL (expiries don't change intraday)
  private expiryCache: Record<string, { expiries: string[]; ts: number }> = {};
  private readonly EXPIRY_CACHE_TTL = 60 * 60 * 1000; // 1 hour

  // Option chain cache: 15-second TTL at dhanClient level
  private optionChainCache: Record<string, { data: any; ts: number }> = {};
  private readonly OC_CACHE_TTL = 15000; // 15 seconds

  // IV/VIX cache: 30-second TTL
  private ivCache: Record<string, { data: any; ts: number }> = {};
  private readonly IV_CACHE_TTL = 30000; // 30 seconds

  // In-flight request deduplication: coalesce concurrent identical requests
  private inflightRequests: Record<string, Promise<any>> = {};
  
  // Security ID mappings for major indices (SPOT/INDEX values, not futures)
  // Note: These are Dhan-specific numeric security IDs for IDX_I segment
  // Source: https://images.dhan.co/api-data/api-scrip-master.csv (verified Dec 29, 2025)
  private securityIdMap: SecurityIdMap = {
    'NIFTY': '13',         // NIFTY 50 INDEX (NSE,I,13) - VERIFIED WORKING
    'BANKNIFTY': '25',     // BANK NIFTY INDEX (NSE,I,25) - VERIFIED WORKING
    'FINNIFTY': '27',      // FIN NIFTY INDEX (NSE,I,27) - VERIFIED WORKING
    'MIDCPNIFTY': '442',   // NIFTY MIDCAP SELECT INDEX (NSE,I,442) - "Nifty Midcap Select"
    'MIDCAPNIFTY': '442',  // NIFTY MIDCAP SELECT INDEX - alternate spelling
    'SENSEX': '51',        // BSE SENSEX INDEX (BSE,I,51) - on BSE exchange
    'BANKEX': '69',        // BSE BANKEX INDEX (BSE,I,69) - BSE Bank Index
    'INDIAVIX': '21',      // INDIA VIX (NSE,I,21)
    // ── F&O Stock Security IDs (NSE Cash segment) ──
    'RELIANCE': '2885',
    'TCS': '11536',
    'HDFCBANK': '1333',
    'INFY': '1594',
    'ICICIBANK': '4963',
    'SBIN': '3045',
    'BHARTIARTL': '10604',
    'ITC': '1660',
    'KOTAKBANK': '1922',
    'LT': '11483',
    'AXISBANK': '5900',
    'BAJFINANCE': '317',
    'MARUTI': '10999',
    'SUNPHARMA': '3351',
    'TATAMOTORS': '3456',
    'WIPRO': '3787',
    'HCLTECH': '7229',
    'ADANIENT': '25',
    'TATASTEEL': '3499',
    'POWERGRID': '14977',
  };
  
  // Exchange segments for each symbol
  private exchangeSegmentMap: SecurityIdMap = {
    'NIFTY': 'IDX_I',
    'BANKNIFTY': 'IDX_I',
    'FINNIFTY': 'IDX_I',
    'MIDCPNIFTY': 'IDX_I',
    'MIDCAPNIFTY': 'IDX_I',
    'SENSEX': 'IDX_I',         // BSE SENSEX, but Dhan uses IDX_I segment
    'BANKEX': 'IDX_I',         // BSE BANKEX, but Dhan uses IDX_I segment
    'INDIAVIX': 'IDX_I',
    // ── F&O Stocks (NSE Cash segment for quotes) ──
    'RELIANCE': 'NSE_EQ',
    'TCS': 'NSE_EQ',
    'HDFCBANK': 'NSE_EQ',
    'INFY': 'NSE_EQ',
    'ICICIBANK': 'NSE_EQ',
    'SBIN': 'NSE_EQ',
    'BHARTIARTL': 'NSE_EQ',
    'ITC': 'NSE_EQ',
    'KOTAKBANK': 'NSE_EQ',
    'LT': 'NSE_EQ',
    'AXISBANK': 'NSE_EQ',
    'BAJFINANCE': 'NSE_EQ',
    'MARUTI': 'NSE_EQ',
    'SUNPHARMA': 'NSE_EQ',
    'TATAMOTORS': 'NSE_EQ',
    'WIPRO': 'NSE_EQ',
    'HCLTECH': 'NSE_EQ',
    'ADANIENT': 'NSE_EQ',
    'TATASTEEL': 'NSE_EQ',
    'POWERGRID': 'NSE_EQ',
  };

  constructor(config: DhanConfig) {
    this.config = config;
  }

  /**
   * Authenticate and get session token from Dhan API
   * Note: Dhan API uses access_token directly in headers for authentication
   */
  private async authenticate(): Promise<string> {
    try {
      console.log('🔐 Setting up Dhan API authentication...');
      
      // Use the JWT access token if provided, otherwise fall back to apiSecret
      this.sessionToken = this.config.accessToken || this.config.apiSecret;
      
      if (!this.sessionToken) {
        throw new Error('No access token or API secret provided');
      }
      
      console.log('✅ Dhan authentication configured');
      return this.sessionToken;
    } catch (error) {
      console.error('❌ Dhan authentication setup failed:', error);
      throw error;
    }
  }

  /**
   * Rate limit API calls to prevent 429 errors.
   * Uses a queue to serialize all API calls with minimum delay.
   * Automatically retries 429 errors up to 3 times so callers never see them.
   */
  private async rateLimitedApiCall<T>(apiCall: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.apiCallQueue.push(async () => {
        const MAX_RETRIES = 3;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            const result = await apiCall();
            resolve(result);
            // Success — gradual backoff cooldown (don't reset instantly)
            if (this.consecutiveRateLimitErrors > 0) {
              this.consecutiveRateLimitErrors = Math.max(0, this.consecutiveRateLimitErrors - 1);
              this.backoffMultiplier = this.consecutiveRateLimitErrors > 0
                ? Math.min(10, Math.pow(2, this.consecutiveRateLimitErrors))
                : 1;
            }
            return; // done — exit closure
          } catch (error: any) {
            const is429 = error?.response?.status === 429 || error?.message?.includes('429');

            if (is429 && attempt < MAX_RETRIES) {
              // 429 hit — increase backoff and retry after delay
              this.consecutiveRateLimitErrors++;
              this.backoffMultiplier = Math.min(10, Math.pow(2, this.consecutiveRateLimitErrors));
              const retryDelay = this.minApiCallInterval * this.backoffMultiplier;
              console.log(`⚠️ 429 — auto-retry ${attempt + 1}/${MAX_RETRIES} after ${retryDelay}ms (backoff ${this.backoffMultiplier}x)`);
              await new Promise(r => setTimeout(r, retryDelay));
              this.lastApiCallTime = Date.now(); // update so next queue item delays properly
              continue; // retry the same call
            }

            // Non-429 error OR all retries exhausted
            if (is429) {
              this.consecutiveRateLimitErrors++;
              this.backoffMultiplier = Math.min(10, Math.pow(2, this.consecutiveRateLimitErrors));
              console.log(`❌ 429 — all ${MAX_RETRIES} retries exhausted (backoff ${this.backoffMultiplier}x)`);
            }
            reject(error);
            return; // done — exit closure
          }
        }
      });

      this.processQueue();
    });
  }

  /**
   * Process the API call queue with rate limiting and exponential backoff.
   * Backoff is managed by the rateLimitedApiCall closure (which detects 429s).
   * This loop just enforces the delay between calls.
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.apiCallQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      while (this.apiCallQueue.length > 0) {
        const now = Date.now();
        const timeSinceLastCall = now - this.lastApiCallTime;

        // Apply exponential backoff if we've hit rate limits
        const effectiveInterval = this.minApiCallInterval * this.backoffMultiplier;

        if (timeSinceLastCall < effectiveInterval) {
          const delay = effectiveInterval - timeSinceLastCall;
          if (delay > 100) {
            console.log(`⏱️  Rate limiting: waiting ${delay}ms (${this.apiCallQueue.length} queued, backoff: ${this.backoffMultiplier}x)`);
          }
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        const apiCall = this.apiCallQueue.shift();
        if (apiCall) {
          this.lastApiCallTime = Date.now();
          // The closure handles resolve/reject and 429 backoff internally
          await apiCall();
        }
      }
    } finally {
      // CRITICAL: always reset so the queue can be re-entered
      this.isProcessingQueue = false;
    }
  }

  /**
   * Parse expiry date from Dhan API format
   * Converts from DD-MMM-YYYY to YYYY-MM-DD (e.g., "28-NOV-2024" to "2024-11-28")
   */
  private parseExpiryFromDhan(expiry: string): string {
    try {
      const months: { [key: string]: string } = {
        'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04',
        'MAY': '05', 'JUN': '06', 'JUL': '07', 'AUG': '08',
        'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
      };
      
      const parts = expiry.split('-');
      if (parts.length === 3) {
        const day = parts[0].padStart(2, '0');
        const month = months[parts[1].toUpperCase()];
        const year = parts[2];
        return `${year}-${month}-${day}`;
      }
      
      return expiry; // Return original if parsing fails
    } catch (error) {
      console.error('Error parsing expiry date:', error);
      return expiry;
    }
  }

  /**
   * Helper method to format expiry date for Dhan API
   * Dhan expects DD-MMM-YYYY format (e.g., "28-NOV-2024")
   */
  private formatExpiryForDhan(expiry: string): string {
    try {
      // If already in DD-MMM-YYYY format, return as is
      if (/^\d{2}-[A-Z]{3}-\d{4}$/.test(expiry)) {
        return expiry;
      }

      // Try to parse various date formats
      const date = new Date(expiry);
      if (isNaN(date.getTime())) {
        console.warn(`⚠️ Could not parse expiry date: ${expiry}, using as-is`);
        return expiry;
      }

      // Format as DD-MMM-YYYY
      const day = date.getDate().toString().padStart(2, '0');
      const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const month = monthNames[date.getMonth()];
      const year = date.getFullYear();

      return `${day}-${month}-${year}`;
    } catch (error) {
      console.error('Error formatting expiry for Dhan:', error);
      return expiry;
    }
  }

  /**
   * Helper method to get security ID for a symbol
   */
  private getSecurityId(symbol: string): string {
    const upperSymbol = symbol.toUpperCase();
    return this.securityIdMap[upperSymbol] || upperSymbol;
  }

  /**
   * Fetch current price for a symbol using Dhan Market Quote API
   * Uses POST /v2/marketfeed/ltp with security IDs
   * Cached for 5 seconds + in-flight deduplication to prevent 429 flooding
   */
  async getSpotPrice(symbol: string): Promise<number> {
    const upperSymbol = symbol.toUpperCase();
    const now = Date.now();

    // 1. Check fresh LTP cache (5s TTL)
    const cached = this.ltpCache[upperSymbol];
    if (cached && (now - cached.ts) < this.LTP_CACHE_TTL) {
      return cached.price;
    }

    // 2. Failure cooldown — if recent fetch failed, return stale/0 immediately
    const lastFail = this.ltpFailureCache[upperSymbol];
    if (lastFail && (now - lastFail) < this.LTP_FAILURE_COOLDOWN) {
      const stale = this.staleLtpCache[upperSymbol];
      if (stale && stale.price > 0) return stale.price;
      return 0;
    }

    // 3. In-flight deduplication: reuse pending request for same symbol
    const inflightKey = `ltp_${upperSymbol}`;
    if (inflightKey in this.inflightRequests) {
      return this.inflightRequests[inflightKey];
    }

    const promise = (async (): Promise<number> => {
      try {
        const price = await this._fetchSpotPrice(upperSymbol);
        this.ltpCache[upperSymbol] = { price, ts: Date.now() };
        this.staleLtpCache[upperSymbol] = { price, ts: Date.now() };
        delete this.ltpFailureCache[upperSymbol]; // clear failure flag
        return price;
      } catch {
        // Fallback 1: try OHLC endpoint (has its own LTP)
        try {
          const ohlc = await this._fetchOHLCData(upperSymbol);
          if (ohlc && ohlc.lastPrice > 0) {
            console.log(`🔄 LTP fallback via OHLC for ${upperSymbol}: ₹${ohlc.lastPrice}`);
            this.ltpCache[upperSymbol] = { price: ohlc.lastPrice, ts: Date.now() };
            this.staleLtpCache[upperSymbol] = { price: ohlc.lastPrice, ts: Date.now() };
            delete this.ltpFailureCache[upperSymbol];
            return ohlc.lastPrice;
          }
          // OHLC returned close price as fallback (market closed)
          if (ohlc && ohlc.close > 0) {
            console.log(`🔄 LTP fallback via OHLC close for ${upperSymbol}: ₹${ohlc.close}`);
            this.ltpCache[upperSymbol] = { price: ohlc.close, ts: Date.now() };
            this.staleLtpCache[upperSymbol] = { price: ohlc.close, ts: Date.now() };
            delete this.ltpFailureCache[upperSymbol];
            return ohlc.close;
          }
        } catch { /* OHLC also failed */ }

        // Fallback 2: return stale LTP if available (last known good price)
        const stale = this.staleLtpCache[upperSymbol];
        if (stale && (Date.now() - stale.ts) < this.STALE_LTP_CACHE_TTL && stale.price > 0) {
          console.log(`📦 Using stale LTP for ${upperSymbol}: ₹${stale.price} (age: ${((Date.now() - stale.ts) / 1000).toFixed(0)}s)`);
          return stale.price;
        }

        // Record failure cooldown to prevent repeated hammering
        this.ltpFailureCache[upperSymbol] = Date.now();
        console.warn(`⚠️ All LTP sources exhausted for ${upperSymbol} — returning 0 (cooldown ${this.LTP_FAILURE_COOLDOWN / 1000}s)`);
        return 0;
      }
    })();

    this.inflightRequests[inflightKey] = promise;
    try {
      return await promise;
    } finally {
      delete this.inflightRequests[inflightKey];
    }
  }

  private async _fetchSpotPrice(upperSymbol: string): Promise<number> {
    try {
      if (!this.sessionToken) {
        await this.authenticate();
      }

      const securityId = this.getSecurityId(upperSymbol);
      const exchangeSeg = this.exchangeSegmentMap[upperSymbol] || 'IDX_I';
      const numericSecurityId = parseInt(securityId, 10);

      // Use lightweight LTP endpoint instead of full quote
      const response = await this.rateLimitedApiCall(() =>
        axios.post(
          `https://api.dhan.co/v2/marketfeed/ltp`,
          { [exchangeSeg]: [numericSecurityId] },
          {
            headers: {
              'access-token': this.sessionToken!,
              'client-id': this.config.clientId,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
          }
        )
      );

      if (!response.data) {
        throw new Error('Dhan API returned no data');
      }

      const segData = response.data.data?.[exchangeSeg];
      const instrData = segData?.[numericSecurityId] || segData?.[securityId];

      if (instrData) {
        // Accept 0 as valid (market closed) — only reject undefined/null
        const currentPrice = instrData.last_price ?? instrData.LTP ?? instrData.ltp;
        if (currentPrice !== undefined && currentPrice !== null) {
          if (currentPrice > 0) {
            console.log(`✅ LTP ${upperSymbol}: ₹${currentPrice}`);
          }
          return currentPrice;
        }
      }

      // Log actual response for debugging (only once per cooldown)
      console.warn(`⚠️ Could not extract LTP for ${upperSymbol}. Response structure:`,
        JSON.stringify({
          dataKeys: response.data?.data ? Object.keys(response.data.data) : 'none',
          segKeys: segData ? Object.keys(segData) : 'none',
          instrData: instrData ?? 'null',
          requestedSeg: exchangeSeg,
          requestedId: numericSecurityId,
        })
      );
      throw new Error(`Could not extract LTP from response for ${upperSymbol}`);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(`❌ LTP error ${upperSymbol}: ${error.response?.status} ${error.message}`);
        throw new Error(`Failed to fetch current price: ${error.response?.data?.errorMessage || error.response?.data?.message || error.message}`);
      }
      throw error;
    }
  }

  /**
   * Batch-fetch LTP for multiple symbols in a single API call.
   * Dhan allows up to 1000 instruments per request.
   * Returns a Map of symbol → last_price.
   */
  async getBatchLTP(symbols: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (symbols.length === 0) return result;

    try {
      if (!this.sessionToken) await this.authenticate();

      // Group symbols by exchange segment
      const segMap: Record<string, number[]> = {};
      const idToSymbol: Record<string, string> = {};

      for (const sym of symbols) {
        const upper = sym.toUpperCase();
        const seg = this.exchangeSegmentMap[upper] || 'NSE_EQ';
        const secId = parseInt(this.getSecurityId(upper), 10);
        if (!segMap[seg]) segMap[seg] = [];
        segMap[seg].push(secId);
        idToSymbol[`${seg}_${secId}`] = upper;
      }

      const response = await this.rateLimitedApiCall(() =>
        axios.post(
          'https://api.dhan.co/v2/marketfeed/ltp',
          segMap,
          {
            headers: {
              'access-token': this.sessionToken!,
              'client-id': this.config.clientId,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            timeout: 10000,
          }
        )
      );

      const data = response.data?.data;
      if (data) {
        for (const seg of Object.keys(data)) {
          for (const secId of Object.keys(data[seg])) {
            const ltp = data[seg][secId]?.last_price;
            const sym = idToSymbol[`${seg}_${secId}`];
            if (sym && ltp > 0) {
              result.set(sym, ltp);
              // Populate individual LTP cache so getSpotPrice() can reuse
              this.ltpCache[sym] = { price: ltp, ts: Date.now() };
            }
          }
        }
      }

      console.log(`✅ Batch LTP: ${result.size}/${symbols.length} symbols`);
    } catch (error) {
      console.warn(`⚠️ Batch LTP error:`, (error as Error).message);
    }
    return result;
  }

  /**
   * Connect to Dhan streaming API via WebSocket
   */
  async connect(): Promise<void> {
    try {
      // Authenticate first if we don't have a token
      if (!this.sessionToken) {
        await this.authenticate();
      }

      this.connectWebSocket();
    } catch (error) {
      console.error('❌ Failed to connect to Dhan API:', error);
      throw error;
    }
  }

  /**
   * Establish WebSocket connection to Dhan market feed
   */
  private connectWebSocket(): void {
    try {
      const feedUrl = this.config.feedUrl || 'wss://api-feed.dhan.co';
      console.log('🔌 Connecting to Dhan WebSocket at:', feedUrl);

      this.ws = new WebSocket(feedUrl);

      this.ws.on('open', () => {
        console.log('✅ Dhan WebSocket connected');
        this.connected = true;
        this.reconnectAttempts = 0;

        // Subscribe to NIFTY by default
        this.subscribeToInstrument('NIFTY');
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const message: DhanMarketFeedMessage = JSON.parse(data.toString());
          this.handleMarketFeed(message);
        } catch (error) {
          console.error('❌ Error parsing WebSocket message:', error);
        }
      });

      this.ws.on('error', (error) => {
        console.error('❌ Dhan WebSocket error:', error);
      });

      this.ws.on('close', (code, reason) => {
        console.log(`🔌 Dhan WebSocket closed: ${code} - ${reason}`);
        this.connected = false;
        this.reconnect();
      });
    } catch (error) {
      console.error('❌ Failed to establish WebSocket connection:', error);
      throw error;
    }
  }

  /**
   * Subscribe to an instrument on the WebSocket
   */
  private subscribeToInstrument(symbol: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('❌ WebSocket not connected, cannot subscribe');
      return;
    }

    try {
      const upperSymbol = symbol.toUpperCase();
      const securityId = this.getSecurityId(upperSymbol);
      const exchangeSegment = this.exchangeSegmentMap[upperSymbol] || 'IDX_I';
      
      const subscriptionMessage = {
        RequestCode: 15, // 15 = Subscribe to Ticker Packet (LTP + LTT)
        InstrumentCount: 1,
        InstrumentList: [
          {
            ExchangeSegment: exchangeSegment, // Use string enum (IDX_I, NSE_EQ, etc.)
            SecurityId: securityId,
          },
        ],
      };

      this.ws.send(JSON.stringify(subscriptionMessage));
      console.log(`📡 Subscribed to ${symbol} (${exchangeSegment}: ${securityId})`);
    } catch (error) {
      console.error(`❌ Failed to subscribe to ${symbol}:`, error);
    }
  }

  /**
   * Handle incoming market feed data
   */
  private handleMarketFeed(message: DhanMarketFeedMessage): void {
    try {
      // Convert Dhan format to our TickData format
      if (message.type === 'Ticker' && message.LTP) {
        const tick: TickData = {
          symbol: message.SecurityId || 'UNKNOWN',
          ltp: message.LTP,
          volume: message.Volume || 0,
          oi: message.OI || message.OpenInterest,
          timestamp: new Date().toISOString(),
        };

        // Notify all subscribers
        this.subscribers.forEach((callback) => callback(tick));
      }
    } catch (error) {
      console.error('❌ Error handling market feed:', error);
    }
  }

  /**
   * Reconnect to WebSocket after connection loss
   */
  private reconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Max reconnection attempts reached, giving up');
      return;
    }

    this.reconnectAttempts++;
    console.log(`🔄 Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    setTimeout(() => {
      this.connectWebSocket();
    }, this.reconnectDelay);
  }

  /**
   * Subscribe to market feed
   */
  subscribe(callback: (tick: TickData) => void): Subscription {
    this.subscribers.add(callback);

    if (!this.connected) {
      this.connect();
    }

    return {
      callback,
      unsubscribe: () => {
        this.subscribers.delete(callback);
      },
    };
  }

  /**
   * Handle incoming message from Dhan API
   */
  private handleMessage(data: any): void {
    // TODO: Parse Dhan API message format and convert to TickData
    // Example:
    // const tick: TickData = {
    //   symbol: data.symbol,
    //   ltp: data.ltp,
    //   volume: data.volume,
    //   oi: data.open_interest,
    //   timestamp: new Date(data.timestamp).toISOString(),
    // };
    
    // this.subscribers.forEach(callback => callback(tick));
  }

  /**
   * Disconnect from Dhan API and cleanup
   */
  disconnect(): void {
    try {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      
      this.connected = false;
      this.subscribers.clear();
      this.reconnectAttempts = 0;
      
      console.log('✅ Disconnected from Dhan API');
    } catch (error) {
      console.error('❌ Error during disconnect:', error);
    }
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.connected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get current session token
   */
  getSessionToken(): string | null {
    return this.sessionToken;
  }

  /**
   * Fetch option chain data from Dhan API v2.0
   * POST /v2/optionchain with {symbol, expiry, exchangeSegment}
   * Cached for 15 seconds + in-flight dedup to prevent 429 flooding
   */
  async getOptionChain(symbol: string, expiry: string): Promise<any> {
    const upperSymbol = symbol.toUpperCase();

    // 1. Check OC cache (15s TTL)
    const cacheKey = `${upperSymbol}_${expiry}`;
    const cached = this.optionChainCache[cacheKey];
    if (cached && (Date.now() - cached.ts) < this.OC_CACHE_TTL) {
      return cached.data;
    }

    // 2. In-flight deduplication
    const inflightKey = `oc_${cacheKey}`;
    if (inflightKey in this.inflightRequests) {
      return this.inflightRequests[inflightKey];
    }

    const promise = this._fetchOptionChain(upperSymbol, expiry);
    this.inflightRequests[inflightKey] = promise;

    try {
      const data = await promise;
      this.optionChainCache[cacheKey] = { data, ts: Date.now() };
      return data;
    } finally {
      delete this.inflightRequests[inflightKey];
    }
  }

  private async _fetchOptionChain(upperSymbol: string, expiry: string): Promise<any> {
    try {
      if (!this.sessionToken) {
        await this.authenticate();
      }

      console.log(`📊 Fetching option chain for ${upperSymbol} expiry ${expiry}...`);

      // Resolve expiry to a valid YYYY-MM-DD date.
      // If expiry is missing, "current", or not a parseable date, fetch the
      // nearest expiry from the Dhan expiry-list API first.
      let formattedExpiry = expiry;
      const needsResolution = !expiry || expiry === 'current' || isNaN(new Date(expiry).getTime());

      if (needsResolution) {
        console.log(`📅 Expiry "${expiry}" needs resolution — fetching nearest expiry for ${upperSymbol}…`);
        try {
          const expiries = await this.getExpiries(upperSymbol);
          if (expiries.length > 0) {
            formattedExpiry = expiries[0]; // nearest / current-week expiry
            console.log(`📅 Resolved to nearest expiry: ${formattedExpiry}`);
          } else {
            // Fallback: compute next Thursday
            const today = new Date();
            const dow = today.getDay();
            const daysToThu = (4 - dow + 7) % 7 || 7;
            const thu = new Date(today);
            thu.setDate(today.getDate() + daysToThu);
            formattedExpiry = `${thu.getFullYear()}-${String(thu.getMonth() + 1).padStart(2, '0')}-${String(thu.getDate()).padStart(2, '0')}`;
            console.warn(`⚠️ No expiries from API — fallback to ${formattedExpiry}`);
          }
        } catch (err) {
          console.warn(`⚠️ getExpiries failed, computing fallback:`, (err as Error).message);
          const today = new Date();
          const dow = today.getDay();
          const daysToThu = (4 - dow + 7) % 7 || 7;
          const thu = new Date(today);
          thu.setDate(today.getDate() + daysToThu);
          formattedExpiry = `${thu.getFullYear()}-${String(thu.getMonth() + 1).padStart(2, '0')}-${String(thu.getDate()).padStart(2, '0')}`;
        }
      } else {
        // Normalise whatever date string the caller gave us to YYYY-MM-DD
        try {
          const date = new Date(expiry);
          if (!isNaN(date.getTime())) {
            formattedExpiry = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          }
        } catch {
          console.warn(`⚠️ Could not parse expiry date: ${expiry}, using as-is`);
        }
      }

      // Get the security ID for the symbol
      const securityId = this.getSecurityId(upperSymbol);
      const underlyingSeg = this.exchangeSegmentMap[upperSymbol] || 'IDX_I';

      console.log(`🔄 Requesting option chain: UnderlyingScrip=${securityId}, UnderlyingSeg=${underlyingSeg}, Expiry=${formattedExpiry}`);

      // Correct Dhan API format from documentation: https://dhanhq.co/docs/v2/option-chain/
      const response = await this.rateLimitedApiCall(() =>
        axios.post(
          `https://api.dhan.co/v2/optionchain`,
          {
            UnderlyingScrip: parseInt(securityId, 10),  // Must be integer (e.g., 13 for NIFTY)
            UnderlyingSeg: underlyingSeg,                // e.g., "IDX_I"
            Expiry: formattedExpiry                      // e.g., "2024-10-31"
          },
          {
            headers: {
              'access-token': this.sessionToken!,
              'client-id': this.config.clientId,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            timeout: 10000,
          }
        )
      );

      // ✨ Check if response contains actual trading data
      if (response.data?.data?.oc) {
        const strikes = Object.keys(response.data.data.oc);
        console.log(`📊 Received ${strikes.length} strikes in option chain`);
        
        if (strikes.length > 0) {
          // Check first few strikes for any non-zero data
          const hasData = strikes.slice(0, 5).some(strikeKey => {
            const strikeData = response.data.data.oc[strikeKey];
            return strikeData.ce?.oi > 0 || strikeData.ce?.volume > 0 || 
                   strikeData.pe?.oi > 0 || strikeData.pe?.volume > 0;
          });
          
          if (!hasData) {
            console.warn(`⚠️ WARNING: Option chain data received but all values are ZERO!`);
            console.warn(`⚠️ This usually means:`);
            console.warn(`   1. Market is closed (check if today is a trading holiday)`);
            console.warn(`   2. Selected expiry has expired or not yet active`);
            console.warn(`   3. Data not yet available from exchange`);
          } else {
            console.log(`✅ Option chain contains live trading data`);
          }
        }
      }
      
      console.log(`✅ Option chain data received for ${upperSymbol}`);
      
      // Throw error if API returns mock data or fails
      if (!response.data || response.data.source === 'mock') {
        throw new Error('Dhan API returned mock/invalid data');
      }

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(`❌ Failed to fetch option chain:`, {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          message: error.message,
        });
      } else {
        console.error(`❌ Failed to fetch option chain:`, error instanceof Error ? error.message : 'Unknown error');
      }
      
      // DO NOT return mock data - throw the error instead
      throw new Error(`Failed to fetch real option chain data for ${upperSymbol}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Fetch implied volatility data for a symbol
   * Primarily uses India VIX quote. Falls back to static IV values to avoid
   * cascading API calls (getSpotPrice → getExpiries → getOptionChain) which
   * cause 429 flooding.
   * Cached for 30 seconds + in-flight dedup.
   */
  async getIVData(symbol: string): Promise<any> {
    const upperSymbol = symbol.toUpperCase();

    // 1. Check IV cache (30s TTL)
    const cached = this.ivCache[upperSymbol];
    if (cached && (Date.now() - cached.ts) < this.IV_CACHE_TTL) {
      return cached.data;
    }

    // 2. In-flight deduplication — VIX is the same for all indices,
    //    so deduplicate on 'iv_VIX' for index symbols
    const inflightKey = `iv_VIX`;
    if (inflightKey in this.inflightRequests) {
      const data = await this.inflightRequests[inflightKey];
      // Store in per-symbol cache too
      this.ivCache[upperSymbol] = { data, ts: Date.now() };
      return data;
    }

    const promise = this._fetchIVData(upperSymbol);
    this.inflightRequests[inflightKey] = promise;

    try {
      const data = await promise;
      this.ivCache[upperSymbol] = { data, ts: Date.now() };
      return data;
    } finally {
      delete this.inflightRequests[inflightKey];
    }
  }

  private async _fetchIVData(upperSymbol: string): Promise<any> {
    try {
      if (!this.sessionToken) {
        await this.authenticate();
      }

      // India VIX (security ID 21, IDX_I segment) applies to ALL indices
      const response = await this.rateLimitedApiCall(() =>
        axios.post(
          `https://api.dhan.co/v2/marketfeed/quote`,
          {
            IDX_I: [21] // India VIX security ID = 21 in IDX_I segment
          },
          {
            headers: {
              'access-token': this.sessionToken!,
              'client-id': this.config.clientId,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
          }
        )
      );

      // Extract VIX value from response
      const vixSegData = response.data?.data?.IDX_I || response.data?.data?.NSE_INDEX;
      const vixInstr = vixSegData?.['21'] || vixSegData?.[21];
      if (vixInstr) {
        const vixValue = vixInstr.last_price || vixInstr.LTP;
        if (vixValue) {
          console.log(`✅ India VIX: ${vixValue}`);
          return {
            iv: vixValue,
            symbol: 'INDIAVIX',
            ltp: vixValue
          };
        }
      }

      // If VIX value not found in response, fall through to static fallback
      throw new Error('VIX value not in response');
    } catch (error) {
      // IMPORTANT: Do NOT cascade into getSpotPrice → getExpiries → getOptionChain
      // That cascade triggers 3+ more API calls and amplifies 429 errors.
      // Instead, return static fallback IV values.
      const fallbackIV: { [key: string]: number } = {
        'NIFTY': 15.5,
        'BANKNIFTY': 18.2,
        'FINNIFTY': 16.8,
        'MIDCAPNIFTY': 17.5,
        'SENSEX': 14.9,
      };

      const defaultIV = fallbackIV[upperSymbol] || 15.0;
      console.warn(`⚠️ VIX fetch failed for ${upperSymbol}, using fallback IV: ${defaultIV}%`);

      return {
        iv: defaultIV,
        symbol: upperSymbol,
        ltp: defaultIV,
        method: 'fallback'
      };
    }
  }

  /**
   * Fetch expiry dates for an index from Dhan API v2.0
   * POST /v2/optionchain/expirylist
   * Cached for 1 hour (expiries don't change intraday) + in-flight dedup
   */
  async getExpiries(symbol: string): Promise<string[]> {
    const upperSymbol = symbol.toUpperCase();

    // 1. Check expiry cache (1h TTL — expiries are static intraday)
    const cached = this.expiryCache[upperSymbol];
    if (cached && (Date.now() - cached.ts) < this.EXPIRY_CACHE_TTL) {
      return cached.expiries;
    }

    // 2. In-flight deduplication
    const inflightKey = `exp_${upperSymbol}`;
    if (inflightKey in this.inflightRequests) {
      return this.inflightRequests[inflightKey];
    }

    const promise = this._fetchExpiries(upperSymbol);
    this.inflightRequests[inflightKey] = promise;

    try {
      const expiries = await promise;
      this.expiryCache[upperSymbol] = { expiries, ts: Date.now() };
      return expiries;
    } finally {
      delete this.inflightRequests[inflightKey];
    }
  }

  private async _fetchExpiries(upperSymbol: string): Promise<string[]> {
    try {
      if (!this.sessionToken) {
        await this.authenticate();
      }

      console.log(`📅 Fetching expiries for ${upperSymbol}...`);

      // Get the security ID for the symbol
      const securityId = this.getSecurityId(upperSymbol);
      const underlyingSeg = this.exchangeSegmentMap[upperSymbol] || 'IDX_I';

      console.log(`🔄 Requesting expiries: UnderlyingScrip=${securityId}, UnderlyingSeg=${underlyingSeg}`);

      // Correct Dhan API format from documentation: https://dhanhq.co/docs/v2/option-chain/
      const response = await this.rateLimitedApiCall(() =>
        axios.post(
          `https://api.dhan.co/v2/optionchain/expirylist`,
          {
            UnderlyingScrip: parseInt(securityId, 10),  // Must be integer (e.g., 13 for NIFTY)
            UnderlyingSeg: underlyingSeg                 // e.g., "IDX_I"
          },
          {
            headers: {
              'access-token': this.sessionToken!,
              'client-id': this.config.clientId,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
          }
        )
      );

      console.log(`✅ Expiries received for ${upperSymbol}:`, response.data);

      // Extract expiries from response
      let expiries: string[] = [];
      if (response.data && response.data.data) {
        if (Array.isArray(response.data.data)) {
          expiries = response.data.data;
        } else if (response.data.data.expiries) {
          expiries = response.data.data.expiries;
        }
      } else if (response.data && response.data.expiries) {
        expiries = response.data.expiries;
      } else if (Array.isArray(response.data)) {
        expiries = response.data;
      }

      if (expiries.length > 0) {
        console.log(`✅ Found ${expiries.length} expiries for ${upperSymbol}`);
        return expiries;
      }

      // When market is closed, expiries API returns empty
      // Return current week's Thursday and next week's Thursday as fallback
      console.warn(`⚠️ No expiries returned from API (market may be closed). Returning fallback expiries.`);
      
      const today = new Date();
      const currentDay = today.getDay(); // 0=Sun, 4=Thu
      
      // Find this week's Thursday
      const daysUntilThursday = (4 - currentDay + 7) % 7;
      const thisThursday = new Date(today);
      thisThursday.setDate(today.getDate() + daysUntilThursday);
      
      // Find next week's Thursday
      const nextThursday = new Date(thisThursday);
      nextThursday.setDate(thisThursday.getDate() + 7);
      
      // Format as YYYY-MM-DD
      const formatDate = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      
      const fallbackExpiries = [formatDate(thisThursday), formatDate(nextThursday)];
      console.log(`📅 Fallback expiries: ${fallbackExpiries.join(', ')}`);
      
      return fallbackExpiries;

    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(`❌ Failed to fetch expiries:`, {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          message: error.message,
        });
      } else {
        console.error(`❌ Failed to fetch expiries:`, error instanceof Error ? error.message : 'Unknown error');
      }
      
      // DO NOT return mock data - throw the error instead
      throw new Error(`Failed to fetch real expiries for ${upperSymbol}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // ── Historical candle cache ──────────────────────────────────────────────
  private historicalCache: Record<string, { data: any[]; ts: number }> = {};
  private readonly HIST_CACHE_TTL = 5 * 60 * 1000; // 5 min

  /**
   * Get historical OHLC candles for technical analysis using Dhan Charts API.
   *
   * Daily:    POST /v2/charts/historical   { securityId, exchangeSegment, instrument:"INDEX", fromDate, toDate }
   * Intraday: POST /v2/charts/intraday     { securityId, exchangeSegment, instrument:"INDEX", interval, fromDate, toDate }
   *
   * @param symbol   Index symbol (NIFTY, BANKNIFTY, etc.)
   * @param interval '1','3','5','15','25','60' for minutes  OR  '1D','D' for daily
   * @param count    Approximate number of candles desired (default 50)
   */
  async getHistoricalCandles(
    symbol: string,
    interval: string,
    count: number = 50
  ): Promise<import('./moodCalculator').OHLCCandle[]> {
    try {
      if (!this.sessionToken) await this.authenticate();

      const upperSymbol = symbol.toUpperCase();
      const cacheKey = `${upperSymbol}_${interval}_${count}`;
      const cached = this.historicalCache[cacheKey];
      if (cached && Date.now() - cached.ts < this.HIST_CACHE_TTL) {
        return cached.data;
      }

      const securityId = this.getSecurityId(upperSymbol);
      const exchangeSeg = this.exchangeSegmentMap[upperSymbol] || 'IDX_I';

      // Determine instrument type for the request
      const instrument = exchangeSeg === 'IDX_I' ? 'INDEX' : 'EQUITY';

      const isDaily = interval === 'D' || interval === '1D';

      // Build date range
      const toDate = new Date();
      const fromDate = new Date();
      if (isDaily) {
        // For daily candles, go back count trading days (~1.5× calendar days)
        fromDate.setDate(fromDate.getDate() - Math.ceil(count * 1.5));
      } else {
        // For intraday candles, go back enough trading days
        // Each trading day ≈ 375 min, so for 5-min candles: 375/5 = 75 candles/day
        const minuteInterval = parseInt(interval, 10) || 5;
        const candlesPerDay = Math.floor(375 / minuteInterval);
        const daysNeeded = Math.max(1, Math.ceil(count / candlesPerDay));
        fromDate.setDate(fromDate.getDate() - Math.min(daysNeeded + 2, 90));
      }

      // Format dates
      const fmtDate = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const fmtDateTime = (d: Date) => `${fmtDate(d)} 09:15:00`;

      let response: any;

      const numericSecurityId = parseInt(String(securityId), 10);
      if (!Number.isFinite(numericSecurityId)) {
        console.warn(`⚠️ Invalid securityId for historical: ${securityId}`);
        return [];
      }

      if (isDaily) {
        // POST /v2/charts/historical
        response = await this.rateLimitedApiCall(() =>
          axios.post(
            'https://api.dhan.co/v2/charts/historical',
            {
              securityId: numericSecurityId,
              exchangeSegment: exchangeSeg,
              instrument,
              expiryCode: 0,
              oi: false,
              fromDate: fmtDate(fromDate),
              toDate: fmtDate(toDate),
            },
            {
              headers: {
                'access-token': this.sessionToken!,
                'client-id': this.config.clientId,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
              timeout: 10000,
            }
          )
        );
      } else {
        // POST /v2/charts/intraday  — interval must be 1, 5, 15, 25, or 60
        const dhanInterval = parseInt(interval, 10) || 5;
        // Dhan only accepts 1, 5, 15, 25, 60
        const validIntervals = [1, 5, 15, 25, 60];
        const nearestInterval = validIntervals.reduce((prev, curr) =>
          Math.abs(curr - dhanInterval) < Math.abs(prev - dhanInterval) ? curr : prev
        );

        response = await this.rateLimitedApiCall(() =>
          axios.post(
            'https://api.dhan.co/v2/charts/intraday',
            {
              securityId: numericSecurityId,
              exchangeSegment: exchangeSeg,
              instrument,
              interval: String(nearestInterval),
              oi: false,
              fromDate: fmtDateTime(fromDate),
              toDate: fmtDateTime(toDate),
            },
            {
              headers: {
                'access-token': this.sessionToken!,
                'client-id': this.config.clientId,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
              timeout: 10000,
            }
          )
        );
      }

      // Parse Dhan array-based response: { open:[], high:[], low:[], close:[], volume:[], timestamp:[] }
      const data = response.data;
      if (!data || !data.open || !Array.isArray(data.open) || data.open.length === 0) {
        console.warn(`⚠️ No historical candle data returned for ${upperSymbol} ${interval}`);
        // Do not cache empty results — avoids a 5-minute blackout after 429/errors/mis-parsed IDs
        return [];
      }

      const candles: import('./moodCalculator').OHLCCandle[] = [];
      const len = data.open.length;
      for (let i = 0; i < len; i++) {
        candles.push({
          open: data.open[i],
          high: data.high[i],
          low: data.low[i],
          close: data.close[i],
          volume: data.volume?.[i] || 0,
          timestamp: data.timestamp?.[i] ? data.timestamp[i] * 1000 : Date.now(), // Dhan returns epoch seconds
        });
      }

      // Take only last `count` candles
      const result = candles.slice(-count);
      console.log(`✅ Fetched ${result.length} ${isDaily ? 'daily' : interval + 'm'} candles for ${upperSymbol}`);
      this.historicalCache[cacheKey] = { data: result, ts: Date.now() };
      return result;

    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.warn(`⚠️ Historical candles API error for ${symbol} ${interval}: ${error.response?.status} ${error.response?.data?.errorMessage || error.message}`);
      } else {
        console.warn(`⚠️ Historical candles error for ${symbol} ${interval}:`, (error as Error).message);
      }
      return [];
    }
  }

  /**
   * Day change vs previous session close using daily candles — aligns with NSE-style "vs prev close"
   * when Dhan's /marketfeed/ohlc `close` tracks intraday last price (→ 0% bug) or /quote omits net_change.
   *
   * Prev close is always the **prior daily bar's close** (sorted[sorted.length - 2]). The latest bar is the
   * most recent session (today intraday or last traded day). Using `last.close` as prev when the calendar
   * day differs (weekends/holidays) wrongly equals LTP and yields 0% — that was the main bug.
   */
  async getIndexChangeVsPrevCloseFromDailyHistory(
    symbol: string,
    ltp: number
  ): Promise<{ change: number; changePercent: number } | null> {
    const upper = symbol.toUpperCase();
    const indexKeys = new Set([
      'NIFTY',
      'BANKNIFTY',
      'FINNIFTY',
      'MIDCAPNIFTY',
      'MIDCPNIFTY',
      'SENSEX',
      'BANKEX',
    ]);
    if (!indexKeys.has(upper)) return null;
    if (!(ltp > 0) || !Number.isFinite(ltp)) return null;

    const candles = await this.getHistoricalCandles(upper, 'D', 10);
    if (!candles || candles.length < 2) return null;

    const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
    const prevClose = sorted[sorted.length - 2].close;

    if (!(prevClose > 0) || !Number.isFinite(prevClose)) return null;

    const rawChange = ltp - prevClose;
    return {
      change: Number(rawChange.toFixed(2)),
      changePercent: Number(((rawChange / prevClose) * 100).toFixed(2)),
    };
  }

  // OHLC cache: 10-second TTL (day OHLC doesn't change rapidly)
  private ohlcCache: Record<string, { data: any; ts: number }> = {};
  private readonly OHLC_CACHE_TTL = 10000; // 10 seconds

  /** Full quote (includes net_change from prev close per Dhan docs) — same TTL as OHLC */
  private indexQuoteCache: Record<string, { data: IndexMarketQuote; ts: number }> = {};
  private readonly INDEX_QUOTE_CACHE_TTL = 10000;

  /**
   * Fetch OHLC + LTP data for a symbol using Dhan Market Quote OHLC API.
   * POST /v2/marketfeed/ohlc → { last_price, ohlc: { open, close, high, low } }
   * Cached for 10 seconds + in-flight dedup.
   */
  async getOHLCData(symbol: string): Promise<{
    lastPrice: number;
    open: number;
    high: number;
    low: number;
    close: number;
  } | null> {
    const upperSymbol = symbol.toUpperCase();

    // 1. Check OHLC cache
    const cached = this.ohlcCache[upperSymbol];
    if (cached && (Date.now() - cached.ts) < this.OHLC_CACHE_TTL) {
      return cached.data;
    }

    // 2. In-flight deduplication
    const inflightKey = `ohlc_${upperSymbol}`;
    if (inflightKey in this.inflightRequests) {
      return this.inflightRequests[inflightKey];
    }

    const promise = this._fetchOHLCData(upperSymbol);
    this.inflightRequests[inflightKey] = promise;

    try {
      const data = await promise;
      if (data) {
        this.ohlcCache[upperSymbol] = { data, ts: Date.now() };
        // Also populate LTP cache
        if (data.lastPrice > 0) {
          this.ltpCache[upperSymbol] = { price: data.lastPrice, ts: Date.now() };
        }
      }
      return data;
    } finally {
      delete this.inflightRequests[inflightKey];
    }
  }

  private async _fetchOHLCData(upperSymbol: string): Promise<{
    lastPrice: number;
    open: number;
    high: number;
    low: number;
    close: number;
  } | null> {
    try {
      if (!this.sessionToken) await this.authenticate();

      const securityId = this.getSecurityId(upperSymbol);
      const exchangeSeg = this.exchangeSegmentMap[upperSymbol] || 'IDX_I';
      const numericSecurityId = parseInt(securityId, 10);

      const response = await this.rateLimitedApiCall(() =>
        axios.post(
          'https://api.dhan.co/v2/marketfeed/ohlc',
          { [exchangeSeg]: [numericSecurityId] },
          {
            headers: {
              'access-token': this.sessionToken!,
              'client-id': this.config.clientId,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            timeout: 8000,
          }
        )
      );

      const segData = response.data?.data?.[exchangeSeg];
      const instrData = segData?.[numericSecurityId] || segData?.[securityId];
      if (instrData) {
        const ohlc = instrData.ohlc || {};
        return {
          lastPrice: instrData.last_price || 0,
          open: ohlc.open || 0,
          high: ohlc.high || 0,
          low: ohlc.low || 0,
          close: ohlc.close || 0,
        };
      }
      return null;
    } catch (error) {
      console.warn(`⚠️ OHLC data error for ${upperSymbol}:`, (error as Error).message);
      return null;
    }
  }

  /**
   * Index snapshot from POST /v2/marketfeed/quote.
   * Uses `net_change` (absolute move from previous day close) for day change / % — not ohlc.close from /ohlc,
   * which for some instruments tracks same-session values and yields 0% in the UI.
   */
  async getIndexMarketQuote(symbol: string): Promise<IndexMarketQuote | null> {
    const upperSymbol = symbol.toUpperCase();
    const indexKeys = new Set([
      'NIFTY',
      'BANKNIFTY',
      'FINNIFTY',
      'MIDCAPNIFTY',
      'MIDCPNIFTY',
      'SENSEX',
      'BANKEX',
    ]);
    if (!indexKeys.has(upperSymbol)) return null;

    const cached = this.indexQuoteCache[upperSymbol];
    if (cached && Date.now() - cached.ts < this.INDEX_QUOTE_CACHE_TTL) {
      return cached.data;
    }

    const inflightKey = `idxquote_${upperSymbol}`;
    if (inflightKey in this.inflightRequests) {
      return this.inflightRequests[inflightKey];
    }

    const promise = this._fetchIndexMarketQuote(upperSymbol);
    this.inflightRequests[inflightKey] = promise;

    try {
      const data = await promise;
      if (data) {
        this.indexQuoteCache[upperSymbol] = { data, ts: Date.now() };
        if (data.lastPrice > 0) {
          this.ltpCache[upperSymbol] = { price: data.lastPrice, ts: Date.now() };
        }
      }
      return data;
    } finally {
      delete this.inflightRequests[inflightKey];
    }
  }

  private async _fetchIndexMarketQuote(upperSymbol: string): Promise<IndexMarketQuote | null> {
    try {
      if (!this.sessionToken) await this.authenticate();

      const securityId = this.getSecurityId(upperSymbol);
      const exchangeSeg = this.exchangeSegmentMap[upperSymbol] || 'IDX_I';
      const numericSecurityId = parseInt(securityId, 10);

      const response = await this.rateLimitedApiCall(() =>
        axios.post(
          'https://api.dhan.co/v2/marketfeed/quote',
          { [exchangeSeg]: [numericSecurityId] },
          {
            headers: {
              'access-token': this.sessionToken!,
              'client-id': this.config.clientId,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            timeout: 8000,
          }
        )
      );

      const segData = response.data?.data?.[exchangeSeg];
      const instrData = segData?.[numericSecurityId] ?? segData?.[securityId];
      if (!instrData) return null;

      const lastPrice = Number(instrData.last_price);
      if (!Number.isFinite(lastPrice) || lastPrice <= 0) return null;

      if (!('net_change' in instrData) || instrData.net_change === null || instrData.net_change === undefined) {
        return null;
      }
      const netChange = Number(instrData.net_change);
      if (!Number.isFinite(netChange)) return null;

      return { lastPrice, netChange };
    } catch (error) {
      console.warn(`⚠️ Index market quote error for ${upperSymbol}:`, (error as Error).message);
      return null;
    }
  }

  // ── Positions cache: 10-second TTL ──
  private positionsCache: { data: any[]; ts: number } | null = null;
  private readonly POSITIONS_CACHE_TTL = 10000; // 10 seconds

  /**
   * Get open positions from Dhan API (GET /v2/positions)
   * Returns all open positions including F&O carry-forward positions.
   * Filters to only F&O options (NSE_FNO / BSE_FNO) with non-zero netQty.
   */
  async getPositions(): Promise<any[]> {
    // Check cache
    if (this.positionsCache && (Date.now() - this.positionsCache.ts) < this.POSITIONS_CACHE_TTL) {
      console.log(`📦 Using cached positions (age: ${Date.now() - this.positionsCache.ts}ms)`);
      return this.positionsCache.data;
    }

    // In-flight dedup
    const inflightKey = 'positions';
    if (inflightKey in this.inflightRequests) {
      return this.inflightRequests[inflightKey];
    }

    const promise = this._fetchPositions();
    this.inflightRequests[inflightKey] = promise;
    try {
      const result = await promise;
      this.positionsCache = { data: result, ts: Date.now() };
      return result;
    } finally {
      delete this.inflightRequests[inflightKey];
    }
  }

  private async _fetchPositions(): Promise<any[]> {
    try {
      if (!this.sessionToken) {
        await this.authenticate();
      }

      const response = await this.rateLimitedApiCall(() =>
        axios.get('https://api.dhan.co/v2/positions', {
          headers: {
            'access-token': this.sessionToken!,
            'client-id': this.config.clientId,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        })
      );

      const allPositions: any[] = response.data || [];
      console.log(`📊 Dhan returned ${allPositions.length} total positions`);

      // Filter to F&O options with non-zero net quantity
      const fnoOptions = allPositions.filter((pos: any) => {
        const seg = pos.exchangeSegment || '';
        const isFNO = seg === 'NSE_FNO' || seg === 'BSE_FNO' || seg === 'MCX_COMM';
        const hasQty = (pos.netQty || 0) !== 0;
        const isOption = pos.drvOptionType === 'CALL' || pos.drvOptionType === 'PUT';
        return isFNO && hasQty && isOption;
      });

      console.log(`📊 Filtered to ${fnoOptions.length} active F&O option positions`);
      return fnoOptions;
    } catch (error: any) {
      // 401/403 means auth issue, not a crash
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        console.warn('⚠️ Dhan positions API: authentication failed — no positions available');
        return [];
      }
      console.error('❌ Error fetching positions from Dhan:', error?.message || error);
      return [];
    }
  }
}

// Singleton instance to share rate limiter across all API calls
let dhanClientInstance: DhanClient | null = null;

/**
 * Get Dhan stream instance (SINGLETON)
 * This ensures all API calls share the same rate limiter queue
 */
export function getDhanStream(): DhanClient {
  if (dhanClientInstance) {
    return dhanClientInstance;
  }

  try {
    const config: DhanConfig = {
      apiKey: process.env.DHAN_API_KEY || '',
      apiSecret: process.env.DHAN_API_SECRET || '',
      accessToken: process.env.DHAN_ACCESS_TOKEN || '', // Use the JWT access token
      clientId: process.env.DHAN_CLIENT_ID || '',
      feedUrl: process.env.DHAN_FEED_URL,
    };

    if (!config.clientId) {
      throw new Error('Dhan API credentials not configured. Set DHAN_CLIENT_ID in .env');
    }

    if (!config.accessToken && !config.apiSecret) {
      throw new Error('No access token or API secret provided. Set DHAN_ACCESS_TOKEN in .env');
    }

    dhanClientInstance = new DhanClient(config);
    return dhanClientInstance;
  } catch (error) {
    console.error('Failed to initialize Dhan client:', error);
    throw error;
  }
}
