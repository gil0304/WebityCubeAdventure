/* Webity editor — Console panel */
"use strict";

const WConsole = (() => {
  const entries = []; // {level, msg, count, source: {path, line}?}
  let listEl = null, summaryEl = null;
  let filters = { log: true, warn: true, error: true };
  let clearOnPlay = true;
  let dirty = false;

  function add(level, msg, source) {
    const last = entries[entries.length - 1];
    if (last && last.level === level && last.msg === msg) {
      last.count++;
    } else {
      entries.push({ level, msg, count: 1, source: source || null });
      if (entries.length > 800) entries.splice(0, 200);
    }
    dirty = true;
    const statusEl = document.getElementById("status-msg");
    if (statusEl) {
      statusEl.textContent = msg.split("\n")[0];
      statusEl.className = level === "error" ? "err" : "";
    }
  }

  function clear() { entries.length = 0; dirty = true; render(); }

  function counts() {
    const c = { log: 0, warn: 0, error: 0 };
    for (const e of entries) c[e.level] = (c[e.level] || 0) + e.count;
    return c;
  }

  function init() {
    const body = document.getElementById("console-body");
    body.innerHTML = `
      <div class="console-toolbar">
        <button class="btn" id="console-clear">Clear</button>
        <label style="display:flex;align-items:center;gap:4px;color:var(--text-dim);font-size:10px">
          <input type="checkbox" id="console-clear-on-play" checked> Clear on Play</label>
        <span style="flex:1"></span>
        <label class="console-filter" data-f="log" style="cursor:pointer">💬 <span id="cnt-log">0</span></label>
        <label class="console-filter" data-f="warn" style="cursor:pointer">⚠️ <span id="cnt-warn">0</span></label>
        <label class="console-filter" data-f="error" style="cursor:pointer">⛔ <span id="cnt-error">0</span></label>
      </div>
      <div class="console-list" id="console-list"></div>`;
    listEl = document.getElementById("console-list");
    summaryEl = document.getElementById("console-summary");
    document.getElementById("console-clear").onclick = clear;
    document.getElementById("console-clear-on-play").onchange = (e) => { clearOnPlay = e.target.checked; };
    for (const el of body.querySelectorAll(".console-filter")) {
      el.onclick = () => {
        const f = el.dataset.f;
        filters[f] = !filters[f];
        el.style.opacity = filters[f] ? 1 : 0.35;
        render();
      };
    }
    // capture internal errors too
    window.addEventListener("error", (e) => {
      if (e.message && !String(e.filename).includes("blob:")) {
        add("error", `[Internal] ${e.message} (${(e.filename || "").split("/").pop()}:${e.lineno})`);
      }
    });
  }

  const ICONS = { log: "💬", warn: "⚠️", error: "⛔" };
  function render() {
    if (!listEl) return;
    const atBottom = listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 30;
    listEl.innerHTML = "";
    for (const e of entries) {
      if (!filters[e.level]) continue;
      const div = document.createElement("div");
      div.className = "console-entry " + e.level;
      const msg = document.createElement("span");
      msg.className = "msg";
      msg.textContent = e.msg;
      div.innerHTML = `<span class="ico">${ICONS[e.level]}</span>`;
      div.appendChild(msg);
      if (e.count > 1) {
        const c = document.createElement("span");
        c.className = "count"; c.textContent = e.count;
        div.appendChild(c);
      }
      if (e.source) {
        div.style.cursor = "pointer";
        div.title = `${e.source.path} (line ${e.source.line})`;
        div.ondblclick = () => CodeEditor.open(e.source.path, e.source.line);
      }
      listEl.appendChild(div);
    }
    if (atBottom) listEl.scrollTop = listEl.scrollHeight;
    const c = counts();
    document.getElementById("cnt-log").textContent = c.log;
    document.getElementById("cnt-warn").textContent = c.warn;
    document.getElementById("cnt-error").textContent = c.error;
    if (summaryEl) {
      summaryEl.innerHTML = c.error ? `<span style="color:var(--red)">⛔ ${c.error}</span>` :
        c.warn ? `<span style="color:var(--yellow)">⚠️ ${c.warn}</span>` : "";
    }
    dirty = false;
  }

  function tick() { if (dirty) render(); }

  return {
    init, add, clear, tick, render,
    get clearOnPlay() { return clearOnPlay; },
    log: (m) => add("log", m),
    warn: (m) => add("warn", m),
    error: (m, source) => add("error", m, source),
  };
})();
