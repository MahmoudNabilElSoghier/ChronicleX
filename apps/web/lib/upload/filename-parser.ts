export type ParseErrorCode = 'INVALID_LENGTH' | 'NON_DIGIT' | 'BAD_PREFIX' | 'NO_PDF' | 'BAD_EXT';

export type ParseResult =
  | { ok: true; serial: string; typePrefix: string; counter: number }
  | { ok: false; code: ParseErrorCode };

export const ALLOWED_PREFIXES = ['62', '63', '67'];

/** Client mirror of the backend serial rules (apps/api serial.utils.ts). */
export function parseFilename(name: string): ParseResult {
  const dot = name.lastIndexOf('.');
  if (dot < 0) {
    return { ok: false, code: 'NO_PDF' };
  }
  const ext = name.slice(dot + 1);
  if (ext.toLowerCase() !== 'pdf') {
    return { ok: false, code: 'BAD_EXT' };
  }
  const base = name.slice(0, dot);
  if (base.length !== 10) {
    return { ok: false, code: 'INVALID_LENGTH' };
  }
  if (!/^\d+$/.test(base)) {
    return { ok: false, code: 'NON_DIGIT' };
  }
  const typePrefix = base.slice(0, 2);
  if (!ALLOWED_PREFIXES.includes(typePrefix)) {
    return { ok: false, code: 'BAD_PREFIX' };
  }
  return { ok: true, serial: base, typePrefix, counter: Number(base.slice(2)) };
}
