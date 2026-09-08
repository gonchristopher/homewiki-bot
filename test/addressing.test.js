// Group addressing is a cost control, not a nicety: every text message the bot
// acts on is a billed Claude run, so answering ordinary group chatter would
// spend money per line. These tests pin both halves -- what must be answered,
// and what must be left alone.

const test = require('node:test');
const assert = require('node:assert');

const { groupAddressing, mentionsBot, stripBotMention } = require('../lib/text');

const ME = { username: 'homewikibot', botId: 4242 };

test('plain group chatter is not addressed to the bot', () => {
  for (const text of [
    'did you see the letter from the insurer',
    'homewikibot without an at-sign',
    '',
  ]) {
    assert.equal(groupAddressing({ text }, ME), null, `answered: ${text}`);
  }
});

test('a slash command, an @mention or a reply to the bot is addressed to it', () => {
  assert.deepEqual(groupAddressing({ text: '/ask where is the deed' }, ME), {
    text: '/ask where is the deed',
  });
  assert.deepEqual(groupAddressing({ text: '@homewikibot where is the deed' }, ME), {
    text: 'where is the deed',
  });
  assert.deepEqual(
    groupAddressing({ text: 'where is the deed', reply_to_message: { from: { id: 4242 } } }, ME),
    { text: 'where is the deed' }
  );
});

test('a command aimed at another bot is left alone', () => {
  assert.equal(groupAddressing({ text: '/ask@otherbot what is up' }, ME), null);
  assert.deepEqual(groupAddressing({ text: '/ask@homewikibot what is up' }, ME), {
    text: '/ask what is up',
  });
  // Telegram lower-cases nothing for us; matching must not be case sensitive.
  assert.deepEqual(groupAddressing({ text: '/ask@HomeWikiBot hi' }, ME), { text: '/ask hi' });
});

test('a reply to somebody else is not a reply to the bot', () => {
  assert.equal(
    groupAddressing({ text: 'thanks', reply_to_message: { from: { id: 9999 } } }, ME),
    null
  );
  assert.equal(groupAddressing({ text: 'thanks', reply_to_message: {} }, ME), null);
});

test('a caption counts as the body when there is no text', () => {
  assert.deepEqual(groupAddressing({ caption: '@homewikibot file this' }, ME), {
    text: 'file this',
  });
  assert.equal(groupAddressing({ caption: 'a photo of the boiler' }, ME), null);
});

test('the mention is addressing, not content, and never reaches the prompt', () => {
  assert.equal(stripBotMention('@homewikibot  where is the deed', ME.username), 'where is the deed');
  assert.equal(stripBotMention('ask @homewikibot please', ME.username), 'ask please');
  // Multi-line notes stay multi-line: only horizontal gaps are collapsed.
  assert.equal(stripBotMention('@homewikibot line one\nline two', ME.username), 'line one\nline two');
});

test('mentionsBot is not left sticky by the global regex', () => {
  // A `g` regex carries lastIndex between calls; a fresh one per call is what
  // keeps the second identical message from being ignored.
  assert.equal(mentionsBot('@homewikibot hi', ME.username), true);
  assert.equal(mentionsBot('@homewikibot hi', ME.username), true);
});

test('without a known username, only commands and replies address the bot', () => {
  const anon = { username: '', botId: 4242 };
  assert.equal(groupAddressing({ text: '@homewikibot hi' }, anon), null);
  assert.deepEqual(groupAddressing({ text: '/ask hi' }, anon), { text: '/ask hi' });
  assert.deepEqual(groupAddressing({ text: 'hi', reply_to_message: { from: { id: 4242 } } }, anon), {
    text: 'hi',
  });
});
