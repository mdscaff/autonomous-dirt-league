// Track, scenery and the live dirt surface. World is z-up; sim x/y map 1:1.
import * as THREE from 'three';

// Hex = sRGB; three converts to linear for the vertex color attribute.
const SLICK = new THREE.Color(0xd9c49c);
const TACKY = new THREE.Color(0x4e3118);
const LOOSE = new THREE.Color(0xc4823f);

function noiseTexture(size = 512, base = 200, spread = 55) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${base},${base},${base})`;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 9000; i++) {
    const v = base + (Math.random() - 0.5) * spread;
    ctx.fillStyle = `rgba(${v},${v},${v},${0.25 + Math.random() * 0.4})`;
    const r = 1 + Math.random() * 6;
    ctx.beginPath(); ctx.arc(Math.random() * size, Math.random() * size, r, 0, 6.283); ctx.fill();
  }
  // Fine tire-scuff streaks along u (track direction).
  for (let i = 0; i < 400; i++) {
    const v = base + (Math.random() - 0.5) * spread * 1.4;
    ctx.strokeStyle = `rgba(${v},${v},${v},0.35)`;
    ctx.lineWidth = 1 + Math.random() * 2;
    const y = Math.random() * size, x = Math.random() * size;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 30 + Math.random() * 80, y + (Math.random() - 0.5) * 4); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function textBanner(text, w = 1024, h = 256, fg = '#ffffff', bg = '#1848c8') {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg; ctx.font = `bold ${h * 0.55}px Impact, "Arial Black", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildTrack(scene, info) {
  const { length: L, width, wall_distance: WD, banking, centerline: cl, headings: hd, curvatures: kap, n_s, n_l } = info;
  const N = cl.length;
  const hw = width / 2;
  const tanB = Math.tan(banking);

  // Banking weight per centerline point: 1 in turns, 0 on straights, smoothed.
  const turn = kap.map(k => (Math.abs(k) > 1e-4 ? 1 : 0));
  const bankW = new Float32Array(N);
  const R = 14;
  for (let i = 0; i < N; i++) {
    let acc = 0;
    for (let k = -R; k <= R; k++) acc += turn[(i + k + N) % N];
    bankW[i] = acc / (2 * R + 1);
  }
  const idxAt = s => Math.floor(((s % L) + L) % L / L * N) % N;
  const normal = i => [-Math.sin(hd[i]), Math.cos(hd[i])];
  const zAt = (s, d) => -d * tanB * bankW[idxAt(s)];
  const worldAt = (s, d) => {
    const i = idxAt(s); const n = normal(i);
    return [cl[i][0] + n[0] * d, cl[i][1] + n[1] * d, zAt(s, d)];
  };

  const group = new THREE.Group();

  // ---- racing surface --------------------------------------------------
  const rows = n_s + 1, cols = n_l + 1;
  const pos = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  const col = new Float32Array(rows * cols * 3);
  for (let i = 0; i < rows; i++) {
    const s = (i % n_s) * L / n_s;
    for (let j = 0; j < cols; j++) {
      const d = -hw + j * width / n_l;
      const p = worldAt(s, d);
      const k = (i * cols + j);
      pos[k * 3] = p[0]; pos[k * 3 + 1] = p[1]; pos[k * 3 + 2] = p[2];
      uv[k * 2] = i * L / n_s / 6; uv[k * 2 + 1] = j * width / n_l / 6;
      col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = 0.6;
    }
  }
  const idx = [];
  for (let i = 0; i < n_s; i++) for (let j = 0; j < n_l; j++) {
    const a = i * cols + j, b = a + cols;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const dirtMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: noiseTexture(512, 150, 60), roughness: 0.96, metalness: 0.0 });
  const surface = new THREE.Mesh(geo, dirtMat);
  surface.receiveShadow = true;
  group.add(surface);

  const colorAttr = geo.getAttribute('color');
  const tmp = new THREE.Color();
  function updateSurface(mu, loose, moist) {
    for (let i = 0; i < rows; i++) {
      const ci = Math.min(i, n_s - 1);
      for (let j = 0; j < cols; j++) {
        const cj = Math.min(j, n_l - 1);
        const c = ci * n_l + cj;
        const t = mu[c] / 255, lo = Math.min(1, loose[c] / 255 * 1.5), mo = moist[c] / 255;
        tmp.copy(SLICK).lerp(TACKY, t).lerp(LOOSE, lo * 0.6);
        const dark = 0.85 + 0.35 * (0.55 - mo);      // wetter = darker
        const k = i * cols + j;
        colorAttr.setXYZ(k, tmp.r * dark, tmp.g * dark, tmp.b * dark);
      }
    }
    colorAttr.needsUpdate = true;
  }

  // ---- infield ------------------------------------------------------------
  {
    const inner = []; for (let i = 0; i < N; i += 2) inner.push(worldAt(i * L / N, hw - 0.05));
    const g = new THREE.BufferGeometry();
    const v = [0, 0, -0.2];
    inner.forEach(p => v.push(p[0], p[1], p[2] - 0.05));
    const ii = [];
    for (let i = 0; i < inner.length; i++) ii.push(0, i + 1, ((i + 1) % inner.length) + 1);
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setIndex(ii); g.computeVertexNormals();
    const grass = noiseTexture(256, 120, 40); grass.repeat.set(40, 40);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x4d6b2e, map: grass, roughness: 1 }));
    m.receiveShadow = true; group.add(m);
  }

  // ---- outside ground -----------------------------------------------------
  {
    const g = new THREE.PlaneGeometry(700, 500);
    const t = noiseTexture(256, 70, 30); t.repeat.set(60, 45);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x3a3a30, map: t, roughness: 1 }));
    m.position.z = -0.3; m.receiveShadow = true; group.add(m);
  }

  // ---- outer wall + catch fence -------------------------------------------
  {
    const step = 2;
    const v = [], uvw = [], ii = [];
    let k = 0;
    for (let i = 0; i <= N; i += step) {
      const s = (i % N) * L / N;
      const p = worldAt(s, -WD);
      v.push(p[0], p[1], p[2] - 0.3, p[0], p[1], p[2] + 1.1);
      uvw.push(s / 4, 0, s / 4, 1);
      if (i > 0) ii.push(k - 2, k - 1, k, k - 1, k + 1, k);
      k += 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvw, 2));
    g.setIndex(ii); g.computeVertexNormals();
    const conc = noiseTexture(256, 175, 40); conc.repeat.set(1, 1);
    const wall = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xbdbdb5, map: conc, roughness: 0.9, side: THREE.DoubleSide }));
    wall.castShadow = true; wall.receiveShadow = true; group.add(wall);

    // Fence posts + translucent mesh above the wall.
    const postGeo = new THREE.CylinderGeometry(0.05, 0.05, 3.6, 6); postGeo.rotateX(Math.PI / 2);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.6, roughness: 0.5 });
    const nPosts = Math.floor(L / 6);
    const posts = new THREE.InstancedMesh(postGeo, postMat, nPosts);
    const M = new THREE.Matrix4();
    for (let i = 0; i < nPosts; i++) {
      const p = worldAt(i * L / nPosts, -WD - 0.1);
      M.makeTranslation(p[0], p[1], p[2] + 1.1 + 1.8); posts.setMatrixAt(i, M);
    }
    group.add(posts);
    const fv = [], fi = []; k = 0;
    for (let i = 0; i <= N; i += step) {
      const p = worldAt((i % N) * L / N, -WD - 0.1);
      fv.push(p[0], p[1], p[2] + 1.1, p[0], p[1], p[2] + 4.7);
      if (i > 0) fi.push(k - 2, k - 1, k, k - 1, k + 1, k);
      k += 2;
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fv, 3)); fg.setIndex(fi);
    group.add(new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false })));
  }

  // ---- start/finish line + flag stand -------------------------------------
  {
    const a = worldAt(0, -hw), b = worldAt(0, hw);
    const g = new THREE.BufferGeometry();
    const w = 0.4;
    const n = normal(0); const t = [Math.cos(hd[0]), Math.sin(hd[0])];
    const v = [];
    for (const p of [a, b]) v.push(p[0] - t[0] * w, p[1] - t[1] * w, p[2] + 0.02, p[0] + t[0] * w, p[1] + t[1] * w, p[2] + 0.02);
    void n;
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex([0, 2, 1, 2, 3, 1]); g.computeVertexNormals();
    group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 })));
    // Flag stand on the outside wall.
    const fp = worldAt(0, -WD - 2.5);
    const stand = new THREE.Group();
    const legs = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x8a8a8a, metalness: 0.5, roughness: 0.5 }));
    legs.position.z = 3; stand.add(legs);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 2.4), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    cab.position.z = 7.2; stand.add(cab);
    stand.position.set(fp[0], fp[1], fp[2]); stand.castShadow = true; group.add(stand);
  }

  // ---- grandstand along the front straight (outside, -y) ------------------
  {
    const gs = new THREE.Group();
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x5a5a5a, roughness: 0.9 });
    const steps = 14, len = 110;
    for (let i = 0; i < steps; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, 1.2, 0.9), seatMat);
      m.position.set(0, -(WD + 8 + i * 1.2), 0.45 + i * 0.9);
      m.receiveShadow = true; gs.add(m);
    }
    // Crowd: instanced little blocks with random warm colors.
    const n = 2200;
    const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.35, 0.8), new THREE.MeshStandardMaterial({ roughness: 1 }), n);
    const M = new THREE.Matrix4(); const C = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const row = Math.floor(Math.random() * steps);
      M.makeTranslation((Math.random() - 0.5) * len, -(WD + 8 + row * 1.2) + (Math.random() - 0.5) * 0.5, 0.9 + row * 0.9 + 0.4);
      crowd.setMatrixAt(i, M);
      C.setHSL(Math.random(), 0.55, 0.35 + Math.random() * 0.35); crowd.setColorAt(i, C);
    }
    gs.add(crowd);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 4, steps * 1.2 + 4, 0.3), new THREE.MeshStandardMaterial({ color: 0x334455, metalness: 0.4, roughness: 0.6 }));
    roof.position.set(0, -(WD + 8 + steps * 0.6), steps * 0.9 + 4); roof.castShadow = true; gs.add(roof);
    for (const x of [-len / 2, 0, len / 2]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, steps * 0.9 + 4, 8), seatMat);
      col.rotation.x = Math.PI / 2; col.position.set(x, -(WD + 8 + steps * 1.2), (steps * 0.9 + 4) / 2); gs.add(col);
    }
    group.add(gs);

    // Billboards on the back-straight wall (+y side), facing the track.
    const bMat = [
      new THREE.MeshStandardMaterial({ map: textBanner('ADRL', 1024, 256, '#ffffff', '#1848c8') }),
      new THREE.MeshStandardMaterial({ map: textBanner('AUTONOMOUS DIRT RACING LEAGUE', 2048, 256, '#ffd400', '#111111') }),
      new THREE.MeshStandardMaterial({ map: textBanner('DOUBLE DOWN', 1024, 256, '#ffffff', '#c81e1e') }),
    ];
    for (let b = 0; b < 8; b++) {
      const s = L * 0.55 + (b - 3.5) * 14;
      const p = worldAt(s, -WD - 0.6);
      const n = normal(idxAt(s));
      const bb = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), bMat[b % 3]);
      bb.position.set(p[0], p[1], p[2] + 2.3);
      bb.lookAt(p[0] + n[0], p[1] + n[1], p[2] + 2.3);   // vertical, facing the track
      group.add(bb);
    }
  }

  // ---- light poles ----------------------------------------------------------
  const poleLights = [];
  {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x8f8f8f, metalness: 0.6, roughness: 0.4 });
    const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6d5 });
    const nPoles = 12;
    for (let i = 0; i < nPoles; i++) {
      const s = i * L / nPoles + L / (2 * nPoles);
      const p = worldAt(s, -WD - 5);
      const H = 19;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, H, 8), poleMat);
      pole.rotation.x = Math.PI / 2; pole.position.set(p[0], p[1], p[2] + H / 2); group.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.9), headMat);
      const ii = idxAt(s); const n = normal(ii);
      head.position.set(p[0] + n[0] * 0.8, p[1] + n[1] * 0.8, p[2] + H);
      head.rotation.z = hd[ii]; group.add(head);
      const light = new THREE.SpotLight(0xfff1d6, 1800, 240, 1.05, 0.75, 1.4);
      light.position.copy(head.position);
      const tgt = worldAt(s, 0);
      light.target.position.set(tgt[0], tgt[1], tgt[2]);
      group.add(light); group.add(light.target);
      poleLights.push(light);
    }
  }

  scene.add(group);
  return { group, surface, updateSurface, zAt, worldAt, idxAt, bankW, poleLights, hw, WD, L };
}
