/* Webity Cube Adventure — demo project data: scene, materials, prefabs, audio clips */
"use strict";

const LAYER = { Default: 0, Player: 3, UI: 5, Environment: 6, Enemy: 7, Collectible: 8, Checkpoint: 9, Trigger: 10 };
const ENV_MASK = 1 << LAYER.Environment;

/* ---------- tiny scene builder ---------- */
class SceneBuilder {
  constructor(startId = 1) { this.objs = []; this.nextId = startId; }
  obj(name, opts = {}) {
    const id = this.nextId++;
    const rot = opts.rot ? Quaternion.Euler(opts.rot[0], opts.rot[1], opts.rot[2]).toJSON() : { x: 0, y: 0, z: 0, w: 1 };
    this.objs.push({
      id, name,
      active: opts.active !== false,
      tag: opts.tag || "Untagged",
      layer: opts.layer || 0,
      parent: opts.parent || 0,
      prefab: opts.prefab || undefined,
      t: {
        p: { x: opts.pos?.[0] || 0, y: opts.pos?.[1] || 0, z: opts.pos?.[2] || 0 },
        r: rot,
        s: { x: opts.scale?.[0] ?? 1, y: opts.scale?.[1] ?? 1, z: opts.scale?.[2] ?? 1 },
      },
      components: opts.components || [],
    });
    return id;
  }
  data() { return this.objs.map((o) => ({ ...o, oldId: o.id })); }
}

/* component shorthands */
const C = {
  mesh: (meshName, mat, extra = {}) => ([
    { type: "MeshFilter", enabled: true, props: { mesh: meshName } },
    { type: "MeshRenderer", enabled: true, props: { materialPath: mat, castShadows: extra.cast !== false, receiveShadows: extra.receive !== false } },
  ]),
  box: (opts = {}) => ({ type: "BoxCollider", enabled: true, props: { isTrigger: !!opts.trigger, center: v3(opts.center), size: v3(opts.size, 1) } }),
  sphere: (opts = {}) => ({ type: "SphereCollider", enabled: true, props: { isTrigger: !!opts.trigger, center: v3(opts.center), radius: opts.radius ?? 0.5 } }),
  capsule: (opts = {}) => ({ type: "CapsuleCollider", enabled: true, props: { isTrigger: !!opts.trigger, center: v3(opts.center), radius: opts.radius ?? 0.5, height: opts.height ?? 2 } }),
  rb: (opts = {}) => ({ type: "Rigidbody", enabled: true, props: { mass: opts.mass ?? 1, drag: opts.drag ?? 0, useGravity: opts.gravity !== false, isKinematic: !!opts.kinematic, freezeRotation: !!opts.freezeRotation } }),
  script: (cls, props = {}) => ({ type: "CSScript", class: cls, enabled: true, props }),
  audio: (clipPath, opts = {}) => ({ type: "AudioSource", enabled: true, props: { clipPath: clipPath || null, playOnAwake: !!opts.playOnAwake, loop: !!opts.loop, volume: opts.volume ?? 1, pitch: 1 } }),
  camera: (fov = 60) => ({ type: "Camera", enabled: true, props: { fov, nearClip: 0.1, farClip: 300 } }),
  listener: () => ({ type: "AudioListener", enabled: true, props: {} }),
  light: (opts = {}) => ({ type: "Light", enabled: true, props: { lightType: "Directional", color: col(opts.color, [1, 0.956, 0.89, 1]), intensity: opts.intensity ?? 1.05, shadows: true } }),
  particle: (props) => ({ type: "ParticleSystem", enabled: true, props }),
  post: () => ({ type: "PostProcessVolume", enabled: true, props: {} }),
  animator: (modelRef) => ({ type: "Animator", enabled: true, props: { model: modelRef, bobAmplitude: 0.06, bobFrequency: 2.4, runTilt: 1.6 } }),
  canvas: () => ({ type: "Canvas", enabled: true, props: { sortOrder: 0 } }),
  eventSystem: () => ({ type: "EventSystem", enabled: true, props: {} }),
  text: (content, opts = {}) => ({ type: "Text", enabled: true, props: {
    content, fontSize: opts.size ?? 16, color: col(opts.color, [1, 1, 1, 1]), bold: !!opts.bold,
    align: opts.align || "Left", anchor: opts.anchor || "TopLeft",
    offsetX: opts.off?.[0] ?? 0, offsetY: opts.off?.[1] ?? 0, letterSpacing: opts.spacing ?? 0 } }),
  image: (opts = {}) => ({ type: "Image", enabled: true, props: {
    color: col(opts.color, [1, 1, 1, 1]), width: opts.w ?? 100, height: opts.h ?? 100,
    cornerRadius: opts.radius ?? 0, anchor: opts.anchor || "Center",
    offsetX: opts.off?.[0] ?? 0, offsetY: opts.off?.[1] ?? 0 } }),
  panel: (opts = {}) => ({ type: "Panel", enabled: true, props: { color: col(opts.color, [0, 0, 0, 0.72]), blur: opts.blur !== false } }),
  button: (label, target, message, opts = {}) => ({ type: "Button", enabled: true, props: {
    label, fontSize: opts.size ?? 17, width: opts.w ?? 230, height: opts.h ?? 44,
    bgColor: col(opts.bg, [0.16, 0.42, 0.72, 0.95]), textColor: col(opts.fg, [1, 1, 1, 1]),
    anchor: opts.anchor || "Center", offsetX: opts.off?.[0] ?? 0, offsetY: opts.off?.[1] ?? 0,
    onClickTarget: target ? { $ref: target, kind: "GameObject" } : null, onClickMessage: message || "" } }),
};
function v3(a, def = 0) {
  if (!a) return { x: def === 1 ? 1 : 0, y: def === 1 ? 1 : 0, z: def === 1 ? 1 : 0 };
  return { x: a[0], y: a[1], z: a[2] };
}
function col(a, def) { const c = a || def; return { r: c[0], g: c[1], b: c[2], a: c[3] ?? 1 }; }
const ref = (id, kind = "Transform") => ({ $ref: id, kind });

