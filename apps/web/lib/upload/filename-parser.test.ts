import { describe, expect, it } from 'vitest';
import { parseFilename } from './filename-parser';

describe('parseFilename', () => {
  it('parses a valid filename', () => {
    expect(parseFilename('6200000000.pdf')).toEqual({
      ok: true,
      serial: '6200000000',
      typePrefix: '62',
      counter: 0,
    });
  });

  it('rejects 9 digits', () => {
    expect(parseFilename('620000000.pdf')).toEqual({ ok: false, code: 'INVALID_LENGTH' });
  });

  it('rejects 11 digits', () => {
    expect(parseFilename('62000000000.pdf')).toEqual({ ok: false, code: 'INVALID_LENGTH' });
  });

  it('rejects non-digit characters', () => {
    expect(parseFilename('62a0000000.pdf')).toEqual({ ok: false, code: 'NON_DIGIT' });
  });

  it('rejects a disallowed prefix', () => {
    expect(parseFilename('9900000000.pdf')).toEqual({ ok: false, code: 'BAD_PREFIX' });
  });

  it('rejects a missing extension', () => {
    expect(parseFilename('6200000000')).toEqual({ ok: false, code: 'NO_PDF' });
  });

  it('accepts uppercase .PDF', () => {
    expect(parseFilename('6399999999.PDF').ok).toBe(true);
  });

  it('rejects a wrong extension', () => {
    expect(parseFilename('6200000000.png')).toEqual({ ok: false, code: 'BAD_EXT' });
  });
});
