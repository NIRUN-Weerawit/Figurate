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
    // If the anchor has no existing composite, don't create one yet —
    // wait for step 3c (rope-based detection) or step 3b (proximity
    // detection) to find its natural group. Creating a default group
    // here caused bob1 to end up in "g_bob1" while the rope's pivot
    // ended up in "g_<random>", fragmenting the composite.
    if (!anchor.compositeOf) continue;
    const groupId = anchor.compositeOf;
    groupByObj.set(anchor.id, groupId);
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

  // Step 3c: Detect rope-based composites. If a rope primitive has
  // `params.from` and `params.to` set to two object ids, look at the
  // pair and form a composite: pivot+bob, pivot+mass, etc.
  // The pivot is the one that has type "pendulum_pivot" (or similar),
  // the other is the bob.
  for (const obj of next) {
    if (obj.type !== "rope") continue;
    const fromId = obj.params.from as string | undefined;
    const toId = obj.params.to as string | undefined;
    if (!fromId || !toId) continue;
    if (fromId === toId) continue;
    const fromObj = next.find((o) => o.id === fromId);
    const toObj = next.find((o) => o.id === toId);
    if (!fromObj || !toObj) continue;
    // Identify which is the pivot and which is the bob by type.
    let pivot: SceneObject | undefined;
    let bob: SceneObject | undefined;
    if (fromObj.type === "pendulum_pivot") {
      pivot = fromObj;
      bob = toObj;
    } else if (toObj.type === "pendulum_pivot") {
      pivot = toObj;
      bob = fromObj;
    } else {
      // Neither is a typed pivot; default: the one higher (smaller y) is the pivot.
      pivot = fromObj.transform.y < toObj.transform.y ? fromObj : toObj;
      bob = pivot === fromObj ? toObj : fromObj;
    }
    if (pivot.compositeOf && !pivot.compositeRole) {
      pivot.compositeRole = "pivot";
    }
    if (!pivot.compositeOf) {
      const gid = "g_" + Math.random().toString(36).slice(2, 9);
      pivot.compositeOf = gid;
      pivot.compositeRole = "pivot";
    }
    if (bob && !bob.compositeOf) {
      bob.compositeOf = pivot.compositeOf!;
      bob.compositeRole = "bob";
    }
    if (!obj.compositeOf) {
      obj.compositeOf = pivot.compositeOf!;
      obj.compositeRole = "rope";
    }
  }

  // Step 3d: For objects near a rope, infer they're part of the same
  // composite as the rope. E.g. a vector near a bob, or an angle_marker
  // near a pivot, should join the same group.
  for (const obj of next) {
    if (obj.compositeOf) continue;
    if (obj.type === "rope") continue; // handled above
    // Find the nearest rope in the scene. The rope primitive's
    // `transform` is a placeholder (not the actual position); the
    // real position is the midpoint of `from` and `to`. We compute
    // it on the fly for the distance check.
    let nearest: SceneObject | null = null;
    let bestDist = Infinity;
    for (const o of next) {
      if (o.type !== "rope") continue;
      const fromId = o.params.from as string | undefined;
      const toId = o.params.to as string | undefined;
      if (fromId && toId) {
        const fromObj = next.find((oo) => oo.id === fromId);
        const toObj = next.find((oo) => oo.id === toId);
        if (fromObj && toObj) {
          const mx = (fromObj.transform.x + toObj.transform.x) / 2;
          const my = (fromObj.transform.y + toObj.transform.y) / 2;
          const d = Math.hypot(mx - obj.transform.x, my - obj.transform.y);
          if (d < bestDist) {
            bestDist = d;
            nearest = o;
          }
          continue;
        }
      }
      // Fallback: use the rope's transform.
      const d = Math.hypot(
        o.transform.x - obj.transform.x,
        o.transform.y - obj.transform.y
      );
      if (d < bestDist) {
        bestDist = d;
        nearest = o;
      }
    }
    if (nearest && nearest.compositeOf && bestDist < 300) {
      obj.compositeOf = nearest.compositeOf;
      // The role will be inferred in step 4 if it's a vector.
    }
  }

  // Step 4: For vectors in a composite but with no role, infer the role
  // from the vector's current direction relative to the anchor.
  // E.g. a vector on a bob pointing at the pivot = tension.
  // A vector on a bob pointing straight down = weight.
  // A vector on a block perpendicular to the incline = normal.
  // A vector on a block parallel to the incline (uphill) = friction.
  inferVectorRoles(next, objects);

  // Step 5: assign roles to angle_marker primitives that are part of a
  // composite but have no role yet. An angle_marker near a pivot is the
  // θ-arc.
  for (const obj of next) {
    if (obj.type !== "angle_marker") continue;
    if (obj.compositeRole) continue;
    if (!obj.compositeOf) continue;
    // Default role for an angle_marker in a composite: theta.
    obj.compositeRole = "theta";
  }

  return next;
}

