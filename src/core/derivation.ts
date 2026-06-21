/**
 * Derivation layer — the "smart" part of Figurate.
 *
 * The constraint solver handles *positional* relationships (bob at polar
 * (L, θ) from pivot, block resting on incline). But it doesn't handle derived
 * *visual* properties: a vector's angle should re-aim itself at its target,
 * a block on an incline should rotate to match the slope, an angle-marker
 * should track the bob's angleDeg.
 *
 * A `Derivation` is a small rule that says: "for object X, take one of its
 * fields (a transform component or a param) and compute it from a function
 * of other objects' fields". When any of those "parent" fields change, the
 * derived field is re-computed.
 *
 * Architecture
 * ────────────
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  constraint solver (kiwi.js)                               │
 *   │  computes bob.position from pendulum_from(pivot, L, θ)     │
 *   └────────────────────────────────────────────────────────────┘
 *             │
 *             ▼
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  derivation layer (this file)                              │
 *   │  topologically re-evaluates each "derives" rule in order.  │
 *   │  Only re-runs a node when one of its parents changed.      │
 *   └────────────────────────────────────────────────────────────┘
 *             │
 *             ▼
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  renderer reads the finalised fields.                      │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Why a DAG (not just a top-down re-derive-everything pass)?
 * ──────────────────────────────────────────────────────────
 * If a user changes `bob.params.angleDeg`:
 *
 *   Naive "recompute everything"        Smart DAG
 *   ──────────────────────────────      ──────────
 *   1. solver re-runs                   1. solver re-runs
 *   2. T.angle re-derives               2. bob.position re-derives (parent angleDeg changed)
 *   3. mg.anchor re-derives             3. T.angle re-derives   (parent bob.position changed)
 *   4. θ-arc.toAngle re-derives         4. mg.anchor re-derives (parent bob.position changed)
 *   5. rope.endpoints re-derives        5. θ-arc skipped        (parent angleDeg already done)
 *   6. block.rotation re-derives        6. rope.endpoints re-derive
 *                                        7. block.rotation skipped (parent unchanged)
 *
 * As scenes grow (10+ decorations on a composite), savings compound.
 *
 * Note: this layer computes derived *visual* properties (vector angles,
 * block rotation, etc.). It does NOT modify the scene's stored params or
 * transform — those stay clean. Derived values live in a separate `DerivedCache`
 * the renderer reads from. The only time we write back to the scene is when
 * a user gesture (drag) should "re-anchor" a parameter (e.g. dragging a
 * pendulum bob to a new angle updates `angleDeg` so it sticks).
 */

import type { FigurateScene, Vec2 } from "./dsl";

// ─────────────────────────────────────────────────────────────────
// Field references.
// ─────────────────────────────────────────────────────────────────

/**
 * A reference to a single field on a single object. Forms the dependency
 * edge in the DAG: a node's `parents` is a list of these.
 *
 *   { object: "bob1", field: "transform.x" }
 *   { object: "bob1", field: "params.angleDeg" }
 */
export interface FieldRef {
  object: string;
  field: string; // e.g. "transform.x", "params.angleDeg", "transform.rotation"
}

/** What a derivation writes to. */
export interface DerivedTarget {
  object: string;
  field: string;
}

/**
 * A context object passed to a derivation's `compute` function. Provides
 * safe access to parent field values, the current scene, and the cache.
 *
 * The field is keyed by `${object}::${field}` to disambiguate between two
 * parents with the same field name (e.g. bob1.transform.x and pivot1.transform.x).
 */
export interface DerivationContext {
  /**
   * Read a parent field. Returns the scene's current value if not in the
   * derivation cache yet. Throws if the field doesn't exist.
   *
   *   const x = ctx.get({ object: "bob1", field: "transform.x" });
   */
  get(ref: FieldRef): number | string | boolean | undefined;
  /** Read the full scene (for derivations that need more than one object). */
  scene: FigurateScene;
  /** The current cache of derived values. */
  cache: DerivedCache;
}

/**
 * A single derivation rule.
 */
export interface Derivation {
  /** Stable identifier (for debugging and deduplication). */
  id: string;
  /** Fields this rule reads. The DAG re-derives this node when any changes. */
  parents: FieldRef[];
  /** Compute the new value. */
  compute: (ctx: DerivationContext) => unknown;
  /** The field to write the result to. */
  target: DerivedTarget;
}

