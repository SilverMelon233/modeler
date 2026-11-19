import { SceneObject, buildMaterial, createGroup } from './editor/object.js';
import { Viewport } from './editor/viewport.js';
import {
  cloneMesh, mergeByDistance, subdivide as ccSubdivide, extrudeFaces, insetFaces,
  deleteFaces, subdivideSelected, mirrorX, sculptBrush, bounds, orientOutward,
  faceCenter, faceNormal, add, mul, sub, len, compact, joinMeshes,
} from './core/mesh.js';
import * as P from './core/primitives.js';
import { buildCharacter, CHAR_DEFAULTS } from './core/character.js';
import { compileDocument } from './core/recipe.js';
import { validateDocument, validateGeometry, formatErrors } from './core/schema.js';
import { makeFaceTexture } from './editor/faceTexture.js';

/** The decal is only meaningful in toon mode; PBR ignores it. */
function viewportToonEnabled(app) {
  return app.viewport?.renderStyle === 'toon';
}
import { booleanOp } from './core/booleans.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import * as THREE from 'three';

let seq = 0;
const uid = (p = 'o') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

const HISTORY_LIMIT = 60;

export class App {
  constructor() {
    this.objects = [];
    this.selection = new Set();
    this.mode = 'object';          // object | edit | sculpt
    this.tool = 'select';
    this.editSelection = new Set();
    this.sculpt = { radius: 0.10, strength: 0.02, mode: 'inflate' };
    this.brushCursor = null;
    this.history = [];
    this.future = [];
    this.transformMode = 'translate';
    this._suspendHistory = false;
    this.listeners = new Map();
    this.showGrid = true;
    this.autoSmooth = true;
    this.stats = { verts: 0, faces: 0, tris: 0 };
  }

  /* ------------------------------------------------------------- events */

  on(evt, cb) {
    if (!this.listeners.has(evt)) this.listeners.set(evt, []);
    this.listeners.get(evt).push(cb);
    return () => this.off(evt, cb);
  }
  off(evt, cb) {
    const l = this.listeners.get(evt);
    if (l) this.listeners.set(evt, l.filter((f) => f !== cb));
  }
  emit(evt, data) {
    for (const cb of this.listeners.get(evt) || []) cb(data);
  }

  /* -------------------------------------------------------------- state */

  attachViewport(container) {
    this.viewport = new Viewport(container);
    this.viewport.onTransformChange = () => {
      for (const id of this.selection) {
        const o = this.get(id);
        const v = this.viewport.views.get(id);
        if (!o || !v) continue;
        o.transform.position = v.group.position.toArray();
        o.transform.rotation = [v.group.rotation.x, v.group.rotation.y, v.group.rotation.z];
        o.transform.scale = v.group.scale.toArray();
      }
      this.emit('objects');
    };
    this.viewport.onTransformEnd = () => {
      this.commitHistory('transform');
      this.emit('objects');
    };
    this.viewport.setGizmoMode(this.transformMode);
  }

  get(id) { return this.objects.find((o) => o.id === id); }
  get selected() { return [...this.selection].map((id) => this.get(id)).filter(Boolean); }
  get active() {
    const first = this.selection.values().next().value;
    return this.get(first);
  }

  refresh() {
    this.viewport?.sync(this.objects);
    this.updateStats();
    this.emit('objects');
    this.emit('selection');
    this.emit('history');
  }

  updateStats() {
    let v = 0, f = 0, t = 0;
    for (const o of this.objects) {
      if (!o.visible) continue;
      const { mesh } = o.displayMesh();
      v += mesh.verts.length;
      f += mesh.faces.length;
      for (const face of mesh.faces) t += Math.max(0, face.length - 2);
    }
    this.stats = { verts: v, faces: f, tris: t };
    this.emit('stats', this.stats);
  }

  /* ------------------------------------------------------------- history */

