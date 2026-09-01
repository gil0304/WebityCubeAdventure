/* Webity C# parser — recursive descent producing a compact AST */
"use strict";

const CS_PRIMITIVES = new Set(["float", "int", "double", "bool", "string", "long", "short", "byte", "char", "object", "uint", "void", "var"]);
const CS_MODIFIERS = new Set(["public", "private", "protected", "internal", "static", "readonly", "const", "override", "virtual", "abstract", "sealed", "partial"]);

class CSParser {
  constructor(tokens) {
    this.toks = tokens;
    this.pos = 0;
  }
  peek(k = 0) { return this.toks[Math.min(this.pos + k, this.toks.length - 1)]; }
  next() { return this.toks[this.pos++]; }
  at(t, v) { const tk = this.peek(); return tk.t === t && (v === undefined || tk.v === v); }
  atPunc(v) { return this.at("punc", v); }
  atKw(v) { return this.at("kw", v); }
  eat(t, v) { if (this.at(t, v)) return this.next(); return null; }
  expect(t, v, msg, code) {
    if (this.at(t, v)) return this.next();
    const tk = this.peek();
    this.err(msg || `${v || t} expected`, code || "CS1002", tk);
  }
  err(msg, code, tk) {
    tk = tk || this.peek();
    throw new CSError(msg, tk.line, tk.col, code);
  }
  save() { return this.pos; }
  restore(p) { this.pos = p; }

  /* ============ program ============ */
  parseProgram() {
    const types = [];
    while (!this.at("eof")) {
      if (this.atKw("using")) { while (!this.atPunc(";") && !this.at("eof")) this.next(); this.expect("punc", ";", "; expected", "CS1002"); continue; }
      if (this.atKw("namespace")) {
        this.next();
        while (this.at("id") || this.atPunc(".")) this.next();
        this.expect("punc", "{", "{ expected", "CS1514");
        while (!this.atPunc("}") && !this.at("eof")) types.push(this.parseTypeDecl());
        this.expect("punc", "}", "} expected", "CS1513");
        continue;
      }
      types.push(this.parseTypeDecl());
    }
    return { kind: "Program", types };
  }

  parseAttributes() {
    const attrs = [];
    while (this.atPunc("[")) {
      const p = this.save();
      this.next();
      if (!this.at("id")) { this.restore(p); break; }
      while (!this.atPunc("]") && !this.at("eof")) {
        const name = this.expect("id", undefined, "Attribute name expected", "CS1001").v;
        let args = [];
        if (this.eat("punc", "(")) {
          if (!this.atPunc(")")) {
            do { args.push(this.parseExpression()); } while (this.eat("punc", ","));
          }
          this.expect("punc", ")", ") expected", "CS1026");
        }
        attrs.push({ name, args });
        if (!this.eat("punc", ",")) break;
      }
      this.expect("punc", "]", "] expected", "CS1003");
    }
    return attrs;
  }

  parseModifiers() {
    const mods = new Set();
    while (this.at("kw") && CS_MODIFIERS.has(this.peek().v)) mods.add(this.next().v);
    return mods;
  }

  parseTypeDecl() {
    const attrs = this.parseAttributes();
    const mods = this.parseModifiers();
    if (this.atKw("enum")) return this.parseEnum(mods, attrs);
    if (this.atKw("class") || this.atKw("struct") || this.atKw("interface")) return this.parseClass(mods, attrs);
    this.err("A class, enum, or using directive expected", "CS1022");
  }

  parseEnum(mods) {
    this.next();
    const name = this.expect("id", undefined, "Identifier expected", "CS1001").v;
    this.expect("punc", "{", "{ expected", "CS1514");
    const members = [];
    let autoVal = 0;
    while (!this.atPunc("}") && !this.at("eof")) {
      const mname = this.expect("id", undefined, "Identifier expected", "CS1001").v;
      let value = autoVal;
      if (this.eat("punc", "=")) {
        const neg = !!this.eat("punc", "-");
        const numTok = this.expect("num", undefined, "Constant expected", "CS0150");
        value = neg ? -numTok.v : numTok.v;
      }
      members.push({ name: mname, value });
      autoVal = value + 1;
      if (!this.eat("punc", ",")) break;
    }
    this.expect("punc", "}", "} expected", "CS1513");
    this.eat("punc", ";");
    return { kind: "Enum", name, members, mods: [...mods] };
  }

