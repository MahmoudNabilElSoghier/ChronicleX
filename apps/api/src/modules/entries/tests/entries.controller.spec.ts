import { Readable, Writable } from 'node:stream';
import { ConfigService } from '@nestjs/config';
import { EntriesController } from '../entries.controller';
import { EntriesService } from '../entries.service';

/**
 * POST /entries/bundle-download routing: zip headers with the exact
 * mode/count/date filename convention, CORS first, chunked stream.
 * The controller is instantiated directly (bulk-upload.controller.spec
 * pattern); applyCorsHeaders runs for real against the fake req/res.
 */
describe('EntriesController bundle-download routing', () => {
  const entries = { export: jest.fn(), bundleDownload: jest.fn() };
  const config = { get: jest.fn() };
  const controller = new EntriesController(
    entries as unknown as EntriesService,
    config as unknown as ConfigService,
  );
  const user = { id: 'u1', email: 'a@b.c', nameAr: 'مدير', nameEn: 'Manager', isActive: true };
  const req = { headers: { origin: 'http://localhost:3000' } };

  function fakeRes(): {
    res: Writable;
    chunks: Buffer[];
    headers: Record<string, string>;
  } {
    const chunks: Buffer[] = [];
    const headers: Record<string, string> = {};
    const res = Object.assign(
      new Writable({
        write(chunk: Buffer | string, _encoding: BufferEncoding, cb: (e?: Error | null) => void) {
          chunks.push(Buffer.from(chunk));
          cb();
        },
      }),
      {
        headers,
        setHeader: (k: string, v: string | number) => {
          headers[k] = String(v);
        },
        append: (k: string, v: string) => {
          headers[k] = headers[k] !== undefined ? `${headers[k]}, ${v}` : String(v);
        },
      },
    );
    return { res, chunks, headers };
  }

  /** The pipe flushes asynchronously — wait for the bytes to land. */
  async function waitForBytes(chunks: Buffer[], needle: string): Promise<void> {
    for (let i = 0; i < 50 && !Buffer.concat(chunks).toString('utf8').includes(needle); i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  beforeEach(() => jest.clearAllMocks());

  it('mode=selected → zip headers entries-selected-{count}-{date}, CORS, chunked', async () => {
    entries.bundleDownload.mockResolvedValue({
      stream: Readable.from(['zip-bytes']),
      count: 5,
      totalBytes: 5120,
    });
    const out = fakeRes();

    await controller.bundleDownload(
      { mode: 'selected', entryIds: ['e1'] } as never,
      req as never,
      user as never,
      '1.2.3.4',
      'ua',
      out.res as never,
    );

    expect(entries.bundleDownload).toHaveBeenCalledTimes(1);
    expect(entries.export).not.toHaveBeenCalled();
    expect(out.headers['Content-Type']).toBe('application/zip');
    expect(out.headers['Content-Disposition']).toMatch(
      /^attachment; filename="entries-selected-5-\d{4}-\d{2}-\d{2}\.zip"$/,
    );
    expect(out.headers['Transfer-Encoding']).toBe('chunked');
    // CORS was applied first — before the service call, not after the pipe.
    expect(out.headers['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
    // Actor: VIEW-level identity, no display name (report header is gone).
    const actor = entries.bundleDownload.mock.calls[0][1] as Record<string, unknown>;
    expect(actor.userId).toBe('u1');
    expect(actor).not.toHaveProperty('userName');

    await waitForBytes(out.chunks, 'zip-bytes');
    expect(Buffer.concat(out.chunks).toString('utf8')).toContain('zip-bytes');
  });

  it('mode=filtered → filename carries entries-filtered-{count}-{date}', async () => {
    entries.bundleDownload.mockResolvedValue({
      stream: Readable.from(['zip-bytes']),
      count: 42,
      totalBytes: 1024,
    });
    const out = fakeRes();

    await controller.bundleDownload(
      { mode: 'filtered', filters: { year: 2025 } } as never,
      req as never,
      user as never,
      '1.2.3.4',
      'ua',
      out.res as never,
    );

    expect(out.headers['Content-Disposition']).toMatch(
      /^attachment; filename="entries-filtered-42-\d{4}-\d{2}-\d{2}\.zip"$/,
    );
    await waitForBytes(out.chunks, 'zip-bytes');
    expect(Buffer.concat(out.chunks).toString('utf8')).toContain('zip-bytes');
  });
});

/** POST /entries/export stays the pure CSV stream — PDF branching is gone. */
describe('EntriesController export (CSV)', () => {
  const entries = { export: jest.fn(), bundleDownload: jest.fn() };
  const config = { get: jest.fn() };
  const controller = new EntriesController(
    entries as unknown as EntriesService,
    config as unknown as ConfigService,
  );
  const user = { id: 'u1', email: 'a@b.c', nameAr: 'مدير', nameEn: 'Manager', isActive: true };
  const req = { headers: { origin: 'http://localhost:3000' } };

  function fakeRes(): {
    res: Writable;
    chunks: Buffer[];
    headers: Record<string, string>;
  } {
    const chunks: Buffer[] = [];
    const headers: Record<string, string> = {};
    const res = Object.assign(
      new Writable({
        write(chunk: Buffer | string, _encoding: BufferEncoding, cb: (e?: Error | null) => void) {
          chunks.push(Buffer.from(chunk));
          cb();
        },
      }),
      {
        headers,
        setHeader: (k: string, v: string | number) => {
          headers[k] = String(v);
        },
        append: (k: string, v: string) => {
          headers[k] = headers[k] !== undefined ? `${headers[k]}, ${v}` : String(v);
        },
      },
    );
    return { res, chunks, headers };
  }

  beforeEach(() => jest.clearAllMocks());

  it('streams the CSV chunked with CORS first; no bundle/pdf path touched', async () => {
    entries.export.mockResolvedValue(Readable.from(['\uFEFFcsv-bytes']));
    const out = fakeRes();

    await controller.exportEntries(
      { mode: 'selected', entryIds: ['e1'] } as never,
      req as never,
      user as never,
      '1.2.3.4',
      'ua',
      out.res as never,
    );

    expect(entries.export).toHaveBeenCalledTimes(1);
    expect(entries.bundleDownload).not.toHaveBeenCalled();
    expect(out.headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(out.headers['Transfer-Encoding']).toBe('chunked');
    expect(out.headers['Content-Disposition']).toMatch(/^attachment; filename="entries-/);
    expect(out.headers['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
    for (let i = 0; i < 50 && !Buffer.concat(out.chunks).toString('utf8').includes('csv-bytes'); i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(Buffer.concat(out.chunks).toString('utf8')).toContain('csv-bytes');
  });
});
