import * as THREE from 'three';
import { toRenderData, toWireframeTris, bounds, catmullClark, vertexNormals } from '../core/mesh.js';

let uid = 1;

const PALETTE = [
  '#d9e2ec', '#a7c7e7', '#f2c4c4', '#c9e4ca', '#f7dfae', '#d8c3e5',
  '#9fb8ad', '#e0b0a0', '#8fa9c9', '#e8e1d9',
];

export class SceneObject {
  constructor(mesh, opts = {}) {
    this.id = 'obj_' + uid++;
    this.name = opts.name || 'Object';
    this.mesh = mesh;
    this.transform = {
      position: opts.position || [0, 0, 0],
      rotation: opts.rotation || [0, 0, 0],
      scale: opts.scale || [1, 1, 1],
    };
    this.material = {
      color: opts.color || PALETTE[uid % PALETTE.length],
      metalness: opts.metalness ?? 0.05,
      roughness: opts.roughness ?? 0.45,
      opacity: 1,
      flat: false,
      wireframe: false,
      transmission: 0,
      emissive: '#000000',
    };
    this.subdiv = opts.subdiv ?? 0;
    this.visible = true;
    this.locked = false;
    this._geoCache = null;   // { level, geometry, triBase, mesh }
    this._wireCache = null;
    this._normals = null;
    this.hiddenFaces = new Set();
  }

  invalidate() {
    this._geoCache = null;
    this._wireCache = null;
    this._normals = null;
  }

  get vertNormals() {
    if (!this._normals) this._normals = vertexNormals(this.mesh);
    return this._normals;
  }

  /** Mesh as displayed (after subdivision preview). */
  displayMesh() {
    if (this.subdiv <= 0) {
      return { mesh: this.mesh, faceSource: this.mesh.faceSource };
    }
    let m = this.mesh;
    let src = m.faces.map((_, i) => i);
    for (let i = 0; i < this.subdiv; i++) {
      const r = catmullClark(m, src);
      m = { verts: r.verts, faces: r.faces };
      src = r.faceSource;
    }
    return { mesh: m, faceSource: src };
  }

  getGeometry() {
    const key = this.subdiv;
    if (this._geoCache && this._geoCache.level === key) return this._geoCache;
    const { mesh, faceSource } = this.displayMesh();
    const data = toRenderData({ ...mesh, faceSource });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    g.setIndex(new THREE.BufferAttribute(data.indices, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    g.userData.triBase = data.triBase;
    this._geoCache = { level: key, geometry: g, triBase: data.triBase, mesh };
    return this._geoCache;
  }

  getWireGeometry() {
    if (this._wireCache) return this._wireCache;
    const { mesh } = this.displayMesh();
    const pos = toWireframeTris(mesh);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this._wireCache = g;
    return g;
  }

  getBounds() {
    const b = bounds(this.mesh);
    return b;
  }
}

export function meshCenter(mesh) {
  return bounds(mesh).center;
}

/** Build a THREE.Group hierarchy for an object. */
export function createGroup(obj) {
  const group = new THREE.Group();
  group.name = obj.name;
  group.position.fromArray(obj.transform.position);
  group.rotation.fromArray(obj.transform.rotation);
  group.scale.fromArray(obj.transform.scale);
  group.userData.objectId = obj.id;
  group.visible = obj.visible;
  return group;
}

export function buildMaterial(mat) {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(mat.color),
    metalness: mat.metalness,
    roughness: mat.roughness,
    opacity: mat.opacity,
    transparent: mat.opacity < 1 || mat.transmission > 0,
    flatShading: mat.flat,
    wireframe: mat.wireframe,
    side: THREE.DoubleSide,
    envMapIntensity: 0.85,
  });
  if (mat.transmission > 0) {
    m.transmission = mat.transmission;
    m.thickness = 0.6;
    m.ior = 1.4;
  }
  if (mat.emissive && mat.emissive !== '#000000') {
    m.emissive = new THREE.Color(mat.emissive);
    m.emissiveIntensity = 1;
  }
  return m;
}
