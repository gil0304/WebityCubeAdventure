/* Webity physics — rigidbody integration, capsule/sphere vs OBB/sphere/capsule solving,
   triggers, collision events, raycasts, kinematic platform carrying */
"use strict";

const WPhysics = (() => {

  /* ---------- world-space shape construction ---------- */
  function shapeFor(collider) {
    const t = collider.transform;
    const m = t.worldMatrix;
    const rot = t.rotation;
    const scale = t.lossyScale;
    const tn = collider.typeName;
    const center = m.mulPoint(Vector3.from(collider.center || Vector3.zero));
    if (tn === "BoxCollider") {
      const size = Vector3.from(collider.size || Vector3.one);
      const half = new Vector3(
        Math.abs(size.x * scale.x) / 2,
        Math.abs(size.y * scale.y) / 2,
        Math.abs(size.z * scale.z) / 2
      );
      return {
        kind: "box", center, half, rot,
        ax: rot.mulV(Vector3.right), ay: rot.mulV(Vector3.up), az: rot.mulV(Vector3.forward),
        collider,
      };
    }
    if (tn === "SphereCollider") {
      const r = collider.radius * Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
      return { kind: "sphere", center, radius: r, collider };
    }
    if (tn === "CapsuleCollider") {
      const r = collider.radius * Math.max(Math.abs(scale.x), Math.abs(scale.z));
      const h = Math.max(collider.height * Math.abs(scale.y), r * 2);
      const half = Math.max(0, h / 2 - r);
      const up = rot.mulV(Vector3.up);
      return {
        kind: "capsule", center, radius: r,
        p0: center.sub(up.mul(half)), p1: center.add(up.mul(half)),
        collider,
      };
    }
    return null;
  }

  /* ---------- primitive distance helpers ---------- */
  function toBoxLocal(shape, p) {
    const d = p.sub(shape.center);
    return new Vector3(Vector3.Dot(d, shape.ax), Vector3.Dot(d, shape.ay), Vector3.Dot(d, shape.az));
  }
  function fromBoxLocalDir(shape, v) {
    return shape.ax.mul(v.x).add(shape.ay.mul(v.y)).add(shape.az.mul(v.z));
  }
  function clampToBox(l, h) {
    return new Vector3(
      Mathf.Clamp(l.x, -h.x, h.x),
      Mathf.Clamp(l.y, -h.y, h.y),
      Mathf.Clamp(l.z, -h.z, h.z)
    );
  }
  function sqrDistPointBoxLocal(l, h) {
    let d = 0;
    for (const k of ["x", "y", "z"]) {
      const e = Math.abs(l[k]) - h[k];
      if (e > 0) d += e * e;
    }
    return d;
  }
  /* closest point on segment (a..b) to box via ternary search (convex along segment) */
  function closestTOnSegmentToBox(aL, bL, h) {
    let lo = 0, hi = 1;
    const f = (t) => sqrDistPointBoxLocal(Vector3.Lerp(aL, bL, t), h);
    for (let i = 0; i < 28; i++) {
      const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
      if (f(m1) < f(m2)) hi = m2; else lo = m1;
    }
    return (lo + hi) / 2;
  }
  function closestPtSegmentSegment(p1, q1, p2, q2) {
    const d1 = q1.sub(p1), d2 = q2.sub(p2), r = p1.sub(p2);
    const a = d1.sqrMagnitude, e = d2.sqrMagnitude, f = Vector3.Dot(d2, r);
    let s, t;
    if (a <= 1e-10 && e <= 1e-10) { s = 0; t = 0; }
    else if (a <= 1e-10) { s = 0; t = Mathf.Clamp01(f / e); }
    else {
      const c = Vector3.Dot(d1, r);
      if (e <= 1e-10) { t = 0; s = Mathf.Clamp01(-c / a); }
      else {
        const b = Vector3.Dot(d1, d2), denom = a * e - b * b;
        s = denom > 1e-10 ? Mathf.Clamp01((b * f - c * e) / denom) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = Mathf.Clamp01(-c / a); }
        else if (t > 1) { t = 1; s = Mathf.Clamp01((b - c) / a); }
      }
    }
    return { c1: p1.add(d1.mul(s)), c2: p2.add(d2.mul(t)) };
  }

  /* Generic contact: returns {normal (push dir for shape A), depth, point} or null.
     A is the dynamic shape (sphere or capsule), B is any shape. */
  function contact(A, B) {
    if (A.kind === "sphere") return contactSphere(A.center, A.radius, B);
    if (A.kind === "capsule") return contactCapsule(A, B);
    if (A.kind === "box") return contactSphere(A.center, Math.min(A.half.x, A.half.y, A.half.z), B); // approx
    return null;
  }
  function contactSphere(c, r, B) {
    if (B.kind === "sphere") {
      const d = c.sub(B.center), dist = d.magnitude;
      if (dist >= r + B.radius) return null;
      const n = dist > 1e-7 ? d.div(dist) : Vector3.up;
      return { normal: n, depth: r + B.radius - dist, point: B.center.add(n.mul(B.radius)) };
    }
    if (B.kind === "capsule") {
      const cp = closestPtSegmentSegment(c, c, B.p0, B.p1);
      const d = c.sub(cp.c2), dist = d.magnitude;
      if (dist >= r + B.radius) return null;
      const n = dist > 1e-7 ? d.div(dist) : Vector3.up;
      return { normal: n, depth: r + B.radius - dist, point: cp.c2.add(n.mul(B.radius)) };
    }
    if (B.kind === "box") {
      const l = toBoxLocal(B, c);
      const q = clampToBox(l, B.half);
      const diff = l.sub(q);
      const dist2 = diff.sqrMagnitude;
      if (dist2 > 1e-12) {
        const dist = Math.sqrt(dist2);
        if (dist >= r) return null;
        const n = fromBoxLocalDir(B, diff.div(dist));
        return { normal: n, depth: r - dist, point: B.center.add(fromBoxLocalDir(B, q)) };
      }
      // center inside box: push out along min-penetration face
      let best = Infinity, nL = new Vector3(0, 1, 0);
      for (const k of ["x", "y", "z"]) {
        const pen = B.half[k] - Math.abs(l[k]);
        if (pen < best) {
          best = pen;
          nL = new Vector3(0, 0, 0);
          nL[k] = l[k] >= 0 ? 1 : -1;
        }
      }
      return { normal: fromBoxLocalDir(B, nL), depth: best + r, point: c.clone() };
    }
    return null;
  }
  function contactCapsule(A, B) {
    if (B.kind === "box") {
      const aL = toBoxLocal(B, A.p0), bL = toBoxLocal(B, A.p1);
      const t = closestTOnSegmentToBox(aL, bL, B.half);
      const segPt = Vector3.Lerp(A.p0, A.p1, t);
      return contactSphere(segPt, A.radius, B);
    }
    if (B.kind === "sphere") {
      const cp = closestPtSegmentSegment(A.p0, A.p1, B.center, B.center);
      return contactSphere(cp.c1, A.radius, B);
    }
    if (B.kind === "capsule") {
      const cp = closestPtSegmentSegment(A.p0, A.p1, B.p0, B.p1);
      const d = cp.c1.sub(cp.c2), dist = d.magnitude;
      if (dist >= A.radius + B.radius) return null;
      const n = dist > 1e-7 ? d.div(dist) : Vector3.up;
      return { normal: n, depth: A.radius + B.radius - dist, point: cp.c2.add(n.mul(B.radius)) };
    }
    return null;
  }
  function overlaps(A, B) { return contact(A, B) !== null || contact(B, A) !== null; }

  /* ---------- ray casts ---------- */
  function rayVsShape(origin, dir, maxDist, shape) {
    if (shape.kind === "sphere" || shape.kind === "capsule") {
      const spheres = shape.kind === "sphere"
        ? [{ c: shape.center, r: shape.radius }]
        : [{ c: shape.p0, r: shape.radius }, { c: shape.p1, r: shape.radius },
           { c: shape.p0.add(shape.p1).mul(0.5), r: shape.radius }];
      let best = null;
      for (const s of spheres) {
        const oc = origin.sub(s.c);
        const b = Vector3.Dot(oc, dir);
        const c = oc.sqrMagnitude - s.r * s.r;
        const disc = b * b - c;
        if (disc < 0) continue;
        const t = -b - Math.sqrt(disc);
        if (t < 0 || t > maxDist) continue;
        if (!best || t < best.distance) {
          const p = origin.add(dir.mul(t));
          best = { distance: t, point: p, normal: p.sub(s.c).normalized };
        }
      }
      return best;
    }
    if (shape.kind === "box") {
      const oL = toBoxLocal(shape, origin);
      const dL = new Vector3(Vector3.Dot(dir, shape.ax), Vector3.Dot(dir, shape.ay), Vector3.Dot(dir, shape.az));
      let tmin = 0, tmax = maxDist;
      let nAxis = "x", nSign = 1;
      for (const k of ["x", "y", "z"]) {
        if (Math.abs(dL[k]) < 1e-9) {
          if (Math.abs(oL[k]) > shape.half[k]) return null;
        } else {
          let t1 = (-shape.half[k] - oL[k]) / dL[k];
          let t2 = (shape.half[k] - oL[k]) / dL[k];
          let sign = -1;
          if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
          if (t1 > tmin) { tmin = t1; nAxis = k; nSign = sign; }
          tmax = Math.min(tmax, t2);
          if (tmin > tmax) return null;
        }
      }
      if (tmin <= 0 || tmin > maxDist) return null;
      const nL = new Vector3(0, 0, 0); nL[nAxis] = nSign;
      return { distance: tmin, point: origin.add(dir.mul(tmin)), normal: fromBoxLocalDir(shape, nL) };
    }
    return null;
  }

  /* ---------- collider collection ---------- */
  function collectColliders(scene) {
    const solids = [], triggers = [];
    for (const go of scene.iterate()) {
      if (!go.activeInHierarchy) continue;
      for (const c of go.components) {
        if (c.__destroyed || !c.enabled) continue;
        const tn = c.typeName;
        if (tn !== "BoxCollider" && tn !== "SphereCollider" && tn !== "CapsuleCollider") continue;
        const s = shapeFor(c);
        if (!s) continue;
        s.gameObject = go;
        s.rigidbody = go.GetComponentInParent ? go.GetComponentInParent("Rigidbody") : go.GetComponent("Rigidbody");
        (c.isTrigger ? triggers : solids).push(s);
      }
    }
    return { solids, triggers };
  }

  /* ---------- main step ---------- */
  // persistent maps: kinematic collider movement deltas, trigger/collision pair states
  const kinematicLastPos = new Map(); // gameObject.id -> {pos, rotY}
  let triggerPairs = new Map();       // "bodyGoId:colliderCompId" -> {a, b}
  let collisionPairs = new Map();
  let compIdCounter = 1;
  function compId(c) { if (!c.__physId) c.__physId = compIdCounter++; return c.__physId; }

  function resetState() {
    kinematicLastPos.clear();
    triggerPairs = new Map();
    collisionPairs = new Map();
  }

  function step(scene, dt, events) {
    const { solids, triggers } = collectColliders(scene);
    const gravity = scene.settings.gravity;

    // dynamic bodies: non-kinematic rigidbodies that own a (non-trigger) collider
    const bodies = [];
    const kinematics = new Map(); // goId -> delta of kinematic collider owners
    for (const go of scene.iterate()) {
      if (!go.activeInHierarchy) continue;
      const rb = go.GetComponent("Rigidbody");
      if (!rb || rb.__destroyed || !rb.enabled) continue;
      if (rb.isKinematic) {
        // apply MovePosition/MoveRotation
        if (rb._movePos) { go.transform.position = rb._movePos; rb._movePos = null; }
        if (rb._moveRot) { go.transform.rotation = rb._moveRot; rb._moveRot = null; }
        const cur = go.transform.position;
        const last = kinematicLastPos.get(go.id);
        kinematics.set(go.id, {
          delta: last ? cur.sub(last.pos) : new Vector3(),
          rotDeltaY: last ? deltaYaw(last.rot, go.transform.rotation) : 0,
          pos: cur,
        });
        kinematicLastPos.set(go.id, { pos: cur.clone(), rot: go.transform.rotation });
        continue;
      }
      bodies.push({ go, rb });
    }

    for (const body of bodies) {
      const { go, rb } = body;
      // integrate velocity
      let v = rb.velocity;
      if (rb.useGravity) v = v.add(gravity.mul(dt));
      if (rb._accumForce.sqrMagnitude > 0) {
        v = v.add(rb._accumForce.mul(dt / Math.max(rb.mass, 0.001)));
        rb._accumForce = new Vector3();
      }
      if (rb.drag > 0) v = v.mul(1 / (1 + rb.drag * dt));
      rb.velocity = v;
      // integrate position
      go.transform.position = go.transform.position.add(v.mul(dt));

      // resolve against solids
      const prevGroundCollider = rb._groundCollider;
      rb._grounded = false;
      rb._groundCollider = null;
      rb._groundNormal = Vector3.up;
      const myColliders = go.GetComponents("Collider");
      const newContacts = new Map(); // otherCompId -> contact info
      for (let iter = 0; iter < 3; iter++) {
        let any = false;
        for (const myCol of myColliders) {
          if (myCol.isTrigger) continue;
          const myShape = shapeFor(myCol);
          myShape.gameObject = go;
          for (const other of solids) {
            if (other.gameObject === go) continue;
            if (other.gameObject.transform.IsChildOf(go.transform)) continue;
            const ct = contact(myShape, other);
            if (!ct) continue;
            any = true;
            // positional correction
            go.transform.position = go.transform.position.add(ct.normal.mul(ct.depth));
            // velocity correction (no restitution)
            const vn = Vector3.Dot(rb.velocity, ct.normal);
            if (vn < 0) rb.velocity = rb.velocity.sub(ct.normal.mul(vn));
            if (ct.normal.y > 0.55) {
              rb._grounded = true;
              rb._groundCollider = other.collider;
              rb._groundNormal = ct.normal;
            }
            newContacts.set(compId(other.collider), {
              other, point: ct.point, normal: ct.normal.neg(),
            });
            // refresh my shape after moving
            const ms = shapeFor(myCol); ms.gameObject = go;
            Object.assign(myShape, ms);
          }
        }
        if (!any) break;
      }

      // moving platform carry
      if (rb._grounded && rb._groundCollider) {
        const ownerGo = rb._groundCollider.gameObject;
        const kin = kinematics.get(ownerGo.id) || (ownerGo.transform.parent && kinematics.get(ownerGo.transform.parent.gameObject.id));
        if (kin) {
          if (kin.delta.sqrMagnitude > 0) go.transform.position = go.transform.position.add(kin.delta);
          if (Math.abs(kin.rotDeltaY) > 1e-6) {
            const pivot = kin.pos;
            const q = Quaternion.AngleAxis(kin.rotDeltaY, Vector3.up);
            const d = go.transform.position.sub(pivot);
            go.transform.position = pivot.add(q.mulV(d));
          }
        }
      } else if (prevGroundCollider) {
        // just left ground: inherit platform velocity so jumps off moving platforms feel right
        const ownerGo = prevGroundCollider.gameObject;
        if (ownerGo && !ownerGo.__destroyed) {
          const kin = kinematics.get(ownerGo.id);
          if (kin && kin.delta.sqrMagnitude > 0 && dt > 0) {
            const pv = kin.delta.div(dt);
            rb.velocity = rb.velocity.add(new Vector3(pv.x * 0.9, Math.max(0, pv.y * 0.5), pv.z * 0.9));
          }
        }
      }

      // collision events
      const bodyKey = go.id;
      for (const [otherId, info] of newContacts) {
        const key = bodyKey + ":" + otherId;
        const collision = {
          gameObject: info.other.gameObject,
          collider: info.other.collider,
          transform: info.other.gameObject.transform,
          contacts: new CSList([{ point: info.point, normal: info.normal }]),
          relativeVelocity: rb.velocity.clone(),
        };
        const selfCollision = {
          gameObject: go, collider: myColliders[0] || null, transform: go.transform,
          contacts: new CSList([{ point: info.point, normal: info.normal.neg() }]),
          relativeVelocity: rb.velocity.clone(),
        };
        if (!collisionPairs.has(key)) {
          events.push({ type: "CollisionEnter", target: go, arg: collision });
          events.push({ type: "CollisionEnter", target: info.other.gameObject, arg: selfCollision });
        } else {
          events.push({ type: "CollisionStay", target: go, arg: collision });
          events.push({ type: "CollisionStay", target: info.other.gameObject, arg: selfCollision });
        }
        collisionPairs.set(key, { go, other: info.other.gameObject, frame: true });
      }
    }

    // collision exits
    for (const [key, pair] of [...collisionPairs]) {
      if (!pair.frame) {
        collisionPairs.delete(key);
        if (!pair.go.__destroyed && !pair.other.__destroyed) {
          events.push({ type: "CollisionExit", target: pair.go, arg: { gameObject: pair.other, transform: pair.other.transform, contacts: new CSList([]) } });
          events.push({ type: "CollisionExit", target: pair.other, arg: { gameObject: pair.go, transform: pair.go.transform, contacts: new CSList([]) } });
        }
      } else pair.frame = false;
    }

    // ---- triggers: every rigidbody (incl. kinematic) with any collider vs all triggers ----
    const allBodies = [];
    for (const go of scene.iterate()) {
      if (!go.activeInHierarchy) continue;
      const rb = go.GetComponent("Rigidbody");
      if (!rb || rb.__destroyed || !rb.enabled) continue;
      const cols = go.GetComponents("Collider").filter((c) => c.enabled);
      if (cols.length) allBodies.push({ go, cols });
    }
    for (const { go, cols } of allBodies) {
      for (const trig of triggers) {
        if (trig.gameObject === go) continue;
        if (trig.gameObject.transform.IsChildOf(go.transform)) continue;
        let hit = false;
        for (const myCol of cols) {
          const myShape = shapeFor(myCol);
          if (contact(myShape, trig) || contact(trig, myShape)) { hit = true; break; }
        }
        const key = go.id + ":" + compId(trig.collider);
        if (hit) {
          const myCollider = cols[0];
          if (!triggerPairs.has(key)) {
            events.push({ type: "TriggerEnter", target: trig.gameObject, arg: myCollider });
            events.push({ type: "TriggerEnter", target: go, arg: trig.collider });
          } else {
            events.push({ type: "TriggerStay", target: trig.gameObject, arg: myCollider });
            events.push({ type: "TriggerStay", target: go, arg: trig.collider });
          }
          triggerPairs.set(key, { go, trigGo: trig.gameObject, trigCol: trig.collider, myCol: cols[0], frame: true });
        }
      }
    }
    for (const [key, pair] of [...triggerPairs]) {
      if (!pair.frame) {
        triggerPairs.delete(key);
        if (!pair.trigGo.__destroyed && !pair.go.__destroyed) {
          events.push({ type: "TriggerExit", target: pair.trigGo, arg: pair.myCol });
          events.push({ type: "TriggerExit", target: pair.go, arg: pair.trigCol });
        }
      } else pair.frame = false;
    }
  }

  function deltaYaw(qa, qb) {
    const a = qa.eulerAngles.y, b = qb.eulerAngles.y;
    return Mathf.DeltaAngle(a, b);
  }

  function layerMatch(go, mask) {
    if (mask === undefined || mask === null || mask === -1 || mask === 0) return true;
    return (mask & (1 << go.layer)) !== 0;
  }

  function raycast(scene, origin, dir, maxDist = Infinity, mask = -1, includeTriggers = false) {
    dir = dir.normalized;
    const { solids, triggers } = collectColliders(scene);
    const list = includeTriggers ? solids.concat(triggers) : solids;
    let best = null;
    for (const s of list) {
      if (!layerMatch(s.gameObject, mask)) continue;
      const h = rayVsShape(origin, dir, maxDist, s);
      if (h && (!best || h.distance < best.distance)) {
        best = h;
        best.collider = s.collider;
        best.gameObject = s.gameObject;
        best.transform = s.gameObject.transform;
      }
    }
    return best;
  }

  function checkSphere(scene, center, radius, mask = -1) {
    const { solids } = collectColliders(scene);
    const probe = { kind: "sphere", center, radius };
    for (const s of solids) {
      if (!layerMatch(s.gameObject, mask)) continue;
      if (contact(probe, s)) return true;
    }
    return false;
  }

  function overlapSphere(scene, center, radius, mask = -1) {
    const { solids, triggers } = collectColliders(scene);
    const probe = { kind: "sphere", center, radius };
    const out = [];
    for (const s of solids.concat(triggers)) {
      if (!layerMatch(s.gameObject, mask)) continue;
      if (contact(probe, s)) out.push(s.collider);
    }
    return out;
  }

  return { step, resetState, raycast, checkSphere, overlapSphere, shapeFor, collectColliders };
})();
