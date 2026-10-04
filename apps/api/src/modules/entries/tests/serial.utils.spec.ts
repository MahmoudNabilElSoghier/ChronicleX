import {
  InvalidSerialException,
  parseSerialFromFilename,
  validatePdfMagicBytes,
} from '../serial.utils';

describe('serial.utils', () => {
  it('parses a valid serial with zero counter', () => {
    expect(parseSerialFromFilename('6200000000.pdf')).toEqual({
      serial: '6200000000',
      typePrefix: '62',
      counter: 0,
    });
  });

  it('accepts uppercase extension and max counter', () => {
    expect(parseSerialFromFilename('6399999999.PDF')).toEqual({
      serial: '6399999999',
      typePrefix: '63',
      counter: 99999999,
    });
  });

  it('rejects 9 digits', () => {
    expect(() => parseSerialFromFilename('620000000.pdf')).toThrow(InvalidSerialException);
    expect(() => parseSerialFromFilename('620000000.pdf')).toThrow(
      'filename must be exactly 10 digits (before .pdf)',
    );
  });

  it('rejects 11 digits', () => {
    expect(() => parseSerialFromFilename('62000000000.pdf')).toThrow(
      'filename must be exactly 10 digits (before .pdf)',
    );
  });

  it('rejects non-digit characters', () => {
    expect(() => parseSerialFromFilename('62a0000000.pdf')).toThrow(
      'filename contains non-digit characters',
    );
  });

  it('rejects a disallowed prefix', () => {
    expect(() => parseSerialFromFilename('9900000000.pdf')).toThrow(
      "type prefix '99' is not in the allowed list: 62, 63, 67",
    );
  });

  it('rejects a missing extension', () => {
    expect(() => parseSerialFromFilename('noextension')).toThrow(InvalidSerialException);
  });

  it('detects PDF magic bytes', () => {
    expect(validatePdfMagicBytes(Buffer.from('%PDF-1.7 rest'))).toBe(true);
    expect(validatePdfMagicBytes(Buffer.from('MZ fake'))).toBe(false);
    expect(validatePdfMagicBytes(Buffer.alloc(0))).toBe(false);
  });
});
