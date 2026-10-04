import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Rate-limit key: authenticated user id, falling back to client IP. */
@Injectable()
export class BulkUploadThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { id?: unknown } | undefined;
    if (user && typeof user.id === 'string') {
      return `user:${user.id}`;
    }
    return `ip:${String(req.ip)}`;
  }
}
