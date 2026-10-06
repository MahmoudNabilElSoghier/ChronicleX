import type { Request, Response } from 'express';

/**
 * Explicit CORS headers for responses that bypass NestJS's pipeline
 * (manual `@Res()` streaming). The global cors middleware normally covers
 * every route, but a streamed pipe can commit the response through paths
 * where middleware-set headers don't survive — so streaming handlers set
 * them directly. Same allowlist rule as main.ts: exact origin match only,
 * never '*', plus credentials.
 */
export function parseCorsOrigins(raw: string | undefined): string[] {
  return (raw ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

export function applyCorsHeaders(
  req: Request,
  res: Response,
  allowedOrigins: string[],
): void {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    // Append (not set): compression/ETag middleware may already own Vary.
    res.append('Vary', 'Origin');
    // Parity with main.ts: JS reading these headers must not be surprised.
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Length, Content-Range, Accept-Ranges',
    );
  }
}
