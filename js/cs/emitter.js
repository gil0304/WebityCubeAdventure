/* Webity C# → JS emitter */
"use strict";

const CS_API_GLOBALS = [
  "Input", "Time", "Mathf", "Vector3", "Vector2", "Quaternion", "Color",
  "Debug", "Physics", "Random", "Screen", "Application", "GameObject",
  "Object", "WaitForSeconds", "WaitForSecondsRealtime", "WaitForFixedUpdate", "KeyCode", "Space", "ForceMode",
  "LayerMask", "SceneManager", "Gizmos", "PlayerPrefs", "List", "Dictionary",
  "Exception", "MonoBehaviour", "Transform", "Rigidbody", "Collider", "Collision",
  "Camera", "AudioSource", "ParticleSystem", "Animator", "Renderer", "Light",
  "Text", "Image", "Button", "Canvas", "RaycastHit", "AudioClip", "Material",
  "Destroy", "DestroyImmediate", "Instantiate", "FindObjectOfType", "FindObjectsOfType",
  "DontDestroyOnLoad", "print",
];
const CS_BEHAVIOUR_MEMBERS = new Set(["transform", "gameObject", "enabled", "name", "tag"]);
const CS_BEHAVIOUR_METHODS = new Set([
  "GetComponent", "GetComponents", "GetComponentInChildren", "GetComponentsInChildren",
  "GetComponentInParent", "StartCoroutine", "StopCoroutine", "StopAllCoroutines",
  "Invoke", "InvokeRepeating", "CancelInvoke", "IsInvoking", "SendMessage", "CompareTag",
]);
const CS_GENERIC_TO_STRING_ARG = new Set([
  "GetComponent", "GetComponents", "GetComponentInChildren", "GetComponentsInChildren",
  "GetComponentInParent", "AddComponent", "FindObjectOfType", "FindObjectsOfType",
]);
const CS_AMBIGUOUS_METHODS = new Set([
  "ToUpper", "ToLower", "Contains", "StartsWith", "EndsWith", "Trim", "Replace",
  "Split", "IndexOf", "PadLeft", "PadRight", "Substring",
]);
const CS_REF_TYPES = new Set([
  "Transform", "GameObject", "Rigidbody", "Collider", "BoxCollider", "SphereCollider",
  "CapsuleCollider", "Camera", "AudioSource", "ParticleSystem", "Animator", "Light",
  "MeshRenderer", "Renderer", "Text", "Image", "Button", "Canvas", "MonoBehaviour", "Behaviour", "Component",
]);

class CSEmitter {
  /* classNames: Set of all compiled class names, enums: Map name -> {members} */
  constructor(classNames, enums) {
    this.classNames = classNames;
    this.enums = enums;
    this.tempCounter = 0;
  }
  err(msg, node, code = "CS0000") {
    throw new CSError(msg, node?.line || 1, node?.col || 1, code);
  }

