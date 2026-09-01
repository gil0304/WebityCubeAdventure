/* Webity — boot sequence with Unity-style project loading screen */
"use strict";

(function () {
  const steps = [
    ["Importing Assets", 18],
    ["Compiling Scripts", 42],
    ["Loading Scene", 66],
    ["Preparing Shaders", 84],
    ["Initializing Physics", 94],
    ["Opening Editor", 100],
  ];
  const stepEl = () => document.getElementById("loading-step");
  const barEl = () => document.getElementById("loading-bar-fill");

  function setStep(i) {
    const [label, pct] = steps[i];
    stepEl().textContent = label + "…";
    barEl().style.width = pct + "%";
  }

  function finish() {
    barEl().style.width = "100%";
    setTimeout(() => {
      document.getElementById("loading-screen").style.opacity = "0";
      document.getElementById("loading-screen").style.transition = "opacity .4s";
      document.getElementById("editor-root").style.display = "flex";
      setTimeout(() => { document.getElementById("loading-screen").style.display = "none"; }, 450);
    }, 250);
  }

  window.addEventListener("load", () => {
    let i = 0;
    setStep(0);
    // stagger the loading steps so the real work happens between paints
    const tick = () => {
      i++;
      if (i < steps.length) {
        setStep(i);
        if (i === steps.length - 1) {
          // real boot happens here (assets/compile/scene/renderer are all inside)
          try {
            Editor.boot();
          } catch (e) {
            stepEl().textContent = "Failed to open project: " + e.message;
            stepEl().style.color = "#e05a4e";
            console.error(e);
            return;
          }
          finish();
          return;
        }
        setTimeout(tick, 160);
      }
    };
    setTimeout(tick, 220);
  });
})();
