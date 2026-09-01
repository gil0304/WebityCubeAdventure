/* Webity C# compiler — orchestrates lex/parse/emit for the whole project,
   maintains the last-good build, exposes component factory + inspector metadata */
"use strict";

class MissingScriptStub extends WComponent {
  constructor(className, rawProps) {
    super();
    this.__missingClass = className;
    this.__rawProps = rawProps || {};
    this.__isMissingStub = true;
  }
  get typeName() { return "CSScript"; }
  get className() { return this.__missingClass; }
}

const CSCompiler = (() => {
  let build = null; // { classes: {name: cls}, enums: {name: {members}}, metaByClass: {name: {fields}}, moduleSrc }
  let lastErrors = [];
  let compileCount = 0;

  function compileAll(scriptsMap) {
    const errors = [];
    const parsed = [];
    for (const [path, rec] of scriptsMap) {
      try {
        const ast = csParse(rec.source);
        parsed.push({ path, ast });
      } catch (e) {
        if (e instanceof CSError) {
          errors.push({ path, line: e.line, col: e.col, code: e.code, message: e.message });
        } else {
          errors.push({ path, line: 1, col: 1, code: "CS9999", message: String(e.message || e) });
        }
      }
    }
    if (errors.length) { lastErrors = errors; return { ok: false, errors }; }

    // collect enums (top-level + nested) and classes
    const enums = new Map();
    const classes = []; // {cls, path}
    for (const { path, ast } of parsed) {
      for (const t of ast.types) collectType(t, path);
    }
    function collectType(t, path) {
      if (t.kind === "Enum") { enums.set(t.name, { members: t.members }); return; }
      if (t.kind === "Class") {
        const nested = t.members.filter((m) => m.kind === "Enum" || m.kind === "Class");
        t.members = t.members.filter((m) => m.kind !== "Enum" && m.kind !== "Class");
        classes.push({ cls: t, path });
        for (const n of nested) collectType(n, path);
      }
    }
    const classNames = new Set(classes.map((c) => c.cls.name));

    // topo sort by base
    const byName = new Map(classes.map((c) => [c.cls.name, c]));
    const ordered = [];
    const visited = new Set();
    function visit(entry, chain) {
      if (visited.has(entry.cls.name)) return;
      if (chain.has(entry.cls.name)) return; // cycle — emit anyway
      chain.add(entry.cls.name);
      if (entry.cls.base && byName.has(entry.cls.base)) visit(byName.get(entry.cls.base), chain);
      visited.add(entry.cls.name);
      ordered.push(entry);
    }
    for (const c of classes) visit(c, new Set());

    // emit
    const emitter = new CSEmitter(classNames, enums);
    const chunks = [];
    for (const [name, e] of enums) {
      const body = e.members.map((m) => `${m.name}: ${m.value}`).join(", ");
      const names = e.members.map((m) => `${JSON.stringify(String(m.value))}: ${JSON.stringify(m.name)}`).join(", ");
      // NB: inside the module "Object" is shadowed by the Unity Object API — no Object.freeze here
      chunks.push(`const ${name} = { ${body}, __names: { ${names} } };`);
    }
    for (const { cls, path } of ordered) {
      try {
        chunks.push(emitter.emitClass(cls));
      } catch (e) {
        if (e instanceof CSError) errors.push({ path, line: e.line, col: e.col, code: e.code, message: e.message });
        else errors.push({ path, line: cls.line || 1, col: 1, code: "CS9999", message: String(e.message || e) });
      }
    }
    if (errors.length) { lastErrors = errors; return { ok: false, errors }; }

    const destructure = CS_API_GLOBALS.join(", ");
    const moduleSrc =
      `"use strict";\nconst OP = CS.OP;\nconst { ${destructure} } = CS.api;\n` +
      chunks.join("\n\n") +
      `\nreturn { classes: { ${ordered.map((c) => c.cls.name).join(", ")} }, enums: { ${[...enums.keys()].join(", ")} } };`;

    let result;
    try {
      const fn = new Function("CS", moduleSrc);
      result = fn(CSApi);
    } catch (e) {
      lastErrors = [{ path: parsed[0] ? parsed[0].path : "Assets/Scripts", line: 1, col: 1, code: "CS9998", message: "Internal compile error: " + (e.message || e) }];
      return { ok: false, errors: lastErrors };
    }

    // metadata (with inherited fields) + defaults from a bare instance
    const astByName = new Map(ordered.map((c) => [c.cls.name, c.cls]));
    const metaByClass = {};
    function fieldsFor(name, seen = new Set()) {
      const ast = astByName.get(name);
      if (!ast || seen.has(name)) return [];
      seen.add(name);
      const baseFields = ast.base && astByName.has(ast.base) ? fieldsFor(ast.base, seen) : [];
      const own = csExtractFieldMeta(ast, enums, classNames);
      const names = new Set(baseFields.map((f) => f.name));
      return baseFields.concat(own.filter((f) => !names.has(f.name)));
    }
    for (const { cls } of ordered) {
      const jsCls = result.classes[cls.name];
      if (!jsCls || !jsCls.__isMono) continue;
      const fields = fieldsFor(cls.name).map((f) => ({ ...f }));
      let probe = null;
      try { probe = new jsCls(); } catch (e) { probe = null; }
      for (const f of fields) {
        if (f.type === "objectRef") f.default = null;
        else if (f.type === "objectRefArray") f.default = [];
        else if (probe && probe[f.name] !== undefined) f.default = cloneFieldValue(probe[f.name]);
        else f.default = defaultForType(f);
        if (f.type === "enum") {
          const e = enums.get(f.enumName);
          if (e) f.optionValues = e.members.map((m) => m.value);
        }
      }
      metaByClass[cls.name] = { fields, className: cls.name };
    }

    // detect changed field defaults so the editor can update components still holding the old default
    const changedDefaults = [];
    if (build && build.metaByClass) {
      for (const cls in metaByClass) {
        const oldMeta = build.metaByClass[cls];
        if (!oldMeta) continue;
        for (const f of metaByClass[cls].fields) {
          const of = oldMeta.fields.find((x) => x.name === f.name);
          if (!of) continue;
          const enc = (v) => JSON.stringify(v && v.toJSON ? v.toJSON() : v);
          if (enc(of.default) !== enc(f.default)) {
            changedDefaults.push({ className: cls, field: f.name, oldDefault: of.default, newDefault: f.default });
          }
        }
      }
    }
    build = { classes: result.classes, enums: Object.fromEntries(enums), metaByClass, moduleSrc };
    lastErrors = [];
    compileCount++;
    return { ok: true, classCount: ordered.length, changedDefaults };
  }

  function defaultForType(f) {
    switch (f.type) {
      case "float": case "int": case "layer": return 0;
      case "bool": return false;
      case "string": return "";
      case "vector3": return new Vector3();
      case "color": return Color.white;
      case "enum": return 0;
      default: return null;
    }
  }

  function hasClass(name) { return !!(build && build.classes[name] && build.classes[name].__isMono); }
  function allScriptClassNames() {
    return build ? Object.keys(build.classes).filter((n) => build.classes[n].__isMono) : [];
  }
  function meta(name) { return build ? build.metaByClass[name] || null : null; }
  function createScriptComponent(name) {
    if (!hasClass(name)) return null;
    try {
      return new build.classes[name]();
    } catch (e) {
      CSApi.ctx.log("error", `${name}: constructor threw: ${e.message}`);
      return null;
    }
  }
  function createStub(className, rawProps) { return new MissingScriptStub(className, rawProps); }

  return {
    compileAll, hasClass, meta, createScriptComponent, createStub, allScriptClassNames,
    get lastErrors() { return lastErrors; },
    get hasBuild() { return !!build; },
    get compileCount() { return compileCount; },
    get moduleSrc() { return build ? build.moduleSrc : ""; },
    getEnum(name) { return build ? build.enums[name] : null; },
  };
})();
