import { applyCorsHeaders, parseCorsOrigins } from './cors-headers';

function res(): { setHeader: jest.Mock; append: jest.Mock; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: jest.fn((key: string, value: string) => {
      headers[key] = value;
    }),
    append: jest.fn((key: string, value: string) => {
      headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
    }),
  };
}

describe('cors-headers', () => {
  it('parseCorsOrigins splits, trims, and drops empties', () => {
    expect(parseCorsOrigins('http://a:3000, http://b:3000 ,,')).toEqual([
      'http://a:3000',
      'http://b:3000',
    ]);
    expect(parseCorsOrigins(undefined)).toEqual(['http://localhost:3000']);
  });

  it('sets headers for an allowlisted origin', () => {
    const out = res();
    applyCorsHeaders(
      { headers: { origin: 'http://localhost:3000' } } as never,
      out as never,
      ['http://localhost:3000'],
    );
    expect(out.headers['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
    expect(out.headers['Access-Control-Allow-Credentials']).toBe('true');
    expect(out.headers['Vary']).toBe('Origin');
    expect(out.headers['Access-Control-Expose-Headers']).toBe(
      'Content-Length, Content-Range, Accept-Ranges',
    );
  });

  it('sets nothing for a foreign origin', () => {
    const out = res();
    applyCorsHeaders(
      { headers: { origin: 'http://evil.com' } } as never,
      out as never,
      ['http://localhost:3000'],
    );
    expect(out.setHeader).not.toHaveBeenCalled();
  });

  it('sets nothing without an Origin header', () => {
    const out = res();
    applyCorsHeaders({ headers: {} } as never, out as never, ['http://localhost:3000']);
    expect(out.setHeader).not.toHaveBeenCalled();
  });
});
