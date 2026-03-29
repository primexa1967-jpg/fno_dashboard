/**
 * Scanner API Routes  (replaces Camarilla)
 */

import { Router, Request, Response } from 'express';
import { scannerEngine } from '../services/scannerEngine';

const router = Router();

/**
 * GET /scanner/all
 * Run trade discovery scanner across all indices
 */
router.get('/all', async (req: Request, res: Response) => {
  try {
    console.log(`🔍 Running trade scanner for all indices`);
    const results = await scannerEngine.scanAll();
    res.json({ success: true, data: results });
  } catch (error) {
    console.error('Scanner error:', error);
    res.status(500).json({ success: false, error: 'Failed to run scanner' });
  }
});

/**
 * GET /scanner/:symbol
 * Run scanner for a single index
 */
router.get('/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const sym = String(symbol).toUpperCase();
    console.log(`🔍 Running trade scanner for ${sym}`);
    const result = await scannerEngine.scanIndex(sym);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Scanner error:', error);
    res.status(500).json({ success: false, error: 'Failed to run scanner' });
  }
});

export default router;
