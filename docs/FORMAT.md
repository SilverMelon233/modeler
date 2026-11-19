# `.quadforge` 格式规范 v1

> 面向 LLM 与程序化生成的 3D 模型描述格式。
> 目标：**让一个模型可以被几百个 token 精确描述、被增量修改、被校验、被编译成可渲染/可打印的网格。**

---

## 1. 设计原则

| 原则 | 说明 |
|---|---|
| **语义优先** | 文件描述"这是什么"（人形、长刀、带孔的箱子），不是"顶点在哪"。 |
| **增量可改** | 改"手臂长 10%" 是改一个数字，而不是重写几千行坐标。 |
| **可校验** | 有 JSON Schema + 几何语义校验，错误能定位到具体字段。 |
| **可编译** | 纯函数编译，浏览器与 Node CLI 结果逐位一致。 |
| **可降级** | 任何对象都能烘焙成 `kind: "mesh"`，方便从程序化过渡到手改。 |
| **封闭世界** | `additionalProperties: false`：写错字段名立刻报错，而不是被静默忽略。 |

**不要**把最终网格当作 LLM 的编辑格式。一个 2 万面的角色是 ~30 万字符，没有上下文装得下，且"改一个顶点"没有任何语义。

---

## 2. 文档结构

```jsonc
{
  "schema": "quadforge/1",     // 必填，固定值
  "version": 1,                // 可选
  "unit": "m",                 // 可选：m | cm | mm | in，默认 m
  "meta": {                    // 可选，自由元数据
    "title": "哨兵",
    "author": "…",
    "description": "…",
    "tags": ["character"]
  },
  "materials": {               // 可选，材质库，按名字引用
    "skin":  { "color": "#e5c3a6", "roughness": 0.68 },
    "steel": { "color": "#aab4c0", "metalness": 0.95, "roughness": 0.18 }
  },
  "objects": [ /* 见第 3 节 */ ]
}
```

所有长度单位为 `unit`，角度为**弧度**。

---

## 3. 对象：三种 `kind`

每个对象必须唯一 `id`（`^[A-Za-z0-9_.:-]+$`，≤64 字符）。这是补丁寻址的稳定锚点。

### 3.1 `kind: "humanoid"` — 参数化人物

```jsonc
{
  "id": "hero",
  "kind": "humanoid",
  "material": "skin",
  "rig": {
    "height": 1.8,      // 总身高（米），含脚底
    "build": 0.45,      // 0 瘦 … 1 壮
    "muscle": 0.55,     // 0 … 1
    "headScale": 1.0,   // 0.5 … 2
    "neck": 1.0,
    "armLength": 1.0,   // 0.5 … 2（相对臂长）
    "legLength": 1.0,
    "handSize": 1.0,
    "footSize": 1.0,
    "bust": 0.0,        // 0 … 1
    "shoulder": 0.5,    // 0 … 1
    "belly": 0.3,
    "hips": 0.5,
    "hair": true,
    "armor": false
  }
}
```

一个 `humanoid` 编译出的网格是**单一水密闭合壳体**（躯干、颈、头、五官、头发、双臂、双手各五指、双腿、双脚全部互相穿插后焊接）。默认约 2.8k 顶点 / 2.9k 面，适合再做 Catmull-Clark 细分或雕刻。

> **为什么是参数而不是骨架？** 骨架驱动需要绑定权重、蒙皮、逆运动学，LLM 极易写错；参数化骨架生成在"角色外观变体"这个任务上准确率高一个数量级。需要动画时导出 glTF 再在 DCC 里绑定。

### 3.2 `kind: "part"` — 程序化硬表面（CSG 配方）

```jsonc
{
  "id": "crate",
  "kind": "part",
  "material": "cloth",
  "transform": { "position": [-0.85, 0, -0.35], "rotation": [0, 0.42, 0] },
  "parts": [
    { "id": "body", "op": "merge",
      "prim": { "type": "roundedBox", "size": 0.5, "radius": 0.035, "segments": 3 },
      "transform": { "position": [0, 0.25, 0] } },
    { "id": "hole", "op": "subtract",
      "prim": { "type": "cylinder", "radius": 0.1, "height": 0.7, "segments": 20 },
      "transform": { "position": [0, 0.25, 0] } }
  ],
  "deform": [{ "type": "orient" }]
}
```

`parts` 按顺序求值：

- `merge` / `add`：直接拼接（快，可能非水密，适合互相穿插的装饰件）
- `union` / `subtract` / `intersect`：真实布尔（慢，输出水密实体）

**布尔输出保证水密**：CSG 后自动执行「去退化面 → 距离焊接 → T 型接缝修复 → 小孔扇形填充 → 绕序统一」流水线。

### 3.3 `kind: "mesh"` — 显式网格（兜底 / 手改）

```jsonc
{
  "id": "custom",
  "kind": "mesh",
  "materialInline": { "color": "#ff8844" },
  "mesh": {
    "verts": [[0,0,0], [1,0,0], [1,1,0], [0,1,0]],
    "faces": [[0,1,2,3]]
  },
  "subdiv": 0
}
```

`faces` 支持任意多边形（推荐四边形：规整、细分友好、LLM 出错率低）。索引必须 `< verts.length`。

---

## 4. 图元 `prim`

