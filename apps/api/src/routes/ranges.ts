/**
 * Market Range API Routes
 */

import { Router, Request, Response } from 'express';
import { marketRangeService } from '../services/marketRangeService';

const router = Router();

/**
 * GET /ranges/all
 * Get range data for all supported indices
 */
router.get('/all', async (req: Request, res: Response) => {
  try {
    console.log(`📊 Fetching range data for all indices`);

    const rangeData = await marketRangeService.getAllIndicesRangeData();

    res.json({
      success: true,
      data: rangeData,
    });
  } catch (error) {
    console.error('Error fetching all indices range data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch range data',
    });
  }
});

/**
 * GET /ranges/:symbol
 * Get range data for a specific index
 * Params:
 *   - symbol: NIFTY, BANKNIFTY, etc.
 */
router.get('/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const symbolStr = String(symbol).toUpperCase();

    console.log(`📊 Fetching range data for ${symbolStr}`);

    const rangeData = await marketRangeService.getIndexRangeData(symbolStr);

    res.json({
      success: true,
      data: rangeData,
    });
  } catch (error) {
    console.error('Error fetching index range data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch range data',
    });
  }
});

export default router;