  snapshot() {
    return this.objects.map((o) => ({
      id: o.id,
      name: o.name,
      mesh: cloneMesh(o.mesh),
      material: { ...o.material },
      transform: {
        position: [...o.transform.position],
        rotation: [...o.transform.rotation],
        scale: [...o.transform.scale],
      },
      subdiv: o.subdiv,
      visible: o.visible,
    }));
  }

  /**
   * History model: each entry stores the state *before* the change.
   *
   * Callers invoke commitHistory() after mutating, so we keep a `_baseline`
   * holding the state as of the previous commit. That makes undo/redo exact
   * without every call site having to snapshot first.
   */
  commitHistory(label = 'edit') {
    if (this._suspendHistory) return;
    const before = this._baseline ?? this._serialize();
    this.history.push({ label, state: before });
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.future.length = 0;
    this._baseline = this._serialize();
    this.emit('history');
  }

  /** Reset the baseline after an out-of-band change (load / import / undo). */
  syncBaseline() {
    this._baseline = this._serialize();
  }

  _serialize() {
    return {
      objects: this.snapshot(),
      selection: [...this.selection],
      label: '',
    };
  }

  restore(state) {
    this.objects = state.objects.map((s) => {
      const o = new SceneObject(cloneMesh({ verts: s.mesh.verts, faces: s.mesh.faces }), {
        name: s.name, color: s.material.color,
      });
      o.id = s.id;
      o.material = { ...s.material };
      o.transform = {
        position: [...s.transform.position],
        rotation: [...s.transform.rotation],
        scale: [...s.transform.scale],
      };
      o.subdiv = s.subdiv;
      o.visible = s.visible;
      return o;
    });
    this.selection = new Set(state.selection);
    this._baseline = null;
    this.viewport.views.forEach((v) => this.viewport.root.remove(v.group));
    this.viewport.views.clear();
    this.refresh();
    this.viewport.setSelection(this.selection);
  }

  undo() {
    if (!this.history.length) return;
    const cur = this._serialize();
    const h = this.history.pop();
    this.future.push({ label: h.label, state: cur });
    this.restore(h.state);
    this._baseline = this._serialize();
    this.emit('history');
    this.toast(`撤销：${h.label || '编辑'}`);
  }

  redo() {
    if (!this.future.length) return;
    const entry = this.future.pop();
    this.history.push({ label: entry.label, state: this._serialize() });
    this.restore(entry.state);
    this._baseline = this._serialize();
    this.emit('history');
    this.toast(`重做：${entry.label || '编辑'}`);
  }

  /* ------------------------------------------------------------ creation */

  addObject(mesh, opts = {}) {
    const obj = new SceneObject(mesh, opts);
    obj.id = opts.id || uid('obj_');
    this.objects.push(obj);
    this.select([obj.id]);
    this.commitHistory(opts.historyLabel || `创建 ${obj.name}`);
    this.refresh();
    return obj;
  }

  addPrimitive(kind, opts = {}) {
    const gen = {
      cube: () => P.cube(1, 2),
      sphere: () => P.sphere(0.6, 20, 14),
      cylinder: () => P.cylinder(0.45, 1.1, 18, 1),
      cone: () => P.cone(0.5, 1.1, 18),
      torus: () => P.torus(0.55, 0.19, 24, 12),
      plane: () => P.plane(1.6, 4),
      capsule: () => P.capsule(0.25, 0.9, 16, 14),
      rounded: () => P.roundedBox(1.0, 0.16, 4),
    }[kind];
    if (!gen) return null;
    const names = {
      cube: '立方体', sphere: '球体', cylinder: '圆柱', cone: '圆锥',
      torus: '圆环', plane: '平面', capsule: '胶囊', rounded: '圆角盒',
    };
    const mesh = gen();
    const obj = this.addObject(mesh, { name: names[kind] || kind });
    obj.transform.position = [0, kind === 'plane' ? 0.001 : bounds(mesh).size[1] / 2 + 0.001, 0];
    this.viewport?.frameObject(obj);
    this.refresh();
    return obj;
  }

