/* Webity engine core — GameObject / Transform / Component / Scene / serialization / assets */
"use strict";

const LAYERS = ["Default", "TransparentFX", "Ignore Raycast", "Player", "Water", "UI",
  "Environment", "Enemy", "Collectible", "Checkpoint", "Trigger"];
const TAGS = ["Untagged", "Player", "MainCamera", "Enemy", "Collectible", "Goal",
  "Checkpoint", "KillZone", "Obstacle", "GameController", "Respawn", "Finish"];

let __transformVersion = 1;
function bumpTransformVersion() { __transformVersion++; }

/* ============================ Transform ============================ */
class WTransform {
  constructor(go) {
    this.gameObject = go;
    this._localPos = new Vector3();
    this._localRot = Quaternion.identity;
    this._localScale = new Vector3(1, 1, 1);
    this._parent = null;
    this.children = [];
    this._cacheVer = 0;
    this._cachedWorld = null;
  }
  get __destroyed() { return this.gameObject.__destroyed; }

  get localPosition() { return this._localPos.clone(); }
  set localPosition(v) { this._localPos.copy(v); bumpTransformVersion(); }
  get localRotation() { return this._localRot.clone(); }
  set localRotation(q) { this._localRot.copy(q.normalized); bumpTransformVersion(); }
  get localScale() { return this._localScale.clone(); }
  set localScale(v) { this._localScale.copy(v); bumpTransformVersion(); }
  get localEulerAngles() { return this._localRot.eulerAngles; }
  set localEulerAngles(v) { this._localRot.copy(Quaternion.Euler(v.x, v.y, v.z)); bumpTransformVersion(); }

  get parent() { return this._parent; }
  set parent(p) { this.SetParent(p, true); }
  SetParent(p, worldStays = true) {
    if (p === this) return;
    const world = worldStays ? this.worldMatrix.clone() : null;
    if (this._parent) {
      const i = this._parent.children.indexOf(this);
      if (i >= 0) this._parent.children.splice(i, 1);
    } else if (this.gameObject.scene) {
      const r = this.gameObject.scene.roots;
      const i = r.indexOf(this.gameObject);
      if (i >= 0) r.splice(i, 1);
    }
    this._parent = p || null;
    if (p) p.children.push(this);
    else if (this.gameObject.scene) this.gameObject.scene.roots.push(this.gameObject);
    if (worldStays && world) {
      const parentInv = p ? p.worldMatrix.invert() : new Matrix4();
      const local = parentInv.mul(world);
      // decompose TRS from local
      const m = local.m;
      this._localPos.set(m[12], m[13], m[14]);
      const sx = Math.hypot(m[0], m[1], m[2]);
      const sy = Math.hypot(m[4], m[5], m[6]);
      const sz = Math.hypot(m[8], m[9], m[10]);
      this._localScale.set(sx, sy, sz);
      const r = Vector3.from({ x: m[0] / sx, y: m[1] / sx, z: m[2] / sx });
      const u = Vector3.from({ x: m[4] / sy, y: m[5] / sy, z: m[6] / sy });
      const f = Vector3.from({ x: m[8] / sz, y: m[9] / sz, z: m[10] / sz });
      this._localRot.copy(Quaternion.LookRotation(f, u));
      void r;
    }
    bumpTransformVersion();
  }
  get childCount() { return this.children.length; }
  GetChild(i) { return this.children[i]; }
  Find(name) {
    for (const c of this.children) if (c.gameObject.name === name) return c;
    for (const c of this.children) { const r = c.Find(name); if (r) return r; }
    return null;
  }

