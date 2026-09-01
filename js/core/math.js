/* Webity core math — Unity-style Vector3 / Quaternion / Matrix4 / Color / Mathf */
"use strict";

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  get magnitude() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  get sqrMagnitude() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  get normalized() {
    const m = this.magnitude;
    return m > 1e-8 ? new Vector3(this.x / m, this.y / m, this.z / m) : new Vector3();
  }
  Normalize() { const m = this.magnitude; if (m > 1e-8) { this.x /= m; this.y /= m; this.z /= m; } return this; }
  add(v) { return new Vector3(this.x + v.x, this.y + v.y, this.z + v.z); }
  sub(v) { return new Vector3(this.x - v.x, this.y - v.y, this.z - v.z); }
  mul(s) { return new Vector3(this.x * s, this.y * s, this.z * s); }
  div(s) { return new Vector3(this.x / s, this.y / s, this.z / s); }
  neg() { return new Vector3(-this.x, -this.y, -this.z); }
  equalsApprox(v) { return Vector3.SqrDistance(this, v) < 1e-10; }
  ToString() { return `(${this.x.toFixed(2)}, ${this.y.toFixed(2)}, ${this.z.toFixed(2)})`; }
  toString() { return this.ToString(); }
  toJSON() { return { x: this.x, y: this.y, z: this.z }; }

  static get zero() { return new Vector3(0, 0, 0); }
  static get one() { return new Vector3(1, 1, 1); }
  static get up() { return new Vector3(0, 1, 0); }
  static get down() { return new Vector3(0, -1, 0); }
  static get left() { return new Vector3(-1, 0, 0); }
  static get right() { return new Vector3(1, 0, 0); }
  static get forward() { return new Vector3(0, 0, 1); }
  static get back() { return new Vector3(0, 0, -1); }
  static Dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  static Cross(a, b) {
    return new Vector3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  }
  static Distance(a, b) { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
  static SqrDistance(a, b) { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return dx * dx + dy * dy + dz * dz; }
  static Lerp(a, b, t) { t = Mathf.Clamp01(t); return new Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t); }
  static LerpUnclamped(a, b, t) { return new Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t); }
  static MoveTowards(a, b, maxDelta) {
    const d = b.sub(a), m = d.magnitude;
    if (m <= maxDelta || m < 1e-8) return b.clone();
    return a.add(d.mul(maxDelta / m));
  }
  static Scale(a, b) { return new Vector3(a.x * b.x, a.y * b.y, a.z * b.z); }
  static Min(a, b) { return new Vector3(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z)); }
  static Max(a, b) { return new Vector3(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z)); }
  static ProjectOnPlane(v, n) { const d = Vector3.Dot(v, n) / Math.max(n.sqrMagnitude, 1e-9); return v.sub(n.mul(d)); }
  static Angle(a, b) {
    const d = Math.sqrt(a.sqrMagnitude * b.sqrMagnitude);
    if (d < 1e-12) return 0;
    return Math.acos(Mathf.Clamp(Vector3.Dot(a, b) / d, -1, 1)) * RAD2DEG;
  }
  static SignedAngle(a, b, axis) {
    const ang = Vector3.Angle(a, b);
    const s = Math.sign(Vector3.Dot(axis, Vector3.Cross(a, b)));
    return ang * (s === 0 ? 1 : s);
  }
  static ClampMagnitude(v, max) { const m = v.magnitude; return m > max ? v.mul(max / m) : v.clone(); }
  static SmoothDamp(current, target, velRef, smoothTime, dt, maxSpeed = Infinity) {
    // velRef: {v:Vector3}
    smoothTime = Math.max(0.0001, smoothTime);
    const omega = 2 / smoothTime;
    const x = omega * dt;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    let change = current.sub(target);
    const maxChange = maxSpeed * smoothTime;
    change = Vector3.ClampMagnitude(change, maxChange);
    const t2 = current.sub(change);
    const temp = velRef.v.add(change.mul(omega)).mul(dt);
    velRef.v = velRef.v.sub(temp.mul(omega)).mul(exp);
    let output = t2.add(change.add(temp).mul(exp));
    if (Vector3.Dot(target.sub(current), output.sub(target)) > 0) { output = target.clone(); velRef.v = new Vector3(); }
    return output;
  }
  static from(o) { return o instanceof Vector3 ? o : new Vector3(o?.x || 0, o?.y || 0, o?.z || 0); }
}

