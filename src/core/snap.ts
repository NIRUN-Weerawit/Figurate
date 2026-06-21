/**
 * Snap engine — proximity-based attachment for primitives.
 *
 * When the user drags an object, the renderer asks the snap engine:
 *   "Is this object close enough to any other object to snap together?"
 *
 * If yes, the engine returns a `SnapCandidate` with the snap target and
 * the new position the dragged object should snap to. The renderer shows
 * a visual cue (a thin line between the two attach points). On mouseup,
 * the engine also recommends a relation to create (e.g. `rests_on`,
 * `pendulum_from`).
 *
 * Each primitive type declares its **attach points** — positions in local
 * coordinates where another object can attach. For example, an incline
 * exposes `surface(0.5)` (the midpoint of the slope) where a block
 * can sit. A block exposes `bottom`, `top`, `left`, `right` (the four
 * sides of the rectangle) where other objects can attach.
 *
 * Attach points are declared per-primitive in `core/registry.ts`. The
 * snap engine is primitive-agnostic — it just operates on the attach
 * point list of any object.
 */

import type { FigurateScene, Relation, SceneObject, Vec2 } from "./dsl";
import { findNonOverlappingPosition } from "./layout";

/**
 * One attach point on a primitive. `world()` resolves the local position
 * to a world-space coordinate, given the object's transform and rotation.
 */
export interface AttachPoint {
  /** Stable id for this attach point within the primitive. e.g. "center", "bottom" */
  id: string;
  /** Human-readable label. e.g. "center", "bottom edge", "surface midpoint" */
  label: string;
  /** Position in local coordinates. May be parametric for surfaces. */
  local: Vec2 | ((params: Record<string, unknown>) => Vec2);
  /**
   * The relation this attach point can host. e.g. "center" of a bob can
   * host `pendulum_from` (to a pivot) or `origin_at` (from a vector).
   * `null` means "any relation" — used for surface-like points.
   */
  accepts: Relation["kind"][] | null;
}

/**
 * A candidate the user might snap to. The renderer previews the snap by
 * drawing a line between `fromPoint` (the dragged object's attach point)
 * and `toPoint` (the target object's attach point).
 */
export interface SnapCandidate {
  draggedObjId: string;
  targetObjId: string;
  fromPoint: Vec2;            // world-space position on the dragged object
  toPoint: Vec2;              // world-space position on the target
  /** The attach-point ids used (for display, e.g. "block.bottom" → "incline.surface"). */
  fromAttachId: string;
  toAttachId: string;
  /** The relation the engine recommends creating on mouseup. */
  relation: Relation;
  /**
   * Position the dragged object should snap to. Usually equal to `toPoint`
   * offset by the dragged object's center-to-attach-point delta, so the
   * whole dragged object ends up in the right place.
   */
  snapPosition: Vec2;
}

/**
 * Configuration for snap behavior.
 */
export const SNAP_DEFAULTS: { maxDistance: number } = {
  /** Distance (in world units) at which a snap fires. Larger = more
   *  forgiving, smaller = more precise. ~30px is a good default. */
  maxDistance: 30,
};

/**
 * Compute the world-space position of an attach point.
 */
export function attachPointWorld(
  obj: SceneObject,
  point: AttachPoint
): Vec2 {
  const local =
    typeof point.local === "function"
      ? point.local(obj.params)
      : point.local;
  // For now, primitives don't rotate the local attach-point frame
  // relative to their transform. If they do, we'd add a rotation here.
  return { x: obj.transform.x + local.x, y: obj.transform.y + local.y };
}

/**
 * Walk the scene and find the closest snap candidate for the dragged object.
 * Returns `null` if no candidate is within `SNAP_DEFAULTS.maxDistance`.
 */