  parseClass(mods) {
    const keyword = this.next().v; // class/struct/interface
    const nameTok = this.expect("id", undefined, "Identifier expected", "CS1001");
    const name = nameTok.v;
    let base = null;
    if (this.eat("punc", ":")) {
      base = this.parseType().name;
      while (this.eat("punc", ",")) this.parseType(); // interfaces ignored
    }
    this.expect("punc", "{", "{ expected", "CS1514");
    const members = [];
    while (!this.atPunc("}") && !this.at("eof")) {
      members.push(this.parseMember(name));
    }
    this.expect("punc", "}", "} expected", "CS1513");
    this.eat("punc", ";");
    return { kind: "Class", name, base, members, mods: [...mods], keyword, line: nameTok.line };
  }

  parseMember(className) {
    const attrs = this.parseAttributes();
    const mods = this.parseModifiers();
    if (this.atKw("enum")) return this.parseEnum(mods);
    if (this.atKw("class")) return this.parseClass(mods);
    // constructor?
    if (this.at("id", className) && this.peek(1).t === "punc" && this.peek(1).v === "(") {
      const tok = this.next();
      return this.parseMethodRest({ name: "constructor", retType: null, mods, attrs, line: tok.line, isCtor: true });
    }
    const type = this.parseType();
    const nameTok = this.expect("id", undefined, "Identifier expected", "CS1001");
    const name = nameTok.v;
    if (this.atPunc("(")) {
      return this.parseMethodRest({ name, retType: type, mods, attrs, line: nameTok.line });
    }
    if (this.atPunc("{")) {
      // property
      return this.parseProperty({ name, type, mods, attrs, line: nameTok.line });
    }
    if (this.atPunc("=>")) {
      this.next();
      const expr = this.parseExpression();
      this.expect("punc", ";", "; expected", "CS1002");
      return { kind: "Property", name, type, mods: [...mods], attrs, getterExpr: expr, line: nameTok.line };
    }
    // field(s)
    const decls = [];
    let init = null;
    if (this.eat("punc", "=")) init = this.parseVarInit();
    decls.push({ name, init, line: nameTok.line });
    while (this.eat("punc", ",")) {
      const nt = this.expect("id", undefined, "Identifier expected", "CS1001");
      let ini = null;
      if (this.eat("punc", "=")) ini = this.parseVarInit();
      decls.push({ name: nt.v, init: ini, line: nt.line });
    }
    this.expect("punc", ";", "; expected", "CS1002");
    return { kind: "Field", type, decls, mods: [...mods], attrs, line: nameTok.line };
  }

  parseProperty({ name, type, mods, attrs, line }) {
    this.expect("punc", "{", "{ expected", "CS1514");
    let hasGet = false, hasSet = false, getterBody = null, setterBody = null;
    while (!this.atPunc("}") && !this.at("eof")) {
      this.parseModifiers(); // accessor modifiers e.g. private set
      const acc = this.expect("id", undefined, "get or set expected", "CS1014");
      if (acc.v !== "get" && acc.v !== "set") this.err("get or set expected", "CS1014", acc);
      if (this.eat("punc", ";")) {
        if (acc.v === "get") hasGet = true; else hasSet = true;
      } else if (this.atPunc("{")) {
        const body = this.parseBlock();
        if (acc.v === "get") { hasGet = true; getterBody = body; } else { hasSet = true; setterBody = body; }
      } else if (this.eat("punc", "=>")) {
        const expr = this.parseExpression();
        this.expect("punc", ";", "; expected", "CS1002");
        if (acc.v === "get") { hasGet = true; getterBody = { kind: "Block", stmts: [{ kind: "Return", expr }] }; }
        else { hasSet = true; setterBody = { kind: "Block", stmts: [{ kind: "ExprStmt", expr }] }; }
      } else this.err("; or { expected", "CS1002");
    }
    this.expect("punc", "}", "} expected", "CS1513");
    let init = null;
    if (this.eat("punc", "=")) { init = this.parseVarInit(); this.expect("punc", ";", "; expected", "CS1002"); }
    return { kind: "Property", name, type, mods: [...mods], attrs, hasGet, hasSet, getterBody, setterBody, init, line };
  }

