/* Webity editor — central controller: play mode, persistence, layout, main loop */
"use strict";

const Editor = (() => {
  const STORAGE_KEY = "webity.project.v1";

  const api = {
    project: null,
    scene: null,           // edit-mode scene
    selection: null,       // {kind:'go', id} | {kind:'asset', path}
    playing: false,
    viewMode: "scene",
    dirty: false,
    scriptEditorVisible: false,
  };

  let prevViewMode = "scene";
  let saveTimer = null;
  let releaseCaptureAfterFrame = false;
  let lastFrameTime = performance.now();
  let fpsSmooth = 60;

  /* ================= persistence ================= */
  function loadOrCreateProject() {
    let project = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) project = JSON.parse(raw);
    } catch (e) { project = null; }
    if (!project || project.version !== 1) {
      project = buildDemoProjectData();
      project.settings = { playWithErrors: false };
    }
    if (!project.settings) project.settings = { playWithErrors: false };
    api.project = project;
    loadProjectIntoAssets(project);
    return project;
  }

  function saveProject() {
    try {
      // materials may have been edited via WAssets — sync back
      api.project.materials = WAssets.serializeMaterials();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(api.project));
      const el = document.getElementById("status-right");
      if (el) el.textContent = "saved " + new Date().toLocaleTimeString();
    } catch (e) {
      WConsole.warn("Could not save project to browser storage: " + e.message);
    }
  }
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveScene(false); }, 1200);
  }

  function saveScene(log) {
    if (api.scene) {
      api.project.scenes[api.project.activeScene] = api.scene.serialize();
      WAssets.scenes.set(api.project.activeScene, api.project.scenes[api.project.activeScene]);
    }
    saveProject();
    api.dirty = false;
    if (log) WConsole.log("Scene saved: " + api.project.activeScene);
    Hierarchy.refresh(true);
  }

  function resetDemoProject() {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }

  function exportProjectData() {
    api.project.materials = WAssets.serializeMaterials();
    return {
      version: 1,
      name: api.project.name,
      materials: api.project.materials,
      audioClips: api.project.audioClips,
      textures: Object.fromEntries(Object.entries(api.project.textures).map(([p, t]) => [p, typeof t === "string" ? t : t.tex])),
      prefabs: api.project.prefabs,
      scripts: api.project.scripts,
      scenes: api.project.scenes,
      activeScene: api.project.activeScene,
    };
  }

  /* ================= selection / scene ops ================= */
  function activeScene() { return api.playing ? WRuntime.scene : api.scene; }

  function select(sel) {
    api.selection = sel;
    Hierarchy.refresh();
    Inspector.refresh(true);
    Project.render();
  }
  function selectedGameObject() {
    if (api.selection?.kind !== "go") return null;
    const s = activeScene();
    if (!s) return null;
    const go = s.getById(api.selection.id);
    return go && !go.__destroyed ? go : null;
  }

  function markSceneEdited() {
    if (!api.playing) { api.dirty = true; scheduleSave(); }
    Hierarchy.refresh();
  }

  function onComponentEdited(comp, field) {
    markSceneEdited();
  }
  function onMaterialEdited(path) {
    api.project.materials = WAssets.serializeMaterials();
    scheduleSave();
    Project.render();
  }

  function onScriptsRecompiled(changedDefaults) {
    // rebuild the edit scene so script components bind to the newly compiled classes
    if (!api.scene) return;
    // fields still holding the old script default follow the new default (values you
    // customized in the Inspector are kept — like Unity's serialized overrides)
    if (changedDefaults && changedDefaults.length) {
      const enc = (v) => JSON.stringify(v && v.toJSON ? v.toJSON() : v);
      for (const go of api.scene.iterate()) {
        for (const c of go.components) {
          if (c.__destroyed || c.typeName !== "CSScript") continue;
          for (const ch of changedDefaults) {
            if (c.className !== ch.className) continue;
            if (enc(c[ch.field]) === enc(ch.oldDefault)) {
              c[ch.field] = cloneFieldValue(ch.newDefault);
            }
          }
        }
      }
      for (const ch of changedDefaults) {
        WConsole.log(`${ch.className}.${ch.field}: default ${JSON.stringify(ch.oldDefault)} → ${JSON.stringify(ch.newDefault)} (components using the old default were updated)`);
      }
    }
    const snapshot = api.scene.serialize();
    api.scene = WScene.deserialize(snapshot);
    api.project.scenes[api.project.activeScene] = snapshot;
    saveProject();
    Hierarchy.refresh(true);
    Inspector.refresh(true);
  }

  function updateScript(path, source) {
    api.project.scripts[path] = { source };
    WAssets.defineScript(path, source);
    saveProject();
  }

  function createObject(name, meshName, parentGo) {
    const s = activeScene();
    if (!s) return;
    const go = s.createObject(meshName ? meshName : name, parentGo || null);
    if (meshName) {
      go.AddComponent("MeshFilter", { mesh: meshName });
      go.AddComponent("MeshRenderer", { materialPath: WAssets.materials.has("Assets/Materials/Platform.mat") ? "Assets/Materials/Platform.mat" : null });
      if (meshName === "Cube" || meshName === "Plane") go.AddComponent("BoxCollider", meshName === "Plane" ? { size: new Vector3(10, 0.02, 10) } : {});
      else if (meshName === "Sphere") go.AddComponent("SphereCollider", {});
      else if (meshName === "Capsule") go.AddComponent("CapsuleCollider", {});
    }
    // spawn in front of scene camera
    const cam = SceneView.cameraParams(1);
    go.transform.position = cam.pos.add(cam.view.invert().mulDir(new Vector3(0, 0, 1)).normalized.mul(8));
    if (api.playing) WRuntime.initTree(go);
    markSceneEdited();
    select({ kind: "go", id: go.id });
    return go;
  }
  function createLight() {
    const go = createObject("Directional Light", null, null);
    go.AddComponent("Light", {});
    go.transform.localEulerAngles = new Vector3(50, -30, 0);
    Inspector.refresh(true);
    return go;
  }
  function createCamera() {
    const go = createObject("Camera", null, null);
    go.AddComponent("Camera", {});
    Inspector.refresh(true);
    return go;
  }
  function createUIObject(type, parentGo) {
    const s = activeScene();
    if (!s) return;
    let canvas = null;
    for (const go of s.iterate()) if (go.GetComponent("Canvas")) { canvas = go; break; }
    if (!canvas) {
      canvas = s.createObject("Canvas");
      canvas.AddComponent("Canvas", {});
      canvas.layer = LAYERS.indexOf("UI");
    }
    const parent = parentGo && parentGo.GetComponentInParent && parentGo.GetComponentInParent("Canvas") ? parentGo : canvas;
    const go = s.createObject(type, parent);
    go.layer = LAYERS.indexOf("UI");
    go.AddComponent(type, {});
    markSceneEdited();
    select({ kind: "go", id: go.id });
    return go;
  }

  function duplicateSelection() {
    const go = selectedGameObject();
    if (!go) return;
    const s = activeScene();
    const clone = cloneGameObjectTree(go, s);
    clone.name = go.name;
    if (go.transform.parent) clone.transform.SetParent(go.transform.parent, false);
    else s.roots.push(clone);
    clone.transform.localPosition = go.transform.localPosition.add(new Vector3(0.5, 0, 0.5));
    clone.transform.localRotation = go.transform.localRotation;
    clone.transform.localScale = go.transform.localScale;
    if (api.playing) WRuntime.initTree(clone);
    markSceneEdited();
    Hierarchy.refresh(true);
    select({ kind: "go", id: clone.id });
    WConsole.log(`Duplicated ${go.name}`);
  }

  function deleteSelection() {
    const go = selectedGameObject();
    if (!go) return;
    const s = activeScene();
    const name = go.name;
    s.destroyObject(go);
    select(null);
    markSceneEdited();
    Hierarchy.refresh(true);
    WConsole.log(`Deleted ${name}`);
  }

  function instantiatePrefab(path, point) {
    const tree = WAssets.getPrefab(path);
    if (!tree) { WConsole.error("Prefab not found: " + path); return; }
    const s = activeScene();
    const root = instantiateSerializedTree(tree, s);
    s.roots.push(root);
    root.prefabSource = path;
    if (point) root.transform.position = Vector3.from(point);
    else {
      const cam = SceneView.cameraParams(1);
      root.transform.position = cam.pos.add(cam.view.invert().mulDir(new Vector3(0, 0, 1)).normalized.mul(10));
    }
    if (api.playing) WRuntime.initTree(root);
    markSceneEdited();
    Hierarchy.refresh(true);
    select({ kind: "go", id: root.id });
    WConsole.log(`Instantiated prefab: ${path.split("/").pop()} ${api.playing ? "(runtime)" : ""}`);
    return root;
  }

  /* ================= play mode ================= */
  function togglePlay() {
    if (api.playing) stopPlay();
    else startPlay();
  }
  function startPlay() {
    if (CSCompiler.lastErrors.length > 0) {
      if (!api.project.settings.playWithErrors || !CSCompiler.hasBuild) {
        WConsole.error("All compiler errors have to be fixed before you can enter Play Mode!");
        Toolbar.showBottomTab && Toolbar.showBottomTab("console");
        return;
      }
      WConsole.warn("Entering Play Mode with the last successfully compiled scripts.");
    }
    saveScene(false); // Unity: play saves the scene state
    if (WConsole.clearOnPlay) WConsole.clear();
    const snapshot = api.project.scenes[api.project.activeScene];
    WRuntime.start(snapshot);
    api.playing = true;
    prevViewMode = api.viewMode;
    setViewMode(api.viewMode === "split" ? "split" : "game");
    CodeEditor.hide();
    Toolbar.updatePlayState();
    Hierarchy.refresh(true);
    Inspector.refresh(true);
    WConsole.log("▶ Entered Play Mode");
    document.getElementById("game-focus-hint").style.opacity = "1";
  }
  function stopPlay() {
    WRuntime.stop();
    api.playing = false;
    WInput.setCapture(false);
    WUI.clear();
    setViewMode(prevViewMode);
    Toolbar.updatePlayState();
    Hierarchy.refresh(true);
    Inspector.refresh(true);
    WConsole.log("■ Exited Play Mode — scene restored to its pre-Play state");
  }
  function togglePause() {
    if (!api.playing) return;
    WRuntime.paused = !WRuntime.paused;
    Toolbar.updatePlayState();
    WConsole.log(WRuntime.paused ? "⏸ Paused" : "▶ Resumed");
  }
  function stepFrame() {
    if (!api.playing) return;
    if (!WRuntime.paused) { WRuntime.paused = true; Toolbar.updatePlayState(); }
    WRuntime.stepOneFrame();
  }

  /* ================= view layout ================= */
  function setViewMode(mode) {
    api.viewMode = mode;
    CodeEditor.hide && api.scriptEditorVisible && CodeEditor.hide();
    Toolbar.updateViewTabs();
  }

  function layoutRegions() {
    const body = document.getElementById("viewport-body");
    const sceneR = document.getElementById("scene-view-region");
    const gameR = document.getElementById("game-view-region");
    const W = body.clientWidth, H = body.clientHeight;
    const mode = api.viewMode;
    function place(el, x, w, visible) {
      el.style.display = visible ? "block" : "none";
      el.style.left = x + "px";
      el.style.top = "0px";
      el.style.width = w + "px";
      el.style.height = H + "px";
    }
    if (mode === "scene") { place(sceneR, 0, W, true); place(gameR, 0, 0, false); }
    else if (mode === "game") { place(sceneR, 0, 0, false); place(gameR, 0, W, true); }
    else { place(sceneR, 0, Math.floor(W / 2) - 1, true); place(gameR, Math.floor(W / 2) + 1, W - Math.floor(W / 2) - 1, true); }
    return {
      scene: mode !== "game" ? { x: 0, y: 0, w: mode === "split" ? Math.floor(W / 2) - 1 : W, h: H } : null,
      game: mode !== "scene" ? { x: mode === "split" ? Math.floor(W / 2) + 1 : 0, y: 0, w: mode === "split" ? W - Math.floor(W / 2) - 1 : W, h: H } : null,
    };
  }

  /* ================= main loop ================= */
  function frame(now) {
    requestAnimationFrame(frame);
    const dtReal = Math.min((now - lastFrameTime) / 1000, 0.25);
    lastFrameTime = now;
    fpsSmooth = fpsSmooth * 0.95 + (1 / Math.max(dtReal, 1e-4)) * 0.05;

    WInput.newFrame(dtReal);
    SceneView.update(dtReal);

    if (api.playing) WRuntime.tick(dtReal);

    if (releaseCaptureAfterFrame) {
      releaseCaptureAfterFrame = false;
      WInput.setCapture(false);
      document.getElementById("game-focus-hint").style.opacity = "1";
    }

    const scene = activeScene();
    const rects = layoutRegions();

    // rects are relative to viewport body; convert to canvas coordinates
    const canvas = document.getElementById("gl-canvas");
    if (scene && canvas.clientWidth > 4 && !api.scriptEditorVisible) {
      WRenderer.beginFrame();
      const drawList = WRender.buildDrawList(scene);
      const env = WRender.envParams(scene);
      if (env.shadows) {
        const sf = WRender.shadowFocus(drawList);
        WRenderer.renderShadowPass(drawList, new Vector3(env.lightDir[0], env.lightDir[1], env.lightDir[2]), sf.focus, sf.extent);
      }
      if (rects.scene) {
        const overlays = SceneView.buildOverlays(scene);
        WRenderer.renderView({
          rect: rects.scene,
          camera: SceneView.cameraParams(rects.scene.w / Math.max(1, rects.scene.h)),
          drawList, env,
          particles: api.playing ? WParticles.buildBatches(scene) : [],
          lines: overlays.lines,
          solids: overlays.solids,
          post: null,
        });
      }
      if (rects.game) {
        const cam = WRender.mainCamera(scene);
        CSApi.ctx.gameViewSize = { w: rects.game.w, h: rects.game.h };
        if (cam) {
          WRenderer.renderView({
            rect: rects.game,
            camera: WRender.cameraParams(cam, rects.game.w / Math.max(1, rects.game.h)),
            drawList, env,
            particles: api.playing ? WParticles.buildBatches(scene) : [],
            post: WRender.postParams(scene),
          });
        }
        WUI.render(scene, api.playing);
      }
    } else if (api.scriptEditorVisible) {
      WRenderer.beginFrame();
    }

    // panels
    Hierarchy.refresh();
    Inspector.refresh();
    WConsole.tick();

    // stats
    const statsEl = document.getElementById("game-stats");
    if (statsEl && (Time_frameTick(now))) {
      statsEl.innerHTML = `${Math.round(fpsSmooth)} fps · ${WRenderer.stats.drawCalls} draw calls · ${Math.round(WRenderer.stats.tris / 1000)}k tris` +
        (api.playing ? `<br>Time ${CSApi.api.Time.time.toFixed(1)}s` : "");
    }
  }
  let lastStatsUpdate = 0;
  function Time_frameTick(now) {
    if (now - lastStatsUpdate > 250) { lastStatsUpdate = now; return true; }
    return false;
  }

  /* ================= input wiring ================= */
  function initInput() {
    const gameRegion = document.getElementById("game-view-region");
    gameRegion.addEventListener("pointerdown", () => {
      if (api.playing) {
        WInput.setCapture(true);
        document.getElementById("game-focus-hint").style.opacity = "0";
      }
    });
    window.addEventListener("keydown", (e) => {
      const typing = e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable;
      if (e.key === "Escape" && WInput.capturing) {
        // let the game see Escape this frame, release capture afterwards
        releaseCaptureAfterFrame = true;
        return;
      }
      if (typing) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (api.scriptEditorVisible) CodeEditor.save();
        else saveScene(true);
      } else if (meta && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelection();
      } else if (meta && e.key.toLowerCase() === "p") {
        e.preventDefault();
        togglePlay();
      } else if (meta && e.key.toLowerCase() === "b") {
        e.preventDefault();
        BuildUI.buildAndRun();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !WInput.capturing) {
        if (api.selection?.kind === "go") { e.preventDefault(); deleteSelection(); }
      }
    });
  }

  /* ================= splitters ================= */
  function initSplitters() {
    const leftCol = document.getElementById("left-col");
    const rightCol = document.getElementById("right-col");
    const bottom = document.getElementById("bottom-panel");
    for (const split of document.querySelectorAll(".vsplit, .hsplit")) {
      split.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        const kind = split.dataset.split;
        const startX = e.clientX, startY = e.clientY;
        const startLeft = leftCol.offsetWidth, startRight = rightCol.offsetWidth, startBottom = bottom.offsetHeight;
        const move = (ev) => {
          if (kind === "left") leftCol.style.width = Mathf.Clamp(startLeft + ev.clientX - startX, 140, 500) + "px";
          else if (kind === "right") rightCol.style.width = Mathf.Clamp(startRight - (ev.clientX - startX), 200, 560) + "px";
          else if (kind === "bottom") bottom.style.height = Mathf.Clamp(startBottom - (ev.clientY - startY), 90, 500) + "px";
        };
        const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      });
    }
  }

  /* ================= boot ================= */
  function boot() {
    CSApi.ctx.log = (level, msg) => WConsole.add(level, msg);
    WConsole.init();
    loadOrCreateProject();

    const compileResult = CSCompiler.compileAll(WAssets.scripts);
    if (!compileResult.ok) {
      for (const err of compileResult.errors) {
        WConsole.error(`${err.path}(${err.line},${err.col}): error ${err.code}: ${err.message}`, { path: err.path, line: err.line });
      }
    } else {
      WConsole.log(`Compiled ${compileResult.classCount} C# scripts`);
    }

    const sceneJson = api.project.scenes[api.project.activeScene];
    api.scene = WScene.deserialize(sceneJson);

    WRenderer.init(document.getElementById("gl-canvas"));
    WUI.mount(document.getElementById("game-ui-root"));
    WUI.setButtonHandler((c) => WRuntime.handleUIButton(c));

    Hierarchy.init();
    Inspector.init();
    Project.init();
    SceneView.init();
    CodeEditor.init();
    Toolbar.initMenubar();
    Toolbar.initToolbar();
    Toolbar.initViewportTabs();
    Toolbar.initBottomTabs();
    initInput();
    initSplitters();

    setViewMode("scene");
    Hierarchy.refresh(true);
    Inspector.refresh(true);
    WConsole.log("Project opened: WebityCubeAdventure (Assets/Scenes/MainGame.scene)");
    lastFrameTime = performance.now();
    requestAnimationFrame(frame);
  }

  /* public surface */
  Object.assign(api, {
    boot, select, selectedGameObject, markSceneEdited, onComponentEdited, onMaterialEdited,
    onScriptsRecompiled, updateScript, saveScene, saveProject, resetDemoProject, exportProjectData,
    createObject, createLight, createCamera, createUIObject,
    duplicateSelection, deleteSelection, instantiatePrefab,
    togglePlay, togglePause, stepFrame, setViewMode,
  });
  return api;
})();
