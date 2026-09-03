// ADRL 3D client: driver's-eye view on the Phase 1 sim streamed from server.py.
import * as THREE from 'three';
import { Sky } from './vendor/Sky.js';
import { buildTrack } from './track.js';
import { buildLateModel } from './car.js';
import { Dash } from './dash.js';
import { EngineAudio } from './audio.js';
import { Dust } from './dust.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const MPH = 2.23694;
const $ = id => document.getElementById(id);

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x1a1712, 0.0035);
const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.15, 2500);
camera.up.set(0, 0, 1);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Dusk sky with a low sun; the pole lights carry the track.
const sky = new Sky(); sky.scale.setScalar(20000);
sky.material.uniforms.up.value.set(0, 0, 1);
const su = sky.material.uniforms;
su.turbidity.value = 8; su.rayleigh.value = 2.2; su.mieCoefficient.value = 0.012; su.mieDirectionalG.value = 0.85;
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 1.0), THREE.MathUtils.degToRad(250));
// setFromSphericalCoords is y-up; remap to z-up.
sunDir.set(sunDir.x, -sunDir.z, sunDir.y);
su.sunPosition.value.copy(sunDir);
scene.add(sky);

scene.add(new THREE.HemisphereLight(0x8898c8, 0x3a2a18, 0.9));
const sun = new THREE.DirectionalLight(0xffb070, 1.0);
sun.position.copy(sunDir).multiplyScalar(400);
scene.add(sun);
// Shadow key light: steeper than the sky-model sun so shadows stay short and
// readable; its tight ortho frustum follows the car for crisp contact shadows.
const key = new THREE.DirectionalLight(0xffe0c0, 0.9);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -28; key.shadow.camera.right = 28; key.shadow.camera.top = 28; key.shadow.camera.bottom = -28;
key.shadow.camera.near = 1; key.shadow.camera.far = 200; key.shadow.bias = -0.0015; key.shadow.normalBias = 0.02;
const keyOffset = new THREE.Vector3(-40, 25, 60);
scene.add(key); scene.add(key.target);

// ---------------------------------------------------------------- state
let track = null, info = null;
let car = null, ghost = null;
const dash = new Dash();
const audio = new EngineAudio();
const dust = new Dust(scene);
let state = null, prevState = null;
let camMode = 1;
let started = false;
const keys = {};
let muted = false;
const chase = { pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false };

// ---------------------------------------------------------------- network
const ws = new WebSocket(`ws://${location.hostname}:8765`);
ws.binaryType = 'arraybuffer';
ws.onmessage = ev => {
  if (ev.data instanceof ArrayBuffer) {
    if (!track) return;
    const b = new Uint8Array(ev.data);
    if (b[0] !== 1) return;
    const n = info.n_s * info.n_l;
    track.updateSurface(b.subarray(1, 1 + n), b.subarray(1 + n, 1 + 2 * n), b.subarray(1 + 2 * n, 1 + 3 * n));
    return;
  }
  const msg = JSON.parse(ev.data);
  if (msg.type === 'track') {
    info = msg;
    track = buildTrack(scene, info);
    // Two shadow-casting pole lights near the front straight; the rest are cheap.
    track.poleLights.forEach((l, i) => { if (i === 0 || i === 11) { l.castShadow = true; l.shadow.mapSize.set(1024, 1024); l.shadow.bias = -0.002; } });
    car = buildLateModel('moran99'); car.dashMaterial.map = dash.texture; car.dashMaterial.emissiveMap = dash.texture; car.dashMaterial.needsUpdate = true; scene.add(car.group);
    ghost = buildLateModel('ghost1', { ghost: true }); ghost.group.visible = false; scene.add(ghost.group);
    $('connecting').style.display = 'none';
  } else if (msg.type === 'state') {
    prevState = state; state = msg;
    if (state.title && !started) $('title').style.display = 'flex'; else $('title').style.display = 'none';
    audio.update(state, camMode);
  }
};
ws.onclose = () => {
  $('connecting').textContent = 'simulator disconnected - reconnecting...'; $('connecting').style.display = 'block';
  setTimeout(() => location.reload(), 3000);   // kiosk picks up server restarts on its own
};

function send(o) { if (ws.readyState === 1) ws.send(JSON.stringify(o)); }
// Debug handle for the console / automated checks.
window.adrl = { audio, camera, freeCam: false, get state() { return state; }, get camMode() { return camMode; }, get fps() { return fps; } };