| `type` | 关键参数 | 说明 |
|---|---|---|
| `box` / `cube` | `size`, `segments` | 立方体，每面 `segments²` 个四边形 |
| `sphere` | `radius`, `segments`, `rings` | UV 球 |
| `cylinder` | `radius`, `height`, `segments`, `rings` | 带盖圆柱 |
| `cone` | `radius`, `height`, `segments` | 圆锥 |
| `torus` | `radius`, `tube`, `segments`, `tubeSegments` | 圆环 |
| `plane` | `size`, `segments` | 开放平面（需 `solidify` 才水密） |
| `capsule` | `radius`, `length`, `segments`, `rings` | 胶囊 |
| `roundedBox` | `size`, `radius`, `segments` | 圆角盒（`size` 为**全尺寸**） |
| `loft` | `sections[]`, `radial` | 超椭圆截面堆叠，有机/硬表面通用 |
| `tube` | `points[]`, `radii[]`, `radial` | 沿折线扫掠圆管 |
| `extrude` | `polygons[]`, `depth` | 2D 轮廓（含孔洞）挤出 |

`loft` 的 `sections` 是纵向堆叠的环：

```jsonc
{ "type": "loft", "radial": 16, "sections": [
  { "y": -0.5, "rx": 0.30, "rz": 0.20, "e": 3.0 },  // e 越大越"方"
  { "y":  0.0, "rx": 0.40, "rz": 0.30, "e": 2.4 },
  { "y":  0.5, "rx": 0.22, "rz": 0.16, "e": 2.2 }
]}
```

> `loft` 的 `rx/rz` 是**半轴**，`roundedBox` 的 `size` 是**全尺寸**。这是最容易写错的约定，schema 无法表达，务必留意。

---

## 5. 变形器 `deform`

按数组顺序依次作用：

| `type` | 参数 | 作用 |
|---|---|---|
| `subdivide` | `levels` | Catmull-Clark 细分（面数 ×4^levels） |
| `mirror` | `weld` | 沿 X 镜像并焊接缝（自动丢弃镜像面上的共面盖） |
| `weld` | `tolerance` | 按距离合并顶点 |
| `orient` | — | 统一法线朝外 |
| `inflate` | `center`, `radius`, `amount` | 球形衰减沿法线外推 |
| `scale` | `factor` | 绕原点非等比缩放 |
| `taper` | `top`, `bottom` | 沿 Y 线性收缩 XZ |
| `bend` | `angle`, `axis` | 沿 Y 弯曲 |

---

## 6. 变换 `transform`

```jsonc
{ "position": [x,y,z], "rotation": [rx,ry,rz], "scale": [sx,sy,sz], "mirror": "x" }
```

旋转顺序 **Ry → Rx → Rz**。`mirror` 为 `x|y|z` 时先镜像（负行列式会自动翻转面绕序）。

---

## 7. 增量修改协议（LLM 的核心接口）

**永远不要整份重写文档。** 用 JSON Patch（RFC 6902）+ 语义扩展：

```jsonc
[
  { "op": "setRig", "path": "/objects/0", "value": { "build": 0.8, "muscle": 0.9 } },
  { "op": "setMaterial", "name": "skin", "value": { "color": "#c98d63" } },
  { "op": "addPart", "path": "/objects/2", "value": {
      "id": "lid", "op": "merge",
      "prim": { "type": "cylinder", "radius": 0.27, "height": 0.02, "segments": 32 } } },
  { "op": "removePart", "path": "/objects/2", "partId": "lid" },
  { "op": "test", "path": "/objects/0/kind", "value": "humanoid" }
]
```

标准操作 `add / remove / replace / move / copy / test` 全部支持；`setRig / addPart / removePart / setMaterial` 是语义糖，避免 LLM 手写深层路径。

**重要**：`setRig` 是**合并**而不是整体替换，所以"把体格改成 0.8"不需要重写其余 14 个参数。

补丁应用后必须重新校验；CLI 在写盘前自动做这一步。

---

## 8. 校验规则

### 8.1 Schema 层（`qf validate`）

- 必填字段、类型、枚举、数值范围、字符串长度/正则
- `additionalProperties: false`：未知字段报错
- `objects[].id` 唯一
- `objects[].material` 必须存在于 `materials`

### 8.2 几何层（`qf stats`）

| 检查 | 合格标准 |
|---|---|
| 开放边 | 0（打印件必须水密） |
| 非流形边 | 0 |
| 退化面 | 0 |
| 有符号体积 | > 0（绕序朝外） |
| 包围盒 | 各轴 > 0 |

---

## 9. CLI

```bash
qf validate   model.quadforge.json          # schema + 几何语义校验
qf stats      model.quadforge.json --json   # 顶点/面/三角/水密/体积/尺寸
qf compile    model.quadforge.json -o m.glb # stl | obj | glb
qf patch      model.quadforge.json p.json -o out.json
qf diff       a.json b.json -o patch.json   # 生成补丁
qf materialize model.quadforge.json         # 配方烘焙为纯网格文档
qf schema     > schema.json                 # 输出 JSON Schema
```

所有命令支持 `--json` 输出机器可读结果，失败时非零退出。

---

## 10. 给 LLM 的提示词模板

```
你在编辑一个 .quadforge/1 文档。
- 只输出 JSON Patch 数组，不要输出整个文档。
- 人物用 {"kind":"humanoid","rig":{...}}，不要手写顶点。
- 硬表面用 {"kind":"part","parts":[{"op":"union|subtract|intersect","prim":{...}}]}。
- 尺寸单位是米；成年人身高 1.7–1.9。
- loft 的 rx/rz 是半轴；roundedBox 的 size 是全尺寸。
- 每次修改后调用 qf validate 与 qf stats，若 openEdges > 0 或 volume <= 0 则修正。
```

---

## 11. 版本演进

`schema` 字段是硬性主版本。任何破坏性变更必须递增为 `quadforge/2`，并保留 v1 的读取路径。新增**可选**字段不需要升版本。
