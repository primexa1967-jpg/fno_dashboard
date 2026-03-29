/**
 * Volatility Pressure Bar API Routes
 */

import { Router, Request, Response } from 'express';
import { volatilityBarService } from '../services/volatilityBarService';

const router = Router();

/**
 * GET /volatility/pressure
 * Get volatility pressure bar data for a symbol
 * Query params:
 *   - symbol: NIFTY, BANKNIFTY, etc.
 *   - expiry: expiry date (optional)
 */
router.get('/pressure', async (req: Request, res: Response) => {
  try {
    const { symbol = 'NIFTY', expiry } = req.query;
    const symbolStr = String(symbol).toUpperCase();
    const expiryStr = expiry ? String(expiry) : undefined;

    console.log(`📊 Fetching volatility pressure for ${symbolStr}`);

    const pressureData = await volatilityBarService.calculateVolatilityPressure(
      symbolStr,
      expiryStr
    );

    res.json({
      success: true,
      symbol: symbolStr,
      data: pressureData,
    });
  } catch (error) {
    console.error('Error fetching volatility pressure:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate volatility pressure',
    });
  }
});

export default router;
