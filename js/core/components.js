/* Webity built-in components */
"use strict";

/* ---------------- MeshFilter ---------------- */
class MeshFilter extends WComponent {}
MeshFilter.compName = "MeshFilter";
ComponentRegistry.register({
  name: "MeshFilter", icon: "▦", category: "Mesh", cls: MeshFilter,
  fields: [{ name: "mesh", label: "Mesh", type: "mesh", default: "Cube" }],
});

/* ---------------- MeshRenderer ---------------- */
class MeshRenderer extends WComponent {
  constructor() { super(); this._instMaterial = null; }
  get material() {
    if (!this._instMaterial) {
      const src = WAssets.getMaterial(this.materialPath);
      this._instMaterial = src ? {
        name: src.name + " (Instance)",
        color: src.color.clone(), emission: src.emission.clone(),
        emissionIntensity: src.emissionIntensity, texture: src.texture, texScale: src.texScale,
        specular: src.specular, specPower: src.specPower, transparent: src.transparent, alpha: src.alpha,
        SetColor(prop, c) { if (/emission/i.test(prop)) this.emission = Color.from(c); else this.color = Color.from(c); },
        GetColor(prop) { return /emission/i.test(prop) ? this.emission.clone() : this.color.clone(); },
      } : null;
    }
    return this._instMaterial;
  }
  set material(m) { this._instMaterial = m; }
  get sharedMaterial() { return WAssets.getMaterial(this.materialPath); }
  resolveMaterial() { return this._instMaterial || WAssets.getMaterial(this.materialPath) || DEFAULT_MATERIAL; }
}
MeshRenderer.compName = "MeshRenderer";
const DEFAULT_MATERIAL = {
  name: "Default", color: new Color(0.8, 0.8, 0.8, 1), emission: Color.black, emissionIntensity: 1,
  texture: null, texScale: 1, specular: 0.25, specPower: 32, transparent: false, alpha: 1,
};
ComponentRegistry.register({
  name: "MeshRenderer", icon: "🎨", category: "Mesh", cls: MeshRenderer,
  fields: [
    { name: "materialPath", label: "Material", type: "asset", assetKind: "material", default: null },
    { name: "castShadows", label: "Cast Shadows", type: "bool", default: true },
    { name: "receiveShadows", label: "Receive Shadows", type: "bool", default: true },
  ],
});

/* ---------------- Camera ---------------- */
class CameraComp extends WComponent {
  get fieldOfView() { return this.fov; }
  set fieldOfView(v) { this.fov = v; }
}
CameraComp.compName = "Camera";
ComponentRegistry.register({
  name: "Camera", icon: "🎥", category: "Rendering", cls: CameraComp,
  fields: [
    { name: "fov", label: "Field Of View", type: "float", default: 60, min: 10, max: 120, slider: true },
    { name: "nearClip", label: "Near Clip", type: "float", default: 0.1, min: 0.01 },
    { name: "farClip", label: "Far Clip", type: "float", default: 300 },
  ],
});

/* ---------------- Light ---------------- */
class LightComp extends WComponent {}
LightComp.compName = "Light";
ComponentRegistry.register({
  name: "Light", icon: "💡", category: "Rendering", cls: LightComp,
  fields: [
    { name: "lightType", label: "Type", type: "enum", options: ["Directional"], default: "Directional" },
    { name: "color", label: "Color", type: "color", default: new Color(1, 0.956, 0.89, 1) },
    { name: "intensity", label: "Intensity", type: "float", default: 1, min: 0, max: 3, slider: true },
    { name: "shadows", label: "Shadows", type: "bool", default: true },
  ],
});

/* ---------------- AudioListener ---------------- */
class AudioListener extends WComponent {}
AudioListener.compName = "AudioListener";
ComponentRegistry.register({ name: "AudioListener", icon: "🎧", category: "Audio", cls: AudioListener, fields: [] });

