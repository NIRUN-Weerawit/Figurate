/**
 * Scene-level derivation registry.
 *
 * For each primitive type that has smart (cross-object) behavior, this file
 * declares the derivations that apply to a specific instance of that type.
 *
 * The derivation engine in `derivation.ts` handles recomputation; this file
 * just declares "what should be derived, from what".
 *
 * Adding a new smart primitive
 * ────────────────────────────
 * 1. Implement the primitive as normal (with `render`, `params`, etc.).
 * 2. Add an entry to `DERIVATIONS_BY_TYPE` below — a function that takes
 *    the object's id + scene and returns its list of derivations.
 * 3. The render function should read derived values from `props.derived`
 *    instead of the underlying `params` for any field that has a derivation.
 *
 * Design rules
 * ────────────
 * - One rule per output field. Don't write to two fields from one rule.
 * - Prefer reading from a small set of named parents. The DAG's smart pass
 *   only re-runs rules whose parents changed; the more parents you read,
 *   the more often the rule re-runs.
 * - If you need to compute a value from many parents, do it in JS, not in
 *   the rule. The rule is just a "compute function" — you can call any
 *   helper. The DAG only cares about which fields you read.
 */

import type { FigurateScene, SceneObject } from "./dsl";
import type { Derivation } from "./derivation";
import { aimAt, mirrorParam, constant } from "./derivation";

/**
 * Build the full list of derivations that should run for a given scene.
 * The scene store calls this whenever the scene structure changes
 * (add, remove, composite-expand). The returned list is then passed to
 * `recomputeAll()` after the constraint solver.
 */
export function buildSceneDerivations(scene: FigurateScene): Derivation[] {
  const out: Derivation[] = [];
  for (const obj of scene.objects) {
    out.push(...derivationsForObject(obj, scene));
  }
  return out;
}

/**
 * Derive the rules for a single object. The function dispatches on the
 * object's *role* (composite decoration vs. anchor vs. plain object) and
 * on its type. A tension vector that's part of a pendulum composite reads
 * the role from `obj.compositeRole`; a block on an incline reads it from
 * the type + a `restTarget` param if any. The composite metadata is the
 * routing layer.
 */
