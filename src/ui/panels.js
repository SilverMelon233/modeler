import { el, slider, toggle, colorField, segmented, fmt, icon, numberInput, field } from './dom.js';
import { CHAR_DEFAULTS } from '../core/character.js';

const ICONS = {
  select: '<path d="M4 3l7 17 2.5-6.5L20 11z"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="M12 3l3 3M12 3L9 6M12 21l3-3M12 21l-3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>',
  scale: '<path d="M4 20L20 4"/><path d="M14 4h6v6M10 20H4v-6"/>',
  cube: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 12l9-5M12 12L3 7M12 12v10"/>',
  edit: '<path d="M4 20l4-1 10-10-3-3L5 16z"/><path d="M14 6l3 3"/>',
  sculpt: '<circle cx="12" cy="12" r="8"/><path d="M9 9c1 1 5 1 6 0M9 15c1.5-1 4.5-1 6 0"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h9a7 7 0 0 1 0 14H8"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9h-9a7 7 0 0 0 0 14h5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  export: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  person: '<circle cx="12" cy="7" r="4"/><path d="M4 21c0-4 3.5-6 8-6s8 2 8 6"/>',
  extrude: '<path d="M4 8h10v10H4z"/><path d="M4 8l5-4h10v10l-5 4M14 8l5-4M14 18l5-4"/>',
  inset: '<rect x="3" y="3" width="18" height="18" rx="1"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  subdiv: '<rect x="3" y="3" width="18" height="18"/><path d="M12 3v18M3 12h18"/>',
  mirror: '<path d="M12 3v18" stroke-dasharray="3 3"/><path d="M9 7L4 12l5 5zM15 7l5 5-5 5z"/>',
  smooth: '<path d="M3 16c3-6 6 6 9 0s6-6 9 0" />',
  del: '<path d="M4 4l16 16M20 4L4 20"/>',
};