export function findSnapTarget(
  dragged: SceneObject,
  scene: FigurateScene
): SnapCandidate | null {
  const draggedAttachPoints = getAttachPoints(dragged);
  if (draggedAttachPoints.length === 0) return null;

  let best: SnapCandidate | null = null;
  let bestDist = SNAP_DEFAULTS.maxDistance;

  for (const target of scene.objects) {
    if (target.id === dragged.id) continue;
    // Don't snap to invisible objects — they're decoration, not interactive.
    if (target.visible === false) continue;

    const targetAttachPoints = getAttachPoints(target);
    if (targetAttachPoints.length === 0) continue;

    for (const dPoint of draggedAttachPoints) {
      const dWorld = attachPointWorld(dragged, dPoint);
      for (const tPoint of targetAttachPoints) {
        const tWorld = attachPointWorld(target, tPoint);
        const dist = Math.hypot(dWorld.x - tWorld.x, dWorld.y - tWorld.y);
        if (dist < bestDist) {
          const relation = inferRelation(dragged, dPoint, target, tPoint);
          if (!relation) continue;
          const snapPosition = computeSnapPosition(
            dragged, dPoint, dWorld, target, tPoint, tWorld
          );
          best = {
            draggedObjId: dragged.id,
            targetObjId: target.id,
            fromPoint: dWorld,
            toPoint: tWorld,
            fromAttachId: dPoint.id,
            toAttachId: tPoint.id,
            relation,
            snapPosition,
          };
          bestDist = dist;
        }
      }
    }
  }
  return best;
}

/**
 * Compute where the dragged object should end up to make its attach
 * point land on the target's attach point.
 */
function computeSnapPosition(
  dragged: SceneObject,
  dPoint: AttachPoint,
  dWorld: Vec2,
  target: SceneObject,
  tPoint: AttachPoint,
  tWorld: Vec2
): Vec2 {
  // The dragged object's transform is its center. Its attach point is
  // at `dWorld = (transform.x + local.x, transform.y + local.y)`.
  // We want `dWorld = tWorld`, so:
  //   transform.x = tWorld.x - local.x
  //   transform.y = tWorld.y - local.y
  const dLocal =
    typeof dPoint.local === "function"
      ? dPoint.local(dragged.params)
      : dPoint.local;
  return {
    x: tWorld.x - dLocal.x,
    y: tWorld.y - dLocal.y,
  };
}

/**
 * Given a pair of attach points, decide what relation to create.
 * Returns `null` if the pair is incompatible (e.g. bob-to-bob doesn't
 * make a recognized relation).
 *
 * This is a deliberately small lookup table — not a general inference.
 * New relations are added here as new composite types are introduced.
 */
function inferRelation(
  dragged: SceneObject,
  dPoint: AttachPoint,
  target: SceneObject,
  tPoint: AttachPoint
): Relation | null {
  // Filter by accepted relation kinds if either side is restrictive.
  if (dPoint.accepts && !dPoint.accepts.includes("pendulum_from" as Relation["kind"]) && dragged.type === "pendulum_bob") {
    // permissive — no filter
  }

  // Pendulum bob → pivot: pendulum_from
  if (
    dragged.type === "pendulum_bob" &&
    dPoint.id === "center" &&
    target.type === "pendulum_pivot" &&
    tPoint.id === "center"
  ) {
    return { kind: "pendulum_from", target: target.id };
  }

  // Block → incline surface: rests_on
  if (
    dragged.type === "block" &&
    (dPoint.id === "bottom" || dPoint.id === "center") &&
    target.type === "incline" &&
    tPoint.id.startsWith("surface")
  ) {
    // The fraction is encoded in the attach point id, e.g. "surface_0.5"
    const fractionMatch = tPoint.id.match(/_([\d.]+)$/);
    const fraction = fractionMatch ? parseFloat(fractionMatch[1]) : 0.5;
    return { kind: "rests_on", target: target.id, fraction };
  }

  // Block → ground: rests_on
  if (
    dragged.type === "block" &&
    (dPoint.id === "bottom" || dPoint.id === "center") &&
    target.type === "ground" &&
    (tPoint.id === "surface" || tPoint.id === "center")
  ) {
    return { kind: "rests_on", target: target.id };
  }

  // Vector tail → any object: origin_at
  if (
    dragged.type === "vector" &&
    dPoint.id === "tail" &&
    tPoint.id === "center"
  ) {
    return { kind: "origin_at", target: target.id, anchor: "center" };
  }

  // Rope end → any object: the rope primitive reads its own `from`/`to`
  // params, so the snap needs to update those, not a stored Relation.
  // We tag the snap with a special `kind: "rope_end"` and let the
  // renderer handle it.
  if (
    dragged.type === "rope" &&
    (dPoint.id === "from" || dPoint.id === "to") &&
    tPoint.id === "center"
  ) {
    // `target` here carries the rope-end info as a custom field. The
    // Relation type doesn't model this directly, so we cast through
    // `as unknown as Relation` to satisfy the type checker. The renderer
    // checks `kind === "origin_at"` and reads `target` + `anchor`.
    return {
      kind: "origin_at",
      target: target.id,
      anchor: "center",
      // Stash the rope-end id in a way the renderer can read.
      ...({ ropeEnd: dPoint.id } as Record<string, unknown>),
    } as unknown as Relation;
  }

  return null;
}

