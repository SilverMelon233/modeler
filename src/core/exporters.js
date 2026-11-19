/**
 * EXPORTERS — pure-JS writers for STL (binary), OBJ, and glTF/GLB.
 *
 * Kept dependency-free and synchronous so the Node CLI and the browser both
 * use exactly the same code path (no three.js required to export a model).
 */
import { faceNormal, bounds } from './mesh.js';

/* -------------------------------------------------------------------- STL */

export function toSTL(mesh, header = 'quadforge') {
  const tris = [];
  for (const f of mesh.faces) {
    for (let i = 1; i < f.length - 1; i++) tris.push([f[0], f[i], f[i + 1]]);
  }
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  const enc = new TextEncoder();
  const head = enc.encode(header.slice(0, 79));
  new Uint8Array(buf, 0, 80).set(head);
  dv.setUint32(80, tris.length, true);
  let off = 84;
  for (const t of tris) {
    const n = faceNormal(mesh.verts, t);
    dv.setFloat32(off, n[0], true); dv.setFloat32(off + 4, n[1], true); dv.setFloat32(off + 8, n[2], true);
    off += 12;
    for (const vi of t) {
      const v = mesh.verts[vi];
      dv.setFloat32(off, v[0], true); dv.setFloat32(off + 4, v[1], true); dv.setFloat32(off + 8, v[2], true);
      off += 12;
    }
    dv.setUint16(off, 0, true);
    off += 2;
  }
  return new Uint8Array(buf);
}

/* -------------------------------------------------------------------- OBJ */

export function toOBJ(objects) {
  const lines = ['# QuadForge export', '# unit: meters'];
  let base = 1;
  for (const o of objects) {
    lines.push(`o ${sanitise(o.name || o.id)}`);
    lines.push(`g ${sanitise(o.id)}`);
    for (const v of o.mesh.verts) lines.push(`v ${fmt(v[0])} ${fmt(v[1])} ${fmt(v[2])}`);
    for (const f of o.mesh.faces) lines.push(`f ${f.map((i) => i + base).join(' ')}`);
    base += o.mesh.verts.length;
  }
  return lines.join('\n');
}

const fmt = (n) => (Math.abs(n) < 1e-9 ? '0' : n.toFixed(5).replace(/0+$/, '').replace(/\.$/, ''));
const sanitise = (s) => String(s).replace(/\s+/g, '_');

/* ------------------------------------------------------------ glTF / GLB */

