// SPDX-License-Identifier: MIT
//
// fast.js — an original performance overlay for marked 18.1.3.
//
// The upstream renderer is vendored unmodified at vendor/marked/marked.esm.js.
// This module subclasses its exported Tokenizer to add first-character
// dispatch and a rewritten list tokenizer, then drives the exported Lexer and
// Parser with marked's default options. It is not a copy of marked's source:
// every override below was written for this entry, and marked's MIT notice is
// kept in vendor/marked/LICENSE and vendor/marked/NOTICE.

import { Tokenizer, Lexer, Parser, defaults } from './vendor/marked/marked.esm.js';

// --- small string helpers -------------------------------------------------
// marked's list tokenizer leans on split/trim/search and on replace callbacks
// that allocate a closure per line. These helpers answer the same questions
// with plain UTF-16 scans and return the original string when nothing changes.

function firstLine(s) {
  const i = s.indexOf('\n');
  return i === -1 ? s : s.slice(0, i);
}

// Same answer as `s.trim() !== ''`, but allocation-free for ASCII text.
function hasNonSpace(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11) continue;
    if (c < 128) return true;
    return s.trim().length !== 0;
  }
  return false;
}

// Same answer as `s.search(/[^ ]/)`: only U+0020 counts as space here.
function firstNonSpace(s) {
  let i = 0;
  while (i < s.length && s.charCodeAt(i) === 32) i++;
  return i;
}

// Same answer as `s.replace(/^[ \t]+/, (v) => expandTabs(v, startCol))`.
function expandLeadingTabs(s, startCol) {
  let i = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === 32 || c === 9) i++;
    else break;
  }
  if (i === 0) return s;
  let hasTab = false;
  for (let j = 0; j < i; j++) {
    if (s.charCodeAt(j) === 9) {
      hasTab = true;
      break;
    }
  }
  if (!hasTab) return s;
  let out = '';
  let col = startCol;
  for (let j = 0; j < i; j++) {
    if (s.charCodeAt(j) === 9) {
      const width = 4 - (col % 4);
      out += ' '.repeat(width);
      col += width;
    } else {
      out += ' ';
      col++;
    }
  }
  return out + s.slice(i);
}

// marked's `expandTabs` (J): expand every tab to the next 4-column stop.
function expandAllTabs(s, startCol) {
  let out = '';
  let col = startCol;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 9) {
      const width = 4 - (col % 4);
      out += ' '.repeat(width);
      col += width;
    } else {
      out += s[i];
      col++;
    }
  }
  return out;
}

// Same answer as `s.replace(/\t/g, '    ').search(/[^ ]/) >= 4`.
function tab4IndentAtLeast4(s) {
  let col = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 32) col++;
    else if (c === 9) col += 4;
    else return col >= 4;
  }
  // No non-space at all: the original's search(/[^ ]/) returns -1.
  return false;
}

// Same answer as `s.replace(/^ {0,3}/, '')`.
function stripUpTo3Spaces(s) {
  let i = 0;
  while (i < 3 && s.charCodeAt(i) === 32) i++;
  return s.slice(i);
}

const SETEXT_LINE = /^ {0,3}(?:=+|-+) *$/;