/* ---------------- AudioSource ---------------- */
class AudioSource extends WComponent {
  Play() { this._playClip(this.clipPath); }
  PlayOneShot(clip, volumeScale = 1) {
    const path = typeof clip === "string" ? clip : this.clipPath;
    this._playClip(path, volumeScale);
  }
  _playClip(path, volumeScale = 1) {
    if (!path) return;
    const def = WAssets.getAudioClip(path);
    if (def) WAudio.play(def.clip, this.volume * volumeScale, this.pitch);
  }
  Stop() { /* one-shots are fire-and-forget; stop BGM if that clip */
    const def = this.clipPath && WAssets.getAudioClip(this.clipPath);
    if (def && WAudio.isBGM(def.clip)) WAudio.stopBGM();
  }
  onStartRuntime() {
    if (this.playOnAwake && this.clipPath) {
      const def = WAssets.getAudioClip(this.clipPath);
      if (def && WAudio.isBGM(def.clip)) WAudio.playBGM(def.clip);
      else if (def && this.loop) WAudio.playBGM(def.clip);
      else this.Play();
    }
  }
  get clip() { return this.clipPath; }
  set clip(c) { this.clipPath = c; }
  onUpdateRuntime() {
    // keep global BGM volume in sync when this source drives the BGM
    const def = this.clipPath && WAssets.getAudioClip(this.clipPath);
    if (def && WAudio.isBGM(def.clip)) WAudio.setBgmVolume(Mathf.Clamp01(this.volume));
  }
}
AudioSource.compName = "AudioSource";
ComponentRegistry.register({
  name: "AudioSource", icon: "🔊", category: "Audio", cls: AudioSource,
  fields: [
    { name: "clipPath", label: "AudioClip", type: "asset", assetKind: "audio", default: null },
    { name: "playOnAwake", label: "Play On Awake", type: "bool", default: false },
    { name: "loop", label: "Loop", type: "bool", default: false },
    { name: "volume", label: "Volume", type: "float", default: 1, min: 0, max: 1, slider: true },
    { name: "pitch", label: "Pitch", type: "float", default: 1, min: 0.5, max: 2, slider: true },
  ],
});

/* ---------------- Rigidbody ---------------- */
class Rigidbody extends WComponent {
  constructor() {
    super();
    this._velocity = new Vector3();
    this._angularVelocity = new Vector3();
    this._accumForce = new Vector3();
    this._grounded = false;
    this._groundCollider = null;
    this._sleeping = false;
  }
  /* struct-like semantics: always hand out copies */
  get velocity() { return this._velocity.clone(); }
  set velocity(v) { this._velocity = Vector3.from(v).clone(); this._sleeping = false; }
  get angularVelocity() { return this._angularVelocity.clone(); }
  set angularVelocity(v) { this._angularVelocity = Vector3.from(v).clone(); }
  AddForce(v, mode = "Force") {
    if (mode === "Impulse" || mode === 1) this.velocity = this.velocity.add(v.div(Math.max(this.mass, 0.001)));
    else if (mode === "VelocityChange" || mode === 2) this.velocity = this.velocity.add(v);
    else this._accumForce = this._accumForce.add(v);
    this._sleeping = false;
  }
  AddTorque() { /* simplified: no-op */ }
  MovePosition(p) { this._movePos = p.clone(); }
  MoveRotation(q) { this._moveRot = q.clone(); }
  get position() { return this.transform.position; }
  set position(v) { this.transform.position = v; }
  get IsSleeping() { return this._sleeping; }
}
Rigidbody.compName = "Rigidbody";
ComponentRegistry.register({
  name: "Rigidbody", icon: "🟣", category: "Physics", cls: Rigidbody,
  fields: [
    { name: "mass", label: "Mass", type: "float", default: 1, min: 0.001 },
    { name: "drag", label: "Drag", type: "float", default: 0, min: 0 },
    { name: "useGravity", label: "Use Gravity", type: "bool", default: true },
    { name: "isKinematic", label: "Is Kinematic", type: "bool", default: false },
    { name: "freezeRotation", label: "Freeze Rotation", type: "bool", default: false },
  ],
});

