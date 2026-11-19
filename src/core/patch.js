/**
 * PATCH — JSON Patch (RFC 6902) + a few semantic ops for LLM editing.
 *
 * Why not just rewrite the whole document? A rewrite costs a full document of
 * tokens, is not reviewable, and cannot be applied partially. A patch is small,
 * ordered, and each step can be validated. This is what makes an agent loop
 * economical and safe.
 *
 * Standard ops: add, remove, replace, move, copy, test
 * Semantic ops (extensions, allowed only at the top level of the patch):
 *   { op: 'setRig',  path: '/objects/hero', value: { build: 0.8 } }
 *   { op: 'addPart', path: '/objects/hero', value: {...part} }
 *   { op: 'removePart', path: '/objects/hero', partId: 'cape' }
 *   { op: 'setMaterial', path: '/materials', name: 'skin', value: {...} }
 */

const isObj = (v) => v !== null && typeof v === 'object';

export function parsePointer(ptr) {
  if (ptr === '' || ptr === '/') return [];
  if (!ptr.startsWith('/')) throw new Error(`JSON Pointer 必须以 / 开头：${ptr}`);
  return ptr.slice(1).split('/').map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function formatPointer(tokens) {
  if (!tokens.length) return '';
  return '/' + tokens.map((t) => String(t).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}

function getParent(doc, tokens) {
  let cur = doc;
  for (let i = 0; i < tokens.length - 1; i++) {
    const k = tokens[i];
    if (cur == null || typeof cur !== 'object') throw new Error(`路径不存在：${formatPointer(tokens.slice(0, i + 1))}`);
    cur = cur[k];
  }
  if (cur == null || typeof cur !== 'object') throw new Error(`路径不存在：${formatPointer(tokens)}`);
  return cur;
}

function deepClone(v) {
  return v === undefined ? v : structuredClone ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}

function applyOne(doc, op) {
  const tokens = parsePointer(op.path ?? '');
  switch (op.op) {
    case 'add': {
      if (!tokens.length) return deepClone(op.value);
      const parent = getParent(doc, tokens);
      const key = tokens[tokens.length - 1];
      if (Array.isArray(parent)) {
        const i = key === '-' ? parent.length : Number(key);
        if (!Number.isInteger(i) || i < 0 || i > parent.length) throw new Error(`数组下标越界：${key}`);
        parent.splice(i, 0, deepClone(op.value));
      } else {
        parent[key] = deepClone(op.value);
      }
      return doc;
    }
    case 'remove': {
      const parent = getParent(doc, tokens);
      const key = tokens[tokens.length - 1];
      if (Array.isArray(parent)) {
        const i = Number(key);
        if (!Number.isInteger(i) || i < 0 || i >= parent.length) throw new Error(`数组下标越界：${key}`);
        parent.splice(i, 1);
      } else {
        if (!(key in parent)) throw new Error(`字段不存在：${key}`);
        delete parent[key];
      }
      return doc;
    }
    case 'replace': {
      const parent = getParent(doc, tokens);
      const key = tokens[tokens.length - 1];
      if (Array.isArray(parent)) {
        const i = Number(key);
        if (!Number.isInteger(i) || i < 0 || i >= parent.length) throw new Error(`数组下标越界：${key}`);
        parent[i] = deepClone(op.value);
      } else {
        parent[key] = deepClone(op.value);
      }
      return doc;
    }
    case 'move': {
      const fromTokens = parsePointer(op.from);
      const value = readValue(doc, fromTokens);
      doc = applyOne(doc, { op: 'remove', path: op.from });
      return applyOne(doc, { op: 'add', path: op.path, value });
    }
    case 'copy': {
      const value = readValue(doc, parsePointer(op.from));
      return applyOne(doc, { op: 'add', path: op.path, value });
    }
    case 'test': {
      const value = readValue(doc, tokens);
      if (JSON.stringify(value) !== JSON.stringify(op.value)) {
        throw new Error(`test 失败：${op.path} 期望 ${JSON.stringify(op.value)}，实际 ${JSON.stringify(value)}`);
      }
      return doc;
    }
    /* ------------------------------------------------- semantic extensions */
    case 'setRig': {
      const obj = readValue(doc, tokens);
      if (!obj || obj.kind !== 'humanoid') throw new Error('setRig 只能用于 kind=humanoid 的对象');
      obj.rig = { ...(obj.rig || {}), ...deepClone(op.value) };
      return doc;
    }
    case 'addPart': {
      const obj = readValue(doc, tokens);
      if (!obj) throw new Error('addPart 目标不存在');
      obj.parts = obj.parts || [];
      obj.parts.push(deepClone(op.value));
      if (!obj.kind) obj.kind = 'part';
      return doc;
    }
    case 'removePart': {
      const obj = readValue(doc, tokens);
      if (!obj?.parts) throw new Error('removePart 目标没有 parts');
      const before = obj.parts.length;
      obj.parts = obj.parts.filter((p) => (p.id ?? p.prim?.type) !== op.partId);
      if (obj.parts.length === before) throw new Error(`找不到部件 "${op.partId}"`);
      return doc;
    }
    case 'setMaterial': {
      doc.materials = doc.materials || {};
      doc.materials[op.name] = { ...(doc.materials[op.name] || {}), ...deepClone(op.value) };
      return doc;
    }
    default:
      throw new Error(`未知操作 "${op.op}"`);
  }
}

function readValue(doc, tokens) {
  let cur = doc;
  for (const k of tokens) {
    if (cur == null) throw new Error(`路径不存在：${formatPointer(tokens)}`);
    cur = cur[k];
  }
  return cur;
}

export function applyPatch(doc, patch) {
  const ops = Array.isArray(patch) ? patch : [patch];
  let out = deepClone(doc);
  ops.forEach((op, i) => {
    try {
      out = applyOne(out, op);
    } catch (e) {
      throw new Error(`patch[${i}] ${op.op} ${op.path ?? ''}: ${e.message}`);
    }
  });
  return out;
}

export function tryApplyPatch(doc, patch) {
  try {
    return { ok: true, doc: applyPatch(doc, patch) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ----------------------------------------------------------------- diff */

/** Produce a minimal-ish patch by comparing two documents recursively. */
export function diffDocuments(a, b, path = '') {
  const ops = [];
  if (a === b) return ops;
  const bothObj = isObj(a) && isObj(b) && !Array.isArray(a) && !Array.isArray(b);
  if (!bothObj) {
    if (Array.isArray(a) && Array.isArray(b)) {
      if (JSON.stringify(a) === JSON.stringify(b)) return ops;
      // whole-array replace is simpler and usually smaller for short arrays
      return [{ op: 'replace', path: path || '', value: b }];
    }
    return [{ op: 'replace', path: path || '', value: b }];
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const p = `${path}/${String(k).replace(/~/g, '~0').replace(/\//g, '~1')}`;
    if (!(k in a)) ops.push({ op: 'add', path: p, value: b[k] });
    else if (!(k in b)) ops.push({ op: 'remove', path: p });
    else ops.push(...diffDocuments(a[k], b[k], p));
  }
  return ops;
}

/** Human-readable summary of a patch, for UI review before applying. */
export function describePatch(patch, doc) {
  const ops = Array.isArray(patch) ? patch : [patch];
  return ops.map((op) => {
    if (op.op === 'setRig') {
      const keys = Object.entries(op.value || {}).map(([k, v]) => `${k}=${v}`).join(', ');
      return `调整人物参数 @${op.path}：${keys}`;
    }
    if (op.op === 'addPart') return `添加部件 ${op.value?.id ?? op.value?.prim?.type} @${op.path}`;
    if (op.op === 'removePart') return `移除部件 ${op.partId} @${op.path}`;
    if (op.op === 'setMaterial') return `设置材质 ${op.name}`;
    return `${op.op} ${op.path ?? ''}`;
  });
}
