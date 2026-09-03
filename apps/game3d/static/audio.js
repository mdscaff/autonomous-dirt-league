// Procedural engine, tire and wind audio via Web Audio.
//
// Voiced as a small-block V8: exhaust-pulse waveforms (harmonics rolling off
// fast, so it thumps instead of buzzing) at the firing order, a half-order
// layer for the cross-plane burble, a crank-order sub for chest rumble, an
// idle lope, and a resonant low-pass that opens with the throttle. A
// compressor on the master keeps it loud without clipping.

export class EngineAudio {
  constructor() { this.ctx = null; this.muted = false; this.volume = 1.0; }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12; this.comp.knee.value = 18; this.comp.ratio.value = 6;
    this.comp.attack.value = 0.004; this.comp.release.value = 0.12;
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    this.master.connect(this.comp).connect(ctx.destination);

    // Exhaust pulse wave: strong low harmonics, ~1/n^1.6 roll-off.
    const N = 40, re = new Float32Array(N), im = new Float32Array(N);
    for (let n = 1; n < N; n++) im[n] = Math.pow(n, -1.6) * (n <= 3 ? 1.25 : 1.0);
    const pulse = ctx.createPeriodicWave(re, im, { disableNormalization: false });
    const Nb = 12, reb = new Float32Array(Nb), imb = new Float32Array(Nb);
    for (let n = 1; n < Nb; n++) imb[n] = Math.pow(n, -2.2);
    const burble = ctx.createPeriodicWave(reb, imb);

    this.oscs = [];
    const mix = ctx.createGain();
    const add = (wave, mult, gain, detune = 0) => {
      const o = ctx.createOscillator();
      if (typeof wave === 'string') o.type = wave; else o.setPeriodicWave(wave);
      o.detune.value = detune;
      const g = ctx.createGain(); g.gain.value = gain;
      o.connect(g).connect(mix); o.start(); this.oscs.push({ o, g, mult });
    };
    add(pulse, 4, 0.9);            // firing order (rpm/60 * 4 for a V8)
    add(pulse, 4, 0.45, 7);        // detuned copy: width and roughness
    add(burble, 2, 0.6);           // half order: uneven cross-plane exhaust
    add('triangle', 1, 0.7);       // crank order sub, the chest thump
    add(burble, 3, 0.25);          // 1.5 order growl

