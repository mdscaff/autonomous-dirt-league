// Procedural dirt late model. Car frame: +x forward, +y left, +z up, origin on the
// ground under the CG. Body is the classic wedge: tall straight left side, right
// side laid over, big deck spoiler, driver offset left.
//
// Livery graphics are decal planes with explicit orientation (box-face UVs
// differ per face, which is how a "99" turns into a "66").
import * as THREE from 'three';

const FRONT_X = 1.27, REAR_X = -1.04, HALF_TRACK = 0.84;
const R_FRONT = 0.36, R_REAR = 0.385;
const SEAT_Y = 0.55;          // driver sits hard left

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function numberFont(px) { return `bold ${px}px Impact, "Arial Black", "Helvetica Neue", sans-serif`; }

function outlined(ctx, text, x, y, fill, stroke, lw) {
  ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.fillStyle = fill;
  ctx.strokeText(text, x, y); ctx.fillText(text, x, y);
}

// ---- livery canvases --------------------------------------------------------
function doorTexture(liv) {
  return canvasTex(1024, 256, (ctx, w, h) => {
    ctx.fillStyle = liv.body; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = liv.accent;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, 40); ctx.quadraticCurveTo(w * 0.5, 95, 0, 34); ctx.closePath(); ctx.fill();
    ctx.fillStyle = liv.stripe;
    ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w, h); ctx.lineTo(w, h - 18); ctx.lineTo(0, h - 30); ctx.closePath(); ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = numberFont(215);
    outlined(ctx, liv.num, w * 0.5, h * 0.55, liv.number, liv.numberOutline, 14);
  });
}
function quarterTexture(liv) {
  return canvasTex(768, 384, (ctx, w, h) => {
    ctx.fillStyle = liv.body; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = liv.accent;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, 110); ctx.quadraticCurveTo(w * 0.4, 130, 0, 60); ctx.closePath(); ctx.fill();
    ctx.fillStyle = liv.stripe; ctx.fillRect(0, h - 34, w, 34);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold 120px "Arial Narrow", Arial, sans-serif`; ctx.fillStyle = liv.accent;
    ctx.fillText(liv.name, w * 0.5, h * 0.50);
    ctx.font = numberFont(96);
    outlined(ctx, liv.num, w * 0.5, h * 0.80, liv.number, liv.numberOutline, 6);
  });
}
function roofTexture(liv) {
  return canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = liv.roof; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = liv.body; ctx.fillRect(0, 0, w, 40); ctx.fillRect(0, h - 40, w, 40);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = numberFont(330);
    outlined(ctx, liv.num, w / 2, h / 2 + 10, liv.roofNumber, liv.numberOutline, 16);
  });
}
function hoodTexture(liv) {
  return canvasTex(768, 768, (ctx, w, h) => {
    ctx.fillStyle = liv.body; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = liv.accent;
    ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.04); ctx.lineTo(w * 0.78, h * 0.62); ctx.lineTo(w * 0.22, h * 0.62); ctx.closePath(); ctx.fill();
    ctx.fillStyle = liv.body;
    ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.2); ctx.lineTo(w * 0.66, h * 0.56); ctx.lineTo(w * 0.34, h * 0.56); ctx.closePath(); ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = numberFont(190);
    outlined(ctx, liv.num, w / 2, h * 0.80, liv.number, liv.numberOutline, 12);
  });
}
function spoilerTexture(liv) {
  return canvasTex(1024, 176, (ctx, w, h) => {
    ctx.fillStyle = liv.accent; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = liv.stripe; ctx.fillRect(0, 0, w, 14); ctx.fillRect(0, h - 14, w, 14);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = numberFont(120); ctx.fillStyle = liv.body;
    ctx.fillText(`${liv.name}   ${liv.num}`, w / 2, h / 2);
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
  // #99 tribute: blue and white.
  moran99: { num: '99', name: 'MORAN', body: '#1a4fd6', accent: '#ffffff', stripe: '#0b1f5c', roof: '#ffffff',
    number: '#ffffff', roofNumber: '#1a4fd6', numberOutline: '#0b1f5c' },
  ghost1: { num: '1', name: 'BASELINE', body: '#f2f2f2', accent: '#c81e1e', stripe: '#222222', roof: '#c81e1e',
    number: '#c81e1e', roofNumber: '#ffffff', numberOutline: '#222222' },
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

// Decal plane orientations (Euler XYZ), each chosen so the graphic reads
// correctly for a viewer facing that panel:
//   left side  -> viewer on the infield looking at the driver's door
//   right side -> viewer on the outside
//   roof       -> reads from the infield / TV camera side
//   hood       -> reads from in front of the car
//   spoiler    -> reads from behind
const ROT = {
  left: [-Math.PI / 2, 0, Math.PI],
  right: [Math.PI / 2, 0, 0],
  roof: [0, 0, Math.PI],
  hood: [0, 0, Math.PI / 2],
  rear: [Math.PI / 2, -Math.PI / 2, 0],
};

export function buildLateModel(livName = 'moran99', opts = {}) {
  const liv = LIVERIES[livName];
  const g = new THREE.Group();
  const paint = { metalness: 0.25, roughness: 0.45 };
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
  // Box face material order: +x, -x, +y, -y, +z, -z.
  const sidesDark = [bodyMat, bodyMat, bodyMat, darkMat, bodyMat, darkMat];      // left panels: inner (-y) face dark
  const sidesDarkR = [bodyMat, bodyMat, darkMat, bodyMat, bodyMat, darkMat];     // right panels: inner (+y) face dark

  // Hull: wedge cross-section extruded along x, in two sections (nose and deck)
  // so the cockpit between them is open for the cage, seat and driver's view.
  {
    const sh = new THREE.Shape();
    sh.moveTo(0.95, 0.28); sh.lineTo(0.95, 0.72); sh.lineTo(0.45, 0.78); sh.lineTo(-0.62, 0.74); sh.lineTo(-1.0, 0.40); sh.lineTo(-0.95, 0.28); sh.closePath();
    const flip = new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);   // shape (y,z) -> world, extrude -> +x
    const nose = new THREE.ExtrudeGeometry(sh, { depth: 1.75, bevelEnabled: false });
    nose.applyMatrix4(flip); nose.translate(0.6, 0, 0);
    g.add(shadow(new THREE.Mesh(nose, bodyMat)));
    const deck = new THREE.ExtrudeGeometry(sh, { depth: 1.25, bevelEnabled: false });
    deck.applyMatrix4(flip); deck.translate(-2.35, 0, 0);
    g.add(shadow(new THREE.Mesh(deck, bodyMat)));
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.46), bodyMat);
    skirt.position.set(-0.25, -0.95, 0.5); g.add(shadow(skirt));
    const lskirt = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.40), bodyMat);
    lskirt.position.set(-0.25, 0.95, 0.47); g.add(shadow(lskirt));
  }
  // Left side: door (number) + taller rear quarter (name) rising to the spoiler.
  {
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.44), sidesDark);
    door.position.set(0.05, 0.96, 0.84); g.add(shadow(door));
    decal(door, 1.9, 0.44, doorTexture(liv), [0, 0.03, 0], ROT.left);
    const qtr = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.05, 0.68), sidesDark);
    qtr.position.set(-1.6, 0.96, 0.96); g.add(shadow(qtr));
    decal(qtr, 1.42, 0.68, quarterTexture(liv), [0, 0.03, 0], ROT.left);
  }
  // Right side: laid over (top leans inboard), same split.
  {
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.44), sidesDarkR);
    door.position.set(0.05, -0.86, 0.84); door.rotation.x = 0.42; g.add(shadow(door));
    decal(door, 1.9, 0.44, doorTexture(liv), [0, -0.03, 0], ROT.right);
    const qtr = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.05, 0.68), sidesDarkR);
    qtr.position.set(-1.6, -0.82, 0.96); qtr.rotation.x = 0.42; g.add(shadow(qtr));
    decal(qtr, 1.42, 0.68, quarterTexture(liv), [0, -0.03, 0], ROT.right);
  }
  // Hood: sloped from cowl down to the nose, number reads from the front.
  {
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.75, 1.85, 0.05), bodyMat);
    hood.position.set(1.35, 0.05, 0.80); hood.rotation.y = 0.10; g.add(shadow(hood));
    decal(hood, 1.85, 1.75, hoodTexture(liv), [0, 0, 0.03], ROT.hood);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.9, 0.5), accentMat);
    nose.position.set(2.2, 0.05, 0.50); nose.rotation.y = 0.25; g.add(shadow(nose));
    g.add(tube([2.42, -0.8, 0.30], [2.42, 0.9, 0.30], 0.025, cageMat));
  }
  // Cowl, rear deck, spoiler with side boards.
  {
    const cowl = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.9, 0.08), bodyMat); cowl.position.set(0.80, 0.05, 0.93); g.add(shadow(cowl));
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.95, 0.06), bodyMat); deck.position.set(-1.65, 0.05, 1.05); g.add(shadow(deck));
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.0, 0.34), bodyMat);
    sp.position.set(-2.30, 0.05, 1.22); sp.rotation.y = -0.75; g.add(shadow(sp));
    decal(sp, 2.0, 0.34, spoilerTexture(liv), [-0.02, 0, 0], ROT.rear);
    for (const y of [-0.95, 1.05]) {
      const brd = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.03, 0.34), accentMat);
      brd.position.set(-2.18, y, 1.2); brd.rotation.y = -0.35; g.add(shadow(brd));
    }
  }
  // Roof + sail panel. Roof number reads from the infield / TV side.
  {
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.45, 0.05), [bodyMat, bodyMat, bodyMat, bodyMat, accentMat, darkMat]);
    roof.position.set(-0.35, 0.10, 1.46); roof.rotation.y = 0.03; g.add(shadow(roof));
    decal(roof, 1.35, 1.45, roofTexture(liv), [0, 0, 0.03], ROT.roof);
    const sail = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.42), bodyMat);
    sail.position.set(-1.35, 0.85, 1.2); sail.rotation.y = 0.35; g.add(shadow(sail));
  }
  // Roll cage.
  {
    const A = [[0.65, 0.78, 0.95], [0.65, -0.62, 0.95]], Ar = [[0.30, 0.72, 1.44], [0.30, -0.58, 1.44]];
    const B = [[-1.05, 0.78, 0.95], [-1.05, -0.62, 0.95]], Br = [[-1.0, 0.72, 1.44], [-1.0, -0.58, 1.44]];
    const r = 0.022;
    g.add(tube(A[0], Ar[0], r, cageMat), tube(A[1], Ar[1], r, cageMat), tube(B[0], Br[0], r, cageMat), tube(B[1], Br[1], r, cageMat));
    g.add(tube(Ar[0], Br[0], r, cageMat), tube(Ar[1], Br[1], r, cageMat), tube(Ar[0], Ar[1], r, cageMat), tube(Br[0], Br[1], r, cageMat));
    g.add(tube([0.65, 0.78, 0.95], [-1.05, 0.78, 0.95], r, cageMat));
    for (const z of [0.55, 0.75]) g.add(tube([0.6, 0.86, z], [-1.0, 0.86, z], r * 0.9, cageMat));  // driver-side door bars
    g.add(tube([0.65, -0.62, 0.95], [-1.05, -0.62, 0.95], r, cageMat));
    g.add(tube(Ar[0], [1.9, 0.6, 0.55], r * 0.8, cageMat), tube(Ar[1], [1.9, -0.5, 0.55], r * 0.8, cageMat)); // front hoop
    const net = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.4), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.16, side: THREE.DoubleSide }));
    net.position.set(-0.2, 0.86, 1.17); net.rotation.x = Math.PI / 2; g.add(net);
  }
  // Interior: seat, wheel, column, dash - all on the driver's (left) side.
  const interior = new THREE.Group();
  {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.55), darkMat); seat.position.set(-0.45, SEAT_Y, 0.62); interior.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.75), darkMat); back.position.set(-0.7, SEAT_Y, 1.0); interior.add(back);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.6, 0.04), darkMat); floor.position.set(-0.2, 0.05, 0.30); interior.add(floor);
    const halo = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.34), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    halo.position.set(-0.55, SEAT_Y, 1.28); interior.add(halo);
  }
  // Steering wheel: raked so the top leans away from the driver; the column
  // runs forward and down into the firewall (local +x of the pivot).
  const wheelPivot = new THREE.Group();
  wheelPivot.position.set(0.40, SEAT_Y, 1.02);   // over the lap, clear of the cowl
  wheelPivot.rotation.y = 0.55;
  {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.016, 10, 32), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7 }));
    rim.rotation.y = Math.PI / 2; wheelPivot.add(rim);
    for (const a of [0, 2.094, 4.189]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.02), cageMat);
      sp.position.set(0, Math.cos(a) * 0.085, Math.sin(a) * 0.085); sp.rotation.x = -a; wheelPivot.add(sp);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 12), cageMat); hub.rotation.z = Math.PI / 2; wheelPivot.add(hub);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), cageMat);
    column.rotation.z = Math.PI / 2; column.position.x = 0.25; wheelPivot.add(column);
  }
  interior.add(wheelPivot);
  // Compact gauge cluster on a bracket just left of the column, low enough to
  // see the hood over it.
  const dashMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.55 });
  const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.13), dashMaterial);
  dash.position.set(0.90, SEAT_Y + 0.02, 1.09);
  dash.lookAt(dash.position.x - 1, dash.position.y, dash.position.z);   // face the driver
  dash.rotateX(-0.5);                                                    // tilt up toward the eyes
  interior.add(dash);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.17, 0.02), darkMat);
  bezel.position.copy(dash.position); bezel.quaternion.copy(dash.quaternion); bezel.translateZ(-0.012);
  interior.add(bezel);
  g.add(interior);

  // Wheels.
  const tread = treadTexture(); tread.wrapS = THREE.RepeatWrapping; tread.repeat.set(6, 1);
  const tireMat = new THREE.MeshStandardMaterial({ map: tread, roughness: 0.95 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.7, roughness: 0.3 });
  const wheels = [];
  function makeWheel(x, y, r, w, steerable) {
    const pivot = new THREE.Group(); pivot.position.set(x, y, r);
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 24), tireMat);
    tire.castShadow = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w * 1.02, 16), rimMat);
    spin.add(tire, rim); pivot.add(spin); g.add(pivot);
    wheels.push({ pivot, spin, r, steerable });
  }
  makeWheel(FRONT_X, HALF_TRACK, R_FRONT, 0.28, true);
  makeWheel(FRONT_X, -HALF_TRACK, R_FRONT, 0.28, true);
  makeWheel(REAR_X, HALF_TRACK + 0.10, R_REAR, 0.36, false);
  makeWheel(REAR_X, -HALF_TRACK - 0.18, R_REAR, 0.36, false);   // right-rear offset out

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
    tireWorld(i, target) {   // rear tire contact patch positions for dust
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