// One scan that is true when the text could contain any inline construct:
// the tokenizer stop characters, an entity, a hard break, or a GFM URL,
// email or autolink trigger. When it is false the whole string is a single
// text token, so the inline loop and its mask pre-pass can be skipped.
const MAYBE_INLINE =
  /[`\\<!\[*_~&\n@]|[hH][tT][tT][pP]|[fF][tT][pP]|www\.|mailto:|xmpp:/;

// --- tokenizer overlay ----------------------------------------------------

export class FastTokenizer extends Tokenizer {
  // Block tokenizers. Each upstream regex is anchored to a leading marker
  // after at most three spaces, so a first-character test is a safe and cheap
  // gate: when it fails the regex could not have matched either.
  space(e) {
    const c = e.charCodeAt(0);
    if (c !== 32 && c !== 9 && c !== 10) return;
    return super.space(e);
  }

  code(e) {
    const c = e.charCodeAt(0);
    if (c !== 32 && c !== 9) return;
    return super.code(e);
  }

  fences(e) {
    let i = 0;
    while (i < 3 && e.charCodeAt(i) === 32) i++;
    const c = e.charCodeAt(i);
    if (c !== 96 && c !== 126) return;
    return super.fences(e);
  }

  heading(e) {
    let i = 0;
    while (i < 3 && e.charCodeAt(i) === 32) i++;
    if (e.charCodeAt(i) !== 35) return;
    return super.heading(e);
  }

  hr(e) {
    let i = 0;
    while (i < 3 && e.charCodeAt(i) === 32) i++;
    const c = e.charCodeAt(i);
    if (c !== 45 && c !== 95 && c !== 42) return;
    return super.hr(e);
  }

  blockquote(e) {
    let i = 0;
    while (i < 3 && e.charCodeAt(i) === 32) i++;
    if (e.charCodeAt(i) !== 62) return;
    return super.blockquote(e);
  }

  html(e) {
    let i = 0;
    while (i < 3 && e.charCodeAt(i) === 32) i++;
    if (e.charCodeAt(i) !== 60) return;
    return super.html(e);
  }

  def(e) {
    let i = 0;
    while (i < 3 && e.charCodeAt(i) === 32) i++;
    if (e.charCodeAt(i) !== 91) return;
    return super.def(e);
  }

  // A setext heading needs a run of "=" or "-" on its underline, so the
  // substring test is a necessary condition and skips the expensive regex
  // for the many blocks that contain neither character.
  lheading(e) {
    if (e.indexOf('=') === -1 && e.indexOf('-') === -1) return;
    return super.lheading(e);
  }

  // A GFM table's delimiter row is always the second line and always holds a
  // dash. Scanning that one line avoids the large table regex elsewhere.
  table(e) {
    const nl = e.indexOf('\n');
    if (nl === -1) return;
    let hasDash = false;
    for (let i = nl + 1; i < e.length; i++) {
      const c = e.charCodeAt(i);
      if (c === 10) break;
      if (c === 45) {
        hasDash = true;
        break;
      }
    }
    if (!hasDash) return;
    return super.table(e);
  }

  // Inline tokenizers. These run in a fixed order for every inline token, so
  // gating them by the first character removes most of the anchored regex
  // calls on ordinary text. emStrong and del are deliberately left untouched:
  // the lexer's mask pre-pass keys off whether those two methods were
  // overridden, and overriding them would force that pass on every string.
  escape(e) {
    if (e.charCodeAt(0) !== 92) return;
    return super.escape(e);
  }

  tag(e) {
    if (e.charCodeAt(0) !== 60) return;
    return super.tag(e);
  }

  link(e) {
    const c = e.charCodeAt(0);
    if (c !== 91 && !(c === 33 && e.charCodeAt(1) === 91)) return;
    return super.link(e);
  }

  reflink(e, links) {
    const c = e.charCodeAt(0);
    if (c !== 91 && !(c === 33 && e.charCodeAt(1) === 91)) return;
    return super.reflink(e, links);
  }

  codespan(e) {
    if (e.charCodeAt(0) !== 96) return;
    return super.codespan(e);
  }

  br(e) {
    const c = e.charCodeAt(0);
    if (c !== 92 && !(c === 32 && e.charCodeAt(1) === 32)) return;
    return super.br(e);
  }

  autolink(e) {
    if (e.charCodeAt(0) !== 60) return;
    return super.autolink(e);
  }

  url(e) {
    const c = e.charCodeAt(0);
    if (
      !(
        (c >= 65 && c <= 90) ||
        (c >= 97 && c <= 122) ||
        (c >= 48 && c <= 57) ||
        c === 46 ||
        c === 95 ||
        c === 43 ||
        c === 45
      )
    )
      return;
    return super.url(e);
  }

  // A rewritten list tokenizer. It keeps marked's token shape and rules but
  // replaces per-line split/trim/replace work with scans and first-character
  // dispatch, and only runs the six block-start regexes that can apply to the
  // current line's leading character.
  list(e) {
    const block = this.rules.block;
    const other = this.rules.other;

    let lead = 0;
    while (lead < 3 && e.charCodeAt(lead) === 32) lead++;
    const leadChar = e.charCodeAt(lead);
    if (
      leadChar !== 42 &&
      leadChar !== 43 &&
      leadChar !== 45 &&
      !(leadChar >= 48 && leadChar <= 57)
    )
      return;

    const first = block.list.exec(e);
    if (!first) return;

    const source = e;
    let marker = first[1].trim();
    const ordered = marker.length > 1;
    const token = {
      type: 'list',
      raw: '',
      ordered,
      start: ordered ? +marker.slice(0, -1) : '',
      loose: false,
      items: [],
    };

    let markerPattern = ordered ? `\\d{1,9}\\${marker.slice(-1)}` : `\\${marker}`;
    if (this.options.pedantic) markerPattern = ordered ? markerPattern : '[*+-]';
    const itemRe = other.listItemRegex(markerPattern);
    let pendingLoose = false;

    while (e) {
      let emptyItem = false;
      let text = '';
      const item = itemRe.exec(e);
      if (!item || block.hr.test(e)) break;

      const itemStart = source.length - e.length;
      e = e.slice(item[0].length);

      let content = firstLine(item[2]);
      const markerLen = item[1].length;
      content = this.options.pedantic
        ? expandAllTabs(content, markerLen)
        : expandLeadingTabs(content, markerLen);
      const nextLine = firstLine(e);
      let blank = !hasNonSpace(content);
      let indent = 0;

      if (this.options.pedantic) {
        indent = 2;
        text = content.trimStart();
      } else if (blank) {
        indent = markerLen + 1;
      } else {
        indent = firstNonSpace(content);
        if (indent > 4) indent = 1;
        text = content.slice(indent);
        indent += markerLen;
      }

      if (blank && other.blankLine.test(nextLine)) {
        e = e.slice(nextLine.length + 1);
        emptyItem = true;
      }

      if (!emptyItem) {
        const isNextBullet = other.nextBulletRegex(indent);
        const isHr = other.hrRegex(indent);
        const isFence = other.fencesBeginRegex(indent);
        const isHeading = this.options.pedantic
          ? other.pedanticHeadingBeginRegex(indent)
          : other.headingBeginRegex(indent);
        const isHtml = other.htmlBeginRegex(indent);
        const isQuote = other.blockquoteBeginRegex(indent);

        while (e) {
          const nl = e.indexOf('\n');
          const line = nl === -1 ? e : e.slice(0, nl);
          let rawLine = line;
          let expanded;
          if (this.options.pedantic) {
            rawLine = rawLine.replace(other.listReplaceNesting, '  ');
            expanded = rawLine;
          } else {
            expanded = expandLeadingTabs(rawLine, 0);
          }

          let stops = false;
          const at = firstNonSpace(rawLine);
          if (at <= indent) {
            const c = rawLine.charCodeAt(at);
            if (c === 96 || c === 126) stops = isFence.test(rawLine);
            else if (c === 35) stops = isHeading.test(rawLine);
            else if (c === 60) stops = isHtml.test(rawLine);
            else if (c === 62) stops = isQuote.test(rawLine);
            else if (c === 42 || c === 43 || c === 45 || (c >= 48 && c <= 57))
              stops = isNextBullet.test(rawLine);
            if (!stops && (c === 42 || c === 45 || c === 95)) stops = isHr.test(rawLine);
          }
          if (stops) break;

          if (firstNonSpace(expanded) >= indent || !hasNonSpace(rawLine)) {
            text += '\n' + expanded.slice(indent);
          } else {
            if (
              blank ||
              tab4IndentAtLeast4(content) ||
              isFence.test(content) ||
              isHeading.test(content) ||
              isHtml.test(content) ||
              isHr.test(content)
            ) {
              break;
            }
            let addition = rawLine;
            if (
              !this.options.pedantic &&
              SETEXT_LINE.test(rawLine) &&
              block.lheading.test(content + '\n' + rawLine)
            ) {
              addition = '    ' + stripUpTo3Spaces(expanded);
            }
            text += '\n' + addition;
          }

          blank = !hasNonSpace(rawLine);
          e = nl === -1 ? '' : e.slice(nl + 1);
          content = expanded.slice(indent);
        }
      }

      const raw = source.slice(itemStart, source.length - e.length);
      if (!token.loose) {
        if (pendingLoose) token.loose = true;
        else {
          const last = raw.charCodeAt(raw.length - 1);
          if ((last === 10 || last === 32 || last === 9) && other.doubleBlankLine.test(raw))
            pendingLoose = true;
        }
      }
      token.items.push({
        type: 'list_item',
        raw,
        task: this.options.gfm ? other.listIsTask.test(text) : false,
        loose: false,
        text,
        tokens: [],
      });
    }

    const lastItem = token.items.at(-1);
    if (lastItem) {
      lastItem.raw = lastItem.raw.trimEnd();
      lastItem.text = lastItem.text.trimEnd();
    } else {
      return;
    }
    token.raw = source.slice(0, source.length - e.length).trimEnd();

    for (const item of token.items) {
      this.lexer.state.top = false;
      item.tokens = this.lexer.blockTokens(item.text, []);
      if (!token.loose) {
        let loose = false;
        for (const tk of item.tokens) {
          if (
            tk.type === 'space' &&
            tk.raw.indexOf('\n') !== -1 &&
            other.anyLine.test(tk.raw)
          ) {
            loose = true;
            break;
          }
        }
        token.loose = loose;
      }
    }

    for (const item of token.items) {
      const head = item.tokens[0];
      if (item.task && (head?.type === 'text' || head?.type === 'paragraph')) {
        item.text = item.text.replace(other.listReplaceTask, '');
        head.raw = head.raw.replace(other.listReplaceTask, '');
        head.text = head.text.replace(other.listReplaceTask, '');
        for (let q = this.lexer.inlineQueue.length - 1; q >= 0; q--) {
          const queued = this.lexer.inlineQueue[q];
          if (other.listIsTask.test(queued.src)) {
            queued.src = queued.src.replace(other.listReplaceTask, '');
            break;
          }
        }
        const box = other.listTaskCheckbox.exec(item.raw);
        if (box) {
          const checkbox = {
            type: 'checkbox',
            raw: box[0] + ' ',
            checked: box[0] !== '[ ]',
          };
          item.checked = checkbox.checked;
          if (token.loose) {
            if (head && (head.type === 'paragraph' || head.type === 'text') && head.tokens) {
              head.raw = checkbox.raw + head.raw;
              head.text = checkbox.raw + head.text;
              head.tokens.unshift(checkbox);
            } else {
              item.tokens.unshift({
                type: 'paragraph',
                raw: checkbox.raw,
                text: checkbox.raw,
                tokens: [checkbox],
              });
            }
          } else {
            item.tokens.unshift(checkbox);
          }
        }
      } else if (item.task) {
        item.task = false;
      }
    }

    if (token.loose) {
      for (const item of token.items) {
        item.loose = true;
        for (const tk of item.tokens) if (tk.type === 'text') tk.type = 'paragraph';
      }
    }

    return token;
  }
}

// --- lexer overlay --------------------------------------------------------
// inlineTokens lives on Lexer, not Tokenizer. Overriding it here lets a plain
// inline group skip the private mask pre-pass and the tokenizer dispatch loop.
// The state transitions below mirror the upstream method exactly: the link
// paren flag is narrowed for the duration of the call and restored after it,
// and an empty group returns the given token list untouched, as upstream does.

export class FastLexer extends Lexer {
  inlineTokens(e, t = []) {
    if (e.length === 0 || MAYBE_INLINE.test(e)) return super.inlineTokens(e, t);

    const prevLinkParen = this.state.linkParenPossible;
    this.state.linkParenPossible = prevLinkParen && e.includes(')');
    try {
      const escaped = this.state.inRawBlock;
      const last = t.length > 0 ? t[t.length - 1] : undefined;
      if (last !== undefined && last.type === 'text') {
        last.raw += e;
        last.text += e;
      } else {
        t.push({ type: 'text', raw: e, text: e, escaped });
      }
      return t;
    } finally {
      this.state.linkParenPossible = prevLinkParen;
    }
  }
}

// --- driver ---------------------------------------------------------------
// marked's public parse() routes through a mutable singleton. Driving the
// exported classes directly with a fresh options object keeps this entry
// stateless: nothing survives from one call to the next. The base static
// Lexer.lex hardcodes its own constructor, so instantiate FastLexer instead.

export function render(markdown) {
  const options = { ...defaults, tokenizer: new FastTokenizer() };
  return Parser.parse(new FastLexer(options).lex(markdown), options);
}
