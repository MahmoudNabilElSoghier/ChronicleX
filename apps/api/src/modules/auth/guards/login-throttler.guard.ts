import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Two-tier login rate limiting (throttler v5 calls getTracker(req) with the
 * request ONLY, so per-tier keys branch in generateKey(), which receives
 * the throttler name):
 * - login-account: key = ip + email (5 / 15 min)
 * - login-ip:      key = ip only    (20 / 15 min, spray protection)
 */
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const body = req.body as { email?: unknown } | undefined;
    const email = typeof body?.email === 'string' ? body.email.toLowerCase() : 'unknown';
    return `${String(req.ip)}||${email}`;
  }

  protected generateKey(context: ExecutionContext, tracker: string, throttlerName: string): string {
    const sep = tracker.lastIndexOf('||');
    const ip = sep >= 0 ? tracker.slice(0, sep) : tracker;
    if (throttlerName === 'login-ip') return `login-ip:${ip}`;
    if (throttlerName === 'login-account') return `login-account:${tracker}`;
    return super.generateKey(context, tracker, throttlerName);
  }
}
