/* Webity primitive mesh generation — positions/normals/uvs/indices */
"use strict";

const MeshLib = (() => {
  function build(pos, nrm, uv, idx) {
    return {
      positions: new Float32Array(pos),
      normals: new Float32Array(nrm),
      uvs: new Float32Array(uv),
      indices: new Uint16Array(idx),
      bounds: computeBounds(pos),
    };
  }
  function computeBounds(pos) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (pos[i + k] < min[k]) min[k] = pos[i + k];
        if (pos[i + k] > max[k]) max[k] = pos[i + k];
      }
    }
    if (!isFinite(min[0])) { min.fill(0); max.fill(0); }
    return { min: new Vector3(...min), max: new Vector3(...max) };
  }

  function cube() {
    const p = [], n = [], u = [], ix = [];
    const faces = [
      { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },   // +Z
      { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] }, // -Z
      { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },  // +X
      { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },  // -X
      { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },  // +Y
      { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },  // -Y
    ];
    let vi = 0;
    for (const f of faces) {
      for (let j = 0; j < 4; j++) {
        const su = (j === 1 || j === 2) ? 0.5 : -0.5;
        const sv = (j >= 2) ? 0.5 : -0.5;
        p.push(
          f.n[0] * 0.5 + f.u[0] * su + f.v[0] * sv,
          f.n[1] * 0.5 + f.u[1] * su + f.v[1] * sv,
          f.n[2] * 0.5 + f.u[2] * su + f.v[2] * sv
        );
        n.push(...f.n);
        u.push(su + 0.5, sv + 0.5);
      }
      ix.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
      vi += 4;
    }
    return build(p, n, u, ix);
  }

  function sphere(segments = 24, rings = 16, radius = 0.5) {
    const p = [], n = [], u = [], ix = [];
    for (let r = 0; r <= rings; r++) {
      const phi = Math.PI * r / rings;
      const y = Math.cos(phi), sr = Math.sin(phi);
      for (let s = 0; s <= segments; s++) {
        const th = 2 * Math.PI * s / segments;
        const x = sr * Math.cos(th), z = sr * Math.sin(th);
        p.push(x * radius, y * radius, z * radius);
        n.push(x, y, z);
        u.push(s / segments, 1 - r / rings);
      }
    }
    const W = segments + 1;
    for (let r = 0; r < rings; r++) for (let s = 0; s < segments; s++) {
      const a = r * W + s, b = a + W;
      ix.push(a, a + 1, b, a + 1, b + 1, b);
    }
    return build(p, n, u, ix);
  }

  function capsule(segments = 20, rings = 8, radius = 0.5, height = 2) {
    // total height = height; cylinder part = height - 2r
    const p = [], n = [], u = [], ix = [];
    const cyl = Math.max(0, height - 2 * radius) / 2;
    const rows = [];
    for (let r = 0; r <= rings; r++) { // top hemisphere
      const phi = (Math.PI / 2) * r / rings;
      rows.push({ y: cyl + radius * Math.cos(phi), rr: radius * Math.sin(phi), ny: Math.cos(phi) });
    }
    for (let r = 0; r <= rings; r++) { // bottom hemisphere
      const phi = (Math.PI / 2) * (1 + r / rings) - Math.PI / 2;
      const a = (Math.PI / 2) * r / rings;
      rows.push({ y: -cyl - radius * Math.sin(a), rr: radius * Math.cos(a), ny: -Math.sin(a) });
    }
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let s = 0; s <= segments; s++) {
        const th = 2 * Math.PI * s / segments;
        const cx = Math.cos(th), cz = Math.sin(th);
        p.push(row.rr * cx, row.y, row.rr * cz);
        const nx = cx * Math.sqrt(Math.max(0, 1 - row.ny * row.ny));
        const nz = cz * Math.sqrt(Math.max(0, 1 - row.ny * row.ny));
        n.push(nx, row.ny, nz);
        u.push(s / segments, 1 - r / (rows.length - 1));
      }
    }
    const W = segments + 1;
    for (let r = 0; r < rows.length - 1; r++) for (let s = 0; s < segments; s++) {
      const a = r * W + s, b = a + W;
      ix.push(a, a + 1, b, a + 1, b + 1, b);
    }
    return build(p, n, u, ix);
  }

  function cylinder(segments = 24, radius = 0.5, height = 2, capped = true) {
    const p = [], n = [], u = [], ix = [];
    const h = height / 2;
    for (let s = 0; s <= segments; s++) {
      const th = 2 * Math.PI * s / segments;
      const x = Math.cos(th), z = Math.sin(th);
      p.push(x * radius, h, z * radius); n.push(x, 0, z); u.push(s / segments, 1);
      p.push(x * radius, -h, z * radius); n.push(x, 0, z); u.push(s / segments, 0);
    }
    for (let s = 0; s < segments; s++) {
      const a = s * 2;
      ix.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
    }
    if (capped) {
      let base = p.length / 3;
      p.push(0, h, 0); n.push(0, 1, 0); u.push(0.5, 0.5);
      for (let s = 0; s <= segments; s++) {
        const th = 2 * Math.PI * s / segments;
        p.push(Math.cos(th) * radius, h, Math.sin(th) * radius); n.push(0, 1, 0);
        u.push(0.5 + Math.cos(th) / 2, 0.5 + Math.sin(th) / 2);
      }
      for (let s = 0; s < segments; s++) ix.push(base, base + 1 + s + 1, base + 1 + s);
      base = p.length / 3;
      p.push(0, -h, 0); n.push(0, -1, 0); u.push(0.5, 0.5);
      for (let s = 0; s <= segments; s++) {
        const th = 2 * Math.PI * s / segments;
        p.push(Math.cos(th) * radius, -h, Math.sin(th) * radius); n.push(0, -1, 0);
        u.push(0.5 + Math.cos(th) / 2, 0.5 + Math.sin(th) / 2);
      }
      for (let s = 0; s < segments; s++) ix.push(base, base + 1 + s, base + 1 + s + 1);
    }
    return build(p, n, u, ix);
  }

  function cone(segments = 16, radius = 0.5, height = 1) {
    const p = [], n = [], u = [], ix = [];
    // side
    for (let s = 0; s <= segments; s++) {
      const th = 2 * Math.PI * s / segments;
      const x = Math.cos(th), z = Math.sin(th);
      const slope = radius / Math.hypot(radius, height);
      const ny = slope, nr = Math.sqrt(1 - slope * slope);
      p.push(0, height / 2, 0); n.push(x * nr, ny, z * nr); u.push(s / segments, 1);
      p.push(x * radius, -height / 2, z * radius); n.push(x * nr, ny, z * nr); u.push(s / segments, 0);
    }
    for (let s = 0; s < segments; s++) {
      const a = s * 2;
      ix.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
    }
    const base = p.length / 3;
    p.push(0, -height / 2, 0); n.push(0, -1, 0); u.push(0.5, 0.5);
    for (let s = 0; s <= segments; s++) {
      const th = 2 * Math.PI * s / segments;
      p.push(Math.cos(th) * radius, -height / 2, Math.sin(th) * radius); n.push(0, -1, 0); u.push(0.5, 0.5);
    }
    for (let s = 0; s < segments; s++) ix.push(base, base + 1 + s, base + 1 + s + 1);
    return build(p, n, u, ix);
  }

  function plane(size = 10, subdiv = 1) {
    const p = [], n = [], u = [], ix = [];
    const half = size / 2;
    for (let z = 0; z <= subdiv; z++) for (let x = 0; x <= subdiv; x++) {
      p.push(-half + size * x / subdiv, 0, -half + size * z / subdiv);
      n.push(0, 1, 0);
      u.push(x / subdiv * (size / 10), z / subdiv * (size / 10));
    }
    const W = subdiv + 1;
    for (let z = 0; z < subdiv; z++) for (let x = 0; x < subdiv; x++) {
      const a = z * W + x, b = a + W;
      ix.push(a, b, a + 1, a + 1, b, b + 1);
    }
    return build(p, n, u, ix);
  }

  function quad() {
    return build(
      [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0],
      [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1],
      [0, 0, 1, 0, 1, 1, 0, 1],
      [0, 2, 1, 0, 3, 2]
    );
  }

  function torus(radius = 0.5, tube = 0.08, radialSeg = 24, tubeSeg = 12) {
    const p = [], n = [], u = [], ix = [];
    for (let j = 0; j <= tubeSeg; j++) {
      for (let i = 0; i <= radialSeg; i++) {
        const uAng = i / radialSeg * Math.PI * 2;
        const vAng = j / tubeSeg * Math.PI * 2;
        const cx = Math.cos(uAng) * radius, cz = Math.sin(uAng) * radius;
        const x = (radius + tube * Math.cos(vAng)) * Math.cos(uAng);
        const z = (radius + tube * Math.cos(vAng)) * Math.sin(uAng);
        const y = tube * Math.sin(vAng);
        p.push(x, y, z);
        const nx = x - cx, nz = z - cz;
        const nl = Math.hypot(nx, y, nz) || 1;
        n.push(nx / nl, y / nl, nz / nl);
        u.push(i / radialSeg, j / tubeSeg);
      }
    }
    const W = radialSeg + 1;
    for (let j = 0; j < tubeSeg; j++) for (let i = 0; i < radialSeg; i++) {
      const a = j * W + i, b = a + W;
      ix.push(a, b, a + 1, a + 1, b, b + 1);
    }
    return build(p, n, u, ix);
  }

  function crystal() {
    // elongated hexagonal bipyramid gem — flat shaded
    const top = [0, 0.62, 0], bottom = [0, -0.62, 0];
    const upper = [], lower = [];
    const R = 0.28;
    for (let i = 0; i < 6; i++) {
      const th = Math.PI * 2 * i / 6;
      upper.push([Math.cos(th) * R, 0.22, Math.sin(th) * R]);
      lower.push([Math.cos(th) * R, -0.22, Math.sin(th) * R]);
    }
    const p = [], n = [], u = [], ix = [];
    function tri(a, b, c) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const base = p.length / 3;
      for (const v of [a, b, c]) { p.push(...v); n.push(nx, ny, nz); u.push(0.5, 0.5); }
      ix.push(base, base + 1, base + 2);
    }
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      tri(top, upper[j], upper[i]);
      tri(upper[i], upper[j], lower[j]);
      tri(upper[i], lower[j], lower[i]);
      tri(bottom, lower[i], lower[j]);
    }
    return build(p, n, u, ix);
  }

  const cache = {};
  const generators = {
    Cube: cube,
    Sphere: () => sphere(),
    Capsule: () => capsule(),
    Cylinder: () => cylinder(),
    Plane: () => plane(10, 10),
    Quad: quad,
    Cone: () => cone(),
    Torus: () => torus(),
    Crystal: crystal,
  };
  function get(name) {
    if (!cache[name]) {
      const gen = generators[name] || cube;
      cache[name] = gen();
      cache[name].name = name;
    }
    return cache[name];
  }
  return { get, names: Object.keys(generators), computeBounds };
})();