export function toGLTF(objects, { binary = true } = {}) {
  const meshes = [];
  const nodes = [];
  const accessors = [];
  const bufferViews = [];
  const chunks = [];
  let byteOffset = 0;

  const pushBuffer = (typedArray, target) => {
    const bytes = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    // align to 4
    const pad = (4 - (byteOffset % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); byteOffset += pad; }
    chunks.push(bytes);
    const view = { buffer: 0, byteOffset, byteLength: bytes.byteLength };
    if (target) view.target = target;
    bufferViews.push(view);
    byteOffset += bytes.byteLength;
    return bufferViews.length - 1;
  };

  for (const o of objects) {
    const verts = o.mesh.verts;
    const positions = new Float32Array(verts.length * 3);
    verts.forEach((v, i) => { positions[i * 3] = v[0]; positions[i * 3 + 1] = v[1]; positions[i * 3 + 2] = v[2]; });

    const tris = [];
    for (const f of o.mesh.faces) for (let i = 1; i < f.length - 1; i++) tris.push(f[0], f[i], f[i + 1]);
    const indices = verts.length > 65535 ? new Uint32Array(tris) : new Uint16Array(tris);

    const b = bounds(o.mesh);
    const posView = pushBuffer(positions, 34962);
    const posAcc = {
      bufferView: posView, componentType: 5126, count: verts.length, type: 'VEC3',
      min: b.min.map((n) => +n.toFixed(6)), max: b.max.map((n) => +n.toFixed(6)),
    };
    accessors.push(posAcc);
    const posIdx = accessors.length - 1;

    const idxView = pushBuffer(indices, 34963);
    accessors.push({ bufferView: idxView, componentType: verts.length > 65535 ? 5125 : 5123, count: indices.length, type: 'SCALAR' });
    const idxIdx = accessors.length - 1;

    const c = hexToLinear(o.material.color);
    meshes.push({
      name: o.name,
      primitives: [{
        attributes: { POSITION: posIdx },
        indices: idxIdx,
        material: 0,
      }],
    });
    nodes.push({ name: o.name, mesh: meshes.length - 1 });

    if (o.transform) {
      const n = nodes[nodes.length - 1];
      const { position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] } = o.transform;
      if (position.some((v) => v)) n.translation = position;
      if (scale.some((v) => v !== 1)) n.scale = scale;
      const q = eulerToQuat(rotation);
      if (q.some((v, i) => (i === 3 ? Math.abs(v - 1) : Math.abs(v)) > 1e-6)) n.rotation = q;
    }
    void c;
  }

  const total = new Uint8Array(byteOffset);
  let off = 0;
  for (const ch of chunks) { total.set(ch, off); off += ch.byteLength; }

  const json = {
    asset: { version: '2.0', generator: 'QuadForge' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials: [{
      pbrMetallicRoughness: {
        baseColorFactor: hexToLinear(objects[0]?.material?.color || '#cccccc'),
        metallicFactor: objects[0]?.material?.metalness ?? 0.05,
        roughnessFactor: objects[0]?.material?.roughness ?? 0.5,
      },
      doubleSided: true,
    }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: total.byteLength }],
  };

  if (!binary) {
    return JSON.stringify({ ...json, buffers: [{ byteLength: total.byteLength, uri: 'data:application/octet-stream;base64,' + base64(total) }] }, null, 2);
  }

  const jsonText = JSON.stringify(json);
  const jsonBuf = new TextEncoder().encode(jsonText);
  const jsonPad = (4 - (jsonBuf.byteLength % 4)) % 4;
  const jsonChunk = new Uint8Array(jsonBuf.byteLength + jsonPad);
  jsonChunk.set(jsonBuf);
  jsonChunk.fill(0x20, jsonBuf.byteLength);

  const binPad = (4 - (total.byteLength % 4)) % 4;
  const binChunk = new Uint8Array(total.byteLength + binPad);
  binChunk.set(total);

  const totalLen = 12 + 8 + jsonChunk.byteLength + 8 + binChunk.byteLength;
  const out = new ArrayBuffer(totalLen);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true);   // glTF
  dv.setUint32(4, 2, true);
  dv.setUint32(8, totalLen, true);
  dv.setUint32(12, jsonChunk.byteLength, true);
  dv.setUint32(16, 0x4e4f534a, true);  // JSON
  u8.set(jsonChunk, 20);
  const binStart = 20 + jsonChunk.byteLength;
  dv.setUint32(binStart, binChunk.byteLength, true);
  dv.setUint32(binStart + 4, 0x004e4942, true); // BIN
  u8.set(binChunk, binStart + 8);
  return new Uint8Array(out);
}

function hexToLinear(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '#cccccc');
  if (!m) return [0.8, 0.8, 0.8, 1];
  const n = parseInt(m[1], 16);
  const srgb = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  const lin = srgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return [+lin[0].toFixed(4), +lin[1].toFixed(4), +lin[2].toFixed(4), 1];
}

function eulerToQuat([rx, ry, rz]) {
  const cx = Math.cos(rx / 2), sx = Math.sin(rx / 2);
  const cy = Math.cos(ry / 2), sy = Math.sin(ry / 2);
  const cz = Math.cos(rz / 2), sz = Math.sin(rz / 2);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ].map((v) => +v.toFixed(6));
}

function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
