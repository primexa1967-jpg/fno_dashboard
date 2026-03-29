import { WebSocketServer, WebSocket } from 'ws';
import { TickData } from '@option-dashboard/shared';
import { getMockStream } from '../services/mockStream';
import { getDhanStream } from '../services/dhanClient';

/**
 * Setup WebSocket server for streaming market data
 */
function hasDhanCredentials(): boolean {
  return Boolean(
    process.env.DHAN_ACCESS_TOKEN?.trim() ||
      process.env.DHAN_API_KEY?.trim() ||
      (process.env.DHAN_CLIENT_ID?.trim() && process.env.DHAN_ACCESS_TOKEN?.trim())
  );
}

export function setupWebSocketServer(wss: WebSocketServer): void {
  console.log('📡 WebSocket server initialized');

  const isProd = process.env.NODE_ENV === 'production';
  const mockRequested = process.env.MOCK_MODE === 'true';
  const useMock = mockRequested || !hasDhanCredentials();
  let streamSource: ReturnType<typeof getDhanStream> | ReturnType<typeof getMockStream>;

  try {
    if (!useMock) {
      streamSource = getDhanStream();
      console.log('🔧 Using real Dhan API for streaming');
    } else {
      throw new Error(
        mockRequested ? 'MOCK_MODE=true' : 'Missing DHAN_ACCESS_TOKEN / DHAN_API_KEY'
      );
    }
  } catch (error) {
    if (isProd) {
      console.error(
        '❌ Production: mock WebSocket stream is not allowed. Set DHAN_ACCESS_TOKEN, DHAN_CLIENT_ID, and MOCK_MODE=false.',
        error instanceof Error ? error.message : error
      );
      throw new Error('WebSocket: cannot use mock data in production');
    }
    console.log('🔧 Dev: falling back to mock streaming:', error instanceof Error ? error.message : 'Unknown error');
    streamSource = getMockStream();
  }

  wss.on('connection', (ws: WebSocket) => {
    console.log('Client connected to stream');

    // Subscribe to stream
    const subscription = streamSource.subscribe((tick: TickData) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(tick));
      }
    });

    // Handle client messages (subscription requests)
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'subscribe') {
          // Handle subscription to specific symbols
          console.log('Client subscribed to:', message.symbols);
        } else if (message.type === 'unsubscribe') {
          // Handle unsubscribe
          console.log('Client unsubscribed from:', message.symbols);
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });

    // Handle client disconnect
    ws.on('close', () => {
      console.log('Client disconnected from stream');
      subscription.unsubscribe();
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });
}
