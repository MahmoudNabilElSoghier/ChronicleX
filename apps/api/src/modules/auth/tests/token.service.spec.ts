import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { generateKeyPairSync } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TokenService } from '../token.service';

function makeKeys(dir: string, tag: string): { priv: string; pub: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const priv = path.join(dir, `priv-${tag}.pem`);
  const pub = path.join(dir, `pub-${tag}.pem`);
  fs.writeFileSync(priv, privateKey);
  fs.writeFileSync(pub, publicKey);
  return { priv, pub };
}

describe('TokenService', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chroniclex-keys-'));
  const keys = makeKeys(dir, 'main');
  const other = makeKeys(dir, 'other');

  const config = {
    getOrThrow: (k: string): string => {
      if (k === 'JWT_PRIVATE_KEY_PATH') return keys.priv;
      if (k === 'JWT_PUBLIC_KEY_PATH') return keys.pub;
      throw new Error(`unexpected key ${k}`);
    },
    get: (k: string): string | undefined =>
      k === 'JWT_ACCESS_TTL' ? '15m' : k === 'JWT_REFRESH_TTL' ? '7d' : undefined,
  } as unknown as ConfigService;

  const jwt = new JwtService({});
  const svc = new TokenService(config, jwt);

  it('signAccess produces a valid RS256 JWT', () => {
    const token = svc.signAccess({ sub: 'u1', email: 'a@b.c', jti: 'j1' });
    const decoded = jwt.decode(token, { complete: true }) as unknown as {
      header: { alg: string };
    };
    expect(decoded.header.alg).toBe('RS256');
    expect(svc.verify<{ sub: string }>(token).sub).toBe('u1');
  });

  it('verify rejects an HS256 token', () => {
    const hs = jwt.sign({ sub: 'u1' }, { secret: 'symmetric-secret', algorithm: 'HS256' });
    expect(() => svc.verify(hs)).toThrow();
  });

  it('verify rejects an expired token', () => {
    const token = svc.signAccess({ sub: 'u1', email: 'a@b.c', jti: 'j1' });
    const future = Math.floor(Date.now() / 1000) + 3600;
    expect(() =>
      jwt.verify(token, {
        algorithms: ['RS256'],
        publicKey: fs.readFileSync(keys.pub, 'utf8'),
        clockTimestamp: future,
      }),
    ).toThrow();
  });

  it('verify rejects a token signed with a different key', () => {
    const rogue = jwt.sign({ sub: 'u1', jti: 'j9' }, {
      privateKey: fs.readFileSync(other.priv, 'utf8'),
      algorithm: 'RS256',
      expiresIn: '15m',
    });
    expect(() => svc.verify(rogue)).toThrow();
  });
});
