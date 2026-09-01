/* Webity editor — Hierarchy panel (bound to live scene data) */
"use strict";

const Hierarchy = (() => {
  let bodyEl = null;
  const expanded = new Map(); // id -> bool
  let lastSignature = "";
  let renamingId = null;
  let dragId = null;

  function activeScene() { return Editor.playing ? WRuntime.scene : Editor.scene; }

  function iconFor(go) {
    const order = ["Camera", "Light", "Canvas", "Text", "Button", "Image", "Panel", "ParticleSystem",
      "MeshRenderer", "Rigidbody", "AudioSource", "EventSystem", "PostProcessVolume"];
    const icons = { Camera: "🎥", Light: "💡", Canvas: "🖼", Text: "🅣", Button: "🔘", Image: "🟦",
      Panel: "▢", ParticleSystem: "✨", MeshRenderer: "🧊", Rigidbody: "🟣", AudioSource: "🔊",
      EventSystem: "🖱", PostProcessVolume: "🌈" };
    for (const t of order) if (go.GetComponent(t)) return icons[t];
    if (go.components.some((c) => c.typeName === "CSScript")) return "📜";
    return "▫️";
  }

  function signature() {
    const s = activeScene();
    if (!s) return "none";
    let sig = Editor.playing ? "play|" : "edit|";
    for (const go of s.iterate()) {
      sig += go.id + go.name + (go.activeSelf ? 1 : 0) + (expanded.get(go.id) === false ? "c" : "e") + "|";
    }
    sig += "sel:" + (Editor.selection?.kind === "go" ? Editor.selection.id : "-");
    return sig;
  }

  function init() {
    bodyEl = document.getElementById("hierarchy-body");
    bodyEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (e.target === bodyEl) showContextMenu(e, null);
    });
    bodyEl.addEventListener("click", (e) => { if (e.target === bodyEl) Editor.select(null); });
    bodyEl.addEventListener("dragover", (e) => e.preventDefault());
    bodyEl.addEventListener("drop", (e) => {
      e.preventDefault();
      // drop to root
      if (dragId !== null) {
        const s = activeScene();
        const go = s.getById(dragId);
        if (go) { go.transform.SetParent(null, true); Editor.markSceneEdited(); }
        dragId = null;
        refresh(true);
      }
    });
  }

  function refresh(force) {
    const sig = signature();
    if (!force && sig === lastSignature) return;
    lastSignature = sig;
    render();
  }

  function render() {
    const s = activeScene();
    bodyEl.innerHTML = "";
    const header = document.createElement("div");
    header.className = "hier-scene-header";
    header.innerHTML = `<span>${Editor.playing ? "▶" : "◆"}</span><span>${s ? s.name : "-"}</span>` +
      (Editor.dirty && !Editor.playing ? `<span class="dirty">*</span>` : "") +
      (Editor.playing ? `<span class="dirty">(Play Mode)</span>` : "");
    bodyEl.appendChild(header);
    if (!s) return;
    for (const root of s.roots) if (!root.__destroyed) renderItem(root, 0);
  }

  function renderItem(go, depth) {
    const item = document.createElement("div");
    item.className = "hier-item";
    if (Editor.selection?.kind === "go" && Editor.selection.id === go.id) item.classList.add("selected");
    if (!go.activeInHierarchy) item.classList.add("inactive");
    if (go.prefabSource) item.classList.add("prefab");
    item.style.paddingLeft = depth * 14 + "px";

    const hasKids = go.transform.children.length > 0;
    const isOpen = expanded.get(go.id) !== false;
    const arrow = document.createElement("span");
    arrow.className = "hier-arrow";
    arrow.textContent = hasKids ? (isOpen ? "▼" : "▶") : "";
    arrow.onclick = (e) => { e.stopPropagation(); expanded.set(go.id, !isOpen); refresh(true); };
    item.appendChild(arrow);

    const icon = document.createElement("span");
    icon.className = "hier-icon";
    icon.textContent = iconFor(go);
    item.appendChild(icon);

    if (renamingId === go.id) {
      const input = document.createElement("input");
      input.className = "rename";
      input.value = go.name;
      input.onclick = (e) => e.stopPropagation();
      const commit = () => {
        if (input.value.trim()) go.name = input.value.trim();
        renamingId = null;
        Editor.markSceneEdited();
        refresh(true);
        Inspector.refresh(true);
      };
      input.onblur = commit;
      input.onkeydown = (e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") { renamingId = null; refresh(true); }
        e.stopPropagation();
      };
      item.appendChild(input);
      setTimeout(() => { input.focus(); input.select(); }, 0);
    } else {
      const name = document.createElement("span");
      name.className = "hier-name";
      name.textContent = go.name;
      item.appendChild(name);
    }

    item.onclick = () => Editor.select({ kind: "go", id: go.id });
    item.ondblclick = () => { Editor.select({ kind: "go", id: go.id }); SceneView.frameSelection(); };
    item.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); Editor.select({ kind: "go", id: go.id }); showContextMenu(e, go); };

    item.draggable = true;
    item.ondragstart = (e) => { dragId = go.id; e.dataTransfer.setData("text/webity-go", String(go.id)); };
    item.ondragover = (e) => { e.preventDefault(); e.stopPropagation(); item.style.background = "#3a5a3a"; };
    item.ondragleave = () => { item.style.background = ""; };
    item.ondrop = (e) => {
      e.preventDefault(); e.stopPropagation();
      item.style.background = "";
      const s = activeScene();
      if (dragId !== null && dragId !== go.id) {
        const dragged = s.getById(dragId);
        if (dragged && !go.transform.IsChildOf(dragged.transform)) {
          dragged.transform.SetParent(go.transform, true);
          expanded.set(go.id, true);
          Editor.markSceneEdited();
        }
      }
      const prefabPath = e.dataTransfer.getData("text/webity-prefab");
      if (prefabPath) Editor.instantiatePrefab(prefabPath, null);
      dragId = null;
      refresh(true);
    };

    bodyEl.appendChild(item);
    if (hasKids && isOpen) {
      for (const c of go.transform.children) {
        if (!c.gameObject.__destroyed) renderItem(c.gameObject, depth + 1);
      }
    }
  }

  function showContextMenu(e, go) {
    const items = [];
    if (go) {
      items.push(
        { label: "Rename", fn: () => { renamingId = go.id; refresh(true); } },
        { label: "Duplicate", shortcut: "⌘D", fn: () => Editor.duplicateSelection() },
        { label: "Delete", shortcut: "Del", fn: () => Editor.deleteSelection() },
        { label: go.activeSelf ? "Set Inactive" : "Set Active", fn: () => { go.SetActive(!go.activeSelf); Editor.markSceneEdited(); refresh(true); Inspector.refresh(true); } },
        { sep: true },
      );
    }
    items.push(
      { label: "Create Empty", fn: () => Editor.createObject("GameObject", null, go) },
      { label: "3D Object", submenu: MeshLib.names.map((m) => ({ label: m, fn: () => Editor.createObject(m, m, go) })) },
      { label: "UI", submenu: ["Text", "Image", "Button", "Panel"].map((t) => ({ label: t, fn: () => Editor.createUIObject(t, go) })) },
    );
    UIKit.contextMenu(e.clientX, e.clientY, items);
  }

  return { init, refresh, get expandedMap() { return expanded; } };
})();