  parseMethodRest({ name, retType, mods, attrs, line, isCtor }) {
    this.expect("punc", "(", "( expected", "CS1003");
    const params = [];
    if (!this.atPunc(")")) {
      do {
        this.eat("kw", "out"); this.eat("kw", "ref"); // param modifiers tolerated
        const ptype = this.parseType();
        const pn = this.expect("id", undefined, "Identifier expected", "CS1001").v;
        let def = null;
        if (this.eat("punc", "=")) def = this.parseExpression();
        params.push({ type: ptype, name: pn, default: def });
      } while (this.eat("punc", ","));
    }
    this.expect("punc", ")", ") expected", "CS1026");
    let body = null;
    if (this.eat("punc", "=>")) {
      const expr = this.parseExpression();
      this.expect("punc", ";", "; expected", "CS1002");
      body = { kind: "Block", stmts: [retType && retType.name !== "void" ? { kind: "Return", expr } : { kind: "ExprStmt", expr }] };
    } else if (this.atPunc("{")) {
      body = this.parseBlock();
    } else {
      this.expect("punc", ";", "; expected", "CS1002"); // abstract/extern — empty
      body = { kind: "Block", stmts: [] };
    }
    const isCoroutine = retType && (retType.name === "IEnumerator" || retType.name === "IEnumerator<>");
    return { kind: "Method", name, retType, params, body, mods: [...mods], attrs, line, isCtor: !!isCtor, isCoroutine };
  }

  /* ============ types ============ */
  parseType() {
    let name;
    const tk = this.peek();
    if (tk.t === "kw" && CS_PRIMITIVES.has(tk.v)) { name = this.next().v; }
    else if (tk.t === "id") {
      name = this.next().v;
      while (this.atPunc(".") && this.peek(1).t === "id") { this.next(); name = this.next().v; } // Namespace.Type → Type
    }
    else this.err("Type expected", "CS1031", tk);
    let args = null;
    if (this.atPunc("<") && this.looksLikeTypeArgs()) {
      this.next();
      args = [this.parseType()];
      while (this.eat("punc", ",")) args.push(this.parseType());
      this.expect("punc", ">", "> expected", "CS1003");
    }
    let arrayDims = 0;
    while (this.atPunc("[") && this.peek(1).t === "punc" && this.peek(1).v === "]") {
      this.next(); this.next(); arrayDims++;
    }
    this.eat("punc", "?"); // nullable — ignore
    return { name, args, arrayDims };
  }
  looksLikeTypeArgs() {
    // scan ahead from '<' for a plausible closing '>' followed by sane token
    let p = this.pos + 1, depth = 1;
    let guard = 0;
    while (p < this.toks.length && guard++ < 40) {
      const tk = this.toks[p];
      if (tk.t === "punc") {
        if (tk.v === "<") depth++;
        else if (tk.v === ">") { depth--; if (depth === 0) return true; }
        else if (tk.v === "[" || tk.v === "]" || tk.v === "," || tk.v === ".") { /* ok inside */ }
        else return false;
      } else if (tk.t !== "id" && !(tk.t === "kw" && CS_PRIMITIVES.has(tk.v))) return false;
      p++;
    }
    return false;
  }

