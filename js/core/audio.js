/* Webity Audio — WebAudio synthesized clips (no external assets) */
"use strict";

const WAudio = (() => {
  let ctx = null, master = null, sfxGain = null, bgmGain = null;
  let sfxVolume = 0.8, bgmVolume = 0.5;
  let bgmTimer = null, bgmStep = 0, bgmPlaying = false, bgmNextTime = 0;

  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
      sfxGain = ctx.createGain(); sfxGain.gain.value = sfxVolume; sfxGain.connect(master);
      bgmGain = ctx.createGain(); bgmGain.gain.value = bgmVolume; bgmGain.connect(master);
      return true;
    } catch (e) { return false; }
  }
  function unlock() { if (ensure() && ctx.state === "suspended") ctx.resume(); }
  document.addEventListener("pointerdown", unlock, true);
  document.addEventListener("keydown", unlock, true);

  function env(g, t, a, d, peak = 1, sustain = 0) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + a + d);
  }
  function osc(type, freq, t0, dur, gainNode, freqEnd) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    o.connect(gainNode); o.start(t0); o.stop(t0 + dur + 0.05);
    return o;
  }
  function tone({ type = "sine", freq = 440, freqEnd = 0, dur = 0.2, attack = 0.005, vol = 0.5, delay = 0, dest = null }) {
    const t0 = ctx.currentTime + delay;
    const g = ctx.createGain();
    env(g, t0, attack, dur, vol);
    g.connect(dest || sfxGain);
    osc(type, freq, t0, dur, g, freqEnd);
  }
  function noise({ dur = 0.2, vol = 0.3, delay = 0, freq = 1000, q = 1 }) {
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); env(g, t0, 0.005, dur, vol);
    src.connect(f); f.connect(g); g.connect(sfxGain);
    src.start(t0);
  }

  const CLIPS = {
    jump: (v, p) => { tone({ type: "square", freq: 320 * p, freqEnd: 660 * p, dur: 0.14, vol: 0.25 * v }); },
    doublejump: (v, p) => { tone({ type: "square", freq: 420 * p, freqEnd: 880 * p, dur: 0.13, vol: 0.22 * v }); },
    land: (v) => { noise({ dur: 0.08, vol: 0.18 * v, freq: 400, q: 0.7 }); },
    footstep: (v) => { noise({ dur: 0.04, vol: 0.06 * v, freq: 700, q: 1 }); },
    dash: (v) => { noise({ dur: 0.22, vol: 0.14 * v, freq: 1800, q: 0.5 }); tone({ type: "sawtooth", freq: 200, freqEnd: 90, dur: 0.2, vol: 0.1 * v }); },
    collect: (v, p) => {
      [660, 880, 1320].forEach((f, i) => tone({ type: "sine", freq: f * p, dur: 0.18, vol: 0.28 * v, delay: i * 0.07 }));
      tone({ type: "triangle", freq: 1760 * p, dur: 0.3, vol: 0.12 * v, delay: 0.2 });
    },
    damage: (v) => { tone({ type: "sawtooth", freq: 220, freqEnd: 80, dur: 0.25, vol: 0.3 * v }); noise({ dur: 0.15, vol: 0.2 * v, freq: 250, q: 0.8 }); },
    fall: (v) => { tone({ type: "sine", freq: 600, freqEnd: 100, dur: 0.5, vol: 0.25 * v }); },
    jumppad: (v) => { tone({ type: "sine", freq: 200, freqEnd: 900, dur: 0.3, vol: 0.3 * v }); tone({ type: "square", freq: 400, freqEnd: 1200, dur: 0.2, vol: 0.1 * v }); },
    checkpoint: (v) => { [523, 659, 784].forEach((f, i) => tone({ type: "triangle", freq: f, dur: 0.25, vol: 0.25 * v, delay: i * 0.09 })); },
    goal: (v) => {
      [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) =>
        tone({ type: "triangle", freq: f, dur: 0.3, vol: 0.3 * v, delay: i * 0.12 }));
    },
    gameover: (v) => { [392, 370, 349, 262].forEach((f, i) => tone({ type: "sawtooth", freq: f, dur: 0.4, vol: 0.18 * v, delay: i * 0.25 })); },
    click: (v) => { tone({ type: "sine", freq: 900, dur: 0.05, vol: 0.2 * v }); },
    enemy_alert: (v) => { tone({ type: "square", freq: 700, dur: 0.09, vol: 0.15 * v }); tone({ type: "square", freq: 700, dur: 0.09, vol: 0.15 * v, delay: 0.12 }); },
    falling_floor: (v) => { noise({ dur: 0.3, vol: 0.15 * v, freq: 180, q: 0.6 }); },
    countdown: (v) => { tone({ type: "sine", freq: 880, dur: 0.1, vol: 0.2 * v }); },
  };

  /* Simple generative BGM: bass + arpeggio, 8-step loop */
  const BGM_PATTERNS = {
    bgm_main: {
      bpm: 112,
      bass: [110, 110, 87.3, 87.3, 98, 98, 73.4, 82.4],
      arp: [[220, 277, 330], [220, 277, 330], [174.6, 220, 261.6], [174.6, 220, 261.6],
            [196, 246.9, 293.7], [196, 246.9, 293.7], [146.8, 185, 220], [164.8, 207.7, 246.9]],
    },
  };
  let bgmName = null;
  function bgmTick() {
    if (!bgmPlaying || !ctx) return;
    const pat = BGM_PATTERNS[bgmName] || BGM_PATTERNS.bgm_main;
    const stepDur = 60 / pat.bpm;
    while (bgmNextTime < ctx.currentTime + 0.35) {
      const s = bgmStep % 8;
      const t0 = bgmNextTime;
      // bass
      const bg = ctx.createGain(); env(bg, t0, 0.01, stepDur * 0.85, 0.16); bg.connect(bgmGain);
      osc("triangle", pat.bass[s], t0, stepDur * 0.9, bg);
      // arpeggio (3 notes per step)
      const chord = pat.arp[s];
      for (let i = 0; i < 3; i++) {
        const nt = t0 + (stepDur / 3) * i;
        const ag = ctx.createGain(); env(ag, nt, 0.008, stepDur / 3 * 0.9, 0.07); ag.connect(bgmGain);
        osc("square", chord[i % chord.length] * 2, nt, stepDur / 3, ag);
      }
      // hat
      if (s % 2 === 0) {
        const len = Math.floor(ctx.sampleRate * 0.03);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        const src = ctx.createBufferSource(); src.buffer = buf;
        const hf = ctx.createBiquadFilter(); hf.type = "highpass"; hf.frequency.value = 6000;
        const hg = ctx.createGain(); hg.gain.value = 0.05;
        src.connect(hf); hf.connect(hg); hg.connect(bgmGain); src.start(t0);
      }
      bgmNextTime += stepDur;
      bgmStep++;
    }
  }

  return {
    get clipNames() { return Object.keys(CLIPS).concat(Object.keys(BGM_PATTERNS)); },
    isBGM(name) { return !!BGM_PATTERNS[name]; },
    play(name, volume = 1, pitch = 1) {
      if (!ensure()) return;
      if (ctx.state === "suspended") ctx.resume();
      if (BGM_PATTERNS[name]) { this.playBGM(name); return; }
      const fn = CLIPS[name];
      if (fn) { try { fn(volume, pitch || 1); } catch (e) { /* audio glitch — ignore */ } }
    },
    playBGM(name) {
      if (!ensure()) return;
      if (bgmPlaying && bgmName === name) return;
      bgmName = name; bgmPlaying = true; bgmStep = 0;
      bgmNextTime = ctx.currentTime + 0.05;
      if (!bgmTimer) bgmTimer = setInterval(bgmTick, 80);
    },
    stopBGM() { bgmPlaying = false; if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; } },
    stopAll() { this.stopBGM(); },
    setSfxVolume(v) { sfxVolume = v; if (sfxGain) sfxGain.gain.value = v; },
    setBgmVolume(v) { bgmVolume = v; if (bgmGain) bgmGain.gain.value = v; },
    getSfxVolume() { return sfxVolume; },
    getBgmVolume() { return bgmVolume; },
    setBgmPaused(p) { if (bgmGain) bgmGain.gain.value = p ? 0 : bgmVolume; },
  };
})();
