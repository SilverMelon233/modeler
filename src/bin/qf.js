#!/usr/bin/env node
/**
 * qf — QuadForge command line.
 *
 *   qf validate <doc>                      校验 .quadforge 文档
 *   qf stats <doc> [--json]                网格统计 + 水密性/法线 QA
 *   qf compile <doc> [-o out.stl]          编译导出 stl / obj / glb
 *   qf patch <doc> <patch.json> [-o out]    JSON Patch 增量修改
 *   qf materialize <doc> [-o out.json]     配方 → 可编辑网格文档
 *   qf schema                              输出 JSON Schema
 *
 * Deterministic, machine-readable with --json, non-zero exit on failure.
 * This is the interface an LLM agent is expected to drive.
 */
import fs from 'node:fs';
import path from 'node:path';
import { compileDocument } from '../core/recipe.js';
import { validateDocument, validateGeometry, formatErrors, SCHEMA } from '../core/schema.js';
import { applyPatch, describePatch, diffDocuments } from '../core/patch.js';
import { meshReport } from '../core/checks.js';
import { toSTL, toOBJ, toGLTF } from '../core/exporters.js';
import { joinMeshes } from '../core/mesh.js';

const argv = process.argv.slice(2);
const cmd = argv[0];
const rest = argv.slice(1);
const flags = parseFlags(rest);
const positional = rest.filter((a) => !a.startsWith('-'));

function parseFlags(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) out[k] = v;
      else if (list[i + 1] && !list[i + 1].startsWith('-')) out[k] = list[++i];
      else out[k] = true;
    } else if (/^-[a-z]$/.test(a)) {
      const k = a.slice(1);
      if (list[i + 1] && !list[i + 1].startsWith('-')) out[k] = list[++i];
      else out[k] = true;
    }
  }
  return out;
}

const isJSON = !!flags.json;
const log = (...a) => { if (!isJSON) console.log(...a); };
const ok = (data) => { if (isJSON) console.log(JSON.stringify({ ok: true, ...data }, null, 2)); };
const fail = (msg, extra = {}, code = 1) => {
  if (isJSON) console.log(JSON.stringify({ ok: false, error: msg, ...extra }, null, 2));
  else console.error('✗ ' + msg);
  process.exit(code);
};

function readJSON(file) {
  if (!file) fail('缺少输入文件');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`无法读取 ${file}：${e.message}`);
  }
}

function checkDoc(doc, file, { quiet = false } = {}) {
  const v = validateDocument(doc);
  const g = validateGeometry(doc);
  const all = [...v.errors, ...g.issues];
  if (all.length) {
    fail(`文档校验失败（${all.length} 个问题）`, { file, errors: all });
    if (!quiet) console.error(formatErrors(all));
  }
  return doc;
}

function writeOut(file, data) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, data);
}

/* ---------------------------------------------------------------- commands */