  /* ============ statements ============ */
  parseBlock() {
    this.expect("punc", "{", "{ expected", "CS1514");
    const stmts = [];
    while (!this.atPunc("}") && !this.at("eof")) stmts.push(this.parseStatement());
    this.expect("punc", "}", "} expected", "CS1513");
    return { kind: "Block", stmts };
  }

  parseStatement() {
    const tk = this.peek();
    if (this.atPunc("{")) return this.parseBlock();
    if (this.atPunc(";")) { this.next(); return { kind: "Empty" }; }
    if (tk.t === "kw") {
      switch (tk.v) {
        case "if": {
          this.next();
          this.expect("punc", "(", "( expected", "CS1003");
          const cond = this.parseExpression();
          this.expect("punc", ")", ") expected", "CS1026");
          const then = this.parseStatement();
          let els = null;
          if (this.eat("kw", "else")) els = this.parseStatement();
          return { kind: "If", cond, then, else: els, line: tk.line };
        }
        case "while": {
          this.next();
          this.expect("punc", "(", "( expected", "CS1003");
          const cond = this.parseExpression();
          this.expect("punc", ")", ") expected", "CS1026");
          return { kind: "While", cond, body: this.parseStatement(), line: tk.line };
        }
        case "do": {
          this.next();
          const body = this.parseStatement();
          this.expect("kw", "while", "while expected", "CS1003");
          this.expect("punc", "(", "( expected", "CS1003");
          const cond = this.parseExpression();
          this.expect("punc", ")", ") expected", "CS1026");
          this.expect("punc", ";", "; expected", "CS1002");
          return { kind: "DoWhile", cond, body, line: tk.line };
        }
        case "for": {
          this.next();
          this.expect("punc", "(", "( expected", "CS1003");
          let init = null;
          if (!this.atPunc(";")) init = this.parseDeclOrExpr();
          this.expect("punc", ";", "; expected", "CS1002");
          let cond = null;
          if (!this.atPunc(";")) cond = this.parseExpression();
          this.expect("punc", ";", "; expected", "CS1002");
          let inc = null;
          if (!this.atPunc(")")) {
            inc = [this.parseExpression()];
            while (this.eat("punc", ",")) inc.push(this.parseExpression());
          }
          this.expect("punc", ")", ") expected", "CS1026");
          return { kind: "For", init, cond, inc, body: this.parseStatement(), line: tk.line };
        }
        case "foreach": {
          this.next();
          this.expect("punc", "(", "( expected", "CS1003");
          this.parseType();
          const vn = this.expect("id", undefined, "Identifier expected", "CS1001").v;
          this.expect("kw", "in", "in expected", "CS1003");
          const coll = this.parseExpression();
          this.expect("punc", ")", ") expected", "CS1026");
          return { kind: "Foreach", varName: vn, coll, body: this.parseStatement(), line: tk.line };
        }
        case "return": {
          this.next();
          let expr = null;
          if (!this.atPunc(";")) expr = this.parseExpression();
          this.expect("punc", ";", "; expected", "CS1002");
          return { kind: "Return", expr, line: tk.line };
        }
        case "break": this.next(); this.expect("punc", ";", "; expected", "CS1002"); return { kind: "Break" };
        case "continue": this.next(); this.expect("punc", ";", "; expected", "CS1002"); return { kind: "Continue" };
        case "yield": {
          this.next();
          if (this.eat("kw", "break")) { this.expect("punc", ";", "; expected", "CS1002"); return { kind: "YieldBreak" }; }
          this.expect("kw", "return", "return expected after yield", "CS1003");
          let expr = null;
          if (!this.atPunc(";")) expr = this.parseExpression();
          this.expect("punc", ";", "; expected", "CS1002");
          return { kind: "YieldReturn", expr, line: tk.line };
        }
        case "switch": {
          this.next();
          this.expect("punc", "(", "( expected", "CS1003");
          const expr = this.parseExpression();
          this.expect("punc", ")", ") expected", "CS1026");
          this.expect("punc", "{", "{ expected", "CS1514");
          const cases = [];
          while (!this.atPunc("}") && !this.at("eof")) {
            const labels = [];
            while (this.atKw("case") || this.atKw("default")) {
              if (this.eat("kw", "case")) {
                labels.push(this.parseExpression());
                this.expect("punc", ":", ": expected", "CS1003");
              } else {
                this.next();
                this.expect("punc", ":", ": expected", "CS1003");
                labels.push(null);
              }
            }
            const stmts = [];
            while (!this.atKw("case") && !this.atKw("default") && !this.atPunc("}") && !this.at("eof"))
              stmts.push(this.parseStatement());
            cases.push({ labels, stmts });
          }
          this.expect("punc", "}", "} expected", "CS1513");
          return { kind: "Switch", expr, cases, line: tk.line };
        }
        case "throw": {
          this.next();
          let expr = null;
          if (!this.atPunc(";")) expr = this.parseExpression();
          this.expect("punc", ";", "; expected", "CS1002");
          return { kind: "Throw", expr, line: tk.line };
        }
        case "try": {
          this.next();
          const block = this.parseBlock();
          let catchVar = null, catchBlock = null, finallyBlock = null;
          if (this.eat("kw", "catch")) {
            if (this.eat("punc", "(")) {
              this.parseType();
              if (this.at("id")) catchVar = this.next().v;
              this.expect("punc", ")", ") expected", "CS1026");
            }
            catchBlock = this.parseBlock();
          }
          if (this.eat("kw", "finally")) finallyBlock = this.parseBlock();
          return { kind: "Try", block, catchVar, catchBlock, finallyBlock, line: tk.line };
        }
      }
    }
    const st = this.parseDeclOrExpr();
    this.expect("punc", ";", "; expected", "CS1002");
    return st;
  }

