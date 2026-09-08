// Pure string handling, split out of bot.js so it can be tested without
// starting a bot. Everything here is a function of its arguments: no config, no
// filesystem, no Telegram. Most of it is a trust boundary -- file names, model
// output and group addressing all arrive from somewhere untrusted -- so the
// cases these functions have to get right are pinned down in test/.

const os = require('os');
const path = require('path');

// Paths in .env are written by hand on both Windows and macOS, so accept the
// shapes people actually type: `~/Documents/HomeWiki`, a relative path, or an
// absolute one with either slash direction.
function expandPath(p) {
  if (!p) return p;
  let out = p.trim().replace(/^["']|["']$/g, '');
  if (out === '~' || out.startsWith('~/') || out.startsWith('~\\')) {
    out = path.join(os.homedir(), out.slice(1));
  }
  return path.resolve(out);
}

// The slug is model output, and the model has just read attacker-influenceable
// text, so treat it as hostile: reduce to lowercase words and hyphens, drop
// everything else. A slug that survives as empty just gets left off the name.
function sanitizeSlug(slug) {
  return String(slug || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

// The sender-supplied file name is attacker-influenced -- the whole premise is
// that documents arrive from insurers, labs and contractors -- so it is treated
// as hostile, not merely as untidy.
//
// basename() alone is not enough. It stops `../../.claude/settings.json` from
// escaping import/, but it happily lets the name through unchanged, and some
// names are load bearing wherever the file lands: Claude Code reads a nested
// CLAUDE.md as *instructions* when it works in that directory. An upload named
// CLAUDE.md would therefore promote hostile document text from "content the
// model reads as data" to "text in the model's own instructions" -- a trust
// promotion the permission model was never meant to absorb.
//
// So the name is rebuilt rather than accepted: the sender's stem is reduced to
// the same lowercase-and-hyphens shape as a note slug and prefixed, which makes
// every upload a plain `upload-*` file. That drops dotfiles and CLAUDE.md by
// construction rather than by blocklist. The original name is kept as a note
// beside the file so nothing is lost.
const UPLOAD_PREFIX = 'upload-';

function safeUploadName(suggestedName, fallbackExt) {
  if (!suggestedName) return null;
  const raw = path.basename(String(suggestedName));
  // Keep the extension the sender gave (it's how the file gets opened later),
  // but only if it is a plain one -- it ends up on disk.
  const rawExt = path.extname(raw);
  const ext = /^\.[a-zA-Z0-9]{1,10}$/.test(rawExt) ? rawExt.toLowerCase() : fallbackExt;
  const stem = sanitizeSlug(path.basename(raw, rawExt));
  if (!stem) return null;
  return `${UPLOAD_PREFIX}${stem}${ext}`;
}

// Local time, in a form that sorts and that reads the same on both platforms.
function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return {
    file: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`,
    human: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`,
  };
}

// --- Group addressing ------------------------------------------------------
//
// These take the bot's own username explicitly rather than reading it from
// module state: it is only known once getMe() has resolved, and a test has no
// getMe() to wait for.

function botMentionRe(username) {
  // Usernames are [A-Za-z0-9_], so nothing here needs escaping.
  return username ? new RegExp(`@${username}\\b`, 'gi') : null;
}

function mentionsBot(text, username) {
  const re = botMentionRe(username);
  return Boolean(re && re.test(text));
}

// Strips the bot's own @mention and the `@thebot` suffix Telegram appends to
// commands. Both are addressing, not content, and leaving them in would put a
// literal "@thebot" into the prompt and into filed notes.
function stripBotMention(text, username) {
  let out = String(text || '');
  if (username) {
    out = out.replace(new RegExp(`^(/[A-Za-z0-9_]+)@${username}\\b`, 'i'), '$1');
    const re = botMentionRe(username);
    if (re) out = out.replace(re, '');
  }
  // Tidy up the gap the mention left behind, but only horizontally: a note sent
  // as several lines has to stay several lines when it is filed.
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

// In a private chat every message is meant for the bot. In a group it isn't:
// people talk to each other, and every text message here is a billed Claude
// run, so acting on ordinary group chatter would spend money on conversation
// nobody addressed to us. A group message is therefore acted on only when it is
// unambiguously aimed at the bot:
//
//   - a slash command (`/ask ...`, or `/ask@thebot ...`; a command addressed to
//     a *different* bot is left alone),
//   - a message that @mentions the bot,
//   - a reply to something the bot itself said.
//
// Returns null when the message isn't addressed to us, otherwise the text with
// the bot's own @mention removed so it never reaches the prompt.
function groupAddressing(msg, { username = '', botId = 0 } = {}) {
  const body = typeof msg.text === 'string' ? msg.text : msg.caption || '';
  const isReplyToBot = Boolean(
    msg.reply_to_message && msg.reply_to_message.from && msg.reply_to_message.from.id === botId
  );

  const cmd = body.match(/^\/[A-Za-z0-9_]+(@([A-Za-z0-9_]+))?/);
  if (cmd) {
    // `/ask@someotherbot` is somebody else's business.
    if (cmd[2] && cmd[2].toLowerCase() !== String(username).toLowerCase()) return null;
    return { text: stripBotMention(body, username) };
  }

  if (isReplyToBot || mentionsBot(body, username)) return { text: stripBotMention(body, username) };
  return null;
}

module.exports = {
  expandPath,
  sanitizeSlug,
  safeUploadName,
  stamp,
  UPLOAD_PREFIX,
  botMentionRe,
  mentionsBot,
  stripBotMention,
  groupAddressing,
};
