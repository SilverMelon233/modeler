# QuadForge

浏览器里的参数化 3D 建模工作台，同时是一个**面向 LLM 的 3D 格式工具链**。

- 四边形建模内核：Catmull-Clark 细分、挤出、内插、镜像、雕刻笔刷
- 参数化人物生成器：一副骨架参数生成水密人形壳体（含五指手、脚、五官、头发、护甲）
- CSG 布尔：并集 / 差集 / 交集，输出自动修复为水密实体
- `.quadforge/1` 开放格式 + JSON Patch 增量修改协议 + CLI + JSON Schema
- 导出 STL / OBJ / glTF / GLB

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # 产出 dist/
npm test             # 59 个内核 + CLI 测试
```

---

## 为什么要有 `.quadforge`

直接把网格交给 LLM 编辑是行不通的：一个 2 万面的角色约 30 万字符，超出任何上下文，而且"改一个顶点"没有语义。

`.quadforge` 把模型描述成**参数化配方**：

```jsonc
{ "id": "hero", "kind": "humanoid",
  "rig": { "height": 1.8, "build": 0.6, "muscle": 0.8 } }
```

一个角色 200–800 token。改"更壮一点"就是改 `build`，改"换成机甲"就是 `armor: true`。
完整规范见 [docs/FORMAT.md](docs/FORMAT.md)。

---

## GUI

| 模式 | 能力 |
|---|---|
| **对象** | 选择 / 多选、移动旋转缩放 gizmo、材质、细分级别 0–3、布尔运算 |
| **建模** | 点选 / 框选面、挤出（X）、内插（I）、细分面（S）、镜像 X（M）、删面、整体光滑 |
| **雕刻** | 膨胀 / 平滑 / 压平 / 挤压笔刷，可调半径与强度，Alt 反向 |

快捷键：`1/2/3` 切换模式，`G` 生成人物，`F` 聚焦，`W/E/R` 变换，`Ctrl+Z` 撤销，`Ctrl+D` 复制，`Ctrl+S` 保存工程。

---

## CLI

```bash
node src/bin/qf.js validate examples/hero.quadforge.json
node src/bin/qf.js stats    examples/hero.quadforge.json
node src/bin/qf.js compile  examples/hero.quadforge.json -o hero.glb
node src/bin/qf.js patch    examples/hero.quadforge.json examples/patches/muscular.json -o hero2.json
```

`qf stats` 是质量闸门：

```
■ hero  (哨兵)
  顶点 10210 · 面 10024 · 三角 20048
  水密 ✓ · 开放边 0 · 非流形 0
  法线朝外 59% · 体积 0.181708 m³
  尺寸 1.1602 × 1.818 × 0.382 m
```

---

## 架构

```
src/core/            无渲染依赖的几何内核（Node 与浏览器共用）
  mesh.js            四边形/多边形拓扑、Catmull-Clark、挤出、雕刻、CSG 修复
  primitives.js      11 种图元（含 loft / tube / extrude）
  character.js       参数化人物生成器
  booleans.js        three-bvh-csg 封装
  recipe.js          .quadforge 编译器
  schema.js          JSON Schema + 校验器
  patch.js           JSON Patch + 语义操作
  checks.js          水密性 / 非流形 / 体积 / 绕序检查
  exporters.js       STL / OBJ / GLTF（零依赖，纯 JS）
  transform.js       4×4 矩阵与烘焙
  cut.js             平面切割 + 封盖
src/editor/          three.js 视口、对象层、交互控制器
src/ui/              面板与控件（原生 DOM，无框架）
src/bin/qf.js        CLI
tests/               59 个测试
docs/FORMAT.md       格式规范
```

内核不依赖 three.js 的部分（`mesh` / `primitives` / `checks` / `exporters` / `transform`）可以在 Node 里独立使用，这正是 CLI 能跑的原因。

---

## 已知取舍

- **CSG 是三角形而非四边形**：`three-bvh-csg` 输出三角网格，布尔结果无法再被干净地细分。需要四边形的部件请用 `merge` 而非布尔。
- **人物是单壳体**：没有骨骼、没有 UV、没有表情混合形状。要动画请导出 glTF 后在 DCC 里绑定。
- **雕刻不改拓扑**：笔刷只移动顶点，需要先细分到 2–3 级再刻细节。
- **`loft` 半轴 vs `roundedBox` 全尺寸**：历史约定不一致，规范里已显式标注。
