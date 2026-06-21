/**
 * Role inference engine.
 *
 * Walks the scene and assigns `compositeOf` + `compositeRole` to objects
 * that don't have them, based on their type, their relations, and the
 * types of nearby objects.
 *
 * The point: the user can build a pendulum by hand (drop pivot, rope,
 * bob separately) and the system recognizes the configuration and
 * activates the smart derivations (T auto-aims at pivot, mg points
 * down, θ-arc mirrors angleDeg). The user doesn't have to manually
 * tag anything.
 *
 * Inference is **idempotent** — calling it twice on the same scene
 * produces the same output. It's also **conservative** — it never
 * overrides an existing `compositeOf` that the user (or a sample)
 * has set explicitly. The user can always opt out by clearing the
 * `compositeOf` field.
 *
 * The inference rules are deliberately small and explicit. Adding a
 * new composite type means adding a new rule here.
 */

import type { FigurateScene, SceneObject } from "./dsl";

/**
 * Run role inference on the scene. Returns a new scene object array
 * with `compositeOf`/`compositeRole` populated where appropriate.
 *
 * Existing assignments are preserved (we never override the user's
 * explicit tagging).
 */
export function inferRoles(scene: FigurateScene): SceneObject[] {
  const objects = scene.objects;

  // Step 1: collect "anchors" — objects that look like primary subjects
  // of a composite (bobs, blocks, etc.). They already declare their
  // target via relations.
  const anchors = new Map<string, SceneObject>();
  for (const obj of objects) {
    if (isAnchorType(obj.type)) {
      anchors.set(obj.id, obj);
    }
  }

  // Step 2: for each anchor, find its composite group. The group is
  // determined by the anchor's relations and the proximity of related
  // objects.
  const next = objects.map((o) => ({ ...o }));
  const groupByObj = new Map<string, string>();

  for (const anchor of anchors.values()) {
    const groupId = anchor.compositeOf ?? `g_${anchor.id}`;
    if (!anchor.compositeOf) {
      const a = next.find((o) => o.id === anchor.id);
      if (a) {
        a.compositeOf = groupId;
      }
    }
    groupByObj.set(anchor.id, groupId);
    // Mark the anchor with its primary role.
    const a = next.find((o) => o.id === anchor.id);
    if (a && !a.compositeRole) {
      a.compositeRole = primaryRoleFor(anchor.type);
    }

    // Walk relations outward from the anchor and assign roles.
    for (const rel of anchor.relations ?? []) {
      const targetId = "target" in rel ? rel.target : null;
      if (!targetId) continue;
      const target = next.find((o) => o.id === targetId);
      if (!target) continue;
      // If the target is already in another composite, leave it.
      if (target.compositeOf && target.compositeOf !== groupId) continue;
      // Assign the same group + the role implied by the relation.
      target.compositeOf = groupId;
      if (!target.compositeRole) {
        target.compositeRole = roleForRelationTarget(target, rel.kind);
      }
      groupByObj.set(target.id, groupId);
    }
  }

  // Step 3: for any object not yet in a group, look for proximity-based
  // membership. If an unattached object is near an existing group, join.
  for (const obj of next) {
    if (obj.compositeOf) continue;
    const nearest = findNearestGroupMember(obj, next);
    if (nearest && nearest.groupId) {
      obj.compositeOf = nearest.groupId;
      if (!obj.compositeRole) {
        obj.compositeRole = roleByType(obj.type, nearest.nearestRole);
      }
    }
  }

  // Step 3b: For unattached anchor types (bobs, blocks, mass), look for
  // nearby composite groups that they could anchor. E.g. a block placed
  // near an incline should join the incline's group, becoming the "block"
  // role, even without an explicit `rests_on` relation. This handles
  // the case where the user dropped a block near an incline but hasn't
  // dragged it onto the surface yet (so the snap hasn't fired).
  for (const obj of next) {
    if (obj.compositeOf) continue;
    if (obj.type !== "block" && obj.type !== "pendulum_bob") continue;
    // Find a nearby composite member of the same type-of-thing family.
    // For a block, look for an incline; for a bob, look for a pivot.
    const targetType = obj.type === "block" ? "incline" : "pendulum_pivot";
    const nearbyTarget = next.find(
      (o) =>
        o.type === targetType &&
        o.compositeOf &&
        Math.hypot(o.transform.x - obj.transform.x, o.transform.y - obj.transform.y) < 250
    );
    if (nearbyTarget && nearbyTarget.compositeOf) {
      obj.compositeOf = nearbyTarget.compositeOf;
      obj.compositeRole = obj.type === "block" ? "block" : "bob";
    }
  }

  // Step 4: For vectors in a composite but with no role, infer the role
  // from the vector's current direction relative to the anchor.
  // E.g. a vector on a bob pointing at the pivot = tension.
  // A vector on a bob pointing straight down = weight.
  // A vector on a block perpendicular to the incline = normal.
  // A vector on a block parallel to the incline (uphill) = friction.
  inferVectorRoles(next, objects);

  return next;
}

/**
 * For each vector in a composite without a `compositeRole`, look at its
 * direction relative to its anchor (the object it's `origin_at`-ing) and
 * assign the most likely role.
 *
 * Tolerance: ~10°. We don't want to be over-precise — the user might
 * have placed the vector slightly off, and we don't want to surprise
 * them by mis-classifying.
 */
