/* Webity WebGL2 renderer — lit pass, shadow map, sky, lines, particles, post-process */
"use strict";

const WRenderer = (() => {
  let gl = null, canvas = null;
  let progLit, progUnlit, progSky, progParticle, progPost, progShadow;
  const meshCache = new WeakMap();
  const texCache = {};
  let shadowFBO = null, shadowTex = null;
  const SHADOW_SIZE = 2048;
  let shadowVP = new Matrix4();
  let shadowReady = false;
  let lineBuf = null, lineVAO = null, lineCapacity = 0;
  let partBuf = null, partVAO = null, partIdxBuf = null, partCapacity = 0;
  let postFBO = null, postTex = null, postDepth = null, postW = 0, postH = 0;
  let quadVAO = null;
  let dpr = 1;
  let stats = { drawCalls: 0, tris: 0 };

  /* ---------------- shaders ---------------- */
  function compile(vs, fs, name) {
    function sh(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(`Shader ${name}: ${gl.getShaderInfoLog(s)}`);
      return s;
    }
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error(`Link ${name}: ${gl.getProgramInfoLog(p)}`);
    const uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      uniforms[info.name.replace("[0]", "")] = gl.getUniformLocation(p, info.name);
    }
    return { prog: p, u: uniforms };
  }

  const LIT_VS = `#version 300 es
  layout(location=0) in vec3 aPos;
  layout(location=1) in vec3 aNormal;
  layout(location=2) in vec2 aUV;
  uniform mat4 uProj, uView, uModel;
  uniform mat4 uShadowVP;
  out vec3 vWorldPos; out vec3 vNormal; out vec2 vUV; out vec4 vShadowCoord;
  void main() {
    vec4 wp = uModel * vec4(aPos, 1.0);
    vWorldPos = wp.xyz;
    vNormal = mat3(uModel) * aNormal;
    vUV = aUV;
    vShadowCoord = uShadowVP * wp;
    gl_Position = uProj * uView * wp;
  }`;

  const LIT_FS = `#version 300 es
  precision highp float;
  in vec3 vWorldPos; in vec3 vNormal; in vec2 vUV; in vec4 vShadowCoord;
  uniform vec4 uColor;
  uniform vec3 uEmission;
  uniform vec3 uLightDir;     // direction TOWARDS light
  uniform vec3 uLightColor;
  uniform vec3 uAmbientSky, uAmbientGround;
  uniform vec3 uCameraPos;
  uniform float uSpecStrength, uSpecPower;
  uniform int uUseTex;
  uniform sampler2D uTexture;
  uniform float uTexScale;
  uniform int uReceiveShadow;
  uniform highp sampler2DShadow uShadowMap;
  uniform vec4 uFogColor; uniform float uFogDensity;
  out vec4 fragColor;
  float shadowFactor() {
    if (uReceiveShadow == 0) return 1.0;
    vec3 sc = vShadowCoord.xyz / vShadowCoord.w;
    sc = sc * 0.5 + 0.5;
    if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
    float sum = 0.0;
    float texel = 1.0 / 2048.0;
    for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
      sum += texture(uShadowMap, vec3(sc.xy + vec2(float(i), float(j)) * texel, sc.z - 0.0028));
    }
    return 0.35 + 0.65 * (sum / 9.0);
  }
  void main() {
    vec3 n = normalize(vNormal);
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    if (dot(n, viewDir) < 0.0) n = -n; // double sided
    vec4 albedo = uColor;
    if (uUseTex == 1) albedo *= texture(uTexture, vUV * uTexScale);
    float ndl = max(dot(n, uLightDir), 0.0);
    float sh = shadowFactor();
    vec3 hemi = mix(uAmbientGround, uAmbientSky, n.y * 0.5 + 0.5);
    vec3 diffuse = uLightColor * ndl * sh;
    vec3 h = normalize(uLightDir + viewDir);
    float spec = pow(max(dot(n, h), 0.0), uSpecPower) * uSpecStrength * sh * step(0.01, ndl);
    vec3 col = albedo.rgb * (diffuse + hemi) + uLightColor * spec + uEmission;
    float dist = length(uCameraPos - vWorldPos);
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    col = mix(col, uFogColor.rgb, clamp(fog, 0.0, 1.0) * uFogColor.a);
    fragColor = vec4(col, albedo.a);
  }`;

  const SHADOW_VS = `#version 300 es
  layout(location=0) in vec3 aPos;
  uniform mat4 uShadowVP, uModel;
  void main() { gl_Position = uShadowVP * uModel * vec4(aPos, 1.0); }`;
  const SHADOW_FS = `#version 300 es
  precision highp float;
  out vec4 fragColor;
  void main() { fragColor = vec4(1.0); }`;

  const UNLIT_VS = `#version 300 es
  layout(location=0) in vec3 aPos;
  uniform mat4 uProj, uView, uModel;
  void main() { gl_Position = uProj * uView * uModel * vec4(aPos, 1.0); }`;
  const UNLIT_FS = `#version 300 es
  precision highp float;
  uniform vec4 uColor;
  out vec4 fragColor;
  void main() { fragColor = uColor; }`;

  const SKY_VS = `#version 300 es
  layout(location=0) in vec2 aPos;
  out vec2 vPos;
  void main() { vPos = aPos; gl_Position = vec4(aPos, 0.99999, 1.0); }`;
  const SKY_FS = `#version 300 es
  precision highp float;
  in vec2 vPos;
  uniform vec3 uTop, uHorizon, uBottom;
  uniform mat4 uInvVP;
  out vec4 fragColor;
  void main() {
    vec4 a = uInvVP * vec4(vPos, 0.1, 1.0);
    vec4 b = uInvVP * vec4(vPos, 0.9, 1.0);
    vec3 dir = normalize(b.xyz / b.w - a.xyz / a.w);
    float t = dir.y;
    vec3 col = t > 0.0 ? mix(uHorizon, uTop, pow(min(t * 1.4, 1.0), 0.7))
                       : mix(uHorizon, uBottom, pow(min(-t * 2.0, 1.0), 0.6));
    // subtle sun glow
    fragColor = vec4(col, 1.0);
  }`;

  const PART_VS = `#version 300 es
  layout(location=0) in vec3 aCenter;
  layout(location=1) in vec2 aOffset;
  layout(location=2) in vec4 aColor;
  layout(location=3) in float aSize;
  uniform mat4 uProj, uView;
  out vec4 vColor; out vec2 vOffset;
  void main() {
    vColor = aColor; vOffset = aOffset;
    vec4 viewPos = uView * vec4(aCenter, 1.0);
    viewPos.xy += aOffset * aSize;
    gl_Position = uProj * viewPos;
  }`;
  const PART_FS = `#version 300 es
  precision highp float;
  in vec4 vColor; in vec2 vOffset;
  out vec4 fragColor;
  void main() {
    float d = length(vOffset) * 2.0;
    float a = smoothstep(1.0, 0.25, d);
    fragColor = vec4(vColor.rgb, vColor.a * a);
  }`;

  const POST_VS = `#version 300 es
  layout(location=0) in vec2 aPos;
  out vec2 vUV;
  void main() { vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
  const POST_FS = `#version 300 es
  precision highp float;
  in vec2 vUV;
  uniform sampler2D uTex;
  uniform float uVignette, uSaturation, uExposure, uContrast;
  uniform float uBloom;
  out vec4 fragColor;
  void main() {
    vec3 col = texture(uTex, vUV).rgb;
    if (uBloom > 0.001) {
      vec3 glow = vec3(0.0);
      float total = 0.0;
      for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) {
        vec2 off = vec2(float(i), float(j)) * 0.004;
        vec3 s = texture(uTex, vUV + off).rgb;
        float lum = dot(s, vec3(0.299, 0.587, 0.114));
        glow += s * smoothstep(0.62, 1.1, lum);
        total += 1.0;
      }
      col += glow / total * uBloom;
    }
    col *= uExposure;
    col = (col - 0.5) * uContrast + 0.5;
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(lum), col, uSaturation);
    vec2 d = vUV - 0.5;
    float vig = 1.0 - smoothstep(0.35, 0.85, length(d) * 1.2) * uVignette;
    col *= vig;
    fragColor = vec4(col, 1.0);
  }`;

  /* ---------------- init ---------------- */
  function init(cv) {
    canvas = cv;
    gl = canvas.getContext("webgl2", { antialias: true, alpha: false, stencil: false });
    if (!gl) throw new Error("WebGL2 not supported");
    progLit = compile(LIT_VS, LIT_FS, "lit");
    progUnlit = compile(UNLIT_VS, UNLIT_FS, "unlit");
    progSky = compile(SKY_VS, SKY_FS, "sky");
    progParticle = compile(PART_VS, PART_FS, "particle");
    progPost = compile(POST_VS, POST_FS, "post");
    progShadow = compile(SHADOW_VS, SHADOW_FS, "shadow");
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0.1, 0.1, 0.1, 1);
    initShadow();
    initQuad();
    initTextures();
  }

  function initShadow() {
    shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE, 0,
      gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    shadowFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function initQuad() {
    quadVAO = gl.createVertexArray();
    gl.bindVertexArray(quadVAO);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  /* Procedural textures */
  function makeCanvasTex(size, draw) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const x = c.getContext("2d");
    draw(x, size);
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const ext = gl.getExtension("EXT_texture_filter_anisotropic");
    if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    return { tex: t, canvas: c };
  }

  function initTextures() {
    texCache.White = makeCanvasTex(4, (x) => { x.fillStyle = "#fff"; x.fillRect(0, 0, 4, 4); });
    texCache.Grid = makeCanvasTex(128, (x, s) => {
      x.fillStyle = "#ffffff"; x.fillRect(0, 0, s, s);
      x.strokeStyle = "rgba(0,0,0,0.22)"; x.lineWidth = 2;
      x.strokeRect(1, 1, s - 2, s - 2);
      x.strokeStyle = "rgba(0,0,0,0.08)"; x.lineWidth = 1;
      x.beginPath();
      x.moveTo(s / 2, 0); x.lineTo(s / 2, s); x.moveTo(0, s / 2); x.lineTo(s, s / 2);
      x.stroke();
    });
    texCache.Checker = makeCanvasTex(128, (x, s) => {
      x.fillStyle = "#ffffff"; x.fillRect(0, 0, s, s);
      x.fillStyle = "#c9c9c9";
      x.fillRect(0, 0, s / 2, s / 2); x.fillRect(s / 2, s / 2, s / 2, s / 2);
    });
    texCache.Dots = makeCanvasTex(128, (x, s) => {
      x.fillStyle = "#ffffff"; x.fillRect(0, 0, s, s);
      x.fillStyle = "rgba(0,0,0,0.18)";
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        x.beginPath(); x.arc(s / 8 + i * s / 4, s / 8 + j * s / 4, s / 24, 0, 7); x.fill();
      }
    });
    texCache.Stripes = makeCanvasTex(128, (x, s) => {
      x.fillStyle = "#ffffff"; x.fillRect(0, 0, s, s);
      x.fillStyle = "rgba(0,0,0,0.35)";
      x.save(); x.translate(s / 2, s / 2); x.rotate(Math.PI / 4); x.translate(-s, -s);
      for (let i = 0; i < 12; i++) x.fillRect(0, i * s / 4, s * 2, s / 8);
      x.restore();
    });
  }
  function textureNames() { return Object.keys(texCache); }
  function getTexturePreview(name) { return texCache[name]?.canvas; }

  /* ---------------- mesh VAO ---------------- */
  function getVAO(mesh) {
    let entry = meshCache.get(mesh);
    if (entry) return entry;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    function attr(loc, data, size) {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }
    attr(0, mesh.positions, 3);
    attr(1, mesh.normals, 3);
    attr(2, mesh.uvs, 2);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    entry = { vao, count: mesh.indices.length };
    meshCache.set(mesh, entry);
    return entry;
  }

  /* ---------------- frame ---------------- */
  function beginFrame() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.08, 0.08, 0.08, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    stats.drawCalls = 0; stats.tris = 0;
    shadowReady = false;
  }

  function renderShadowPass(drawList, lightDir, focus, extent) {
    // light view: looking along lightDir
    const dir = lightDir.normalized.neg(); // from light towards scene
    const lightPos = focus.sub(dir.mul(60));
    const rot = Quaternion.LookRotation(dir, Math.abs(dir.y) > 0.99 ? Vector3.forward : Vector3.up);
    const lightWorld = Matrix4.TRS(lightPos, rot, Vector3.one);
    const view = lightWorld.invert();
    const proj = Matrix4.Ortho(-extent, extent, -extent, extent, 1, 140);
    shadowVP = proj.mul(view);
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFBO);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.disable(gl.SCISSOR_TEST);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(progShadow.prog);
    gl.uniformMatrix4fv(progShadow.u.uShadowVP, false, shadowVP.m);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(2, 4);
    for (const item of drawList) {
      if (item.castShadow === false || item.transparent) continue;
      const { vao, count } = getVAO(item.mesh);
      gl.uniformMatrix4fv(progShadow.u.uModel, false, item.matrix.m);
      gl.bindVertexArray(vao);
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    shadowReady = true;
  }

  function ensurePostFBO(w, h) {
    if (postW === w && postH === h && postFBO) return;
    if (postFBO) { gl.deleteFramebuffer(postFBO); gl.deleteTexture(postTex); gl.deleteRenderbuffer(postDepth); }
    postW = w; postH = h;
    postTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, postTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    postDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, postDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    postFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, postFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, postTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, postDepth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /*
   * view = {
   *   rect: {x, y, w, h} in CSS px (y from top),
   *   camera: {view: Matrix4, proj: Matrix4, pos: Vector3},
   *   drawList, env: {skyTop, skyHorizon, skyBottom, ambientSky, ambientGround,
   *                   lightDir, lightColor, fogColor, fogDensity},
   *   particles: [batch...], lines: [...], solids: [...],
   *   post: null | {vignette, saturation, exposure, contrast, bloom},
   * }
   */
  function renderView(view) {
    const px = Math.floor(view.rect.x * dpr);
    const pyTop = Math.floor(view.rect.y * dpr);
    const pw = Math.max(1, Math.floor(view.rect.w * dpr));
    const ph = Math.max(1, Math.floor(view.rect.h * dpr));
    const py = canvas.height - pyTop - ph; // GL bottom-left

    const usePost = !!view.post;
    if (usePost) {
      ensurePostFBO(pw, ph);
      gl.bindFramebuffer(gl.FRAMEBUFFER, postFBO);
      gl.viewport(0, 0, pw, ph);
      gl.disable(gl.SCISSOR_TEST);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(px, py, pw, ph);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(px, py, pw, ph);
    }
    gl.clearColor(0.12, 0.12, 0.14, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const env = view.env;
    const cam = view.camera;

    // ---- sky ----
    gl.useProgram(progSky.prog);
    gl.depthMask(false);
    const invVP = cam.proj.mul(cam.view).invert();
    gl.uniformMatrix4fv(progSky.u.uInvVP, false, invVP.m);
    gl.uniform3fv(progSky.u.uTop, env.skyTop);
    gl.uniform3fv(progSky.u.uHorizon, env.skyHorizon);
    gl.uniform3fv(progSky.u.uBottom, env.skyBottom);
    gl.bindVertexArray(quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    stats.drawCalls++;

    // ---- opaque + transparent lit ----
    gl.useProgram(progLit.prog);
    gl.uniformMatrix4fv(progLit.u.uProj, false, cam.proj.m);
    gl.uniformMatrix4fv(progLit.u.uView, false, cam.view.m);
    gl.uniformMatrix4fv(progLit.u.uShadowVP, false, shadowVP.m);
    gl.uniform3fv(progLit.u.uLightDir, env.lightDir);
    gl.uniform3fv(progLit.u.uLightColor, env.lightColor);
    gl.uniform3fv(progLit.u.uAmbientSky, env.ambientSky);
    gl.uniform3fv(progLit.u.uAmbientGround, env.ambientGround);
    gl.uniform3f(progLit.u.uCameraPos, cam.pos.x, cam.pos.y, cam.pos.z);
    gl.uniform4fv(progLit.u.uFogColor, env.fogColor);
    gl.uniform1f(progLit.u.uFogDensity, env.fogDensity);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.uniform1i(progLit.u.uShadowMap, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(progLit.u.uTexture, 0);

    const opaque = [], transparent = [];
    for (const it of view.drawList) (it.transparent ? transparent : opaque).push(it);
    transparent.sort((a, b) => {
      const da = Vector3.SqrDistance(cam.pos, a.worldPos || Vector3.zero);
      const db = Vector3.SqrDistance(cam.pos, b.worldPos || Vector3.zero);
      return db - da;
    });

    function drawItem(item) {
      const { vao, count } = getVAO(item.mesh);
      gl.uniformMatrix4fv(progLit.u.uModel, false, item.matrix.m);
      gl.uniform4fv(progLit.u.uColor, item.color);
      gl.uniform3fv(progLit.u.uEmission, item.emission);
      gl.uniform1f(progLit.u.uSpecStrength, item.specular ?? 0.25);
      gl.uniform1f(progLit.u.uSpecPower, item.specPower ?? 32);
      gl.uniform1i(progLit.u.uReceiveShadow, shadowReady && item.receiveShadow !== false ? 1 : 0);
      const tex = item.texture && texCache[item.texture];
      gl.uniform1i(progLit.u.uUseTex, tex ? 1 : 0);
      gl.uniform1f(progLit.u.uTexScale, item.texScale ?? 1);
      if (tex) gl.bindTexture(gl.TEXTURE_2D, tex.tex);
      gl.bindVertexArray(vao);
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
      stats.drawCalls++; stats.tris += count / 3;
    }
    for (const it of opaque) drawItem(it);
    if (transparent.length) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      for (const it of transparent) drawItem(it);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // ---- particles ----
    if (view.particles && view.particles.length) {
      for (const batch of view.particles) drawParticleBatch(batch, cam);
    }

    // ---- solids (gizmo meshes, unlit) ----
    if (view.solids && view.solids.length) {
      gl.useProgram(progUnlit.prog);
      gl.uniformMatrix4fv(progUnlit.u.uProj, false, cam.proj.m);
      gl.uniformMatrix4fv(progUnlit.u.uView, false, cam.view.m);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      for (const s of view.solids) {
        if (s.depthTest === false) gl.disable(gl.DEPTH_TEST);
        const { vao, count } = getVAO(s.mesh);
        gl.uniformMatrix4fv(progUnlit.u.uModel, false, s.matrix.m);
        gl.uniform4fv(progUnlit.u.uColor, s.color);
        gl.bindVertexArray(vao);
        gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
        if (s.depthTest === false) gl.enable(gl.DEPTH_TEST);
        stats.drawCalls++;
      }
      gl.disable(gl.BLEND);
    }

    // ---- lines ----
    if (view.lines && view.lines.length) {
      drawLineBatches(view.lines, cam);
    }

    gl.bindVertexArray(null);

    // ---- post-process blit ----
    if (usePost) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(px, py, pw, ph);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(px, py, pw, ph);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(progPost.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, postTex);
      gl.uniform1i(progPost.u.uTex, 0);
      const p = view.post;
      gl.uniform1f(progPost.u.uVignette, p.vignette ?? 0.3);
      gl.uniform1f(progPost.u.uSaturation, p.saturation ?? 1);
      gl.uniform1f(progPost.u.uExposure, p.exposure ?? 1);
      gl.uniform1f(progPost.u.uContrast, p.contrast ?? 1);
      gl.uniform1f(progPost.u.uBloom, p.bloom ?? 0);
      gl.bindVertexArray(quadVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.enable(gl.DEPTH_TEST);
      stats.drawCalls++;
    }
    gl.disable(gl.SCISSOR_TEST);
  }

  /* lines: [{verts: Float32Array pairs, color: [r,g,b,a], depthTest: bool}] */
  function drawLineBatches(batches, cam) {
    gl.useProgram(progUnlit.prog);
    gl.uniformMatrix4fv(progUnlit.u.uProj, false, cam.proj.m);
    gl.uniformMatrix4fv(progUnlit.u.uView, false, cam.view.m);
    const ident = new Matrix4();
    gl.uniformMatrix4fv(progUnlit.u.uModel, false, ident.m);
    if (!lineVAO) {
      lineVAO = gl.createVertexArray();
      gl.bindVertexArray(lineVAO);
      lineBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
    gl.bindVertexArray(lineVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (const b of batches) {
      if (!b.verts.length) continue;
      const arr = b.verts instanceof Float32Array ? b.verts : new Float32Array(b.verts);
      if (arr.length > lineCapacity) {
        gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
        lineCapacity = arr.length;
      } else {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr);
      }
      gl.uniform4fv(progUnlit.u.uColor, b.color);
      if (b.depthTest === false) gl.disable(gl.DEPTH_TEST);
      gl.drawArrays(gl.LINES, 0, arr.length / 3);
      if (b.depthTest === false) gl.enable(gl.DEPTH_TEST);
      stats.drawCalls++;
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  /* batch = {data: Float32Array [x,y,z,ox,oy,r,g,b,a,size]*4 per particle, count, additive} */
  function drawParticleBatch(batch, cam) {
    if (!batch.count) return;
    gl.useProgram(progParticle.prog);
    gl.uniformMatrix4fv(progParticle.u.uProj, false, cam.proj.m);
    gl.uniformMatrix4fv(progParticle.u.uView, false, cam.view.m);
    const STRIDE = 10 * 4;
    if (!partVAO) {
      partVAO = gl.createVertexArray();
      gl.bindVertexArray(partVAO);
      partBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, STRIDE, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, STRIDE, 20);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, STRIDE, 36);
      partIdxBuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, partIdxBuf);
      const MAXQ = 4096;
      const idx = new Uint16Array(MAXQ * 6);
      for (let i = 0; i < MAXQ; i++) {
        const v = i * 4, o = i * 6;
        idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
        idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
      }
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
    }
    gl.bindVertexArray(partVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
    const needed = batch.count * 4 * 10;
    if (needed > partCapacity) {
      gl.bufferData(gl.ARRAY_BUFFER, batch.data.subarray(0, needed), gl.DYNAMIC_DRAW);
      partCapacity = needed;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data.subarray(0, needed));
    }
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    if (batch.additive) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawElements(gl.TRIANGLES, batch.count * 6, gl.UNSIGNED_SHORT, 0);
    gl.depthMask(true);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    stats.drawCalls++;
  }

  return {
    init, beginFrame, renderView, renderShadowPass,
    get gl() { return gl; },
    get stats() { return stats; },
    get dpr() { return dpr; },
    textureNames, getTexturePreview,
  };
})();
