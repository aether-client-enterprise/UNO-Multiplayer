/* sfx.js — efeitos sonoros sintetizados via WebAudio (zero arquivos externos) */
/* linguagem: JavaScript, arquivo: js/sfx.js, runtime: navegador (Edge/Chrome) */

(function (global) {
  "use strict";

  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let enabled = localStorage.getItem("uno_sound") !== "off";

  function ensure() {
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
      // buffer de ruído branco reutilizável (papel/cartas)
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume();
    return true;
  }

  function noise(dur, type, freq, gain, sweepTo) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const flt = ctx.createBiquadFilter();
    flt.type = type || "bandpass";
    flt.frequency.setValueAtTime(freq, t);
    if (sweepTo) flt.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    flt.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.4, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone(freq, dur, type, gain, freq2, delay) {
    if (!ensure()) return;
    const t = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t);
    if (freq2) o.frequency.exponentialRampToValueAtTime(freq2, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.3, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  const Sfx = {
    get enabled() { return enabled; },
    set enabled(v) {
      enabled = v;
      localStorage.setItem("uno_sound", v ? "on" : "off");
    },
    unlock() { ensure(); },

    button() { if (!enabled) return; tone(760, 0.06, "square", 0.10); },
    invalid() { if (!enabled) return; tone(120, 0.16, "square", 0.16, 90); },
    // carta batendo na mesa
    place() {
      if (!enabled) return;
      noise(0.09, "bandpass", 1900, 0.5, 900);
      tone(190, 0.07, "triangle", 0.28, 120);
    },
    // compra / compra do baralho
    draw() {
      if (!enabled) return;
      noise(0.16, "bandpass", 1100, 0.35, 3200);
      tone(330, 0.1, "triangle", 0.14, 520);
    },
    // distribuição rápida das 7 cartas
    deal() {
      if (!enabled) return;
      for (let i = 0; i < 7; i++) {
        const d = i * 0.075;
        setTimeout(() => { noise(0.06, "bandpass", 2000, 0.3, 1200); }, d * 1000);
      }
      setTimeout(() => { tone(520, 0.1, "square", 0.14, 780); }, 620);
    },
    skip() { if (!enabled) return; tone(620, 0.09, "square", 0.2); tone(430, 0.12, "square", 0.2, null, 0.1); },
    reverse() {
      if (!enabled) return;
      tone(300, 0.22, "triangle", 0.22, 780);
      tone(780, 0.18, "triangle", 0.16, 320, 0.2);
    },
    // alerta de +2 / +4
    penalty() {
      if (!enabled) return;
      tone(880, 0.1, "sawtooth", 0.18);
      tone(740, 0.1, "sawtooth", 0.18, null, 0.13);
      tone(600, 0.16, "sawtooth", 0.18, null, 0.26);
      noise(0.3, "lowpass", 700, 0.25, 200);
    },
    // curinga: quemando a cor
    wild() {
      if (!enabled) return;
      noise(0.35, "bandpass", 500, 0.4, 4500);
      tone(220, 0.3, "sawtooth", 0.16, 900);
    },
    colorSet() { if (!enabled) return; tone(660, 0.1, "sine", 0.25); tone(990, 0.16, "sine", 0.2, null, 0.09); },
    // sua vez
    chime() { if (!enabled) return; tone(880, 0.14, "sine", 0.24); tone(1320, 0.26, "sine", 0.16, null, 0.1); },
    uno() {
      if (!enabled) return;
      tone(523, 0.12, "square", 0.2);
      tone(659, 0.12, "square", 0.2, null, 0.12);
      tone(784, 0.22, "square", 0.2, null, 0.24);
      // grito de UNO via voz do sistema
      try {
        const u = new SpeechSynthesisUtterance("UNO!");
        u.lang = "pt-BR";
        u.rate = 1.15;
        u.pitch = 0.85;
        u.volume = Math.min(1, (enabled ? 1 : 0));
        global.speechSynthesis.speak(u);
      } catch (e) { /* sem voz disponível: o arpejo acima já cobre */ }
    },
    start() {
      if (!enabled) return;
      const seq = [523, 659, 784, 1047];
      seq.forEach((f, i) => tone(f, 0.16, "square", 0.16, null, i * 0.11));
    },
    win() {
      if (!enabled) return;
      const seq = [523, 659, 784, 1047, 784, 1047, 1319];
      seq.forEach((f, i) => tone(f, 0.2, "square", 0.18, null, i * 0.12));
    },
    lose() {
      if (!enabled) return;
      const seq = [784, 659, 523, 392];
      seq.forEach((f, i) => tone(f, 0.24, "triangle", 0.2, null, i * 0.16));
    },
    join() { if (!enabled) return; tone(700, 0.1, "sine", 0.2); tone(1050, 0.18, "sine", 0.16, null, 0.1); },
    leave() { if (!enabled) return; tone(500, 0.12, "sine", 0.18); tone(320, 0.2, "sine", 0.16, null, 0.1); }
  };

  global.Sfx = Sfx;
})(window);
