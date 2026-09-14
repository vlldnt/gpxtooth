/* ════════════════════════════════════════════════
   GPXtooth — server/hash-password.js
   Génère ADMIN_PASSWORD_HASH et SESSION_SECRET
   pour le fichier .env :  node server/hash-password.js
   ════════════════════════════════════════════════ */

'use strict';

const crypto = require('node:crypto');
const readline = require('node:readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: Boolean(process.stdin.isTTY),
});

if (process.stdin.isTTY) {
  process.stdout.write('Mot de passe : ');
  rl._writeToOutput = () => {}; // masque la saisie
}

rl.question('', (password) => {
  rl.close();
  process.stdout.write('\n');

  if (password.length < 12) {
    console.error('Mot de passe trop court (12 caractères minimum)');
    process.exit(1);
  }

  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);

  console.log(`ADMIN_PASSWORD_HASH=${salt.toString('hex')}:${hash.toString('hex')}`);
  console.log(`SESSION_SECRET=${crypto.randomBytes(48).toString('base64url')}`);
});
