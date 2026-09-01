/* Webity editor — Web Build: bundles engine + project into a standalone HTML game */
"use strict";

const BuildUI = (() => {
  const RUNTIME_FILES = [
    "js/core/math.js", "js/core/meshes.js", "js/core/input.js", "js/core/audio.js",
    "js/core/renderer.js", "js/core/engine.js", "js/core/components.js", "js/core/physics.js",
    "js/core/particles.js", "js/core/uiRuntime.js",
    "js/cs/lexer.js", "js/cs/parser.js", "js/cs/emitter.js", "js/cs/api.js", "js/cs/compiler.js",
    "js/runtime/game.js",
  ];

  const GAME_CSS = `
  html,body{margin:0;height:100%;background:#0d0d11;overflow:hidden;font-family:"Segoe UI",-apple-system,sans-serif}
  #game-root{position:fixed;inset:0}
  #game-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
  #game-ui-root{position:absolute;inset:0;overflow:hidden;pointer-events:none}
  #game-ui-root .wui-interactive{pointer-events:auto}
  .wui-elem{position:absolute}
  .wui-text{white-space:pre;text-shadow:0 1px 3px rgba(0,0,0,.6)}
  .wui-button{display:flex;align-items:center;justify-content:center;cursor:pointer;transition:filter .1s}
  .wui-button:hover{filter:brightness(1.25)}
  #boot-overlay{position:absolute;inset:0;background:#0d0d11;display:flex;flex-direction:column;
    align-items:center;justify-content:center;color:#fff;cursor:pointer;z-index:50;transition:opacity .4s}
  #boot-overlay h1{font-weight:200;letter-spacing:6px;font-size:38px;margin-bottom:8px}
  #boot-overlay h1 b{color:#4c90d8;font-weight:600}
  #boot-overlay p{color:#8a8a95;letter-spacing:2px;font-size:13px}
  #boot-overlay .hint{margin-top:36px;padding:10px 26px;border:1px solid #333;border-radius:20px;font-size:12px;color:#bbb}
  `;

  const BOOTSTRAP = `
  (function() {
    var overlay = document.getElementById("boot-overlay");
    var started = false;
    function loadAssets(project) {
      WAssets.reset();
      WAssets.loadMaterials(project.materials || {});
      Object.entries(project.audioClips || {}).forEach(function(e){ WAssets.defineAudioClip(e[0], e[1]); });
      Object.entries(project.textures || {}).forEach(function(e){ WAssets.defineTexture(e[0], e[1].tex || e[1]); });
      Object.entries(project.prefabs || {}).forEach(function(e){ WAssets.definePrefab(e[0], e[1]); });
      Object.entries(project.scripts || {}).forEach(function(e){ WAssets.defineScript(e[0], e[1].source); });
    }
    function start() {
      if (started) return;
      started = true;
      var project = window.__WEBITY_PROJECT__;
      var canvas = document.getElementById("game-canvas");
      WRenderer.init(canvas);
      CSApi.ctx.log = function(level, msg) {
        (level === "error" ? console.error : level === "warn" ? console.warn : console.log)("[Webity] " + msg);
      };
      loadAssets(project);
      var result = CSCompiler.compileAll(WAssets.scripts);
      if (!result.ok) {
        console.error("Script compilation failed", result.errors);
        overlay.innerHTML = "<h1>Compile Error</h1><p>" + (result.errors[0] ? result.errors[0].message : "") + "</p>";
        return;
      }
      var sceneJson = project.scenes[project.activeScene];
      WRuntime.start(sceneJson);
      WUI.mount(document.getElementById("game-ui-root"));
      WUI.setButtonHandler(function(c) { WRuntime.handleUIButton(c); });
      WInput.setCapture(true);
      overlay.style.opacity = "0";
      setTimeout(function() { overlay.style.display = "none"; }, 450);
      var last = performance.now();
      function frame(now) {
        var dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        WInput.newFrame(dt);
        WRuntime.tick(dt);
        var scene = WRuntime.scene;
        if (scene) {
          CSApi.ctx.gameViewSize = { w: canvas.clientWidth, h: canvas.clientHeight };
          WRenderer.beginFrame();
          var drawList = WRender.buildDrawList(scene);
          var env = WRender.envParams(scene);
          if (env.shadows) {
            var sf = WRender.shadowFocus(drawList);
            WRenderer.renderShadowPass(drawList, new Vector3(env.lightDir[0], env.lightDir[1], env.lightDir[2]), sf.focus, sf.extent);
          }
          var cam = WRender.mainCamera(scene);
          if (cam) {
            var rect = { x: 0, y: 0, w: canvas.clientWidth, h: canvas.clientHeight };
            WRenderer.renderView({
              rect: rect,
              camera: WRender.cameraParams(cam, rect.w / Math.max(1, rect.h)),
              drawList: drawList, env: env,
              particles: WParticles.buildBatches(scene),
              post: WRender.postParams(scene),
            });
          }
          WUI.render(scene, true);
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }
    overlay.addEventListener("click", start);
    overlay.addEventListener("keydown", start);
    window.addEventListener("keydown", function once() { start(); window.removeEventListener("keydown", once); });
  })();
  `;

  let cachedSources = null;
  async function fetchSources() {
    if (cachedSources) return cachedSources;
    const out = [];
    for (const path of RUNTIME_FILES) {
      const res = await fetch(path);
      if (!res.ok) throw new Error("fetch failed: " + path);
      out.push(`/* ==== ${path} ==== */\n` + await res.text());
    }
    cachedSources = out;
    return out;
  }

  async function assemble() {
    const sources = await fetchSources();
    Editor.saveScene(false);
    const project = Editor.exportProjectData();
    const title = "Webity Cube Adventure";
    return [
      "<!DOCTYPE html>",
      '<html lang="ja"><head><meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      `<title>${title}</title>`,
      `<style>${GAME_CSS}</style>`,
      "</head><body>",
      '<div id="game-root">',
      '<canvas id="game-canvas"></canvas>',
      '<div id="game-ui-root"></div>',
      `<div id="boot-overlay"><h1><b>Webity</b> CUBE ADVENTURE</h1><p>BUILT WITH THE WEBITY ENGINE — NO EDITOR ATTACHED</p><div class="hint">CLICK TO START &nbsp;·&nbsp; WASD MOVE &nbsp;·&nbsp; SPACE JUMP &nbsp;·&nbsp; SHIFT DASH</div></div>`,
      "</div>",
      "<script>\n" + sources.join("\n\n") + "\n<\/script>",
      "<script>window.__WEBITY_PROJECT__ = " + JSON.stringify(project).replace(/<\/script>/gi, "<\\/script>") + ";<\/script>",
      "<script>\n" + BOOTSTRAP + "\n<\/script>",
      "</body></html>",
    ].join("\n");
  }

  function showProfiles() {
    const body = document.createElement("div");
    body.innerHTML = `
      <div class="build-row sel"><span class="plat-icon">🌐</span>
        <div><b>Web</b><div style="color:var(--text-dim);font-size:11px">Standalone HTML5 build — runs without the editor</div></div></div>
      <div class="build-row" style="opacity:.4"><span class="plat-icon">🖥</span>
        <div><b>Windows / macOS</b><div style="font-size:11px">Not available in Webity</div></div></div>
      <div class="build-row" style="opacity:.4"><span class="plat-icon">📱</span>
        <div><b>iOS / Android</b><div style="font-size:11px">Not available in Webity</div></div></div>
      <div style="margin-top:12px;color:var(--text-dim);font-size:11px;font-family:var(--mono)">
      Build output (bundled into a single file):<br>
      &nbsp;Build/index.html&nbsp;&nbsp;— page + loader<br>
      &nbsp;+ runtime.js&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;— engine (renderer / physics / audio / UI)<br>
      &nbsp;+ scripts.js&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;— your C# compiled in-browser<br>
      &nbsp;+ scene.pack&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;— serialized scene &amp; assets</div>`;
    UIKit.modal("Build Profiles", body, [
      { label: "Close" },
      { label: "Build And Run", primary: true, fn: () => { buildAndRun(); } },
    ]);
  }

  async function buildAndRun() {
    WConsole.log("Building Web player…");
    let html;
    try {
      html = await assemble();
    } catch (e) {
      WConsole.error("Build failed: " + e.message + " — run Webity from a local web server (e.g. python3 -m http.server) so the engine sources can be bundled.");
      return;
    }
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    const kb = Math.round(blob.size / 1024);
    WConsole.log(`Build succeeded — ${kb} KB standalone player. The game runs without the editor.`);
    const body = document.createElement("div");
    body.innerHTML = `
      <p>✅ Build succeeded (<b>${kb} KB</b>, single-file web player).</p>
      <p style="margin-top:8px;color:var(--text-dim)">The game opened in a new tab and runs completely without the editor.
      ${win ? "" : "<br><b style='color:var(--yellow)'>Pop-up blocked — use the buttons below.</b>"}</p>`;
    const openBtn = { label: "Open Game", fn: () => { window.open(url, "_blank"); return false; } };
    const dlBtn = { label: "Download index.html", fn: () => {
      const a = document.createElement("a");
      a.href = url;
      a.download = "WebityCubeAdventure_Build.html";
      a.click();
      return false;
    } };
    UIKit.modal("Build And Run — Web", body, [openBtn, dlBtn, { label: "Close", primary: true }]);
  }

  return { showProfiles, buildAndRun };
})();