  get worldMatrix() {
    if (this._cacheVer === __transformVersion && this._cachedWorld) return this._cachedWorld;
    const local = Matrix4.TRS(this._localPos, this._localRot, this._localScale);
    this._cachedWorld = this._parent ? this._parent.worldMatrix.mul(local) : local;
    this._cacheVer = __transformVersion;
    return this._cachedWorld;
  }
  get position() { const m = this.worldMatrix.m; return new Vector3(m[12], m[13], m[14]); }
  set position(v) {
    if (this._parent) this._localPos.copy(this._parent.worldMatrix.invert().mulPoint(v));
    else this._localPos.copy(v);
    bumpTransformVersion();
  }
  get rotation() {
    if (!this._parent) return this._localRot.clone();
    return this._worldRotOf();
  }
  _worldRotOf() {
    let q = this._localRot.clone(), p = this._parent;
    while (p) { q = p._localRot.mulQ(q); p = p._parent; }
    return q.normalized;
  }
  set rotation(q) {
    if (this._parent) {
      const pw = this._parent._worldRotOf();
      this._localRot.copy(pw.inverse().mulQ(q).normalized);
    } else this._localRot.copy(q.normalized);
    bumpTransformVersion();
  }
  get eulerAngles() { return this.rotation.eulerAngles; }
  set eulerAngles(v) { this.rotation = Quaternion.Euler(v.x, v.y, v.z); }
  get lossyScale() {
    const m = this.worldMatrix.m;
    return new Vector3(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10]));
  }
  get forward() { return this.rotation.mulV(Vector3.forward); }
  get right() { return this.rotation.mulV(Vector3.right); }
  get up() { return this.rotation.mulV(Vector3.up); }
  set forward(v) { this.rotation = Quaternion.LookRotation(v); }

  Translate(v, space = "Self") {
    if (space === "World" || space === 1) this.position = this.position.add(v);
    else this.position = this.position.add(this.rotation.mulV(v));
  }
  Rotate(a, b, c, space) {
    if (a instanceof Vector3 && typeof b === "number") {
      // Rotate(axis, angle, space?)
      const q = Quaternion.AngleAxis(b, a);
      if (c === "World" || c === 1) this.rotation = q.mulQ(this.rotation);
      else this.localRotation = this._localRot.mulQ(Quaternion.AngleAxis(b, a));
      return;
    }
    let euler = a instanceof Vector3 ? a : new Vector3(a, b, c);
    this.localRotation = this._localRot.mulQ(Quaternion.Euler(euler.x, euler.y, euler.z));
  }
  RotateAround(point, axis, angle) {
    const q = Quaternion.AngleAxis(angle, axis);
    const d = this.position.sub(point);
    this.position = point.add(q.mulV(d));
    this.rotation = q.mulQ(this.rotation);
  }
  LookAt(target, up = Vector3.up) {
    const t = target instanceof WTransform ? target.position : target;
    const dir = t.sub(this.position);
    if (dir.sqrMagnitude > 1e-10) this.rotation = Quaternion.LookRotation(dir, up);
  }
  TransformPoint(v) { return this.worldMatrix.mulPoint(v); }
  TransformDirection(v) { return this.rotation.mulV(v); }
  InverseTransformPoint(v) { return this.worldMatrix.invert().mulPoint(v); }
  InverseTransformDirection(v) { return this.rotation.inverse().mulV(v); }
  get root() { let t = this; while (t._parent) t = t._parent; return t; }
  IsChildOf(other) { let t = this; while (t) { if (t === other) return true; t = t._parent; } return false; }
}

/* ============================ Component base ============================ */
class WComponent {
  constructor() { this.gameObject = null; this.enabled = true; this.__destroyed = false; }
  get transform() { return this.gameObject?.transform; }
  get scene() { return this.gameObject?.scene; }
  get typeName() { return this.constructor.compName; }
  get tag() { return this.gameObject ? this.gameObject.tag : ""; }
  get name() { return this.gameObject ? this.gameObject.name : ""; }
  CompareTag(t) { return this.gameObject ? this.gameObject.tag === t : false; }
  GetComponent(t) { return this.gameObject ? this.gameObject.GetComponent(t) : null; }
  GetComponents(t) { return this.gameObject ? this.gameObject.GetComponents(t) : []; }
  GetComponentInChildren(t, inc) { return this.gameObject ? this.gameObject.GetComponentInChildren(t, inc) : null; }
  GetComponentsInChildren(t, inc) { return this.gameObject ? this.gameObject.GetComponentsInChildren(t, inc) : []; }
  GetComponentInParent(t) { return this.gameObject ? this.gameObject.GetComponentInParent(t) : null; }
  get attachedRigidbody() { return this.GetComponentInParent("Rigidbody"); }
  get isActiveAndEnabled() { return this.enabled && this.gameObject && this.gameObject.activeInHierarchy; }
}

