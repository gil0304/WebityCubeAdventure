/* Webity runtime — play-mode world lifecycle, script scheduling, physics events, rendering helpers */
"use strict";

const WRuntime = (() => {
  let scene = null;
  let playing = false;
  let paused = false;
  let coroutines = [];
  let invokes = [];
  let destroyQueue = [];
  let pendingStart = [];
  let fixedAccum = 0;
  let reloadRequest = false;
  let startSnapshot = null;
  let errorStreak = new Map(); // "Class.Method" -> count (avoid console flood is handled by console collapse)

  const Time = CSApi.api.Time;

  function isScript(c) { return c.typeName === "CSScript" && !c.__isMissingStub; }
  function activeScripts() {
    const out = [];
    if (!scene) return out;
    for (const go of scene.iterate()) {
      if (!go.activeInHierarchy) continue;
      for (const c of go.components) {
        if (!c.__destroyed && isScript(c) && c.enabled) out.push(c);
      }
    }
    return out;
  }
  function callSafe(comp, method, arg) {
    const fn = comp[method];
    if (typeof fn !== "function") return;
    try {
      fn.call(comp, arg);
    } catch (e) {
      const key = `${comp.className}.${method}`;
      CSApi.ctx.log("error", `${e.constructor === Error ? "Exception" : (e.name || "Exception")}: ${e.message}\n  at ${key} ()`);
      errorStreak.set(key, (errorStreak.get(key) || 0) + 1);
    }
  }

  function awakenTree(go) {
    // Awake + OnEnable for all script comps under an active GO
    if (!go.activeInHierarchy) return;
    for (const target of subtree(go)) {
      if (!target.activeInHierarchy) continue;
      for (const c of [...target.components]) {
        if (c.__destroyed) continue;
        if (isScript(c)) {
          if (!c.__awoken) { c.__awoken = true; callSafe(c, "Awake"); }
          if (c.enabled && !c.__enabledFired) { c.__enabledFired = true; callSafe(c, "OnEnable"); }
          if (c.enabled && !c.__started) pendingStart.push(c);
        } else if (typeof c.onStartRuntime === "function" && !c.__runtimeStarted) {
          c.__runtimeStarted = true;
          try { c.onStartRuntime(); } catch (e) { /* builtin */ }
        }
      }
    }
  }
  function* subtree(go) {
    yield go;
    for (const ch of go.transform.children) yield* subtree(ch.gameObject);
  }

  function start(sceneData) {
    stop();
    startSnapshot = sceneData;
    scene = WScene.deserialize(sceneData);
    scene.playing = true;
    scene.runtime = api;
    CSApi.ctx.scene = scene;
    CSApi.ctx.runtime = api;
    Time._reset();
    Time.fixedDeltaTime = scene.settings.fixedTimestep;
    WPhysics.resetState();
    coroutines = []; invokes = []; destroyQueue = []; pendingStart = [];
    fixedAccum = 0; reloadRequest = false;
    playing = true; paused = false;
    for (const go of [...scene.roots]) awakenTree(go);
    flushStarts();
    return scene;
  }

  function stop() {
    if (scene) {
      for (const c of activeScripts()) callSafe(c, "OnDestroy");
      scene.playing = false;
      scene.runtime = null;
    }
    WAudio.stopAll();
    playing = false; paused = false;
    scene = null;
    CSApi.ctx.scene = null;
    CSApi.ctx.runtime = null;
    coroutines = []; invokes = []; destroyQueue = []; pendingStart = [];
  }

  function flushStarts() {
    while (pendingStart.length) {
      const batch = pendingStart;
      pendingStart = [];
      for (const c of batch) {
        if (c.__destroyed || c.__started) continue;
        if (!c.enabled || !c.gameObject || !c.gameObject.activeInHierarchy) { pendingStart.push(c); continue; }
        c.__started = true;
        callSafe(c, "Start");
      }
      if (pendingStart.length && pendingStart.every((c) => !c.enabled || !c.gameObject.activeInHierarchy)) break;
    }
  }

  function dispatchPhysicsEvents(events) {
    const map = {
      TriggerEnter: "OnTriggerEnter", TriggerStay: "OnTriggerStay", TriggerExit: "OnTriggerExit",
      CollisionEnter: "OnCollisionEnter", CollisionStay: "OnCollisionStay", CollisionExit: "OnCollisionExit",
    };
    for (const ev of events) {
      if (ev.target.__destroyed) continue;
      const method = map[ev.type];
      for (const c of [...ev.target.components]) {
        if (!c.__destroyed && isScript(c) && c.enabled) callSafe(c, method, ev.arg);
      }
    }
  }

  function doFixedStep(fdt) {
    for (const c of activeScripts()) callSafe(c, "FixedUpdate");
    const events = [];
    WPhysics.step(scene, fdt, events);
    dispatchPhysicsEvents(events);
  }

  function advanceCoroutines() {
    for (const co of [...coroutines]) {
      if (co.done) continue;
      if (co.behaviour.__destroyed || !co.behaviour.gameObject || co.behaviour.gameObject.__destroyed) { co.done = true; continue; }
      if (co.waitUntil !== null && Time.time < co.waitUntil) continue;
      if (co.waitRealUntil !== null && Time.unscaledTime < co.waitRealUntil) continue;
      if (co.waitCoroutine && !co.waitCoroutine.done) continue;
      co.waitUntil = null; co.waitRealUntil = null; co.waitCoroutine = null;
      let r;
      try {
        r = co.it.next();
      } catch (e) {
        CSApi.ctx.log("error", `Exception in coroutine (${co.behaviour.className}): ${e.message}`);
        co.done = true;
        continue;
      }
      if (r.done) { co.done = true; continue; }
      const v = r.value;
      if (v === null || v === undefined) continue;
      if (v instanceof CSApi.api.WaitForSeconds) co.waitUntil = Time.time + v.seconds;
      else if (v instanceof CSApi.api.WaitForSecondsRealtime) co.waitRealUntil = Time.unscaledTime + v.seconds;
      else if (v && typeof v.next === "function") {
        const child = { behaviour: co.behaviour, it: v, waitUntil: null, waitRealUntil: null, waitCoroutine: null, done: false };
        coroutines.push(child);
        co.waitCoroutine = child;
      } else if (v && v.__isCoroutineHandle) {
        co.waitCoroutine = v;
      }
    }
    coroutines = coroutines.filter((c) => !c.done);
  }

  function advanceInvokes() {
    for (const inv of [...invokes]) {
      if (inv.cancelled || inv.behaviour.__destroyed) { inv.done = true; continue; }
      if (Time.time >= inv.at) {
        callSafe(inv.behaviour, inv.method);
        if (inv.repeat > 0) inv.at += inv.repeat;
        else inv.done = true;
      }
    }
    invokes = invokes.filter((i) => !i.done);
  }

  function processDestroyQueue() {
    for (const d of [...destroyQueue]) {
      if (Time.time < d.at) continue;
      d.done = true;
      const obj = d.obj;
      if (!obj || obj.__destroyed) continue;
      if (obj instanceof WGameObject) {
        scene.destroyObject(obj);
      } else if (obj.gameObject) {
        if (isScript(obj)) { callSafe(obj, "OnDisable"); callSafe(obj, "OnDestroy"); }
        obj.gameObject.removeComponent(obj);
      }
    }
    destroyQueue = destroyQueue.filter((d) => !d.done);
  }

  function tick(dtReal) {
    if (!playing || paused || !scene) return;
    frameCore(Math.min(dtReal, 0.1));
  }
  function stepOneFrame() {
    if (!playing || !scene) return;
    frameCore(scene.settings.fixedTimestep, true);
  }
  function frameCore(dtReal, forceFixed = false) {
    Time.unscaledDeltaTime = dtReal;
    Time.unscaledTime += dtReal;
    Time.realtimeSinceStartup += dtReal;
    const scaled = dtReal * Time.timeScale;
    Time.deltaTime = scaled;
    Time.time += scaled;
    Time.frameCount++;

    flushStarts();

    fixedAccum += scaled;
    const fdt = scene.settings.fixedTimestep;
    let steps = 0;
    if (forceFixed) { doFixedStep(fdt); fixedAccum = 0; }
    else {
      while (fixedAccum >= fdt && steps < 5) { doFixedStep(fdt); fixedAccum -= fdt; steps++; }
      if (steps === 5) fixedAccum = 0;
    }

    for (const c of activeScripts()) callSafe(c, "Update");
    // builtin per-frame behaviours
    for (const go of scene.iterate()) {
      if (!go.activeInHierarchy) continue;
      for (const c of go.components) {
        if (!c.__destroyed && c.enabled && typeof c.onUpdateRuntime === "function") {
          try { c.onUpdateRuntime(scaled); } catch (e) { /* builtin */ }
        }
      }
    }
    advanceCoroutines();
    advanceInvokes();
    for (const c of activeScripts()) callSafe(c, "LateUpdate");
    processDestroyQueue();
    WParticles.update(scene, scaled);

    if (reloadRequest) {
      reloadRequest = false;
      const snap = startSnapshot;
      start(snap);
    }
  }

  const api = {
    start, stop, tick, stepOneFrame,
    get scene() { return scene; },
    get playing() { return playing; },
    get paused() { return paused; },
    set paused(v) { paused = v; WAudio.setBgmPaused(v); },
    requestReload() { reloadRequest = true; },

    /* engine callbacks */
    notifyDestroy(go) {
      for (const t of subtree(go)) {
        for (const c of t.components) {
          if (!c.__destroyed && isScript(c)) {
            if (c.enabled && t.activeInHierarchy) callSafe(c, "OnDisable");
            callSafe(c, "OnDestroy");
          }
        }
      }
    },
    notifyActiveChanged(go, nowActive) {
      for (const t of subtree(go)) {
        for (const c of t.components) {
          if (c.__destroyed || !isScript(c)) continue;
          if (nowActive && t.activeInHierarchy) {
            if (!c.__awoken) { c.__awoken = true; callSafe(c, "Awake"); }
            if (c.enabled) { c.__enabledFired = true; callSafe(c, "OnEnable"); if (!c.__started) pendingStart.push(c); }
          } else if (!nowActive) {
            if (c.enabled && c.__enabledFired) { c.__enabledFired = false; callSafe(c, "OnDisable"); }
          }
        }
      }
    },
    initComponentLate(comp) {
      if (!isScript(comp)) {
        if (typeof comp.onStartRuntime === "function") { comp.__runtimeStarted = true; try { comp.onStartRuntime(); } catch (e) {} }
        return;
      }
      if (!comp.__awoken) { comp.__awoken = true; callSafe(comp, "Awake"); }
      if (comp.enabled) { comp.__enabledFired = true; callSafe(comp, "OnEnable"); pendingStart.push(comp); }
    },
    initTree(go) { awakenTree(go); },

    addCoroutine(behaviour, it) {
      const handle = { behaviour, it, waitUntil: null, waitRealUntil: null, waitCoroutine: null, done: false, __isCoroutineHandle: true };
      coroutines.push(handle);
      return handle;
    },
    stopCoroutine(behaviour, handle) {
      if (handle && handle.__isCoroutineHandle) handle.done = true;
    },
    stopAllCoroutines(behaviour) {
      for (const co of coroutines) if (co.behaviour === behaviour) co.done = true;
    },
    addInvoke(behaviour, method, t, repeat) {
      invokes.push({ behaviour, method, at: Time.time + t, repeat: repeat || 0 });
    },
    cancelInvoke(behaviour, method) {
      for (const i of invokes) if (i.behaviour === behaviour && (!method || i.method === method)) i.cancelled = true;
    },
    isInvoking(behaviour, method) {
      return invokes.some((i) => i.behaviour === behaviour && (!method || i.method === method) && !i.cancelled);
    },
    scheduleDestroy(obj, delay) {
      destroyQueue.push({ obj: obj && obj.__isCoroutineHandle ? null : obj, at: Time.time + (delay || 0) });
      if (delay <= 0) processDestroyQueue();
    },
    sendMessage(go, method, arg) {
      if (!go || go.__destroyed || !method) return;
      for (const c of [...go.components]) {
        if (!c.__destroyed && isScript(c) && c.enabled) callSafe(c, method, arg);
      }
    },
    handleUIButton(comp) {
      if (!playing) return;
      WAudio.play("click", 0.7);
      const target = comp.onClickTarget || comp.gameObject;
      if (comp.onClickMessage) api.sendMessage(target, comp.onClickMessage);
    },
  };
  return api;
})();

