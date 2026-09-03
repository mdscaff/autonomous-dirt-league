// Procedural dirt late model. Car frame: +x forward, +y left, +z up, origin on the
// ground under the CG. Body is the classic wedge: tall straight left side, right
// side laid over, sail panels sweeping up to a full-width deck spoiler, open
// wheel arches, driver offset left.
//
// Side bodies are extruded silhouettes textured by one full-side livery canvas
// (UV = world x/z), so graphics land where they do on the real car. Roof, hood
// and spoiler graphics are decal planes with explicit orientation.
import * as THREE from 'three';

const FRONT_X = 1.27, REAR_X = -1.04, HALF_TRACK = 0.84;
const R_FRONT = 0.36, R_REAR = 0.385;
const SEAT_Y = 0.55;          // driver sits hard left
// Side panel extents (world x, z) - the livery canvas maps onto exactly this box.
const SX0 = -2.35, SX1 = 2.35, SZ0 = 0.30, SZ1 = 1.36;

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
const numberFont = px => `italic 900 ${px}px Impact, "Arial Black", "Helvetica Neue", sans-serif`;
const blockFont = px => `900 ${px}px "Arial Black", Impact, sans-serif`;
function outlined(ctx, text, x, y, fill, stroke, lw) {
  ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.strokeStyle = stroke; ctx.fillStyle = fill;
  ctx.strokeText(text, x, y); ctx.fillText(text, x, y);
}
// Fictional sponsor tile (colored rounded rect + word) - stands in for the real decals.
function tile(ctx, x, y, w, h, bg, fg, text) {
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, h * 0.18); ctx.fill();
  ctx.fillStyle = fg; ctx.font = blockFont(h * 0.55); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2 + 1);
}

