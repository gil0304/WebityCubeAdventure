/* Webity editor — UIKit (menus/modals), menubar, toolbar, viewport tabs */
"use strict";

const UIKit = (() => {
  const ctxEl = () => document.getElementById("ctxmenu");
  let closeHandler = null;

  function closeMenu() {
    const el = ctxEl();
    el.style.display = "none";
    el.innerHTML = "";
    if (closeHandler) { window.removeEventListener("pointerdown", closeHandler, true); closeHandler = null; }
  }

  function contextMenu(x, y, items, opts = {}) {
    closeMenu();
    const el = ctxEl();
    el.innerHTML = "";
    el.style.display = "block";

    let searchInput = null;
    if (opts.search) {
      const wrap = document.createElement("div");
      wrap.className = "ctx-search";
      searchInput = document.createElement("input");
      searchInput.placeholder = "Search…";
      wrap.appendChild(searchInput);
      el.appendChild(wrap);
    }
    const listWrap = document.createElement("div");
    el.appendChild(listWrap);

    function renderItems(filter) {
      listWrap.innerHTML = "";
      for (const item of items) {
        if (item.sep) {
          if (!filter) listWrap.appendChild(Object.assign(document.createElement("div"), { className: "ctx-sep" }));
          continue;
        }
        if (item.header) {
          const h = document.createElement("div");
          h.className = "ctx-header";
          h.textContent = item.header;
          listWrap.appendChild(h);
          continue;
        }
        if (filter && !item.label.toLowerCase().includes(filter)) continue;
        const div = document.createElement("div");
        div.className = "ctx-item" + (item.disabled ? " disabled" : "");
        div.innerHTML = `<span>${item.label}</span>` + (item.shortcut ? `<span class="shortcut">${item.shortcut}</span>` : "") + (item.submenu ? `<span class="shortcut">▸</span>` : "");
        if (!item.disabled) {
          div.onclick = (e) => {
            e.stopPropagation();
            if (item.submenu) {
              const r = div.getBoundingClientRect();
              contextMenu(r.right + 2, r.top, item.submenu);
              return;
            }
            if (!item.keepOpen) closeMenu();
            item.fn && item.fn();
          };
        }
        listWrap.appendChild(div);
      }
    }
    renderItems("");
    if (searchInput) {
      searchInput.oninput = () => renderItems(searchInput.value.toLowerCase());
      searchInput.onkeydown = (e) => e.stopPropagation();
      setTimeout(() => searchInput.focus(), 0);
    }

    // position within viewport
    el.style.left = "0px"; el.style.top = "0px";
    const rect = el.getBoundingClientRect();
    el.style.left = Math.min(x, window.innerWidth - rect.width - 8) + "px";
    el.style.top = Math.min(y, window.innerHeight - rect.height - 8) + "px";

    closeHandler = (e) => { if (!el.contains(e.target)) closeMenu(); };
    setTimeout(() => window.addEventListener("pointerdown", closeHandler, true), 0);
  }

  function modal(title, body, buttons = [{ label: "OK", primary: true }]) {
    const root = document.getElementById("modal-root");
    root.style.display = "flex";
    root.innerHTML = "";
    const m = document.createElement("div");
    m.className = "modal";
    const t = document.createElement("div");
    t.className = "modal-title";
    t.textContent = title;
    const b = document.createElement("div");
    b.className = "modal-body";
    if (typeof body === "string") b.innerHTML = body;
    else b.appendChild(body);
    const btns = document.createElement("div");
    btns.className = "modal-buttons";
    for (const def of buttons) {
      const btn = document.createElement("button");
      btn.className = "btn";
      if (def.primary) btn.style.background = "var(--sel)";
      btn.textContent = def.label;
      btn.onclick = () => {
        if (def.fn && def.fn() === false) return;
        closeModal();
      };
      btns.appendChild(btn);
    }
    m.appendChild(t);
    m.appendChild(b);
    m.appendChild(btns);
    root.appendChild(m);
    root.onclick = (e) => { if (e.target === root) closeModal(); };
  }
  function closeModal() {
    const root = document.getElementById("modal-root");
    root.style.display = "none";
    root.innerHTML = "";
  }

  return { contextMenu, closeMenu, modal, closeModal };
})();

