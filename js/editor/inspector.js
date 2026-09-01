/* Webity editor — Inspector panel */
"use strict";

const Inspector = (() => {
  let bodyEl = null;
  let currentKey = "";
  let liveUpdaters = [];
  let lastLiveUpdate = 0;

  function activeScene() { return Editor.playing ? WRuntime.scene : Editor.scene; }
  function selectedGO() {
    if (Editor.selection?.kind !== "go") return null;
    const s = activeScene();
    if (!s) return null;
    const go = s.getById(Editor.selection.id);
    return go && !go.__destroyed ? go : null;
  }

  function init() { bodyEl = document.getElementById("inspector-body"); }

  function keyOf() {
    const sel = Editor.selection;
    if (!sel) return "none";
    if (sel.kind === "go") {
      const go = selectedGO();
      if (!go) return "gone";
      return `go:${go.id}:${go.components.filter((c) => !c.__destroyed).length}:${Editor.playing ? "p" : "e"}:${go.activeSelf}:${go.name}:${go.tag}:${go.layer}`;
    }
    return `asset:${sel.path}`;
  }

  function refresh(force) {
    const key = keyOf();
    if (!force && key === currentKey) {
      liveTick();
      return;
    }
    currentKey = key;
    build();
  }

  function liveTick() {
    if (!Editor.playing || !liveUpdaters.length) return;
    const now = performance.now();
    if (now - lastLiveUpdate < 120) return;
    lastLiveUpdate = now;
    for (const u of liveUpdaters) { try { u(); } catch (e) {} }
  }

  function build() {
    liveUpdaters = [];
    bodyEl.innerHTML = "";
    const sel = Editor.selection;
    if (!sel) { bodyEl.innerHTML = `<div class="insp-empty">Nothing selected</div>`; return; }
    if (sel.kind === "asset") { buildAsset(sel.path); return; }
    const go = selectedGO();
    if (!go) { bodyEl.innerHTML = `<div class="insp-empty">Nothing selected</div>`; return; }
    buildGO(go);
  }

  /* =============== GameObject inspector =============== */
  function buildGO(go) {
    const header = document.createElement("div");
    header.className = "insp-header";
    const activeCb = document.createElement("input");
    activeCb.type = "checkbox";
    activeCb.checked = go.activeSelf;
    activeCb.onchange = () => { go.SetActive(activeCb.checked); Editor.markSceneEdited(); Hierarchy.refresh(true); };
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = go.name;
    nameInput.onchange = () => { go.name = nameInput.value; Editor.markSceneEdited(); Hierarchy.refresh(true); };
    header.innerHTML = `<span class="obj-icon">🧊</span>`;
    header.appendChild(activeCb);
    header.appendChild(nameInput);
    if (Editor.playing) {
      const live = document.createElement("span");
      live.className = "insp-live"; live.textContent = "runtime";
      header.appendChild(live);
    }
    bodyEl.appendChild(header);

    const sub = document.createElement("div");
    sub.className = "insp-subheader";
    const tagSel = document.createElement("select");
    for (const t of TAGS) tagSel.appendChild(new Option(t, t));
    tagSel.value = TAGS.includes(go.tag) ? go.tag : "Untagged";
    tagSel.onchange = () => { go.tag = tagSel.value; Editor.markSceneEdited(); };
    const layerSel = document.createElement("select");
    LAYERS.forEach((l, i) => layerSel.appendChild(new Option(`${i}: ${l}`, i)));
    layerSel.value = go.layer;
    layerSel.onchange = () => { go.layer = parseInt(layerSel.value); Editor.markSceneEdited(); };
    sub.innerHTML = `<span class="lbl">Tag</span>`;
    sub.appendChild(tagSel);
    const lyLbl = document.createElement("span"); lyLbl.className = "lbl"; lyLbl.textContent = "Layer";
    sub.appendChild(lyLbl);
    sub.appendChild(layerSel);
    bodyEl.appendChild(sub);
    if (go.prefabSource) {
      const p = document.createElement("div");
      p.className = "insp-subheader";
      p.innerHTML = `<span class="lbl">Prefab</span><span style="color:#7fb8e6">${go.prefabSource.split("/").pop()}</span>`;
      bodyEl.appendChild(p);
    }

    buildTransform(go);
    for (const comp of [...go.components]) {
      if (comp.__destroyed) continue;
      buildComponent(go, comp);
    }

    const addWrap = document.createElement("div");
    addWrap.className = "insp-addcomp";
    const addBtn = document.createElement("button");
    addBtn.textContent = "Add Component";
    addBtn.onclick = (e) => showAddComponentMenu(e, go);
    addWrap.appendChild(addBtn);
    bodyEl.appendChild(addWrap);
  }

  function section(title, icon, opts = {}) {
    const comp = document.createElement("div");
    comp.className = "comp";
    const head = document.createElement("div");
    head.className = "comp-header";
    head.innerHTML = `<span class="comp-arrow">▼</span><span class="comp-icon">${icon}</span>`;
    if (opts.checkbox) {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = opts.checkbox.value;
      cb.onchange = () => opts.checkbox.set(cb.checked);
      head.appendChild(cb);
    }
    const nm = document.createElement("span");
    nm.className = "comp-name";
    nm.textContent = title;
    head.appendChild(nm);
    if (opts.menu) {
      const menuBtn = document.createElement("span");
      menuBtn.className = "comp-menu-btn";
      menuBtn.textContent = "⋮";
      menuBtn.onclick = (e) => { e.stopPropagation(); opts.menu(e); };
      head.appendChild(menuBtn);
    }
    const body = document.createElement("div");
    body.className = "comp-body";
    head.querySelector(".comp-arrow").onclick = () => {
      const hidden = body.style.display === "none";
      body.style.display = hidden ? "" : "none";
      head.querySelector(".comp-arrow").textContent = hidden ? "▼" : "▶";
    };
    comp.appendChild(head);
    comp.appendChild(body);
    bodyEl.appendChild(comp);
    return { comp, body };
  }

  function buildTransform(go) {
    const { body } = section("Transform", "🧭");
    const t = go.transform;
    body.appendChild(vec3Row("Position",
      () => t.localPosition,
      (v) => { t.localPosition = v; Editor.markSceneEdited(); }));
    body.appendChild(vec3Row("Rotation",
      () => { const e = t.localEulerAngles; return new Vector3(round3(normAngle(e.x)), round3(normAngle(e.y)), round3(normAngle(e.z))); },
      (v) => { t.localEulerAngles = v; Editor.markSceneEdited(); }));
    body.appendChild(vec3Row("Scale",
      () => t.localScale,
      (v) => { t.localScale = v; Editor.markSceneEdited(); }));
  }
  function normAngle(a) { a %= 360; if (a > 180) a -= 360; if (a < -180) a += 360; return a; }
  function round3(x) { return Math.round(x * 1000) / 1000; }

  function metaFor(comp) {
    if (comp.typeName === "CSScript") return comp.__isMissingStub ? null : CSCompiler.meta(comp.className);
    return ComponentRegistry.meta(comp.typeName);
  }

  function buildComponent(go, comp) {
    const isScript = comp.typeName === "CSScript";
    const title = isScript ? `${niceLabelSafe(comp.className)} (Script)` : niceLabelSafe(comp.typeName);
    const iconMap = { CSScript: "📜" };
    const regMeta = !isScript ? ComponentRegistry.meta(comp.typeName) : null;
    const icon = isScript ? "📜" : (regMeta?.icon || "⚙️");
    const { comp: compEl, body } = section(title, icon, {
      checkbox: { value: comp.enabled !== false, set: (v) => { comp.enabled = v; Editor.markSceneEdited(); } },
      menu: (e) => {
        UIKit.contextMenu(e.clientX, e.clientY, [
          { label: "Remove Component", fn: () => { go.removeComponent(comp); Editor.markSceneEdited(); refresh(true); } },
          { label: "Reset", fn: () => { resetComponent(comp); Editor.markSceneEdited(); refresh(true); } },
          ...(isScript && !comp.__isMissingStub ? [{ label: "Edit Script", fn: () => openScriptFor(comp.className) }] : []),
        ]);
      },
    });
    if (comp.enabled === false) compEl.classList.add("disabled-comp");

    if (comp.__isMissingStub) {
      const w = document.createElement("div");
      w.className = "readonly-note";
      w.style.color = "var(--yellow)";
      w.textContent = `⚠ The associated script (${comp.className}) cannot be loaded. Fix compile errors.`;
      body.appendChild(w);
      return;
    }
    const meta = metaFor(comp);
    if (!meta) { body.innerHTML = `<div class="readonly-note">No editable properties</div>`; return; }
    if (isScript) {
      const row = propRow("Script");
      const scriptField = document.createElement("span");
      scriptField.style.cssText = "color:#8fd0ff;cursor:pointer;font-family:var(--mono);font-size:11px";
      scriptField.textContent = "📜 " + comp.className;
      scriptField.onclick = () => openScriptFor(comp.className);
      row.field.appendChild(scriptField);
      body.appendChild(row.row);
    }
    for (const f of meta.fields) {
      if (f.header) {
        const h = document.createElement("div");
        h.className = "prop-header-attr";
        h.textContent = f.header;
        body.appendChild(h);
      }
      if (f.type === "header") {
        const h = document.createElement("div");
        h.className = "prop-header-attr";
        h.textContent = f.label;
        continue;
      }
      const el = buildField(comp, f);
      if (el) body.appendChild(el);
    }
    // runtime debug info
    if (Editor.playing && comp.typeName === "Rigidbody") {
      const dbg = document.createElement("div");
      dbg.className = "insp-debug";
      body.appendChild(dbg);
      const update = () => {
        const v = comp.velocity, av = comp.angularVelocity;
        dbg.innerHTML =
          `Velocity&nbsp;&nbsp;&nbsp;&nbsp;(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})<br>` +
          `Angular&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(${av.x.toFixed(2)}, ${av.y.toFixed(2)}, ${av.z.toFixed(2)})<br>` +
          `Speed&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${v.magnitude.toFixed(2)}<br>` +
          `Grounded&nbsp;&nbsp;&nbsp;&nbsp;${comp._grounded ? "<span style='color:#8ec07c'>true</span>" : "false"} ` +
          `${comp._groundCollider ? "(" + comp._groundCollider.gameObject.name + ")" : ""}<br>` +
          `Sleeping&nbsp;&nbsp;&nbsp;&nbsp;${comp._sleeping}`;
      };
      update();
      liveUpdaters.push(update);
    }
    if (Editor.playing && comp.typeName === "CSScript" && comp.className === "EnemyController") {
      const dbg = document.createElement("div");
      dbg.className = "insp-debug";
      body.appendChild(dbg);
      const update = () => {
        try {
          const st = comp.GetState ? comp.GetState() : null;
          const en = CSCompiler.getEnum("EnemyState");
          dbg.textContent = "AI State    " + (en && en.__names ? en.__names[String(st)] : st);
        } catch (e) {}
      };
      update();
      liveUpdaters.push(update);
    }
  }

  function resetComponent(comp) {
    const meta = metaFor(comp);
    if (!meta) return;
    for (const f of meta.fields) {
      if (f.type === "header") continue;
      comp[f.name] = cloneFieldValue(f.default);
    }
  }
  function openScriptFor(className) {
    for (const [path, rec] of WAssets.scripts) {
      if (rec.source.includes("class " + className)) { CodeEditor.open(path); return; }
    }
  }
  function niceLabelSafe(n) { return n.replace(/([a-z0-9])([A-Z])/g, "$1 $2"); }

  /* =============== field editors =============== */
  function propRow(label) {
    const row = document.createElement("div");
    row.className = "prop-row";
    const lbl = document.createElement("div");
    lbl.className = "prop-label";
    lbl.textContent = label;
    lbl.title = label;
    const field = document.createElement("div");
    field.className = "prop-field";
    row.appendChild(lbl);
    row.appendChild(field);
    return { row, lbl, field };
  }

  function buildField(comp, f) {
    const get = () => comp[f.name];
    const set = (v) => { comp[f.name] = v; Editor.onComponentEdited(comp, f.name); };
    const label = f.label || f.name;
    switch (f.type) {
      case "float": case "int": return numberField(label, get, set, f);
      case "bool": return boolField(label, get, set);
      case "string": return stringField(label, get, set);
      case "text": return textField(label, get, set);
      case "vector3": {
        const { row } = { row: vec3Row(label, () => Vector3.from(get() || new Vector3()), (v) => set(v)) };
        return row;
      }
      case "color": return colorField(label, get, set);
      case "enum": return enumField(label, get, set, f);
      case "mesh": return selectField(label, get, set, MeshLib.names.map((n) => [n, n]));
      case "layer": return layerMaskField(label, get, set);
      case "asset": return assetField(label, get, set, f.assetKind);
      case "objectRef": return objectRefField(label, get, set, f.refKind);
      case "objectRefArray": return objectRefArrayField(label, get, set, f.refKind, comp, f);
      default: return null;
    }
  }

  function attachDrag(lbl, getNum, setNum, step) {
    lbl.classList.add("draggable");
    lbl.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startV = getNum();
      const move = (ev) => {
        const dx = ev.clientX - startX;
        setNum(startV + dx * step);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  }

  function numberField(label, get, set, f = {}) {
    const { row, lbl, field } = propRow(label);
    const isInt = f.type === "int";
    const input = document.createElement("input");
    input.type = "text";
    const fmt = (v) => isInt ? String(Math.round(v ?? 0)) : String(round3(v ?? 0));
    input.value = fmt(get());
    const commit = () => {
      let v = parseFloat(input.value);
      if (isNaN(v)) v = 0;
      if (isInt) v = Math.round(v);
      if (f.min !== undefined) v = Math.max(f.min, v);
      if (f.max !== undefined) v = Math.min(f.max, v);
      set(v);
      input.value = fmt(get());
    };
    input.onchange = commit;
    input.onkeydown = (e) => { if (e.key === "Enter") input.blur(); e.stopPropagation(); };
    if (f.slider && f.min !== undefined && f.max !== undefined) {
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = f.min; slider.max = f.max;
      slider.step = f.step || (isInt ? 1 : (f.max - f.min) / 200);
      slider.value = get() ?? 0;
      slider.oninput = () => { const v = parseFloat(slider.value); set(isInt ? Math.round(v) : v); input.value = fmt(get()); };
      field.appendChild(slider);
      input.style.width = "58px"; input.style.flex = "none";
      liveUpdaters.push(() => { if (document.activeElement !== input) { input.value = fmt(get()); slider.value = get() ?? 0; } });
    } else {
      liveUpdaters.push(() => { if (document.activeElement !== input) input.value = fmt(get()); });
    }
    attachDrag(lbl, () => parseFloat(input.value) || 0, (v) => {
      if (isInt) v = Math.round(v);
      if (f.min !== undefined) v = Math.max(f.min, v);
      if (f.max !== undefined) v = Math.min(f.max, v);
      set(round3(v)); input.value = fmt(get());
      const s = field.querySelector("input[type=range]");
      if (s) s.value = get() ?? 0;
    }, isInt ? 0.05 : (f.dragStep || 0.02));
    field.appendChild(input);
    return row;
  }

  function boolField(label, get, set) {
    const { row, field } = propRow(label);
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!get();
    cb.onchange = () => set(cb.checked);
    liveUpdaters.push(() => { cb.checked = !!get(); });
    field.appendChild(cb);
    return row;
  }

  function stringField(label, get, set) {
    const { row, field } = propRow(label);
    const input = document.createElement("input");
    input.type = "text";
    input.value = get() ?? "";
    input.onchange = () => set(input.value);
    input.onkeydown = (e) => e.stopPropagation();
    liveUpdaters.push(() => { if (document.activeElement !== input) input.value = get() ?? ""; });
    field.appendChild(input);
    return row;
  }

  function textField(label, get, set) {
    const { row, field } = propRow(label);
    row.style.alignItems = "flex-start";
    const ta = document.createElement("textarea");
    ta.style.cssText = "width:100%;min-height:44px;background:var(--well);color:var(--text-bright);border:1px solid var(--border);border-radius:3px;font-size:11px;font-family:inherit;user-select:text";
    ta.value = get() ?? "";
    ta.onchange = () => set(ta.value);
    ta.onkeydown = (e) => e.stopPropagation();
    liveUpdaters.push(() => { if (document.activeElement !== ta) ta.value = get() ?? ""; });
    field.appendChild(ta);
    return row;
  }

  function vec3Row(label, get, set) {
    const { row, lbl, field } = propRow(label);
    const inputs = {};
    for (const axis of ["x", "y", "z"]) {
      const axLbl = document.createElement("span");
      axLbl.className = "vec-lbl";
      axLbl.textContent = axis.toUpperCase();
      const input = document.createElement("input");
      input.type = "text";
      input.value = round3(get()[axis]);
      const commit = () => {
        const v = get();
        const num = parseFloat(input.value);
        v[axis] = isNaN(num) ? 0 : num;
        set(v);
        input.value = round3(get()[axis]);
      };
      input.onchange = commit;
      input.onkeydown = (e) => { if (e.key === "Enter") input.blur(); e.stopPropagation(); };
      attachDrag(axLbl, () => parseFloat(input.value) || 0, (nv) => {
        const v = get(); v[axis] = round3(nv); set(v);
        input.value = round3(get()[axis]);
      }, 0.03);
      inputs[axis] = input;
      field.appendChild(axLbl);
      field.appendChild(input);
    }
    liveUpdaters.push(() => {
      const v = get();
      for (const axis of ["x", "y", "z"]) {
        if (document.activeElement !== inputs[axis]) inputs[axis].value = round3(v[axis]);
      }
    });
    void lbl;
    return row;
  }

  function colorField(label, get, set) {
    const { row, field } = propRow(label);
    const input = document.createElement("input");
    input.type = "color";
    const cur = Color.from(get() || Color.white);
    input.value = cur.toHex();
    input.oninput = () => {
      const c = Color.fromHex(input.value);
      c.a = Color.from(get() || Color.white).a;
      set(c);
    };
    const alpha = document.createElement("input");
    alpha.type = "range"; alpha.min = 0; alpha.max = 1; alpha.step = 0.01;
    alpha.value = cur.a;
    alpha.title = "Alpha";
    alpha.style.width = "50px"; alpha.style.flex = "none";
    alpha.oninput = () => {
      const c = Color.from(get() || Color.white);
      c.a = parseFloat(alpha.value);
      set(c);
    };
    liveUpdaters.push(() => {
      const c = Color.from(get() || Color.white);
      input.value = c.toHex();
      alpha.value = c.a;
    });
    field.appendChild(input);
    field.appendChild(alpha);
    return row;
  }

  function selectField(label, get, set, pairs, transformIn, transformOut) {
    const { row, field } = propRow(label);
    const sel = document.createElement("select");
    for (const [val, text] of pairs) sel.appendChild(new Option(text, val));
    sel.value = transformIn ? transformIn(get()) : (get() ?? "");
    sel.onchange = () => set(transformOut ? transformOut(sel.value) : sel.value);
    liveUpdaters.push(() => { sel.value = transformIn ? transformIn(get()) : (get() ?? ""); });
    field.appendChild(sel);
    return row;
  }

  function enumField(label, get, set, f) {
    const values = f.optionValues || f.options.map((_, i) => i);
    const pairs = f.options.map((name, i) => [String(values[i]), name]);
    return selectField(label, get, set, pairs, (v) => String(v ?? values[0]), (v) => {
      const n = parseFloat(v);
      return isNaN(n) ? v : n;
    });
  }

  function layerMaskField(label, get, set) {
    const { row, field } = propRow(label);
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.style.cssText = "width:100%;padding:2px 8px;text-align:left;font-size:11px";
    const summary = () => {
      const m = get() || 0;
      const names = LAYERS.filter((_, i) => m & (1 << i));
      if (!names.length) return "Nothing";
      if (names.length === LAYERS.length) return "Everything";
      if (names.length <= 2) return names.join(", ");
      return "Mixed…";
    };
    btn.textContent = summary();
    btn.onclick = (e) => {
      const items = LAYERS.map((name, i) => ({
        label: `${(get() & (1 << i)) ? "✓" : "　"} ${name}`,
        keepOpen: true,
        fn: () => { set((get() || 0) ^ (1 << i)); btn.textContent = summary(); },
      }));
      items.unshift(
        { label: "Nothing", fn: () => { set(0); btn.textContent = summary(); } },
        { label: "Everything", fn: () => { set(-1 >>> 0); btn.textContent = summary(); } },
        { sep: true });
      UIKit.contextMenu(e.clientX, e.clientY, items);
    };
    field.appendChild(btn);
    return row;
  }

  function assetField(label, get, set, kind) {
    const paths = kind === "material" ? [...WAssets.materials.keys()]
      : kind === "audio" ? [...WAssets.audioClips.keys()]
      : [];
    const pairs = [["", "None"]].concat(paths.map((p) => [p, p.split("/").pop()]));
    return selectField(label, () => get() || "", (v) => set(v || null), pairs);
  }

  function objectCandidates(refKind) {
    const s = activeScene();
    const out = [["", "None"]];
    if (!s) return out;
    for (const go of s.iterate()) {
      if (refKind === "Transform" || refKind === "GameObject" || go.GetComponent(refKind)) {
        out.push([String(go.id), go.name + "  (id " + go.id + ")"]);
      }
    }
    return out;
  }
  function refToId(v) {
    if (!v || v.__destroyed) return "";
    if (v instanceof WGameObject) return String(v.id);
    if (v.gameObject) return String(v.gameObject.id);
    return "";
  }
  function idToRef(idStr, refKind) {
    if (!idStr) return null;
    const s = activeScene();
    const go = s.getById(parseInt(idStr));
    if (!go) return null;
    if (refKind === "GameObject") return go;
    if (refKind === "Transform") return go.transform;
    return go.GetComponent(refKind) || go.transform;
  }

  function objectRefField(label, get, set, refKind) {
    return selectField(label, get, set, objectCandidates(refKind),
      (v) => refToId(v), (v) => idToRef(v, refKind));
  }

  function objectRefArrayField(label, get, set, refKind, comp, f) {
    const { row, field } = propRow(label + " (" + (get() || []).length + ")");
    row.style.alignItems = "flex-start";
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;flex-direction:column;gap:3px;width:100%";
    const rebuild = () => {
      wrap.innerHTML = "";
      const arr = get() || [];
      arr.forEach((item, i) => {
        const line = document.createElement("div");
        line.style.cssText = "display:flex;gap:3px";
        const sel = document.createElement("select");
        for (const [val, text] of objectCandidates(refKind)) sel.appendChild(new Option(text, val));
        sel.value = refToId(item);
        sel.onchange = () => { const a = get(); a[i] = idToRef(sel.value, refKind); set(a); };
        const del = document.createElement("button");
        del.className = "btn"; del.textContent = "−"; del.style.padding = "0 8px";
        del.onclick = () => { const a = get(); a.splice(i, 1); set(a); rebuild(); };
        line.appendChild(sel);
        line.appendChild(del);
        wrap.appendChild(line);
      });
      const add = document.createElement("button");
      add.className = "btn"; add.textContent = "+ Add";
      add.style.alignSelf = "flex-start";
      add.onclick = () => { const a = get() || []; a.push(null); set(a); rebuild(); };
      wrap.appendChild(add);
    };
    rebuild();
    field.appendChild(wrap);
    return row;
  }

  /* =============== Add Component =============== */
  function showAddComponentMenu(e, go) {
    const items = [];
    const scriptNames = CSCompiler.allScriptClassNames();
    if (scriptNames.length) {
      items.push({ header: "Scripts" });
      for (const n of scriptNames) items.push({ label: "📜 " + n, fn: () => { go.AddComponent(n); Editor.markSceneEdited(); refresh(true); } });
    }
    const byCat = {};
    for (const def of ComponentRegistry.allTypes()) {
      (byCat[def.category || "Other"] = byCat[def.category || "Other"] || []).push(def);
    }
    for (const cat of Object.keys(byCat).sort()) {
      items.push({ header: cat });
      for (const def of byCat[cat]) {
        items.push({ label: `${def.icon} ${def.name}`, fn: () => { go.AddComponent(def.name); Editor.markSceneEdited(); refresh(true); } });
      }
    }
    UIKit.contextMenu(e.clientX, e.clientY, items, { search: true });
  }

  /* =============== asset inspectors =============== */
  function buildAsset(path) {
    const header = document.createElement("div");
    header.className = "insp-header";
    header.innerHTML = `<span class="obj-icon">${Project.iconFor(path)}</span><span style="color:#fff;font-weight:700">${path.split("/").pop()}</span>`;
    bodyEl.appendChild(header);
    const sub = document.createElement("div");
    sub.className = "insp-subheader";
    sub.innerHTML = `<span class="lbl">${path}</span>`;
    bodyEl.appendChild(sub);

    if (path.endsWith(".mat")) return buildMaterialInspector(path);
    if (path.endsWith(".cs")) {
      const { body } = section("C# Script", "📜");
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "Open in Script Editor";
      btn.onclick = () => CodeEditor.open(path);
      body.appendChild(btn);
      const pre = document.createElement("pre");
      pre.style.cssText = "margin-top:8px;background:var(--well);padding:8px;border-radius:4px;font-size:10px;max-height:400px;overflow:auto;color:#bcd;user-select:text";
      pre.textContent = (WAssets.getScript(path)?.source || "").split("\n").slice(0, 40).join("\n");
      body.appendChild(pre);
      return;
    }
    if (path.endsWith(".clip")) {
      const { body } = section("Audio Clip", "🎵");
      const def = WAssets.getAudioClip(path);
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "▶ Preview";
      btn.onclick = () => WAudio.play(def.clip, 1, 1);
      body.appendChild(btn);
      const note = document.createElement("div");
      note.className = "readonly-note";
      note.textContent = `Procedural synth patch: "${def.clip}"`;
      body.appendChild(note);
      return;
    }
    if (path.endsWith(".prefab")) {
      const { body } = section("Prefab", "📦");
      const tree = WAssets.getPrefab(path) || [];
      const info = document.createElement("div");
      info.className = "readonly-note";
      info.textContent = `${tree.length} GameObject(s)`;
      body.appendChild(info);
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "Instantiate in Scene";
      btn.onclick = () => Editor.instantiatePrefab(path, null);
      body.appendChild(btn);
      const hint = document.createElement("div");
      hint.className = "readonly-note";
      hint.textContent = "Tip: drag this prefab from the Project panel into the Scene View.";
      body.appendChild(hint);
      return;
    }
    if (path.endsWith(".png")) {
      const { body } = section("Texture", "🖼");
      const texName = WAssets.textures.get(path)?.tex;
      const preview = WRenderer.getTexturePreview(texName);
      if (preview) {
        const img = document.createElement("img");
        img.src = preview.toDataURL();
        img.style.cssText = "width:128px;height:128px;border:1px solid var(--border);border-radius:4px;image-rendering:pixelated";
        body.appendChild(img);
      }
      return;
    }
    if (path.endsWith(".scene")) {
      const { body } = section("Scene", "🎬");
      const json = WAssets.scenes.get(path);
      const info = document.createElement("div");
      info.className = "readonly-note";
      info.textContent = `${json ? json.objects.length : 0} GameObject(s). This scene is currently open.`;
      body.appendChild(info);
      return;
    }
  }

  function buildMaterialInspector(path) {
    const mat = WAssets.getMaterial(path);
    if (!mat) return;
    const { body } = section("Material", "🔮");
    const preview = document.createElement("div");
    preview.className = "insp-material-preview";
    const updatePreview = () => {
      const c = mat.color, e = mat.emission, ei = mat.emissionIntensity;
      preview.style.background = `radial-gradient(circle at 35% 30%, ${new Color(
        Math.min(1, c.r + 0.35 + e.r * ei), Math.min(1, c.g + 0.35 + e.g * ei), Math.min(1, c.b + 0.35 + e.b * ei)).toCSS()}, ${c.toCSS()} 60%, ${new Color(c.r * 0.4, c.g * 0.4, c.b * 0.4).toCSS()})`;
    };
    updatePreview();
    body.appendChild(preview);
    const fields = [
      colorField("Albedo", () => mat.color, (v) => { mat.color = Color.from(v); done(); }),
      colorField("Emission", () => mat.emission, (v) => { mat.emission = Color.from(v); done(); }),
      numberField("Emission Intensity", () => mat.emissionIntensity, (v) => { mat.emissionIntensity = v; done(); }, { min: 0, max: 4, slider: true }),
      selectField("Texture", () => mat.texture || "", (v) => { mat.texture = v || null; done(); },
        [["", "None"]].concat(WRenderer.textureNames().map((t) => [t, t]))),
      numberField("Tiling", () => mat.texScale, (v) => { mat.texScale = v; done(); }, { min: 0.1, max: 10, slider: true }),
      numberField("Specular", () => mat.specular, (v) => { mat.specular = v; done(); }, { min: 0, max: 1, slider: true }),
      numberField("Smoothness", () => mat.specPower, (v) => { mat.specPower = v; done(); }, { min: 2, max: 128, slider: true }),
      boolField("Transparent", () => mat.transparent, (v) => { mat.transparent = v; done(); }),
      numberField("Alpha", () => mat.alpha, (v) => { mat.alpha = v; done(); }, { min: 0, max: 1, slider: true }),
    ];
    function done() { updatePreview(); Editor.onMaterialEdited(path); }
    for (const f of fields) body.appendChild(f);
  }

  return { init, refresh, liveTick };
})();
