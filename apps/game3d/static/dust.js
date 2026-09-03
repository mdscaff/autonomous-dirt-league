// Roost: dust particles thrown off the rear tires under wheelspin and slip.
import * as THREE from 'three';

const MAX = 1500;

export class Dust {
  constructor(scene) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.size = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const sprite = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const ctx = c.getContext('2d');
      const gr = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: sprite }, color: { value: new THREE.Color(0.72, 0.58, 0.42) } },
      vertexShader: `attribute float size; attribute float alpha; varying float vA;
        void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = size * (300.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 color; varying float vA;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(color, t.a * vA); }`,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.next = 0;
    this.tmp = new THREE.Vector3();
  }

  emit(p, dirX, dirY, intensity, speed) {
    const n = Math.min(40, Math.floor(intensity * 26));
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % MAX;
      const j = i * 3;
      this.pos[j] = p.x + (Math.random() - 0.5) * 0.4; this.pos[j + 1] = p.y + (Math.random() - 0.5) * 0.4; this.pos[j + 2] = p.z + 0.1;
      const back = 4 + Math.random() * 6 + intensity * 10 + speed * 0.15;
      this.vel[j] = -dirX * back + (Math.random() - 0.5) * 3;
      this.vel[j + 1] = -dirY * back + (Math.random() - 0.5) * 3;
      this.vel[j + 2] = 1.5 + Math.random() * 4 + intensity * 3;
      this.life[i] = 0.9 + Math.random() * 1.2;
      this.size[i] = 0.5 + Math.random() * 0.8;
      this.alpha[i] = 0.55;
    }
  }

  update(dt) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      const j = i * 3;
      this.life[i] -= dt;
      this.vel[j] *= 0.96; this.vel[j + 1] *= 0.96; this.vel[j + 2] -= 4.5 * dt;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 2] < 0.05) { this.pos[j + 2] = 0.05; this.vel[j + 2] = Math.abs(this.vel[j + 2]) * 0.2; }
      this.size[i] += dt * 1.6;
      this.alpha[i] = Math.min(0.55, this.life[i] * 0.5);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.size.needsUpdate = true; g.attributes.alpha.needsUpdate = true;
  }
}
