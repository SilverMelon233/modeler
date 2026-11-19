import * as THREE from 'three';
import { faceNormal, faceCenter } from '../core/mesh.js';

/**
 * Interaction controller: selection, face picking, box select, sculpting,
 * and keyboard shortcuts. Kept separate from Viewport so rendering stays
 * declarative and this stays a pure state machine over App.
 */
export class Interactions {
  constructor(app) {
    this.app = app;
    this.vp = app.viewport;
    this.dom = this.vp.renderer.domElement;
    this.state = 'idle';
    this.dragStart = null;
    this.lastSculptPoint = null;
    this.marquee = null;
    this._bind();
  }

  _bind() {
    const d = this.dom;
    d.addEventListener('pointerdown', (e) => this.onDown(e));
    d.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    d.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    d.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') this.shiftDown = false;
    });
  }

  /* ------------------------------------------------------------- helpers */

  get shift() { return this._shift; }

  localPoint(objectId, worldPoint) {
    const view = this.vp.views.get(objectId);
    if (!view) return worldPoint;
    const inv = new THREE.Matrix4().copy(view.group.matrixWorld).invert();
    return worldPoint.clone().applyMatrix4(inv);
  }

  raycastFace(ev) {
    const hit = this.vp.pickScreen(ev);
    if (!hit) return null;
    const obj = this.app.get(hit.objectId);
    if (!obj) return null;
    const gi = obj.getGeometry();
    const tri = Math.floor(hit.faceIndex ?? 0);
    const base = gi.triBase?.[tri];
    return { hit, obj, faceIndex: base ?? tri };
  }

  /* ------------------------------------------------------------- pointer */

  onDown(e) {
    if (e.button !== 0) return;
    this._shift = e.shiftKey;
    this.dragStart = { x: e.clientX, y: e.clientY, time: performance.now() };
    const app = this.app;

    if (app.mode === 'sculpt') {
      this.state = 'sculpting';
      this.vp.controls.enabled = false;
      this.sculptAtEvent(e);
      return;
    }

    if (app.mode === 'edit') {
      this.state = 'marquee';
      this.marquee = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
      return;
    }

    // object mode: select on press for responsiveness, but let orbit win if dragged
    this.state = 'maybe-select';
    this.pendingHit = this.vp.pickScreen(e);
  }

  onMove(e) {
    const app = this.app;
    if (app.mode === 'sculpt') {
      this.updateBrushCursor(e);
      if (this.state === 'sculpting') this.sculptAtEvent(e);
      return;
    }

    if (this.state === 'marquee' && this.marquee) {
      this.marquee.x1 = e.clientX;
      this.marquee.y1 = e.clientY;
      this.drawMarquee();
      return;
    }

    if (this.state === 'maybe-select' && this.dragStart) {
      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      if (Math.hypot(dx, dy) > 4) {
        // the user is orbiting; abort the pending selection
        this.state = 'idle';
        this.pendingHit = null;
      }
    }
  }

  onUp(e) {
    const app = this.app;
    if (this.state === 'sculpting') {
      this.state = 'idle';
      this.vp.controls.enabled = true;
      app.commitHistory('雕刻');
      return;
    }

    if (this.state === 'marquee' && this.marquee) {
      const m = this.marquee;
      this.marquee = null;
      this.clearMarquee();
      this.state = 'idle';
      const w = Math.abs(m.x1 - m.x0), h = Math.abs(m.y1 - m.y0);
      if (w < 4 && h < 4) {
        this.pickFaceAt(e);
      } else {
        this.boxSelectFaces(m, e.shiftKey || this._shift);
      }
      return;
    }

    if (this.state === 'maybe-select') {
      this.state = 'idle';
      if (this.pendingHit) {
        const { objectId } = this.pendingHit;
        if (e.shiftKey) app.toggleSelect(objectId);
        else if (!app.selection.has(objectId)) app.select([objectId]);
      } else if (!e.shiftKey) {
        app.clearSelection();
      }
      this.pendingHit = null;
    }
  }

  onDoubleClick(e) {
    const hit = this.vp.pickScreen(e);
    if (hit) {
      const obj = this.app.get(hit.objectId);
      if (obj) {
        this.app.select([obj.id]);
        this.vp.frameObject(obj);
      }
    }
  }

  /* ------------------------------------------------------------- picking */

  pickFaceAt(e) {
    const r = this.raycastFace(e);
    const app = this.app;
    if (!r) {
      if (!this._shift) { app.editSelection.clear(); app.viewport.setEditSelection(null); app.emit('objects'); }
      return;
    }
    const obj = r.obj;
    if (!app.selection.has(obj.id)) app.select([obj.id]);
    if (this._shift) {
      if (app.editSelection.has(r.faceIndex)) app.editSelection.delete(r.faceIndex);
      else app.editSelection.add(r.faceIndex);
    } else {
      app.editSelection.clear();
      app.editSelection.add(r.faceIndex);
    }
    this.pushEditSelection();
  }

  pushEditSelection() {
    const app = this.app;
    const obj = app.active;
    if (!obj) return;
    app.viewport.setEditSelection(obj, [...app.editSelection]);
    app.emit('objects');
    app.emit('editSelection', app.editSelection.size);
  }

  boxSelectFaces(m, additive) {
    const rect = { left: Math.min(m.x0, m.x1), right: Math.max(m.x0, m.x1), top: Math.min(m.y0, m.y1), bottom: Math.max(m.y0, m.y1) };
    const domRect = this.dom.getBoundingClientRect();
    const box = new THREE.Box2(
      new THREE.Vector2(rect.left - domRect.left, rect.top - domRect.top),
      new THREE.Vector2(rect.right - domRect.left, rect.bottom - domRect.top),
    );
    const app = this.app;
    const obj = app.active;
    if (!obj) return;
    const view = this.vp.views.get(obj.id);
    if (!view) return;
    if (!additive) app.editSelection.clear();

    const v = new THREE.Vector3();
    obj.mesh.faces.forEach((face, fi) => {
      const c = faceCenter(obj.mesh.verts, face);
      v.set(c[0], c[1], c[2]).applyMatrix4(view.group.matrixWorld).project(this.vp.camera);
      if (v.z < -1 || v.z > 1) return;
      const sx = ((v.x + 1) / 2) * domRect.width;
      const sy = ((-v.y + 1) / 2) * domRect.height;
      if (sx >= box.min.x && sx <= box.max.x && sy >= box.min.y && sy <= box.max.y) {
        app.editSelection.add(fi);
      }
    });
    this.pushEditSelection();
  }

  /* -------------------------------------------------------------- sculpt */

  updateBrushCursor(e) {
    const r = this.raycastFace(e);
    let cursor = this.vp.brushRing;
    if (!cursor) {
      const geo = new THREE.RingGeometry(0.94, 1, 48);
      const mat = new THREE.MeshBasicMaterial({ color: 0x6fd3ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false });
      cursor = new THREE.Mesh(geo, mat);
      cursor.renderOrder = 999;
      this.vp.scene.add(cursor);
      this.vp.brushRing = cursor;
    }
    cursor.visible = !!r;
    if (!r) return;
    const n = r.hit.normal;
    cursor.position.copy(r.hit.point).addScaledVector(n, 0.001);
    cursor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    const radius = this.app.sculpt.radius * (r.obj.transform.scale[0] || 1);
    cursor.scale.setScalar(radius);
  }

  sculptAtEvent(e) {
    const app = this.app;
    const r = this.raycastFace(e);
    if (!r) return;
    const obj = r.obj;
    if (app.selection.size !== 1 || !app.selection.has(obj.id)) app.select([obj.id]);
    const lp = this.localPoint(obj.id, r.hit.point);
    const scale = obj.transform.scale[0] || 1;
    app.sculptAt(obj, [lp.x, lp.y, lp.z], app.sculpt.radius / scale, app.sculpt.strength / scale, app.sculpt.mode, e.altKey);
    this.vp.sync(app.objects);
  }

  /* --------------------------------------------------------------- marquee */

  drawMarquee() {
    if (!this.marqueeEl) {
      this.marqueeEl = document.createElement('div');
      this.marqueeEl.className = 'marquee';
      document.body.append(this.marqueeEl);
    }
    const m = this.marquee;
    const s = this.marqueeEl.style;
    s.display = 'block';
    s.left = Math.min(m.x0, m.x1) + 'px';
    s.top = Math.min(m.y0, m.y1) + 'px';
    s.width = Math.abs(m.x1 - m.x0) + 'px';
    s.height = Math.abs(m.y1 - m.y0) + 'px';
  }

  clearMarquee() {
    if (this.marqueeEl) this.marqueeEl.style.display = 'none';
  }

  /* ------------------------------------------------------------- keyboard */

  onKey(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    const app = this.app;
    const meta = e.ctrlKey || e.metaKey;

    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) app.redo(); else app.undo();
      return;
    }
    if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); app.redo(); return; }
    if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); app.duplicateSelected(); return; }
    if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); app.exportJSON(); return; }

    if (meta) return;
    this._shift = e.shiftKey;

    switch (e.key) {
      case '1': app.setMode('object'); break;
      case '2': app.setMode('edit'); break;
      case '3': app.setMode('sculpt'); break;
      case 'f': case 'F': {
        if (app.active) this.vp.frameObject(app.active);
        else this.vp.frameAll(app.objects);
        break;
      }
      case 'g': case 'G': app.addCharacter(); break;
      case 'Delete': case 'Backspace':
        if (app.mode === 'edit') app.applyEdit('delete');
        else app.deleteSelected();
        break;
      case 'w': case 'W': app.transformMode = 'translate'; this.vp.setGizmoMode('translate'); break;
      case 'e': case 'E': app.transformMode = 'rotate'; this.vp.setGizmoMode('rotate'); break;
      case 'r': case 'R': app.transformMode = 'scale'; this.vp.setGizmoMode('scale'); break;
      case 'Escape':
        if (app.mode === 'edit') { app.editSelection.clear(); app.viewport.setEditSelection(null); app.emit('objects'); }
        else app.clearSelection();
        break;
      case 'x': case 'X':
        if (app.mode === 'edit') app.applyEdit('extrude', { distance: 0.12 });
        break;
      case 'i': case 'I':
        if (app.mode === 'edit') app.applyEdit('inset', { amount: 0.25 });
        break;
      case 'm': case 'M':
        if (app.mode === 'edit') app.applyEdit('mirror');
        break;
      case 's': case 'S':
        if (app.mode === 'edit') app.applyEdit('subdivide');
        break;
      default: break;
    }
  }
}