// ---------------------------------------------------------------- input
// Some input paths deliver events without e.code; derive it from e.key.
const KEYMAP = { ' ': 'Space', Enter: 'Enter', Tab: 'Tab', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight' };
function codeOf(e) {
  if (e.code) return e.code;
  const k = e.key || '';
  if (KEYMAP[k]) return KEYMAP[k];
  if (/^[0-9]$/.test(k)) return 'Digit' + k;
  if (/^[a-zA-Z]$/.test(k)) return 'Key' + k.toUpperCase();
  return k;
}
window.addEventListener('keydown', e => {
  if (e.repeat) return;
  const code = codeOf(e);
  keys[code] = true;
  const title = state && state.title && !started;
  if (code === 'Enter' || code === 'Space' || code === 'KeyG') {
    audio.start();
    if (title) {
      started = true;
      send({ type: 'cmd', cmd: code === 'Enter' ? 'start' : (code === 'Space' ? 'watch' : 'race') });
      if (code === 'Space') camMode = 1;
      e.preventDefault(); return;
    }
    if (code === 'KeyG') send({ type: 'cmd', cmd: 'ghost' });
  }
  if (code === 'Tab') { send({ type: 'cmd', cmd: 'autopilot' }); e.preventDefault(); }
  if (code === 'KeyR') send({ type: 'cmd', cmd: 'reset' });
  if (code === 'Digit1') camMode = 1;
  if (code === 'Digit2') camMode = 2;
  if (code === 'Digit3') camMode = 3;
  if (code === 'KeyC') camMode = camMode % 3 + 1;
  if (code === 'KeyM') { muted = !muted; audio.setMuted(muted); }
  if (code === 'KeyF') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)) e.preventDefault();
});
window.addEventListener('keyup', e => { keys[codeOf(e)] = false; sendInput(); });
window.addEventListener('keydown', e => { if (!e.repeat) sendInput(); });
// Input goes out on a fixed timer, independent of rendering (rAF is throttled
// in background tabs, and the sim must never see a stale "key held" state).
setInterval(sendInput, 1000 / 30);
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function readGamepad() {
  const gp = navigator.getGamepads ? navigator.getGamepads()[0] : null;
  if (!gp) return {};
  const ax = gp.axes[0] || 0;
  const rt = gp.buttons[7] ? gp.buttons[7].value : 0, lt = gp.buttons[6] ? gp.buttons[6].value : 0;
  return { steer: Math.abs(ax) > 0.08 ? -ax : null, thr: rt > 0.05 ? rt : (gp.buttons[0] && gp.buttons[0].pressed ? 1 : null), brk: lt > 0.05 ? lt : (gp.buttons[1] && gp.buttons[1].pressed ? 1 : null) };
}

function sendInput() {
  const gp = readGamepad();
  send({ type: 'input',
    left: !!(keys.ArrowLeft || keys.KeyA), right: !!(keys.ArrowRight || keys.KeyD),
    gas: !!(keys.ArrowUp || keys.KeyW), brake: !!(keys.ArrowDown || keys.KeyS),
    steer: gp.steer ?? null, thr: gp.thr ?? null, brk: gp.brk ?? null });
}

// ---------------------------------------------------------------- pose helpers
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
function poseCar(model, c) {
  const z = track.zAt(c.s, c.d);
  const zf = track.zAt(c.s + 1.2, c.d), zr = track.zAt(c.s - 1.2, c.d);
  const zl = track.zAt(c.s, c.d + 0.8), zrgt = track.zAt(c.s, c.d - 0.8);
  const pitch = Math.atan2(zf - zr, 2.4), roll = Math.atan2(zl - zrgt, 1.6);
  model.setPose(c.x, c.y, z, c.yaw, pitch, roll);
  model.setSteer(c.steer);
}

let wheelDist = 0, lastT = performance.now() / 1000, dashAccum = 0, hudAccum = 0;
let frames = 0, fpsT = lastT, fps = 0;
let camShake = 0;

