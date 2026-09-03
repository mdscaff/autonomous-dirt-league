// Procedural engine, tire and wind audio via Web Audio.
// A cross-plane V8 fires 4x per rev; the half-order (2x per rev) content gives the
// uneven exhaust burble, the noise bed through a tracking filter gives the roar.

export class EngineAudio {
  constructor() { this.ctx = null; this.muted = false; }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(ctx.destination);
    this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0.3;

    // Tone bank.
    this.oscs = [];
    const add = (type, mult, gain) => {
      const o = ctx.createOscillator(); o.type = type; const g = ctx.createGain(); g.gain.value = gain;
      o.connect(g); this.oscs.push({ o, g, mult }); o.start(); return g;
    };
    const mix = ctx.createGain();
    add('sawtooth', 4, 0.55).connect(mix);   // firing order fundamental
    add('square', 2, 0.28).connect(mix);     // half-order burble
    add('sawtooth', 1, 0.22).connect(mix);   // crank order thump
    add('sawtooth', 8, 0.15).connect(mix);   // brightness
    // Detuned copy for width/roughness.
    add('sawtooth', 4.02, 0.25).connect(mix);

    // Roar: noise through a bandpass tracking the exhaust.
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = nb.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = nb; noise.loop = true; noise.start();
    this.roarBP = ctx.createBiquadFilter(); this.roarBP.type = 'bandpass'; this.roarBP.Q.value = 1.2;
    this.roarGain = ctx.createGain(); this.roarGain.gain.value = 0.25;
    noise.connect(this.roarBP).connect(this.roarGain).connect(mix);

    // Distortion + tone shaping.
    this.shaper = ctx.createWaveShaper(); this.shaper.curve = this.makeCurve(18); this.shaper.oversample = '2x';
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 800; this.lp.Q.value = 1.1;
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 45;
    this.limGain = ctx.createGain();   // rev-limiter cut modulation
    mix.connect(this.shaper).connect(this.lp).connect(this.hp).connect(this.limGain).connect(this.engineGain).connect(this.master);

    // Tire / dirt noise.
    const tnoise = ctx.createBufferSource(); tnoise.buffer = nb; tnoise.loop = true; tnoise.start();
    this.tireLP = ctx.createBiquadFilter(); this.tireLP.type = 'lowpass'; this.tireLP.frequency.value = 900;
    this.tireGain = ctx.createGain(); this.tireGain.gain.value = 0;
    tnoise.connect(this.tireLP).connect(this.tireGain).connect(this.master);
    // Wind.
    const wnoise = ctx.createBufferSource(); wnoise.buffer = nb; wnoise.loop = true; wnoise.start();
    this.windLP = ctx.createBiquadFilter(); this.windLP.type = 'lowpass'; this.windLP.frequency.value = 350;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    wnoise.connect(this.windLP).connect(this.windGain).connect(this.master);

    this.prevThrottle = 0; this.popUntil = 0; this.limPhase = 0;
  }

  makeCurve(k) {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
    return c;
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05); }

  update(state, camMode) {
    if (!this.ctx) return;
    const c = state.car, t = this.ctx.currentTime;
    const rpm = Math.max(600, c.rpm);
    const f = rpm / 60;
    const thr = c.throttle;
    for (const x of this.oscs) x.o.frequency.setTargetAtTime(f * x.mult, t, 0.02);

    // Load: on throttle the exhaust is loud and bright; overrun is quieter with pops.
    const load = 0.35 + 0.65 * thr;
    this.lp.frequency.setTargetAtTime(500 + thr * 3200 + (rpm / 8300) * 1800, t, 0.05);
    this.roarBP.frequency.setTargetAtTime(f * 4 * 2.2, t, 0.03);
    this.roarGain.gain.setTargetAtTime(0.12 + thr * 0.35, t, 0.05);
    const dist = camMode === 3 ? 0.35 : (camMode === 2 ? 0.75 : 1.0);
    this.engineGain.gain.setTargetAtTime((0.16 + 0.22 * load + (rpm / 8300) * 0.12) * dist, t, 0.05);

    // Overrun pops: brief bursts when the throttle snaps shut at high rpm.
    if (this.prevThrottle > 0.5 && thr < 0.15 && rpm > 4500) this.popUntil = t + 0.8;
    if (t < this.popUntil && Math.random() < 0.18) {
      const g = this.ctx.createGain(); g.gain.value = 0.0;
      const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = 60 + Math.random() * 90;
      o.connect(g).connect(this.master);
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      o.start(t); o.stop(t + 0.07);
    }
    this.prevThrottle = thr;

    // Rev limiter: hard ignition cut chatter.
    if (c.limiter) {
      this.limPhase = (this.limPhase + 1) % 4;
      this.limGain.gain.setTargetAtTime(this.limPhase < 2 ? 0.15 : 1.0, t, 0.004);
    } else this.limGain.gain.setTargetAtTime(1.0, t, 0.02);

    // Tires and wind.
    const slide = Math.min(1, Math.abs(c.slip) * 2.5 + c.spin * 1.5);
    this.tireGain.gain.setTargetAtTime((0.04 * Math.min(1, c.speed / 30) + 0.30 * slide) * dist, t, 0.05);
    this.tireLP.frequency.setTargetAtTime(500 + slide * 1500 + c.speed * 15, t, 0.05);
    const w = Math.min(1, c.speed / 40);
    this.windGain.gain.setTargetAtTime(0.16 * w * w * (camMode === 1 ? 1 : 0.4), t, 0.1);
    this.windLP.frequency.setTargetAtTime(250 + w * 600, t, 0.1);
  }
}