switch (cmd) {
  case 'validate': {
    const file = positional[0];
    const doc = readJSON(file);
    const v = validateDocument(doc);
    const g = validateGeometry(doc);
    const all = [...v.errors, ...g.issues];
    if (all.length) fail(`校验失败（${all.length} 个问题）`, { file, errors: all });
    log(`✓ ${file} 校验通过 · ${doc.objects.length} 个对象`);
    ok({ file, objects: doc.objects.length, errors: [] });
    break;
  }

  case 'stats': {
    const file = positional[0];
    const doc = checkDoc(readJSON(file), file);
    const { objects, warnings } = compileDocument(doc);
    const rows = objects.map((o) => ({ id: o.id, name: o.name, ...meshReport(o.mesh) }));
    if (isJSON) {
      console.log(JSON.stringify({ ok: true, file, objects: rows, warnings }, null, 2));
    } else {
      for (const r of rows) {
        console.log(`\n■ ${r.id}  (${r.name})`);
        console.log(`  顶点 ${r.verts} · 面 ${r.faces} · 三角 ${r.tris}`);
        console.log(`  水密 ${r.watertight ? '✓' : '✗'} · 开放边 ${r.openEdges} · 非流形 ${r.nonManifoldEdges}`);
        console.log(`  法线朝外 ${Math.round(r.outwardRatio * 100)}% · 体积 ${r.volume} m³`);
        console.log(`  尺寸 ${r.size.join(' × ')} m`);
        for (const w of r.warnings) console.log(`  ! ${w}`);
      }
      for (const w of warnings) console.error('! ' + w);
    }
    break;
  }

  case 'compile': {
    const file = positional[0];
    const doc = checkDoc(readJSON(file), file);
    let format = (flags.format || flags.f || '').toLowerCase();
    if (!format && flags.o) format = path.extname(flags.o).slice(1).toLowerCase();
    format = format || 'stl';
    const outFile = flags.o || flags.output || `out.${format}`;
    const t0 = Date.now();
    const { objects, warnings } = compileDocument(doc);
    for (const w of warnings) console.error('! ' + w);
    const merged = objects.length === 1 ? objects[0].mesh : joinMeshes(objects[0].mesh, objects.slice(1).reduce((a, o) => joinMeshes(a, o.mesh), { verts: [], faces: [] }));
    let data;
    if (format === 'stl') data = toSTL(merged, doc.meta?.title || 'quadforge');
    else if (format === 'obj') data = toOBJ(objects);
    else if (format === 'glb' || format === 'gltf') data = toGLTF(objects, { binary: format === 'glb' });
    else fail(`不支持的格式 "${format}"，可用：stl / obj / glb / gltf`);
    writeOut(outFile, data);
    const ms = Date.now() - t0;
    const mb = (data.byteLength / 1048576).toFixed(2);
    log(`✓ ${outFile} · ${format.toUpperCase()} · ${merged.verts.length} 顶点 · ${mb} MB · ${ms}ms`);
    ok({ file: outFile, format, objects: objects.length, verts: merged.verts.length, bytes: data.byteLength, ms });
    break;
  }

  case 'patch': {
    const file = positional[0];
    const patchFile = positional[1];
    if (!patchFile) fail('用法：qf patch <doc.json> <patch.json> [-o out.json]');
    const doc = checkDoc(readJSON(file), file);
    const patch = readJSON(patchFile);
    let next;
    try {
      next = applyPatch(doc, patch);
    } catch (e) {
      fail('补丁应用失败：' + e.message, { file });
    }
    // validate the result, and report regressions rather than silently writing
    const v = validateDocument(next);
    const g = validateGeometry(next);
    const all = [...v.errors, ...g.issues];
    if (all.length) fail('补丁结果未通过校验', { file, errors: all });
    const outFile = flags.o || file;
    writeOut(outFile, JSON.stringify(next, null, 2));
    log(`✓ 已应用 ${Array.isArray(patch) ? patch.length : 1} 个操作 → ${outFile}`);
    for (const d of describePatch(patch, doc)) log('  · ' + d);
    ok({ file: outFile, ops: Array.isArray(patch) ? patch.length : 1, changes: describePatch(patch, doc) });
    break;
  }

  case 'diff': {
    const a = readJSON(positional[0]);
    const b = readJSON(positional[1]);
    const patch = diffDocuments(a, b);
    if (isJSON || flags.o) {
      const payload = JSON.stringify(patch, null, 2);
      if (flags.o) { writeOut(flags.o, payload); ok({ file: flags.o, ops: patch.length }); }
      else console.log(payload);
    } else {
      console.log(`${patch.length} 个差异操作：`);
      for (const l of describePatch(patch, a)) console.log('  · ' + l);
    }
    break;
  }

  case 'materialize': {
    const file = positional[0];
    const doc = checkDoc(readJSON(file), file);
    const { objects } = compileDocument(doc);
    const out = {
      schema: 'quadforge/1',
      version: 1,
      unit: doc.unit || 'm',
      meta: { ...(doc.meta || {}), materializedFrom: path.basename(file) },
      materials: {},
      objects: objects.map((o) => ({
        id: o.id,
        name: o.name,
        kind: 'mesh',
        mesh: { verts: o.mesh.verts.map((v) => v.map((n) => +n.toFixed(6))), faces: o.mesh.faces },
        materialInline: o.material,
        subdiv: 0,
      })),
    };
    const outFile = flags.o || file.replace(/\.json$/, '') + '.mesh.json';
    writeOut(outFile, JSON.stringify(out));
    log(`✓ 已烘焙 ${objects.length} 个对象 → ${outFile}（${(fs.statSync(outFile).size / 1024).toFixed(0)} KB）`);
    ok({ file: outFile, objects: objects.length });
    break;
  }

  case 'schema': {
    console.log(JSON.stringify(SCHEMA, null, 2));
    break;
  }

  case 'help':
  case undefined:
  case '--help':
  case '-h':
    console.log(`QuadForge CLI — 面向 LLM 的 3D 建模格式工具

用法：
  qf validate <doc>                      校验文档（schema + 几何语义）
  qf stats <doc> [--json]                网格统计、水密性、法线检查
  qf compile <doc> [-o out.stl]          编译导出（stl | obj | glb）
  qf patch <doc> <patch.json> [-o out]   应用 JSON Patch 增量修改
  qf diff <a.json> <b.json> [-o patch]   比较两份文档，生成补丁
  qf materialize <doc> [-o out.json]     配方烘焙为纯网格文档
  qf schema                              输出 JSON Schema

示例：
  qf validate examples/hero.quadforge.json
  qf compile  examples/hero.quadforge.json -o hero.glb
  qf stats    examples/hero.quadforge.json
  qf patch    examples/hero.quadforge.json patches/muscular.json -o hero2.json
`);
    if (cmd && !['help', '--help', '-h'].includes(cmd)) {
      console.error(`未知命令 "${cmd}"`);
      process.exit(1);
    }
    break;

  default:
    fail(`未知命令 "${cmd}"，运行 qf help 查看用法`);
}