  /* ============ class ============ */
  emitClass(cls) {
    this.cls = cls;
    this.fieldNames = new Set();
    this.staticNames = new Set();
    this.methodNames = new Set();
    this.staticMethodNames = new Set();
    this.propNames = new Set();
    for (const m of cls.members) {
      if (m.kind === "Field") {
        for (const d of m.decls) (m.mods.includes("static") || m.mods.includes("const") ? this.staticNames : this.fieldNames).add(d.name);
      } else if (m.kind === "Method") {
        (m.mods.includes("static") ? this.staticMethodNames : this.methodNames).add(m.name);
      } else if (m.kind === "Property") {
        (m.mods.includes("static") ? this.staticNames : this.propNames).add(m.name);
      }
    }
    const isMono = this.isMonoDerived(cls);
    const baseJS = cls.base
      ? (this.classNames.has(cls.base) ? cls.base : "MonoBehaviour")
      : null;

    const lines = [];
    lines.push(`class ${cls.name}${baseJS ? " extends " + baseJS : ""} {`);

    // constructor: field initializers + user ctor
    const ctor = cls.members.find((m) => m.kind === "Method" && m.isCtor);
    const fieldInits = [];
    for (const m of cls.members) {
      if (m.kind === "Field" && !m.mods.includes("static") && !m.mods.includes("const")) {
        for (const d of m.decls) {
          fieldInits.push(`this.${d.name} = ${d.init ? this.emitInitExpr(d.init, m.type) : this.defaultFor(m.type)};`);
        }
      }
      if (m.kind === "Property" && !m.mods.includes("static") && !m.getterBody && !m.getterExpr) {
        fieldInits.push(`this.${m.name} = ${m.init ? this.emitInitExpr(m.init, m.type) : this.defaultFor(m.type)};`);
        this.fieldNames.add(m.name);
        this.propNames.delete(m.name);
      }
    }
    const ctorParams = ctor ? ctor.params.map((p) => p.name).join(", ") : "";
    lines.push(`constructor(${ctorParams}) {`);
    if (baseJS) lines.push("super();");
    lines.push(...fieldInits);
    if (ctor) {
      this.scopes = [new Set(ctor.params.map((p) => p.name))];
      this.currentMethod = ctor;
      lines.push(this.emitBlockInner(ctor.body));
    }
    lines.push("}");

    // methods
    for (const m of cls.members) {
      if (m.kind !== "Method" || m.isCtor) continue;
      this.currentMethod = m;
      this.scopes = [new Set(m.params.map((p) => p.name))];
      const star = m.isCoroutine ? "*" : "";
      const stat = m.mods.includes("static") ? "static " : "";
      const params = m.params.map((p) => p.default ? `${p.name} = ${this.emitExpr(p.default)}` : p.name).join(", ");
      lines.push(`${stat}${star}${m.name}(${params}) {`);
      lines.push(this.emitBlockInner(m.body));
      lines.push("}");
    }
    // bodied properties
    for (const m of cls.members) {
      if (m.kind !== "Property") continue;
      if (m.getterExpr) {
        this.currentMethod = m;
        this.scopes = [new Set()];
        lines.push(`get ${m.name}() { return ${this.emitExpr(m.getterExpr)}; }`);
      } else if (m.getterBody) {
        this.currentMethod = m;
        this.scopes = [new Set()];
        lines.push(`get ${m.name}() {`);
        lines.push(this.emitBlockInner(m.getterBody));
        lines.push("}");
        if (m.setterBody) {
          this.scopes = [new Set(["value"])];
          lines.push(`set ${m.name}(value) {`);
          lines.push(this.emitBlockInner(m.setterBody));
          lines.push("}");
        }
      }
    }
    lines.push("}");
    lines.push(`${cls.name}.__className = ${JSON.stringify(cls.name)};`);
    if (isMono) lines.push(`${cls.name}.__isMono = true;`);

    // static fields / static auto-props
    for (const m of cls.members) {
      if (m.kind === "Field" && (m.mods.includes("static") || m.mods.includes("const"))) {
        this.scopes = [new Set()];
        this.currentMethod = null;
        for (const d of m.decls) {
          lines.push(`${cls.name}.${d.name} = ${d.init ? this.emitInitExpr(d.init, m.type) : this.defaultFor(m.type)};`);
        }
      }
      if (m.kind === "Property" && m.mods.includes("static") && !m.getterBody && !m.getterExpr) {
        this.scopes = [new Set()];
        lines.push(`${cls.name}.${m.name} = ${m.init ? this.emitInitExpr(m.init, m.type) : this.defaultFor(m.type)};`);
      }
    }
    return lines.join("\n");
  }

  isMonoDerived(cls) {
    if (!cls.base) return false;
    if (cls.base === "MonoBehaviour" || cls.base === "Behaviour") return true;
    return true; // any based class in our world acts component-like
  }