  addCharacter(params = {}) {
    const mesh = buildCharacter(params);
    const obj = this.addObject(mesh, {
      name: '角色',
      color: '#cbb396',
      roughness: 0.66,
      metalness: 0.0,
      subdiv: 0,
    });
    obj.parentCharacter = { ...CHAR_DEFAULTS, ...params };
    // Marks the object for face-decal projection; the material also gets the
    // generated face texture so toon shading can blend it in.
    obj.isCharacter = true;
    if (viewportToonEnabled(this)) {
      obj.material.faceTexture = makeFaceTexture(THREE, obj.facePalette || 'default');
    }
    this.viewport?.frameObject(obj);
    this.commitHistory('创建角色');
    this.refresh();
    return obj;
  }

  rebuildCharacter(obj, params) {
    const mesh = buildCharacter(params);
    obj.mesh = mesh;
    obj.invalidate();
    obj.parentCharacter = { ...params };
    this.refresh();
    this.viewport?.frameObject(obj);
  }

  /* ------------------------------------------------------------ selection */

  select(ids, additive = false) {
    if (!additive) this.selection.clear();
    for (const id of ids) this.selection.add(id);
    this.editSelection.clear();
    this.viewport?.setSelection(this.selection);
    this.viewport?.setEditSelection(null);
    this.emit('selection');
    this.emit('objects');
  }