export function buildUI(app) {
  const root = document.getElementById('ui');

  /* ------------------------------------------------------------- topbar */
  const brand = el('div', { class: 'brand' },
    el('div', { class: 'logo' }, icon('<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 12l9-5M12 12L3 7M12 12v10" stroke-width="1.3"/>', 22)),
    el('div', { class: 'brand-text' },
      el('strong', {}, 'QuadForge'),
      el('span', {}, '浏览器 3D 建模工作台'),
    ),
  );

  const modeBar = el('div', { class: 'modebar' });
  const modes = [
    { id: 'object', label: '对象', ic: ICONS.select, key: '1' },
    { id: 'edit', label: '建模', ic: ICONS.edit, key: '2' },
    { id: 'sculpt', label: '雕刻', ic: ICONS.sculpt, key: '3' },
  ];
  const modeButtons = modes.map((m) => el('button', {
    class: 'mode-btn', title: `${m.label}模式 (${m.key})`,
    onclick: () => app.setMode(m.id),
  }, icon(m.ic, 16), el('span', {}, m.label)));
  modeBar.append(...modeButtons);

  const topActions = el('div', { class: 'top-actions' });
  const undoBtn = el('button', { class: 'icon-btn', title: '撤销 (Ctrl+Z)', onclick: () => app.undo() }, icon(ICONS.undo, 17));
  const redoBtn = el('button', { class: 'icon-btn', title: '重做 (Ctrl+Shift+Z)', onclick: () => app.redo() }, icon(ICONS.redo, 17));
  const exportBtn = el('button', { class: 'btn primary', onclick: () => openExport() }, icon(ICONS.export, 15), '导出');
  const importBtn = el('button', { class: 'btn ghost', title: '打开 .quadforge.json', onclick: () => openImport() }, icon(ICONS.folder, 15), '打开');
  topActions.append(importBtn, undoBtn, redoBtn, exportBtn);

  const topbar = el('header', { class: 'topbar' }, brand, modeBar, topActions);

  /* ------------------------------------------------------------- sidebar */
  const sidebar = el('aside', { class: 'sidebar' });

  const sectionAdd = el('div', { class: 'panel' });
  const addGrid = el('div', { class: 'shape-grid' });
  const shapes = [
    { kind: 'cube', label: '立方体', ic: ICONS.cube },
    { kind: 'sphere', label: '球体', ic: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c4 2 4 16 0 18M12 3c-4 2-4 16 0 18"/>' },
    { kind: 'cylinder', label: '圆柱', ic: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/>' },
    { kind: 'cone', label: '圆锥', ic: '<ellipse cx="12" cy="18" rx="7" ry="3"/><path d="M5 18L12 4l7 14"/>' },
    { kind: 'torus', label: '圆环', ic: '<ellipse cx="12" cy="12" rx="9" ry="5"/><ellipse cx="12" cy="12" rx="4" ry="2"/>' },
    { kind: 'capsule', label: '胶囊', ic: '<rect x="7" y="3" width="10" height="18" rx="5"/>' },
    { kind: 'rounded', label: '圆角盒', ic: '<rect x="4" y="4" width="16" height="16" rx="4"/>' },
    { kind: 'plane', label: '平面', ic: '<path d="M3 8l9-4 9 4-9 4z"/><path d="M3 16l9 4 9-4"/>' },
  ];
  for (const s of shapes) {
    addGrid.append(el('button', {
      class: 'shape-btn',
      title: `添加${s.label}`,
      onclick: () => app.addPrimitive(s.kind),
    }, icon(s.ic, 22), el('span', {}, s.label)));
  }
  const charBtn = el('button', {
    class: 'wide-btn accent',
    onclick: () => {
      app.addCharacter(charState);
      renderInspector();
    },
  }, icon(ICONS.person, 18), el('span', {}, '生成人物模型'), el('kbd', {}, 'G'));

  sectionAdd.append(el('h3', {}, '添加形体'), addGrid, charBtn);

  /* ---- character params ---- */
  const charState = { ...CHAR_DEFAULTS };
  const charPanel = el('div', { class: 'panel collapsible' });
  const charBody = el('div', { class: 'panel-body' });
  const charHead = el('h3', { class: 'collapsible-head' }, el('span', {}, '人物参数'), el('i', { class: 'chev' }));
  charHead.onclick = () => charPanel.classList.toggle('open');
  charPanel.append(charHead, charBody);

  const buildCharBody = () => {
    charBody.innerHTML = '';
    charBody.append(
      slider({ label: '身高', value: charState.height, min: 1.2, max: 2.4, step: 0.01, unit: 'm', onInput: (v) => { charState.height = v; } }),
      slider({ label: '体格', value: charState.build, min: 0, max: 1, onInput: (v) => { charState.build = v; } }),
      slider({ label: '肌肉', value: charState.muscle, min: 0, max: 1, onInput: (v) => { charState.muscle = v; } }),
      slider({ label: '头身比', value: charState.headScale, min: 0.75, max: 1.35, onInput: (v) => { charState.headScale = v; } }),
      slider({ label: '肩宽', value: charState.shoulder, min: 0, max: 1, onInput: (v) => { charState.shoulder = v; } }),
      slider({ label: '腰腹', value: charState.belly, min: 0, max: 1, onInput: (v) => { charState.belly = v; } }),
      slider({ label: '胯宽', value: charState.hips, min: 0, max: 1, onInput: (v) => { charState.hips = v; } }),
      slider({ label: '胸型', value: charState.bust, min: 0, max: 1, onInput: (v) => { charState.bust = v; } }),
      slider({ label: '臂长', value: charState.armLength, min: 0.8, max: 1.2, onInput: (v) => { charState.armLength = v; } }),
      slider({ label: '腿长', value: charState.legLength, min: 0.8, max: 1.2, onInput: (v) => { charState.legLength = v; } }),
      el('p', { class: 'note' }, '单块连续网格：参数只移动顶点，拓扑不变，因此可安全细分与雕刻。头发与服装属于外观层，不并入身体网格。'),
      el('button', {
        class: 'wide-btn',
        onclick: () => {
          const obj = app.active;
          if (obj?.parentCharacter) {
            app.rebuildCharacter(obj, charState);
            app.commitHistory('修改人物');
            app.toast('已重建角色');
          } else {
            app.toast('请先选中一个角色模型');
          }
        },
      }, '应用参数'),
    );
  };
  buildCharBody();
  charPanel.classList.add('open');

  /* ---- scene tree ---- */
  const treePanel = el('div', { class: 'panel grow' });
  const treeBody = el('div', { class: 'tree' });
  treePanel.append(el('h3', {}, '场景', el('span', { class: 'count', id: 'obj-count' }, '0')), treeBody);

  sidebar.append(sectionAdd, charPanel, treePanel);

  /* ------------------------------------------------------------- toolbar */
  const toolbar = el('div', { class: 'toolbar' });
  const toolButtons = {};
  const toolDefs = {
    object: [
      { id: 'translate', ic: ICONS.move, label: '移动', key: 'W' },
      { id: 'rotate', ic: ICONS.rotate, label: '旋转', key: 'E' },
      { id: 'scale', ic: ICONS.scale, label: '缩放', key: 'R' },
    ],
    edit: [
      { id: 'selectFace', ic: ICONS.select, label: '选面', key: 'Q' },
      { id: 'extrude', ic: ICONS.extrude, label: '挤出', key: 'X', apply: () => app.applyEdit('extrude', { distance: 0.06 }) },
      { id: 'inset', ic: ICONS.inset, label: '内插', key: 'I', apply: () => app.applyEdit('inset', { amount: 0.22 }) },
      { id: 'subdivide', ic: ICONS.subdiv, label: '细分面', key: 'S', apply: () => app.applyEdit('subdivide') },
      { id: 'mirror', ic: ICONS.mirror, label: '镜像X', key: 'M', apply: () => app.applyEdit('mirror') },
    ],
    sculpt: [
      { id: 'inflate', ic: ICONS.sculpt, label: '膨胀', key: 'B' },
      { id: 'smooth', ic: ICONS.smooth, label: '平滑', key: 'S' },
      { id: 'flatten', ic: ICONS.smooth, label: '压平', key: 'F' },
      { id: 'pinch', ic: ICONS.inset, label: '挤压', key: 'P' },
    ],
  };

  const rebuildToolbar = () => {
    toolbar.innerHTML = '';
    const defs = toolDefs[app.mode] || toolDefs.object;
    const group = el('div', { class: 'tool-group' });
    for (const t of defs) {
      const b = el('button', {
        class: 'tool-btn' + ((app.mode === 'sculpt' ? app.sculpt.mode : app.tool) === t.id ? ' on' : ''),
        title: `${t.label} (${t.key})`,
        onclick: () => {
          if (app.mode === 'sculpt') {
            app.sculpt.mode = t.id;
          } else if (app.mode === 'object' && ['translate', 'rotate', 'scale'].includes(t.id)) {
            app.transformMode = t.id === 'translate' ? 'translate' : t.id === 'rotate' ? 'rotate' : 'scale';
            app.viewport?.setGizmoMode(t.id);
          } else if (t.apply) {
            // modelling verbs act immediately on the current face selection
            t.apply();
            rebuildToolbar();
            return;
          } else {
            app.tool = t.id;
          }
          rebuildToolbar();
        },
      }, icon(t.ic, 18), el('span', {}, t.label));
      b.dataset.tool = t.id;
      group.append(b);
    }
    toolbar.append(group);

    if (app.mode === 'edit') {
      toolbar.append(el('div', { class: 'tool-sep' }));
      toolbar.append(el('div', { class: 'tool-group' },
        el('button', { class: 'tool-btn danger', title: '删除所选面', onclick: () => app.applyEdit('delete') }, icon(ICONS.del, 17), el('span', {}, '删面')),
        el('button', { class: 'tool-btn', title: '整体细分一次', onclick: () => app.applyEdit('smoothAll') }, icon(ICONS.smooth, 17), el('span', {}, '光滑')),
      ));
      toolbar.append(el('div', { class: 'toolbar-tip' }, 'Tip: 拖动框选面，Shift 加选；X 挤出，I 内插'));
    } else if (app.mode === 'sculpt') {
      toolbar.append(el('div', { class: 'tool-sep' }));
      toolbar.append(el('div', { class: 'sculpt-opts' },
        slider({ label: '半径', value: app.sculpt.radius, min: 0.02, max: 0.5, onInput: (v) => (app.sculpt.radius = v) }),
        slider({ label: '强度', value: app.sculpt.strength, min: 0.001, max: 0.08, step: 0.001, onInput: (v) => (app.sculpt.strength = v) }),
      ));
      toolbar.append(el('div', { class: 'toolbar-tip' }, '按住左键涂抹，Alt 反向，建议先细分到 2–3 级'));
    } else {
      toolbar.append(el('div', { class: 'toolbar-tip' }, '点击选择，Shift 多选；顶部工具栏切换移动/旋转/缩放'));
    }
  };
  rebuildToolbar();

  /* ----------------------------------------------------------- inspector */
  const inspector = el('aside', { class: 'inspector' });
  const renderInspector = () => {
    inspector.innerHTML = '';
    const obj = app.active;
    const multi = app.selection.size > 1;

    if (!obj) {
      inspector.append(
        el('div', { class: 'empty-state' },
          el('div', { class: 'empty-ic' }, icon(ICONS.cube, 30)),
          el('h4', {}, '选择一个对象'),
          el('p', {}, '从左栏添加形体，或点击“生成人物模型”开始塑造复杂角色。'),
          el('div', { class: 'kbd-list' },
            el('div', {}, el('kbd', {}, '1/2/3'), '切换 对象 / 建模 / 雕刻'),
            el('div', {}, el('kbd', {}, 'G'), '生成人物'),
            el('div', {}, el('kbd', {}, 'F'), '聚焦选中'),
            el('div', {}, el('kbd', {}, 'Ctrl+Z'), '撤销'),
          ),
        ),
      );
      return;
    }

    if (multi) {
      const header = el('div', { class: 'insp-header' },
        el('div', { class: 'insp-title' }, el('strong', {}, `${app.selection.size} 个对象`)),
      );
      inspector.append(header, el('div', { class: 'panel' },
        el('h3', {}, '合并布尔'),
        el('div', { class: 'btn-row' },
          el('button', { class: 'btn', onclick: () => app.applyBoolean('union') }, '并集'),
          el('button', { class: 'btn', onclick: () => app.applyBoolean('subtract') }, '差集'),
          el('button', { class: 'btn', onclick: () => app.applyBoolean('intersect') }, '交集'),
        ),
      ));
      return;
    }

    const header = el('div', { class: 'insp-header' },
      el('input', {
        class: 'name-input', value: obj.name, spellcheck: false,
        onchange: (e) => { obj.name = e.target.value || '对象'; app.refresh(); },
      }),
      el('div', { class: 'insp-meta' }, `${obj.mesh.verts.length} 顶点 · ${obj.mesh.faces.length} 面`),
    );

    const geo = obj.getBounds();

    const matPanel = el('div', { class: 'panel' }, el('h3', {}, '材质'));
    matPanel.append(
      colorField({ label: '颜色', value: obj.material.color, onChange: (v) => { obj.material.color = v; app.refresh(); } }),
      slider({ label: '金属度', value: obj.material.metalness, min: 0, max: 1, onInput: (v) => { obj.material.metalness = v; app.refresh(); } }),
      slider({ label: '粗糙度', value: obj.material.roughness, min: 0, max: 1, onInput: (v) => { obj.material.roughness = v; app.refresh(); } }),
      slider({ label: '透明度', value: obj.material.opacity, min: 0.05, max: 1, onInput: (v) => { obj.material.opacity = v; app.refresh(); } }),
      toggle({ label: '平面着色', value: obj.material.flat, onChange: (v) => { obj.material.flat = v; app.refresh(); } }),
    );

    const subPanel = el('div', { class: 'panel' }, el('h3', {}, '细分曲面'));
    subPanel.append(
      segmented({
        options: [0, 1, 2, 3].map((n) => ({ label: n === 0 ? '原样' : `L${n}`, value: n })),
        value: obj.subdiv, onChange: (v) => {
          obj.subdiv = v;
          obj.invalidate();
          app.refresh();
          app.commitHistory('细分级别');
        },
      }),
      el('p', { class: 'note' }, 'Catmull-Clark 细分：每提升一级，面数 ×4。L2 可雕刻，L3 用于出图。'),
    );

    const transPanel = el('div', { class: 'panel' }, el('h3', {}, '变换'));
    const vecRow = (label, arr, onChange, step = 0.01) => {
      const inputs = [0, 1, 2].map((i) => el('input', {
        class: 'vec-input', type: 'number', step, value: +arr[i].toFixed(3),
        oninput: (e) => { arr[i] = parseFloat(e.target.value) || 0; onChange(); },
      }));
      return el('div', { class: 'vec-row' }, el('label', {}, label), ...inputs.map((inp, i) =>
        el('span', { class: 'vec-cell' }, el('b', {}, 'XYZ'[i]), inp)));
    };
    transPanel.append(
      vecRow('位置', obj.transform.position, () => app.refresh()),
      vecRow('旋转', obj.transform.rotation, () => app.refresh(), 0.05),
      vecRow('缩放', obj.transform.scale, () => app.refresh()),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn small', onclick: () => { obj.transform.position = [0, geo.min[1], 0]; app.refresh(); app.commitHistory('落地'); } }, '落地'),
        el('button', { class: 'btn small', onclick: () => { obj.transform.rotation = [0, 0, 0]; obj.transform.scale = [1, 1, 1]; app.refresh(); } }, '重置'),
      ),
    );

    if (obj.parentCharacter) {
      const cp = el('div', { class: 'panel' }, el('h3', {}, '人物绑定'));
      const set = (k, v) => { obj.parentCharacter[k] = v; };
      cp.append(
        slider({ label: '体格', value: obj.parentCharacter.build, min: 0, max: 1, onInput: (v) => set('build', v) }),
        slider({ label: '肌肉', value: obj.parentCharacter.muscle, min: 0, max: 1, onInput: (v) => set('muscle', v) }),
        slider({ label: '头身比', value: obj.parentCharacter.headScale, min: 0.75, max: 1.35, onInput: (v) => set('headScale', v) }),
        el('button', { class: 'wide-btn', onclick: () => {
          app.rebuildCharacter(obj, obj.parentCharacter);
          app.commitHistory('人物重塑');
        } }, '重新生成模型'),
      );
      inspector.append(header, cp, matPanel, subPanel, transPanel);
    } else {
      inspector.append(header, matPanel, subPanel, transPanel);
    }
  };

  /* ------------------------------------------------------------- statusbar */
  const statusLeft = el('div', { class: 'status-left' });
  const statusRight = el('div', { class: 'status-right' });
  const statusbar = el('footer', { class: 'statusbar' }, statusLeft, statusRight);

  /* ------------------------------------------------------------- layout */
  root.append(
    el('div', { class: 'app' },
      topbar,
      el('div', { class: 'main' },
        sidebar,
        el('div', { class: 'stage' }, el('div', { class: 'canvas-wrap', id: 'canvas' }), toolbar),
        inspector,
      ),
      statusbar,
    ),
  );

  document.getElementById('boot')?.remove();

  /* ------------------------------------------------------------ reactive */
  const renderTree = () => {
    treeBody.innerHTML = '';
    document.getElementById('obj-count').textContent = String(app.objects.length);
    for (const o of [...app.objects].reverse()) {
      const row = el('div', {
        class: 'tree-row' + (app.selection.has(o.id) ? ' on' : ''),
        onclick: (e) => (e.shiftKey ? app.toggleSelect(o.id) : app.select([o.id])),
        ondblclick: () => { app.select([o.id]); app.viewport?.frameObject(o); },
      },
        el('span', { class: 'dot', style: { background: o.material.color } }),
        el('span', { class: 'tree-name' }, o.name),
        el('button', {
          class: 'mini-btn' + (o.visible ? '' : ' off'),
          title: o.visible ? '隐藏' : '显示',
          onclick: (e) => { e.stopPropagation(); o.visible = !o.visible; app.refresh(); },
        }, o.visible ? '◉' : '○'),
      );
      treeBody.append(row);
    }
    if (!app.objects.length) treeBody.append(el('p', { class: 'note' }, '场景为空'));
  };

  const renderStatus = () => {
    const s = app.stats;
    statusLeft.innerHTML = '';
    statusLeft.append(
      el('span', { class: 'pill' + (app.mode === 'object' ? ' on' : '') }, app.mode === 'object' ? '对象模式' : app.mode === 'edit' ? '建模模式' : '雕刻模式'),
      el('span', {}, `${app.objects.length} 对象`),
      el('span', {}, `${s.verts.toLocaleString()} 顶点`),
      el('span', {}, `${s.faces.toLocaleString()} 面`),
      el('span', {}, `${s.tris.toLocaleString()} 三角`),
    );
    statusRight.innerHTML = '';
    statusRight.append(el('span', {}, 'QuadForge · WebGL2 · Catmull-Clark'));
  };

  const syncModeButtons = () => {
    modeButtons.forEach((b, i) => b.classList.toggle('on', modes[i].id === app.mode));
  };

  app.on('mode', () => { syncModeButtons(); rebuildToolbar(); renderInspector(); renderStatus(); });
  app.on('objects', () => { renderTree(); });
  app.on('selection', () => { renderInspector(); renderTree(); renderStatus(); });
  app.on('stats', renderStatus);
  app.on('history', () => {
    undoBtn.disabled = !app.history.length;
    redoBtn.disabled = !app.future.length;
  });

  syncModeButtons();
  renderTree(); renderInspector(); renderStatus();
  app.on('mode', () => renderInspector());
  requestAnimationFrame(() => { renderInspector(); });

  /* --------------------------------------------------------------- toasts */
  const toastWrap = el('div', { class: 'toasts' });
  document.body.append(toastWrap);
  app.on('toast', ({ msg, kind }) => {
    const t = el('div', { class: 'toast ' + kind }, msg);
    toastWrap.append(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, 2600);
  });

  /* -------------------------------------------------------------- dialogs */
  function openExport() {
    const dlg = el('div', { class: 'modal-back' });
    const close = () => dlg.remove();
    dlg.onclick = (e) => { if (e.target === dlg) close(); };
    const rows = [
      ['STL（3D 打印）', () => app.exportMesh('stl')],
      ['OBJ（通用交换）', () => app.exportMesh('obj')],
      ['glTF / GLB（网页 / 引擎）', () => app.exportMesh('glb')],
      ['QuadForge 工程（保留四边形与参数）', () => app.exportMesh('json')],
    ];
    const list = el('div', { class: 'export-list' });
    for (const [label, fn] of rows) {
      list.append(el('button', { class: 'export-row', onclick: () => { fn(); close(); } },
        el('span', {}, label), el('b', {}, '↧')));
    }
    dlg.append(el('div', { class: 'modal' },
      el('h3', {}, '导出模型'),
      el('p', { class: 'note' }, app.selected.length ? `导出选中 ${app.selected.length} 个对象（按当前细分级别烘焙）` : '导出全部对象'),
      list,
      el('button', { class: 'btn ghost wide-btn', onclick: close }, '取消'),
    ));
    document.body.append(dlg);
  }

  function openImport() {
    const input = el('input', { type: 'file', accept: '.json,.quadforge,application/json', style: { display: 'none' } });
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try { app.importJSON(reader.result); } catch (e) { app.toast('打开失败：' + e.message, 'error'); }
      };
      reader.readAsText(f);
    };
    document.body.append(input);
    input.click();
    setTimeout(() => input.remove(), 1000);
  }

  app.ui = { rebuildToolbar, renderInspector, openExport, openImport, renderStatus };
  return app.ui;
}