  emitInitExpr(init, type) {
    this.scopes = this.scopes || [new Set()];
    if (init.kind === "ArrayInit") return "[" + init.items.map((x) => this.emitExpr(x)).join(", ") + "]";
    return this.emitExpr(init);
  }
  defaultFor(type) {
    if (!type) return "null";
    if (type.arrayDims > 0) return "[]";
    switch (type.name) {
      case "float": case "int": case "double": case "long": case "short": case "byte": case "uint": return "0";
      case "bool": return "false";
      case "string": return '""';
      case "Vector3": return "new Vector3()";
      case "Vector2": return "new Vector2()";
      case "Quaternion": return "Quaternion.identity";
      case "Color": return "Color.white";
      case "List": return "new List()";
      case "LayerMask": return "0";
      default:
        if (this.enums.has(type.name)) return "0";
        return "null";
    }
  }

  /* ============ statements ============ */
  pushScope() { this.scopes.push(new Set()); }
  popScope() { this.scopes.pop(); }
  declareLocal(n) { this.scopes[this.scopes.length - 1].add(n); }
  isLocal(n) { return this.scopes.some((s) => s.has(n)); }

  emitBlockInner(block) {
    this.pushScope();
    // emitStmtNested preserves any prelude collected by an enclosing statement
    const out = block.stmts.map((s) => this.emitStmtNested(s)).join("\n");
    this.popScope();
    return out;
  }

  emitStmt(st) {
    this.prelude = [];
    let code;
    switch (st.kind) {
      case "Block": { code = "{\n" + this.emitBlockInner(st) + "\n}"; break; }
      case "Empty": code = ";"; break;
      case "VarDecl": {
        const parts = [];
        for (const d of st.decls) {
          this.declareLocal(d.name);
          const init = d.init
            ? (d.init.kind === "ArrayInit" ? "[" + d.init.items.map((x) => this.emitExpr(x)).join(", ") + "]" : this.emitExpr(d.init))
            : this.defaultFor(st.type);
          parts.push(`${d.name} = ${init}`);
        }
        code = "let " + parts.join(", ") + ";";
        break;
      }
      case "ExprStmt": code = this.emitExpr(st.expr) + ";"; break;
      case "If": {
        const cond = this.emitExpr(st.cond);
        code = `if (${cond}) ${this.stmtAsBlock(st.then)}`;
        if (st.else) code += ` else ${this.stmtAsBlock(st.else)}`;
        break;
      }
      case "While": code = `while (${this.emitExpr(st.cond)}) ${this.stmtAsBlock(st.body)}`; break;
      case "DoWhile": code = `do ${this.stmtAsBlock(st.body)} while (${this.emitExpr(st.cond)});`; break;
      case "For": {
        this.pushScope();
        let init = "";
        if (st.init) {
          const s = this.emitStmtNested(st.init);
          init = s.endsWith(";") ? s.slice(0, -1) : s;
        }
        const cond = st.cond ? this.emitExpr(st.cond) : "";
        const inc = st.inc ? st.inc.map((e) => this.emitExpr(e)).join(", ") : "";
        const body = this.stmtAsBlock(st.body);
        this.popScope();
        code = `for (${init}; ${cond}; ${inc}) ${body}`;
        break;
      }
      case "Foreach": {
        this.pushScope();
        this.declareLocal(st.varName);
        const coll = this.emitExpr(st.coll);
        const body = this.stmtAsBlock(st.body);
        this.popScope();
        code = `for (const ${st.varName} of CS.iter(${coll})) ${body}`;
        break;
      }
      case "Return": {
        if (this.currentMethod && this.currentMethod.isCoroutine && st.expr)
          this.err("Cannot return a value from an iterator. Use yield return.", st, "CS1622");
        code = st.expr ? `return ${this.emitExpr(st.expr)};` : "return;";
        break;
      }
      case "Break": code = "break;"; break;
      case "Continue": code = "continue;"; break;
      case "YieldReturn": {
        if (!this.currentMethod || !this.currentMethod.isCoroutine)
          this.err("yield return can only be used inside an IEnumerator method", st, "CS1621");
        code = `yield ${st.expr ? this.emitExpr(st.expr) : "null"};`;
        break;
      }
      case "YieldBreak": code = "return;"; break;
      case "Switch": {
        const sw = this.emitExpr(st.expr);
        const parts = [`switch (CS.switchVal(${sw})) {`];
        for (const c of st.cases) {
          for (const lbl of c.labels) {
            parts.push(lbl === null ? "default:" : `case CS.switchVal(${this.emitExpr(lbl)}):`);
          }
          this.pushScope();
          parts.push("{");
          for (const s of c.stmts) parts.push(this.emitStmtNested(s));
          parts.push("}");
          this.popScope();
        }
        parts.push("}");
        code = parts.join("\n");
        break;
      }
      case "Throw": code = st.expr ? `throw CS.makeError(${this.emitExpr(st.expr)});` : "throw new Error('rethrow');"; break;
      case "Try": {
        code = `try {\n${this.emitBlockInner(st.block)}\n}`;
        if (st.catchBlock) {
          this.pushScope();
          if (st.catchVar) this.declareLocal(st.catchVar);
          code += ` catch (${st.catchVar || "__ex"}) {\n${this.emitBlockInner(st.catchBlock)}\n}`;
          this.popScope();
        }
        if (st.finallyBlock) code += ` finally {\n${this.emitBlockInner(st.finallyBlock)}\n}`;
        if (!st.catchBlock && !st.finallyBlock) code += " catch (__ex) { throw __ex; }";
        break;
      }
      default: this.err("Unsupported statement: " + st.kind, st, "CS9001");
    }
    if (this.prelude.length) code = this.prelude.join("\n") + "\n" + code;
    this.prelude = [];
    return code;
  }
  emitStmtNested(st) {
    // preserve outer prelude while emitting nested statement
    const saved = this.prelude;
    const out = this.emitStmt(st);
    this.prelude = saved;
    return out;
  }
  stmtAsBlock(st) {
    if (st.kind === "Block") return "{\n" + this.emitBlockInner(st) + "\n}";
    return "{\n" + this.emitStmtNested(st) + "\n}";
  }