// ---- livery canvases --------------------------------------------------------
// Whole side of the car. u = (x - SX0)/(SX1-SX0), v = (z - SZ0)/(SZ1-SZ0).
function sideTexture(liv, mirror) {
  const W = 2048, H = 462;
  const X = x => (x - SX0) / (SX1 - SX0) * W;          // world x -> canvas x
  const Z = z => H - (z - SZ0) / (SZ1 - SZ0) * H;      // world z -> canvas y
  return canvasTex(W, H, (ctx, w, h) => {
    if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.fillStyle = liv.body; ctx.fillRect(0, 0, w, h);
    // Cyan door field with a raked front edge, plus a swoosh up the front fender.
    ctx.fillStyle = liv.accent;
    ctx.beginPath();
    ctx.moveTo(X(-1.0), Z(1.36)); ctx.lineTo(X(0.55), Z(1.36)); ctx.lineTo(X(0.95), Z(0.62)); ctx.lineTo(X(0.75), Z(0.30));
    ctx.lineTo(X(-1.0), Z(0.30)); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(X(1.2), Z(0.30)); ctx.lineTo(X(2.35), Z(0.30)); ctx.lineTo(X(2.35), Z(0.48)); ctx.quadraticCurveTo(X(1.7), Z(0.55), X(1.35), Z(0.88));
    ctx.lineTo(X(1.15), Z(0.88)); ctx.closePath(); ctx.fill();
    // Navy rocker stripe.
    ctx.fillStyle = liv.navy; ctx.fillRect(X(-2.35), Z(0.42), X(0.75) - X(-2.35), Z(0.30) - Z(0.42));
    // The number: big, italic, white with navy outline, on the door field.
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = numberFont(300);
    outlined(ctx, liv.num, X(-0.22), Z(0.80), liv.number, liv.numberOutline, 16);
    // Driver name on the door top edge.
    ctx.font = blockFont(40); ctx.fillStyle = liv.navy; ctx.textAlign = 'left';
    ctx.fillText(liv.name.toUpperCase(), X(-0.95), Z(1.26));
    // Sponsor tiles on the rear quarter (three rows, like the real car).
    const rows = [
      [[liv.navy, '#fff', 'ADRL'], ['#111', '#fff', 'LATE MODEL'], [liv.accent, '#fff', 'DIRT']],
      [['#c8102e', '#fff', 'DOUBLE DOWN'], ['#fff', liv.navy, 'TEAM 99']],
      [['#2a2a2a', '#fff', 'OHIO'], ['#f2c400', '#111', 'SERIES'], ['#fff', '#111', 'CHASSIS']],
    ];
    let zy = 1.20;
    for (const r of rows) {
      let x = -2.25; const tw = (1.2 - 0.05 * (r.length - 1)) / r.length;
      for (const [bg, fg, txt] of r) { tile(ctx, X(x), Z(zy), X(x + tw) - X(x), Z(zy - 0.16) - Z(zy), bg, fg, txt); x += tw + 0.05; }
      zy -= 0.24;
    }
    // Small tiles on the front fender.
    tile(ctx, X(1.05), Z(1.02), X(1.75) - X(1.05), Z(0.90) - Z(1.02), '#fff', liv.navy, 'ADRL');
    tile(ctx, X(1.85), Z(0.98), X(2.3) - X(1.85), Z(0.88) - Z(0.98), liv.navy, '#fff', '99');
    // Panel rivet line along the top edge.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let x = -2.3; x < 2.3; x += 0.12) ctx.fillRect(X(x), Z(SZ1 - 0.03), 3, 3);
  });
}
function roofTexture(liv) {
  return canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = liv.body; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = liv.accent; ctx.fillRect(0, 0, w, 34);
    ctx.fillStyle = liv.navy; ctx.fillRect(0, h - 30, w, 30);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = numberFont(330);
    outlined(ctx, liv.num, w / 2, h / 2 + 10, liv.accent, liv.numberOutline, 16);
  });
}
function hoodTexture(liv) {
  return canvasTex(768, 768, (ctx, w, h) => {
    ctx.fillStyle = liv.body; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = liv.accent;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, 70); ctx.quadraticCurveTo(w / 2, 150, 0, 70); ctx.closePath(); ctx.fill();
    tile(ctx, w * 0.25, h * 0.30, w * 0.5, h * 0.11, liv.navy, '#fff', 'ADRL');
    tile(ctx, w * 0.30, h * 0.46, w * 0.4, h * 0.09, '#fff', liv.navy, 'DOUBLE DOWN');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = numberFont(170);
    outlined(ctx, liv.num, w / 2, h * 0.78, liv.accent, liv.numberOutline, 12);
  });
}
function spoilerTexture(liv) {
  return canvasTex(1024, 176, (ctx, w, h) => {
    ctx.fillStyle = liv.body; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = liv.navy; ctx.fillRect(0, h - 12, w, 12);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = blockFont(118); ctx.fillStyle = '#111';
    ctx.fillText(liv.name.toUpperCase(), w / 2, h / 2 + 2);
  });
}
function treadTexture() {
  return canvasTex(256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#1b1b1b'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2c2c2c';
    for (let x = 0; x < w; x += 16) ctx.fillRect(x, 0, 8, h);
    ctx.fillStyle = '#5a4a3a';
    for (let i = 0; i < 60; i++) ctx.fillRect(Math.random() * w, Math.random() * h, 3, 2);
  });
}

export const LIVERIES = {
  // #99 tribute: white with light-blue accents and navy trim.
  moran99: { num: '99', name: 'Moran', body: '#f5f7f9', accent: '#3fbbef', navy: '#0e2b5e',
    number: '#ffffff', numberOutline: '#0e2b5e' },
  ghost1: { num: '1', name: 'Baseline', body: '#e9e9e9', accent: '#c8102e', navy: '#222222',
    number: '#ffffff', numberOutline: '#222222' },
};

function tube(a, b, r, mat) {
  const av = new THREE.Vector3(...a), bv = new THREE.Vector3(...b);
  const len = av.distanceTo(bv);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
  m.position.copy(av).add(bv).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bv.clone().sub(av).normalize());
  m.castShadow = true;
  return m;
}

// Side silhouette in (x, z): rocker with two wheel arches, nose, hood line,
// door top, quarter rising to the spoiler, rear edge.
function sideProfile() {
  const s = new THREE.Shape();
  s.moveTo(SX0, 0.45);
  s.lineTo(-1.60, 0.45); s.lineTo(-1.56, SZ0);
  s.absarc(REAR_X, 0.40, 0.50, Math.PI, 0, true);            // rear arch (clockwise over the top)
  s.lineTo(0.72, SZ0);
  s.absarc(FRONT_X, 0.38, 0.50, Math.PI, 0, true);           // front arch
  s.lineTo(SX1, SZ0); s.lineTo(SX1, 0.60);
  s.lineTo(1.0, 0.86); s.lineTo(0.58, 0.98);                  // hood line to the cowl
  s.lineTo(0.30, 1.04); s.lineTo(-0.95, 1.06);                // door top
  s.lineTo(SX0, SZ1);                                        // quarter rising to the deck
  s.closePath();
  return s;
}