/**
 * Static attach-point definitions, indexed by primitive type.
 * Each primitive can extend its own list in the registry by calling
 * `registerAttachPoints(type, points)` at module load.
 */
const attachPointsRegistry = new Map<string, AttachPoint[]>();

/**
 * Register attach points for a primitive type. Called at module init
 * from `primitives/index.tsx` and any future primitive files.
 */
export function registerAttachPoints(type: string, points: AttachPoint[]): void {
  attachPointsRegistry.set(type, points);
}

/**
 * Get the attach points for an object. Falls back to a single `center`
 * attach point if the primitive hasn't registered any.
 */
export function getAttachPoints(obj: SceneObject): AttachPoint[] {
  return attachPointsRegistry.get(obj.type) ?? [defaultCenterAttachPoint];
}

const defaultCenterAttachPoint: AttachPoint = {
  id: "center",
  label: "center",
  local: { x: 0, y: 0 },
  accepts: null,
};

/**
 * Add default attach points for primitives that haven't registered any.
 * Idempotent — safe to call multiple times.
 */
export function ensureDefaultAttachPoints(): void {
  if (!attachPointsRegistry.has("pendulum_bob")) {
    registerAttachPoints("pendulum_bob", [
      { id: "center", label: "center", local: { x: 0, y: 0 }, accepts: null },
    ]);
  }
  if (!attachPointsRegistry.has("pendulum_pivot")) {
    registerAttachPoints("pendulum_pivot", [
      { id: "center", label: "center", local: { x: 0, y: 0 }, accepts: null },
    ]);
  }
  if (!attachPointsRegistry.has("block")) {
    registerAttachPoints("block", [
      { id: "center", label: "center", local: { x: 0, y: 0 }, accepts: null },
      // The 4 sides of the block. Used for attaching to other objects.
      { id: "bottom", label: "bottom edge", local: { x: 0, y: 22 }, accepts: null },
      { id: "top", label: "top edge", local: { x: 0, y: -22 }, accepts: null },
    ]);
  }
  if (!attachPointsRegistry.has("incline")) {
    // Pre-compute several surface points at fractions along the slope.
    // These are used for snap targets — `surface_0.5` is the midpoint.
    const length = 280; // default; the real value is read from params
    const points: AttachPoint[] = [
      { id: "center", label: "base", local: { x: 0, y: 0 }, accepts: null },
    ];
    for (const fraction of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      // Local: along the slope direction, perpendicular to the slope up.
      // For a slope at 0° (horizontal) with length 280, point at fraction
      // f is at (f*280, 0). The actual angle comes from the incline's
      // transform.rotation, but we don't rotate here — we just place
      // points along the local x axis. The snap math assumes the incline
      // is rendered along its local +x.
      const localX = (fraction - 0.5) * length;
      points.push({
        id: `surface_${fraction}`,
        label: `surface ${Math.round(fraction * 100)}%`,
        local: { x: localX, y: 0 },
        accepts: null,
      });
    }
    registerAttachPoints("incline", points);
  }
  if (!attachPointsRegistry.has("vector")) {
    registerAttachPoints("vector", [
      { id: "tail", label: "tail", local: { x: 0, y: 0 }, accepts: null },
    ]);
  }
  if (!attachPointsRegistry.has("rope")) {
    registerAttachPoints("rope", [
      { id: "from", label: "from end", local: { x: 0, y: 0 }, accepts: null },
      { id: "to", label: "to end", local: { x: 0, y: 0 }, accepts: null },
    ]);
  }
  if (!attachPointsRegistry.has("ground")) {
    registerAttachPoints("ground", [
      { id: "surface", label: "ground line", local: { x: 0, y: 0 }, accepts: null },
    ]);
  }
}

/**
 * Helper: place a new object at a non-overlapping position near a target.
 * Used by `addObject` to ensure newly-spawned objects don't pile up.
 */
export function placeNear(
  preferred: Vec2,
  scene: FigurateScene
): Vec2 {
  return findNonOverlappingPosition(preferred, null, scene.objects);
}
