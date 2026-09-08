// Names and slugs are the bot's main trust boundary with the outside world:
// the slug comes from the model (which has just read an untrusted document) and
// the upload name comes from whoever sent the file. These tests pin the shapes
// that must never come back out.

const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');

const { expandPath, sanitizeSlug, safeUploadName, stamp } = require('../lib/text');

test('sanitizeSlug reduces to [a-z0-9-]', () => {
  assert.equal(sanitizeSlug('Dental Insurance 2025'), 'dental-insurance-2025');
  assert.equal(sanitizeSlug('  spaced  out  '), 'spaced-out');
  assert.equal(sanitizeSlug('CAPS'), 'caps');
});

test('sanitizeSlug strips everything that could steer a path or a shell', () => {
  for (const hostile of [
    '../../etc/passwd',
    '..\\..\\windows\\system32',
    'a/b/c',
    'rm -rf ~; echo',
    '$(whoami)',
    '`id`',
    'file\u0000name',
    'note\nNOTE_TO_IMPORT: other',
  ]) {
    assert.match(sanitizeSlug(hostile), /^[a-z0-9-]*$/, `leaked from: ${hostile}`);
    assert.doesNotMatch(sanitizeSlug(hostile), /^-|-$/);
  }
});

test('sanitizeSlug is bounded and never ends in a hyphen', () => {
  const long = sanitizeSlug('x'.repeat(200));
  assert.equal(long.length, 40);
  // A cut that lands mid-separator must not leave a trailing hyphen behind.
  assert.equal(sanitizeSlug(`${'a'.repeat(39)}-${'b'.repeat(20)}`).endsWith('-'), false);
});

test('sanitizeSlug survives empty and non-string input', () => {
  for (const empty of ['', null, undefined, '---', '???', {}, 0]) {
    assert.equal(typeof sanitizeSlug(empty), 'string');
  }
  assert.equal(sanitizeSlug(null), '');
  assert.equal(sanitizeSlug('!!!'), '');
});

test('safeUploadName rebuilds the name rather than trusting it', () => {
  assert.equal(safeUploadName('Scan 001.PDF', '.bin'), 'upload-scan-001.pdf');
  assert.equal(safeUploadName('receipt.jpg', '.bin'), 'upload-receipt.jpg');
});

test('safeUploadName cannot produce a file Claude Code reads as instructions', () => {
  // The whole reason the name is rebuilt: a nested CLAUDE.md in the wiki would
  // be read as *instructions*, promoting hostile document text into the prompt.
  assert.equal(safeUploadName('CLAUDE.md', '.bin'), 'upload-claude.md');
  assert.equal(safeUploadName('.claude/settings.json', '.bin'), 'upload-settings.json');
  // A dotfile has no extension to keep, so it lands as an ordinary upload-*.
  assert.equal(safeUploadName('.env', '.bin'), 'upload-env.bin');
  assert.equal(safeUploadName('.gitignore', '.bin'), 'upload-gitignore.bin');
});

test('safeUploadName confines the result to import/', () => {
  for (const hostile of [
    '../../.claude/settings.json',
    '..\\..\\CLAUDE.md',
    '/etc/passwd',
    'C:\\Windows\\System32\\drivers\\etc\\hosts',
    'a/b/../../../escape.txt',
  ]) {
    const out = safeUploadName(hostile, '.bin');
    if (out === null) continue;
    assert.match(out, /^upload-[a-z0-9-]+\.[a-z0-9]+$/, `bad name from: ${hostile}`);
    assert.equal(path.basename(out), out);
  }
});

test('safeUploadName only keeps a plain extension', () => {
  assert.equal(safeUploadName('report.pdf', '.bin'), 'upload-report.pdf');
  // A long or exotic "extension" is not carried to disk; the caller's fallback
  // is used instead.
  assert.equal(safeUploadName('report.verylongextension', '.bin'), 'upload-report.bin');
  assert.equal(safeUploadName('report.p df', '.bin'), 'upload-report.bin');
});

test('safeUploadName rejects a name with no usable stem', () => {
  assert.equal(safeUploadName('', '.bin'), null);
  assert.equal(safeUploadName(null, '.bin'), null);
  assert.equal(safeUploadName('???.pdf', '.bin'), null);
});

test('expandPath handles the shapes people actually type', () => {
  assert.equal(expandPath('~'), path.resolve(os.homedir()));
  assert.equal(expandPath('~/wiki'), path.resolve(path.join(os.homedir(), 'wiki')));
  assert.equal(expandPath('  "~/wiki"  '), path.resolve(path.join(os.homedir(), 'wiki')));
  assert.equal(path.isAbsolute(expandPath('relative/wiki')), true);
  assert.equal(expandPath(''), '');
});

test('stamp sorts lexicographically and is zero padded', () => {
  const s = stamp(new Date(2025, 0, 2, 3, 4));
  assert.equal(s.file, '2025-01-02-0304');
  assert.equal(s.human, '2025-01-02 03:04');
  assert.ok(stamp(new Date(2025, 0, 2, 3, 4)).file < stamp(new Date(2025, 10, 2, 3, 4)).file);
});
