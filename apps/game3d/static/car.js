// Procedural dirt super late model. Car frame: +x forward, +y left, +z up, origin on
// the ground under the CG. Proportions follow a modern late model: ~4.75 m long,
// 2 m wide, roof ~1.2 m, skirts ~12 cm off the ground, wedge nose with chamfered
// corners, fender humps over the front tires with the hood dished between them,
// flat interior decking with a driver's tub on the left, sail panels running from
// the roof to the ends of an 8" spoiler, right-rear tire hanging out of the body.
//
// Side bodies are extruded silhouettes textured by one full-side livery canvas
// (UV = world x/z). Everything else is flat sheet-metal panels, like the real car.
import * as THREE from 'three';

const FRONT_X = 1.36, REAR_X = -1.20;          // visual axles (a bit longer than the physics wheelbase)
const R_FRONT = 0.345, R_REAR = 0.37;
const SEAT_Y = 0.55;                           // driver sits hard left
const SX0 = -2.35, SX1 = 2.30, SZ0 = 0.10, SZ1 = 1.02;   // side livery canvas maps onto this box
const SKIRT = 0.12, YL = 0.985, LEAN = 0.10;   // left side is vertical, right side leans in
const yR = z => -(0.99 - (z - SKIRT) * Math.tan(LEAN));   // right body edge at height z
// Top line of the body sides, nose -> cowl (shared by the side profile and the fender tops).
const FENDER = [[2.30, 0.40], [1.85, 0.62], [1.36, 0.80], [0.95, 0.85], [0.55, 0.88]];
const HOOD_X0 = 2.45, HOOD_Z0 = 0.36, HOOD_X1 = 0.55, HOOD_Z1 = 0.87, FEN_IN = 0.62;
const hoodZ = x => HOOD_Z0 + (HOOD_X0 - x) * (HOOD_Z1 - HOOD_Z0) / (HOOD_X0 - HOOD_X1);

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
function tile(ctx, x, y, w, h, bg, fg, text, flip = false) {
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, h * 0.18); ctx.fill();
  ctx.fillStyle = fg; ctx.font = blockFont(h * 0.55); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.save(); ctx.translate(x + w / 2, y + h / 2 + 1); if (flip) ctx.scale(-1, 1); ctx.fillText(text, 0, 0); ctx.restore();
}