  /* ============ expressions ============ */
  emitExpr(e) {
    switch (e.kind) {
      case "Literal":
        if (e.litType === "str") return JSON.stringify(e.value);
        if (e.litType === "null") return "null";
        return String(e.value);
      case "This": return "this";
      case "Base": return "super";
      case "Paren": return "(" + this.emitExpr(e.expr) + ")";
      case "Ident": return this.emitIdent(e);
      case "Member": return this.emitMember(e);
      case "Index": return `OP.idx(${this.emitExpr(e.obj)}, ${this.emitExpr(e.index)})`;
      case "Call": return this.emitCall(e);
      case "New": return this.emitNew(e);
      case "NewArray": {
        if (e.items) return "[" + e.items.map((x) => x.kind === "ArrayInit" ? this.emitExpr({ kind: "NewArray", type: e.type, items: x.items }) : this.emitExpr(x)).join(", ") + "]";
        const fill = ["float", "int", "double", "long", "byte", "short", "uint"].includes(e.type.name) ? "0" : "null";
        return e.size ? `CS.newArray(${this.emitExpr(e.size)}, ${fill})` : "[]";
      }
      case "Interp": {
        let out = "`";
        for (const p of e.parts) {
          if (p.type === "text") out += p.value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
          else out += "${" + (p.fmt ? `OP.fmt(${this.emitExpr(p.expr)}, ${JSON.stringify(p.fmt)})` : `OP.str(${this.emitExpr(p.expr)})`) + "}";
        }
        return out + "`";
      }
      case "Binary": return this.emitBinary(e);
      case "Unary": {
        const x = this.emitExpr(e.operand);
        if (e.op === "!") return `(!OP.bool(${x}))`;
        if (e.op === "-") return `OP.neg(${x})`;
        if (e.op === "~") return `(~${x})`;
        return e.prefix ? `(${e.op}${x})` : `(${x}${e.op})`;
      }
      case "Ternary": return `(OP.bool(${this.emitExpr(e.cond)}) ? ${this.emitExpr(e.then)} : ${this.emitExpr(e.else)})`;
      case "Assign": return this.emitAssign(e);
      case "Cast": {
        const x = this.emitExpr(e.expr);
        if (e.type === "int" || e.type === "long" || e.type === "short" || e.type === "byte" || e.type === "uint") return `OP.int(${x})`;
        if (e.type === "bool") return `OP.bool(${x})`;
        if (e.type === "string") return `OP.str(${x})`;
        return `(${x})`;
      }
      case "Is": {
        const x = this.emitExpr(e.expr);
        if (e.name) {
          this.declareLocal(e.name);
          this.prelude.push(`let ${e.name} = null;`);
          return `((${e.name} = CS.asType(${x}, ${JSON.stringify(e.type.name)})) !== null)`;
        }
        return `CS.isType(${x}, ${JSON.stringify(e.type.name)})`;
      }
      case "As": return `CS.asType(${this.emitExpr(e.expr)}, ${JSON.stringify(e.type.name)})`;
      case "Lambda": {
        this.pushScope();
        for (const p of e.params) this.declareLocal(p);
        const body = e.body.kind === "Block" ? `{ ${this.emitBlockInner(e.body)} }` : this.emitExpr(e.body);
        this.popScope();
        return `((${e.params.join(", ")}) => ${body})`;
      }
      case "ArrayInit": return "[" + e.items.map((x) => this.emitExpr(x)).join(", ") + "]";
      case "OutArg": this.err("out argument is only valid inside a method call", e, "CS1525"); break;
      default: this.err("Unsupported expression: " + e.kind, e, "CS9002");
    }
  }