/* ============================ GameObject ============================ */
let __goIdCounter = 1;
class WGameObject {
  constructor(name = "GameObject") {
    this.id = 0;
    this.name = name;
    this.activeSelf = true;
    this.tag = "Untagged";
    this.layer = 0;
    this.components = [];
    this.transform = new WTransform(this);
    this.scene = null;
    this.prefabSource = null;
    this.__destroyed = false;
  }
  get activeInHierarchy() {
    if (!this.activeSelf || this.__destroyed) return false;
    let p = this.transform.parent;
    while (p) { if (!p.gameObject.activeSelf || p.gameObject.__destroyed) return false; p = p.parent; }
    return true;
  }
  SetActive(v) {
    v = !!v;
    if (this.activeSelf === v) return;
    const wasActive = this.activeInHierarchy;
    this.activeSelf = v;
    const nowActive = this.activeInHierarchy;
    if (this.scene && this.scene.playing && wasActive !== nowActive) {
      this.scene.notifyActiveChanged(this, nowActive);
    }
    bumpTransformVersion();
  }
  AddComponent(type, props) {
    const comp = ComponentRegistry.create(type);
    if (!comp) return null;
    comp.gameObject = this;
    this.components.push(comp);
    const meta = comp.typeName === "CSScript"
      ? (typeof CSCompiler !== "undefined" ? CSCompiler.meta(comp.className) : null)
      : ComponentRegistry.meta(comp.typeName);
    if (meta) for (const f of meta.fields) {
      if (f.type === "header") continue;
      if (comp[f.name] === undefined) comp[f.name] = cloneFieldValue(f.default);
    }
    if (props) Object.assign(comp, props);
    if (this.scene && this.scene.playing && this.activeInHierarchy) {
      this.scene.initComponentAtRuntime(comp);
    }
    return comp;
  }
  GetComponent(t) {
    const name = typeof t === "string" ? t : t?.compName || t?.name;
    for (const c of this.components) {
      if (c.__destroyed) continue;
      if (componentMatches(c, name)) return c;
    }
    return null;
  }
  GetComponents(t) {
    const name = typeof t === "string" ? t : t?.compName || t?.name;
    return this.components.filter((c) => !c.__destroyed && componentMatches(c, name));
  }
  GetComponentInChildren(t, includeInactive = false) {
    if (includeInactive || this.activeInHierarchy) {
      const c = this.GetComponent(t);
      if (c) return c;
    }
    for (const ch of this.transform.children) {
      const r = ch.gameObject.GetComponentInChildren(t, includeInactive);
      if (r) return r;
    }
    return null;
  }
  GetComponentsInChildren(t, includeInactive = false, out = []) {
    if (includeInactive || this.activeSelf) {
      for (const c of this.components) if (!c.__destroyed && componentMatches(c, typeof t === "string" ? t : t?.compName)) out.push(c);
      for (const ch of this.transform.children) ch.gameObject.GetComponentsInChildren(t, includeInactive, out);
    }
    return out;
  }
  GetComponentInParent(t) {
    let go = this;
    while (go) {
      const c = go.GetComponent(t);
      if (c) return c;
      go = go.transform.parent ? go.transform.parent.gameObject : null;
    }
    return null;
  }
  CompareTag(tag) { return this.tag === tag; }
  removeComponent(comp) {
    const i = this.components.indexOf(comp);
    if (i >= 0) { this.components.splice(i, 1); comp.__destroyed = true; }
  }
}

function componentMatches(c, name) {
  if (!name) return false;
  const tn = c.typeName;
  if (tn === name) return true;
  if (tn === "CSScript") {
    if (c.className === name) return true;
    if (name === "MonoBehaviour" || name === "Behaviour") return true;
    return false;
  }
  if (name === "Collider") return tn === "BoxCollider" || tn === "SphereCollider" || tn === "CapsuleCollider";
  if (name === "Renderer") return tn === "MeshRenderer";
  if (name === "Behaviour" || name === "Component") return true;
  return false;
}

