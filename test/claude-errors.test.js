// A failed run is reported to the chat as one of a few fixed lines. These pin
// that the common causes are recognised, and that nothing from the run itself
// is ever echoed back.

const test = require('node:test');
const assert = require('node:assert');

const { diagnoseClaudeFailure } = require('../lib/claude-errors');

const errorResult = (result) => JSON.stringify({ type: 'result', is_error: true, result });

test('recognises a missing or expired login', () => {
  for (const [stdout, stderr] of [
    [errorResult('Invalid API key · Please run /login'), ''],
    [errorResult('Not logged in · Please run /login'), ''],
    ['', 'OAuth token has expired. Please obtain a new token or refresh your existing token.'],
    ['', 'API Error: 401 {"type":"error","error":{"type":"authentication_error"}}'],
  ]) {
    assert.match(diagnoseClaudeFailure(stdout, stderr), /login/, `missed: ${stdout || stderr}`);
  }
});

test('recognises usage limits, credit and API outages', () => {
  assert.match(diagnoseClaudeFailure(errorResult('Claude AI usage limit reached|1759000000'), ''), /usage limit/);
  assert.match(diagnoseClaudeFailure('', 'Credit balance is too low'), /out of credit/);
  assert.match(diagnoseClaudeFailure('', 'API Error: 529 {"type":"overloaded_error"}'), /reach Claude/);
});

test('returns null for anything unrecognised', () => {
  assert.equal(diagnoseClaudeFailure('', 'segfault'), null);
  assert.equal(diagnoseClaudeFailure('', ''), null);
});

test('does not scan stdout that is ordinary content', () => {
  // A wiki page quoting the login hint must not be mistaken for the failure.
  assert.equal(diagnoseClaudeFailure('see notes: please run /login to fix', ''), null);
  assert.equal(
    diagnoseClaudeFailure(JSON.stringify({ is_error: false, result: 'Please run /login' }), ''),
    null
  );
});

test('never echoes the run output', () => {
  const secret = '/home/someone/HomeWiki/medical/secret.md';
  const msg = diagnoseClaudeFailure(errorResult(`Invalid API key at ${secret}`), secret);
  assert.ok(!msg.includes(secret));
});