/* ---------------- Colliders ---------------- */
class BoxCollider extends WComponent {}
BoxCollider.compName = "BoxCollider";
ComponentRegistry.register({
  name: "BoxCollider", icon: "🟩", category: "Physics", cls: BoxCollider,
  fields: [
    { name: "isTrigger", label: "Is Trigger", type: "bool", default: false },
    { name: "center", label: "Center", type: "vector3", default: new Vector3() },
    { name: "size", label: "Size", type: "vector3", default: new Vector3(1, 1, 1) },
  ],
});
class SphereCollider extends WComponent {}
SphereCollider.compName = "SphereCollider";
ComponentRegistry.register({
  name: "SphereCollider", icon: "🟢", category: "Physics", cls: SphereCollider,
  fields: [
    { name: "isTrigger", label: "Is Trigger", type: "bool", default: false },
    { name: "center", label: "Center", type: "vector3", default: new Vector3() },
    { name: "radius", label: "Radius", type: "float", default: 0.5, min: 0.01 },
  ],
});
class CapsuleCollider extends WComponent {}
CapsuleCollider.compName = "CapsuleCollider";
ComponentRegistry.register({
  name: "CapsuleCollider", icon: "💊", category: "Physics", cls: CapsuleCollider,
  fields: [
    { name: "isTrigger", label: "Is Trigger", type: "bool", default: false },
    { name: "center", label: "Center", type: "vector3", default: new Vector3() },
    { name: "radius", label: "Radius", type: "float", default: 0.5, min: 0.01 },
    { name: "height", label: "Height", type: "float", default: 2, min: 0.01 },
  ],
});

/* ---------------- ParticleSystem (config; sim in particles.js) ---------------- */
class ParticleSystemComp extends WComponent {
  constructor() { super(); this._sim = null; this._playing = false; }
  Play() { this._playing = true; if (this._sim) this._sim.playing = true; }
  Stop() { this._playing = false; if (this._sim) this._sim.playing = false; }
  Emit(n) { if (this._sim) this._sim.burst(n); else this._pendingBurst = (this._pendingBurst || 0) + n; }
  get isPlaying() { return this._playing; }
  onStartRuntime() { this._playing = this.playOnAwake; }
}
ParticleSystemComp.compName = "ParticleSystem";
ComponentRegistry.register({
  name: "ParticleSystem", icon: "✨", category: "Effects", cls: ParticleSystemComp,
  fields: [
    { name: "playOnAwake", label: "Play On Awake", type: "bool", default: true },
    { name: "emissionRate", label: "Emission Rate", type: "float", default: 10, min: 0, max: 200, slider: true },
    { name: "lifetime", label: "Lifetime", type: "float", default: 1, min: 0.05 },
    { name: "startSpeed", label: "Start Speed", type: "float", default: 1 },
    { name: "startSize", label: "Start Size", type: "float", default: 0.2, min: 0.01 },
    { name: "endSize", label: "End Size", type: "float", default: 0.05, min: 0 },
    { name: "startColor", label: "Start Color", type: "color", default: new Color(1, 1, 1, 1) },
    { name: "endColor", label: "End Color", type: "color", default: new Color(1, 1, 1, 0) },
    { name: "gravityModifier", label: "Gravity Modifier", type: "float", default: 0 },
    { name: "shape", label: "Shape", type: "enum", options: ["Sphere", "Cone", "Point"], default: "Sphere" },
    { name: "spread", label: "Spread", type: "float", default: 0.5, min: 0 },
    { name: "additive", label: "Additive Blend", type: "bool", default: true },
    { name: "worldSpace", label: "World Space", type: "bool", default: true },
  ],
});