function cloneFieldValue(v) {
  if (v instanceof Vector3) return v.clone();
  if (v instanceof Color) return v.clone();
  if (v instanceof Quaternion) return v.clone();
  if (Array.isArray(v)) return v.map(cloneFieldValue);
  if (v && typeof v === "object") return JSON.parse(JSON.stringify(v));
  return v;
}

/* ============================ Component registry ============================ */
const ComponentRegistry = (() => {
  const types = new Map(); // name -> {name, icon, category, cls, fields, gizmo?}
  function register(def) { types.set(def.name, def); }
  function meta(name) { return types.get(name) || null; }
  function create(type) {
    if (typeof type !== "string") type = type?.compName || type?.name;
    // C# script class?
    if (typeof CSCompiler !== "undefined" && CSCompiler.hasClass(type)) {
      return CSCompiler.createScriptComponent(type);
    }
    const def = types.get(type);
    if (!def) { console.warn("Unknown component type: " + type); return null; }
    return new def.cls();
  }
  function allTypes() { return [...types.values()]; }
  return { register, meta, create, allTypes };
})();

/* ============================ Scene ============================ */
class WScene {
  constructor(name = "Untitled") {
    this.name = name;
    this.roots = [];
    this.objectsById = new Map();
    this.playing = false;
    this.settings = {
      gravity: new Vector3(0, -9.81, 0),
      fixedTimestep: 1 / 50,
      timeScale: 1,
    };
    this.runtime = null; // set by WRuntime while playing
  }
  registerObject(go, id) {
    go.id = id || __goIdCounter++;
    if (go.id >= __goIdCounter) __goIdCounter = go.id + 1;
    go.scene = this;
    this.objectsById.set(go.id, go);
  }
  createObject(name, parent = null) {
    const go = new WGameObject(name);
    this.registerObject(go);
    if (parent) go.transform.SetParent(parent.transform || parent, false);
    else this.roots.push(go);
    return go;
  }
  addRoot(go) {
    this.registerObject(go);
    this.roots.push(go);
    // register children recursively
    const reg = (t) => { for (const c of t.children) { this.registerObject(c.gameObject); reg(c); } };
    reg(go.transform);
  }
  destroyObject(go) {
    if (go.__destroyed) return;
    const destroyRec = (g) => {
      g.__destroyed = true;
      for (const c of g.components) c.__destroyed = true;
      for (const ch of [...g.transform.children]) destroyRec(ch.gameObject);
      this.objectsById.delete(g.id);
    };
    if (this.playing && this.runtime) this.runtime.notifyDestroy(go);
    destroyRec(go);
    if (go.transform.parent) {
      const arr = go.transform.parent.children;
      const i = arr.indexOf(go.transform);
      if (i >= 0) arr.splice(i, 1);
    } else {
      const i = this.roots.indexOf(go);
      if (i >= 0) this.roots.splice(i, 1);
    }
    bumpTransformVersion();
  }
  getById(id) { return this.objectsById.get(id) || null; }
  *iterate(includeInactive = true) {
    const stack = [...this.roots].reverse();
    while (stack.length) {
      const go = stack.pop();
      if (go.__destroyed) continue;
      if (!includeInactive && !go.activeSelf) continue;
      yield go;
      for (let i = go.transform.children.length - 1; i >= 0; i--)
        stack.push(go.transform.children[i].gameObject);
    }
  }
  find(name) { for (const go of this.iterate()) if (go.name === name) return go; return null; }
  findWithTag(tag) { for (const go of this.iterate()) if (go.tag === tag && go.activeInHierarchy) return go; return null; }
  findAllWithTag(tag) { const r = []; for (const go of this.iterate()) if (go.tag === tag && go.activeInHierarchy) r.push(go); return r; }
  findComponents(type, includeInactive = false) {
    const out = [];
    for (const go of this.iterate()) {
      if (!includeInactive && !go.activeInHierarchy) continue;
      for (const c of go.components) if (!c.__destroyed && componentMatches(c, type)) out.push(c);
    }
    return out;
  }
  notifyActiveChanged(go, nowActive) { if (this.runtime) this.runtime.notifyActiveChanged(go, nowActive); }
  initComponentAtRuntime(comp) { if (this.runtime) this.runtime.initComponentLate(comp); }