  emitIdent(e) {
    const n = e.name;
    if (this.isLocal(n)) return n;
    if (this.fieldNames.has(n) || this.methodNames.has(n) || this.propNames.has(n)) return `this.${n}`;
    if (this.staticNames.has(n) || this.staticMethodNames.has(n)) return `${this.cls.name}.${n}`;
    if (CS_BEHAVIOUR_MEMBERS.has(n)) return `this.${n}`;
    if (CS_BEHAVIOUR_METHODS.has(n)) return `this.${n}`;
    if (this.classNames.has(n)) return n;
    if (this.enums.has(n)) return n;
    if (CS_API_GLOBALS.includes(n)) return n;
    if (e.isPrimitiveType) return `CS.primitives.${n}`;
    this.err(`The name '${n}' does not exist in the current context`, e, "CS0103");
  }

  emitMember(e) {
    // enum member: EnumName.Member
    if (e.obj.kind === "Ident" && this.enums.has(e.obj.name) && !this.isLocal(e.obj.name)) {
      return `${e.obj.name}.${e.name}`;
    }
    const obj = this.emitExpr(e.obj);
    if (e.name === "Length" || e.name === "Count") return `OP.len(${obj})`;
    return e.optional ? `${obj}?.${e.name}` : `${obj}.${e.name}`;
  }