/* ---------------- PostProcessVolume (also holds environment settings) ---------------- */
class PostProcessVolume extends WComponent {}
PostProcessVolume.compName = "PostProcessVolume";
ComponentRegistry.register({
  name: "PostProcessVolume", icon: "🌈", category: "Rendering", cls: PostProcessVolume,
  fields: [
    { name: "vignette", label: "Vignette", type: "float", default: 0.35, min: 0, max: 1, slider: true },
    { name: "bloom", label: "Bloom", type: "float", default: 0.6, min: 0, max: 2, slider: true },
    { name: "saturation", label: "Saturation", type: "float", default: 1.1, min: 0, max: 2, slider: true },
    { name: "exposure", label: "Exposure", type: "float", default: 1.05, min: 0.2, max: 2, slider: true },
    { name: "contrast", label: "Contrast", type: "float", default: 1.03, min: 0.5, max: 1.5, slider: true },
    { name: "header_env", label: "Environment", type: "header" },
    { name: "skyTop", label: "Sky Top", type: "color", default: new Color(0.28, 0.48, 0.78, 1) },
    { name: "skyHorizon", label: "Sky Horizon", type: "color", default: new Color(0.74, 0.82, 0.92, 1) },
    { name: "skyBottom", label: "Sky Bottom", type: "color", default: new Color(0.24, 0.22, 0.25, 1) },
    { name: "ambientSky", label: "Ambient Sky", type: "color", default: new Color(0.42, 0.47, 0.55, 1) },
    { name: "ambientGround", label: "Ambient Ground", type: "color", default: new Color(0.22, 0.2, 0.19, 1) },
    { name: "fogColor", label: "Fog Color", type: "color", default: new Color(0.68, 0.76, 0.88, 1) },
    { name: "fogDensity", label: "Fog Density", type: "float", default: 0.008, min: 0, max: 0.05, step: 0.001, slider: true },
  ],
});

/* ---------------- Animator (procedural locomotion animation) ---------------- */
class Animator extends WComponent {
  constructor() {
    super();
    this._phase = 0; this._squash = 0; this._state = "Idle";
    this._baseScale = null; this._baseLocalPos = null; this._wasGrounded = true;
  }
  onStartRuntime() {
    if (this.model) {
      this._baseScale = this.model.localScale;
      this._baseLocalPos = this.model.localPosition;
    }
  }
  onUpdateRuntime(dt) {
    if (!this.model || !this._baseScale) return;
    const rb = this.gameObject.GetComponent("Rigidbody");
    const vel = rb ? rb.velocity : Vector3.zero;
    const hSpeed = Math.hypot(vel.x, vel.z);
    const grounded = rb ? rb._grounded : true;
    this._state = !grounded ? (vel.y > 0.5 ? "Jump" : "Fall") : (hSpeed > 0.3 ? "Run" : "Idle");
    if (grounded && !this._wasGrounded) this._squash = Math.min(0.35, Math.abs(vel.y) * 0.03 + 0.12);
    this._wasGrounded = grounded;
    this._squash = Mathf.MoveTowards(this._squash, 0, dt * 2.2);
    this._phase += dt * hSpeed * this.bobFrequency;
    const bob = grounded ? Math.abs(Math.sin(this._phase)) * this.bobAmplitude * Math.min(hSpeed / 4, 1) : 0;
    let sy = 1 - this._squash, sxz = 1 + this._squash * 0.6;
    if (!grounded) { sy = 1 + Math.min(0.15, Math.abs(vel.y) * 0.012); sxz = 1 - Math.min(0.1, Math.abs(vel.y) * 0.008); }
    this.model.localScale = new Vector3(this._baseScale.x * sxz, this._baseScale.y * sy, this._baseScale.z * sxz);
    this.model.localPosition = new Vector3(this._baseLocalPos.x, this._baseLocalPos.y + bob, this._baseLocalPos.z);
    const tilt = Mathf.Clamp(hSpeed * this.runTilt, 0, 12);
    this.model.localRotation = Quaternion.Euler(tilt, 0, Math.sin(this._phase) * 2 * Math.min(hSpeed / 4, 1));
  }
  GetState() { return this._state; }
}
Animator.compName = "Animator";
ComponentRegistry.register({
  name: "Animator", icon: "🏃", category: "Animation", cls: Animator,
  fields: [
    { name: "model", label: "Model", type: "objectRef", refKind: "Transform", default: null },
    { name: "bobAmplitude", label: "Bob Amplitude", type: "float", default: 0.06, min: 0, max: 0.3, slider: true },
    { name: "bobFrequency", label: "Bob Frequency", type: "float", default: 2.4, min: 0, max: 10, slider: true },
    { name: "runTilt", label: "Run Tilt", type: "float", default: 1.6, min: 0, max: 5, slider: true },
  ],
});

