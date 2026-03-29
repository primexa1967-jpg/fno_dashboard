# Interval-Based Option Chain Implementation Summary

## Overview
Successfully implemented interval-based calculations for option chain data, allowing traders to view Volume, OI Change, and OI Change% over different time intervals (1m, 5m, 15m, 30m, 1h, 4h, 1D).

## Components Created

### 1. Option Snapshot Service (`apps/api/src/services/optionSnapshotService.ts`)
- **Purpose**: Store and retrieve option chain snapshots for interval-based calculations
- **Key Methods**:
  - `storeSnapshot()`: Stores current option chain data in Redis
  - `getSnapshot()`: Retrieves snapshot from a specific time ago
  - `calculateIntervalChanges()`: Calculates interval-based Volume, OI Chg, and OI Chg%
- **Storage**: Redis lists with 24-hour TTL
- **Max Snapshots**: 1440 (one per minute for 24 hours)

### 2. Background Snapshot Job (`apps/api/src/jobs/snapshotJob.ts`)
- **Purpose**: Automatically store snapshots every minute during market hours
- **Tracked Symbols**: NIFTY, BANKNIFTY, FINNIFTY
- **Market Hours**: 9:15 AM - 3:30 PM IST, Monday-Friday
- **Features**:
  - Automatic snapshot storage every 60 seconds
  - Graceful error handling
  - Market hours detection

### 3. API Updates

#### Updated Route (`apps/api/src/routes/market.ts`)
- Added `interval` query parameter to `/market/option-chain/:symbol/:expiry`
- Validates interval (1m, 3m, 5m, 15m, 30m, 1h, 4h, 1D)
- Passes interval to service layer

#### Updated Service (`apps/api/src/services/optionChain.ts`)
- Enhanced `getOptionChain()` to support interval parameter
- Stores snapshot on every fetch
- Applies interval-based calculations when interval != '1D'
- Falls back gracefully if snapshot service unavailable

### 4. Frontend Updates

#### Updated Hook (`apps/web/src/hooks/useOptionChain.ts`)
- Added `interval` parameter to `useOptionChain()`
- Updated React Query cache key to include interval
- Sends interval as query parameter to API

#### Updated Components

**DashboardPage.tsx**:
- Added `selectedInterval` state
- Passes interval to `useOptionChain` hook
- Lifts interval state from DynamicNumbersBar

**DynamicNumbersBar.tsx**:
- Accepts `selectedInterval` and `onIntervalChange` props
- Notifies parent when interval changes via dropdown
- Syncs interval state with parent

**OptionChainTable.tsx**:
- Accepts `interval` prop
- Passes interval to `useOptionChain` hook
- Updates based on interval changes

### 5. Server Integration (`apps/api/src/index.ts`)
- Starts snapshot job on server startup
- Graceful shutdown on SIGTERM
- Logs snapshot job status

## How It Works

### Data Flow

1. **Snapshot Storage** (Every 60 seconds during market hours):
   ```
   Background Job → Dhan API → optionSnapshotService.storeSnapshot() → Redis
   ```

2. **Interval-Based Fetch** (When interval != '1D'):
   ```
   Frontend (interval change) → 
   useOptionChain(symbol, expiry, interval) → 
   API /option-chain?interval=5m → 
   getOptionChain(index, expiry, interval) → 
   calculateIntervalChanges() → 
   Redis (retrieve old snapshot) → 
   Calculate deltas → 
   Return enriched data
   ```

### Interval Calculation Logic

For each strike's CE and PE:
- **Volume**: `currentVolume - snapshotVolume`
- **OI Change**: `currentOI - snapshotOI`
- **OI Change %**: `((currentOI - snapshotOI) / snapshotOI) * 100`

### Time Mapping
- `1m` → 1 minute ago
- `3m` → 3 minutes ago
- `5m` → 5 minutes ago
- `15m` → 15 minutes ago
- `30m` → 30 minutes ago
- `1h` → 60 minutes ago
- `4h` → 240 minutes ago
- `1D` → No snapshot (uses Dhan API's daily data)

## Example Usage

### API Request
```http
GET /market/option-chain/NIFTY/2024-12-26?interval=5m
Authorization: Bearer <token>
```

### Response
Returns option chain with Volume, OI Chg, and OI Chg% calculated over the last 5 minutes.

### Frontend Usage
```tsx
// User selects "5m" from dropdown in DynamicNumbersBar
// DashboardPage updates selectedInterval state
// OptionChainTable receives new interval prop
// useOptionChain hook refetches with new interval
// Table displays 5-minute interval data
```

## Benefits

1. **Professional-Grade Analysis**: Traders can see market activity over specific timeframes
2. **Real-Time Insights**: Spot unusual activity in specific time windows
3. **Flexible Timeframes**: Switch between 1m, 5m, 15m, 1h, 4h, 1D instantly
4. **No API Overhead**: Uses cached snapshots, doesn't hit Dhan API repeatedly
5. **Scalable**: Redis-based storage can handle multiple symbols and expiries

## Technical Highlights

- **Multi-layer Caching**: Service cache (15s) + Redis snapshots (24h)
- **Graceful Fallback**: If snapshot unavailable, returns current data
- **Type Safety**: Full TypeScript typing throughout
- **Error Handling**: Comprehensive error logging and recovery
- **Market Hours Aware**: Only stores snapshots during trading hours
- **Memory Efficient**: Auto-expires old snapshots (24h TTL)

## Testing Recommendations

1. **Verify Snapshot Storage**:
   ```bash
   # Check Redis keys
   redis-cli KEYS "snapshot:*"
   
   # View snapshot data
   redis-cli LRANGE "snapshot:NIFTY:2024-12-26" 0 5
   ```

2. **Test Interval Changes**:
   - Select different intervals from dropdown
   - Verify Volume/OI values change
   - Check network tab for `?interval=` parameter

3. **Verify Market Hours Logic**:
   - Start server outside market hours
   - Check logs for "Market closed" message
   - Verify no API calls during closed hours

4. **Test Error Handling**:
   - Stop Redis temporarily
   - Verify graceful fallback to current data
   - Check error logs

## Future Enhancements

1. **Historical Charts**: Visualize Volume/OI trends over intervals
2. **Alerts**: Notify when interval-based OI change exceeds threshold
3. **More Symbols**: Expand to MIDCAPNIFTY, SENSEX, BANKEX
4. **Custom Intervals**: Allow user-defined intervals (e.g., 2h, 6h)
5. **Export Data**: Download interval-based data as CSV

## Dependencies

- **Redis**: Required for snapshot storage (localhost:6379)
- **ioredis**: Redis client library
- **React Query**: Frontend data fetching and caching
- **TypeScript**: Full type safety throughout

## Configuration

### Environment Variables
```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

### Constants (Configurable)
- `MAX_SNAPSHOTS`: 1440 (24 hours at 1/minute)
- `SNAPSHOT_TTL`: 86400 seconds (24 hours)
- `SERVICE_CACHE_TTL`: 15000 ms (15 seconds)
- `SNAPSHOT_JOB_INTERVAL`: 60000 ms (60 seconds)

## Completion Status

✅ Option Snapshot Service created
✅ Background job implemented
✅ API route updated with interval support
✅ Service layer enhanced
✅ Frontend hook updated
✅ Component props updated
✅ State management lifted to DashboardPage
✅ Server integration completed
✅ Error handling implemented
✅ Type safety verified

## Next Steps (Optional)

1. Test with live market data
2. Monitor Redis memory usage
3. Add performance metrics
4. Implement data visualization
5. Add unit tests for snapshot service
