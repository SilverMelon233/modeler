/**
 * SCHEMA — the authoritative .quadforge/1 document contract.
 *
 * Kept as a plain JS object (not a .json file) so the browser and the CLI can
 * validate without any network fetch or build step. It is intentionally a
 * strict subset of JSON Schema so the hand-rolled validator stays tiny.
 */

export const SCHEMA = {
  $id: 'https://quadforge.dev/schema/1.json',
  title: 'QuadForge document',
  type: 'object',
  required: ['schema', 'objects'],
  additionalProperties: false,
  properties: {
    schema: { const: 'quadforge/1' },
    version: { type: 'integer', minimum: 1 },
    unit: { enum: ['m', 'cm', 'mm', 'in'] },
    meta: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 200 },
        author: { type: 'string' },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: true,
    },
    materials: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
          metalness: { type: 'number', minimum: 0, maximum: 1 },
          roughness: { type: 'number', minimum: 0, maximum: 1 },
          opacity: { type: 'number', minimum: 0, maximum: 1 },
          emissive: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
          flat: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
    objects: {
      type: 'array',
      minItems: 0,
      items: { $ref: '#/definitions/object' },
    },
  },
  definitions: {
    vec3: {
      type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3,
    },
    transform: {
      type: 'object',
      additionalProperties: false,
      properties: {
        position: { $ref: '#/definitions/vec3' },
        rotation: { description: 'radians, XYZ Euler', $ref: '#/definitions/vec3' },
        scale: { $ref: '#/definitions/vec3' },
        mirror: { enum: ['x', 'y', 'z'] },
      },
    },
    deform: {
      type: 'object',
      required: ['type'],
      properties: {
        type: {
          enum: ['subdivide', 'mirror', 'weld', 'orient', 'inflate', 'scale', 'taper', 'bend'],
        },
        levels: { type: 'integer', minimum: 1, maximum: 4 },
        amount: { type: 'number' },
        radius: { type: 'number' },
        center: { $ref: '#/definitions/vec3' },
        factor: { $ref: '#/definitions/vec3' },
        top: { type: 'number' },
        bottom: { type: 'number' },
        angle: { type: 'number' },
        axis: { enum: ['x', 'y', 'z'] },
        weld: { type: 'boolean' },
        tolerance: { type: 'number' },
      },
      additionalProperties: true,
    },
    transform2: {
      description: 'Same as transform, accepted on parts for brevity',
      $ref: '#/definitions/transform',
    },
    prim: {
      type: 'object',
      required: ['type'],
      properties: {
        type: {
          enum: [
            'box', 'cube', 'sphere', 'cylinder', 'cone', 'torus', 'plane',
            'capsule', 'roundedBox', 'loft', 'tube', 'extrude',
          ],
        },
        size: { type: 'number' },
        radius: { type: 'number' },
        height: { type: 'number' },
        length: { type: 'number' },
        tube: { type: 'number' },
        depth: { type: 'number' },
        segments: { type: 'integer', minimum: 3, maximum: 128 },
        rings: { type: 'integer', minimum: 1, maximum: 128 },
        tubeSegments: { type: 'integer', minimum: 3, maximum: 128 },
        radial: { type: 'integer', minimum: 3, maximum: 128 },
        capStart: { type: 'boolean' },
        capEnd: { type: 'boolean' },
        sections: {
          type: 'array',
          minItems: 2,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
              rx: { type: 'number' }, rz: { type: 'number' },
              e: { type: 'number', minimum: 1 },
              rot: { type: 'number' },
            },
          },
        },
        points: { type: 'array', minItems: 2, items: { $ref: '#/definitions/vec3' } },
        radii: { type: 'array', items: { type: 'number' } },
        polygons: {
          type: 'array',
          items: {
            type: 'object',
            required: ['outer'],
            properties: {
              outer: { type: 'array', minItems: 3, items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } },
              holes: { type: 'array', items: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } } },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: true,
    },
    part: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        op: { enum: ['merge', 'add', 'union', 'subtract', 'intersect'] },
        prim: { $ref: '#/definitions/prim' },
        transform: { $ref: '#/definitions/transform' },
        deform: { type: 'array', items: { $ref: '#/definitions/deform' } },
      },
      additionalProperties: false,
    },
    rig: {
      type: 'object',
      additionalProperties: false,
      properties: {
        height: { type: 'number', minimum: 0.2, maximum: 5 },
        build: { type: 'number', minimum: 0, maximum: 1 },
        muscle: { type: 'number', minimum: 0, maximum: 1 },
        headScale: { type: 'number', minimum: 0.5, maximum: 2 },
        neck: { type: 'number', minimum: 0.5, maximum: 2 },
        armLength: { type: 'number', minimum: 0.5, maximum: 2 },
        legLength: { type: 'number', minimum: 0.5, maximum: 2 },
        handSize: { type: 'number', minimum: 0.5, maximum: 2 },
        footSize: { type: 'number', minimum: 0.5, maximum: 2 },
        bust: { type: 'number', minimum: 0, maximum: 1 },
        shoulder: { type: 'number', minimum: 0, maximum: 1 },
        belly: { type: 'number', minimum: 0, maximum: 1 },
        hips: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    object: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_.:-]+$' },
        name: { type: 'string', maxLength: 120 },
        kind: { enum: ['humanoid', 'part', 'mesh'] },
        rig: { $ref: '#/definitions/rig' },
        parts: { type: 'array', items: { $ref: '#/definitions/part' } },
        prim: { $ref: '#/definitions/prim' },
        mesh: {
          type: 'object',
          required: ['verts', 'faces'],
          properties: {
            verts: { type: 'array', minItems: 3, items: { $ref: '#/definitions/vec3' } },
            faces: { type: 'array', minItems: 1, items: { type: 'array', minItems: 3, items: { type: 'integer', minimum: 0 } } },
          },
          additionalProperties: false,
        },
        material: { type: 'string' },
        materialInline: { type: 'object', additionalProperties: true },
        deform: { type: 'array', items: { $ref: '#/definitions/deform' } },
        transform: { $ref: '#/definitions/transform' },
        subdiv: { type: 'integer', minimum: 0, maximum: 3 },
        weld: { type: 'boolean' },
        weldTolerance: { type: 'number', minimum: 0 },
        visible: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
};