// ---- livery canvases --------------------------------------------------------
// Whole side of the car in world coordinates. Shapes are drawn where they sit on
// the body; on the left side only the glyphs are flipped (that side is seen mirrored).
function sideTexture(liv, flip) {
  const W = 2048, H = Math.round(2048 * (SZ1 - SZ0) / (SX1 - SX0));
  const X = x => (x - SX0) / (SX1 - SX0) * W;
  const Z = z => H - (z - SZ0) / (SZ1 - SZ0) * H;
  return canvasTex(W, H, (ctx) => {
    const poly = (pts, fill) => { ctx.fillStyle = fill; ctx.beginPath(); pts.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z)))); ctx.closePath(); ctx.fill(); };
    const T = (x0, z0, x1, z1, bg, fg, txt) => tile(ctx, X(x0), Z(z1), X(x1) - X(x0), Z(z0) - Z(z1), bg, fg, txt, flip);
    poly([[SX0, SZ0], [SX1, SZ0], [SX1, SZ1], [SX0, SZ1]], liv.body);
    // Accent bands above and below the door, raked ends; navy panel behind the number.
    poly([[-1.13, 0.80], [0.92, 0.80], [1.00, SZ1], [-1.05, SZ1]], liv.accent);
    poly([[-0.85, SZ0], [1.02, SZ0], [1.08, 0.27], [-0.79, 0.27]], liv.accent);
    poly([[-0.74, 0.30], [0.80, 0.30], [0.90, 0.77], [-0.64, 0.77]], liv.navy);
    // Accent wedge at the tail and a swoosh ahead of the front wheel.
    poly([[SX0, SZ1], [-1.55, SZ1], [-1.75, 0.93], [SX0, 0.80]], liv.accent);
    poly([[1.78, SZ0], [SX1, SZ0], [SX1, 0.30], [1.95, 0.22]], liv.accent);
    // The number.
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = numberFont(H * 0.62);
    ctx.save(); ctx.translate(X(0.08), Z(0.53)); if (flip) ctx.scale(-1, 1);
    outlined(ctx, liv.num, 0, 0, liv.number, liv.accent, 18); ctx.restore();
    // Driver name on the top band.
    ctx.font = blockFont(H * 0.085); ctx.fillStyle = liv.navy;
    ctx.save(); ctx.translate(X(-0.05), Z(0.855)); if (flip) ctx.scale(-1, 1); ctx.fillText(liv.name.toUpperCase(), 0, 0); ctx.restore();
    // Sponsor-style tiles: behind the rear wheel and ahead of the front wheel.
    T(-2.30, 0.66, -1.72, 0.78, liv.navy, '#fff', 'ADRL');
    T(-2.30, 0.50, -1.72, 0.62, '#c8102e', '#fff', 'DOUBLE DOWN');
    T(-2.30, 0.36, -1.72, 0.46, '#1d1d1d', '#fff', 'LATE MODEL');
    T(-1.62, 0.85, -0.80, 0.92, '#fff', liv.navy, 'TEAM 99');
    T(1.80, 0.34, 2.26, 0.44, liv.navy, '#fff', 'ADRL');
    // Rivet lines.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let x = SX0 + 0.05; x < SX1; x += 0.12) { ctx.fillRect(X(x), Z(SKIRT + 0.025), 3, 3); }
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
  return canvasTex(512, 800, (ctx, w, h) => {
    ctx.fillStyle = liv.body; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = liv.accent;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, 60); ctx.quadraticCurveTo(w / 2, 130, 0, 60); ctx.closePath(); ctx.fill();
    tile(ctx, w * 0.2, h * 0.44, w * 0.6, h * 0.085, liv.navy, '#fff', 'ADRL');
    tile(ctx, w * 0.25, h * 0.55, w * 0.5, h * 0.06, '#fff', liv.navy, 'DOUBLE DOWN');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = numberFont(170);
    outlined(ctx, liv.num, w / 2, h * 0.80, liv.accent, liv.numberOutline, 12);
  });
}
function spoilerTexture(liv) {
  return canvasTex(1024, 128, (ctx, w, h) => {
    ctx.fillStyle = liv.body; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = liv.navy; ctx.fillRect(0, h - 10, w, 10);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = blockFont(92); ctx.fillStyle = '#111';
    ctx.fillText(liv.name.toUpperCase(), w / 2, h / 2);
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

// Flat sheet-metal panel from a list of [x,y,z] corners (triangle fan).
function panel(pts, mat) {
  const v = [];
  for (let i = 1; i < pts.length - 1; i++) v.push(...pts[0], ...pts[i], ...pts[i + 1]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
  return m;
}

// Side silhouette in (x, z): skirt with two wheel openings, nose, fender hump,
// door top, quarter rising to the deck, kicked-up tail.
function sideProfile() {
  const s = new THREE.Shape();
  const arch = (cx, cz, r) => { const phi = Math.asin((cz - SKIRT) / r); s.absarc(cx, cz, r, Math.PI + phi, -phi, true); };
  s.moveTo(SX0, 0.36); s.lineTo(-1.68, 0.30);
  arch(REAR_X, R_REAR, 0.45);
  arch(FRONT_X, R_FRONT, 0.40);
  s.lineTo(2.18, SKIRT); s.lineTo(SX1, 0.15);
  for (const [x, z] of FENDER) s.lineTo(x, z);
  s.lineTo(-0.85, 0.925); s.lineTo(SX0, 1.0);
  s.closePath();
  return s;
}

function tireGeometry(R, w) {
  const h = w / 2;
  const pts = [[0.58, -0.92], [0.80, -1], [0.93, -0.94], [0.985, -0.80], [1, -0.55], [1, 0.55], [0.985, 0.80], [0.93, 0.94], [0.80, 1], [0.58, 0.92]]
    .map(([r, a]) => new THREE.Vector2(r * R, a * h));
  return new THREE.LatheGeometry(pts, 36);      // axis = local y = the axle
}

// Decal plane orientations (Euler XYZ): roof reads from the infield / TV side,
// hood from in front of the car, spoiler from behind.
const ROT = { roof: [0, 0, Math.PI], hood: [0, 0, Math.PI / 2], rear: [Math.PI / 2, -Math.PI / 2, 0] };

export function buildLateModel(livName = 'moran99', opts = {}) {
  const liv = LIVERIES[livName];
  const g = new THREE.Group();
  const paint = { metalness: 0.2, roughness: 0.42 };
  const D = THREE.DoubleSide;
  const bodyMat = new THREE.MeshStandardMaterial({ color: liv.body, ...paint, side: D });
  const accentMat = new THREE.MeshStandardMaterial({ color: liv.accent, ...paint, side: D });
  const alumMat = new THREE.MeshStandardMaterial({ color: 0xc4c7cb, metalness: 0.25, roughness: 0.5, side: D });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.8, side: D });
  const cageMat = new THREE.MeshStandardMaterial({ color: 0x3c3c40, metalness: 0.6, roughness: 0.4 });
  const shadow = m => { m.castShadow = true; m.receiveShadow = true; return m; };
  const add = (...ms) => { for (const m of ms) g.add(m); };
  const decal = (parent, w, h, tex, pos, rot) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: tex, ...paint, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.position.set(...pos); m.rotation.set(...rot); parent.add(m); return m;
  };

  // ---- body sides -------------------------------------------------------------
  const makeSide = (left) => {
    const tex = sideTexture(liv, left);
    tex.repeat.set(1 / (SX1 - SX0), 1 / (SZ1 - SZ0)); tex.offset.set(-SX0 / (SX1 - SX0), -SZ0 / (SZ1 - SZ0));
    const geo = new THREE.ExtrudeGeometry(sideProfile(), { depth: 0.03, bevelEnabled: false, curveSegments: 20 });
    geo.rotateX(Math.PI / 2);                 // shape y -> world z, extrusion -> world -y
    geo.translate(0, 0, -SKIRT);              // skirt at local z=0 so the lean pivots there
    if (!left) geo.scale(1, -1, 1);
    const grp = new THREE.Group();
    grp.position.set(0, left ? 0.99 : -0.99, SKIRT);
    if (!left) grp.rotation.x = -LEAN;        // top leans inboard
    grp.add(shadow(new THREE.Mesh(geo, [new THREE.MeshStandardMaterial({ map: tex, ...paint, side: D }), bodyMat])));
    const liner = new THREE.ExtrudeGeometry(sideProfile(), { depth: 0.004, bevelEnabled: false, curveSegments: 20 });
    liner.rotateX(Math.PI / 2); liner.translate(0, -0.032, -SKIRT); if (!left) liner.scale(1, -1, 1);
    grp.add(new THREE.Mesh(liner, alumMat));
    g.add(grp);
  };
  makeSide(true); makeSide(false);

  // ---- nose, hood, fender humps -------------------------------------------------
  {
    const L = Math.hypot(HOOD_X0 - HOOD_X1, HOOD_Z1 - HOOD_Z0);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(L, FEN_IN * 2, 0.02), bodyMat);
    hood.position.set((HOOD_X0 + HOOD_X1) / 2, 0, (HOOD_Z0 + HOOD_Z1) / 2 - 0.01);
    hood.rotation.y = Math.atan2(HOOD_Z1 - HOOD_Z0, HOOD_X0 - HOOD_X1);
    g.add(shadow(hood));
    decal(hood, FEN_IN * 2, L, hoodTexture(liv), [0, 0, 0.012], ROT.hood);
    // Air-cleaner box at the back of the hood.
    const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.40, 0.09), bodyMat); scoop.position.set(-L / 2 + 0.42, 0, 0.05); hood.add(shadow(scoop));
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.34, 0.06), darkMat); mouth.position.set(-L / 2 + 0.64, 0, 0.05); hood.add(mouth);
    // Fender tops and their inner walls down to the hood. Front station is chamfered.
    for (const side of [1, -1]) {
      const yo = z => (side > 0 ? YL : yR(z)), yi = side * FEN_IN;
      const A = FENDER.map(([x, z]) => [x, yo(z), z]);
      const B = FENDER.map(([x, z], i) => (i === 0 ? [HOOD_X0, yi, HOOD_Z0] : [x, yi, z]));
      for (let i = 0; i < A.length - 1; i++) {
        add(panel([A[i], A[i + 1], B[i + 1], B[i]], bodyMat));
        add(panel([B[i], B[i + 1], [B[i + 1][0], yi, hoodZ(B[i + 1][0])], [B[i][0], yi, hoodZ(B[i][0])]], bodyMat));
      }
      // Chamfered nose corner + accent lip.
      add(panel([[HOOD_X0, yi, SKIRT], [SX1, yo(SKIRT), SKIRT], [SX1, yo(FENDER[0][1]), FENDER[0][1]], [HOOD_X0, yi, HOOD_Z0]], bodyMat));
      add(panel([[HOOD_X0 + 0.004, yi, SKIRT], [SX1 + 0.004, yo(SKIRT) * 1.002, SKIRT], [SX1 + 0.004, yo(0.2) * 1.002, 0.21], [HOOD_X0 + 0.004, yi, 0.21]], accentMat));
    }
    add(panel([[HOOD_X0, -FEN_IN, SKIRT], [HOOD_X0, FEN_IN, SKIRT], [HOOD_X0, FEN_IN, HOOD_Z0], [HOOD_X0, -FEN_IN, HOOD_Z0]], bodyMat));
    add(panel([[HOOD_X0 + 0.004, -FEN_IN, SKIRT], [HOOD_X0 + 0.004, FEN_IN, SKIRT], [HOOD_X0 + 0.004, FEN_IN, 0.21], [HOOD_X0 + 0.004, -FEN_IN, 0.21]], accentMat));
  }

  // ---- decks: interior decking with a driver's tub, rear deck ---------------------
  const TUB_Y = 0.13, CK_X0 = 0.55, CK_X1 = -0.95, FLOOR = 0.20;
  {
    add(panel([[CK_X0, yR(0.88), 0.88], [CK_X0, TUB_Y, 0.88], [CK_X1, TUB_Y, 0.925], [CK_X1, yR(0.925), 0.925]], alumMat));   // right-side decking
    add(panel([[CK_X1, yR(0.925), 0.925], [CK_X1, YL, 0.925], [-2.30, YL, 0.99], [-2.30, yR(0.99), 0.99]], bodyMat));       // rear deck
    // Driver's tub: right wall, rear wall, firewall, inner door skin, floor.
    add(panel([[CK_X0, TUB_Y, FLOOR], [CK_X1, TUB_Y, FLOOR], [CK_X1, TUB_Y, 0.925], [CK_X0, TUB_Y, 0.88]], alumMat));
    add(panel([[CK_X1, TUB_Y, FLOOR], [CK_X1, 0.955, FLOOR], [CK_X1, 0.955, 0.925], [CK_X1, TUB_Y, 0.925]], alumMat));
    add(panel([[CK_X0, TUB_Y, FLOOR], [CK_X0, 0.955, FLOOR], [CK_X0, 0.955, 0.88], [CK_X0, TUB_Y, 0.88]], alumMat));
    add(panel([[CK_X0, 0.955, FLOOR], [CK_X1, 0.955, FLOOR], [CK_X1, 0.955, 0.90], [CK_X0, 0.955, 0.87]], alumMat));
    add(panel([[CK_X0, TUB_Y, FLOOR], [CK_X1, TUB_Y, FLOOR], [CK_X1, 0.955, FLOOR], [CK_X0, 0.955, FLOOR]], darkMat));
    // Belly pan, engine bay and tail blockers so you can't see through the wheel openings.
    const pan = new THREE.Mesh(new THREE.BoxGeometry(4.3, 1.75, 0.03), darkMat); pan.position.set(0, 0, 0.17); g.add(pan);
    const bay = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 0.28), darkMat); bay.position.set(1.22, 0, 0.33); g.add(bay);
    const cell = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.70, 0.24), new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.6 })); cell.position.set(-1.98, 0, 0.50); g.add(shadow(cell));
    const rearBlock = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.95, 0.6), darkMat); rearBlock.position.set(-1.25, -0.05, 0.5); g.add(rearBlock);
  }

  // ---- roof, posts, sail panels -----------------------------------------------------
  const ROOF = { x0: 0.22, x1: -0.95, yl: 0.67, yr: -0.55, z: 1.185 };
  {
    const rl = ROOF.x0 - ROOF.x1, rw = ROOF.yl - ROOF.yr, cy = (ROOF.yl + ROOF.yr) / 2;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(rl, rw, 0.025), [bodyMat, bodyMat, bodyMat, bodyMat, bodyMat, darkMat]);
    roof.position.set((ROOF.x0 + ROOF.x1) / 2, cy, ROOF.z); g.add(shadow(roof));
    decal(roof, rl, rw, roofTexture(liv), [0, 0, 0.014], ROT.roof);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.13, rw, 0.015), bodyMat); visor.position.set(ROOF.x0 + 0.05, cy, ROOF.z - 0.03); visor.rotation.y = 0.55; g.add(shadow(visor));
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.05, rw, 0.015), accentMat); lip.position.set(ROOF.x1 - 0.015, cy, ROOF.z + 0.02); lip.rotation.y = 0.9; g.add(lip);
    // Front roof posts (thin, painted) and windshield bars.
    const postMat = new THREE.MeshStandardMaterial({ color: liv.body, ...paint });
    add(tube([CK_X0, 0.95, 0.88], [ROOF.x0, ROOF.yl - 0.02, ROOF.z], 0.016, postMat), tube([CK_X0, yR(0.88) + 0.03, 0.88], [ROOF.x0, ROOF.yr + 0.02, ROOF.z], 0.016, postMat));
    for (const y of [0.10, -0.22]) add(tube([CK_X0, y, 0.88], [ROOF.x0, y, ROOF.z], 0.012, cageMat));
    // Sail panels: roof side -> spoiler end, nearly level along the top.
    for (const side of [1, -1]) {
      const yo = z => (side > 0 ? YL : yR(z)), yr = side > 0 ? ROOF.yl : ROOF.yr;
      add(panel([[-0.70, yr, ROOF.z], [-2.34, yo(1.17), 1.17], [-2.30, yo(0.99), 0.99], [-0.70, yo(0.925), 0.925]], bodyMat));
      add(panel([[-0.70, yr * 1.003, ROOF.z + 0.002], [-2.34, yo(1.17) * 1.003, 1.172], [-2.335, yo(1.13) * 1.003, 1.13], [-0.70, yr * 1.003 + side * 0.012, ROOF.z - 0.045]], accentMat));
    }
  }

  // ---- spoiler ----------------------------------------------------------------------
  {
    const yl = YL, yr = yR(1.05), w = yl - yr, cy = (yl + yr) / 2, lay = 0.44, h = 0.20;
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.016, w, h), bodyMat);
    sp.position.set(-2.29 - Math.sin(lay) * h / 2, cy, 0.99 + Math.cos(lay) * h / 2); sp.rotation.y = -lay; g.add(shadow(sp));
    decal(sp, w, h, spoilerTexture(liv), [-0.01, 0, 0], ROT.rear);
    for (const y of [cy - 0.45, cy, cy + 0.45]) {
      add(panel([[-2.29 - Math.sin(lay) * h, y, 0.99 + Math.cos(lay) * h], [-2.29, y, 0.99], [-1.88, y, 0.972]], alumMat));
    }
    add(tube([-2.38, yr + 0.05, 0.40], [-2.38, yl - 0.05, 0.40], 0.022, cageMat));
    add(tube([-2.38, yr + 0.05, 0.40], [-2.05, yr + 0.05, 0.40], 0.018, cageMat), tube([-2.38, yl - 0.05, 0.40], [-2.05, yl - 0.05, 0.40], 0.018, cageMat));
  }

  // ---- roll cage (offset to the driver's side, like the real chassis) ---------------
  {
    const r = 0.021, yl = 0.86, yr = -0.42, zt = 1.15;
    const F = x => [[x, yl, zt], [x, yr, zt]];
    const [fl, fr] = F(0.12), [rl, rr] = F(-0.80);
    // No front cross bar: it would sit right across the driver's eye line; the roof edge closes the hoop.
    add(tube(rl, rr, r, cageMat), tube(fl, rl, r, cageMat), tube(fr, rr, r, cageMat));
    add(tube(fl, [CK_X0 - 0.03, yl, 0.62], r, cageMat), tube(fr, [CK_X0 - 0.03, yr, 0.62], r, cageMat));   // front legs
    add(tube(rl, [-0.86, yl, 0.30], r, cageMat), tube(rr, [-0.86, yr, 0.30], r, cageMat));                 // main hoop legs
    add(tube(rl, [-1.9, 0.55, 0.60], r * 0.85, cageMat), tube(rr, [-1.9, -0.25, 0.60], r * 0.85, cageMat)); // rear stays
    add(tube([-0.83, yl, 0.75], [-0.83, yr, 0.75], r * 0.85, cageMat));
    for (const z of [0.42, 0.60, 0.78]) add(tube([CK_X0 - 0.05, 0.90, z], [-0.86, 0.90, z], r * 0.85, cageMat));   // door bars
    const net = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.24), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.18, side: D }));
    net.position.set(-0.33, 0.90, 1.03); net.rotation.x = Math.PI / 2; g.add(net);
  }

  // ---- interior: seat, wheel, column, gauges ------------------------------------------
  const interior = new THREE.Group();
  {
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x9a9da2, metalness: 0.3, roughness: 0.5 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.46, 0.10), seatMat); base.position.set(-0.40, SEAT_Y, 0.30); interior.add(base);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.46, 0.72), seatMat); back.position.set(-0.68, SEAT_Y, 0.66); back.rotation.y = -0.18; interior.add(back);
    for (const dy of [-0.17, 0.17]) { const wing = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.20), seatMat); wing.position.set(-0.52, SEAT_Y + dy, 0.98); interior.add(wing); }
  }
  // Steering wheel: rake and steering are separate groups so the wheel spins about
  // its own column axis; the column runs forward and down into the firewall.
  const wheelRake = new THREE.Group();
  wheelRake.position.set(0.10, SEAT_Y, 0.80);
  wheelRake.rotation.y = 0.45;
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
  const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.125), dashMaterial);
  dash.position.set(0.50, SEAT_Y + 0.02, 0.80);
  dash.lookAt(dash.position.x - 1, dash.position.y, dash.position.z);
  dash.rotateX(-0.35);
  interior.add(dash);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.165, 0.02), darkMat);
  bezel.position.copy(dash.position); bezel.quaternion.copy(dash.quaternion); bezel.translateZ(-0.012);
  interior.add(bezel);
  g.add(interior);

  // Driver (hidden in the driver's-eye camera).
  const driver = new THREE.Group();
  {
    const suit = new THREE.MeshStandardMaterial({ color: 0x16203a, roughness: 0.85 });
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.135, 20, 16), new THREE.MeshStandardMaterial({ color: liv.body, metalness: 0.3, roughness: 0.3 }));
    helmet.position.set(-0.36, SEAT_Y, 1.0); helmet.castShadow = true;
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.138, 20, 10, -0.9, 1.8, 1.05, 0.62), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.8, roughness: 0.15 }));
    visor.position.copy(helmet.position); visor.rotation.set(Math.PI / 2, 0, 0);
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.136, 0.012, 6, 24), new THREE.MeshStandardMaterial({ color: liv.accent }));
    stripe.position.copy(helmet.position); stripe.rotation.y = Math.PI / 2;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.40, 0.42), suit); torso.position.set(-0.46, SEAT_Y, 0.66);
    driver.add(helmet, visor, stripe, torso);
    for (const dy of [-0.17, 0.17]) driver.add(tube([-0.42, SEAT_Y + dy, 0.80], [0.06, SEAT_Y + dy * 0.85, 0.82], 0.04, suit));
  }
  g.add(driver);

  // ---- wheels -------------------------------------------------------------------------
  const tread = treadTexture(); tread.wrapS = tread.wrapT = THREE.RepeatWrapping; tread.repeat.set(8, 1);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, map: tread, roughness: 0.95, side: D });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.8, roughness: 0.28 });
  const coverMat = new THREE.MeshStandardMaterial({ color: 0xe9ecef, metalness: 0.35, roughness: 0.4 });
  const wheels = [];
  function makeWheel(x, y, r, w, steerable) {
    const out = Math.sign(y), h = w / 2;
    const pivot = new THREE.Group(); pivot.position.set(x, y, r);
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(tireGeometry(r, w), tireMat); tire.castShadow = true;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.585 * r, 0.585 * r, w * 0.9, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.5, roughness: 0.5, side: D }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.60 * r, 0.013, 8, 28), rimMat); ring.rotation.x = Math.PI / 2; ring.position.y = out * h * 0.93;
    spin.add(tire, barrel, ring);
    if (out < 0) {                                  // right side runs mud covers
      const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.59 * r, 0.59 * r, 0.012, 24), coverMat); cover.position.y = out * h * 0.9; spin.add(cover);
      const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 8), cageMat); nut.position.set(0.3 * r, out * h * 0.92, 0); spin.add(nut);
    } else {                                        // left side: open dished wheel
      const face = new THREE.Mesh(new THREE.CylinderGeometry(0.585 * r, 0.585 * r, 0.012, 24), rimMat); face.position.y = out * h * 0.35; spin.add(face);
      for (let k = 0; k < 5; k++) {
        const a = k * 2 * Math.PI / 5;
        const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.075 * r, 0.075 * r, 0.016, 10), darkMat);
        hole.position.set(Math.cos(a) * 0.36 * r, out * h * 0.36, Math.sin(a) * 0.36 * r); spin.add(hole);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * r, 0.16 * r, 0.10, 12), cageMat); hub.position.y = out * h * 0.45; spin.add(hub);
    }
    pivot.add(spin); g.add(pivot);
    wheels.push({ pivot, spin, r, steerable });
  }
  makeWheel(FRONT_X, 0.80, R_FRONT, 0.30, true);
  makeWheel(FRONT_X, -0.87, R_FRONT, 0.30, true);
  makeWheel(REAR_X, 0.78, R_REAR, 0.36, false);
  makeWheel(REAR_X, -0.96, R_REAR, 0.42, false);    // right-rear hangs out of the body

  // Driver's-eye anchor.
  const eye = new THREE.Object3D(); eye.position.set(-0.28, SEAT_Y, 1.02); g.add(eye);

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
    setDriverVisible(v) { driver.visible = v; },
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
