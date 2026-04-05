import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

// Load environment variables
dotenv.config();

if (process.env.NODE_ENV === 'production') {
  if (process.env.MOCK_MODE === 'true') {
    console.warn('⚠️ MOCK_MODE=true in production — use only for debugging');
  }
  if (!process.env.DHAN_ACCESS_TOKEN?.trim() && !process.env.DHAN_API_KEY?.trim()) {
    console.error('⚠️ Production: set DHAN_ACCESS_TOKEN (and DHAN_CLIENT_ID) for live market data');
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('change-me')) {
    console.error('⚠️ Production: set a strong JWT_SECRET');
  }
}

// Import routes
import authRoutes from './routes/auth';
import adminRoutes from './routes/admin';
import marketRoutes from './routes/market';
import moodRoutes from './routes/mood';
import signalRoutes from './routes/signal';
import volatilityRoutes from './routes/volatility';
import rangesRoutes from './routes/ranges';
import exitRoutes from './routes/exit';
import scannerRoutes from './routes/scanner';
import stockRoutes from './routes/stocks';
import engineRoutes from './routes/engine';
import { setupWebSocketServer } from './routes/stream';

// Import WebSocket service
import { websocketService } from './services/websocket';
import { marketDataPoller } from './services/marketDataPoller';
import { startSnapshotJob } from './jobs/snapshotJob';
import { marketStateStore } from './services/marketStateStore';

// Import database initialization
import { initializeDatabase } from './db/init';
import { hydrateEnginesFromDisk } from './services/enginePersistence';
import { startPipelineRunner, stopPipelineRunner } from './services/pipelineRunner';

let snapshotJobInterval: NodeJS.Timeout | null = null;

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(helmet());
const corsOrigins = process.env.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: corsOrigins?.length ? corsOrigins : true,
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/market', marketRoutes);
app.use('/mood', moodRoutes);
app.use('/signal', signalRoutes);
app.use('/volatility', volatilityRoutes);
app.use('/ranges', rangesRoutes);
app.use('/exit', exitRoutes);
app.use('/scanner', scannerRoutes);
app.use('/stocks', stockRoutes);
app.use('/engine', engineRoutes);

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// Initialize database + restore paper-trading snapshot
initializeDatabase()
  .then(() => hydrateEnginesFromDisk())
  .then(() => {
    console.log('Database initialized successfully');
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });

// Create HTTP server
const server = createServer(app);

// Setup WebSocket servers
const wss = new WebSocketServer({ server, path: '/stream/ticks' });
setupWebSocketServer(wss);

// Initialize market data WebSocket service
websocketService.initialize(server);

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️  Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process
});

process.on('uncaughtException', (error) => {
  console.error('⚠️  Uncaught Exception:', error);
  // Don't exit the process
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 API server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket server running on ws://localhost:${PORT}/stream/ticks`);
  console.log(`📡 Market data WebSocket running on ws://localhost:${PORT}/ws`);
  console.log(`🔧 Mock mode: ${process.env.MOCK_MODE === 'true' ? 'ENABLED' : 'DISABLED'}`);
  console.log(`✅ Server ready - WebSocket clients can now connect`);
  console.log(`📊 Market data polling will start when clients subscribe to channels`);
  
  // Start snapshot storage job
  snapshotJobInterval = startSnapshotJob();
  console.log(`📸 Snapshot storage job started`);

  // Start MarketStateStore background refresh for stock dashboard
  // Delayed by 15s to stagger after SnapshotJob and avoid startup API burst
  setTimeout(() => {
    marketStateStore.start();
    console.log(`🏪 MarketStateStore background refresh started (delayed 15s)`);
  }, 15000);

  startPipelineRunner();

  // Don't start polling automatically - let clients trigger it
  // This avoids unnecessary API calls and potential crashes
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  stopPipelineRunner();
  if (snapshotJobInterval) {
    clearInterval(snapshotJobInterval);
    console.log('Snapshot job stopped');
  }
  marketStateStore.stop();
  server.close(() => {
    console.log('HTTP server closed');
  });
});

export default app;