/* ============================= materials ============================= */
const DEMO_MATERIALS = {
  "Assets/Materials/StartPad.mat":       { color: { r: 0.52, g: 0.66, b: 0.56, a: 1 }, texture: "Grid", texScale: 3, specular: 0.1 },
  "Assets/Materials/GroundGrid.mat":     { color: { r: 0.62, g: 0.66, b: 0.7, a: 1 }, texture: "Grid", texScale: 3, specular: 0.08 },
  "Assets/Materials/Platform.mat":       { color: { r: 0.56, g: 0.62, b: 0.72, a: 1 }, texture: "Grid", texScale: 1.6, specular: 0.12 },
  "Assets/Materials/PlatformDark.mat":   { color: { r: 0.38, g: 0.42, b: 0.52, a: 1 }, texture: "Grid", texScale: 1.6, specular: 0.15 },
  "Assets/Materials/Wall.mat":           { color: { r: 0.45, g: 0.48, b: 0.55, a: 1 }, texture: "Checker", texScale: 2, specular: 0.1 },
  "Assets/Materials/PlayerBlue.mat":     { color: { r: 0.32, g: 0.6, b: 0.9, a: 1 }, specular: 0.55, specPower: 48 },
  "Assets/Materials/Eye.mat":            { color: { r: 0.09, g: 0.11, b: 0.16, a: 1 }, specular: 0.8, specPower: 64 },
  "Assets/Materials/CrystalCyan.mat":    { color: { r: 0.45, g: 0.95, b: 1, a: 1 }, emission: { r: 0.15, g: 0.7, b: 0.9, a: 1 }, emissionIntensity: 1.2, specular: 0.9, specPower: 64 },
  "Assets/Materials/EnemyRed.mat":       { color: { r: 0.86, g: 0.3, b: 0.33, a: 1 }, emission: { r: 0.18, g: 0.01, b: 0.02, a: 1 }, specular: 0.4, specPower: 40 },
  "Assets/Materials/ObstacleOrange.mat": { color: { r: 0.92, g: 0.6, b: 0.24, a: 1 }, texture: "Stripes", texScale: 1.2, specular: 0.3 },
  "Assets/Materials/JumpPadYellow.mat":  { color: { r: 0.95, g: 0.85, b: 0.3, a: 1 }, emission: { r: 0.45, g: 0.36, b: 0.05, a: 1 }, specular: 0.5 },
  "Assets/Materials/GoalGold.mat":       { color: { r: 1, g: 0.83, b: 0.35, a: 1 }, emission: { r: 0.65, g: 0.45, b: 0.08, a: 1 }, emissionIntensity: 1.1, specular: 0.8, specPower: 60 },
  "Assets/Materials/CheckpointGreen.mat":{ color: { r: 0.4, g: 0.8, b: 0.5, a: 1 }, emission: { r: 0.03, g: 0.2, b: 0.06, a: 1 }, specular: 0.3 },
  "Assets/Materials/MovingPlat.mat":     { color: { r: 0.55, g: 0.45, b: 0.85, a: 1 }, texture: "Dots", texScale: 1.4, specular: 0.25 },
  "Assets/Materials/FallingTile.mat":    { color: { r: 0.78, g: 0.62, b: 0.44, a: 1 }, texture: "Dots", texScale: 1.2, specular: 0.15 },
  "Assets/Materials/PendulumSteel.mat":  { color: { r: 0.6, g: 0.64, b: 0.72, a: 1 }, specular: 0.75, specPower: 56 },
};

const DEMO_AUDIO_CLIPS = {
  "Assets/Audio/Jump.clip": "jump",
  "Assets/Audio/DoubleJump.clip": "doublejump",
  "Assets/Audio/Land.clip": "land",
  "Assets/Audio/Collect.clip": "collect",
  "Assets/Audio/Damage.clip": "damage",
  "Assets/Audio/Fall.clip": "fall",
  "Assets/Audio/JumpPad.clip": "jumppad",
  "Assets/Audio/Checkpoint.clip": "checkpoint",
  "Assets/Audio/Goal.clip": "goal",
  "Assets/Audio/GameOver.clip": "gameover",
  "Assets/Audio/Click.clip": "click",
  "Assets/Audio/EnemyAlert.clip": "enemy_alert",
  "Assets/Audio/FallingFloor.clip": "falling_floor",
  "Assets/Audio/BGM_Main.clip": "bgm_main",
};

const DEMO_TEXTURES = {
  "Assets/Textures/Grid.png": "Grid",
  "Assets/Textures/Checker.png": "Checker",
  "Assets/Textures/Dots.png": "Dots",
  "Assets/Textures/Stripes.png": "Stripes",
  "Assets/Textures/White.png": "White",
};

