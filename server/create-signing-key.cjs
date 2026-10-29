'use strict';
// Creates files only in a chosen private directory. Never prints private key material.
const { generateKeyPairSync } = require('node:crypto'),
  fs = require('node:fs'),
  path = require('node:path');
const dir = path.resolve(process.argv[2] || 'server/data'),
  privateFile = path.join(dir, 'entitlement-signing-private.pem'),
  publicFile = path.join(dir, 'entitlement-public.jwk.json');
if (fs.existsSync(privateFile) || fs.existsSync(publicFile))
  throw Error('Key files already exist. Refusing to replace them.');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
fs.writeFileSync(
  privateFile,
  keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  { flag: 'wx', mode: 0o600 }
);
fs.writeFileSync(
  publicFile,
  JSON.stringify(keys.publicKey.export({ format: 'jwk' }), null, 2) + '\n',
  { flag: 'wx', mode: 0o600 }
);
console.log(
  'Signing files created in ' +
    dir +
    '. Put the private PEM directly in the service secret store; use only the public JWK in the app config.'
);