class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  clone() { return new Vector2(this.x, this.y); }
  get magnitude() { return Math.hypot(this.x, this.y); }
  get normalized() { const m = this.magnitude; return m > 1e-8 ? new Vector2(this.x / m, this.y / m) : new Vector2(); }
  add(v) { return new Vector2(this.x + v.x, this.y + v.y); }
  sub(v) { return new Vector2(this.x - v.x, this.y - v.y); }
  mul(s) { return new Vector2(this.x * s, this.y * s); }
  div(s) { return new Vector2(this.x / s, this.y / s); }
  neg() { return new Vector2(-this.x, -this.y); }
  static get zero() { return new Vector2(0, 0); }
  static get one() { return new Vector2(1, 1); }
  toJSON() { return { x: this.x, y: this.y }; }
}

class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  clone() { return new Quaternion(this.x, this.y, this.z, this.w); }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  static get identity() { return new Quaternion(0, 0, 0, 1); }
  mulQ(b) {
    const a = this;
    return new Quaternion(
      a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
    );
  }
  mulV(v) {
    // rotate vector
    const x = this.x, y = this.y, z = this.z, w = this.w;
    const ix = w * v.x + y * v.z - z * v.y;
    const iy = w * v.y + z * v.x - x * v.z;
    const iz = w * v.z + x * v.y - y * v.x;
    const iw = -x * v.x - y * v.y - z * v.z;
    return new Vector3(
      ix * w + iw * -x + iy * -z - iz * -y,
      iy * w + iw * -y + iz * -x - ix * -z,
      iz * w + iw * -z + ix * -y - iy * -x
    );
  }
  get normalized() {
    const m = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
    if (m < 1e-9) return Quaternion.identity;
    return new Quaternion(this.x / m, this.y / m, this.z / m, this.w / m);
  }
  inverse() { return new Quaternion(-this.x, -this.y, -this.z, this.w); }
  get eulerAngles() {
    // Unity order: extrinsic Z-X-Y (q = qy * qx * qz). Extract in degrees.
    const { x, y, z, w } = this;
    const sinX = 2 * (w * x - y * z);
    let ex, ey, ez;
    if (Math.abs(sinX) > 0.99999) {
      ex = Math.sign(sinX) * 90;
      ey = Math.atan2(2 * (w * y - x * z), 1 - 2 * (y * y + z * z)) * RAD2DEG * Math.sign(sinX) >= 0 ?
        Math.atan2(2 * (y * w + x * z), 1 - 2 * (x * x + y * y)) * RAD2DEG : 0;
      // gimbal lock: fold everything into Y
      ey = Math.atan2(2 * (y * w + x * z), 1 - 2 * (x * x + y * y)) * RAD2DEG;
      ez = 0;
    } else {
      ex = Math.asin(sinX) * RAD2DEG;
      ey = Math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y)) * RAD2DEG;
      ez = Math.atan2(2 * (w * z + x * y), 1 - 2 * (x * x + z * z)) * RAD2DEG;
    }
    const norm = (a) => { a %= 360; return a < 0 ? a + 360 : a; };
    return new Vector3(norm(ex), norm(ey), norm(ez));
  }
  static Euler(x, y, z) {
    if (x instanceof Vector3) { z = x.z; y = x.y; x = x.x; }
    const rx = x * DEG2RAD / 2, ry = y * DEG2RAD / 2, rz = z * DEG2RAD / 2;
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);
    // q = qy * qx * qz
    return new Quaternion(
      sx * cy * cz + cx * sy * sz,
      cx * sy * cz - sx * cy * sz,
      cx * cy * sz - sx * sy * cz,
      cx * cy * cz + sx * sy * sz
    );
  }
  static AngleAxis(deg, axis) {
    const a = axis.normalized, h = deg * DEG2RAD / 2, s = Math.sin(h);
    return new Quaternion(a.x * s, a.y * s, a.z * s, Math.cos(h));
  }
  static Dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w; }
  static Angle(a, b) {
    const d = Math.min(Math.abs(Quaternion.Dot(a, b)), 1);
    return Math.acos(d) * 2 * RAD2DEG;
  }
  static LookRotation(forward, up = Vector3.up) {
    const f = forward.normalized;
    if (f.magnitude < 1e-8) return Quaternion.identity;
    let r = Vector3.Cross(up, f);
    if (r.sqrMagnitude < 1e-8) r = Vector3.Cross(new Vector3(0, 0, 1), f);
    r = r.normalized;
    const u = Vector3.Cross(f, r);
    // build from basis (column-major rotation matrix -> quaternion)
    const m00 = r.x, m01 = u.x, m02 = f.x;
    const m10 = r.y, m11 = u.y, m12 = f.y;
    const m20 = r.z, m21 = u.z, m22 = f.z;
    const tr = m00 + m11 + m22;
    let q;
    if (tr > 0) {
      const s = Math.sqrt(tr + 1) * 2;
      q = new Quaternion((m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4);
    } else if (m00 > m11 && m00 > m22) {
      const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
      q = new Quaternion(s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s);
    } else if (m11 > m22) {
      const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
      q = new Quaternion((m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s);
    } else {
      const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
      q = new Quaternion((m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s);
    }
    return q.normalized;
  }
  static Slerp(a, b, t) {
    t = Mathf.Clamp01(t);
    return Quaternion.SlerpUnclamped(a, b, t);
  }
  static SlerpUnclamped(a, b, t) {
    let bx = b.x, by = b.y, bz = b.z, bw = b.w;
    let cos = Quaternion.Dot(a, b);
    if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    let k0, k1;
    if (cos > 0.9995) { k0 = 1 - t; k1 = t; }
    else {
      const theta = Math.acos(cos), sin = Math.sin(theta);
      k0 = Math.sin((1 - t) * theta) / sin;
      k1 = Math.sin(t * theta) / sin;
    }
    return new Quaternion(a.x * k0 + bx * k1, a.y * k0 + by * k1, a.z * k0 + bz * k1, a.w * k0 + bw * k1).normalized;
  }
  static RotateTowards(a, b, maxDeg) {
    const ang = Quaternion.Angle(a, b);
    if (ang < 1e-5) return b.clone();
    return Quaternion.SlerpUnclamped(a, b, Math.min(1, maxDeg / ang));
  }
  toJSON() { return { x: this.x, y: this.y, z: this.z, w: this.w }; }
  static from(o) { return o instanceof Quaternion ? o : new Quaternion(o?.x || 0, o?.y || 0, o?.z || 0, o?.w ?? 1); }
}

/* Column-major 4x4 matrix (WebGL layout) */
class Matrix4 {
  constructor() { this.m = new Float32Array(16); this.identity(); }
  identity() { const m = this.m; m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return this; }
  copy(o) { this.m.set(o.m); return this; }
  clone() { return new Matrix4().copy(this); }
  static TRS(pos, rot, scale) {
    const t = new Matrix4(), m = t.m;
    const { x, y, z, w } = rot;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const sx = scale.x, sy = scale.y, sz = scale.z;
    m[0] = (1 - (yy + zz)) * sx; m[1] = (xy + wz) * sx; m[2] = (xz - wy) * sx; m[3] = 0;
    m[4] = (xy - wz) * sy; m[5] = (1 - (xx + zz)) * sy; m[6] = (yz + wx) * sy; m[7] = 0;
    m[8] = (xz + wy) * sz; m[9] = (yz - wx) * sz; m[10] = (1 - (xx + yy)) * sz; m[11] = 0;
    m[12] = pos.x; m[13] = pos.y; m[14] = pos.z; m[15] = 1;
    return t;
  }
  mul(b) { // this * b
    const out = new Matrix4(), a = this.m, bm = b.m, o = out.m;
    for (let c = 0; c < 4; c++) {
      const bc = c * 4;
      const b0 = bm[bc], b1 = bm[bc + 1], b2 = bm[bc + 2], b3 = bm[bc + 3];
      o[bc] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
      o[bc + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
      o[bc + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      o[bc + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return out;
  }
  mulPoint(v) {
    const m = this.m;
    const w = m[3] * v.x + m[7] * v.y + m[11] * v.z + m[15] || 1;
    return new Vector3(
      (m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12]) / w,
      (m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13]) / w,
      (m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14]) / w
    );
  }
  mulDir(v) {
    const m = this.m;
    return new Vector3(
      m[0] * v.x + m[4] * v.y + m[8] * v.z,
      m[1] * v.x + m[5] * v.y + m[9] * v.z,
      m[2] * v.x + m[6] * v.y + m[10] * v.z
    );
  }
  invert() {
    const m = this.m, inv = new Float32Array(16);
    inv[0] = m[5]*m[10]*m[15]-m[5]*m[11]*m[14]-m[9]*m[6]*m[15]+m[9]*m[7]*m[14]+m[13]*m[6]*m[11]-m[13]*m[7]*m[10];
    inv[4] = -m[4]*m[10]*m[15]+m[4]*m[11]*m[14]+m[8]*m[6]*m[15]-m[8]*m[7]*m[14]-m[12]*m[6]*m[11]+m[12]*m[7]*m[10];
    inv[8] = m[4]*m[9]*m[15]-m[4]*m[11]*m[13]-m[8]*m[5]*m[15]+m[8]*m[7]*m[13]+m[12]*m[5]*m[11]-m[12]*m[7]*m[9];
    inv[12] = -m[4]*m[9]*m[14]+m[4]*m[10]*m[13]+m[8]*m[5]*m[14]-m[8]*m[6]*m[13]-m[12]*m[5]*m[10]+m[12]*m[6]*m[9];
    inv[1] = -m[1]*m[10]*m[15]+m[1]*m[11]*m[14]+m[9]*m[2]*m[15]-m[9]*m[3]*m[14]-m[13]*m[2]*m[11]+m[13]*m[3]*m[10];
    inv[5] = m[0]*m[10]*m[15]-m[0]*m[11]*m[14]-m[8]*m[2]*m[15]+m[8]*m[3]*m[14]+m[12]*m[2]*m[11]-m[12]*m[3]*m[10];
    inv[9] = -m[0]*m[9]*m[15]+m[0]*m[11]*m[13]+m[8]*m[1]*m[15]-m[8]*m[3]*m[13]-m[12]*m[1]*m[11]+m[12]*m[3]*m[9];
    inv[13] = m[0]*m[9]*m[14]-m[0]*m[10]*m[13]-m[8]*m[1]*m[14]+m[8]*m[2]*m[13]+m[12]*m[1]*m[10]-m[12]*m[2]*m[9];
    inv[2] = m[1]*m[6]*m[15]-m[1]*m[7]*m[14]-m[5]*m[2]*m[15]+m[5]*m[3]*m[14]+m[13]*m[2]*m[7]-m[13]*m[3]*m[6];
    inv[6] = -m[0]*m[6]*m[15]+m[0]*m[7]*m[14]+m[4]*m[2]*m[15]-m[4]*m[3]*m[14]-m[12]*m[2]*m[7]+m[12]*m[3]*m[6];
    inv[10] = m[0]*m[5]*m[15]-m[0]*m[7]*m[13]-m[4]*m[1]*m[15]+m[4]*m[3]*m[13]+m[12]*m[1]*m[7]-m[12]*m[3]*m[5];
    inv[14] = -m[0]*m[5]*m[14]+m[0]*m[6]*m[13]+m[4]*m[1]*m[14]-m[4]*m[2]*m[13]-m[12]*m[1]*m[6]+m[12]*m[2]*m[5];
    inv[3] = -m[1]*m[6]*m[11]+m[1]*m[7]*m[10]+m[5]*m[2]*m[11]-m[5]*m[3]*m[10]-m[9]*m[2]*m[7]+m[9]*m[3]*m[6];
    inv[7] = m[0]*m[6]*m[11]-m[0]*m[7]*m[10]-m[4]*m[2]*m[11]+m[4]*m[3]*m[10]+m[8]*m[2]*m[7]-m[8]*m[3]*m[6];
    inv[11] = -m[0]*m[5]*m[11]+m[0]*m[7]*m[9]+m[4]*m[1]*m[11]-m[4]*m[3]*m[9]-m[8]*m[1]*m[7]+m[8]*m[3]*m[5];
    inv[15] = m[0]*m[5]*m[10]-m[0]*m[6]*m[9]-m[4]*m[1]*m[10]+m[4]*m[2]*m[9]+m[8]*m[1]*m[6]-m[8]*m[2]*m[5];
    let det = m[0]*inv[0]+m[1]*inv[4]+m[2]*inv[8]+m[3]*inv[12];
    const out = new Matrix4();
    if (Math.abs(det) < 1e-12) return out;
    det = 1 / det;
    for (let i = 0; i < 16; i++) out.m[i] = inv[i] * det;
    return out;
  }
  /* Left-handed perspective: camera looks down +Z (Unity convention) */
  static Perspective(fovDeg, aspect, near, far) {
    const out = new Matrix4(), m = out.m;
    const f = 1 / Math.tan(fovDeg * DEG2RAD / 2);
    m.fill(0);
    m[0] = f / aspect; m[5] = f;
    m[10] = (far + near) / (far - near); m[11] = 1;
    m[14] = -2 * far * near / (far - near); m[15] = 0;
    return out;
  }
  static Ortho(l, r, b, t, near, far) {
    const out = new Matrix4(), m = out.m;
    m.fill(0);
    m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = 2 / (far - near);
    m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = -(far + near) / (far - near);
    m[15] = 1;
    return out;
  }
}

class Color {
  constructor(r = 1, g = 1, b = 1, a = 1) { this.r = r; this.g = g; this.b = b; this.a = a; }
  clone() { return new Color(this.r, this.g, this.b, this.a); }
  static get white() { return new Color(1, 1, 1, 1); }
  static get black() { return new Color(0, 0, 0, 1); }
  static get red() { return new Color(1, 0.2, 0.15, 1); }
  static get green() { return new Color(0.2, 1, 0.3, 1); }
  static get blue() { return new Color(0.2, 0.4, 1, 1); }
  static get yellow() { return new Color(1, 0.92, 0.2, 1); }
  static get cyan() { return new Color(0.2, 1, 1, 1); }
  static get magenta() { return new Color(1, 0.2, 1, 1); }
  static get gray() { return new Color(0.5, 0.5, 0.5, 1); }
  static get clear() { return new Color(0, 0, 0, 0); }
  static Lerp(a, b, t) {
    t = Mathf.Clamp01(t);
    return new Color(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, a.a + (b.a - a.a) * t);
  }
  mul(s) { return s instanceof Color ? new Color(this.r * s.r, this.g * s.g, this.b * s.b, this.a * s.a) : new Color(this.r * s, this.g * s, this.b * s, this.a); }
  add(c) { return new Color(this.r + c.r, this.g + c.g, this.b + c.b, Math.min(1, this.a + c.a)); }
  toCSS() {
    return `rgba(${Math.round(Mathf.Clamp01(this.r) * 255)},${Math.round(Mathf.Clamp01(this.g) * 255)},${Math.round(Mathf.Clamp01(this.b) * 255)},${this.a.toFixed(3)})`;
  }
  toHex() {
    const h = (v) => Math.round(Mathf.Clamp01(v) * 255).toString(16).padStart(2, "0");
    return `#${h(this.r)}${h(this.g)}${h(this.b)}`;
  }
  static fromHex(hex) {
    const v = hex.replace("#", "");
    return new Color(parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255, 1);
  }
  toJSON() { return { r: this.r, g: this.g, b: this.b, a: this.a }; }
  static from(o) { return o instanceof Color ? o : new Color(o?.r ?? 1, o?.g ?? 1, o?.b ?? 1, o?.a ?? 1); }
}

const Mathf = {
  PI: Math.PI,
  Infinity: Infinity,
  NegativeInfinity: -Infinity,
  Deg2Rad: DEG2RAD,
  Rad2Deg: RAD2DEG,
  Epsilon: 1e-7,
  Abs: Math.abs, Sign: (x) => (x >= 0 ? 1 : -1),
  Sqrt: Math.sqrt, Pow: Math.pow, Exp: Math.exp, Log: Math.log,
  Sin: Math.sin, Cos: Math.cos, Tan: Math.tan,
  Asin: Math.asin, Acos: Math.acos, Atan: Math.atan, Atan2: Math.atan2,
  Min: Math.min, Max: Math.max,
  Floor: Math.floor, Ceil: Math.ceil, Round: Math.round,
  FloorToInt: (x) => Math.floor(x), CeilToInt: (x) => Math.ceil(x), RoundToInt: (x) => Math.round(x),
  Clamp: (v, a, b) => Math.min(Math.max(v, a), b),
  Clamp01: (v) => Math.min(Math.max(v, 0), 1),
  Lerp: (a, b, t) => a + (b - a) * Mathf.Clamp01(t),
  LerpUnclamped: (a, b, t) => a + (b - a) * t,
  InverseLerp: (a, b, v) => (a !== b ? Mathf.Clamp01((v - a) / (b - a)) : 0),
  MoveTowards: (a, b, d) => (Math.abs(b - a) <= d ? b : a + Math.sign(b - a) * d),
  PingPong: (t, len) => { t = Mathf.Repeat(t, len * 2); return len - Math.abs(t - len); },
  Repeat: (t, len) => Mathf.Clamp(t - Math.floor(t / len) * len, 0, len),
  DeltaAngle: (a, b) => { let d = Mathf.Repeat(b - a, 360); if (d > 180) d -= 360; return d; },
  LerpAngle: (a, b, t) => a + Mathf.DeltaAngle(a, b) * Mathf.Clamp01(t),
  MoveTowardsAngle: (a, b, d) => { const da = Mathf.DeltaAngle(a, b); if (-d < da && da < d) return b; return Mathf.MoveTowards(a, a + da, d); },
  SmoothStep: (a, b, t) => { t = Mathf.Clamp01(t); t = t * t * (3 - 2 * t); return a + (b - a) * t; },
  Approximately: (a, b) => Math.abs(a - b) < 1e-6,
  SmoothDamp(current, target, velRef, smoothTime, dt, maxSpeed = Infinity) {
    smoothTime = Math.max(0.0001, smoothTime);
    const omega = 2 / smoothTime, x = omega * dt;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    let change = current - target;
    change = Mathf.Clamp(change, -maxSpeed * smoothTime, maxSpeed * smoothTime);
    const t2 = current - change;
    const temp = (velRef.v + omega * change) * dt;
    velRef.v = (velRef.v - omega * temp) * exp;
    let output = t2 + (change + temp) * exp;
    if ((target - current > 0) === (output > target)) { output = target; velRef.v = 0; }
    return output;
  },
  PerlinNoise: (x, y) => {
    // cheap value noise, deterministic
    const h = (ix, iy) => { let n = ix * 374761393 + iy * 668265263; n = (n ^ (n >> 13)) * 1274126177; return ((n ^ (n >> 16)) >>> 0) / 4294967295; };
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const s = (t) => t * t * (3 - 2 * t);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * s(xf) + (c - a) * s(yf) + (a - b - c + d) * s(xf) * s(yf);
  },
};

/* ============ Operator dispatch for transpiled C# ============ */
const OP = {
  add(a, b) {
    if (typeof a === "number" && typeof b === "number") return a + b;
    if (typeof a === "string" || typeof b === "string") return OP.str(a) + OP.str(b);
    if (a instanceof Vector3 && b instanceof Vector3) return a.add(b);
    if (a instanceof Vector2 && b instanceof Vector2) return a.add(b);
    if (a instanceof Color && b instanceof Color) return a.add(b);
    return a + b;
  },
  sub(a, b) {
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (a instanceof Vector3 && b instanceof Vector3) return a.sub(b);
    if (a instanceof Vector2 && b instanceof Vector2) return a.sub(b);
    return a - b;
  },
  mul(a, b) {
    if (typeof a === "number" && typeof b === "number") return a * b;
    if (a instanceof Vector3 && typeof b === "number") return a.mul(b);
    if (typeof a === "number" && b instanceof Vector3) return b.mul(a);
    if (a instanceof Vector2 && typeof b === "number") return a.mul(b);
    if (typeof a === "number" && b instanceof Vector2) return b.mul(a);
    if (a instanceof Quaternion && b instanceof Quaternion) return a.mulQ(b);
    if (a instanceof Quaternion && b instanceof Vector3) return a.mulV(b);
    if (a instanceof Color && typeof b === "number") return a.mul(b);
    if (typeof a === "number" && b instanceof Color) return b.mul(a);
    if (a instanceof Color && b instanceof Color) return a.mul(b);
    return a * b;
  },
  div(a, b) {
    if (typeof a === "number" && typeof b === "number") return a / b;
    if (a instanceof Vector3 && typeof b === "number") return a.div(b);
    if (a instanceof Vector2 && typeof b === "number") return a.div(b);
    return a / b;
  },
  mod(a, b) { return a % b; },
  neg(a) {
    if (typeof a === "number") return -a;
    if (a instanceof Vector3) return a.neg();
    if (a instanceof Vector2) return a.neg();
    return -a;
  },
  isNullish(x) { return x === null || x === undefined || (x && x.__destroyed === true); },
  eq(a, b) {
    const an = OP.isNullish(a), bn = OP.isNullish(b);
    if (an || bn) return an === bn;
    if (a instanceof Vector3 && b instanceof Vector3) return a.equalsApprox(b);
    if (a instanceof Quaternion && b instanceof Quaternion) return Math.abs(Quaternion.Dot(a, b)) > 0.999999;
    return a === b;
  },
  ne(a, b) { return !OP.eq(a, b); },
  int(x) { return Math.trunc(x); },
  bool(x) { return !!x && !OP.isNullish(x); },
  str(x) {
    if (x === null || x === undefined) return "";
    if (typeof x === "number") return OP.numStr(x);
    if (typeof x === "object" && typeof x.ToString === "function") return x.ToString();
    return String(x);
  },
  numStr(x) {
    if (Number.isInteger(x)) return String(x);
    return String(Math.round(x * 1e5) / 1e5);
  },
  toStr(x, fmt) {
    if (typeof x !== "number") return OP.str(x);
    if (!fmt) return OP.numStr(x);
    // supports "00", "000", "0.0", "F1", "F2", "N0"
    let m;
    if ((m = /^0+$/.exec(fmt))) return (x < 0 ? "-" : "") + Math.trunc(Math.abs(x)).toString().padStart(fmt.length, "0");
    if ((m = /^0+\.(0+)$/.exec(fmt))) { const dec = m[1].length; const ip = fmt.indexOf("."); return (x < 0 ? "-" : "") + Math.abs(x).toFixed(dec).padStart(ip + 1 + dec, "0"); }
    if ((m = /^[fF](\d+)$/.exec(fmt))) return x.toFixed(parseInt(m[1]));
    if ((m = /^[nN](\d*)$/.exec(fmt))) return x.toLocaleString("en-US", { maximumFractionDigits: m[1] ? parseInt(m[1]) : 0 });
    return OP.numStr(x);
  },
  fmt(x, fmt) { return OP.toStr(x, fmt); },
  idx(obj, i) {
    if (obj == null) throw new Error("NullReferenceException: index into null");
    if (typeof obj.get_Item === "function") return obj.get_Item(i);
    return obj[i];
  },
  setIdx(obj, i, v) {
    if (typeof obj.set_Item === "function") { obj.set_Item(i, v); return v; }
    obj[i] = v; return v;
  },
};

/* C# List<T> */
class CSList {
  constructor(init) { this.items = init ? Array.from(init) : []; }
  get Count() { return this.items.length; }
  Add(x) { this.items.push(x); }
  AddRange(r) { for (const x of (r.items || r)) this.items.push(x); }
  Insert(i, x) { this.items.splice(i, 0, x); }
  Remove(x) { const i = this.items.indexOf(x); if (i >= 0) { this.items.splice(i, 1); return true; } return false; }
  RemoveAt(i) { this.items.splice(i, 1); }
  Clear() { this.items.length = 0; }
  Contains(x) { return this.items.includes(x); }
  IndexOf(x) { return this.items.indexOf(x); }
  get_Item(i) { return this.items[i]; }
  set_Item(i, v) { this.items[i] = v; }
  ToArray() { return this.items.slice(); }
  [Symbol.iterator]() { return this.items[Symbol.iterator](); }
}

const WRandom = {
  get value() { return Math.random(); },
  Range(a, b) {
    if (Number.isInteger(a) && Number.isInteger(b)) return Math.floor(a + Math.random() * (b - a));
    return a + Math.random() * (b - a);
  },
  get insideUnitSphere() {
    let v;
    do { v = new Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1); } while (v.sqrMagnitude > 1);
    return v;
  },
  get onUnitSphere() { return WRandom.insideUnitSphere.normalized; },
};
