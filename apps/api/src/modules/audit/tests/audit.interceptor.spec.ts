import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { AuditInterceptor } from '../audit.interceptor';

async function run(
  interceptor: AuditInterceptor,
  ctx: ExecutionContext,
  handle: { handle: () => import('rxjs').Observable<unknown> },
): Promise<unknown> {
  return lastValueFrom(await interceptor.intercept(ctx, handle as never));
}
import { AuditService } from '../audit.service';
import { ResourceLoaderService } from '../resource-loader.service';

function ctxWith(req: Record<string, unknown>, _spec?: unknown): ExecutionContext {
  return {
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
}

function withSpec(spec: unknown): Reflector {
  return {
    getAllAndOverride: jest.fn().mockReturnValue(spec),
  } as unknown as Reflector;
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('AuditInterceptor', () => {
  const audit = { write: jest.fn().mockResolvedValue(undefined) };
  const loader = { load: jest.fn() };

  function interceptorFor(spec: unknown): AuditInterceptor {
    return new AuditInterceptor(
      withSpec(spec),
      audit as unknown as AuditService,
      loader as unknown as ResourceLoaderService,
    );
  }

  const baseReq = (params: Record<string, unknown> = {}): Record<string, unknown> => ({
    params,
    headers: { 'user-agent': 'ua' },
    ip: '1.2.3.4',
    user: { id: 'u1' },
  });

  beforeEach(() => jest.clearAllMocks());

  it('no metadata passes through without a DB write', async () => {
    const res = await run(interceptorFor(undefined), ctxWith(baseReq(), undefined), {
      handle: () => of({ ok: true }),
    } as never);
    expect(res).toEqual({ ok: true });
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('CREATE reads resourceId from the response, oldValues=null', async () => {
    const res = await run(interceptorFor({ action: 'CREATE', resource: 'ENTRY', idParam: null }), 
      ctxWith(baseReq(), undefined),
      { handle: () => of({ id: 'e9', serial: '62' }) } as never,
    );
    expect(res).toEqual({ id: 'e9', serial: '62' });
    await flush();
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        resource: 'ENTRY',
        resourceId: 'e9',
        oldValues: null,
        newValues: { id: 'e9', serial: '62' },
        userId: 'u1',
      }),
    );
    expect(loader.load).not.toHaveBeenCalled();
  });

  it('UPDATE loads old before the handler and captures the response as new', async () => {
    loader.load.mockResolvedValue({ id: 'e1', year: 2025 });
    const res = await run(interceptorFor({ action: 'UPDATE', resource: 'ENTRY' }), 
      ctxWith(baseReq({ id: 'e1' }), undefined),
      { handle: () => of({ id: 'e1', year: 2026 }) } as never,
    );
    expect(res).toEqual({ id: 'e1', year: 2026 });
    await flush();
    expect(loader.load).toHaveBeenCalledWith('ENTRY', 'e1');
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        oldValues: { id: 'e1', year: 2025 },
        newValues: { id: 'e1', year: 2026 },
        resourceId: 'e1',
      }),
    );
  });

  it('DELETE loads old and leaves newValues null', async () => {
    loader.load.mockResolvedValue({ id: 'e1' });
    await run(interceptorFor({ action: 'DELETE', resource: 'ENTRY' }), 
      ctxWith(baseReq({ id: 'e1' }), undefined),
      { handle: () => of({ id: 'e1' }) } as never,
    );
    await flush();
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ oldValues: { id: 'e1' }, newValues: null }),
    );
  });

  it('RESTORE loads old and captures the response', async () => {
    loader.load.mockResolvedValue({ id: 'e1', deletedAt: 'x' });
    await run(interceptorFor({ action: 'RESTORE', resource: 'ENTRY' }), 
      ctxWith(baseReq({ id: 'e1' }), undefined),
      { handle: () => of({ id: 'e1', deletedAt: null }) } as never,
    );
    await flush();
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        oldValues: { id: 'e1', deletedAt: 'x' },
        newValues: { id: 'e1', deletedAt: null },
      }),
    );
  });

  it('handler errors produce no audit row and propagate', async () => {
    const err = new Error('boom');
    await expect(
      run(
        interceptorFor({ action: 'UPDATE', resource: 'ENTRY' }),
        ctxWith(baseReq({ id: 'e1' }), undefined),
        { handle: () => throwError(() => err) } as never,
      ),
    ).rejects.toBe(err);
    await flush();
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('audit write failure does not break the response', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    audit.write.mockRejectedValue(new Error('audit down'));
    const res = await run(interceptorFor({ action: 'CREATE', resource: 'ENTRY', idParam: null }), 
      ctxWith(baseReq(), undefined),
      { handle: () => of({ id: 'e1' }) } as never,
    );
    expect(res).toEqual({ id: 'e1' });
    await flush();
    errSpy.mockRestore();
  });

  it('redaction applies to old and new images', async () => {
    loader.load.mockResolvedValue({ id: 'u9', passwordHash: 'h', email: 'a@b.c' });
    await run(interceptorFor({ action: 'UPDATE', resource: 'USER' }), 
      ctxWith(baseReq({ id: 'u9' }), undefined),
      { handle: () => of({ id: 'u9', token: 't' }) } as never,
    );
    await flush();
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        oldValues: { id: 'u9', passwordHash: '[REDACTED]', email: 'a@b.c' },
        newValues: { id: 'u9', token: '[REDACTED]' },
      }),
    );
  });
});
