/* Webity Input system — keyboard state, Unity-style axes & buttons */
"use strict";

const WInput = (() => {
  const down = new Set();      // currently held (normalized names)
  const pressed = new Set();   // went down this frame
  const released = new Set();  // went up this frame
  const pendingDown = new Set(), pendingUp = new Set();
  const axes = { Horizontal: 0, Vertical: 0 };
  const axesRaw = { Horizontal: 0, Vertical: 0 };
  let captureGame = false;     // when true, game consumes keys (prevents editor/browser default)
  let anyKeyDownFrame = false, pendingAnyKey = false;

  const KEYMAP = {
    " ": "Space", "ArrowUp": "UpArrow", "ArrowDown": "DownArrow",
    "ArrowLeft": "LeftArrow", "ArrowRight": "RightArrow",
    "Escape": "Escape", "Enter": "Return", "Shift": "LeftShift",
    "Control": "LeftControl", "Alt": "LeftAlt", "Tab": "Tab", "Backspace": "Backspace",
  };
  function normKey(e) {
    let k = e.key;
    if (KEYMAP[k]) return KEYMAP[k];
    if (k.length === 1) {
      const u = k.toUpperCase();
      if (u >= "A" && u <= "Z") return u;
      if (u >= "0" && u <= "9") return "Alpha" + u;
    }
    return k;
  }

  const GAME_KEYS = new Set(["Space", "UpArrow", "DownArrow", "LeftArrow", "RightArrow",
    "W", "A", "S", "D", "R", "LeftShift", "E", "Q", "Tab"]);

  function onKeyDown(e) {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable)) return;
    const k = normKey(e);
    if (captureGame && GAME_KEYS.has(k)) e.preventDefault();
    if (!down.has(k)) { pendingDown.add(k); pendingAnyKey = true; }
    down.add(k);
  }
  function onKeyUp(e) {
    const k = normKey(e);
    down.delete(k);
    pendingUp.add(k);
  }
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", () => { down.clear(); });

  function newFrame(dt) {
    pressed.clear(); released.clear();
    for (const k of pendingDown) pressed.add(k);
    for (const k of pendingUp) released.add(k);
    pendingDown.clear(); pendingUp.clear();
    anyKeyDownFrame = pendingAnyKey; pendingAnyKey = false;

    // axes
    const h = (has("D") || has("RightArrow") ? 1 : 0) - (has("A") || has("LeftArrow") ? 1 : 0);
    const v = (has("W") || has("UpArrow") ? 1 : 0) - (has("S") || has("DownArrow") ? 1 : 0);
    axesRaw.Horizontal = h; axesRaw.Vertical = v;
    const speed = 8 * (dt || 0.016);
    for (const [name, target] of [["Horizontal", h], ["Vertical", v]]) {
      let cur = axes[name];
      if (target === 0) cur = Mathf.MoveTowards(cur, 0, speed * 1.6);
      else cur = Mathf.MoveTowards(cur, target, speed);
      axes[name] = Mathf.Clamp(cur, -1, 1);
    }
  }
  function has(k) { return captureGame && down.has(k); }

  const BUTTONS = {
    Jump: ["Space"],
    Dash: ["LeftShift"],
    Submit: ["Return"],
    Cancel: ["Escape"],
    Fire1: ["LeftControl"],
  };
  function keysFor(btn) { return BUTTONS[btn] || [btn]; }

  return {
    newFrame,
    setCapture(v) { captureGame = v; if (!v) { axes.Horizontal = 0; axes.Vertical = 0; } },
    get capturing() { return captureGame; },
    clearFrame() { pressed.clear(); released.clear(); anyKeyDownFrame = false; },
    GetAxis(name) { return captureGame ? (axes[name] || 0) : 0; },
    GetAxisRaw(name) { return captureGame ? (axesRaw[name] || 0) : 0; },
    GetKey(k) { return captureGame && down.has(k); },
    GetKeyDown(k) { return captureGame && pressed.has(k); },
    GetKeyUp(k) { return captureGame && released.has(k); },
    GetButton(b) { return captureGame && keysFor(b).some((k) => down.has(k)); },
    GetButtonDown(b) { return captureGame && keysFor(b).some((k) => pressed.has(k)); },
    GetButtonUp(b) { return captureGame && keysFor(b).some((k) => released.has(k)); },
    get anyKeyDown() { return captureGame && anyKeyDownFrame; },
    get anyKey() { return captureGame && down.size > 0; },
    rawKeyDown(k) { return pressed.has(k); }, // editor-side, ignores capture
    rawKeyHeld(k) { return down.has(k); },
  };
})();