  parseDeclOrExpr() {
    // speculative: type ident [= expr] (, ident [= expr])*
    const p = this.save();
    const tk = this.peek();
    if ((tk.t === "kw" && CS_PRIMITIVES.has(tk.v) && tk.v !== "void") || tk.t === "id") {
      try {
        const type = this.parseType();
        if (this.at("id")) {
          const nx = this.peek(1);
          if (nx.t === "punc" && (nx.v === "=" || nx.v === ";" || nx.v === ",")) {
            const decls = [];
            do {
              const nameTok = this.expect("id", undefined, "Identifier expected", "CS1001");
              let init = null;
              if (this.eat("punc", "=")) init = this.parseVarInit();
              decls.push({ name: nameTok.v, init });
            } while (this.eat("punc", ","));
            return { kind: "VarDecl", type, decls, line: tk.line };
          }
        }
      } catch (e) { /* fall through to expression */ }
      this.restore(p);
    }
    const expr = this.parseExpression();
    return { kind: "ExprStmt", expr, line: tk.line };
  }

  parseVarInit() {
    // supports array initializer  { a, b, c }
    if (this.atPunc("{")) {
      this.next();
      const items = [];
      if (!this.atPunc("}")) {
        do { items.push(this.parseVarInit()); } while (this.eat("punc", ","));
      }
      this.expect("punc", "}", "} expected", "CS1513");
      return { kind: "ArrayInit", items };
    }
    return this.parseExpression();
  }

  /* ============ expressions ============ */
  parseExpression() { return this.parseAssignment(); }

