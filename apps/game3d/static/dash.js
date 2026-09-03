// Dash gauges rendered to a canvas texture: tach with shift lights, water temp,
// oil pressure, fuel pressure, volts, plus a small lap readout.
import * as THREE from 'three';

export class Dash {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024; this.canvas.height = 282;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.waterTemp = 118; this.oilTemp = 110;
    this.lastT = 0;
    this.blink = 0;
  }

  gauge(cx, cy, r, value, min, max, label, unit, opts = {}) {
    const ctx = this.ctx;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#0d0d0d'; ctx.fill();
    ctx.lineWidth = r * 0.08; ctx.strokeStyle = '#3a3a3a'; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2); ctx.fillStyle = '#f4f1e6'; ctx.fill();
    if (opts.redFrom !== undefined) {
      const ar = a0 + (a1 - a0) * (opts.redFrom - min) / (max - min);
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.82, ar, a1); ctx.lineWidth = r * 0.10; ctx.strokeStyle = '#d0202a'; ctx.stroke();
    }
    const ticks = opts.ticks || 10;
    for (let i = 0; i <= ticks; i++) {
      const a = a0 + (a1 - a0) * i / ticks;
      const major = i % (opts.majorEvery || 1) === 0;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * (major ? 0.70 : 0.78), cy + Math.sin(a) * r * (major ? 0.70 : 0.78));
      ctx.lineTo(cx + Math.cos(a) * r * 0.86, cy + Math.sin(a) * r * 0.86);
      ctx.lineWidth = major ? r * 0.035 : r * 0.02; ctx.strokeStyle = '#111'; ctx.stroke();
      if (major && opts.labelTicks) {
        const v = min + (max - min) * i / ticks;
        ctx.fillStyle = '#111'; ctx.font = `bold ${r * 0.17}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(opts.labelTicks(v), cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55);
      }
    }
    ctx.fillStyle = '#222'; ctx.font = `bold ${r * 0.16}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy + r * 0.35);
    ctx.font = `${r * 0.12}px Arial`; ctx.fillText(unit, cx, cy + r * 0.5);
    const f = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const a = a0 + (a1 - a0) * f;
    ctx.beginPath(); ctx.moveTo(cx - Math.cos(a) * r * 0.12, cy - Math.sin(a) * r * 0.12);
    ctx.lineTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8);
    ctx.lineWidth = r * 0.045; ctx.strokeStyle = '#e0301e'; ctx.lineCap = 'round'; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.09, 0, Math.PI * 2); ctx.fillStyle = '#222'; ctx.fill();
    ctx.restore();
  }

  update(state, tNow) {
    const c = state.car;
    const dt = Math.min(0.2, tNow - this.lastT); this.lastT = tNow;
    // Slow thermal model: warms with load, settles ~195-210F under race pace.
    const target = 150 + c.throttle * 55 + Math.min(1, c.speed / 35) * 12;
    this.waterTemp += (target - this.waterTemp) * dt / 25;
    const oilP = 18 + (c.rpm / 8300) * 62;
    const fuelP = 6.5 + c.throttle * 1.8;
    const volts = 13.9 - c.rpm / 8300 * 0.3;

    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#242424'; ctx.fillRect(0, 0, W, 46);
    // Shift lights: 8 LEDs, progressive from 6200, all-flash at the limiter.
    this.blink += dt * 14;
    for (let i = 0; i < 8; i++) {
      const on = c.limiter ? Math.floor(this.blink) % 2 === 0 : c.rpm > 6200 + i * 225;
      const col = i < 3 ? '#2fd34a' : (i < 6 ? '#ffc21c' : '#ff2a2a');
      ctx.beginPath(); ctx.arc(230 + i * 72, 23, 13, 0, Math.PI * 2);
      ctx.fillStyle = on ? col : '#2a2a2a'; ctx.fill();
      if (on) { ctx.shadowColor = col; ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0; }
    }
    this.gauge(210, 160, 108, c.rpm, 0, 9000, 'TACH', 'RPM x1000', { redFrom: 7800, ticks: 9, labelTicks: v => String(v / 1000) });
    this.gauge(455, 160, 72, this.waterTemp, 100, 260, 'WATER', '°F', { redFrom: 230, ticks: 8, majorEvery: 2, labelTicks: v => String(Math.round(v)) });
    this.gauge(615, 160, 72, oilP, 0, 100, 'OIL', 'PSI', { ticks: 10, majorEvery: 2, labelTicks: v => String(Math.round(v)) });
    this.gauge(775, 160, 72, fuelP, 0, 15, 'FUEL', 'PSI', { ticks: 15, majorEvery: 5, labelTicks: v => String(Math.round(v)) });
    this.gauge(935, 160, 60, volts, 8, 18, 'VOLTS', 'V', { ticks: 10, majorEvery: 2, labelTicks: v => String(Math.round(v)) });
    // Digital strip.
    ctx.fillStyle = '#0b0b0b'; ctx.fillRect(40, 236, 944, 38);
    ctx.fillStyle = '#7dff8a'; ctx.font = 'bold 26px "DejaVu Sans Mono", Menlo, monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const mph = Math.round(c.speed * 2.23694);
    const last = state.last ? state.last.toFixed(2) : '--.--';
    ctx.fillText(`${String(mph).padStart(3)} MPH   LAP ${c.lap + 1}   ${c.lap_time.toFixed(2)}   LAST ${last}   ${c.gear}`, 60, 255);
    ctx.textAlign = 'right'; ctx.fillStyle = c.spin > 0.15 ? '#ff5a3c' : '#7dff8a';
    ctx.fillText(`${Math.round(c.rpm)}`, 970, 255);
    this.texture.needsUpdate = true;
  }
}