  emitCall(e) {
    const callee = e.callee;
    // generic → string type arg
    let injectedArgs = [];
    if (e.typeArgs && e.typeArgs.length) {
      const mname = callee.kind === "Member" ? callee.name : callee.kind === "Ident" ? callee.name : null;
      if (mname && CS_GENERIC_TO_STRING_ARG.has(mname)) {
        injectedArgs = [JSON.stringify(e.typeArgs[0].name)];
      }
    }
    // out args
    const outFixups = [];
    const argStrs = e.args.map((a) => {
      if (a.kind === "OutArg") {
        const tmp = `__out${++this.tempCounter}`;
        this.prelude.push(`let ${tmp} = CS.outBox();`);
        if (a.varType) { this.declareLocal(a.name); this.prelude.push(`let ${a.name} = null;`); }
        else if (!this.isLocal(a.name) && !this.fieldNames.has(a.name)) { this.declareLocal(a.name); this.prelude.push(`let ${a.name} = null;`); }
        outFixups.push({ tmp, name: this.isLocal(a.name) ? a.name : (this.fieldNames.has(a.name) ? "this." + a.name : a.name) });
        return tmp;
      }
      return this.emitExpr(a);
    });
    const allArgs = injectedArgs.concat(argStrs).join(", ");

    let callExpr;
    if (callee.kind === "Member") {
      if (callee.name === "ToString") {
        callExpr = `OP.toStr(${this.emitExpr(callee.obj)}, ${argStrs[0] || "null"})`;
      } else if (callee.name === "Equals" && argStrs.length === 1) {
        callExpr = `OP.eq(${this.emitExpr(callee.obj)}, ${argStrs[0]})`;
      } else if (CS_AMBIGUOUS_METHODS.has(callee.name)) {
        callExpr = `OP.invoke(${this.emitExpr(callee.obj)}, ${JSON.stringify(callee.name)}, [${allArgs}])`;
      } else if (callee.obj.kind === "Ident" && this.enums.has(callee.obj.name)) {
        callExpr = `${callee.obj.name}.${callee.name}(${allArgs})`;
      } else {
        callExpr = `${this.emitExpr(callee.obj)}${callee.optional ? "?." : "."}${callee.name}(${allArgs})`;
      }
    } else if (callee.kind === "Ident") {
      callExpr = `${this.emitIdent(callee)}(${allArgs})`;
    } else if (callee.kind === "Base") {
      this.err("base calls are not supported here", e, "CS9003");
    } else {
      callExpr = `${this.emitExpr(callee)}(${allArgs})`;
    }

    if (outFixups.length) {
      const tmp = `__ret${++this.tempCounter}`;
      this.prelude.push(`let ${tmp};`);
      const fixes = outFixups.map((f) => `${f.name} = ${f.tmp}.v`).join(", ");
      return `(${tmp} = ${callExpr}, ${fixes}, ${tmp})`;
    }
    return callExpr;
  }

  emitNew(e) {
    const tname = e.type.name;
    if (tname === "List") {
      const items = e.items ? "[" + e.items.map((x) => this.emitExpr(x)).join(", ") + "]" : "";
      return `new List(${items})`;
    }
    if (tname === "Dictionary") return "new Dictionary()";
    const args = e.args.map((a) => this.emitExpr(a)).join(", ");
    if (this.classNames.has(tname)) return `new ${tname}(${args})`;
    if (this.enums.has(tname)) this.err(`Cannot create an instance of enum '${tname}'`, e, "CS1955");
    if (CS_API_GLOBALS.includes(tname)) return `new ${tname}(${args})`;
    this.err(`The type or namespace name '${tname}' could not be found`, e, "CS0246");
  }

  emitBinary(e) {
    const l = this.emitExpr(e.l), r = this.emitExpr(e.r);
    switch (e.op) {
      case "+": return `OP.add(${l}, ${r})`;
      case "-": return `OP.sub(${l}, ${r})`;
      case "*": return `OP.mul(${l}, ${r})`;
      case "/": return `OP.div(${l}, ${r})`;
      case "%": return `(${l} % ${r})`;
      case "==": return `OP.eq(${l}, ${r})`;
      case "!=": return `OP.ne(${l}, ${r})`;
      case "&&": return `(OP.bool(${l}) && OP.bool(${r}))`;
      case "||": return `(OP.bool(${l}) || OP.bool(${r}))`;
      case "??": return `(${l} ?? ${r})`;
      default: return `(${l} ${e.op} ${r})`;
    }
  }