function updateCamera(dt) {
  if (window.adrl.freeCam) return;   // debug: leave the camera where a script put it
  const c = state.car;
  car.group.updateMatrixWorld();
  if (camMode === 1) {
    // Driver's eye: seated left; look into the slide, sway with lateral load, buzz with rpm.
    const latG = (c.speed * c.yaw_rate) / 9.81;
    const eye = car.eye.position;
    const eyeLocal = new THREE.Vector3(eye.x, eye.y - latG * 0.05, eye.z + Math.sin(performance.now() / 1000 * c.rpm / 60 * 2 * Math.PI) * 0.0012 * (c.rpm / 8300) * (0.4 + c.throttle));
    camShake += (Math.abs(c.slip) * 0.5 + c.spin * 0.3 - camShake) * Math.min(1, dt * 8);
    eyeLocal.y += (Math.random() - 0.5) * 0.004 * camShake; eyeLocal.z += (Math.random() - 0.5) * 0.004 * camShake;
    const eyeW = eyeLocal.applyMatrix4(car.group.matrixWorld);
    const lookYaw = -c.slip * 0.55 + c.steer * 0.35;
    const lookLocal = new THREE.Vector3(eye.x + 14 * Math.cos(lookYaw), 14 * Math.sin(lookYaw) + eye.y, eye.z - 0.45);
    const lookW = lookLocal.applyMatrix4(car.group.matrixWorld);
    camera.position.copy(eyeW); camera.lookAt(lookW);
    camera.fov = 68; camera.updateProjectionMatrix();
    car.setInteriorVisible(true);
  } else if (camMode === 2) {
    const target = v1.set(-8.5, 0.0, 3.2).applyMatrix4(car.group.matrixWorld);
    const look = v2.set(3, 0, 0.9).applyMatrix4(car.group.matrixWorld);
    if (!chase.init) { chase.pos.copy(target); chase.look.copy(look); chase.init = true; }
    chase.pos.lerp(target, Math.min(1, dt * 5)); chase.look.lerp(look, Math.min(1, dt * 9));
    chase.pos.z = Math.max(chase.pos.z, track.zAt(c.s, c.d) + 1.4);
    camera.position.copy(chase.pos); camera.lookAt(chase.look);
    camera.fov = 62; camera.updateProjectionMatrix();
    car.setInteriorVisible(true);
  } else {
    // TV camera: infield lift near turn 1, panning with the car.
    camera.position.set(38, 6, 11);
    camera.lookAt(v3.set(c.x, c.y, track.zAt(c.s, c.d) + 0.8));
    const dist = camera.position.distanceTo(v3);
    camera.fov = THREE.MathUtils.clamp(1100 / dist, 12, 45); camera.updateProjectionMatrix();
  }
  $('vignette').style.display = camMode === 1 ? 'block' : 'none';
}

function updateHud() {
  const c = state.car;
  $('speed').innerHTML = `<b>${Math.round(c.speed * MPH)}</b> mph<br><span style="color:#aaa">${Math.round(c.rpm)} rpm &middot; slip ${(c.slip * 57.3).toFixed(1)}&deg;${c.spin > 0.1 ? ' &middot; <span style="color:#ff7a5c">wheelspin</span>' : ''}</span>`;
  const gap = state.gap !== undefined ? `\ngap ${state.gap > 0 ? '+' : ''}${state.gap.toFixed(1)} m` : '';
  const gl = state.ghost_last ? `  (AI ${state.ghost_last.toFixed(2)})` : '';
  $('laps').textContent = `LAP ${c.lap + 1}   ${c.lap_time.toFixed(2)}\nlast ${state.last ? state.last.toFixed(2) : '--.--'}${gl}\nbest ${state.best ? state.best.toFixed(2) : '--.--'}${gap}\ncrashes ${state.crashes}`;
  const cc = state.condition === 'TACKY' ? '#78ff8c' : (state.condition === 'DRYING' ? '#ffc850' : '#ff6e5a');
  $('track').innerHTML = `track <span style="color:${cc}">${state.condition}</span>  mu ${c.mu.toFixed(2)}<br>${state.autopilot ? '<span class="badge">AUTOPILOT</span> ' : ''}${state.ghost_on ? '<span class="badge" style="background:#8a2a2a">GHOST</span>' : ''}${muted ? ' <span class="badge" style="background:#555">MUTED</span>' : ''}`;
  $('banner').style.display = state.banner ? 'block' : 'none'; $('banner').textContent = state.banner;
  $('status').textContent = `1/2/3 camera  TAB autopilot  G ghost  R restart  M mute  F fullscreen   ${fps.toFixed(0)} fps`;
}

// ---------------------------------------------------------------- loop
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000; const dt = Math.min(0.1, now - lastT); lastT = now;
  if (!track || !state) return;
  const c = state.car;
  poseCar(car, c);
  key.target.position.set(c.x, c.y, 0); key.position.copy(key.target.position).add(keyOffset);
  const adv = c.speed * dt; wheelDist += adv; car.advance(adv, c.spin);
  frames++; if (now - fpsT > 1) { fps = frames / (now - fpsT); frames = 0; fpsT = now; }
  if (state.ghost) { ghost.group.visible = true; poseCar(ghost, state.ghost); ghost.advance(state.ghost.speed * dt, state.ghost.spin); }
  else ghost.group.visible = false;

  // Roost off the rear tires.
  const slide = Math.max(0, c.spin * 1.2 + (Math.abs(c.slip) * 57.3 - 5) / 18);
  if (slide > 0.05 && c.speed > 3) {
    car.group.updateMatrixWorld();
    for (const i of [2, 3]) {
      const p = car.tireWorld(i, v1);
      const dirX = Math.cos(c.yaw), dirY = Math.sin(c.yaw);
      dust.emit(p, dirX, dirY, Math.min(1.5, slide) * dt * 60 / 60 * 1.0, c.speed);
    }
  }
  dust.update(dt);

  updateCamera(dt);
  dashAccum += dt; if (dashAccum > 1 / 30) { dash.update(state, now); dashAccum = 0; }
  hudAccum += dt; if (hudAccum > 1 / 10) { updateHud(); hudAccum = 0; }
  renderer.render(scene, camera);
}
frame();