  /* ---------- serialization ---------- */
  serialize() {
    const objs = [];
    const serializeGO = (go, parentId) => {
      const rec = {
        id: go.id, name: go.name, active: go.activeSelf, tag: go.tag, layer: go.layer,
        parent: parentId,
        prefab: go.prefabSource || undefined,
        t: {
          p: go.transform._localPos.toJSON(),
          r: go.transform._localRot.toJSON(),
          s: go.transform._localScale.toJSON(),
        },
        components: go.components.filter((c) => !c.__destroyed).map((c) => serializeComponent(c)),
      };
      objs.push(rec);
      for (const ch of go.transform.children) serializeGO(ch.gameObject, go.id);
    };
    for (const r of this.roots) if (!r.__destroyed) serializeGO(r, 0);
    return {
      name: this.name,
      settings: {
        gravity: this.settings.gravity.toJSON(),
        fixedTimestep: this.settings.fixedTimestep,
      },
      objects: objs,
    };
  }
  static deserialize(data) {
    const scene = new WScene(data.name || "Scene");
    if (data.settings) {
      scene.settings.gravity = Vector3.from(data.settings.gravity);
      scene.settings.fixedTimestep = data.settings.fixedTimestep || 1 / 50;
    }
    const byId = new Map();
    const pendingRefs = [];
    for (const rec of data.objects) {
      const go = new WGameObject(rec.name);
      go.activeSelf = rec.active !== false;
      go.tag = rec.tag || "Untagged";
      go.layer = rec.layer || 0;
      go.prefabSource = rec.prefab || null;
      scene.registerObject(go, rec.id);
      byId.set(rec.id, go);
      go.transform._localPos = Vector3.from(rec.t.p);
      go.transform._localRot = Quaternion.from(rec.t.r);
      go.transform._localScale = Vector3.from(rec.t.s);
      if (rec.parent && byId.has(rec.parent)) {
        const p = byId.get(rec.parent);
        go.transform._parent = p.transform;
        p.transform.children.push(go.transform);
      } else {
        scene.roots.push(go);
      }
      for (const crec of rec.components || []) {
        const comp = deserializeComponent(crec, pendingRefs);
        if (comp) { comp.gameObject = go; go.components.push(comp); }
      }
    }
    // resolve object references
    for (const fix of pendingRefs) {
      const resolve = (v) => {
        if (v && typeof v === "object" && v.$ref !== undefined) {
          const go = byId.get(v.$ref) || null;
          if (!go) return null;
          if (v.kind === "GameObject") return go;
          if (v.kind === "Transform" || !v.kind) return go.transform;
          return go.GetComponent(v.kind) || go.transform;
        }
        return v;
      };
      if (fix.isArray) {
        fix.comp[fix.field] = (fix.value || []).map(resolve);
      } else {
        fix.comp[fix.field] = resolve(fix.value);
      }
    }
    bumpTransformVersion();
    return scene;
  }
}