function derivationsForObject(obj: SceneObject, scene: FigurateScene): Derivation[] {
  const out: Derivation[] = [];
  const role = obj.compositeRole;

  // ── Pendulum composite decorations ─────────────────────────────
  if (role === "tension") {
    // T points from bob toward pivot. Read the bob (where the T is anchored)
    // and the pivot (where the T points to).
    const bobId = findRelTarget(obj, "origin_at");
    const pivotId = findPendulumPivot(scene, bobId);
    if (bobId && pivotId) {
      out.push(
        aimAt(
          `tension-${obj.id}-aim`,
          { object: obj.id, field: "params.angleDeg" },
          bobId, // from: T is anchored at the bob
          pivotId // to: T points at the pivot
        )
      );
    }
  } else if (role === "weight") {
    // Weight (mg) always points straight DOWN in screen-space. In the vector
    // primitive's angle convention, 270° = down (because the primitive's
    // y-component is `y - mag·sin(θ)`, so 270° = sin(270°) = -1, rendering
    // to y + mag = DOWN). Equivalent values: 270, -90, 270 + 360n.
    out.push(
      constant(`weight-${obj.id}-down`, { object: obj.id, field: "params.angleDeg" }, 270)
    );
  } else if (role === "theta" || obj.type === "angle_marker") {
    // Two cases: a pendulum θ-arc (between vertical and rope) or an
    // incline θ-arc (between horizontal and the surface).
    const inclineId = findCompositeIncline(scene, obj.compositeOf);
    if (inclineId) {
      // Incline θ-arc. The vertex is the lower-left corner of the
      // incline. The arc goes from "horizontal-right" (90° in screen
      // convention) to "the surface direction" (90° - incline.angleDeg
      // in screen convention, since positive incline angle tilts the
      // surface UP to the right).
      const incline = scene.objects.find((o) => o.id === inclineId);
      if (incline) {
        // The incline's "left end" (lower-left) is at:
        //   x = transform.x - (length/2) * cos(angleDeg)
        //   y = transform.y + (length/2) * sin(angleDeg)
        // (the slope goes from left to right; transform is the center).
        const L = (incline.params.length as number) ?? 200;
        const aDeg = (incline.params.angleDeg as number) ?? 0;
        const aRad = (aDeg * Math.PI) / 180;
        const lx = incline.transform.x - (L / 2) * Math.cos(aRad);
        const ly = incline.transform.y + (L / 2) * Math.sin(aRad);
        // Pin the vertex to the incline's lower-left corner.
        out.push(
          constant(`theta-incline-${obj.id}-vx`, { object: obj.id, field: "params.vertexX" }, lx)
        );
        out.push(
          constant(`theta-incline-${obj.id}-vy`, { object: obj.id, field: "params.vertexY" }, ly)
        );
        // fromAngleDeg = 90° (horizontal-right in screen convention).
        out.push(
          constant(`theta-incline-${obj.id}-from`, { object: obj.id, field: "params.fromAngleDeg" }, 90)
        );
        // toAngleDeg = 90° - incline.angleDeg. The arc goes from
        // horizontal to the slope, opening UPWARD into the wedge.
        out.push(
          constant(
            `theta-incline-${obj.id}-to`,
            { object: obj.id, field: "params.toAngleDeg" },
            90 - aDeg
          )
        );
      }
      return out;
    }
    // Pendulum θ-arc: toAngleDeg mirrors the bob's angleDeg. We find
    // the bob via the composite's siblings: the same `compositeOf`
    // group should have a `pendulum_bob` object.
    const bobId = findCompositeBob(scene, obj.compositeOf);
    if (bobId) {
      out.push(
        mirrorParam(
          `theta-${obj.id}-toAngle`,
          { object: obj.id, field: "params.toAngleDeg" },
          bobId,
          "params.angleDeg"
        )
      );
      // Also pin the vertex to the pivot's position so the arc stays
      // anchored at the rotation point.
      const pivotId = findPendulumPivot(scene, bobId);
      if (pivotId) {
        out.push(
          mirrorParam(
            `theta-${obj.id}-vertexX`,
            { object: obj.id, field: "params.vertexX" },
            pivotId,
            "transform.x"
          )
        );
        out.push(
          mirrorParam(
            `theta-${obj.id}-vertexY`,
            { object: obj.id, field: "params.vertexY" },
            pivotId,
            "transform.y"
          )
        );
      }
    }
  }

  // ── Incline composite decorations ──────────────────────────────
  if (role === "block") {
    // The block rotates to match the incline's angle.
    const inclineId = findRelTarget(obj, "rests_on");
    if (inclineId) {
      out.push(
        mirrorParam(
          `block-${obj.id}-rot`,
          { object: obj.id, field: "transform.rotation" },
          inclineId,
          "params.angleDeg"
        )
      );
    }
  } else if (role === "gravity") {
    // mg on a block on incline: always straight DOWN, 270° in vector convention.
    out.push(
      constant(`gravity-${obj.id}-down`, { object: obj.id, field: "params.angleDeg" }, 270)
    );
  } else if (role === "normal") {
    // N is perpendicular to the incline surface (angle + 90° in screen-space).
    const inclineId = findInclineFromAnchor(obj, scene);
    if (inclineId) {
      out.push({
        id: `normal-${obj.id}-perp`,
        parents: [{ object: inclineId, field: "params.angleDeg" }],
        target: { object: obj.id, field: "params.angleDeg" },
        compute: (ctx) => {
          const a = ctx.get({ object: inclineId, field: "params.angleDeg" }) as number;
          return a + 90;
        },
      });
    }
  } else if (role === "friction") {
    // f points up-the-slope, which is the same direction as the incline
    // surface itself (25° = "up the slope to the right"). NOT +180° —
    // that would point down-slope, which is the direction the block is
    // tending to slide, not the friction force opposing it.
    const inclineId = findInclineFromAnchor(obj, scene);
    if (inclineId) {
      out.push({
        id: `friction-${obj.id}-upslope`,
        parents: [{ object: inclineId, field: "params.angleDeg" }],
        target: { object: obj.id, field: "params.angleDeg" },
        compute: (ctx) => {
          const a = ctx.get({ object: inclineId, field: "params.angleDeg" }) as number;
          return a; // same direction as the slope
        },
      });
    }
  }

  // ── Rope: endpoints are derived from the from/to targets ──────
  if (obj.type === "rope") {
    const from = obj.params.from as string | undefined;
    const to = obj.params.to as string | undefined;
    if (from && to) {
      // We don't actually need to write the endpoints as derived fields
      // — the rope renderer reads `from` and `to` and looks up the
      // targets' positions directly. So no derivations are needed here;
      // this is just a marker for "this rope is parameterised by other
      // objects". A real rope might want a derived `length` field for
      // HUD display; we leave that as future work.
    }
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────
// Helpers: find the relevant companion object for a composite decoration.
// ─────────────────────────────────────────────────────────────────

/** Find the object that this object has a relation of the given kind to. */
function findRelTarget(obj: SceneObject, kind: string): string | undefined {
  if (!obj.relations) return undefined;
  for (const r of obj.relations) {
    if (r.kind === kind && "target" in r) return r.target;
  }
  return undefined;
}

/** Find the pendulum pivot that owns a given bob. The pivot is a sibling
 *  of the bob in the same composite group, of type pendulum_pivot. */
function findPendulumPivot(scene: FigurateScene, bobId: string | undefined): string | undefined {
  if (!bobId) return undefined;
  const bob = scene.objects.find((o) => o.id === bobId);
  if (!bob || !bob.compositeOf) return undefined;
  return scene.objects.find(
    (o) => o.compositeOf === bob.compositeOf && o.type === "pendulum_pivot"
  )?.id;
}

/** Find the bob in a composite group (used to track the bob's angleDeg). */
function findCompositeBob(scene: FigurateScene, groupId: string | undefined): string | undefined {
  if (!groupId) return undefined;
  return scene.objects.find(
    (o) => o.compositeOf === groupId && o.type === "pendulum_bob"
  )?.id;
}

/** Find the incline in a composite group. */
function findCompositeIncline(scene: FigurateScene, groupId: string | undefined): string | undefined {
  if (!groupId) return undefined;
  return scene.objects.find(
    (o) => o.compositeOf === groupId && o.type === "incline"
  )?.id;
}

/** Find the incline that a decoration belongs to. Used for the normal/friction
 *  vectors on a block-on-incline composite, where the decoration is anchored
 *  to the block (not the incline). We find the incline as a sibling of the
 *  block in the same composite group. */
function findInclineFromAnchor(obj: SceneObject, scene: FigurateScene): string | undefined {
  if (!obj.compositeOf) return undefined;
  // The block in this composite is a sibling; the incline is the anchor.
  // (For block_on_incline, the anchor is the incline itself, so the
  // block is the *anchor's sibling*.)
  return scene.objects.find(
    (o) => o.compositeOf === obj.compositeOf && o.type === "incline"
  )?.id;
}