/**
 * For each vector in a composite without a `compositeRole`, assign a
 * role based on:
 *   1. The vector's `params.label` (if it says "T" → tension, "mg"/"W" →
 *      weight, "N" → normal, "f"/"Fr" → friction). User-declared.
 *   2. The vector's current direction (if it's already roughly aimed
 *      correctly, it gets that role). Heuristic.
 *   3. Fallback for a pendulum: the first unattached vector at the bob
 *      gets `tension`, the second gets `weight`. (Order = insertion order.)
 *   4. Fallback for a block: the first gets `gravity`, the second gets
 *      `normal`, the third gets `friction`.
 *
 * This is the "smart decorations" engine — it lets the user build a
 * physics figure by hand and the system figures out which vector is
 * which, then the derivation layer re-aims them.
 */
function inferVectorRoles(
  next: SceneObject[],
  original: SceneObject[]
): void {
  for (const obj of next) {
    if (obj.type !== "vector") continue;
    if (obj.compositeRole) continue;
    if (!obj.compositeOf) continue;

    // 1. Label-based hint (user has named the vector).
    const label = (obj.params.label as string ?? "").trim();
    const upper = label.toUpperCase();
    if (upper === "T" || upper === "FT" || upper === "F_T") {
      obj.compositeRole = "tension";
      continue;
    }
    if (upper === "MG" || upper === "W" || upper === "F_G" || upper === "FG" || upper === "WEIGHT") {
      obj.compositeRole = "weight";
      continue;
    }
    if (upper === "N" || upper === "FN" || upper === "F_N") {
      obj.compositeRole = "normal";
      continue;
    }
    if (upper === "F" || upper === "FR" || upper === "FRICTION" || upper === "F_F" || upper === "FF") {
      obj.compositeRole = "friction";
      continue;
    }

    // 2. Direction-based heuristic — but only if the vector is *clearly*
    // aimed at the right target. Tolerance is 25° (not 12°) so a slightly
    // off vector still gets recognized.
    const anchor = next.find(
      (o) => o.compositeOf === obj.compositeOf &&
             (o.compositeRole === "bob" || o.compositeRole === "block")
    );
    if (!anchor) continue;
    const angleDeg = (obj.params.angleDeg as number) ?? 0;
    if (anchor.compositeRole === "bob") {
      const pivot = next.find(
        (o) => o.compositeOf === obj.compositeOf && o.compositeRole === "pivot"
      );
      if (pivot) {
        const dy = pivot.transform.y - anchor.transform.y;
        const dx = pivot.transform.x - anchor.transform.x;
        const targetAngle = Math.atan2(-dy, dx) * (180 / Math.PI);
        if (angleDiff(angleDeg, targetAngle) < 25) {
          obj.compositeRole = "tension";
          continue;
        }
      }
      if (angleDiff(angleDeg, 270) < 25) {
        obj.compositeRole = "weight";
        continue;
      }
    }
    if (anchor.compositeRole === "block") {
      const incline = next.find(
        (o) => o.compositeOf === obj.compositeOf && o.compositeRole === "incline"
      );
      if (incline) {
        const inclineAngle = (incline.params.angleDeg as number) ?? 0;
        if (angleDiff(angleDeg, inclineAngle) < 25) {
          obj.compositeRole = "friction";
          continue;
        }
        if (angleDiff(angleDeg, inclineAngle + 90) < 25) {
          obj.compositeRole = "normal";
          continue;
        }
      }
      if (angleDiff(angleDeg, 270) < 25) {
        obj.compositeRole = "gravity";
        continue;
      }
    }
  }

  // 3. Fallback for unattached vectors: assign roles in insertion order.
  // For each composite with a bob, the first untagged vector at the bob
  // gets `tension`, the second gets `weight`. This handles the case
  // where the user just dropped unlabeled vectors near the bob.
  const compositeBuckets = new Map<string, SceneObject[]>();
  for (const obj of next) {
    if (obj.type !== "vector") continue;
    if (obj.compositeRole) continue;
    if (!obj.compositeOf) continue;
    const list = compositeBuckets.get(obj.compositeOf) ?? [];
    list.push(obj);
    compositeBuckets.set(obj.compositeOf, list);
  }
  for (const [, vectors] of compositeBuckets) {
    // Find the anchor type to decide which roles to assign.
    const anchor = next.find(
      (o) => compositeBuckets.size > 0 &&
             (o.compositeRole === "bob" || o.compositeRole === "block") &&
             vectors.some((v) => v.compositeOf === o.compositeOf)
    );
    if (!anchor) continue;
    // Default role order depends on anchor type.
    const roleOrder =
      anchor.compositeRole === "bob"
        ? ["tension", "weight", "tension", "weight"]
        : ["gravity", "normal", "friction"];
    vectors.forEach((v, i) => {
      if (!v.compositeRole) {
        v.compositeRole = roleOrder[i % roleOrder.length];
      }
    });
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