/* ------------------------------------------------------------- validator */

const TYPE_CHECKS = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  array: (v) => Array.isArray(v),
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
};

function resolve(root, ref) {
  if (!ref.startsWith('#/')) return null;
  return ref.slice(2).split('/').reduce((o, k) => (o == null ? o : o[k]), root);
}

function validateNode(value, schema, root, path, errors) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.$ref) {
    const target = resolve(root, schema.$ref);
    if (target) return validateNode(value, { ...target, description: schema.description }, root, path, errors);
  }
  if (schema.const !== undefined && value !== schema.const) {
    errors.push({ path, message: `必须是 ${JSON.stringify(schema.const)}` });
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push({ path, message: `必须是以下之一：${schema.enum.join(' | ')}` });
    return;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => TYPE_CHECKS[t]?.(value))) {
      errors.push({ path, message: `类型应为 ${types.join('|')}，实际为 ${Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value}` });
      return;
    }
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push({ path, message: `长度至少 ${schema.minLength}` });
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push({ path, message: `长度最多 ${schema.maxLength}` });
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push({ path, message: `不匹配 /${schema.pattern}/` });
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path, message: `不得小于 ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path, message: `不得大于 ${schema.maximum}` });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push({ path, message: `至少 ${schema.minItems} 项` });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push({ path, message: `最多 ${schema.maxItems} 项` });
    if (schema.items) value.forEach((v, i) => validateNode(v, schema.items, root, `${path}[${i}]`, errors));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push({ path: `${path}.${key}`, message: '缺少必填字段' });
    }
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) validateNode(v, props[k], root, `${path}.${k}`, errors);
      else if (schema.additionalProperties === false) errors.push({ path: `${path}.${k}`, message: '未知字段' });
      else if (typeof schema.additionalProperties === 'object') validateNode(v, schema.additionalProperties, root, `${path}.${k}`, errors);
    }
  }
}

/**
 * @returns {{valid:boolean, errors:{path:string,message:string}[]}}
 */
export function validateDocument(doc) {
  const errors = [];
  validateNode(doc, SCHEMA, SCHEMA, '$', errors);
  return { valid: errors.length === 0, errors };
}

/** Semantic checks the schema cannot express. */
export function validateGeometry(doc) {
  const issues = [];
  const ids = new Set();
  (doc.objects || []).forEach((o, i) => {
    if (ids.has(o.id)) issues.push({ path: `$.objects[${i}].id`, message: `重复的 id "${o.id}"` });
    ids.add(o.id);
    if (o.material && !(doc.materials || {})[o.material]) {
      issues.push({ path: `$.objects[${i}].material`, message: `引用了未定义的材质 "${o.material}"` });
    }
    if (o.kind === 'humanoid' && !o.rig) {
      // not fatal: defaults apply
    }
    if (o.kind === 'mesh' && o.mesh) {
      const n = o.mesh.verts.length;
      o.mesh.faces.forEach((f, fi) => {
        for (const idx of f) {
          if (!Number.isInteger(idx) || idx < 0 || idx >= n) {
            issues.push({ path: `$.objects[${i}].mesh.faces[${fi}]`, message: `索引 ${idx} 越界（顶点数 ${n}）` });
          }
        }
      });
    }
    if (o.parts) {
      o.parts.forEach((p, pi) => {
        if (!p.prim) issues.push({ path: `$.objects[${i}].parts[${pi}]`, message: '缺少 prim' });
      });
    }
  });
  return { valid: issues.length === 0, issues };
}

export function formatErrors(errors) {
  return errors.map((e) => `  ${e.path}: ${e.message}`).join('\n');
}
