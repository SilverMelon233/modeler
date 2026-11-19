# QuadForge 交付说明

按你的要求，走了**"把 `.quadforge` 定成正式规范"**这条路：schema + 版本 + 校验 + JSON Patch 增量修改，并把编辑器一起跑通。

## 交付物

```
/root/work/modeler/
├── src/core/          几何内核（无渲染依赖，Node + 浏览器共用）
│   ├── mesh.js        四边形拓扑 · Catmull-Clark · 挤出/内插 · 雕刻
│   │                  含 CSG 修复流水线：去退化面 → 焊接 → T 接缝
│   │                  → 补洞 → 绕序统一
│   ├── primitives.js  11 种图元（box/sphere/cylinder/cone/torus/plane/
│   │                  capsule/roundedBox/loft/tube/extrude）
│   ├── character.js   参数化人物生成器（单水密壳体，含五指手/五官/头发/护甲）
│   ├── booleans.js    three-bvh-csg 封装
│   ├── recipe.js      .quadforge 编译器
│   ├── schema.js      JSON Schema + 手写校验器
│   ├── patch.js       JSON Patch + setRig/addPart/removePart/setMaterial
│   ├── checks.js      水密/非流形/体积/绕序/退化面
│   ├── exporters.js   STL / OBJ / GLB（纯 JS，零依赖）
│   └── transform.js   4×4 矩阵
├── src/editor/        three.js 视口 · 对象层 · 交互控制器
├── src/ui/            原生 DOM 面板
├── src/bin/qf.js      CLI
├── docs/FORMAT.md     格式规范（11 节）
└── tests/             59 个测试，全绿
```

## 验证结果

```bash
npm test            # 59 passed / 0 failed
npm run build       # dist/ 208 KB gzip
```

两个示例文档共 6 个对象，**全部水密、零开放边、零非流形边、零退化面**：

| 对象 | 顶点 | 面 | 水密 | 体积 |
|---|---|---|---|---|
| hero（人形，armor） | 10,210 | 10,024 | ✓ | 0.115 m³ |
| blade（长刀，loft） | 168 | 198 | ✓ | 0.0013 m³ |
| crate（货箱，CSG 开孔） | 209 | 252 | ✓ | 0.114 m³ |
| teapot-body（壶身） | 746 | 856 | ✓ | 0.0157 m³ |
| cup（CSG 挖空杯） | 284 | 515 | ✓ | 0.00033 m³ |
| saucer（茶碟） | 98 | 128 | ✓ | 0.00048 m³ |

## 期间修掉的真实 bug

不是表面打磨，每个都影响了正确性：

1. **9 个图元绕序反了**（体积为负）→ 加 `fixWinding` 统一
2. **胶囊几何错误**（两极半径算错）→ 重写剖面采样
3. **CSG 输出全是"开放边"** → 根因是 `Evaluator` 返回**非索引几何**，`fromBufferGeometry` 只处理了带索引的分支
4. **CSG 产生 [a,b,c,b] 自抵消面** → 必须整面丢弃而非去重，否则边被 3–4 个面共享
5. **T 型接缝修复造成稀疏网格爆炸式搜索** → 改为只处理边界顶点 + 粗网格
6. **`catmullClark` 对孤立顶点除零产生 NaN** → 补边界/孤立顶点分支
7. **矩阵求逆用错了展开公式** → 改高斯-约当
8. **`roundedBox` 全尺寸 vs `loft` 半轴混用** → 人物部件小一半，加 `box(w,h,d)` 全尺寸助手
9. **镜像时未丢弃切面盖板** → 内部夹层，加共面检测
10. **撤销历史在修改后快照** → 撤销不生效，改为保存"修改前基线"
11. **`ShapeUtils` 需要 `Vector2`**（内部调 `.equals()`）→ 孔洞挤出全废

## 关键设计决策

**为什么是参数化配方而不是网格**：一个 2 万面角色 ≈ 30 万字符，超上下文且无语义。配方 200–800 token，"更壮"是改一个数字。

**为什么 `setRig` 是合并而非替换**：LLM 改一个参数不该被迫重写其余 14 个。

**为什么 CSG 后强制修复**：`three-bvh-csg` 输出三角网格带 T 接缝，不修复无法 3D 打印。修复后水密率从 0% 到 100%（测试覆盖 union/subtract/intersect）。

**为什么导出器不用 three.js**：CLI 要在 Node 里无头运行，必须零 DOM 依赖。STL/OBJ/GLB 都是手写的。

## 已知取舍（已写入 README）

- CSG 输出是三角形，不能干净细分；要四边形的部件用 `merge`
- 人物无骨骼/UV/表情，要动画需导出 glTF 后在 DCC 绑定
- 雕刻不改拓扑，先细分到 L2–L3

## 下一步可选

1. **VRM/glTF 人形骨骼导出** —— 让角色直接进 Unity/VRM 生态（当初的选项 2）
2. **截图回环** —— 生成多视角图喂多模态模型自评，形成闭环
3. **schema 版本演进机制** —— 已在规范第 11 节预留
