import { BadRequestException } from '@nestjs/common';

export const ALLOWED_PREFIXES = ['62', '63', '67'];

export interface ParsedSerial {
  serial: string;
  typePrefix: string;
  counter: number;
}

export class InvalidSerialException extends BadRequestException {
  constructor(message: string) {
    super({ code: 'INVALID_SERIAL', message });
  }
}

export function parseSerialFromFilename(filename: string): ParsedSerial {
  const base = filename.replace(/\.pdf$/i, '');
  if (base === filename) {
    throw new InvalidSerialException('filename must end with .pdf');
  }
  if (base.length !== 10) {
    throw new InvalidSerialException('filename must be exactly 10 digits (before .pdf)');
  }
  if (!/^\d+$/.test(base)) {
    throw new InvalidSerialException('filename contains non-digit characters');
  }
  const typePrefix = base.slice(0, 2);
  if (!ALLOWED_PREFIXES.includes(typePrefix)) {
    throw new InvalidSerialException(
      `type prefix '${typePrefix}' is not in the allowed list: ${ALLOWED_PREFIXES.join(', ')}`,
    );
  }
  return { serial: base, typePrefix, counter: Number(base.slice(2)) };
}

export function validatePdfMagicBytes(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === '%PDF';
}
