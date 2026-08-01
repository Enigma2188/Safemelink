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

const source = fs.readFileSync(indexPath, 'utf8');
const callback = source.match(
  /const completeSOS = useCallback\(async \(\) => \{[\s\S]*?\r?\n\s*\},\s*\[([^\]]*)\]\);/,
);

if (!callback) {
  fail('completeSOS callback not found.');
}

const dependencies = callback[1]
  .split(',')
  .map((dependency) => dependency.trim())
  .filter(Boolean);

if (dependencies.includes('contacts') || !dependencies.includes('userId')) {
  fail('completeSOS dependency array is not the expected one.');
}

for (const expectedSnippet of [
  '<Text style={styles.sectionTitle}>Parola d’ordine</Text>',
  '{`Salvata: “${savedPassphrase.text}”`}',
  '{`Riconosciuto: “${lastRecognizedPassphraseText}”`}',
  '{`Da salvare: “${passphraseDraft}”`}',
  '<Text style={styles.drawerItemText}>Parola d’ordine</Text>',
]) {
  if (!source.includes(expectedSnippet)) {
    fail('Expected JSX correction not found.');
  }
}

for (const obsoleteSnippet of [
  "<Text style={styles.sectionTitle}>Parola d'ordine</Text>",
  'Salvata: "{savedPassphrase.text}"',
  'Riconosciuto: "{lastRecognizedPassphraseText}"',
  'Da salvare: "{passphraseDraft}"',
  "<Text style={styles.drawerItemText}>Parola d'ordine</Text>",
]) {
  if (source.includes(obsoleteSnippet)) {
    fail('Obsolete JSX form detected.');
  }
}

const fingerprint = crypto.createHash('sha256').update(source).digest('hex');
process.stdout.write(
  `Selected SafeMeLink candidate index.tsx verified (sha256: ${fingerprint}).\n`,
);