  toggleSelect(id) {
    if (this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
    this.editSelection.clear();
    this.viewport?.setSelection(this.selection);
    this.emit('selection');
    this.emit('objects');
  }

  clearSelection() {
    this.selection.clear();
    this.editSelection.clear();
    this.viewport?.setSelection(this.selection);
    this.viewport?.setEditSelection(null);
    this.emit('selection');
    this.emit('objects');
  }

  /* --------------------------------------------------------------- object */

  updateObject(obj, patch = {}, label = '属性') {
    if (patch.material) Object.assign(obj.material, patch.material);
    if (patch.transform) Object.assign(obj.transform, patch.transform);
    if (patch.name !== undefined) obj.name = patch.name;
    if (patch.subdiv !== undefined) obj.subdiv = patch.subdiv;
    if (patch.visible !== undefined) obj.visible = patch.visible;
    obj.invalidate();
    this.refresh();
    return obj;
  }

  deleteSelected() {
    if (!this.selection.size) return;
    this.objects = this.objects.filter((o) => !this.selection.has(o.id));
    this.selection.clear();
    this.editSelection.clear();
    this.commitHistory('删除');
    this.refresh();
    this.emit('selection');
  }

  duplicateSelected() {
    const src = this.selected.length ? this.selected : (this.objects.length ? [this.objects[0]] : []);
    if (!src.length) { this.toast('没有可复制的对象'); return; }
    const clones = [];
    for (const o of src) {
      const copy = new SceneObject(cloneMesh(o.mesh), { name: o.name + ' 副本', color: o.material.color });
      copy.material = { ...o.material };
      copy.transform = {
        position: [o.transform.position[0] + 0.5, o.transform.position[1], o.transform.position[2]],
        rotation: [...o.transform.rotation],
        scale: [...o.transform.scale],
      };
      copy.subdiv = o.subdiv;
      copy.parentCharacter = o.parentCharacter ? { ...o.parentCharacter } : null;
      clones.push(copy);
    }
    this.objects.push(...clones);
    this.select(clones.map((c) => c.id));
    this.commitHistory('复制');
    this.refresh();
    return clones;
  }

  applyBoolean(op) {
    const sel = this.selected;
    if (sel.length < 2) { this.toast('布尔运算需要选中两个对象'); return; }
    const a = sel[0], b = sel[1];
    // bake transforms of b into a's local space
    const inv = new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(a.transform.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler().fromArray(a.transform.rotation)),
      new THREE.Vector3().fromArray(a.transform.scale),
    ).invert();
    const mB = new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(b.transform.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler().fromArray(b.transform.rotation)),
      new THREE.Vector3().fromArray(b.transform.scale),
    );
    const local = mB.clone().premultiply(inv);
    const posAttr = new THREE.Matrix4();
    const bMesh = {
      verts: b.mesh.verts.map((v) => {
        const p = new THREE.Vector3(...v).applyMatrix4(local);
        return [p.x, p.y, p.z];
      }),
      faces: b.mesh.faces.map((f) => f.slice()),
    };
    try {
      const result = booleanOp(a.mesh, bMesh, op);
      a.mesh = result;
      a.invalidate();
      this.objects = this.objects.filter((o) => o.id !== b.id);
      this.select([a.id]);
      this.commitHistory('布尔 ' + op);
      this.refresh();
      this.toast(`布尔运算完成：${op}`);
    } catch (e) {
      console.error(e);
      this.toast('布尔运算失败：' + e.message);
    }
  }

  /* ---------------------------------------------------------- edit mode */

  setMode(mode) {
    this.mode = mode;
    this.editSelection.clear();
    this.viewport?.setEditMode(mode === 'edit', true);
    this.viewport?.setEditSelection(null);
    if (this.viewport) {
      this.viewport.gizmo.visible = mode === 'object';
      if (this.viewport.gizmoHelper) this.viewport.gizmoHelper.visible = mode === 'object';
      if (mode !== 'object') this.viewport.gizmo.detach();
    }
    this.emit('mode', mode);
    this.emit('objects');
    this.refresh();
  }

  applyEdit(op, args = {}) {
    const obj = this.active;
    if (!obj) return;
    const sel = [...this.editSelection];
    if (!sel.length && !['subdivAll', 'mirror', 'smoothAll', 'orient'].includes(op)) {
      this.toast('请先选中面');
      return;
    }
    let mesh = obj.mesh;
    if (op === 'extrude') mesh = extrudeFaces(mesh, sel, args.distance ?? 0.12);
    else if (op === 'inset') mesh = insetFaces(mesh, sel, args.amount ?? 0.2);
    else if (op === 'subdivide') mesh = subdivideSelected(mesh, sel);
    else if (op === 'delete') mesh = deleteFaces(mesh, sel);
    else if (op === 'subdivAll') mesh = compact({ verts: mesh.verts, faces: mesh.faces });
    else if (op === 'mirror') mesh = mirrorX(mesh, true);
    else if (op === 'smoothAll') {
      // one CC level, keeping the base mesh quads
      const r = ccSubdivide(mesh, 1);
      mesh = { verts: r.verts, faces: r.faces };
      obj.subdiv = 0;
    } else if (op === 'orient') mesh = orientOutward(mesh);

    obj.mesh = mesh;
    obj.invalidate();
    this.editSelection.clear();
    this.viewport?.setEditSelection(null);
    this.commitHistory(op);
    this.refresh();
  }

  /* -------------------------------------------------------------- sculpt */

  sculptAt(obj, localPoint, radius, strength, mode, invert = false) {
    const s = invert ? -strength : strength;
    obj.mesh = sculptBrush(obj.mesh, localPoint, radius, s, mode);
    obj.invalidate();
  }

  /* -------------------------------------------------------------- export */

  exportJSON() {
    const data = {
      format: 'quadforge', version: 1, date: new Date().toISOString(),
      objects: this.objects.map((o) => ({
        name: o.name, mesh: o.mesh, material: o.material,
        transform: o.transform, subdiv: o.subdiv,
        parentCharacter: o.parentCharacter || null,
      })),
    };
    download(JSON.stringify(data), 'model.quadforge.json', 'application/json');
  }

  /**
   * Open a .quadforge document. Two shapes are supported:
   *  1. recipe documents (schema: quadforge/1) -> compiled, parameters preserved
   *  2. editor snapshots (format: quadforge)   -> meshes loaded verbatim
   */
  importJSON(text) {
    const data = JSON.parse(text);

    if (data.schema === 'quadforge/1') {
      const v = validateDocument(data);
      const g = validateGeometry(data);
      const issues = [...v.errors, ...g.issues];
      if (issues.length) throw new Error('文档校验失败\n' + formatErrors(issues));

      const { objects, warnings } = compileDocument(data);
      this.objects = objects.map((r) => {
        const o = new SceneObject(r.mesh, { name: r.name, color: r.material.color });
        o.id = r.id;
        o.material = { ...o.material, ...r.material };
        o.subdiv = 0;
        if (r._source?.kind === 'humanoid') {
          o.parentCharacter = { ...CHAR_DEFAULTS, ...(r._source.rig || {}) };
        }
        return o;
      });
      this.selection.clear();
      this.documentSource = data;
      this._baseline = null;
      this.commitHistory('打开工程');
      this.refresh();
      this.viewport?.frameAll(this.objects);
      for (const w of warnings) this.toast(w, 'error');
      this.toast(`已编译 ${objects.length} 个对象${warnings.length ? `（${warnings.length} 条警告）` : ''}`);
      return;
    }

    if (data.format !== 'quadforge') throw new Error('未知文件格式：需要 schema "quadforge/1" 或 format "quadforge"');
    this.objects = [];
    for (const s of data.objects) {
      const o = new SceneObject({ verts: s.mesh.verts, faces: s.mesh.faces }, { name: s.name });
      o.material = { ...o.material, ...s.material };
      o.transform = s.transform;
      o.subdiv = s.subdiv || 0;
      o.parentCharacter = s.parentCharacter;
      this.objects.push(o);
    }
    this.selection.clear();
    this._baseline = null;
    this.commitHistory('导入工程');
    this.refresh();
    this.viewport?.frameAll(this.objects);
    this.toast(`已导入 ${data.objects.length} 个对象`);
  }

  exportMesh(format) {
    const sel = this.selected.length ? this.selected : this.objects;
    if (!sel.length) return;
    if (format === 'json') return this.exportJSON();

    const exporter = new THREE.Group();
    for (const o of sel) {
      const { geometry } = o.getGeometry();
      const g = geometry.clone();
      const group = createGroup(o);
      const mesh = new THREE.Mesh(g, buildMaterial(o.material));
      group.add(mesh);
      group.updateMatrixWorld(true);
      exporter.add(group);
    }

    if (format === 'stl') {
      const exp = new STLExporter();
      const binary = true;
      const result = exp.parse(exporter, { binary });
      download(result, 'model.stl', 'model/stl');
    } else if (format === 'obj') {
      const exp = new OBJExporter();
      download(exp.parse(exporter), 'model.obj', 'text/plain');
    } else if (format === 'glb' || format === 'gltf') {
      new GLTFExporter().parse(exporter, (out) => {
        if (out instanceof ArrayBuffer) {
          download(out, 'model.glb', 'model/gltf-binary');
        } else {
          download(JSON.stringify(out, null, 2), 'model.gltf', 'model/gltf+json');
        }
      }, (err) => this.toast('导出失败 ' + err), { binary: format === 'glb' });
    }
    this.toast(`已导出 ${sel.length} 个对象（${format.toUpperCase()}）`);
  }

  /* --------------------------------------------------------------- misc */

  toast(msg, kind = 'info') {
    this.emit('toast', { msg, kind });
  }

  saveLocal() {
    try {
      localStorage.setItem('quadforge:autosave', JSON.stringify({
        objects: this.objects.map((o) => ({
          name: o.name, mesh: o.mesh, material: o.material,
          transform: o.transform, subdiv: o.subdiv, parentCharacter: o.parentCharacter || null,
        })),
      }));
    } catch (e) { /* quota */ }
  }

  loadLocal() {
    try {
      const raw = localStorage.getItem('quadforge:autosave');
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data.objects?.length) return false;
      this.importJSON(JSON.stringify({ format: 'quadforge', objects: data.objects }));
      return true;
    } catch (e) { return false; }
  }
}

export function download(data, filename, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export { SceneObject, buildMaterial };
