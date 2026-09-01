/* Webity C# lexer */
"use strict";

class CSError extends Error {
  constructor(message, line, col, code = "CS0000") {
    super(message);
    this.line = line; this.col = col; this.code = code;
  }
}

const CS_KEYWORDS = new Set([
  "using", "namespace", "class", "struct", "enum", "interface",
  "public", "private", "protected", "internal", "static", "readonly", "const",
  "override", "virtual", "abstract", "sealed", "partial",
  "void", "var", "new", "return", "if", "else", "while", "for", "foreach", "in",
  "do", "switch", "case", "default", "break", "continue", "yield",
  "true", "false", "null", "this", "base", "is", "as", "out", "ref",
  "float", "int", "double", "bool", "string", "long", "short", "byte", "char", "object", "uint",
  "try", "catch", "finally", "throw",
]);

const CS_PUNCS = [
  "??=", "<<=", ">>=",
  "==", "!=", "<=", ">=", "&&", "||", "++", "--", "+=", "-=", "*=", "/=", "%=",
  "=>", "?.", "??", "<<", ">>", "&=", "|=", "^=",
  "+", "-", "*", "/", "%", "=", "<", ">", "!", "&", "|", "^", "~", "?", ":",
  ".", ",", ";", "(", ")", "{", "}", "[", "]",
];

function csLex(source) {
  const tokens = [];
  let i = 0, line = 1, col = 1;
  const n = source.length;

  function err(msg, code) { throw new CSError(msg, line, col, code); }
  function push(t, v, l = line, c = col) { tokens.push({ t, v, line: l, col: c }); }
  function advance(count = 1) {
    for (let k = 0; k < count; k++) {
      if (source[i] === "\n") { line++; col = 1; } else col++;
      i++;
    }
  }

  function readString(quote, allowEscape = true) {
    // assumes source[i] is the opening quote
    const startLine = line, startCol = col;
    advance();
    let out = "";
    while (i < n) {
      const ch = source[i];
      if (ch === "\n") err("Newline in constant", "CS1010");
      if (ch === quote) { advance(); return out; }
      if (allowEscape && ch === "\\") {
        advance();
        const e = source[i];
        const map = { n: "\n", t: "\t", r: "\r", "0": "\0", "\\": "\\", '"': '"', "'": "'" };
        if (e === "u") {
          const hex = source.slice(i + 1, i + 5);
          out += String.fromCharCode(parseInt(hex, 16) || 0);
          advance(5);
        } else {
          out += map[e] !== undefined ? map[e] : e;
          advance();
        }
      } else { out += ch; advance(); }
    }
    line = startLine; col = startCol;
    err("Unterminated string literal", "CS1010");
  }

  function readInterpolated() {
    // at '$'; next char is '"'
    const startLine = line, startCol = col;
    advance(); // $
    advance(); // "
    const parts = [];
    let text = "";
    while (i < n) {
      const ch = source[i];
      if (ch === '"') { advance(); if (text) parts.push({ type: "text", value: text }); push("istr", parts, startLine, startCol); return; }
      if (ch === "\n") err("Newline in constant", "CS1010");
      if (ch === "{" && source[i + 1] === "{") { text += "{"; advance(2); continue; }
      if (ch === "}" && source[i + 1] === "}") { text += "}"; advance(2); continue; }
      if (ch === "\\") {
        advance();
        const e = source[i];
        const map = { n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"' };
        text += map[e] !== undefined ? map[e] : e;
        advance();
        continue;
      }
      if (ch === "{") {
        if (text) { parts.push({ type: "text", value: text }); text = ""; }
        advance();
        const exprStartLine = line, exprStartCol = col;
        let depth = 0, src = "", fmt = null;
        while (i < n) {
          const c2 = source[i];
          if (c2 === "(" || c2 === "[") depth++;
          if (c2 === ")" || c2 === "]") depth--;
          if (c2 === "}" && depth <= 0) { advance(); break; }
          if (c2 === ":" && depth <= 0 && fmt === null) { fmt = ""; advance(); continue; }
          if (fmt !== null) fmt += c2; else src += c2;
          advance();
          if (i >= n) err("Unterminated interpolation", "CS1010");
        }
        parts.push({ type: "expr", src, fmt, line: exprStartLine, col: exprStartCol });
        continue;
      }
      text += ch; advance();
    }
    line = startLine; col = startCol;
    err("Unterminated string literal", "CS1010");
  }

  while (i < n) {
    const ch = source[i];
    // whitespace
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") { advance(); continue; }
    // comments
    if (ch === "/" && source[i + 1] === "/") { while (i < n && source[i] !== "\n") advance(); continue; }
    if (ch === "/" && source[i + 1] === "*") {
      advance(2);
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) advance();
      if (i >= n) err("Unterminated comment", "CS1035");
      advance(2);
      continue;
    }
    // strings
    if (ch === '"') { const l = line, c = col; push("str", readString('"'), l, c); continue; }
    if (ch === "'") {
      const l = line, c = col;
      const s = readString("'");
      if (s.length !== 1) { line = l; col = c; err("Too many characters in character literal", "CS1012"); }
      push("char", s, l, c);
      continue;
    }
    if (ch === "$" && source[i + 1] === '"') { readInterpolated(); continue; }
    if (ch === "@" && source[i + 1] === '"') {
      const l = line, c = col;
      advance();
      push("str", readString('"', false), l, c);
      continue;
    }
    // numbers
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(source[i + 1] || ""))) {
      const l = line, c = col;
      let numStr = "";
      if (ch === "0" && (source[i + 1] === "x" || source[i + 1] === "X")) {
        advance(2);
        while (i < n && /[0-9a-fA-F]/.test(source[i])) { numStr += source[i]; advance(); }
        push("num", parseInt(numStr, 16), l, c);
        continue;
      }
      let seenDot = false, seenExp = false;
      while (i < n) {
        const d = source[i];
        if (/[0-9]/.test(d)) { numStr += d; advance(); }
        else if (d === "." && !seenDot && !seenExp && /[0-9]/.test(source[i + 1] || "")) { seenDot = true; numStr += d; advance(); }
        else if ((d === "e" || d === "E") && !seenExp && /[0-9+-]/.test(source[i + 1] || "")) { seenExp = true; numStr += d; advance(); if (source[i] === "+" || source[i] === "-") { numStr += source[i]; advance(); } }
        else break;
      }
      if (i < n && /[fFdDmM]/.test(source[i])) advance(); // type suffix
      if (i < n && /[lLuU]/.test(source[i])) advance();
      push("num", parseFloat(numStr), l, c);
      continue;
    }
    // identifiers / keywords
    if (/[A-Za-z_]/.test(ch)) {
      const l = line, c = col;
      let id = "";
      while (i < n && /[A-Za-z0-9_]/.test(source[i])) { id += source[i]; advance(); }
      push(CS_KEYWORDS.has(id) ? "kw" : "id", id, l, c);
      continue;
    }
    // attributes / punctuation
    let matched = false;
    for (const p of CS_PUNCS) {
      if (source.startsWith(p, i)) {
        push("punc", p);
        advance(p.length);
        matched = true;
        break;
      }
    }
    if (matched) continue;
    err(`Unexpected character '${ch}'`, "CS1056");
  }
  push("eof", null);
  return tokens;
}