  parseAssignment() {
    // lambda detection: id => ...  |  (a, b) => ...
    if (this.at("id") && this.peek(1).t === "punc" && this.peek(1).v === "=>") {
      const param = this.next().v;
      this.next();
      const body = this.atPunc("{") ? this.parseBlock() : this.parseExpression();
      return { kind: "Lambda", params: [param], body };
    }
    if (this.atPunc("(")) {
      const p = this.save();
      let ok = true, params = [];
      this.next();
      if (this.atPunc(")")) { /* () => */ }
      else {
        while (true) {
          const save2 = this.save();
          // optional type then name
          if (this.at("id") || (this.at("kw") && CS_PRIMITIVES.has(this.peek().v))) {
            try { this.parseType(); } catch (e) { this.restore(save2); }
            if (!this.at("id")) this.restore(save2);
          }
          if (this.at("id")) params.push(this.next().v);
          else { ok = false; break; }
          if (this.eat("punc", ",")) continue;
          break;
        }
      }
      if (ok && this.atPunc(")") && this.peek(1).t === "punc" && this.peek(1).v === "=>") {
        this.next(); this.next();
        const body = this.atPunc("{") ? this.parseBlock() : this.parseExpression();
        return { kind: "Lambda", params, body };
      }
      this.restore(p);
    }
    const left = this.parseTernary();
    const tk = this.peek();
    if (tk.t === "punc" && ["=", "+=", "-=", "*=", "/=", "%=", "??=", "|=", "&=", "^="].includes(tk.v)) {
      this.next();
      const right = this.parseAssignment();
      return { kind: "Assign", op: tk.v, target: left, value: right, line: tk.line };
    }
    return left;
  }

