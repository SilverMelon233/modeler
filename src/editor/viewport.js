import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildMaterial, createGroup } from './object.js';
import { makeOutlineMaterial, ANIME_PRESET } from './toon.js';
import { makeFaceTexture } from './faceTexture.js';
import { toWireframeTris, faceNormal, faceCenter, add, mul, sub } from '../core/mesh.js';

const ACCENT = 0x4cc2ff;

export class Viewport {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 400);
    this.camera.position.set(2.4, 1.75, 3.2);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.25;
    this.controls.maxDistance = 40;
    this.controls.target.set(0, 0.9, 0);
    this.controls.maxPolarAngle = Math.PI * 0.98;

    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSize(0.85);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      if (!e.value) this.onTransformEnd?.();
    });
    this.gizmo.addEventListener('objectChange', () => this.onTransformChange?.());
    // three >= 0.166: TransformControls is a Controls instance, not an Object3D.
    // The visual part must be added via getHelper().
    this.gizmoHelper = this.gizmo.getHelper ? this.gizmo.getHelper() : this.gizmo;
    this.scene.add(this.gizmoHelper);

    this._setupEnvironment();
    this._setupPost();

    this.root = new THREE.Group();
    this.root.name = 'model-root';
    this.scene.add(this.root);

    this.overlays = new THREE.Group();
    this.overlays.name = 'overlays';
    this.scene.add(this.overlays);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.views = new Map();     // objectId -> { group, mesh, lines }
    this.selectedIds = new Set();
    this.editSelection = new Set();

    this._buildHelpers();
    this._bindResize();
    this._animate = this._animate.bind(this);
    rendererLoop(this);
  }

  _setupEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = new RoomEnvironment();
    this.envTex = pmrem.fromScene(env, 0.04).texture;
    this.scene.environment = this.envTex;
    pmrem.dispose();

    // gradient backdrop
    const geo = new THREE.SphereGeometry(160, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color('#2a3440') },
        mid: { value: new THREE.Color('#171c23') },
        bot: { value: new THREE.Color('#0a0c10') },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;
        void main(){
          float h = normalize(vP).y;
          vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.75)) : mix(mid, bot, pow(-h, 0.55));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.backdrop = new THREE.Mesh(geo, mat);
    this.backdrop.frustumCulled = false;
    this.scene.add(this.backdrop);
    this.scene.fog = new THREE.Fog('#141820', 14, 48);

    this.scene.add(new THREE.HemisphereLight(0xdfeaff, 0x161b22, 0.40));

    const key = new THREE.DirectionalLight(0xfff2e0, 1.65);
    key.position.set(3.2, 5.2, 3.0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 20;
    const d = 3.2;
    Object.assign(key.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);
    this.keyLight = key;

    const rim = new THREE.DirectionalLight(0x8fb8ff, 0.85);
    rim.position.set(-3.6, 2.4, -3.2);
    this.scene.add(rim);

    const fill = new THREE.DirectionalLight(0xffd9b8, 0.34);
    fill.position.set(-2.0, 1.2, 3.4);
    this.scene.add(fill);

    // Toon shading needs directions in VIEW space, so they are recomputed per
    // frame from these world-space anchors rather than baked once.
    this.lightAnchors = { key, rim: rim };
    this.renderStyle = 'pbr';
  }

  /** Light directions in view space, consumed by the toon shader. */
  toonLights() {
    // For cel shading the key is placed well off the view axis; a light near the
    // camera fills every visible normal and the banded ramp degenerates to one
    // flat tone. In view space +Z is toward the camera, so the key sits at
    // roughly 50 degrees to the left and 30 degrees up.
    return {
      keyDir: new THREE.Vector3(-0.62, 0.55, 0.56).normalize(),
      rimDir: new THREE.Vector3(0.55, 0.35, -0.75).normalize(),
    };
  }

  materialFor(obj) {
    return buildMaterial(obj.material, {
      style: this.renderStyle,
      lights: this.toonLights(),
    });
  }

  _setupPost() {
    const size = this.container.getBoundingClientRect();
    this.composer = new EffectComposer(this.renderer);
    this.composer.setSize(size.width || 1, size.height || 1);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.outline = new OutlinePass(new THREE.Vector2(size.width || 1, size.height || 1), this.scene, this.camera);
    this.outline.edgeStrength = 3.6;
    this.outline.edgeGlow = 0.35;
    this.outline.edgeThickness = 1.4;
    this.outline.visibleEdgeColor.set(ACCENT);
    this.outline.hiddenEdgeColor.set(0x1d5f7a);
    this.composer.addPass(this.outline);
    this.composer.addPass(new OutputPass());
  }

  _buildHelpers() {
    const grid = new THREE.GridHelper(20, 80, 0x3a4654, 0x222a33);
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    grid.position.y = -0.0005;
    this.scene.add(grid);
    this.grid = grid;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.30 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.position.y = -0.0015;
    this.scene.add(ground);
  }

  _bindResize() {
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.container);
    this.resize();
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.outline.setSize(w, h);
  }

  _animate() {
    this.controls.update();
    this.composer.render();
  }

  /* --------------------------------------------------------------- objects */

  sync(objects) {
    this._objectsById = new Map(objects.map((o) => [o.id, o]));
    const alive = new Set();
    for (const obj of objects) {
      alive.add(obj.id);
      let view = this.views.get(obj.id);
      if (!view) {
        const group = createGroup(obj);
        const mesh = new THREE.Mesh(obj.getGeometry().geometry, this.materialFor(obj));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.objectId = obj.id;
        group.add(mesh);

        // Inverted-hull outline (named distinctly from this.outline, which is
        // the post-process selection outline).
        const hull = new THREE.Mesh(
          obj.getGeometry().geometry,
          makeOutlineMaterial(obj.material.outlineColor || '#2a1f33', 0.0022),
        );
        hull.visible = false;
        hull.userData.isOutline = true;
        group.add(hull);

        const lines = new THREE.LineSegments(
          obj.getWireGeometry(),
          new THREE.LineBasicMaterial({ color: 0x1b222c, transparent: true, opacity: 0.55 }),
        );
        lines.visible = false;
        group.add(lines);

        this.root.add(group);
        view = { group, mesh, lines, hull, signature: '' };
        this.views.set(obj.id, view);
      }
      const sig = `${obj.subdiv}|${obj.mesh.verts.length}|${obj.mesh.faces.length}|${JSON.stringify(obj.material)}|${obj.transform.position}|${obj.transform.rotation}|${obj.transform.scale}`;
      if (view.signature !== sig) {
        const { geometry } = obj.getGeometry();
        view.mesh.geometry = geometry;
        view.mesh.material = this.materialFor(obj);
        view.lines.geometry = obj.getWireGeometry();
        view.hull.geometry = geometry;
        view.signature = sig;
      }
      view.group.position.fromArray(obj.transform.position);
      view.group.rotation.fromArray(obj.transform.rotation);
      view.group.scale.fromArray(obj.transform.scale);
      view.group.visible = obj.visible;
      view.mesh.userData.objectId = obj.id;
    }

    for (const [id, view] of this.views) {
      if (!alive.has(id)) {
        this.root.remove(view.group);
        view.mesh.geometry.dispose();
        view.mesh.material.dispose();
        this.views.delete(id);
        if (this.gizmo.object === view.group) this.gizmo.detach();
      }
    }
    this.refreshOutline();
    this.refreshOverlays();
  }

  setSelection(ids) {
    this.selectedIds = new Set(ids);
    this.refreshOutline();
    this.refreshGizmo();
  }

  refreshOutline() {
    const meshes = [];
    for (const id of this.selectedIds) {
      const v = this.views.get(id);
      if (v) meshes.push(v.mesh);
    }
    this.outline.selectedObjects = meshes;
  }

  refreshGizmo() {
    const ids = [...this.selectedIds];
    if (ids.length === 1) {
      const v = this.views.get(ids[0]);
      if (v) this.gizmo.attach(v.group);
    } else {
      this.gizmo.detach();
    }
  }

  setGizmoMode(mode) {
    this.gizmo.setMode(mode);
  }

  /** Switch between physically-based and cel shading. */
  setRenderStyle(style) {
    this.renderStyle = style;
    // The face decal lives on the material, so objects created before toon mode
    // was enabled do not have a texture yet.
    if (style === 'toon') {
      for (const [id, obj] of this._objectsById || []) {
        if (obj.isCharacter && !obj.material.faceTexture) {
          obj.material.faceTexture = makeFaceTexture(THREE, obj.facePalette || 'default');
        }
        void id;
      }
    }
    for (const v of this.views.values()) {
      const objId = v.group.userData.objectId;
      const obj = this._objectsById?.get(objId);
      if (obj) v.mesh.material = this.materialFor(obj);
      v.hull.visible = style === 'toon' && obj?.material?.outline !== false;
    }
  }

  setEditMode(on, showWireframe = true) {
    this.editMode = on;
    for (const v of this.views.values()) v.lines.visible = on && showWireframe;
  }

  /* -------------------------------------------------------------- overlays */

  refreshOverlays() {
    while (this.overlays.children.length) {
      const c = this.overlays.children.pop();
      c.geometry?.dispose();
      c.material?.dispose();
    }
    if (!this._overlayData) return;
    const { object, faces } = this._overlayData;
    const view = this.views.get(object.id);
    if (!view || !faces.length) return;

    const positions = [];
    for (const fi of faces) {
      const f = object.mesh.faces[fi];
      if (!f) continue;
      const n = faceNormal(object.mesh.verts, f);
      const off = mul(n, 0.0035);
      for (let i = 1; i < f.length - 1; i++) {
        for (const idx of [f[0], f[i], f[i + 1]]) {
          const p = add(object.mesh.verts[idx], off);
          positions.push(p[0], p[1], p[2]);
        }
      }
    }
    if (!positions.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.computeVertexNormals();
    const m = new THREE.MeshBasicMaterial({
      color: 0x39a7ff,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const overlay = new THREE.Mesh(g, m);
    // transform to match object
    overlay.position.fromArray(object.transform.position);
    overlay.rotation.fromArray(object.transform.rotation);
    overlay.scale.fromArray(object.transform.scale);
    this.overlays.add(overlay);
  }

  setEditSelection(object, faces) {
    this._overlayData = object ? { object, faces } : null;
    this.refreshOverlays();
  }

  /* --------------------------------------------------------------- picking */

  _updatePointer(ev) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  }

  pickScreen(ev) {
    this._updatePointer(ev);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = [];
    for (const v of this.views.values()) if (v.group.visible) meshes.push(v.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const hit = hits[0];
    return {
      objectId: hit.object.userData.objectId,
      point: hit.point,
      distance: hit.distance,
      normal: hit.face ? hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize() : new THREE.Vector3(0, 1, 0),
      faceIndex: hit.faceIndex,
      triBase: hit.object.geometry.userData.triBase,
    };
  }

  /** Ray in world space for sculpting. */
  pickRay(ev) {
    this._updatePointer(ev);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.ray;
  }

  screenToWorldPlane(ev, normal = new THREE.Vector3(0, 1, 0), point = new THREE.Vector3()) {
    this._updatePointer(ev);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, out) ? out : null;
  }

  frameObject(object) {
    const v = this.views.get(object.id);
    if (!v) return;
    const box = new THREE.Box3().setFromObject(v.mesh);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    const dir = new THREE.Vector3(0.55, 0.35, 1).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, size * 1.15);
    this.camera.near = Math.max(0.005, size * 0.004);
    this.camera.far = size * 40;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  frameAll(objects) {
    const box = new THREE.Box3();
    for (const o of objects) {
      const v = this.views.get(o.id);
      if (v) box.expandByObject(v.mesh);
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    const dir = new THREE.Vector3(0.55, 0.30, 1).normalize();
    this.controls.target.copy(center);
    // Fit by the bounding sphere so wide *and* tall scenes both work.
    const radius = size * 0.5;
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const dist = radius / Math.sin(Math.min(vFov, hFov) / 2) * 1.12;
    this.camera.position.copy(center).addScaledVector(dir, Math.max(dist, radius * 1.5));
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }
}

function rendererLoop(vp) {
  let running = true;
  vp.stopLoop = () => { running = false; };
  const loop = () => {
    if (!running) return;
    vp._animate();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