  emitAssign(e) {
    const t = e.target;
    const opMap = { "+=": "add", "-=": "sub", "*=": "mul", "/=": "div", "%=": "mod" };
    if (t.kind === "Index") {
      const obj = this.emitExpr(t.obj), idx = this.emitExpr(t.index);
      if (e.op === "=") return `OP.setIdx(${obj}, ${idx}, ${this.emitExpr(e.value)})`;
      const fn = opMap[e.op];
      if (fn) return `OP.setIdx(${obj}, ${idx}, OP.${fn}(OP.idx(${obj}, ${idx}), ${this.emitExpr(e.value)}))`;
      return `OP.setIdx(${obj}, ${idx}, OP.idx(${obj}, ${idx}) ${e.op.slice(0, -1)} ${this.emitExpr(e.value)})`;
    }
    const target = this.emitExpr(t);
    if (e.op === "=") return `(${target} = ${this.emitExpr(e.value)})`;
    if (e.op === "??=") return `(${target} = ${target} ?? ${this.emitExpr(e.value)})`;
    const fn = opMap[e.op];
    if (fn) return `(${target} = OP.${fn}(${target}, ${this.emitExpr(e.value)}))`;
    return `(${target} ${e.op} ${this.emitExpr(e.value)})`; // |=, &=, ^=
  }
}

/* ============ field metadata extraction (for Inspector) ============ */
function csExtractFieldMeta(cls, enums, classNames) {
  const fields = [];
  for (const m of cls.members) {
    if (m.kind !== "Field") continue;
    if (m.mods.includes("static") || m.mods.includes("const")) continue;
    const isPublic = m.mods.includes("public");
    const hasSerializeField = (m.attrs || []).some((a) => a.name === "SerializeField");
    const hidden = (m.attrs || []).some((a) => a.name === "HideInInspector" || a.name === "System" );
    if ((!isPublic && !hasSerializeField) || hidden) continue;
    const header = (m.attrs || []).find((a) => a.name === "Header");
    const range = (m.attrs || []).find((a) => a.name === "Range");
    const t = m.type;
    let ftype = null, extra = {};
    if (t.arrayDims > 0 || t.name === "List") {
      const elem = t.arrayDims > 0 ? t.name : (t.args && t.args[0] ? t.args[0].name : "object");
      if (CS_REF_TYPES.has(elem) || classNames.has(elem)) {
        ftype = "objectRefArray"; extra.refKind = elem; extra.isList = t.name === "List";
      } else continue;
    } else {
      switch (t.name) {
        case "float": case "double": ftype = "float"; break;
        case "int": case "long": case "short": case "byte": case "uint": ftype = "int"; break;
        case "bool": ftype = "bool"; break;
        case "string": ftype = "string"; break;
        case "Vector3": ftype = "vector3"; break;
        case "Color": ftype = "color"; break;
        case "LayerMask": ftype = "layer"; break;
        case "KeyCode": ftype = "string"; break;
        case "AudioClip": ftype = "asset"; extra.assetKind = "audio"; break;
        case "Material": ftype = "asset"; extra.assetKind = "material"; break;
        default:
          if (enums.has(t.name)) { ftype = "enum"; extra.options = enums.get(t.name).members.map((x) => x.name); extra.enumName = t.name; }
          else if (CS_REF_TYPES.has(t.name) || classNames.has(t.name)) { ftype = "objectRef"; extra.refKind = t.name; }
          else ftype = null;
      }
    }
    if (!ftype) continue;
    for (const d of m.decls) {
      const f = { name: d.name, label: niceLabel(d.name), type: ftype, csType: t.name, ...extra };
      if (header) f.header = header.args && header.args[0] && header.args[0].value;
      if (range && range.args && range.args.length >= 2) {
        f.min = evalConstNum(range.args[0]); f.max = evalConstNum(range.args[1]); f.slider = true;
      }
      fields.push(f);
    }
  }
  return fields;
}
function evalConstNum(node) {
  if (!node) return 0;
  if (node.kind === "Literal") return node.value;
  if (node.kind === "Unary" && node.op === "-") return -evalConstNum(node.operand);
  return 0;
}
function niceLabel(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}