/* ---------------- UI components (rendered as DOM by uiRuntime) ---------------- */
const UI_ANCHORS = ["TopLeft", "Top", "TopRight", "Left", "Center", "Right", "BottomLeft", "Bottom", "BottomRight"];

class CanvasComp extends WComponent {}
CanvasComp.compName = "Canvas";
ComponentRegistry.register({
  name: "Canvas", icon: "🖼", category: "UI", cls: CanvasComp,
  fields: [
    { name: "sortOrder", label: "Sort Order", type: "int", default: 0 },
  ],
});

class EventSystemComp extends WComponent {}
EventSystemComp.compName = "EventSystem";
ComponentRegistry.register({ name: "EventSystem", icon: "🖱", category: "UI", cls: EventSystemComp, fields: [] });

class UIText extends WComponent {
  get text() { return this.content; }
  set text(v) { this.content = String(v); }
}
UIText.compName = "Text";
ComponentRegistry.register({
  name: "Text", icon: "🅣", category: "UI", cls: UIText,
  fields: [
    { name: "content", label: "Text", type: "text", default: "New Text" },
    { name: "fontSize", label: "Font Size", type: "int", default: 16, min: 6, max: 90 },
    { name: "color", label: "Color", type: "color", default: Color.white },
    { name: "bold", label: "Bold", type: "bool", default: false },
    { name: "align", label: "Alignment", type: "enum", options: ["Left", "Center", "Right"], default: "Left" },
    { name: "anchor", label: "Anchor", type: "enum", options: UI_ANCHORS, default: "TopLeft" },
    { name: "offsetX", label: "Offset X", type: "float", default: 0 },
    { name: "offsetY", label: "Offset Y", type: "float", default: 0 },
    { name: "letterSpacing", label: "Letter Spacing", type: "float", default: 0 },
  ],
});

class UIImage extends WComponent {}
UIImage.compName = "Image";
ComponentRegistry.register({
  name: "Image", icon: "🟦", category: "UI", cls: UIImage,
  fields: [
    { name: "color", label: "Color", type: "color", default: new Color(1, 1, 1, 1) },
    { name: "width", label: "Width", type: "float", default: 100, min: 0 },
    { name: "height", label: "Height", type: "float", default: 100, min: 0 },
    { name: "cornerRadius", label: "Corner Radius", type: "float", default: 0, min: 0 },
    { name: "anchor", label: "Anchor", type: "enum", options: UI_ANCHORS, default: "Center" },
    { name: "offsetX", label: "Offset X", type: "float", default: 0 },
    { name: "offsetY", label: "Offset Y", type: "float", default: 0 },
  ],
});

class UIPanel extends WComponent {}
UIPanel.compName = "Panel";
ComponentRegistry.register({
  name: "Panel", icon: "▢", category: "UI", cls: UIPanel,
  fields: [
    { name: "color", label: "Background", type: "color", default: new Color(0, 0, 0, 0.72) },
    { name: "blur", label: "Blur Background", type: "bool", default: true },
  ],
});

class UIButton extends WComponent {
  constructor() { super(); this._hover = false; }
}
UIButton.compName = "Button";
ComponentRegistry.register({
  name: "Button", icon: "🔘", category: "UI", cls: UIButton,
  fields: [
    { name: "label", label: "Label", type: "string", default: "Button" },
    { name: "fontSize", label: "Font Size", type: "int", default: 18, min: 6, max: 60 },
    { name: "width", label: "Width", type: "float", default: 220, min: 10 },
    { name: "height", label: "Height", type: "float", default: 42, min: 10 },
    { name: "bgColor", label: "Background", type: "color", default: new Color(0.16, 0.42, 0.72, 0.95) },
    { name: "textColor", label: "Text Color", type: "color", default: Color.white },
    { name: "anchor", label: "Anchor", type: "enum", options: UI_ANCHORS, default: "Center" },
    { name: "offsetX", label: "Offset X", type: "float", default: 0 },
    { name: "offsetY", label: "Offset Y", type: "float", default: 0 },
    { name: "onClickTarget", label: "On Click → Target", type: "objectRef", refKind: "GameObject", default: null },
    { name: "onClickMessage", label: "On Click → Method", type: "string", default: "" },
  ],
});
