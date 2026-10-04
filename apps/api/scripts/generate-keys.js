// RS256 key generation via Node crypto (no openssl binary required).
// Run: pnpm --filter @chroniclex/api keys:generate
const { generateKeyPairSync, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const keysDir = path.join(__dirname, '..', 'keys');
fs.mkdirSync(keysDir, { recursive: true });

const privatePath = path.join(keysDir, 'jwt-private.pem');
const publicPath = path.join(keysDir, 'jwt-public.pem');

if (fs.existsSync(privatePath) && fs.existsSync(publicPath)) {
  console.log('keys already exist, skipping (delete to regenerate)');
  process.exit(0);
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

fs.writeFileSync(privatePath, privateKey, { mode: 0o600 });
fs.writeFileSync(publicPath, publicKey);
console.log(`wrote ${privatePath}`);
console.log(`wrote ${publicPath}`);
console.log(`fingerprint: ${randomBytes(4).toString('hex')}`);