/* ---------- component (de)serialization helpers ---------- */
function encodeRef(v) {
  if (v === null || v === undefined || v.__destroyed) return null;
  if (v instanceof WGameObject) return { $ref: v.id, kind: "GameObject" };
  if (v instanceof WTransform) return { $ref: v.gameObject.id, kind: "Transform" };
  if (v instanceof WComponent) return { $ref: v.gameObject.id, kind: v.typeName === "CSScript" ? v.className : v.typeName };
  if (v && v.__isScriptComp) return { $ref: v.gameObject.id, kind: v.className };
  return null;
}
function encodeFieldValue(v, ftype) {
  if (ftype === "objectRef") return encodeRef(v);
  if (ftype === "objectRefArray") return (v || []).map(encodeRef).filter(Boolean);
  if (v instanceof Vector3 || v instanceof Quaternion || v instanceof Color) return v.toJSON();
  return v;
}
function serializeComponent(c) {
  const isScript = c.typeName === "CSScript";
  if (c.__isMissingStub) {
    return { type: "CSScript", class: c.className, enabled: c.enabled !== false, props: c.__rawProps || {} };
  }
  const metaName = isScript ? c.className : c.typeName;
  const meta = isScript
    ? (typeof CSCompiler !== "undefined" ? CSCompiler.meta(metaName) : null)
    : ComponentRegistry.meta(metaName);
  const props = {};
  if (meta) {
    for (const f of meta.fields) {
      if (f.type === "header") continue;
      props[f.name] = encodeFieldValue(c[f.name], f.type);
    }
  }
  return { type: isScript ? "CSScript" : c.typeName, class: isScript ? c.className : undefined, enabled: c.enabled !== false, props };
}
function decodeFieldValue(raw, f) {
  if (raw === null || raw === undefined) return f.type === "objectRefArray" ? [] : (raw === null ? null : cloneFieldValue(f.default));
  switch (f.type) {
    case "vector3": return Vector3.from(raw);
    case "color": return Color.from(raw);
    case "float": case "int": return typeof raw === "number" ? raw : parseFloat(raw) || 0;
    case "bool": return !!raw;
    default: return raw;
  }
}
function deserializeComponent(crec, pendingRefs) {
  let comp = null, metaName = crec.type;
  if (crec.type === "CSScript") {
    metaName = crec.class;
    comp = (typeof CSCompiler !== "undefined") ? CSCompiler.createScriptComponent(crec.class) : null;
    if (!comp) {
      // preserve data for scripts that failed to compile / were removed
      comp = CSCompiler.createStub(crec.class, crec.props);
      comp.enabled = crec.enabled !== false;
      return comp;
    }
  } else {
    const def = ComponentRegistry.meta(crec.type);
    if (!def) return null;
    comp = new def.cls();
  }
  comp.enabled = crec.enabled !== false;
  const meta = crec.type === "CSScript" ? CSCompiler.meta(metaName) : ComponentRegistry.meta(metaName);
  if (meta) {
    for (const f of meta.fields) {
      if (f.type === "header") continue;
      const raw = crec.props ? crec.props[f.name] : undefined;
      if (f.type === "objectRef" || f.type === "objectRefArray") {
        comp[f.name] = f.type === "objectRefArray" ? [] : null;
        pendingRefs.push({ comp, field: f.name, value: raw, isArray: f.type === "objectRefArray" });
      } else if (raw === undefined) {
        comp[f.name] = cloneFieldValue(f.default);
      } else {
        comp[f.name] = decodeFieldValue(raw, f);
      }
    }
  }
  return comp;
}