/* ============================= menubar + toolbar ============================= */
const Toolbar = (() => {
  let playBtn, pauseBtn, stepBtn;

  function menu(label, itemsFn) {
    const el = document.createElement("div");
    el.className = "menu-item";
    el.textContent = label;
    el.onclick = () => {
      const r = el.getBoundingClientRect();
      UIKit.contextMenu(r.left, r.bottom + 1, itemsFn());
    };
    return el;
  }

  function gameObjectMenuItems(parentGo) {
    return [
      { label: "Create Empty", shortcut: "⌘⇧N", fn: () => Editor.createObject("GameObject", null, parentGo) },
      { label: "3D Object", submenu: MeshLib.names.map((m) => ({ label: m, fn: () => Editor.createObject(m, m, parentGo) })) },
      { label: "Light", submenu: [{ label: "Directional Light", fn: () => Editor.createLight() }] },
      { label: "Camera", fn: () => Editor.createCamera() },
      { label: "UI", submenu: ["Text", "Image", "Button", "Panel"].map((t) => ({ label: t, fn: () => Editor.createUIObject(t, parentGo) })) },
    ];
  }

  function initMenubar() {
    const mb = document.getElementById("menubar");
    mb.innerHTML = "";
    const brand = document.createElement("div");
    brand.className = "menu-title-app";
    brand.innerHTML = `<b>Webity</b> ◆ WebityCubeAdventure`;
    mb.appendChild(brand);

    mb.appendChild(menu("File", () => [
      { label: "Save Scene", shortcut: "⌘S", fn: () => Editor.saveScene(true) },
      { label: "Save Project", fn: () => { Editor.saveProject(); WConsole.log("Project saved to browser storage."); } },
      { sep: true },
      { label: "Reset Demo Project", fn: () => {
        UIKit.modal("Reset Demo Project",
          "すべての編集内容を破棄して、初期状態のデモプロジェクトに戻します。<br>This will discard <b>all your edits</b> and restore the original demo project.",
          [{ label: "Cancel" }, { label: "Reset", primary: true, fn: () => Editor.resetDemoProject() }]);
      } },
      { sep: true },
      { label: "Build Profiles…", fn: () => BuildUI.showProfiles() },
      { label: "Build And Run", shortcut: "⌘B", fn: () => BuildUI.buildAndRun() },
    ]));
    mb.appendChild(menu("Edit", () => [
      { label: "Undo", shortcut: "⌘Z", disabled: true },
      { sep: true },
      { label: "Duplicate", shortcut: "⌘D", disabled: !Editor.selectedGameObject(), fn: () => Editor.duplicateSelection() },
      { label: "Delete", shortcut: "⌫", disabled: !Editor.selectedGameObject(), fn: () => Editor.deleteSelection() },
      { sep: true },
      { label: Editor.playing ? "Stop" : "Play", shortcut: "⌘P", fn: () => Editor.togglePlay() },
      { label: "Pause", shortcut: "⌘⇧P", disabled: !Editor.playing, fn: () => Editor.togglePause() },
      { label: "Step", disabled: !Editor.playing, fn: () => Editor.stepFrame() },
      { sep: true },
      { label: "Project Settings…", fn: showProjectSettings },
    ]));
    mb.appendChild(menu("GameObject", () => gameObjectMenuItems(null)));
    mb.appendChild(menu("Component", () => {
      const go = Editor.selectedGameObject();
      if (!go) return [{ label: "(select a GameObject first)", disabled: true }];
      const items = [];
      const scripts = CSCompiler.allScriptClassNames();
      if (scripts.length) {
        items.push({ header: "Scripts" });
        for (const n of scripts) items.push({ label: "📜 " + n, fn: () => { go.AddComponent(n); Editor.markSceneEdited(); Inspector.refresh(true); } });
      }
      items.push({ header: "Built-in" });
      for (const def of ComponentRegistry.allTypes()) {
        items.push({ label: `${def.icon} ${def.name}`, fn: () => { go.AddComponent(def.name); Editor.markSceneEdited(); Inspector.refresh(true); } });
      }
      return items;
    }));
    mb.appendChild(menu("Window", () => [
      { label: "Scene View", fn: () => Editor.setViewMode("scene") },
      { label: "Game View", fn: () => Editor.setViewMode("game") },
      { label: "Scene | Game (Split)", fn: () => Editor.setViewMode("split") },
      { sep: true },
      { label: (SceneView.gizmosEnabled ? "✓ " : "") + "Gizmos", fn: () => { SceneView.gizmosEnabled = !SceneView.gizmosEnabled; } },
    ]));
    mb.appendChild(menu("Help", () => [
      { label: "About Webity…", fn: () => UIKit.modal("Webity — Web Unity Editor", `
        <p style="line-height:1.7">This is not a visual mock-up.<br>
        The scene, components, physics, C# scripts, and the game runtime are all running inside your browser.</p>
        <p style="margin-top:8px;color:var(--text-dim)">Scene &amp; Hierarchy → live GameObject database<br>
        Inspector → writes directly into component data<br>
        Play → the scene is serialized, duplicated and simulated<br>
        C# → lexed, parsed and compiled to JS in-browser<br>
        Build → standalone game without the editor</p>`) },
      { label: "Controls", fn: () => UIKit.modal("Game Controls", `
        <table style="line-height:1.9">
        <tr><td><kbd>W A S D</kbd> / arrows&nbsp;&nbsp;</td><td>Move</td></tr>
        <tr><td><kbd>Space</kbd></td><td>Jump / Double Jump</td></tr>
        <tr><td><kbd>Shift</kbd></td><td>Dash</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Pause (and release mouse)</td></tr>
        <tr><td><kbd>R</kbd></td><td>Restart</td></tr>
        </table>
        <p style="margin-top:10px;color:var(--text-dim)">Scene View: RMB look + WASD fly, MMB/Alt pan, wheel zoom, F frame selection</p>`) },
    ]));
  }

  function initToolbar() {
    const tb = document.getElementById("toolbar");
    tb.innerHTML = "";

    const tools = document.createElement("div");
    tools.className = "tool-group";
    const toolDefs = [
      { icon: "✥", title: "Move (W)", active: true },
      { icon: "⟳", title: "Rotate — edit rotation in the Inspector", disabled: true },
      { icon: "⤢", title: "Scale — edit scale in the Inspector", disabled: true },
    ];
    for (const t of toolDefs) {
      const b = document.createElement("button");
      b.className = "tool-btn" + (t.active ? " active" : "") + (t.disabled ? " disabled" : "");
      b.textContent = t.icon;
      b.title = t.title;
      tools.appendChild(b);
    }
    tb.appendChild(tools);

    const spacer1 = document.createElement("div");
    spacer1.className = "tool-spacer";
    tb.appendChild(spacer1);

    const play = document.createElement("div");
    play.className = "tool-group";
    playBtn = document.createElement("button");
    playBtn.className = "tool-btn";
    playBtn.textContent = "▶";
    playBtn.title = "Play";
    playBtn.onclick = () => Editor.togglePlay();
    pauseBtn = document.createElement("button");
    pauseBtn.className = "tool-btn";
    pauseBtn.textContent = "⏸";
    pauseBtn.title = "Pause";
    pauseBtn.onclick = () => Editor.togglePause();
    stepBtn = document.createElement("button");
    stepBtn.className = "tool-btn";
    stepBtn.textContent = "⏭";
    stepBtn.title = "Step one frame";
    stepBtn.onclick = () => Editor.stepFrame();
    play.appendChild(playBtn);
    play.appendChild(pauseBtn);
    play.appendChild(stepBtn);
    tb.appendChild(play);

    const spacer2 = document.createElement("div");
    spacer2.className = "tool-spacer";
    tb.appendChild(spacer2);

    const right = document.createElement("div");
    right.className = "tool-group";
    right.innerHTML = `
      <span class="tool-label">Layers</span>
      <select class="tool-select"><option>All</option></select>
      <span class="tool-label">Layout</span>
      <select class="tool-select"><option>Default</option></select>`;
    tb.appendChild(right);
    updatePlayState();
  }

  function updatePlayState() {
    if (!playBtn) return;
    const tb = document.getElementById("toolbar");
    tb.classList.toggle("playing", Editor.playing);
    playBtn.classList.toggle("active", Editor.playing);
    playBtn.textContent = Editor.playing ? "◼" : "▶";
    playBtn.title = Editor.playing ? "Stop" : "Play";
    pauseBtn.classList.toggle("on", Editor.playing && WRuntime.paused);
    pauseBtn.disabled = !Editor.playing;
    stepBtn.disabled = !Editor.playing;
  }

  function initViewportTabs() {
    const bar = document.getElementById("viewport-tabbar");
    for (const tab of bar.querySelectorAll(".panel-tab")) {
      tab.onclick = () => Editor.setViewMode(tab.dataset.view);
    }
    const tools = document.getElementById("viewport-tools");
    tools.innerHTML = `
      <label><input type="checkbox" id="vp-gizmos" checked> Gizmos</label>
      <label><input type="checkbox" id="vp-stats" checked> Stats</label>`;
    document.getElementById("vp-gizmos").onchange = (e) => { SceneView.gizmosEnabled = e.target.checked; };
    document.getElementById("vp-stats").onchange = (e) => {
      document.getElementById("game-stats").style.display = e.target.checked ? "" : "none";
    };
    updateViewTabs();
  }
  function updateViewTabs() {
    const bar = document.getElementById("viewport-tabbar");
    for (const tab of bar.querySelectorAll(".panel-tab")) {
      tab.classList.toggle("active", tab.dataset.view === Editor.viewMode);
    }
  }

  function initBottomTabs() {
    const bar = document.getElementById("bottom-tabbar");
    const show = (name) => {
      document.getElementById("project-body").style.display = name === "project" ? "flex" : "none";
      document.getElementById("console-body").style.display = name === "console" ? "flex" : "none";
      for (const tab of bar.querySelectorAll(".panel-tab")) {
        tab.classList.toggle("active", tab.dataset.tab === name);
      }
    };
    for (const tab of bar.querySelectorAll(".panel-tab")) {
      tab.onclick = () => show(tab.dataset.tab);
    }
    show("project");
    Toolbar.showBottomTab = show;
  }

  function showProjectSettings() {
    const scene = Editor.scene;
    const g = scene.settings.gravity;
    const body = document.createElement("div");
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:140px 1fr;gap:8px;align-items:center">
        <span>Gravity Y</span><input id="ps-grav-y" type="number" step="0.1" value="${g.y}" style="background:var(--well);color:#fff;border:1px solid var(--border);height:22px;padding:0 6px">
        <span>Fixed Timestep</span><input id="ps-fixed" type="number" step="0.005" value="${scene.settings.fixedTimestep}" style="background:var(--well);color:#fff;border:1px solid var(--border);height:22px;padding:0 6px">
        <span>Play with compile errors</span><input id="ps-play-err" type="checkbox" ${Editor.project.settings?.playWithErrors ? "checked" : ""}>
      </div>
      <p style="color:var(--text-dim);margin-top:10px;font-size:11px">
      "Play with compile errors" runs the last successfully compiled scripts (Unity-style is to block Play).</p>`;
    UIKit.modal("Project Settings", body, [
      { label: "Cancel" },
      { label: "Apply", primary: true, fn: () => {
        const gy = parseFloat(document.getElementById("ps-grav-y").value);
        const ft = parseFloat(document.getElementById("ps-fixed").value);
        if (!isNaN(gy)) scene.settings.gravity = new Vector3(g.x, gy, g.z);
        if (!isNaN(ft) && ft > 0.001) scene.settings.fixedTimestep = ft;
        Editor.project.settings = Editor.project.settings || {};
        Editor.project.settings.playWithErrors = document.getElementById("ps-play-err").checked;
        Editor.markSceneEdited();
        WConsole.log(`Physics gravity set to (0, ${scene.settings.gravity.y}, 0)`);
      } },
    ]);
  }

  return { initMenubar, initToolbar, initViewportTabs, initBottomTabs, updatePlayState, updateViewTabs };
})();