  parseTernary() {
    const cond = this.parseNullCoalesce();
    if (this.atPunc("?") && !this.atPunc("?.")) {
      this.next();
      const t = this.parseAssignment();
      this.expect("punc", ":", ": expected", "CS1003");
      const f = this.parseAssignment();
      return { kind: "Ternary", cond, then: t, else: f };
    }
    return cond;
  }
  parseNullCoalesce() {
    let l = this.parseOr();
    while (this.atPunc("??")) { this.next(); l = { kind: "Binary", op: "??", l, r: this.parseOr() }; }
    return l;
  }
  parseOr() {
    let l = this.parseAnd();
    while (this.atPunc("||")) { this.next(); l = { kind: "Binary", op: "||", l, r: this.parseAnd() }; }
    return l;
  }
  parseAnd() {
    let l = this.parseBitOr();
    while (this.atPunc("&&")) { this.next(); l = { kind: "Binary", op: "&&", l, r: this.parseBitOr() }; }
    return l;
  }
  parseBitOr() {
    let l = this.parseBitXor();
    while (this.atPunc("|")) { this.next(); l = { kind: "Binary", op: "|", l, r: this.parseBitXor() }; }
    return l;
  }
  parseBitXor() {
    let l = this.parseBitAnd();
    while (this.atPunc("^")) { this.next(); l = { kind: "Binary", op: "^", l, r: this.parseBitAnd() }; }
    return l;
  }
  parseBitAnd() {
    let l = this.parseEquality();
    while (this.atPunc("&")) { this.next(); l = { kind: "Binary", op: "&", l, r: this.parseEquality() }; }
    return l;
  }
  parseEquality() {
    let l = this.parseRelational();
    while (this.atPunc("==") || this.atPunc("!=")) {
      const op = this.next().v;
      l = { kind: "Binary", op, l, r: this.parseRelational() };
    }
    return l;
  }
  parseRelational() {
    let l = this.parseShift();
    while (true) {
      if (this.atPunc("<") || this.atPunc(">") || this.atPunc("<=") || this.atPunc(">=")) {
        // avoid treating generic call as relational: handled in postfix already
        const op = this.next().v;
        l = { kind: "Binary", op, l, r: this.parseShift() };
      } else if (this.atKw("is")) {
        this.next();
        const type = this.parseType();
        let name = null;
        if (this.at("id")) name = this.next().v;
        l = { kind: "Is", expr: l, type, name };
      } else if (this.atKw("as")) {
        this.next();
        const type = this.parseType();
        l = { kind: "As", expr: l, type };
      } else break;
    }
    return l;
  }
  parseShift() {
    let l = this.parseAdditive();
    while (this.atPunc("<<") || this.atPunc(">>")) {
      const op = this.next().v;
      l = { kind: "Binary", op, l, r: this.parseAdditive() };
    }
    return l;
  }
  parseAdditive() {
    let l = this.parseMultiplicative();
    while (this.atPunc("+") || this.atPunc("-")) {
      const op = this.next().v;
      l = { kind: "Binary", op, l, r: this.parseMultiplicative() };
    }
    return l;
  }
  parseMultiplicative() {
    let l = this.parseUnary();
    while (this.atPunc("*") || this.atPunc("/") || this.atPunc("%")) {
      const op = this.next().v;
      l = { kind: "Binary", op, l, r: this.parseUnary() };
    }
    return l;
  }
  parseUnary() {
    const tk = this.peek();
    if (this.atPunc("!")) { this.next(); return { kind: "Unary", op: "!", operand: this.parseUnary() }; }
    if (this.atPunc("-")) { this.next(); return { kind: "Unary", op: "-", operand: this.parseUnary() }; }
    if (this.atPunc("+")) { this.next(); return this.parseUnary(); }
    if (this.atPunc("~")) { this.next(); return { kind: "Unary", op: "~", operand: this.parseUnary() }; }
    if (this.atPunc("++") || this.atPunc("--")) {
      const op = this.next().v;
      return { kind: "Unary", op, operand: this.parseUnary(), prefix: true };
    }
    // cast: (primitive) expr
    if (this.atPunc("(")) {
      const nx = this.peek(1), nx2 = this.peek(2);
      if (nx.t === "kw" && CS_PRIMITIVES.has(nx.v) && nx.v !== "var" && nx2.t === "punc" && nx2.v === ")") {
        this.next();
        const type = this.next().v;
        this.next();
        return { kind: "Cast", type, expr: this.parseUnary(), line: tk.line };
      }
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let e = this.parsePrimary();
    while (true) {
      if (this.atPunc(".") || this.atPunc("?.")) {
        const optional = this.next().v === "?.";
        const nameTok = this.at("kw") ? this.next() : this.expect("id", undefined, "Identifier expected", "CS1001");
        e = { kind: "Member", obj: e, name: nameTok.v, optional, line: nameTok.line };
      } else if (this.atPunc("(")) {
        e = this.parseCallOn(e, null);
      } else if (this.atPunc("<") && (e.kind === "Member" || e.kind === "Ident") && this.looksLikeGenericCall()) {
        this.next();
        const typeArgs = [this.parseType()];
        while (this.eat("punc", ",")) typeArgs.push(this.parseType());
        this.expect("punc", ">", "> expected", "CS1003");
        e = this.parseCallOn(e, typeArgs);
      } else if (this.atPunc("[")) {
        this.next();
        const idx = this.parseExpression();
        this.expect("punc", "]", "] expected", "CS1003");
        e = { kind: "Index", obj: e, index: idx };
      } else if (this.atPunc("++") || this.atPunc("--")) {
        const op = this.next().v;
        e = { kind: "Unary", op, operand: e, prefix: false };
      } else break;
    }
    return e;
  }
  looksLikeGenericCall() {
    let p = this.pos + 1, depth = 1, guard = 0;
    while (p < this.toks.length && guard++ < 30) {
      const tk = this.toks[p];
      if (tk.t === "punc") {
        if (tk.v === "<") depth++;
        else if (tk.v === ">") {
          depth--;
          if (depth === 0) {
            const after = this.toks[p + 1];
            return after && after.t === "punc" && after.v === "(";
          }
        }
        else if (tk.v !== "," && tk.v !== "." && tk.v !== "[" && tk.v !== "]") return false;
      } else if (tk.t !== "id" && !(tk.t === "kw" && CS_PRIMITIVES.has(tk.v))) return false;
      p++;
    }
    return false;
  }
  parseCallOn(callee, typeArgs) {
    const open = this.expect("punc", "(", "( expected", "CS1003");
    const args = [];
    if (!this.atPunc(")")) {
      do {
        if (this.atKw("out")) {
          this.next();
          let vt = null;
          const p = this.save();
          try {
            vt = this.parseType();
            if (!this.at("id")) { this.restore(p); vt = null; }
          } catch (e) { this.restore(p); vt = null; }
          const vn = this.expect("id", undefined, "Identifier expected", "CS1001").v;
          args.push({ kind: "OutArg", varType: vt, name: vn });
        } else if (this.atKw("ref")) {
          this.next();
          args.push(this.parseExpression());
        } else {
          args.push(this.parseExpression());
        }
      } while (this.eat("punc", ","));
    }
    this.expect("punc", ")", ") expected", "CS1026");
    return { kind: "Call", callee, args, typeArgs, line: open.line };
  }

  parsePrimary() {
    const tk = this.peek();
    if (tk.t === "num") { this.next(); return { kind: "Literal", value: tk.v, litType: "num" }; }
    if (tk.t === "str") { this.next(); return { kind: "Literal", value: tk.v, litType: "str" }; }
    if (tk.t === "char") { this.next(); return { kind: "Literal", value: tk.v, litType: "str" }; }
    if (tk.t === "istr") { this.next(); return this.buildInterp(tk); }
    if (tk.t === "kw") {
      switch (tk.v) {
        case "true": this.next(); return { kind: "Literal", value: true, litType: "bool" };
        case "false": this.next(); return { kind: "Literal", value: false, litType: "bool" };
        case "null": this.next(); return { kind: "Literal", value: null, litType: "null" };
        case "this": this.next(); return { kind: "This" };
        case "base": this.next(); return { kind: "Base" };
        case "new": return this.parseNew();
        case "float": case "int": case "double": case "string": case "bool": case "byte": case "long": case "char": case "object": case "short": case "uint":
          this.next(); return { kind: "Ident", name: tk.v, isPrimitiveType: true, line: tk.line };
      }
      this.err(`Invalid expression term '${tk.v}'`, "CS1525", tk);
    }
    if (tk.t === "id") { this.next(); return { kind: "Ident", name: tk.v, line: tk.line, col: tk.col }; }
    if (this.atPunc("(")) {
      this.next();
      const e = this.parseExpression();
      this.expect("punc", ")", ") expected", "CS1026");
      return { kind: "Paren", expr: e };
    }
    this.err(`Invalid expression term '${tk.v ?? tk.t}'`, "CS1525", tk);
  }

  buildInterp(tk) {
    const parts = [];
    for (const p of tk.v) {
      if (p.type === "text") parts.push({ type: "text", value: p.value });
      else {
        const subToks = csLex(p.src);
        const sub = new CSParser(subToks);
        let expr;
        try {
          expr = sub.parseExpression();
        } catch (e) {
          throw new CSError(e.message, tk.line, tk.col, e.code || "CS1525");
        }
        parts.push({ type: "expr", expr, fmt: p.fmt });
      }
    }
    return { kind: "Interp", parts, line: tk.line };
  }

  parseNew() {
    const tk = this.next(); // new
    const type = this.parseType();
    // array forms
    if (this.atPunc("[")) {
      this.next();
      let size = null;
      if (!this.atPunc("]")) size = this.parseExpression();
      this.expect("punc", "]", "] expected", "CS1003");
      let items = null;
      if (this.atPunc("{")) {
        const ini = this.parseVarInit();
        items = ini.items;
      }
      return { kind: "NewArray", type, size, items, line: tk.line };
    }
    if (type.arrayDims > 0) {
      let items = null;
      if (this.atPunc("{")) items = this.parseVarInit().items;
      return { kind: "NewArray", type, size: null, items, line: tk.line };
    }
    let args = [];
    if (this.atPunc("(")) {
      this.next();
      if (!this.atPunc(")")) {
        do { args.push(this.parseExpression()); } while (this.eat("punc", ","));
      }
      this.expect("punc", ")", ") expected", "CS1026");
    }
    let items = null;
    if (this.atPunc("{")) items = this.parseVarInit().items;
    return { kind: "New", type, args, items, line: tk.line };
  }
}

function csParse(source) {
  const tokens = csLex(source);
  const parser = new CSParser(tokens);
  return parser.parseProgram();
}
