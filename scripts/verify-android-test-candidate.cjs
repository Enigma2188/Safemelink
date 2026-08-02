const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// eslint-disable-next-line no-undef
const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'app', '(tabs)', 'index.tsx');
const wrongVersionMessage =
  'Selected index.tsx candidate is invalid.';

const fail = (detail) => {
  throw new Error(`${wrongVersionMessage} ${detail}`);
};

if (!fs.existsSync(indexPath)) {
  fail('File not found.');
}

if (!fs.statSync(indexPath).isFile()) {
  fail('Expected a regular file.');
}

const source = fs.readFileSync(indexPath, 'utf8');

if (!source.trim()) {
  fail('File is empty.');
}

if (/^(<{7}|={7}|>{7})(?:\s|$)/m.test(source)) {
  fail('Unresolved Git conflict marker detected.');
}

if (source.includes('\0')) {
  fail('Unexpected null byte detected.');
}

const fingerprint = crypto.createHash('sha256').update(source).digest('hex');
process.stdout.write(
  `Selected SafeMeLink candidate index.tsx verified (sha256: ${fingerprint}).\n`,
);
