/**
 * Constraint solver — keeps objects in semantic relationships.
 *
 * For the spike we implement a *minimal* solver that handles the 5 relations
 * that make the pendulum + incline + block-on-slope demos work:
 *
 *   1. fixed_at          — object position is hard-locked
 *   2. origin_at         — object's position equals another object's anchor
 *   3. attached_to       — object is offset from another object's anchor
 *   4. rests_on          — object sits on top of a surface (e.g. block on incline)
 *   5. perpendicular_to  — vector is perpendicular to a surface
 *
 * Internally we use kiwi.js (Cassowary) for the math. Each object gets two
 * variables (x, y); each relation adds one or more constraints. After solve(),
 * we copy the variable values back into each object's transform.
 *
 * Why kiwi.js instead of hand-rolled: Cassowary handles over-constrained systems
 * (where users have both fixed_at AND origin_at on the same object) by relaxing
 * weaker constraints rather than throwing. That's exactly what we want for the
 * "AI builds it, human drags it" workflow — the drag becomes a high-strength
 * origin_at constraint, and the system resolves itself.
 */

import * as kiwi from "kiwi.js";
import type { FigurateScene, SceneObject, Vec2, Relation } from "./dsl";
import { localAnchor } from "./registry";

export class ConstraintSolver {
  private solver: kiwi.Solver;

  constructor() {
    this.solver = new kiwi.Solver();
  }

