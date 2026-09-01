/* Webity C# runtime API — the "UnityEngine" surface available to compiled scripts */
"use strict";

const CSApi = (() => {
  const ctx = {
    scene: null,        // active runtime scene
    runtime: null,      // WRuntime while playing
    log: (level, msg) => console.log(`[${level}]`, msg), // replaced by console panel
    gameViewSize: { w: 960, h: 540 },
  };

  /* ---------------- Time ---------------- */
  const TimeAPI = {
    deltaTime: 0, fixedDeltaTime: 0.02, unscaledDeltaTime: 0,
    time: 0, unscaledTime: 0, realtimeSinceStartup: 0,
    timeScale: 1, frameCount: 0,
    _reset() { this.deltaTime = 0; this.time = 0; this.unscaledTime = 0; this.timeScale = 1; this.frameCount = 0; },
  };

  /* ---------------- Input ---------------- */
  const InputAPI = {
    GetAxis: (n) => WInput.GetAxis(n),
    GetAxisRaw: (n) => WInput.GetAxisRaw(n),
    GetKey: (k) => WInput.GetKey(k),
    GetKeyDown: (k) => WInput.GetKeyDown(k),
    GetKeyUp: (k) => WInput.GetKeyUp(k),
    GetButton: (b) => WInput.GetButton(b),
    GetButtonDown: (b) => WInput.GetButtonDown(b),
    GetButtonUp: (b) => WInput.GetButtonUp(b),
    get anyKeyDown() { return WInput.anyKeyDown; },
    get anyKey() { return WInput.anyKey; },
  };
  const KeyCode = new Proxy({}, { get: (_, k) => (typeof k === "string" ? k : "") });

  /* ---------------- Debug ---------------- */
  const Debug = {
    Log: (msg) => ctx.log("log", OP.str(msg)),
    LogWarning: (msg) => ctx.log("warn", OP.str(msg)),
    LogError: (msg) => ctx.log("error", OP.str(msg)),
    LogFormat: (fmt, ...a) => ctx.log("log", OP.str(fmt) + " " + a.map(OP.str).join(" ")),
    DrawRay: () => {}, DrawLine: () => {},
    Assert: (cond, msg) => { if (!cond) ctx.log("error", "Assertion failed: " + OP.str(msg || "")); },
  };
  const print = (m) => Debug.Log(m);

  /* ---------------- Physics ---------------- */
  function isOutBox(x) { return x && typeof x === "object" && x.__isOut === true; }
  const Physics = {
    get gravity() { return ctx.scene ? ctx.scene.settings.gravity.clone() : new Vector3(0, -9.81, 0); },
    set gravity(v) { if (ctx.scene) ctx.scene.settings.gravity = Vector3.from(v); },
    Raycast(...args) {
      // (origin, dir), (origin, dir, maxDist), (origin, dir, out hit, maxDist?), (origin, dir, maxDist, mask), (origin, dir, out hit, maxDist, mask)
      const origin = args[0], dir = args[1];
      let outBox = null, maxDist = Infinity, mask = -1;
      const rest = args.slice(2);
      const nums = [];
      for (const a of rest) {
        if (isOutBox(a)) outBox = a;
        else if (typeof a === "number") nums.push(a);
      }
      if (nums.length >= 1) maxDist = nums[0];
      if (nums.length >= 2) mask = nums[1];
      if (!ctx.scene) return false;
      const hit = WPhysics.raycast(ctx.scene, Vector3.from(origin), Vector3.from(dir), maxDist, mask);
      if (outBox) outBox.v = hit ? makeRaycastHit(hit) : new RaycastHit();
      return !!hit;
    },
    CheckSphere(center, radius, mask = -1) {
      return ctx.scene ? WPhysics.checkSphere(ctx.scene, Vector3.from(center), radius, mask) : false;
    },
    OverlapSphere(center, radius, mask = -1) {
      return ctx.scene ? WPhysics.overlapSphere(ctx.scene, Vector3.from(center), radius, mask) : [];
    },
    SphereCast(...args) { return Physics.Raycast(...args); },
    Linecast(a, b, mask = -1) {
      const d = Vector3.from(b).sub(Vector3.from(a));
      const m = d.magnitude;
      if (m < 1e-6) return false;
      return ctx.scene ? !!WPhysics.raycast(ctx.scene, Vector3.from(a), d.div(m), m, mask) : false;
    },
  };
  class RaycastHit {
    constructor() { this.point = new Vector3(); this.normal = Vector3.up; this.distance = 0; this.collider = null; this.transform = null; }
  }
  function makeRaycastHit(h) {
    const r = new RaycastHit();
    r.point = h.point; r.normal = h.normal; r.distance = h.distance;
    r.collider = h.collider; r.transform = h.transform;
    r.rigidbody = h.gameObject ? h.gameObject.GetComponent("Rigidbody") : null;
    return r;
  }

  /* ---------------- LayerMask ---------------- */
  const LayerMask = {
    GetMask(...names) {
      let m = 0;
      for (const n of names) { const i = LAYERS.indexOf(n); if (i >= 0) m |= 1 << i; }
      return m;
    },
    NameToLayer: (n) => LAYERS.indexOf(n),
    LayerToName: (i) => LAYERS[i] || "",
  };

  /* ---------------- misc enums / helpers ---------------- */
  const Space = { World: "World", Self: "Self" };
  const ForceMode = { Force: "Force", Impulse: "Impulse", VelocityChange: "VelocityChange", Acceleration: "Force" };
  class WaitForSeconds { constructor(s) { this.seconds = s; } }
  class WaitForSecondsRealtime { constructor(s) { this.seconds = s; } }
  class WaitForFixedUpdate {}
  class CSException extends Error { constructor(msg) { super(OP.str(msg)); } }
  class Dictionary {
    constructor() { this.map = new Map(); }
    get Count() { return this.map.size; }
    Add(k, v) { this.map.set(k, v); }
    Remove(k) { return this.map.delete(k); }
    ContainsKey(k) { return this.map.has(k); }
    get_Item(k) { return this.map.get(k); }
    set_Item(k, v) { this.map.set(k, v); }
    Clear() { this.map.clear(); }
    get Keys() { return new CSList([...this.map.keys()]); }
    get Values() { return new CSList([...this.map.values()]); }
    [Symbol.iterator]() { return this.map[Symbol.iterator](); }
  }
  const PlayerPrefs = {
    SetFloat: (k, v) => localStorage.setItem("webity.pp." + k, String(v)),
    GetFloat: (k, d = 0) => { const v = localStorage.getItem("webity.pp." + k); return v === null ? d : parseFloat(v); },
    SetInt: (k, v) => localStorage.setItem("webity.pp." + k, String(v)),
    GetInt: (k, d = 0) => { const v = localStorage.getItem("webity.pp." + k); return v === null ? d : parseInt(v); },
    SetString: (k, v) => localStorage.setItem("webity.pp." + k, v),
    GetString: (k, d = "") => localStorage.getItem("webity.pp." + k) ?? d,
    HasKey: (k) => localStorage.getItem("webity.pp." + k) !== null,
    DeleteKey: (k) => localStorage.removeItem("webity.pp." + k),
  };
  const ScreenAPI = {
    get width() { return ctx.gameViewSize.w; },
    get height() { return ctx.gameViewSize.h; },
  };
  const Application = {
    get isPlaying() { return !!ctx.runtime; },
    targetFrameRate: 60,
    Quit() { Debug.Log("Application.Quit() is ignored in the web player."); },
  };
  const SceneManager = {
    LoadScene(name) { if (ctx.runtime) ctx.runtime.requestReload(typeof name === "string" ? name : null); },
    GetActiveScene() { return { name: ctx.scene ? ctx.scene.name : "" }; },
  };
  const Gizmos = { DrawWireSphere: () => {}, DrawWireCube: () => {}, DrawLine: () => {}, DrawRay: () => {}, color: null };

  /* ---------------- GameObject constructor-function ---------------- */
  function GameObjectFn(name) {
    if (!ctx.scene) throw new Error("GameObject can only be created in Play mode");
    const go = ctx.scene.createObject(name || "GameObject");
    return go;
  }
  GameObjectFn.Find = (name) => (ctx.scene ? ctx.scene.find(name) : null);
  GameObjectFn.FindWithTag = (tag) => (ctx.scene ? ctx.scene.findWithTag(tag) : null);
  GameObjectFn.FindGameObjectWithTag = GameObjectFn.FindWithTag;
  GameObjectFn.FindGameObjectsWithTag = (tag) => (ctx.scene ? ctx.scene.findAllWithTag(tag) : []);

  /* ---------------- Object statics ---------------- */
  function Destroy(obj, delay = 0) {
    if (!ctx.runtime || !obj) return;
    ctx.runtime.scheduleDestroy(obj, delay);
  }
  const DestroyImmediate = (obj) => Destroy(obj, 0);
  function Instantiate(original, a, b, c) {
    if (!ctx.scene || !original) return null;
    const srcGo = original instanceof WGameObject ? original
      : (original && original.gameObject) ? original.gameObject : null;
    if (!srcGo) return null;
    const clone = cloneGameObjectTree(srcGo, ctx.scene);
    let parent = null, pos = null, rot = null;
    if (a instanceof Vector3) { pos = a; rot = b instanceof Quaternion ? b : null; parent = c || null; }
    else if (a instanceof WTransform) parent = a;
    if (parent) clone.transform.SetParent(parent, false);
    else ctx.scene.roots.push(clone);
    if (pos) clone.transform.position = pos;
    if (rot) clone.transform.rotation = rot;
    clone.name = srcGo.name + "(Clone)";
    if (ctx.runtime) ctx.runtime.initTree(clone);
    return original instanceof WGameObject ? clone
      : clone.GetComponent(original.typeName === "CSScript" ? original.className : original.typeName) || clone;
  }
  function FindObjectOfType(typeName) {
    return ctx.scene ? (ctx.scene.findComponents(typeName)[0] || null) : null;
  }
  function FindObjectsOfType(typeName) {
    return ctx.scene ? ctx.scene.findComponents(typeName) : [];
  }
  const DontDestroyOnLoad = () => {};
  const ObjectAPI = { Destroy, DestroyImmediate, Instantiate, FindObjectOfType, FindObjectsOfType, DontDestroyOnLoad };

  /* ---------------- Camera static ---------------- */
  const CameraStatic = new Proxy(CameraComp, {
    get(target, k) {
      if (k === "main") {
        const go = ctx.scene ? ctx.scene.findWithTag("MainCamera") : null;
        return go ? go.GetComponent("Camera") : null;
      }
      return target[k];
    },
  });

  /* ---------------- MonoBehaviour base ---------------- */
  class MonoBehaviour {
    constructor() {
      this.gameObject = null;
      this.enabled = true;
      this.__destroyed = false;
      this.__awoken = false;
      this.__started = false;
      this.__isScriptComp = true;
    }
    get typeName() { return "CSScript"; }
    get className() { return this.constructor.__className || this.constructor.name; }
    get transform() { return this.gameObject ? this.gameObject.transform : null; }
    get name() { return this.gameObject ? this.gameObject.name : ""; }
    set name(v) { if (this.gameObject) this.gameObject.name = v; }
    get tag() { return this.gameObject ? this.gameObject.tag : ""; }
    set tag(v) { if (this.gameObject) this.gameObject.tag = v; }
    get isActiveAndEnabled() { return this.enabled && this.gameObject && this.gameObject.activeInHierarchy; }
    GetComponent(t) { return this.gameObject ? this.gameObject.GetComponent(t) : null; }
    GetComponents(t) { return this.gameObject ? this.gameObject.GetComponents(t) : []; }
    GetComponentInChildren(t, inc) { return this.gameObject ? this.gameObject.GetComponentInChildren(t, inc) : null; }
    GetComponentsInChildren(t, inc) { return this.gameObject ? this.gameObject.GetComponentsInChildren(t, inc) : []; }
    GetComponentInParent(t) { return this.gameObject ? this.gameObject.GetComponentInParent(t) : null; }
    CompareTag(t) { return this.gameObject ? this.gameObject.tag === t : false; }
    StartCoroutine(gen) {
      if (typeof gen === "string") {
        const fn = this[gen];
        if (typeof fn !== "function") { Debug.LogError(`Coroutine '${gen}' not found on ${this.className}`); return null; }
        gen = fn.call(this);
      }
      if (!gen || typeof gen.next !== "function") { Debug.LogError("StartCoroutine requires an IEnumerator"); return null; }
      return ctx.runtime ? ctx.runtime.addCoroutine(this, gen) : null;
    }
    StopCoroutine(handle) { if (ctx.runtime) ctx.runtime.stopCoroutine(this, handle); }
    StopAllCoroutines() { if (ctx.runtime) ctx.runtime.stopAllCoroutines(this); }
    Invoke(method, t) { if (ctx.runtime) ctx.runtime.addInvoke(this, method, t, 0); }
    InvokeRepeating(method, t, rate) { if (ctx.runtime) ctx.runtime.addInvoke(this, method, t, rate); }
    CancelInvoke(method) { if (ctx.runtime) ctx.runtime.cancelInvoke(this, method); }
    IsInvoking(method) { return ctx.runtime ? ctx.runtime.isInvoking(this, method) : false; }
    SendMessage(method, arg) {
      if (this.gameObject && ctx.runtime) ctx.runtime.sendMessage(this.gameObject, method, arg);
    }
  }

  /* ---------------- type checks ---------------- */
  function isType(x, name) {
    if (x === null || x === undefined) return false;
    if (x instanceof WGameObject) return name === "GameObject" || name === "Object";
    if (x instanceof WTransform) return name === "Transform" || name === "Component" || name === "Object";
    if (x instanceof MonoBehaviour) {
      let c = x.constructor;
      while (c) {
        if (c.__className === name) return true;
        c = Object.getPrototypeOf(c);
      }
      return name === "MonoBehaviour" || name === "Behaviour" || name === "Component";
    }
    if (x instanceof WComponent) return componentMatches(x, name);
    if (typeof x === "string") return name === "string";
    if (typeof x === "number") return ["float", "int", "double"].includes(name);
    return false;
  }

  /* extend OP with helpers the emitter uses */
  OP.len = (x) => {
    if (x === null || x === undefined) throw new Error("NullReferenceException");
    if (Array.isArray(x) || typeof x === "string") return x.length;
    if (typeof x.Count === "number") return x.Count;
    if (typeof x.length === "number") return x.length;
    return 0;
  };
  const STRING_METHOD_MAP = {
    ToUpper: (s) => s.toUpperCase(), ToLower: (s) => s.toLowerCase(),
    Contains: (s, a) => s.includes(a), StartsWith: (s, a) => s.startsWith(a),
    EndsWith: (s, a) => s.endsWith(a), Trim: (s) => s.trim(),
    Replace: (s, a, b) => s.split(a).join(b), Split: (s, a) => s.split(a),
    IndexOf: (s, a) => s.indexOf(a), PadLeft: (s, n, c) => s.padStart(n, c || " "),
    PadRight: (s, n, c) => s.padEnd(n, c || " "),
    Substring: (s, a, b) => (b === undefined ? s.slice(a) : s.substr(a, b)),
  };
  OP.invoke = (obj, name, args) => {
    if (obj === null || obj === undefined) throw new Error("NullReferenceException: calling " + name + " on null");
    if (typeof obj === "string") {
      const fn = STRING_METHOD_MAP[name];
      if (fn) return fn(obj, ...args);
    }
    if (typeof obj[name] === "function") return obj[name](...args);
    if (Array.isArray(obj)) {
      if (name === "Contains") return obj.includes(args[0]);
      if (name === "IndexOf") return obj.indexOf(args[0]);
    }
    throw new Error(`'${name}' is not a member of ${obj.constructor ? obj.constructor.name : typeof obj}`);
  };

  const api = {
    Input: InputAPI, Time: TimeAPI, Mathf, Vector3, Vector2, Quaternion, Color,
    Debug, Physics, Random: WRandom, Screen: ScreenAPI, Application,
    GameObject: GameObjectFn, Object: ObjectAPI,
    WaitForSeconds, WaitForSecondsRealtime, WaitForFixedUpdate, KeyCode, Space, ForceMode,
    LayerMask, SceneManager, Gizmos, PlayerPrefs, List: CSList, Dictionary,
    Exception: CSException, MonoBehaviour,
    Transform: WTransform, Rigidbody: Rigidbody, Collider: BoxCollider, Collision: Object,
    Camera: CameraStatic, AudioSource, ParticleSystem: ParticleSystemComp, Animator,
    Renderer: MeshRenderer, Light: LightComp, Text: UIText, Image: UIImage,
    Button: UIButton, Canvas: CanvasComp, RaycastHit, AudioClip: Object, Material: Object,
    Destroy, DestroyImmediate, Instantiate, FindObjectOfType, FindObjectsOfType,
    DontDestroyOnLoad, print,
  };

  const CS = {
    api, OP,
    ctx,
    MonoBehaviour,
    iter(x) {
      if (x === null || x === undefined) return [];
      if (typeof x[Symbol.iterator] === "function") return x;
      return [];
    },
    isType,
    asType: (x, name) => (isType(x, name) ? x : null),
    outBox: () => ({ __isOut: true, v: null }),
    newArray: (n, fill) => new Array(Math.max(0, OP.int(n))).fill(fill),
    switchVal: (x) => x,
    makeError: (x) => (x instanceof Error ? x : new CSException(OP.str(x))),
    primitives: { float: Number, int: Number, double: Number, string: String, bool: Boolean },
  };
  return CS;
})();
