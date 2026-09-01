/* Webity editor — Project panel */
"use strict";

const Project = (() => {
  let bodyEl = null, foldersEl = null, filesEl = null;
  let selectedFolder = "Assets/Scenes";
  const expandedFolders = new Set(["Assets", "Assets/Scripts"]);

  const STATIC_FOLDERS = [
    "Assets", "Assets/Animations", "Assets/Audio", "Assets/Materials", "Assets/Models",
    "Assets/Particles", "Assets/Prefabs", "Assets/Scenes", "Assets/Scripts",
    "Assets/Textures", "Assets/UI", "Packages", "ProjectSettings",
  ];

  function allFolders() {
    const set = new Set(STATIC_FOLDERS);
    for (const p of WAssets.allPaths()) {
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join("/"));
    }
    return [...set].sort();
  }

  function filesIn(folder) {
    return WAssets.allPaths().filter((p) => {
      const idx = p.lastIndexOf("/");
      return p.slice(0, idx) === folder;
    }).sort();
  }

  function iconFor(path) {
    if (path.endsWith(".cs")) return "📜";
    if (path.endsWith(".mat")) return "🔮";
    if (path.endsWith(".prefab")) return "📦";
    if (path.endsWith(".clip")) return "🎵";
    if (path.endsWith(".scene")) return "🎬";
    if (path.endsWith(".png")) return "🖼";
    return "📄";
  }

  function init() {
    bodyEl = document.getElementById("project-body");
    bodyEl.innerHTML = `<div class="proj-folders" id="proj-folders"></div><div class="proj-files" id="proj-files"></div>`;
    foldersEl = document.getElementById("proj-folders");
    filesEl = document.getElementById("proj-files");
    render();
  }

  function render() {
    renderFolders();
    renderFiles();
  }

  function renderFolders() {
    foldersEl.innerHTML = "";
    const folders = allFolders();
    for (const f of folders) {
      const parts = f.split("/");
      const depth = parts.length - 1;
      if (depth > 0) {
        const parent = parts.slice(0, -1).join("/");
        if (!expandedFolders.has(parent)) continue;
        let anc = parent;
        let hidden = false;
        while (anc.includes("/")) {
          anc = anc.split("/").slice(0, -1).join("/");
          if (!expandedFolders.has(anc)) { hidden = true; break; }
        }
        if (hidden) continue;
      }
      const div = document.createElement("div");
      div.className = "proj-folder" + (f === selectedFolder ? " selected" : "");
      div.style.paddingLeft = 6 + depth * 14 + "px";
      const hasKids = folders.some((o) => o !== f && o.startsWith(f + "/"));
      const isOpen = expandedFolders.has(f);
      div.innerHTML = `<span class="hier-arrow">${hasKids ? (isOpen ? "▼" : "▶") : ""}</span><span class="hier-icon">${isOpen && hasKids ? "📂" : "📁"}</span><span class="hier-name">${f.split("/").pop()}</span>`;
      div.querySelector(".hier-arrow").onclick = (e) => {
        e.stopPropagation();
        if (isOpen) expandedFolders.delete(f); else expandedFolders.add(f);
        renderFolders();
      };
      div.onclick = () => { selectedFolder = f; if (hasKids) expandedFolders.add(f); render(); };
      foldersEl.appendChild(div);
    }
  }

  function renderFiles() {
    filesEl.innerHTML = "";
    const files = filesIn(selectedFolder);
    if (!files.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "color:var(--text-dim);padding:12px;font-size:11px";
      empty.textContent = selectedFolder.startsWith("Assets") ? "This folder is empty" : "(managed by Webity)";
      filesEl.appendChild(empty);
      return;
    }
    for (const path of files) {
      const div = document.createElement("div");
      div.className = "proj-file" + (Editor.selection?.kind === "asset" && Editor.selection.path === path ? " selected" : "");
      const icon = document.createElement("div");
      icon.className = "file-icon";
      if (path.endsWith(".mat")) {
        const mat = WAssets.getMaterial(path);
        const ball = document.createElement("div");
        ball.className = "mat-ball";
        if (mat) {
          const c = mat.color, e = mat.emission, ei = mat.emissionIntensity;
          ball.style.background = `radial-gradient(circle at 35% 30%, ${new Color(Math.min(1, c.r + 0.4 + e.r * ei), Math.min(1, c.g + 0.4 + e.g * ei), Math.min(1, c.b + 0.4 + e.b * ei)).toCSS()}, ${c.toCSS()} 55%, ${new Color(c.r * 0.35, c.g * 0.35, c.b * 0.35).toCSS()})`;
        }
        icon.appendChild(ball);
      } else if (path.endsWith(".png")) {
        const texName = WAssets.textures.get(path)?.tex;
        const preview = WRenderer.getTexturePreview(texName);
        if (preview) {
          const img = document.createElement("img");
          img.src = preview.toDataURL();
          img.style.cssText = "width:32px;height:32px;border-radius:3px";
          icon.appendChild(img);
        } else icon.textContent = "🖼";
      } else {
        icon.textContent = iconFor(path);
      }
      const name = document.createElement("div");
      name.className = "file-name";
      name.textContent = path.split("/").pop();
      div.appendChild(icon);
      div.appendChild(name);
      div.onclick = () => Editor.select({ kind: "asset", path });
      div.ondblclick = () => {
        if (path.endsWith(".cs")) CodeEditor.open(path);
        else if (path.endsWith(".clip")) { const d = WAssets.getAudioClip(path); if (d) WAudio.play(d.clip); }
        else if (path.endsWith(".prefab")) Editor.instantiatePrefab(path, null);
      };
      if (path.endsWith(".prefab")) {
        div.draggable = true;
        div.ondragstart = (e) => {
          e.dataTransfer.setData("text/webity-prefab", path);
          e.dataTransfer.effectAllowed = "copy";
        };
      }
      filesEl.appendChild(div);
    }
  }

  return { init, render, iconFor, get selectedFolder() { return selectedFolder; } };
})();