  /**
   * Solve the entire scene. Mutates each object's transform in place.
   * Returns a list of warnings (e.g. "couldn't fully satisfy ...") — for the
   * spike we just log them.
   *
   * Note: the scene passed in is frozen (Zustand+Immer), so we deep-clone it
   * before mutation, run the solver, then write results back through a
   * setter callback the store provides.
   */
  solve(scene: FigurateScene, writeBack?: (id: string, x: number, y: number) => void): string[] {
    // Reset solver
    this.solver = new kiwi.Solver();

    // Create x/y variables per object
    const xVars = new Map<string, kiwi.Variable>();
    const yVars = new Map<string, kiwi.Variable>();
    const objs = scene.objects;
    for (const obj of objs) {
      xVars.set(obj.id, new kiwi.Variable(`${obj.id}.x`));
      yVars.set(obj.id, new kiwi.Variable(`${obj.id}.y`));
    }

    // First pass: free vars default to current transform. Use medium strength
    // so explicit relations (required strength) can override them — that's
    // what makes "drag a pivot and its dependent bob follows" work without
    // "stay-where-it-was" blocking the new position.
    for (const obj of objs) {
      this.solver.addConstraint(
        new kiwi.Constraint(
          xVars.get(obj.id)!,
          kiwi.Operator.Eq,
          obj.transform.x,
          kiwi.Strength.medium
        )
      );
      this.solver.addConstraint(
        new kiwi.Constraint(
          yVars.get(obj.id)!,
          kiwi.Operator.Eq,
          obj.transform.y,
          kiwi.Strength.medium
        )
      );
    }

    const warnings: string[] = [];

    // Second pass: apply relations
    for (const obj of objs) {
      if (!obj.relations) continue;
      for (const rel of obj.relations) {
        try {
          this.applyRelation(obj, rel, scene, xVars, yVars);
        } catch (err) {
          warnings.push(
            `${obj.id}.${rel.kind}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }

    // Solve and write back
    this.solver.updateVariables();
    for (const obj of objs) {
      const newX = xVars.get(obj.id)!.value();
      const newY = yVars.get(obj.id)!.value();
      if (writeBack) {
        writeBack(obj.id, newX, newY);
      } else {
        obj.transform.x = newX;
        obj.transform.y = newY;
      }
    }

    return warnings;
  }

  private applyRelation(
    obj: SceneObject,
    rel: Relation,
    scene: FigurateScene,
    xVars: Map<string, kiwi.Variable>,
    yVars: Map<string, kiwi.Variable>
  ): void {
    const xVar = xVars.get(obj.id)!;
    const yVar = yVars.get(obj.id)!;

    // fixed_at: hard pin to an absolute point
    if (rel.kind === "fixed_at") {
      this.solver.addConstraint(new kiwi.Constraint(xVar, kiwi.Operator.Eq, rel.point.x));
      this.solver.addConstraint(new kiwi.Constraint(yVar, kiwi.Operator.Eq, rel.point.y));
      return;
    }

    // origin_at: snap to another object's anchor (in world coords)
    // The relation is between two VARIABLES (this.x and target.x), not
    // numbers — otherwise we're pinning to the target's pre-solve position.
    if (rel.kind === "origin_at") {
      const target = scene.objects.find((o) => o.id === rel.target);
      if (!target) throw new Error(`target ${rel.target} not found`);
      const anchor = rel.anchor ?? "center";
      const localPos = localAnchor(target.type, anchor, target.params);
      const targetX = xVars.get(target.id)!;
      const targetY = yVars.get(target.id)!;
      // For the spike we only handle anchor === "center" (localPos = 0,0).
      // Extending to other anchors requires adding an offset variable that's
      // rotated by the target's rotation — we leave that for the next iteration.
      if (anchor !== "center") {
        // fall back to a numeric pin using target's current transform
        const worldPos = rotateAround(localPos, target.transform.rotation ?? 0, target.transform);
        this.solver.addConstraint(new kiwi.Constraint(xVar, kiwi.Operator.Eq, worldPos.x));
        this.solver.addConstraint(new kiwi.Constraint(yVar, kiwi.Operator.Eq, worldPos.y));
      } else {
        this.solver.addConstraint(new kiwi.Constraint(xVar, kiwi.Operator.Eq, targetX));
        this.solver.addConstraint(new kiwi.Constraint(yVar, kiwi.Operator.Eq, targetY));
      }
      return;
    }

    // attached_to: object offset from another object's anchor
    if (rel.kind === "attached_to") {
      const target = scene.objects.find((o) => o.id === rel.target);
      if (!target) throw new Error(`target ${rel.target} not found`);
      const anchor = rel.anchor ?? "center";
      const localPos = localAnchor(target.type, anchor, target.params);
      const targetX = xVars.get(target.id)!;
      const targetY = yVars.get(target.id)!;
      if (anchor !== "center") {
        const worldPos = rotateAround(localPos, target.transform.rotation ?? 0, target.transform);
        this.solver.addConstraint(new kiwi.Constraint(xVar, kiwi.Operator.Eq, worldPos.x));
        this.solver.addConstraint(new kiwi.Constraint(yVar, kiwi.Operator.Eq, worldPos.y));
      } else {
        const dx = (obj.params.dx as number) ?? 0;
        const dy = (obj.params.dy as number) ?? 0;
        // xVar == targetX + dx → equivalent to xVar - targetX == dx
        const expr = new kiwi.Expression(targetX, -1).plus(new kiwi.Expression(xVar, 1));
        if (dx !== 0) {
          this.solver.addConstraint(new kiwi.Constraint(expr, kiwi.Operator.Eq, dx));
        } else {
          this.solver.addConstraint(new kiwi.Constraint(expr, kiwi.Operator.Eq, 0));
        }
        const exprY = new kiwi.Expression(targetY, -1).plus(new kiwi.Expression(yVar, 1));
        if (dy !== 0) {
          this.solver.addConstraint(new kiwi.Constraint(exprY, kiwi.Operator.Eq, dy));
        } else {
          this.solver.addConstraint(new kiwi.Constraint(exprY, kiwi.Operator.Eq, 0));
        }
      }
      return;
    }

    // rests_on: object sits on top of a surface
    if (rel.kind === "rests_on") {
      const target = scene.objects.find((o) => o.id === rel.target);
      if (!target) throw new Error(`target ${rel.target} not found`);

      const t = (rel as { fraction?: number }).fraction ?? 0.5;

      if (target.type === "incline") {
        const length = (target.params.length as number) ?? 200;
        const angleDeg = (target.params.angleDeg as number) ?? 30;
        const rad = (angleDeg * Math.PI) / 180;
        // incline starts at (target.x, target.y) and extends in direction angle
        const surfaceX = target.transform.x + t * length * Math.cos(rad);
        const surfaceY = target.transform.y - t * length * Math.sin(rad); // screen Y is inverted
        const blockH = (obj.params.height as number) ?? 40;
        // block sits ON TOP of incline surface, perpendicular to it
        this.solver.addConstraint(
          new kiwi.Constraint(xVar, kiwi.Operator.Eq, surfaceX - (blockH / 2) * Math.sin(rad))
        );
        this.solver.addConstraint(
          new kiwi.Constraint(yVar, kiwi.Operator.Eq, surfaceY - (blockH / 2) * Math.cos(rad))
        );
      } else if (target.type === "ground") {
        const groundY = target.transform.y;
        const blockH = (obj.params.height as number) ?? 40;
        const targetX = (rel as { x?: number }).x ?? obj.transform.x;
        this.solver.addConstraint(new kiwi.Constraint(xVar, kiwi.Operator.Eq, targetX));
        this.solver.addConstraint(
          new kiwi.Constraint(yVar, kiwi.Operator.Eq, groundY - blockH / 2)
        );
      }
      return;
    }

    // pendulum_from: object hangs at polar (ropeLength, angleDeg) from another
    if (rel.kind === "pendulum_from") {
      const target = scene.objects.find((o) => o.id === rel.target);
      if (!target) throw new Error(`target ${rel.target} not found`);
      const L = (obj.params.ropeLength as number) ?? 100;
      const aDeg = (obj.params.angleDeg as number) ?? 0;
      const rad = (aDeg * Math.PI) / 180;
      // screen Y is inverted; positive angleDeg swings right
      const px = target.transform.x + L * Math.sin(rad);
      const py = target.transform.y + L * Math.cos(rad);
      this.solver.addConstraint(new kiwi.Constraint(xVar, kiwi.Operator.Eq, px));
      this.solver.addConstraint(new kiwi.Constraint(yVar, kiwi.Operator.Eq, py));
      return;
    }

    // perpendicular_to: not used as a positional constraint in the spike,
    // but we keep it for completeness (it affects rotation, set in renderer).
    if (rel.kind === "perpendicular_to") {
      return;
    }
  }
}

/**
 * Rotate a local point around the object center by `rotation` degrees,
 * then translate by the object's transform.
 */
export function rotateAround(local: Vec2, rotationDeg: number, transform: { x: number; y: number }): Vec2 {
  if (!rotationDeg) return { x: transform.x + local.x, y: transform.y + local.y };
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: transform.x + local.x * cos - local.y * sin,
    y: transform.y + local.x * sin + local.y * cos,
  };
}