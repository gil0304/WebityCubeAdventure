/* Webity editor — C# script editor with tabs, highlighting, save & recompile */
"use strict";

const CodeEditor = (() => {
  let regionEl = null;
  let tabsEl = null, toolbarEl = null, gutterEl = null, highlightEl = null, textareaEl = null, statusEl = null, codeAreaEl = null;
  const open_ = new Map(); // path -> {text, dirty}
  let activePath = null;
  let errorMarks = new Map(); // path -> [{line, msg}]

  function init() {
    regionEl = document.getElementById("script-editor-region");
    regionEl.innerHTML = `
      <div class="se-tabs" id="se-tabs"></div>
      <div class="se-toolbar">
        <button class="btn" id="se-save">💾 Save &amp; Compile <span style="opacity:.6">⌘S</span></button>
        <button class="btn" id="se-close">Back to Scene</button>
        <span class="se-status" id="se-status"></span>
      </div>
      <div class="se-editor-wrap">
        <div class="se-gutter" id="se-gutter"></div>
        <div class="se-code-area" id="se-code-area">
          <pre class="se-highlight" id="se-highlight"></pre>
          <textarea class="se-textarea" id="se-textarea" spellcheck="false" wrap="off"></textarea>
        </div>
      </div>`;
    tabsEl = document.getElementById("se-tabs");
    gutterEl = document.getElementById("se-gutter");
    highlightEl = document.getElementById("se-highlight");
    textareaEl = document.getElementById("se-textarea");
    statusEl = document.getElementById("se-status");
    codeAreaEl = document.getElementById("se-code-area");
    document.getElementById("se-save").onclick = save;
    document.getElementById("se-close").onclick = hide;

    textareaEl.style.overflow = "auto";
    textareaEl.addEventListener("input", () => {
      const rec = open_.get(activePath);
      if (rec) { rec.text = textareaEl.value; rec.dirty = true; renderTabs(); }
      renderHighlight();
    });
    textareaEl.addEventListener("scroll", syncScroll);
    textareaEl.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); }
      if (e.key === "Tab") {
        e.preventDefault();
        const start = textareaEl.selectionStart, end = textareaEl.selectionEnd;
        textareaEl.value = textareaEl.value.slice(0, start) + "    " + textareaEl.value.slice(end);
        textareaEl.selectionStart = textareaEl.selectionEnd = start + 4;
        textareaEl.dispatchEvent(new Event("input"));
      }
    });
  }

  function syncScroll() {
    highlightEl.style.transform = `translate(${-textareaEl.scrollLeft}px, ${-textareaEl.scrollTop}px)`;
    gutterEl.firstChild && (gutterEl.firstChild.style.transform = `translateY(${-textareaEl.scrollTop}px)`);
  }

  function open(path, line) {
    const asset = WAssets.getScript(path);
    if (!asset) { WConsole.error("Script not found: " + path); return; }
    if (!open_.has(path)) open_.set(path, { text: asset.source, dirty: false });
    activePath = path;
    show();
    renderTabs();
    loadActive();
    if (line) {
      const pos = lineToPos(textareaEl.value, line);
      textareaEl.focus();
      textareaEl.setSelectionRange(pos, pos);
      textareaEl.scrollTop = Math.max(0, (line - 6) * 18);
      syncScroll();
    }
  }
  function lineToPos(text, line) {
    let pos = 0;
    const lines = text.split("\n");
    for (let i = 0; i < Math.min(line - 1, lines.length); i++) pos += lines[i].length + 1;
    return pos;
  }

  function show() { regionEl.style.display = "flex"; Editor.scriptEditorVisible = true; }
  function hide() { regionEl.style.display = "none"; Editor.scriptEditorVisible = false; }
  function isVisible() { return regionEl.style.display !== "none"; }

  function close(path) {
    const rec = open_.get(path);
    open_.delete(path);
    void rec;
    if (activePath === path) {
      activePath = open_.size ? [...open_.keys()][open_.size - 1] : null;
      if (!activePath) { hide(); return; }
      loadActive();
    }
    renderTabs();
  }

  function renderTabs() {
    tabsEl.innerHTML = "";
    for (const [path, rec] of open_) {
      const tab = document.createElement("div");
      tab.className = "se-tab" + (path === activePath ? " active" : "");
      const name = document.createElement("span");
      name.textContent = path.split("/").pop();
      tab.appendChild(name);
      if (rec.dirty) {
        const dot = document.createElement("span");
        dot.className = "dot"; dot.textContent = "●";
        tab.appendChild(dot);
      }
      const close_ = document.createElement("span");
      close_.className = "close"; close_.textContent = "✕";
      close_.onclick = (e) => { e.stopPropagation(); close(path); };
      tab.appendChild(close_);
      tab.onclick = () => { activePath = path; renderTabs(); loadActive(); };
      tabsEl.appendChild(tab);
    }
  }

  function loadActive() {
    const rec = open_.get(activePath);
    if (!rec) return;
    textareaEl.value = rec.text;
    renderHighlight();
    updateStatus();
  }

  function updateStatus(msg, cls) {
    if (msg !== undefined) {
      statusEl.textContent = msg;
      statusEl.className = "se-status " + (cls || "");
      return;
    }
    const errs = errorMarks.get(activePath) || [];
    if (errs.length) {
      statusEl.textContent = `⛔ ${errs.length} error(s)`;
      statusEl.className = "se-status err";
    } else {
      statusEl.textContent = activePath || "";
      statusEl.className = "se-status";
    }
  }

  /* ---------- highlighting ---------- */
  const KW = new Set([...CS_KEYWORDS]);
  const TYPES = new Set(["Vector3", "Vector2", "Quaternion", "Color", "Transform", "GameObject", "Rigidbody",
    "Collider", "Collision", "MonoBehaviour", "AudioSource", "AudioClip", "ParticleSystem", "MeshRenderer",
    "Text", "Image", "Button", "Camera", "LayerMask", "RaycastHit", "IEnumerator", "WaitForSeconds",
    "Mathf", "Time", "Input", "Physics", "Debug", "Random", "KeyCode", "Application", "SceneManager", "List",
    "GameState", "EnemyState", "RotationAxis", "PlayerHealth", "PlayerController", "PlayerCollector",
    "GameManager", "AudioManager", "UIManager", "CollectibleItem", "EnemyController", "Animator", "Screen"]);
  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function highlightLine(line, state) {
    let out = "";
    let i = 0;
    while (i < line.length) {
      if (state.inBlockComment) {
        const end = line.indexOf("*/", i);
        if (end === -1) { out += `<span class="tok-comment">${esc(line.slice(i))}</span>`; i = line.length; break; }
        out += `<span class="tok-comment">${esc(line.slice(i, end + 2))}</span>`;
        i = end + 2;
        state.inBlockComment = false;
        continue;
      }
      const ch = line[i];
      if (ch === "/" && line[i + 1] === "/") { out += `<span class="tok-comment">${esc(line.slice(i))}</span>`; break; }
      if (ch === "/" && line[i + 1] === "*") { state.inBlockComment = true; out += `<span class="tok-comment">/*</span>`; i += 2; continue; }
      if (ch === '"' || (ch === "$" && line[i + 1] === '"')) {
        let j = ch === "$" ? i + 2 : i + 1;
        while (j < line.length && line[j] !== '"') { if (line[j] === "\\") j++; j++; }
        out += `<span class="tok-str">${esc(line.slice(i, j + 1))}</span>`;
        i = j + 1;
        continue;
      }
      if (ch === "[" && /^\[\s*\w+/.test(line.slice(i))) {
        const m = /^\[[^\]]*\]/.exec(line.slice(i));
        if (m && /^\[\s*(Header|Range|SerializeField|Tooltip|HideInInspector|TextArea)/.test(m[0])) {
          out += `<span class="tok-attr">${esc(m[0])}</span>`;
          i += m[0].length;
          continue;
        }
      }
      if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(line[i + 1] || ""))) {
        const m = /^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?[fFdDmM]?/.exec(line.slice(i));
        if (m) { out += `<span class="tok-num">${esc(m[0])}</span>`; i += m[0].length; continue; }
      }
      if (/[A-Za-z_]/.test(ch)) {
        const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(line.slice(i));
        const word = m[0];
        const after = line.slice(i + word.length);
        let cls = "";
        if (KW.has(word)) cls = "tok-kw";
        else if (TYPES.has(word)) cls = "tok-type";
        else if (/^\s*\(/.test(after)) cls = "tok-method";
        out += cls ? `<span class="${cls}">${esc(word)}</span>` : esc(word);
        i += word.length;
        continue;
      }
      out += esc(ch);
      i++;
    }
    return out;
  }

  function renderHighlight() {
    const text = textareaEl.value;
    const lines = text.split("\n");
    const errs = errorMarks.get(activePath) || [];
    const errLines = new Set(errs.map((e) => e.line));
    const state = { inBlockComment: false };
    const html = lines.map((ln, idx) => {
      const content = highlightLine(ln, state) || "";
      if (errLines.has(idx + 1)) {
        return `<span style="background:rgba(224,90,78,.16);display:inline-block;min-width:100%">${content || "&nbsp;"}</span>`;
      }
      return content;
    }).join("\n");
    highlightEl.innerHTML = html + "\n";
    // size the textarea's virtual content
    const gutter = document.createElement("div");
    gutter.style.whiteSpace = "pre";
    gutter.textContent = lines.map((_, i) => String(i + 1)).join("\n");
    gutterEl.innerHTML = "";
    gutterEl.appendChild(gutter);
    syncScroll();
  }

  /* ---------- save & compile ---------- */
  function save() {
    const rec = open_.get(activePath);
    if (!rec) return;
    rec.dirty = false;
    Editor.updateScript(activePath, rec.text);
    renderTabs();
    const result = compileProject();
    if (result.ok) {
      updateStatus("✓ Compilation succeeded", "ok");
    } else {
      updateStatus();
    }
  }

  function compileProject() {
    const t0 = performance.now();
    const result = CSCompiler.compileAll(WAssets.scripts);
    errorMarks = new Map();
    if (!result.ok) {
      for (const err of result.errors) {
        const msg = `${err.path}(${err.line},${err.col}): error ${err.code}: ${err.message}`;
        WConsole.error(msg, { path: err.path, line: err.line });
        if (!errorMarks.has(err.path)) errorMarks.set(err.path, []);
        errorMarks.get(err.path).push({ line: err.line, msg: err.message });
      }
      WConsole.error(`Compilation failed (${result.errors.length} error(s))`);
    } else {
      const ms = Math.round(performance.now() - t0);
      WConsole.log(`Compilation succeeded — ${result.classCount} classes (${ms} ms)`);
      Editor.onScriptsRecompiled(result.changedDefaults);
    }
    renderHighlight();
    if (Editor.playing && result.ok) {
      WConsole.warn("Scripts recompiled. Changes take effect the next time you enter Play Mode.");
    }
    return result;
  }

  return { init, open, hide, show, isVisible, save, compileProject,
    get activePath() { return activePath; } };
})();
