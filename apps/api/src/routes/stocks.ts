/**
 * Stock Option Dashboard API Routes
 */

import { Router, Request, Response } from 'express';
import { stockDashboardService } from '../services/stockDashboardEngine';

const router = Router();

/**
 * GET /stocks/dashboard
 * Full stock option dashboard data
 */
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    console.log(`📈 Fetching stock option dashboard`);
    const data = await stockDashboardService.getDashboard();
    res.json({ success: true, data });
  } catch (error) {
    console.error('Stock dashboard error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch stock dashboard' });
  }
});

export default router;