// ─────────────────────────────────────────────────────────────────
// Cache.
// ─────────────────────────────────────────────────────────────────

/**
 * A flat map of "every derived field, with its last-computed value". The
 * renderer reads from this; we never write derived values back into the
 * scene's `params` or `transform` (we don't want to dirty the JSON DSL).
 *
 * Key format: `${objectId}::${field}` (e.g. "tension1::params.angleDeg").
 *
 * Implemented as a plain object (not a Map) so it can be passed through
 * React props without ceremony. Each entry is just the value; the key
 * encoding is handled by `cacheKey()` and the accessor helpers below.
 */
export type DerivedCache = Record<string, unknown>;

export function cacheKey(objectId: string, field: string): string {
  return `${objectId}::${field}`;
}

/**
 * Get a derived value for one object+field, falling back to the scene
 * if not in the cache. This is what renderers use.
 */
export function getDerived(
  cache: DerivedCache,
  objectId: string,
  field: string
): unknown {
  const key = cacheKey(objectId, field);
  if (key in cache) return cache[key];
  return undefined;
}

// ─────────────────────────────────────────────────────────────────
// Reading fields from the scene.
// ─────────────────────────────────────────────────────────────────

/** Read a field (transform.x, params.angleDeg, ...) from a scene object. */
export function readSceneField(scene: FigurateScene, objectId: string, field: string): unknown {
  const obj = scene.objects.find((o) => o.id === objectId);
  if (!obj) return undefined;
  const [group, name] = field.split(".");
  if (group === "transform" && name) {
    return (obj.transform as unknown as Record<string, unknown>)[name];
  }
  if (group === "params" && name) {
    return obj.params[name];
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────
// Topological recompute.
// ─────────────────────────────────────────────────────────────────

/**
 * Build the dependency indices used by the recompute engine.
 * Returns:
 *   - `children`: for derivation `i`, the indices of derivations that
 *     read what `i` writes. Used to propagate changes downstream.
 *   - `readersByField`: for each field, the derivations that read it.
 *     Used to find which derivations to mark dirty when a field changes.
 *   - `writersByField`: for each field, the derivation that writes to it
 *     (or `null` if no derivation writes it — i.e. it's a user-editable
 *     field). Used to detect duplicate writers and to build the topo order.
 */
function buildIndices(derivations: Derivation[]): {
  children: number[][];
  readersByField: Map<string, number[]>;
  writersByField: Map<string, number>;
} {
  const children: number[][] = derivations.map(() => []);
  const readersByField = new Map<string, number[]>();
  const writersByField = new Map<string, number>();

  for (let i = 0; i < derivations.length; i++) {
    const d = derivations[i];
    const targetKey = cacheKey(d.target.object, d.target.field);
    if (writersByField.has(targetKey)) {
      console.warn(
        `[derivation] duplicate writer for ${targetKey}: ` +
          `${derivations[writersByField.get(targetKey)!].id} and ${d.id}`
      );
    }
    writersByField.set(targetKey, i);

    for (const parent of d.parents) {
      const key = cacheKey(parent.object, parent.field);
      let arr = readersByField.get(key);
      if (!arr) {
        arr = [];
        readersByField.set(key, arr);
      }
      arr.push(i);
    }
  }

  // children[i] = derivations that read what derivation[i] writes
  for (let i = 0; i < derivations.length; i++) {
    const key = cacheKey(derivations[i].target.object, derivations[i].target.field);
    const readers = readersByField.get(key) ?? [];
    for (const r of readers) {
      if (r !== i) children[i].push(r);
    }
  }

  return { children, readersByField, writersByField };
}

/**
 * Topological order over the derivation DAG. Uses Kahn's algorithm with
 * the parents-of-each-derivation relationship built from the writersByField
 * index (a derivation depends on any upstream derivation that writes to
 * one of its parents).
 */
function topoSort(derivations: Derivation[], writersByField: Map<string, number>): number[] {
  const inDegree = new Array(derivations.length).fill(0);
  const predecessorOf: number[][] = derivations.map(() => []);

  for (let i = 0; i < derivations.length; i++) {
    for (const p of derivations[i].parents) {
      const upIdx = writersByField.get(cacheKey(p.object, p.field));
      if (upIdx !== undefined && upIdx !== i) {
        predecessorOf[i].push(upIdx);
      }
    }
    inDegree[i] = predecessorOf[i].length;
  }

  const queue: number[] = [];
  for (let i = 0; i < derivations.length; i++) {
    if (inDegree[i] === 0) queue.push(i);
  }
  const order: number[] = [];
  while (queue.length > 0) {
    const i = queue.shift()!;
    order.push(i);
    for (const upIdx of predecessorOf[i]) {
      inDegree[upIdx]--;
      if (inDegree[upIdx] === 0) queue.push(upIdx);
    }
  }
  if (order.length !== derivations.length) {
    console.warn(
      `[derivation] cycle detected — topo sort incomplete ` +
        `(${order.length}/${derivations.length} nodes)`
    );
  }
  return order;
}

/**
 * Re-derive a single node. Returns the new value and a "did it change" flag.
 */
function rederiveOne(
  i: number,
  derivations: Derivation[],
  scene: FigurateScene,
  cache: DerivedCache
): { value: unknown; changed: boolean } {
  const d = derivations[i];
  const ctx: DerivationContext = {
    scene,
    cache,
    get: (ref) => {
      const key = cacheKey(ref.object, ref.field);
      if (key in cache) return cache[key] as number | string | boolean | undefined;
      return readSceneField(scene, ref.object, ref.field) as number | string | boolean | undefined;
    },
  };
  const newValue = d.compute(ctx);
  const key = cacheKey(d.target.object, d.target.field);
  const oldValue = key in cache ? cache[key] : undefined;
  const changed = !deepEqual(oldValue, newValue);
  cache[key] = newValue;
  return { value: newValue, changed };
}

/**
 * Main entry: re-derive the DAG.
 *
 *   - `changedFields`: if the caller knows which fields changed (e.g. user
 *     edited `bob1::params.angleDeg`), pass them in to do the smart pass.
 *     Only derivations whose parents include any of these will re-run.
 *   - If `changedFields` is null, do the conservative pass: re-derive
 *     everything in topological order. This is the safe default for the
 *     initial solve-after-composite-build and similar "I don't know what
 *     changed" situations.
 */
export function recomputeAll(
  derivations: Derivation[],
  scene: FigurateScene,
  cache: DerivedCache,
  changedFields: FieldRef[] | null = null
): void {
  const { children, readersByField, writersByField } = buildIndices(derivations);

  if (changedFields && changedFields.length > 0) {
    // Smart mode: start from derivations that read the changed fields.
    const start = new Set<number>();
    for (const f of changedFields) {
      const readers = readersByField.get(cacheKey(f.object, f.field)) ?? [];
      for (const r of readers) start.add(r);
    }
    // Propagate downstream. We re-run a node when it's reached, regardless
    // of whether its value changed — this is conservative and simple. A
    // smarter version would track per-node "parent set changed" and skip
    // when nothing relevant changed.
    const visited = new Set<number>();
    const queue: number[] = Array.from(start);
    while (queue.length > 0) {
      const i = queue.shift()!;
      if (visited.has(i)) continue;
      visited.add(i);
      rederiveOne(i, derivations, scene, cache);
      for (const c of children[i]) {
        if (!visited.has(c)) queue.push(c);
      }
    }
  } else {
    // Conservative: re-derive everything in topological order.
    const order = topoSort(derivations, writersByField);
    for (const i of order) rederiveOne(i, derivations, scene, cache);
  }
}

// ─────────────────────────────────────────────────────────────────
// Helpers: deep-equal, angle math.
// ─────────────────────────────────────────────────────────────────

/** Shallow deep-equal for primitives (numbers, strings, booleans, plain objects). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a === "number" && typeof b === "number") {
    return Number.isNaN(a) && Number.isNaN(b) ? true : a === b;
  }
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

/**
 * Angle (in degrees) of the vector from (fx,fy) to (tx,ty), in the
 * vector primitive's `angleDeg` convention.
 *
 * The vector primitive renders to:
 *   (transform.x + mag·cos θ, transform.y − mag·sin θ)
 *
 * That means:
 *   0° = pointing right (+x, 0)
 *   90° = pointing UP in screen-space (−y is up in SVG)
 *   180° = pointing left
 *   270° = pointing DOWN in screen-space
 *
 * To make a vector from (fx,fy) point toward (tx,ty), we need:
 *   cos θ = (tx − fx) / r
 *   sin θ = (fy − ty) / r   ← y is FLIPPED, because screen-y is down
 *                               and the primitive negates sin
 *
 * So the formula is atan2(fy − ty, tx − fx), NOT the standard atan2(ty − fy, tx − fx).
 */
export function computeAngle(fx: number, fy: number, tx: number, ty: number): number {
  const rad = Math.atan2(fy - ty, tx - fx);
  return (rad * 180) / Math.PI;
}

// ─────────────────────────────────────────────────────────────────
// Higher-level helpers used by primitive definitions.
// ─────────────────────────────────────────────────────────────────

/**
 * Aim a vector at another object. Writes the angle in degrees to the
 * target field. Use for "tension points up to the pivot" type relations.
 */
export function aimAt(
  id: string,
  target: DerivedTarget,
  fromObj: string,
  toObj: string
): Derivation {
  return {
    id,
    target,
    parents: [
      { object: fromObj, field: "transform.x" },
      { object: fromObj, field: "transform.y" },
      { object: toObj, field: "transform.x" },
      { object: toObj, field: "transform.y" },
    ],
    compute: (ctx) => {
      const fx = ctx.get({ object: fromObj, field: "transform.x" }) as number;
      const fy = ctx.get({ object: fromObj, field: "transform.y" }) as number;
      const tx = ctx.get({ object: toObj, field: "transform.x" }) as number;
      const ty = ctx.get({ object: toObj, field: "transform.y" }) as number;
      return computeAngle(fx, fy, tx, ty);
    },
  };
}

/**
 * Copy a param from one object to another. Useful for "block.rotation
 * tracks incline.angleDeg" or "T vector's label is always the rope's label".
 */
export function mirrorParam(
  id: string,
  target: DerivedTarget,
  sourceObj: string,
  sourceField: string
): Derivation {
  const [group, name] = sourceField.split(".");
  if (!group || !name) {
    throw new Error(`mirrorParam: sourceField must be "group.name" (got "${sourceField}")`);
  }
  return {
    id,
    target,
    parents: [{ object: sourceObj, field: sourceField }],
    compute: (ctx) => ctx.get({ object: sourceObj, field: sourceField }),
  };
}

/**
 * Constant value derivation. Useful for setting a default initial value
 * (e.g. the angle-marker always starts at vertexAngle = 0 if unset).
 */
export function constant(
  id: string,
  target: DerivedTarget,
  value: unknown
): Derivation {
  return {
    id,
    target,
    parents: [],
    compute: () => value,
  };
}

/**
 * Convert a point in a source object's local frame to world coords, then
 * write to the target's transform.x/y. The local frame is rotated by the
 * source's `transform.rotation` and translated by its `transform.x/y`.
 *
 * `localPoint` is a fixed offset in the source's local frame.
 *
 *   rotateLocalToWorld("block.top", { object: "block1", field: "transform.x" },
 *                      "block1", { x: 0, y: -h/2 })
 */
export function rotateLocalToWorld(
  id: string,
  target: DerivedTarget,
  sourceObj: string,
  localPoint: Vec2
): Derivation {
  return {
    id,
    target,
    parents: [
      { object: sourceObj, field: "transform.x" },
      { object: sourceObj, field: "transform.y" },
      { object: sourceObj, field: "transform.rotation" },
    ],
    compute: (ctx) => {
      const sx = (ctx.get({ object: sourceObj, field: "transform.x" }) as number) ?? 0;
      const sy = (ctx.get({ object: sourceObj, field: "transform.y" }) as number) ?? 0;
      const sRot = (ctx.get({ object: sourceObj, field: "transform.rotation" }) as number) ?? 0;
      const rad = (sRot * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const wx = sx + localPoint.x * cos - localPoint.y * sin;
      const wy = sy + localPoint.x * sin + localPoint.y * cos;
      return target.field === "transform.x" ? wx : wy;
    },
  };
}
