/* Webity particles — CPU simulation for ParticleSystem components */
"use strict";

const WParticles = (() => {
  const MAX_PER_SYSTEM = 512;

  function ensureSim(comp) {
    if (!comp._sim) {
      comp._sim = {
        particles: [],
        emitAccum: 0,
        playing: comp._playing,
        burstCount: 0,
        burst(n) { this.burstCount += n; },
      };
      if (comp._pendingBurst) { comp._sim.burstCount += comp._pendingBurst; comp._pendingBurst = 0; }
    }
    return comp._sim;
  }

  function spawnOne(comp, sim, origin) {
    if (sim.particles.length >= MAX_PER_SYSTEM) return;
    let dir;
    if (comp.shape === "Cone") {
      dir = new Vector3((Math.random() - 0.5) * comp.spread, 1, (Math.random() - 0.5) * comp.spread).normalized;
      dir = comp.transform.rotation.mulV(dir);
    } else if (comp.shape === "Point") {
      dir = comp.transform.rotation.mulV(Vector3.up);
    } else {
      dir = WRandom.onUnitSphere;
    }
    const jitter = comp.shape === "Sphere" ? WRandom.insideUnitSphere.mul(comp.spread * 0.5) : new Vector3();
    sim.particles.push({
      pos: origin.add(jitter),
      vel: dir.mul(comp.startSpeed * (0.7 + Math.random() * 0.6)),
      life: 0,
      maxLife: comp.lifetime * (0.75 + Math.random() * 0.5),
    });
  }

  function update(scene, dt) {
    for (const comp of scene.findComponents("ParticleSystem", true)) {
      const sim = ensureSim(comp);
      const active = comp.isActiveAndEnabled;
      sim.playing = comp._playing && active;
      const origin = comp.transform.position;
      if (sim.playing && active) {
        sim.emitAccum += comp.emissionRate * dt;
        while (sim.emitAccum >= 1) { sim.emitAccum -= 1; spawnOne(comp, sim, origin); }
      }
      while (sim.burstCount > 0) { sim.burstCount--; if (active) spawnOne(comp, sim, origin); }
      const g = scene.settings.gravity.mul(comp.gravityModifier);
      for (let i = sim.particles.length - 1; i >= 0; i--) {
        const p = sim.particles[i];
        p.life += dt;
        if (p.life >= p.maxLife) { sim.particles.splice(i, 1); continue; }
        p.vel = p.vel.add(g.mul(dt)).mul(1 / (1 + 0.6 * dt));
        p.pos = p.pos.add(p.vel.mul(dt));
      }
    }
  }

  /* Build renderer batches. Returns array of {data, count, additive} */
  const CORNERS = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  function buildBatches(scene) {
    const batches = [];
    for (const comp of scene.findComponents("ParticleSystem", true)) {
      const sim = comp._sim;
      if (!sim || !sim.particles.length) continue;
      if (!comp.gameObject.activeInHierarchy) continue;
      const n = sim.particles.length;
      const data = new Float32Array(n * 4 * 10);
      const sc = Color.from(comp.startColor), ec = Color.from(comp.endColor);
      let o = 0;
      for (const p of sim.particles) {
        const t = p.life / p.maxLife;
        const r = sc.r + (ec.r - sc.r) * t;
        const g = sc.g + (ec.g - sc.g) * t;
        const b = sc.b + (ec.b - sc.b) * t;
        const a = sc.a + (ec.a - sc.a) * t;
        const size = comp.startSize + (comp.endSize - comp.startSize) * t;
        for (const [cx, cy] of CORNERS) {
          data[o++] = p.pos.x; data[o++] = p.pos.y; data[o++] = p.pos.z;
          data[o++] = cx; data[o++] = cy;
          data[o++] = r; data[o++] = g; data[o++] = b; data[o++] = a;
          data[o++] = size;
        }
      }
      batches.push({ data, count: n, additive: !!comp.additive });
    }
    return batches;
  }

  function reset(scene) {
    if (!scene) return;
    for (const comp of scene.findComponents("ParticleSystem", true)) {
      comp._sim = null;
    }
  }

  return { update, buildBatches, reset };
})();