/* ============================= prefabs ============================= */
function buildPrefabs() {
  const prefabs = {};

  {
    const b = new SceneBuilder(1);
    b.obj("Crystal", {
      tag: "Collectible", layer: LAYER.Collectible,
      components: [
        ...C.mesh("Crystal", "Assets/Materials/CrystalCyan.mat", { cast: false }),
        C.sphere({ trigger: true, radius: 0.75 }),
        C.script("CollectibleItem", { rotateSpeed: 90, bobHeight: 0.25, bobSpeed: 2 }),
        C.particle({ playOnAwake: true, emissionRate: 4, lifetime: 0.9, startSpeed: 0.35, startSize: 0.09, endSize: 0.01,
          startColor: col([0.6, 1, 1, 0.9]), endColor: col([0.4, 0.9, 1, 0]), gravityModifier: 0, shape: "Sphere", spread: 0.8, additive: true, worldSpace: true }),
        C.audio("Assets/Audio/Collect.clip"),
      ],
    });
    prefabs["Assets/Prefabs/Crystal.prefab"] = b.data();
  }
  {
    const b = new SceneBuilder(1);
    const root = b.obj("RotatingBar", {
      tag: "Obstacle", layer: LAYER.Environment,
      components: [C.rb({ kinematic: true }), C.script("RotatingObstacle", { rotationAxis: 1, rotationSpeed: 90, reverse: false })],
    });
    b.obj("Pillar", { parent: root, pos: [0, -0.15, 0], scale: [0.34, 1.0, 0.34],
      components: [...C.mesh("Cylinder", "Assets/Materials/PlatformDark.mat")] });
    b.obj("Bar", { parent: root, pos: [0, 0.28, 0], scale: [5.4, 0.42, 0.42], layer: LAYER.Environment,
      components: [...C.mesh("Cube", "Assets/Materials/ObstacleOrange.mat"), C.box()] });
    prefabs["Assets/Prefabs/RotatingBar.prefab"] = b.data();
  }
  {
    const b = new SceneBuilder(1);
    const root = b.obj("JumpPad", {
      tag: "Obstacle", layer: LAYER.Environment,
      components: [C.box({ trigger: true, center: [0, 0.55, 0], size: [1.5, 1.1, 1.5] })],
    });
    const fx = b.obj("PadEffect", { parent: root, pos: [0, 0.2, 0],
      components: [C.particle({ playOnAwake: true, emissionRate: 0, lifetime: 0.6, startSpeed: 4.5, startSize: 0.14, endSize: 0.02,
        startColor: col([1, 0.95, 0.5, 1]), endColor: col([1, 0.7, 0.2, 0]), gravityModifier: 0.4, shape: "Cone", spread: 0.5, additive: true, worldSpace: true })] });
    b.obj("PadBase", { parent: root, pos: [0, 0.05, 0], scale: [1.7, 0.14, 1.7],
      components: [...C.mesh("Cylinder", "Assets/Materials/JumpPadYellow.mat")] });
    // patch the root to reference the effect
    b.objs[0].components.push(C.script("JumpPad", { jumpPower: 12, effect: ref(fx, "ParticleSystem"), cooldown: 0.25 }));
    prefabs["Assets/Prefabs/JumpPad.prefab"] = b.data();
  }
  {
    const b = new SceneBuilder(1);
    const root = b.obj("Enemy", {
      tag: "Enemy", layer: LAYER.Enemy,
      components: [
        C.capsule({ radius: 0.45, height: 1.5 }),
        C.sphere({ trigger: true, radius: 0.85 }),
        C.rb({ kinematic: true }),
        C.script("EnemyController", { patrolPoints: [], patrolSpeed: 2, chaseSpeed: 4, detectionDistance: 8, attackDistance: 1.2, damage: 1, leashDistance: 14, target: null }),
      ],
    });
    const model = b.obj("EnemyModel", { parent: root, scale: [0.85, 0.72, 0.85],
      components: [...C.mesh("Capsule", "Assets/Materials/EnemyRed.mat")] });
    b.obj("Eye_L", { parent: model, pos: [0.18, 0.3, 0.42], scale: [0.16, 0.16, 0.1],
      components: [...C.mesh("Cube", "Assets/Materials/Eye.mat")] });
    b.obj("Eye_R", { parent: model, pos: [-0.18, 0.3, 0.42], scale: [0.16, 0.16, 0.1],
      components: [...C.mesh("Cube", "Assets/Materials/Eye.mat")] });
    prefabs["Assets/Prefabs/Enemy.prefab"] = b.data();
  }
  {
    const b = new SceneBuilder(1);
    const root = b.obj("MovingPlatform", { tag: "Obstacle" });
    const pa = b.obj("PointA", { parent: root, pos: [0, 0, -2] });
    const pb = b.obj("PointB", { parent: root, pos: [0, 0, 2] });
    b.obj("Platform", { parent: root, pos: [0, 0, -2], scale: [3, 0.4, 3], layer: LAYER.Environment,
      components: [...C.mesh("Cube", "Assets/Materials/MovingPlat.mat"), C.box(), C.rb({ kinematic: true }),
        C.script("MovingPlatform", { pointA: ref(pa), pointB: ref(pb), moveSpeed: 3, waitTime: 1, easeMovement: true })] });
    prefabs["Assets/Prefabs/MovingPlatform.prefab"] = b.data();
  }
  return prefabs;
}