/* ============ shared rendering helpers (editor + built game) ============ */
const WRender = (() => {
  function buildDrawList(scene) {
    const items = [];
    for (const go of scene.iterate()) {
      if (!go.activeInHierarchy) continue;
      const mf = go.GetComponent("MeshFilter");
      const mr = go.GetComponent("MeshRenderer");
      if (!mf || !mr || !mr.enabled || !mf.enabled) continue;
      const mat = mr.resolveMaterial();
      const mesh = MeshLib.get(mf.mesh || "Cube");
      const em = Color.from(mat.emission);
      const ei = mat.emissionIntensity ?? 1;
      items.push({
        mesh,
        matrix: go.transform.worldMatrix,
        color: [mat.color.r, mat.color.g, mat.color.b, mat.transparent ? mat.alpha : 1],
        emission: [em.r * ei, em.g * ei, em.b * ei],
        texture: mat.texture, texScale: mat.texScale,
        specular: mat.specular, specPower: mat.specPower,
        transparent: mat.transparent,
        castShadow: mr.castShadows !== false,
        receiveShadow: mr.receiveShadows !== false,
        worldPos: go.transform.position,
        gameObject: go,
      });
    }
    return items;
  }

  function envParams(scene) {
    let lightDir = new Vector3(-0.4, -0.85, 0.35).normalized;
    let lightColor = [1, 0.956, 0.89];
    let intensity = 1;
    const lights = scene.findComponents("Light");
    if (lights.length) {
      const L = lights[0];
      lightDir = L.transform.forward;
      const c = Color.from(L.color);
      intensity = L.intensity ?? 1;
      lightColor = [c.r * intensity, c.g * intensity, c.b * intensity];
    }
    const pp = scene.findComponents("PostProcessVolume")[0] || null;
    const col = (c, d) => { const x = pp ? Color.from(pp[c]) : d; return [x.r, x.g, x.b]; };
    return {
      lightDir: [-lightDir.x, -lightDir.y, -lightDir.z],
      lightColor,
      skyTop: col("skyTop", new Color(0.28, 0.48, 0.78)),
      skyHorizon: col("skyHorizon", new Color(0.74, 0.82, 0.92)),
      skyBottom: col("skyBottom", new Color(0.24, 0.22, 0.25)),
      ambientSky: col("ambientSky", new Color(0.42, 0.47, 0.55)),
      ambientGround: col("ambientGround", new Color(0.22, 0.2, 0.19)),
      fogColor: pp ? [Color.from(pp.fogColor).r, Color.from(pp.fogColor).g, Color.from(pp.fogColor).b, 1] : [0.68, 0.76, 0.88, 1],
      fogDensity: pp ? pp.fogDensity : 0.008,
      shadows: !lights.length || lights[0].shadows !== false,
    };
  }

  function postParams(scene) {
    const pp = scene.findComponents("PostProcessVolume")[0];
    if (!pp || !pp.enabled) return { vignette: 0, saturation: 1, exposure: 1, contrast: 1, bloom: 0 };
    return {
      vignette: pp.vignette, saturation: pp.saturation, exposure: pp.exposure,
      contrast: pp.contrast, bloom: pp.bloom,
    };
  }

  function cameraParams(camComp, aspect) {
    const t = camComp.transform;
    const world = Matrix4.TRS(t.position, t.rotation, Vector3.one);
    return {
      view: world.invert(),
      proj: Matrix4.Perspective(camComp.fov || 60, aspect, camComp.nearClip || 0.1, camComp.farClip || 300),
      pos: t.position,
    };
  }

  function mainCamera(scene) {
    const go = scene.findWithTag("MainCamera");
    if (go) { const c = go.GetComponent("Camera"); if (c && c.enabled) return c; }
    const cams = scene.findComponents("Camera");
    return cams[0] || null;
  }

  function shadowFocus(drawList) {
    if (!drawList.length) return { focus: new Vector3(), extent: 40 };
    const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const it of drawList) {
      const p = it.worldPos;
      min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y); min.z = Math.min(min.z, p.z);
      max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y); max.z = Math.max(max.z, p.z);
    }
    const focus = min.add(max).mul(0.5);
    const extent = Math.max(20, Math.min(70, max.sub(min).magnitude * 0.6 + 10));
    return { focus, extent };
  }

  return { buildDrawList, envParams, postParams, cameraParams, mainCamera, shadowFocus };
})();