/* Duplicate a GameObject subtree (used by editor duplicate & prefab instantiate & script Instantiate) */
function cloneGameObjectTree(source, scene) {
  // serialize subtree then rebuild with fresh ids, preserving internal refs
  const objs = [];
  const collect = (go, parentId) => {
    objs.push({
      oldId: go.id, name: go.name, active: go.activeSelf, tag: go.tag, layer: go.layer,
      parent: parentId, prefab: go.prefabSource,
      t: { p: go.transform._localPos.toJSON(), r: go.transform._localRot.toJSON(), s: go.transform._localScale.toJSON() },
      components: go.components.filter((c) => !c.__destroyed).map(serializeComponent),
    });
    for (const ch of go.transform.children) collect(ch.gameObject, go.id);
  };
  collect(source, 0);
  return instantiateSerializedTree(objs, scene);
}
function instantiateSerializedTree(objs, scene) {
  const idMap = new Map();
  const created = [];
  const pendingRefs = [];
  for (const rec of objs) {
    const go = new WGameObject(rec.name);
    go.activeSelf = rec.active !== false;
    go.tag = rec.tag || "Untagged";
    go.layer = rec.layer || 0;
    go.prefabSource = rec.prefab || null;
    scene.registerObject(go);
    idMap.set(rec.oldId, go);
    go.transform._localPos = Vector3.from(rec.t.p);
    go.transform._localRot = Quaternion.from(rec.t.r);
    go.transform._localScale = Vector3.from(rec.t.s);
    if (rec.parent && idMap.has(rec.parent)) {
      const p = idMap.get(rec.parent);
      go.transform._parent = p.transform;
      p.transform.children.push(go.transform);
    }
    for (const crec of rec.components || []) {
      const comp = deserializeComponent(crec, pendingRefs);
      if (comp) { comp.gameObject = go; go.components.push(comp); }
    }
    created.push(go);
  }
  for (const fix of pendingRefs) {
    const resolve = (v) => {
      if (v && typeof v === "object" && v.$ref !== undefined) {
        let go = idMap.get(v.$ref);
        if (!go && scene.objectsById.has(v.$ref)) go = scene.objectsById.get(v.$ref); // external ref
        if (!go) return null;
        if (v.kind === "GameObject") return go;
        if (v.kind === "Transform" || !v.kind) return go.transform;
        return go.GetComponent(v.kind) || go.transform;
      }
      return v;
    };
    if (fix.isArray) fix.comp[fix.field] = (fix.value || []).map(resolve).filter((x) => x !== null);
    else fix.comp[fix.field] = resolve(fix.value);
  }
  const root = created[0];
  bumpTransformVersion();
  return root;
}

/* ============================ Asset database ============================ */
const WAssets = (() => {
  let materials = new Map();  // path -> material def (plain object with Color instances)
  let prefabs = new Map();    // path -> serialized tree (objs array, oldId-based)
  let scripts = new Map();    // path -> {source}
  let scenes = new Map();     // path -> scene JSON
  let audioClips = new Map(); // path -> {clip: synthName}
  let textures = new Map();   // path -> {tex: rendererTexName}

  function reset() { materials.clear(); prefabs.clear(); scripts.clear(); scenes.clear(); audioClips.clear(); textures.clear(); }

  function defineMaterial(path, def) {
    materials.set(path, {
      name: path.split("/").pop().replace(".mat", ""),
      color: Color.from(def.color || Color.white),
      emission: Color.from(def.emission || Color.black),
      emissionIntensity: def.emissionIntensity ?? 1,
      texture: def.texture || null,
      texScale: def.texScale ?? 1,
      specular: def.specular ?? 0.25,
      specPower: def.specPower ?? 32,
      transparent: !!def.transparent,
      alpha: def.alpha ?? 1,
    });
  }
  function getMaterial(path) { return materials.get(path) || null; }
  function serializeMaterials() {
    const out = {};
    for (const [path, m] of materials) {
      out[path] = {
        color: m.color.toJSON(), emission: m.emission.toJSON(), emissionIntensity: m.emissionIntensity,
        texture: m.texture, texScale: m.texScale, specular: m.specular, specPower: m.specPower,
        transparent: m.transparent, alpha: m.alpha,
      };
    }
    return out;
  }
  function loadMaterials(obj) { materials.clear(); for (const p in obj) defineMaterial(p, obj[p]); }

  return {
    reset,
    materials, prefabs, scripts, scenes, audioClips, textures,
    defineMaterial, getMaterial, serializeMaterials, loadMaterials,
    definePrefab(path, objs) { prefabs.set(path, objs); },
    getPrefab(path) { return prefabs.get(path); },
    defineScript(path, source) { scripts.set(path, { source }); },
    getScript(path) { return scripts.get(path); },
    defineAudioClip(path, synthName) { audioClips.set(path, { clip: synthName }); },
    getAudioClip(path) { return audioClips.get(path); },
    defineTexture(path, texName) { textures.set(path, { tex: texName }); },
    allPaths() {
      return [...materials.keys(), ...prefabs.keys(), ...scripts.keys(), ...scenes.keys(),
        ...audioClips.keys(), ...textures.keys()];
    },
  };
})();