/* ============================= main scene ============================= */
function buildMainScene() {
  const b = new SceneBuilder(1);
  const platMat = "Assets/Materials/Platform.mat";
  const darkMat = "Assets/Materials/PlatformDark.mat";

  /* ---------- Managers ---------- */
  const managers = b.obj("Managers");
  const gmId = b.obj("GameManager", { parent: managers, tag: "GameController", components: [] });
  const amId = b.obj("AudioManager", { parent: managers, components: [] });
  const sfxId = b.obj("SFXSource", { parent: amId, components: [C.audio(null, { volume: 0.9 })] });
  const bgmId = b.obj("BGMSource", { parent: amId, components: [C.audio("Assets/Audio/BGM_Main.clip", { playOnAwake: true, loop: true, volume: 0.5 })] });
  const uiMgrId = b.obj("UIManager", { parent: managers, components: [] });
  b.obj("SceneLoader", { parent: managers, components: [C.script("SceneLoader", { mainSceneName: "MainGame" })] });

  /* ---------- Environment ---------- */
  const env = b.obj("Environment");
  b.obj("Ground", { parent: env, pos: [0, -0.5, 0], scale: [10, 1, 10], layer: LAYER.Environment,
    components: [...C.mesh("Cube", "Assets/Materials/StartPad.mat"), C.box()] });

  const startArea = b.obj("StartingArea", { parent: env });
  b.obj("Wall_L", { parent: startArea, pos: [5.25, 0.7, 0], scale: [0.5, 2.4, 10.5], layer: LAYER.Environment,
    components: [...C.mesh("Cube", "Assets/Materials/Wall.mat"), C.box()] });
  b.obj("Wall_R", { parent: startArea, pos: [-5.25, 0.7, 0], scale: [0.5, 2.4, 10.5], layer: LAYER.Environment,
    components: [...C.mesh("Cube", "Assets/Materials/Wall.mat"), C.box()] });
  b.obj("Wall_Back", { parent: startArea, pos: [0, 0.7, -5.25], scale: [10, 2.4, 0.5], layer: LAYER.Environment,
    components: [...C.mesh("Cube", "Assets/Materials/Wall.mat"), C.box()] });

  const sec1 = b.obj("StageSection01", { parent: env });
  b.obj("Bridge01", { parent: sec1, pos: [0, -0.5, 9], scale: [4, 1, 8], layer: LAYER.Environment,
    components: [...C.mesh("Cube", platMat), C.box()] });
  b.obj("CheckpointPlatform01", { parent: sec1, pos: [0, -0.5, 15], scale: [6, 1, 4], layer: LAYER.Environment,
    components: [...C.mesh("Cube", platMat), C.box()] });

  const sec2 = b.obj("StageSection02", { parent: env });
  b.obj("Platform02", { parent: sec2, pos: [0, -0.5, 27], scale: [8, 1, 8], layer: LAYER.Environment,
    components: [...C.mesh("Cube", platMat), C.box()] });
  b.obj("StepBlock01", { parent: sec2, pos: [2.5, 0, 29.5], scale: [1.6, 1, 1.6], layer: LAYER.Environment,
    components: [...C.mesh("Cube", darkMat), C.box()] });
  b.obj("Platform03", { parent: sec2, pos: [0, -0.5, 41], scale: [10, 1, 8], layer: LAYER.Environment,
    components: [...C.mesh("Cube", platMat), C.box()] });

  const sec3 = b.obj("StageSection03", { parent: env });
  b.obj("JumpPlatform", { parent: sec3, pos: [0, -0.5, 47.5], scale: [4, 1, 4], layer: LAYER.Environment,
    components: [...C.mesh("Cube", platMat), C.box()] });
  b.obj("HighPlatform", { parent: sec3, pos: [0, 3.5, 53.5], scale: [6, 1, 9], layer: LAYER.Environment,
    components: [...C.mesh("Cube", darkMat), C.box()] });
  const stepSpecs = [[0, 2.9, 58.9], [0, 2.1, 60.4], [0, 1.3, 61.9], [0, 0.5, 63.4]];
  stepSpecs.forEach((s, i) => {
    b.obj("Step_" + (i + 1), { parent: sec3, pos: s, scale: [3, 1, 1.7], layer: LAYER.Environment,
      components: [...C.mesh("Cube", darkMat), C.box()] });
  });
  b.obj("LowerArea", { parent: sec3, pos: [0, -0.5, 68], scale: [12, 1, 9.5], layer: LAYER.Environment,
    components: [...C.mesh("Cube", platMat), C.box()] });
  b.obj("Pillar_L", { parent: sec3, pos: [4.6, 1, 66], scale: [0.9, 3, 0.9], layer: LAYER.Environment,
    components: [...C.mesh("Cube", "Assets/Materials/Wall.mat"), C.box()] });
  b.obj("Pillar_R", { parent: sec3, pos: [-4.6, 1, 66], scale: [0.9, 3, 0.9], layer: LAYER.Environment,
    components: [...C.mesh("Cube", "Assets/Materials/Wall.mat"), C.box()] });

  const goalArea = b.obj("GoalArea", { parent: env });
  b.obj("GoalPlatform", { parent: goalArea, pos: [0, -0.5, 76], scale: [8, 1, 7], layer: LAYER.Environment,
    components: [...C.mesh("Cube", platMat), C.box()] });

  b.obj("KillZone", { parent: env, pos: [0, -14, 38], tag: "KillZone", layer: LAYER.Trigger,
    components: [C.box({ trigger: true, size: [320, 6, 320] })] });

  /* ---------- Player ---------- */
  const playerId = b.obj("Player", { pos: [0, 1.05, 0], tag: "Player", layer: LAYER.Player, components: [] });
  const modelId = b.obj("PlayerModel", { parent: playerId,
    components: [...C.mesh("Capsule", "Assets/Materials/PlayerBlue.mat")] });
  b.obj("Eye_L", { parent: modelId, pos: [0.17, 0.34, 0.42], scale: [0.15, 0.18, 0.1],
    components: [...C.mesh("Cube", "Assets/Materials/Eye.mat")] });
  b.obj("Eye_R", { parent: modelId, pos: [-0.17, 0.34, 0.42], scale: [0.15, 0.18, 0.1],
    components: [...C.mesh("Cube", "Assets/Materials/Eye.mat")] });
  const groundCheckId = b.obj("GroundCheck", { parent: playerId, pos: [0, -0.98, 0] });
  b.obj("CollectionPoint", { parent: playerId, pos: [0, 0.5, 0] });
  b.obj("PlayerParticle", { parent: playerId, pos: [0, -0.7, 0],
    components: [C.particle({ playOnAwake: true, emissionRate: 7, lifetime: 0.5, startSpeed: 0.25, startSize: 0.11, endSize: 0.01,
      startColor: col([0.5, 0.8, 1, 0.6]), endColor: col([0.4, 0.7, 1, 0]), gravityModifier: 0, shape: "Sphere", spread: 0.35, additive: true, worldSpace: true })] });
  const burstId = b.obj("CollectBurst", { parent: playerId, pos: [0, 0.5, 0],
    components: [C.particle({ playOnAwake: true, emissionRate: 0, lifetime: 0.75, startSpeed: 3.4, startSize: 0.16, endSize: 0.02,
      startColor: col([0.65, 1, 1, 1]), endColor: col([0.2, 0.8, 1, 0]), gravityModifier: 0.25, shape: "Sphere", spread: 0.2, additive: true, worldSpace: true })] });
  const camTargetId = b.obj("CameraTarget", { parent: playerId, pos: [0, 1.4, 0] });

  /* ---------- Camera & lighting ---------- */
  const camId = b.obj("Main Camera", { pos: [0, 4.2, -7.5], rot: [18, 0, 0], tag: "MainCamera", components: [] });
  b.obj("Directional Light", { pos: [12, 18, -10], rot: [50, -32, 0],
    components: [C.light()] });
  b.obj("PostProcessVolume", { components: [C.post()] });

  /* ---------- Collectibles ---------- */
  const collectibles = b.obj("Collectibles");
  const crystalSpots = [
    [0, 1.15, 12], [2.5, 1.75, 29.5], [-3.5, 1.15, 43], [0, 5.25, 57], [-4, 1.15, 69],
  ];
  crystalSpots.forEach((p, i) => {
    b.obj("Crystal_0" + (i + 1), {
      parent: collectibles, pos: p, tag: "Collectible", layer: LAYER.Collectible,
      prefab: "Assets/Prefabs/Crystal.prefab",
      components: [
        ...C.mesh("Crystal", "Assets/Materials/CrystalCyan.mat", { cast: false }),
        C.sphere({ trigger: true, radius: 0.75 }),
        C.script("CollectibleItem", { rotateSpeed: 90, bobHeight: 0.25, bobSpeed: 2 }),
        C.particle({ playOnAwake: true, emissionRate: 4, lifetime: 0.9, startSpeed: 0.35, startSize: 0.09, endSize: 0.01,
          startColor: col([0.6, 1, 1, 0.9]), endColor: col([0.4, 0.9, 1, 0]), gravityModifier: 0, shape: "Sphere", spread: 0.8, additive: true, worldSpace: true }),
        C.audio("Assets/Audio/Collect.clip"),
      ],
    });
  });

  /* ---------- Obstacles ---------- */
  const obstacles = b.obj("Obstacles");
  {
    const root = b.obj("RotatingBar", { parent: obstacles, pos: [0, 0.68, 9], tag: "Obstacle", layer: LAYER.Environment,
      prefab: "Assets/Prefabs/RotatingBar.prefab",
      components: [C.rb({ kinematic: true }), C.script("RotatingObstacle", { rotationAxis: 1, rotationSpeed: 90, reverse: false })] });
    b.obj("Pillar", { parent: root, pos: [0, -0.15, 0], scale: [0.34, 1.05, 0.34],
      components: [...C.mesh("Cylinder", darkMat)] });
    b.obj("Bar", { parent: root, pos: [0, 0.28, 0], scale: [5.2, 0.42, 0.42], layer: LAYER.Environment,
      components: [...C.mesh("Cube", "Assets/Materials/ObstacleOrange.mat"), C.box()] });
  }
  {
    const root = b.obj("MovingPlatform", { parent: obstacles, pos: [0, -0.3, 0], tag: "Obstacle",
      prefab: "Assets/Prefabs/MovingPlatform.prefab" });
    const pa = b.obj("PointA", { parent: root, pos: [0, 0, 18.8] });
    const pb = b.obj("PointB", { parent: root, pos: [0, 0, 23.4] });
    b.obj("Platform", { parent: root, pos: [0, 0, 18.8], scale: [3, 0.4, 3], layer: LAYER.Environment,
      components: [...C.mesh("Cube", "Assets/Materials/MovingPlat.mat"), C.box(), C.rb({ kinematic: true }),
        C.script("MovingPlatform", { pointA: ref(pa), pointB: ref(pb), moveSpeed: 3, waitTime: 1, easeMovement: true })] });
  }
  {
    const group = b.obj("FallingFloor", { parent: obstacles });
    [[0, -0.2, 32], [0, -0.2, 34.1], [0, -0.2, 36.2]].forEach((p, i) => {
      b.obj("FallingTile_0" + (i + 1), { parent: group, pos: p, scale: [2.2, 0.4, 1.9], tag: "Obstacle", layer: LAYER.Environment,
        components: [...C.mesh("Cube", "Assets/Materials/FallingTile.mat"), C.box(), C.rb({ kinematic: true }),
          C.script("FallingFloor", { fallDelay: 1.2, respawnDelay: 4, shakeDuration: 0.8, shakeAmount: 0.05 })] });
    });
  }
  {
    const root = b.obj("JumpPad", { parent: obstacles, pos: [0, 0, 47.5], tag: "Obstacle", layer: LAYER.Environment,
      prefab: "Assets/Prefabs/JumpPad.prefab",
      components: [C.box({ trigger: true, center: [0, 0.55, 0], size: [1.5, 1.1, 1.5] })] });
    const fx = b.obj("PadEffect", { parent: root, pos: [0, 0.2, 0],
      components: [C.particle({ playOnAwake: true, emissionRate: 0, lifetime: 0.6, startSpeed: 4.5, startSize: 0.14, endSize: 0.02,
        startColor: col([1, 0.95, 0.5, 1]), endColor: col([1, 0.7, 0.2, 0]), gravityModifier: 0.4, shape: "Cone", spread: 0.5, additive: true, worldSpace: true })] });
    b.obj("PadBase", { parent: root, pos: [0, 0.05, 0], scale: [1.7, 0.14, 1.7],
      components: [...C.mesh("Cylinder", "Assets/Materials/JumpPadYellow.mat")] });
    const rootObj = b.objs.find((o) => o.id === root);
    rootObj.components.push(C.script("JumpPad", { jumpPower: 12, effect: ref(fx, "ParticleSystem"), cooldown: 0.25 }));
  }
  {
    const root = b.obj("Pendulum", { parent: obstacles, pos: [0, 7.6, 53.5], tag: "Obstacle", layer: LAYER.Environment,
      components: [C.rb({ kinematic: true }), C.script("Pendulum", { swingAngle: 46, swingSpeed: 1.2, phase: 0 })] });
    b.obj("Beam", { parent: root, pos: [0, 0.35, 0], scale: [7, 0.35, 0.35],
      components: [...C.mesh("Cube", darkMat)] });
    b.obj("Arm", { parent: root, pos: [0, -1.7, 0], scale: [0.18, 3.3, 0.18],
      components: [...C.mesh("Cube", "Assets/Materials/PendulumSteel.mat")] });
    b.obj("Hammer", { parent: root, pos: [0, -3.55, 0], scale: [1.1, 1.1, 1.1], layer: LAYER.Environment,
      components: [...C.mesh("Cube", "Assets/Materials/PendulumSteel.mat"), C.box()] });
  }

  /* ---------- Enemies ---------- */
  const enemies = b.obj("Enemies");
  const wpGroup = b.obj("PatrolPoints", { parent: enemies });
  function makeEnemy(name, pos, wps, opts = {}) {
    const wpIds = wps.map((p, i) => b.obj(name + "_WP" + (i + 1), { parent: wpGroup, pos: p }));
    const root = b.obj(name, {
      parent: enemies, pos, tag: "Enemy", layer: LAYER.Enemy,
      prefab: "Assets/Prefabs/Enemy.prefab",
      components: [
        C.capsule({ radius: 0.45, height: 1.5 }),
        C.sphere({ trigger: true, radius: 0.85 }),
        C.rb({ kinematic: true }),
        C.script("EnemyController", {
          patrolPoints: wpIds.map((id) => ref(id)),
          patrolSpeed: opts.patrolSpeed ?? 2, chaseSpeed: opts.chaseSpeed ?? 4,
          detectionDistance: opts.detection ?? 8, attackDistance: 1.2, damage: 1,
          leashDistance: opts.leash ?? 14, target: null,
        }),
      ],
    });
    const model = b.obj("EnemyModel", { parent: root, scale: [0.85, 0.72, 0.85],
      components: [...C.mesh("Capsule", "Assets/Materials/EnemyRed.mat")] });
    b.obj("Eye_L", { parent: model, pos: [0.18, 0.3, 0.42], scale: [0.16, 0.16, 0.1],
      components: [...C.mesh("Cube", "Assets/Materials/Eye.mat")] });
    b.obj("Eye_R", { parent: model, pos: [-0.18, 0.3, 0.42], scale: [0.16, 0.16, 0.1],
      components: [...C.mesh("Cube", "Assets/Materials/Eye.mat")] });
    return root;
  }
  makeEnemy("Enemy_01", [0, 0.75, 40], [[-3.6, 0.75, 40], [3.6, 0.75, 40]], { detection: 5.5, leash: 9 });
  makeEnemy("Enemy_02", [0, 4.75, 55.5], [[0, 4.75, 50.5], [0, 4.75, 57]], { detection: 4.5, leash: 6, chaseSpeed: 3.4 });
  makeEnemy("Enemy_03", [3, 0.75, 68], [[3.6, 0.75, 65.5], [-3.6, 0.75, 70]], { detection: 9, leash: 10, chaseSpeed: 4.2 });

  /* ---------- Checkpoints ---------- */
  const checkpoints = b.obj("Checkpoints");
  function makeCheckpoint(name, pos) {
    return b.obj(name, {
      parent: checkpoints, pos, tag: "Checkpoint", layer: LAYER.Checkpoint, scale: [0.28, 1.15, 0.28],
      components: [
        ...C.mesh("Cube", "Assets/Materials/CheckpointGreen.mat"),
        C.box({ trigger: true, size: [16, 2.6, 10] }),
      ],
    });
  }
  makeCheckpoint("Checkpoint_01", [2.4, 0.65, 15.5]);
  makeCheckpoint("Checkpoint_02", [4.2, 0.65, 43.5]);

  /* ---------- Goal ---------- */
  const goalId = b.obj("Goal", { pos: [0, 1.7, 77.5], tag: "Goal",
    components: [C.box({ trigger: true, size: [2.8, 3.4, 1] })] });
  const ringId = b.obj("GoalRing", { parent: goalId, rot: [90, 0, 0], scale: [2.3, 2.3, 2.3],
    components: [...C.mesh("Torus", "Assets/Materials/GoalGold.mat", { cast: false })] });
  b.obj("GoalBeacon", { parent: goalId, pos: [0, -0.5, 0],
    components: [C.particle({ playOnAwake: true, emissionRate: 16, lifetime: 1.4, startSpeed: 2.4, startSize: 0.14, endSize: 0.03,
      startColor: col([1, 0.9, 0.4, 0.9]), endColor: col([1, 0.6, 0.15, 0]), gravityModifier: -0.15, shape: "Cone", spread: 0.35, additive: true, worldSpace: true })] });
  b.obj("Pillar_GL", { parent: goalId, pos: [1.6, -0.2, 0], scale: [0.3, 3.4, 0.3],
    components: [...C.mesh("Cube", "Assets/Materials/GoalGold.mat")] });
  b.obj("Pillar_GR", { parent: goalId, pos: [-1.6, -0.2, 0], scale: [0.3, 3.4, 0.3],
    components: [...C.mesh("Cube", "Assets/Materials/GoalGold.mat")] });
  const goalObj = b.objs.find((o) => o.id === goalId);
  goalObj.components.push(C.script("GoalController", { rotateSpeed: 40, ring: ref(ringId) }));

  /* ---------- UI ---------- */
  b.obj("EventSystem", { components: [C.eventSystem()] });
  const canvasId = b.obj("Canvas", { layer: LAYER.UI, components: [C.canvas()] });
  const hud = b.obj("HUD", { parent: canvasId });
  const crystalTextId = b.obj("CrystalCounter", { parent: hud,
    components: [C.text("CRYSTAL  0 / 5", { size: 20, bold: true, off: [24, 20], spacing: 1 })] });
  const timerTextId = b.obj("TimerText", { parent: hud,
    components: [C.text("TIME     03:00", { size: 20, bold: true, off: [24, 50], spacing: 1 })] });
  const lifeTextId = b.obj("LifeDisplay", { parent: hud,
    components: [C.text("LIFE     ● ● ●", { size: 20, bold: true, off: [24, 80], spacing: 1, color: [1, 0.5, 0.5, 1] })] });
  const msgTextId = b.obj("MessageText", { parent: hud, active: false,
    components: [C.text("", { size: 26, bold: true, anchor: "Center", align: "Center", off: [0, -90], color: [1, 0.95, 0.6, 1] })] });

  const pausePanelId = b.obj("PausePanel", { parent: canvasId, active: false,
    components: [C.panel({ color: [0, 0, 0, 0.66] })] });
  b.obj("PauseTitle", { parent: pausePanelId,
    components: [C.text("PAUSED", { size: 46, bold: true, anchor: "Center", align: "Center", off: [0, -140], spacing: 6 })] });
  b.obj("ResumeButton", { parent: pausePanelId,
    components: [C.button("RESUME", gmId, "OnResumeButton", { off: [0, -40] })] });
  b.obj("RestartButton", { parent: pausePanelId,
    components: [C.button("RESTART", gmId, "OnRestartButton", { off: [0, 18] })] });
  b.obj("SettingsButton", { parent: pausePanelId,
    components: [C.button("SETTINGS", gmId, "OnSettingsButton", { off: [0, 76] })] });
  b.obj("QuitButton", { parent: pausePanelId,
    components: [C.button("QUIT", gmId, "OnQuitButton", { off: [0, 134], bg: [0.5, 0.22, 0.24, 0.95] })] });
  const settingsPanelId = b.obj("SettingsPanel", { parent: pausePanelId, active: false });
  b.obj("SettingsBg", { parent: settingsPanelId,
    components: [C.image({ color: [0.09, 0.1, 0.15, 0.95], w: 250, h: 160, off: [310, 40], radius: 10 })] });
  b.obj("SettingsTitle", { parent: settingsPanelId,
    components: [C.text("SETTINGS", { size: 18, bold: true, anchor: "Center", align: "Center", off: [310, -15], spacing: 2 })] });
  b.obj("BgmLabel", { parent: settingsPanelId,
    components: [C.text("BGM", { size: 16, anchor: "Center", off: [245, 28] })] });
  b.obj("BgmDown", { parent: settingsPanelId,
    components: [C.button("-", amId, "OnBgmDown", { w: 34, h: 30, off: [330, 35], size: 18 })] });
  b.obj("BgmUp", { parent: settingsPanelId,
    components: [C.button("+", amId, "OnBgmUp", { w: 34, h: 30, off: [372, 35], size: 18 })] });
  b.obj("SfxLabel", { parent: settingsPanelId,
    components: [C.text("SFX", { size: 16, anchor: "Center", off: [245, 68] })] });
  b.obj("SfxDown", { parent: settingsPanelId,
    components: [C.button("-", amId, "OnSfxDown", { w: 34, h: 30, off: [330, 75], size: 18 })] });
  b.obj("SfxUp", { parent: settingsPanelId,
    components: [C.button("+", amId, "OnSfxUp", { w: 34, h: 30, off: [372, 75], size: 18 })] });

  const gameOverPanelId = b.obj("GameOverPanel", { parent: canvasId, active: false,
    components: [C.panel({ color: [0.2, 0.02, 0.02, 0.8] })] });
  b.obj("GameOverTitle", { parent: gameOverPanelId,
    components: [C.text("GAME OVER", { size: 48, bold: true, anchor: "Center", align: "Center", off: [0, -100], spacing: 5, color: [1, 0.45, 0.38, 1] })] });
  b.obj("RetryButton", { parent: gameOverPanelId,
    components: [C.button("RETRY", gmId, "OnRetryButton", { off: [0, 10] })] });
  b.obj("ReturnButton", { parent: gameOverPanelId,
    components: [C.button("RETURN", gmId, "OnRestartButton", { off: [0, 70] })] });

  const clearPanelId = b.obj("ClearPanel", { parent: canvasId, active: false,
    components: [C.panel({ color: [0.02, 0.09, 0.16, 0.85] })] });
  b.obj("ClearTitle", { parent: clearPanelId,
    components: [C.text("STAGE CLEAR", { size: 48, bold: true, anchor: "Center", align: "Center", off: [0, -150], spacing: 6, color: [1, 0.86, 0.4, 1] })] });
  const clearStatsId = b.obj("ClearStats", { parent: clearPanelId,
    components: [C.text("", { size: 22, anchor: "Center", align: "Left", off: [0, -30], spacing: 1 })] });
  b.obj("ClearRetryButton", { parent: clearPanelId,
    components: [C.button("RETRY", gmId, "OnRetryButton", { off: [0, 90] })] });
  b.obj("NextButton", { parent: clearPanelId,
    components: [C.button("NEXT", gmId, "OnNextButton", { off: [0, 150], bg: [0.86, 0.66, 0.2, 0.95], fg: [0.1, 0.08, 0.02, 1] })] });

  /* ---------- wire deferred component refs ---------- */
  const playerObj = b.objs.find((o) => o.id === playerId);
  playerObj.components.push(
    C.capsule({ radius: 0.5, height: 2 }),
    C.rb({ mass: 1, freezeRotation: true }),
    C.script("PlayerController", {
      moveSpeed: 6, dashSpeed: 10, jumpForce: 8, airControl: 0.4, rotationSpeed: 12,
      groundCheck: ref(groundCheckId), groundRadius: 0.34, groundLayer: ENV_MASK,
      cameraTransform: ref(camId), enableDoubleJump: true,
    }),
    C.script("PlayerHealth", { maxLives: 3, invincibleTime: 1.5, modelRoot: ref(modelId) }),
    C.script("PlayerCollector", { collectEffect: ref(burstId, "ParticleSystem") }),
    C.audio(null),
    C.animator(ref(modelId)),
  );
  const camObj = b.objs.find((o) => o.id === camId);
  camObj.components.push(
    C.camera(60),
    C.listener(),
    C.script("FollowCamera", {
      target: ref(camTargetId), distance: 7.5, height: 3.5,
      followSpeed: 8, rotationSpeed: 4, collisionMask: ENV_MASK,
    }),
  );
  const gmObj = b.objs.find((o) => o.id === gmId);
  gmObj.components.push(C.script("GameManager", {
    timeLimit: 180, totalCrystals: 5,
    player: ref(playerId, "PlayerHealth"), ui: ref(uiMgrId, "UIManager"),
  }));
  const amObj = b.objs.find((o) => o.id === amId);
  amObj.components.push(C.script("AudioManager", {
    sfxSource: ref(sfxId, "AudioSource"), bgmSource: ref(bgmId, "AudioSource"),
    jumpClip: "Assets/Audio/Jump.clip", doubleJumpClip: "Assets/Audio/DoubleJump.clip",
    landClip: "Assets/Audio/Land.clip", collectClip: "Assets/Audio/Collect.clip",
    damageClip: "Assets/Audio/Damage.clip", fallClip: "Assets/Audio/Fall.clip",
    jumpPadClip: "Assets/Audio/JumpPad.clip", checkpointClip: "Assets/Audio/Checkpoint.clip",
    goalClip: "Assets/Audio/Goal.clip", gameOverClip: "Assets/Audio/GameOver.clip",
    clickClip: "Assets/Audio/Click.clip", alertClip: "Assets/Audio/EnemyAlert.clip",
    fallingFloorClip: "Assets/Audio/FallingFloor.clip",
  }));
  const uiMgrObj = b.objs.find((o) => o.id === uiMgrId);
  uiMgrObj.components.push(C.script("UIManager", {
    crystalText: ref(crystalTextId, "Text"), timerText: ref(timerTextId, "Text"),
    lifeText: ref(lifeTextId, "Text"), messageText: ref(msgTextId, "Text"),
    pausePanel: ref(pausePanelId, "GameObject"), gameOverPanel: ref(gameOverPanelId, "GameObject"),
    clearPanel: ref(clearPanelId, "GameObject"), settingsPanel: ref(settingsPanelId, "GameObject"),
    clearStatsText: ref(clearStatsId, "Text"),
  }));

  return {
    name: "MainGame",
    settings: { gravity: { x: 0, y: -9.81, z: 0 }, fixedTimestep: 1 / 50 },
    objects: b.objs,
  };
}