// Decal plane orientations (Euler XYZ): roof reads from the infield / TV side,
// hood from in front of the car, spoiler from behind.
const ROT = { roof: [0, 0, Math.PI], hood: [0, 0, Math.PI / 2], rear: [Math.PI / 2, -Math.PI / 2, 0] };

export function buildLateModel(livName = 'moran99', opts = {}) {
  const liv = LIVERIES[livName];
  const g = new THREE.Group();
  const paint = { metalness: 0.2, roughness: 0.42 };
  const bodyMat = new THREE.MeshStandardMaterial({ color: liv.body, ...paint });
  const accentMat = new THREE.MeshStandardMaterial({ color: liv.accent, ...paint });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.8 });
  const cageMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.7, roughness: 0.35 });
  const shadow = m => { m.castShadow = true; m.receiveShadow = true; return m; };
  const decal = (parent, w, h, tex, pos, rot) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: tex, ...paint, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.position.set(...pos); m.rotation.set(...rot); parent.add(m); return m;
  };

  // ---- side bodies ----------------------------------------------------------
  const sideMat = (mirror) => {
    const tex = sideTexture(liv, mirror);
    tex.repeat.set(1 / (SX1 - SX0), 1 / (SZ1 - SZ0)); tex.offset.set(-SX0 / (SX1 - SX0), -SZ0 / (SZ1 - SZ0));
    return new THREE.MeshStandardMaterial({ map: tex, ...paint, side: THREE.DoubleSide });
  };
  const makeSide = (left) => {
    const geo = new THREE.ExtrudeGeometry(sideProfile(), { depth: 0.04, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);                 // shape y -> world z, extrusion -> world -y
    geo.translate(0, 0, -SZ0);                // rocker at local z=0 so the lay-over pivots there
    const m = new THREE.Mesh(geo, [sideMat(left), bodyMat]);
    const grp = new THREE.Group();
    if (left) { grp.position.set(0, 0.98, SZ0); }
    else { geo.scale(1, -1, 1); grp.position.set(0, -0.94, SZ0); grp.rotation.x = 0.30; }   // right side laid over
    grp.add(shadow(m)); g.add(grp);
    return grp;
  };
  makeSide(true); makeSide(false);
  // Floor pan / rockers closing the underside between the sides.
  const pan = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.85, 0.06), darkMat); pan.position.set(0, 0.02, 0.32); g.add(shadow(pan));

  // ---- hood, cowl, nose --------------------------------------------------------
  {
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.78, 1.92, 0.04), bodyMat);
    hood.position.set(1.44, 0.02, 0.79); hood.rotation.y = 0.20;   // cowl 0.97 -> nose 0.61
    g.add(shadow(hood));
    decal(hood, 1.92, 1.78, hoodTexture(liv), [0, 0, 0.025], ROT.hood);
    const cowl = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.9, 0.05), bodyMat); cowl.position.set(0.57, 0.02, 0.97); g.add(shadow(cowl));
    // Nose valance: wide, low, cyan lower lip.
    const valance = new THREE.Mesh(new THREE.BoxGeometry(0.30, 2.0, 0.34), bodyMat); valance.position.set(2.25, 0.02, 0.42); valance.rotation.y = 0.18; g.add(shadow(valance));
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.26, 2.0, 0.10), accentMat); lip.position.set(2.30, 0.02, 0.24); g.add(shadow(lip));
    g.add(tube([2.46, -0.85, 0.30], [2.46, 0.9, 0.30], 0.025, cageMat));
    g.add(tube([2.46, -0.85, 0.30], [2.05, -0.85, 0.30], 0.02, cageMat), tube([2.46, 0.9, 0.30], [2.05, 0.9, 0.30], 0.02, cageMat));
  }

  // ---- roof, visor, sail panels ---------------------------------------------------
  {
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.30, 1.42, 0.04), [bodyMat, bodyMat, bodyMat, bodyMat, bodyMat, darkMat]);
    roof.position.set(-0.30, 0.08, 1.47); g.add(shadow(roof));
    decal(roof, 1.30, 1.42, roofTexture(liv), [0, 0, 0.025], ROT.roof);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.42, 0.03), bodyMat);
    visor.position.set(0.44, 0.08, 1.44); visor.rotation.y = 0.5; g.add(shadow(visor));
    // Sail panels: quads from the quarter top up to the roof's rear corners.
    const sail = (yq, yr) => {
      const v = new Float32Array([
        -0.95, yq, 1.06,  SX0 + 0.05, yq, SZ1,  SX0 + 0.05, yr, 1.47,
        -0.95, yq, 1.06,  SX0 + 0.05, yr, 1.47,  -0.95, yr, 1.47,
      ]);
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(v, 3)); geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: liv.body, ...paint, side: THREE.DoubleSide }));
      g.add(shadow(m));
    };
    sail(0.96, 0.76); sail(-0.92, -0.62);
    // Rear filler panel between the sails under the roof (dark, open-looking).
    const filler = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.4, 0.36), darkMat); filler.position.set(-0.98, 0.05, 1.26); g.add(filler);
  }

  // ---- deck + spoiler -------------------------------------------------------------
  {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.95, 0.04), bodyMat);
    deck.position.set(-1.65, 0.02, 1.20); deck.rotation.y = 0.19; g.add(shadow(deck));   // quarter top 1.06 -> 1.36
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.05, 0.36), bodyMat);
    sp.position.set(-2.32, 0.02, 1.50); sp.rotation.y = -0.70; g.add(shadow(sp));
    decal(sp, 2.05, 0.36, spoilerTexture(liv), [-0.02, 0, 0], ROT.rear);
    for (const y of [-0.99, 1.03]) {
      const brd = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.03, 0.36), bodyMat);
      brd.position.set(-2.18, y, 1.47); brd.rotation.y = -0.30; g.add(shadow(brd));
    }
    // Rear bumper tubes below the open tail.
    g.add(tube([-2.40, -0.9, 0.42], [-2.40, 0.95, 0.42], 0.025, cageMat));
    g.add(tube([-2.40, -0.9, 0.42], [-2.0, -0.9, 0.42], 0.02, cageMat), tube([-2.40, 0.95, 0.42], [-2.0, 0.95, 0.42], 0.02, cageMat));
  }

  // ---- roll cage ------------------------------------------------------------------
  {
    const A = [[0.62, 0.78, 0.97], [0.62, -0.62, 0.97]], Ar = [[0.30, 0.72, 1.45], [0.30, -0.58, 1.45]];
    const B = [[-1.0, 0.78, 1.0], [-1.0, -0.62, 1.0]], Br = [[-0.95, 0.72, 1.45], [-0.95, -0.58, 1.45]];
    const r = 0.022;
    g.add(tube(A[0], Ar[0], r, cageMat), tube(A[1], Ar[1], r, cageMat), tube(B[0], Br[0], r, cageMat), tube(B[1], Br[1], r, cageMat));
    g.add(tube(Ar[0], Br[0], r, cageMat), tube(Ar[1], Br[1], r, cageMat), tube(Ar[0], Ar[1], r, cageMat), tube(Br[0], Br[1], r, cageMat));
    for (const z of [0.55, 0.75]) g.add(tube([0.6, 0.86, z], [-1.0, 0.86, z], r * 0.9, cageMat));  // driver-side door bars
    g.add(tube(Ar[0], [0.62, 0.74, 0.97], r * 0.8, cageMat), tube(Ar[1], [0.62, -0.60, 0.97], r * 0.8, cageMat));  // dash bars
    // Windshield bars (the real car runs three), placed off the driver's eye line.
    for (const y of [0.12, -0.30]) g.add(tube([0.60, y, 0.98], [0.32, y, 1.45], r * 0.7, cageMat));
    const net = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.4), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.16, side: THREE.DoubleSide }));
    net.position.set(-0.2, 0.86, 1.22); net.rotation.x = Math.PI / 2; g.add(net);
  }

  // ---- interior: seat, wheel, column, dash - all on the driver's (left) side ----
  const interior = new THREE.Group();
  {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.55), darkMat); seat.position.set(-0.45, SEAT_Y, 0.62); interior.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.75), darkMat); back.position.set(-0.7, SEAT_Y, 1.0); interior.add(back);
    const halo = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.34), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    halo.position.set(-0.55, SEAT_Y, 1.28); interior.add(halo);
  }
  // Steering wheel: raked so the top leans away from the driver; the column runs
  // forward and down into the firewall. Rake and steering are separate groups so
  // the wheel spins about its own column axis.
  const wheelRake = new THREE.Group();
  wheelRake.position.set(0.40, SEAT_Y, 1.02);
  wheelRake.rotation.y = 0.55;
  const wheelPivot = new THREE.Group();
  wheelRake.add(wheelPivot);
  {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.016, 10, 32), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7 }));
    rim.rotation.y = Math.PI / 2; wheelPivot.add(rim);
    for (const a of [0, 2.094, 4.189]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.02), cageMat);
      sp.position.set(0, Math.cos(a) * 0.085, Math.sin(a) * 0.085); sp.rotation.x = a; wheelPivot.add(sp);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 12), cageMat); hub.rotation.z = Math.PI / 2; wheelPivot.add(hub);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), cageMat);
    column.rotation.z = Math.PI / 2; column.position.x = 0.25; wheelRake.add(column);
  }
  interior.add(wheelRake);
  const dashMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.55 });
  const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.13), dashMaterial);
  dash.position.set(0.90, SEAT_Y + 0.02, 1.09);
  dash.lookAt(dash.position.x - 1, dash.position.y, dash.position.z);
  dash.rotateX(-0.5);
  interior.add(dash);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.17, 0.02), darkMat);
  bezel.position.copy(dash.position); bezel.quaternion.copy(dash.quaternion); bezel.translateZ(-0.012);
  interior.add(bezel);
  g.add(interior);

  // ---- wheels ---------------------------------------------------------------------
  const tread = treadTexture(); tread.wrapS = THREE.RepeatWrapping; tread.repeat.set(6, 1);
  const tireMat = new THREE.MeshStandardMaterial({ map: tread, roughness: 0.95 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.75, roughness: 0.3 });
  const wheels = [];
  function makeWheel(x, y, r, w, steerable) {
    const pivot = new THREE.Group(); pivot.position.set(x, y, r);
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 28), tireMat); tire.castShadow = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.6, w * 1.02, 16), rimMat);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.2, r * 0.2, w * 1.08, 12), darkMat);
    spin.add(tire, rim, cap); pivot.add(spin); g.add(pivot);
    wheels.push({ pivot, spin, r, steerable });
  }
  makeWheel(FRONT_X, HALF_TRACK + 0.02, R_FRONT, 0.28, true);
  makeWheel(FRONT_X, -HALF_TRACK - 0.02, R_FRONT, 0.28, true);
  makeWheel(REAR_X, HALF_TRACK + 0.06, R_REAR, 0.38, false);
  makeWheel(REAR_X, -HALF_TRACK - 0.14, R_REAR, 0.38, false);   // right-rear offset out

  // Driver's-eye anchor: seated left, helmet just under the roof.
  const eye = new THREE.Object3D(); eye.position.set(-0.05, SEAT_Y, 1.19); g.add(eye);

  let wheelAngle = 0;
  const api = {
    group: g, eye, wheelPivot, dashMaterial, interior,
    setPose(x, y, z, yaw, pitch = 0, roll = 0) {
      g.position.set(x, y, z);
      g.rotation.set(roll, -pitch, yaw, 'ZYX');
    },
    setSteer(steerRad) {
      for (const w of wheels) if (w.steerable) w.pivot.rotation.z = steerRad;
      wheelPivot.rotation.x = -steerRad * 8.0;   // ~ +-180 deg of wheel for full lock
    },
    advance(dist, spinExtra) {
      wheelAngle += dist / R_REAR;
      for (const w of wheels) w.spin.rotation.y = -(wheelAngle * (w.steerable ? 1 : 1 + spinExtra * 0.9)) % (Math.PI * 2);
    },
    setInteriorVisible(v) { interior.visible = v; },
    tireWorld(i, target) {
      const w = wheels[i];
      return target.set(w.pivot.position.x, w.pivot.position.y, 0).applyMatrix4(g.matrixWorld);
    },
  };
  if (opts.ghost) g.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const clones = mats.map(m => { const c = m.clone(); c.transparent = true; c.opacity = 0.55; return c; });
    o.material = Array.isArray(o.material) ? clones : clones[0];
  });
  return api;
}
