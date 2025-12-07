import { JWTPayload } from '@option-dashboard/shared';

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

export {};