/* ============================= project bundle ============================= */
function buildDemoProjectData() {
  return {
    version: 1,
    name: "WebityCubeAdventure",
    materials: JSON.parse(JSON.stringify(DEMO_MATERIALS)),
    audioClips: { ...DEMO_AUDIO_CLIPS },
    textures: { ...DEMO_TEXTURES },
    prefabs: buildPrefabs(),
    scripts: Object.fromEntries(Object.entries(DEMO_SCRIPTS).map(([p, src]) => [p, { source: src }])),
    scenes: { "Assets/Scenes/MainGame.scene": buildMainScene() },
    activeScene: "Assets/Scenes/MainGame.scene",
  };
}

function loadProjectIntoAssets(project) {
  WAssets.reset();
  WAssets.loadMaterials(project.materials || {});
  for (const [path, synth] of Object.entries(project.audioClips || {})) WAssets.defineAudioClip(path, synth);
  for (const [path, tex] of Object.entries(project.textures || {})) WAssets.defineTexture(path, tex);
  for (const [path, objs] of Object.entries(project.prefabs || {})) WAssets.definePrefab(path, objs);
  for (const [path, rec] of Object.entries(project.scripts || {})) WAssets.defineScript(path, rec.source);
  for (const [path, json] of Object.entries(project.scenes || {})) WAssets.scenes.set(path, json);
}
