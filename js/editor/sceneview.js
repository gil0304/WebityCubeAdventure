/* Webity editor — Scene View: editor camera, picking, translate gizmo, grid, debug drawing */
"use strict";

const SceneView = (() => {
  let regionEl = null;
  // orbit camera state
  let pivot = new Vector3(0, 1, 10);
  let yaw = 12, pitch = 26, dist = 22;
  let rmbDown = false, panning = false;
  let lastX = 0, lastY = 0;
  let gizmosEnabled = true;
  // gizmo drag state
  let drag = null; // {axis: Vector3, startPos: Vector3, t0: number, go}

  function activeScene() { return Editor.playing ? WRuntime.scene : Editor.scene; }

  function camRotation() { return Quaternion.Euler(pitch, yaw, 0); }
  function camPos() { return pivot.sub(camRotation().mulV(Vector3.forward).mul(dist)); }
  function cameraParams(aspect) {
    const rot = camRotation();
    const pos = camPos();
    const world = Matrix4.TRS(pos, rot, Vector3.one);
    return { view: world.invert(), proj: Matrix4.Perspective(60, aspect, 0.05, 500), pos };
  }

  function init() {
    regionEl = document.getElementById("scene-view-region");
    regionEl.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    regionEl.addEventListener("wheel", (e) => {
      e.preventDefault();
      const f = Math.exp(e.deltaY * 0.0012);
      dist = Mathf.Clamp(dist * f, 1.5, 220);
    }, { passive: false });
    regionEl.addEventListener("contextmenu", (e) => e.preventDefault());
    regionEl.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
    regionEl.addEventListener("drop", (e) => {
      e.preventDefault();
      const path = e.dataTransfer.getData("text/webity-prefab");
      if (!path) return;
      const ray = rayFromEvent(e);
      if (!ray) return;
      let point = null;
      const s = activeScene();
      const hit = s ? WPhysics.raycast(s, ray.origin, ray.dir, 500, -1, false) : null;
      if (hit) point = hit.point;
      else if (Math.abs(ray.dir.y) > 1e-4) {
        const t = -ray.origin.y / ray.dir.y;
        if (t > 0) point = ray.origin.add(ray.dir.mul(t));
      }
      Editor.instantiatePrefab(path, point);
    });
    window.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "f" || e.key === "F") frameSelection();
    });
  }

  function regionRect() { return regionEl.getBoundingClientRect(); }

  function rayFromEvent(e) {
    const r = regionRect();
    if (r.width < 2) return null;
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
    const cam = cameraParams(r.width / r.height);
    const invVP = cam.proj.mul(cam.view).invert();
    const pFar = invVP.mulPoint(new Vector3(nx, ny, 0.7));
    const dir = pFar.sub(cam.pos).normalized;
    return { origin: cam.pos, dir };
  }

  /* ---------------- pointer interaction ---------------- */
  function onPointerDown(e) {
    if (e.target.closest(".viewport-tools")) return;
    lastX = e.clientX; lastY = e.clientY;
    if (e.button === 2) { rmbDown = true; regionEl.setPointerCapture?.(e.pointerId); return; }
    if (e.button === 1 || (e.button === 0 && e.altKey)) { panning = true; return; }
    if (e.button === 0) {
      const ray = rayFromEvent(e);
      if (!ray) return;
      // gizmo grab?
      const sel = Editor.selectedGameObject();
      if (sel) {
        const grab = gizmoHitTest(ray, sel);
        if (grab) {
          drag = grab;
          return;
        }
      }
      // pick
      const picked = pick(ray);
      Editor.select(picked ? { kind: "go", id: picked.id } : null);
    }
  }

  function onPointerMove(e) {
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (rmbDown) {
      yaw += dx * 0.25;
      pitch = Mathf.Clamp(pitch + dy * 0.25, -89, 89);
      return;
    }
    if (panning) {
      const rot = camRotation();
      const right = rot.mulV(Vector3.right), up = rot.mulV(Vector3.up);
      const k = dist * 0.0016;
      pivot = pivot.sub(right.mul(dx * k)).add(up.mul(dy * k));
      return;
    }
    if (drag) {
      const ray = rayFromEvent(e);
      if (!ray) return;
      const t = axisParam(ray, drag.worldStart, drag.axis);
      if (t === null) return;
      const newPos = drag.worldStart.add(drag.axis.mul(t - drag.t0));
      const go = drag.go;
      if (!go.__destroyed) {
        go.transform.position = newPos;
        Editor.markSceneEdited();
        Inspector.refresh(true);
      }
    }
  }

  function onPointerUp(e) {
    if (e.button === 2) rmbDown = false;
    if (e.button === 1 || e.button === 0) panning = false;
    if (e.button === 0) drag = null;
  }

  function update(dt) {
    if (!rmbDown) return;
    // fly with WASD/QE while RMB held (raw keys, even without game capture)
    const speed = (WInput.rawKeyHeld("LeftShift") ? 24 : 9) * dt;
    const rot = camRotation();
    let move = new Vector3();
    if (WInput.rawKeyHeld("W")) move = move.add(rot.mulV(Vector3.forward));
    if (WInput.rawKeyHeld("S")) move = move.sub(rot.mulV(Vector3.forward));
    if (WInput.rawKeyHeld("D")) move = move.add(rot.mulV(Vector3.right));
    if (WInput.rawKeyHeld("A")) move = move.sub(rot.mulV(Vector3.right));
    if (WInput.rawKeyHeld("E")) move = move.add(Vector3.up);
    if (WInput.rawKeyHeld("Q")) move = move.sub(Vector3.up);
    if (move.sqrMagnitude > 0) pivot = pivot.add(move.normalized.mul(speed));
  }

  function frameSelection() {
    const go = Editor.selectedGameObject();
    if (!go) return;
    pivot = go.transform.position;
    dist = Mathf.Clamp(go.transform.lossyScale.magnitude * 3 + 4, 3, 60);
  }

  /* ---------------- picking ---------------- */
  function pick(ray) {
    const s = activeScene();
    if (!s) return null;
    let best = null, bestDist = Infinity;
    const hit = WPhysics.raycast(s, ray.origin, ray.dir, 500, -1, true);
    if (hit) { best = hit.gameObject; bestDist = hit.distance; }
    // mesh bounds for collider-less objects
    for (const go of s.iterate()) {
      if (!go.activeInHierarchy) continue;
      const mf = go.GetComponent("MeshFilter");
      if (!mf) continue;
      const mesh = MeshLib.get(mf.mesh || "Cube");
      const inv = go.transform.worldMatrix.invert();
      const lo = inv.mulPoint(ray.origin);
      const lp = inv.mulPoint(ray.origin.add(ray.dir));
      const ld = lp.sub(lo);
      const t = rayAABB(lo, ld, mesh.bounds.min, mesh.bounds.max);
      if (t !== null && t >= 0) {
        const worldHit = go.transform.worldMatrix.mulPoint(lo.add(ld.mul(t)));
        const d = Vector3.Distance(ray.origin, worldHit);
        if (d < bestDist) { bestDist = d; best = go; }
      }
    }
    return best;
  }
  function rayAABB(o, d, min, max) {
    let tmin = -Infinity, tmax = Infinity;
    for (const k of ["x", "y", "z"]) {
      if (Math.abs(d[k]) < 1e-9) {
        if (o[k] < min[k] || o[k] > max[k]) return null;
      } else {
        let t1 = (min[k] - o[k]) / d[k], t2 = (max[k] - o[k]) / d[k];
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }
    return tmin >= 0 ? tmin : (tmax >= 0 ? 0 : null);
  }

  /* ---------------- gizmo ---------------- */
  const AXES = [
    { dir: new Vector3(1, 0, 0), color: [0.93, 0.26, 0.27, 1], rot: Quaternion.Euler(0, 0, -90) },
    { dir: new Vector3(0, 1, 0), color: [0.55, 0.86, 0.25, 1], rot: Quaternion.identity },
    { dir: new Vector3(0, 0, 1), color: [0.25, 0.56, 0.94, 1], rot: Quaternion.Euler(90, 0, 0) },
  ];
  function gizmoScale(pos) { return Vector3.Distance(camPos(), pos) * 0.17; }

  function axisParam(ray, base, axis) {
    // parameter t of closest point on line (base + axis*t) to the ray
    const r = WPhysicsClosest(ray.origin, ray.origin.add(ray.dir.mul(600)), base.sub(axis.mul(600)), base.add(axis.mul(600)));
    if (!r) return null;
    return Vector3.Dot(r.c2.sub(base), axis);
  }
  function WPhysicsClosest(p1, q1, p2, q2) {
    // reuse segment-segment closest point (duplicated small impl)
    const d1 = q1.sub(p1), d2 = q2.sub(p2), r = p1.sub(p2);
    const a = d1.sqrMagnitude, e = d2.sqrMagnitude, f = Vector3.Dot(d2, r);
    const c = Vector3.Dot(d1, r), b = Vector3.Dot(d1, d2);
    const denom = a * e - b * b;
    let s = denom > 1e-10 ? Mathf.Clamp01((b * f - c * e) / denom) : 0;
    let t = e > 1e-10 ? (b * s + f) / e : 0;
    t = Mathf.Clamp(t, 0, 1);
    return { c1: p1.add(d1.mul(s)), c2: p2.add(d2.mul(t)) };
  }

  function gizmoHitTest(ray, go) {
    const pos = go.transform.position;
    const scale = gizmoScale(pos);
    let best = null, bestD = scale * 0.16;
    for (const ax of AXES) {
      const a = pos, b = pos.add(ax.dir.mul(scale * 1.15));
      const r = WPhysicsClosest(ray.origin, ray.origin.add(ray.dir.mul(600)), a, b);
      const d = Vector3.Distance(r.c1, r.c2);
      if (d < bestD) {
        bestD = d;
        best = ax;
      }
    }
    if (!best) return null;
    const t0 = axisParam(ray, pos, best.dir);
    if (t0 === null) return null;
    return { axis: best.dir, worldStart: pos, t0, go };
  }

  /* ---------------- overlay drawing ---------------- */
  function circleVerts(center, radius, axis, out) {
    const N = 40;
    let u, v;
    if (axis === "y") { u = new Vector3(1, 0, 0); v = new Vector3(0, 0, 1); }
    else if (axis === "x") { u = new Vector3(0, 1, 0); v = new Vector3(0, 0, 1); }
    else { u = new Vector3(1, 0, 0); v = new Vector3(0, 1, 0); }
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      const p0 = center.add(u.mul(Math.cos(a0) * radius)).add(v.mul(Math.sin(a0) * radius));
      const p1 = center.add(u.mul(Math.cos(a1) * radius)).add(v.mul(Math.sin(a1) * radius));
      out.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
    }
  }
  function boxEdges(matrix, min, max, out) {
    const corners = [];
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z])
      corners.push(matrix.mulPoint(new Vector3(x, y, z)));
    const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (const [a, b] of edges) out.push(corners[a].x, corners[a].y, corners[a].z, corners[b].x, corners[b].y, corners[b].z);
  }

  function colliderWire(comp, out) {
    const shape = WPhysics.shapeFor(comp);
    if (!shape) return;
    if (shape.kind === "box") {
      const m = Matrix4.TRS(shape.center, shape.rot, Vector3.one);
      boxEdges(m, shape.half.neg(), shape.half, out);
    } else if (shape.kind === "sphere") {
      circleVerts(shape.center, shape.radius, "x", out);
      circleVerts(shape.center, shape.radius, "y", out);
      circleVerts(shape.center, shape.radius, "z", out);
    } else if (shape.kind === "capsule") {
      circleVerts(shape.p0, shape.radius, "y", out);
      circleVerts(shape.p1, shape.radius, "y", out);
      for (const off of [[shape.radius, 0], [-shape.radius, 0], [0, shape.radius], [0, -shape.radius]]) {
        const o = new Vector3(off[0], 0, off[1]);
        const a = shape.p0.add(o), bb = shape.p1.add(o);
        out.push(a.x, a.y, a.z, bb.x, bb.y, bb.z);
      }
      circleVerts(shape.p0.sub(new Vector3(0, shape.radius, 0)).add(new Vector3(0, shape.radius, 0)), shape.radius, "y", out);
    }
  }

  function buildOverlays(scene) {
    const lines = [];
    const solids = [];

    // grid
    const gridFaint = [], gridMajor = [];
    const EXT = 60;
    for (let i = -EXT; i <= EXT; i++) {
      const arr = i % 10 === 0 ? gridMajor : gridFaint;
      arr.push(i, 0, -EXT, i, 0, EXT);
      arr.push(-EXT, 0, i, EXT, 0, i);
    }
    lines.push({ verts: gridFaint, color: [1, 1, 1, 0.055], depthTest: true });
    lines.push({ verts: gridMajor, color: [1, 1, 1, 0.13], depthTest: true });

    const selGo = Editor.selectedGameObject();

    // all-collider gizmos
    if (gizmosEnabled && scene) {
      const colWire = [], trigWire = [], rangeWire = [];
      for (const go of scene.iterate()) {
        if (!go.activeInHierarchy) continue;
        for (const c of go.components) {
          if (c.__destroyed || !c.enabled) continue;
          const tn = c.typeName;
          if (tn === "BoxCollider" || tn === "SphereCollider" || tn === "CapsuleCollider") {
            colliderWire(c, c.isTrigger ? trigWire : colWire);
          }
          if (tn === "CSScript" && c.className === "EnemyController") {
            circleVerts(go.transform.position, c.detectionDistance || 0, "y", rangeWire);
          }
        }
      }
      lines.push({ verts: colWire, color: [0.55, 0.95, 0.55, 0.35], depthTest: true });
      lines.push({ verts: trigWire, color: [0.4, 0.9, 0.9, 0.4], depthTest: true });
      lines.push({ verts: rangeWire, color: [0.95, 0.85, 0.3, 0.5], depthTest: true });
    }

    if (selGo && !selGo.__destroyed && scene) {
      // selection outline (mesh bounds of self + children)
      const selWire = [];
      const collect = (go) => {
        const mf = go.GetComponent("MeshFilter");
        if (mf && go.activeInHierarchy) {
          const mesh = MeshLib.get(mf.mesh || "Cube");
          boxEdges(go.transform.worldMatrix, mesh.bounds.min, mesh.bounds.max, selWire);
        }
        for (const ch of go.transform.children) collect(ch.gameObject);
      };
      collect(selGo);
      if (!selWire.length) {
        const p = selGo.transform.position;
        boxEdges(Matrix4.TRS(p, Quaternion.identity, Vector3.one),
          new Vector3(-0.3, -0.3, -0.3), new Vector3(0.3, 0.3, 0.3), selWire);
      }
      lines.push({ verts: selWire, color: [1, 0.62, 0.14, 0.9], depthTest: false });

      // selected colliders (bright)
      const selCol = [];
      for (const c of selGo.components) {
        const tn = c.typeName;
        if (!c.__destroyed && (tn === "BoxCollider" || tn === "SphereCollider" || tn === "CapsuleCollider"))
          colliderWire(c, selCol);
      }
      lines.push({ verts: selCol, color: [0.45, 1, 0.45, 0.95], depthTest: false });

      // camera frustum
      const cam = selGo.GetComponent("Camera");
      if (cam) {
        const t = selGo.transform;
        const fr = [];
        const fov = (cam.fov || 60) * DEG2RAD / 2;
        const aspect = 16 / 9;
        for (const d of [1, 12]) {
          const h = Math.tan(fov) * d, w = h * aspect;
          const cs = [
            t.TransformPoint(new Vector3(-w, -h, d)), t.TransformPoint(new Vector3(w, -h, d)),
            t.TransformPoint(new Vector3(w, h, d)), t.TransformPoint(new Vector3(-w, h, d)),
          ];
          for (let i = 0; i < 4; i++) {
            const a = cs[i], b = cs[(i + 1) % 4];
            fr.push(a.x, a.y, a.z, b.x, b.y, b.z);
          }
          if (d > 1) {
            for (let i = 0; i < 4; i++) {
              const a = t.position, b = cs[i];
              fr.push(a.x, a.y, a.z, b.x, b.y, b.z);
            }
          }
        }
        lines.push({ verts: fr, color: [1, 1, 1, 0.4], depthTest: true });
      }
      // light direction
      const light = selGo.GetComponent("Light");
      if (light) {
        const t = selGo.transform, fwd = t.forward;
        const lr = [];
        for (const off of [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]]) {
          const o = t.position.add(t.right.mul(off[0])).add(t.up.mul(off[1]));
          const e2 = o.add(fwd.mul(3));
          lr.push(o.x, o.y, o.z, e2.x, e2.y, e2.z);
        }
        lines.push({ verts: lr, color: [1, 0.95, 0.5, 0.8], depthTest: true });
      }

      // translate gizmo
      const pos = selGo.transform.position;
      const scale = gizmoScale(pos);
      for (const ax of AXES) {
        const tip = pos.add(ax.dir.mul(scale));
        lines.push({ verts: [pos.x, pos.y, pos.z, tip.x, tip.y, tip.z], color: ax.color, depthTest: false });
        const coneMat = Matrix4.TRS(tip, ax.rot, new Vector3(scale * 0.11, scale * 0.22, scale * 0.11));
        solids.push({ mesh: MeshLib.get("Cone"), matrix: coneMat, color: ax.color, depthTest: false });
      }
    }
    return { lines, solids };
  }

  return {
    init, update, cameraParams, buildOverlays, frameSelection,
    get gizmosEnabled() { return gizmosEnabled; },
    set gizmosEnabled(v) { gizmosEnabled = v; },
    focusOn(p) { pivot = Vector3.from(p); },
  };
})();
