/* Webity UI runtime — renders Canvas/Text/Image/Panel/Button components as DOM overlay */
"use strict";

const WUI = (() => {
  let rootEl = null;
  let elMap = new Map();   // component -> DOM element
  let lastSignature = "";
  let buttonHandler = null;
  const REF_W = 960, REF_H = 540;

  function mount(el) { rootEl = el; clear(); }
  function setButtonHandler(fn) { buttonHandler = fn; }
  function clear() {
    if (rootEl) rootEl.innerHTML = "";
    elMap = new Map();
    lastSignature = "";
  }

  function anchorCSS(anchor) {
    // returns {left, top, tx, ty} percentages and translate percents
    switch (anchor) {
      case "TopLeft": return { l: 0, t: 0, tx: 0, ty: 0 };
      case "Top": return { l: 50, t: 0, tx: -50, ty: 0 };
      case "TopRight": return { l: 100, t: 0, tx: -100, ty: 0 };
      case "Left": return { l: 0, t: 50, tx: 0, ty: -50 };
      case "Center": return { l: 50, t: 50, tx: -50, ty: -50 };
      case "Right": return { l: 100, t: 50, tx: -100, ty: -50 };
      case "BottomLeft": return { l: 0, t: 100, tx: 0, ty: -100 };
      case "Bottom": return { l: 50, t: 100, tx: -50, ty: -100 };
      case "BottomRight": return { l: 100, t: 100, tx: -100, ty: -100 };
      default: return { l: 0, t: 0, tx: 0, ty: 0 };
    }
  }

  function collectUIComponents(scene) {
    const out = [];
    for (const go of scene.iterate()) {
      if (!go.activeInHierarchy) continue;
      // must be under a Canvas
      let p = go, hasCanvas = false;
      while (p) {
        if (p.GetComponent("Canvas")) { hasCanvas = true; break; }
        p = p.transform.parent ? p.transform.parent.gameObject : null;
      }
      if (!hasCanvas) continue;
      for (const c of go.components) {
        if (c.__destroyed || !c.enabled) continue;
        const tn = c.typeName;
        if (tn === "Text" || tn === "Image" || tn === "Panel" || tn === "Button") out.push(c);
      }
    }
    return out;
  }

  function signatureOf(comps) {
    return comps.map((c) => c.gameObject.id + c.typeName).join("|");
  }

  function render(scene, interactive) {
    if (!rootEl) return;
    const comps = collectUIComponents(scene);
    const sig = signatureOf(comps) + (interactive ? "#i" : "#e");
    const w = rootEl.clientWidth || 1, h = rootEl.clientHeight || 1;
    const scale = Math.min(w / REF_W, h / REF_H) || 1;

    if (sig !== lastSignature) {
      rootEl.innerHTML = "";
      elMap = new Map();
      for (const c of comps) {
        const el = document.createElement("div");
        el.className = "wui-elem wui-" + c.typeName.toLowerCase();
        if (c.typeName === "Button" && interactive) {
          el.classList.add("wui-interactive");
          el.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            if (buttonHandler) buttonHandler(c);
          });
        }
        rootEl.appendChild(el);
        elMap.set(c, el);
      }
      lastSignature = sig;
    }

    for (const c of comps) {
      const el = elMap.get(c);
      if (!el) continue;
      updateElement(c, el, scale);
    }
  }

  function place(el, c, scale, width, height) {
    const a = anchorCSS(c.anchor || "TopLeft");
    el.style.left = a.l + "%";
    el.style.top = a.t + "%";
    el.style.transform =
      `translate(${a.tx}%, ${a.ty}%) translate(${(c.offsetX || 0) * scale}px, ${(c.offsetY || 0) * scale}px)`;
    if (width !== undefined) el.style.width = width * scale + "px";
    if (height !== undefined) el.style.height = height * scale + "px";
  }

  function updateElement(c, el, scale) {
    const tn = c.typeName;
    if (tn === "Text") {
      el.textContent = c.content ?? "";
      el.style.fontSize = (c.fontSize || 16) * scale + "px";
      el.style.color = Color.from(c.color).toCSS();
      el.style.fontWeight = c.bold ? "700" : "400";
      el.style.textAlign = (c.align || "Left").toLowerCase();
      el.style.letterSpacing = (c.letterSpacing || 0) * scale + "px";
      el.classList.add("wui-text");
      place(el, c, scale);
    } else if (tn === "Image") {
      el.style.background = Color.from(c.color).toCSS();
      el.style.borderRadius = (c.cornerRadius || 0) * scale + "px";
      place(el, c, scale, c.width, c.height);
    } else if (tn === "Panel") {
      el.style.left = "0"; el.style.top = "0";
      el.style.right = "0"; el.style.bottom = "0";
      el.style.transform = "";
      el.style.background = Color.from(c.color).toCSS();
      el.style.backdropFilter = c.blur ? "blur(4px)" : "";
    } else if (tn === "Button") {
      el.textContent = c.label ?? "Button";
      el.className = "wui-elem wui-button" + (el.classList.contains("wui-interactive") ? " wui-interactive" : "");
      el.style.fontSize = (c.fontSize || 18) * scale + "px";
      el.style.color = Color.from(c.textColor).toCSS();
      el.style.background = Color.from(c.bgColor).toCSS();
      el.style.borderRadius = 6 * scale + "px";
      el.style.fontWeight = "600";
      el.style.letterSpacing = 2 * scale + "px";
      place(el, c, scale, c.width, c.height);
    }
  }

  return { mount, render, clear, setButtonHandler };
})();