    // Roar: noise through a bandpass riding the exhaust.
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = nb.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const mkNoise = () => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.start(); return s; };
    this.roarBP = ctx.createBiquadFilter(); this.roarBP.type = 'bandpass'; this.roarBP.Q.value = 0.9;
    this.roarGain = ctx.createGain(); this.roarGain.gain.value = 0.15;
    mkNoise().connect(this.roarBP).connect(this.roarGain).connect(mix);

    // Drive -> soft clip -> resonant low-pass (the "bark") -> rumble floor.
    this.drive = ctx.createGain(); this.drive.gain.value = 1.2;
    this.shaper = ctx.createWaveShaper(); this.shaper.curve = this.makeCurve(4); this.shaper.oversample = '2x';
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 500; this.lp.Q.value = 1.6;
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 32;
    this.limGain = ctx.createGain();                       // rev-limiter cut
    this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0.5;
    mix.connect(this.drive).connect(this.shaper).connect(this.lp).connect(this.hp).connect(this.limGain).connect(this.engineGain).connect(this.master);

    // Idle lope: slow amplitude wobble at half the firing rate, fades out with rpm.
    this.lfo = ctx.createOscillator(); this.lfo.type = 'sine'; this.lfo.frequency.value = 10;
    this.lfoDepth = ctx.createGain(); this.lfoDepth.gain.value = 0;
    this.lfo.connect(this.lfoDepth).connect(this.engineGain.gain); this.lfo.start();

    // Tires / dirt and wind.
    this.tireLP = ctx.createBiquadFilter(); this.tireLP.type = 'lowpass'; this.tireLP.frequency.value = 900;
    this.tireGain = ctx.createGain(); this.tireGain.gain.value = 0;
    mkNoise().connect(this.tireLP).connect(this.tireGain).connect(this.master);
    this.windLP = ctx.createBiquadFilter(); this.windLP.type = 'lowpass'; this.windLP.frequency.value = 350;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    mkNoise().connect(this.windLP).connect(this.windGain).connect(this.master);

    this.prevThrottle = 0; this.popUntil = 0; this.limPhase = 0;
  }

  makeCurve(k) {
    const n = 2048, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
    return c;
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05); }
  setVolume(v) { this.volume = Math.max(0, Math.min(2, v)); if (this.master && !this.muted) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05); }

  update(state, camMode) {
    if (!this.ctx) return;
    const c = state.car, t = this.ctx.currentTime;
    const rpm = Math.max(600, c.rpm);
    const f = rpm / 60;
    const thr = c.throttle;
    const rp = rpm / 8300;
    for (const x of this.oscs) x.o.frequency.setTargetAtTime(f * x.mult, t, 0.015);

    // Throttle opens the exhaust: brighter, harder, louder. Overrun is muffled.
    this.lp.frequency.setTargetAtTime(220 + thr * 1500 + rp * 1400, t, 0.04);
    this.lp.Q.setTargetAtTime(1.2 + thr * 1.2, t, 0.05);
    this.drive.gain.setTargetAtTime(1.0 + thr * 2.2 + rp * 0.6, t, 0.04);
    this.roarBP.frequency.setTargetAtTime(f * 4 * 1.8, t, 0.03);
    this.roarGain.gain.setTargetAtTime(0.08 + thr * 0.30, t, 0.05);
    const dist = camMode === 3 ? 0.45 : (camMode === 2 ? 0.8 : 1.0);
    this.engineGain.gain.setTargetAtTime((0.42 + 0.45 * thr + 0.25 * rp) * dist, t, 0.05);

    // Lope: strong at idle, gone above ~2800 rpm.
    const lope = Math.max(0, 1 - (rpm - 1100) / 1700);
    this.lfo.frequency.setTargetAtTime(f * 2 / 3, t, 0.05);
    this.lfoDepth.gain.setTargetAtTime(0.22 * lope, t, 0.1);

    // Overrun pops when the throttle snaps shut at high rpm.
    if (this.prevThrottle > 0.5 && thr < 0.15 && rpm > 4200) this.popUntil = t + 1.0;
    if (t < this.popUntil && Math.random() < 0.22) {
      const g = this.ctx.createGain(); const o = this.ctx.createOscillator();
      o.setPeriodicWave ? o.type = 'square' : 0; o.frequency.value = 45 + Math.random() * 70;
      o.connect(g).connect(this.master);
      g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05 + Math.random() * 0.04);
      o.start(t); o.stop(t + 0.1);
    }
    this.prevThrottle = thr;

    // Rev limiter: hard ignition cut chatter.
    if (c.limiter) {
      this.limPhase = (this.limPhase + 1) % 4;
      this.limGain.gain.setTargetAtTime(this.limPhase < 2 ? 0.1 : 1.0, t, 0.004);
    } else this.limGain.gain.setTargetAtTime(1.0, t, 0.02);

    // Tires and wind.
    const slide = Math.min(1, Math.abs(c.slip) * 2.5 + c.spin * 1.5);
    this.tireGain.gain.setTargetAtTime((0.05 * Math.min(1, c.speed / 30) + 0.30 * slide) * dist, t, 0.05);
    this.tireLP.frequency.setTargetAtTime(500 + slide * 1500 + c.speed * 15, t, 0.05);
    const w = Math.min(1, c.speed / 40);
    this.windGain.gain.setTargetAtTime(0.14 * w * w * (camMode === 1 ? 1 : 0.4), t, 0.1);
    this.windLP.frequency.setTargetAtTime(250 + w * 600, t, 0.1);
  }
}