function inferVectorRoles(
  next: SceneObject[],
  original: SceneObject[]
): void {
  for (const obj of next) {
    if (obj.type !== "vector") continue;
    if (obj.compositeRole) continue;
    if (!obj.compositeOf) continue;

    // Find the anchor of this composite: the bob or block.
    const anchor = next.find(
      (o) => o.compositeOf === obj.compositeOf &&
             (o.compositeRole === "bob" || o.compositeRole === "block")
    );
    if (!anchor) continue;

    const angleDeg = (obj.params.angleDeg as number) ?? 0;
    if (anchor.compositeRole === "bob") {
      // Find the pivot of this composite.
      const pivot = next.find(
        (o) => o.compositeOf === obj.compositeOf && o.compositeRole === "pivot"
      );
      if (pivot) {
        // Vector points from anchor toward pivot = tension.
        const dy = pivot.transform.y - anchor.transform.y;
        const dx = pivot.transform.x - anchor.transform.x;
        // Use the flipped-y convention (see derivation.ts).
        const targetAngle = Math.atan2(-dy, dx) * (180 / Math.PI);
        if (angleDiff(angleDeg, targetAngle) < 12) {
          obj.compositeRole = "tension";
          continue;
        }
      }
      // Vector pointing down (270° in vector convention) = weight.
      if (angleDiff(angleDeg, 270) < 12) {
        obj.compositeRole = "weight";
        continue;
      }
    }
    if (anchor.compositeRole === "block") {
      // Find the incline of this composite.
      const incline = next.find(
        (o) => o.compositeOf === obj.compositeOf && o.compositeRole === "incline"
      );
      if (incline) {
        const inclineAngle = (incline.params.angleDeg as number) ?? 0;
        if (angleDiff(angleDeg, inclineAngle) < 12) {
          // Vector parallel to slope (uphill) = friction.
          obj.compositeRole = "friction";
          continue;
        }
        if (angleDiff(angleDeg, inclineAngle + 90) < 12) {
          // Perpendicular = normal.
          obj.compositeRole = "normal";
          continue;
        }
      }
      // Vector pointing down on a block (with no incline) = gravity.
      if (angleDiff(angleDeg, 270) < 12) {
        obj.compositeRole = "gravity";
        continue;
      }
    }
  }
}

/**
 * Smallest absolute difference between two angles in degrees, modulo 360.
 */
function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Types that are the "primary subject" of a composite — the thing the
 * composite is *about*. The pendulum is about the bob. The incline
 * problem is about the block.
 */
function isAnchorType(type: string): boolean {
  return (
    type === "pendulum_bob" ||
    type === "block" ||
    // The mass in a free-body diagram is also an anchor.
    (type === "pendulum_bob" /* covers free-body by reuse */)
  );
}

/**
 * The role of an anchor in its own composite.
 */
function primaryRoleFor(type: string): string {
  if (type === "pendulum_bob") return "bob";
  if (type === "block") return "block";
  return "anchor";
}

/**
 * When a relation points from anchor → target, what role does the
 * target play? E.g. `pendulum_from` target is the pivot; `rests_on`
 * target is the incline.
 */
function roleForRelationTarget(target: SceneObject, relKind: string): string | undefined {
  if (relKind === "pendulum_from") {
    if (target.type === "pendulum_pivot") return "pivot";
  }
  if (relKind === "rests_on") {
    if (target.type === "incline") return "incline";
    if (target.type === "ground") return "ground";
  }
  return undefined;
}

/**
 * Find the nearest object in a composite group. Used to assign
 * proximity-based roles to objects that have no explicit relation.
 *
 * For example, a vector that's `origin_at: bob` and not in a composite
 * yet should be in the bob's group.
 */
function findNearestGroupMember(
  obj: SceneObject,
  objects: SceneObject[]
): { groupId: string; nearestRole?: string } | null {
  // First, try objects that already have a relation pointing AT this one
  // (i.e. someone is already attached to this object).
  for (const other of objects) {
    if (other.id === obj.id) continue;
    if (!other.relations) continue;
    for (const rel of other.relations) {
      const targetId = "target" in rel ? rel.target : null;
      if (targetId === obj.id && other.compositeOf) {
        return { groupId: other.compositeOf, nearestRole: other.compositeRole };
      }
    }
  }
  // Fallback: nearest-by-distance. Not yet implemented — proximity-based
  // assignment should be rare and is best left to the user via the
  // Inspector's "Make this part of <composite>" dropdown.
  return null;
}

/**
 * When proximity assigns an object to a group, what role does it get?
 * For vectors attached to a bob, the role depends on the vector's
 * direction. For other objects, the role is determined by type.
 */
function roleByType(type: string, _contextRole?: string): string | undefined {
  if (type === "rope") return "rope";
  if (type === "vector") {
    // Role-by-direction is handled in a later pass — we don't have
    // enough info here to decide tension vs weight vs etc. The
    // role stays undefined, and the renderer treats that as "no
    // auto-decoration" until the user assigns one.
    return undefined;
  }
  if (type === "angle_marker") return "theta";
  return undefined;
}
