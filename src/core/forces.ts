/**
 * Force inventory — the catalog of mechanical forces used in a free-body
 * diagram. Each force type has:
 *   - a label (the symbol used in the diagram, e.g. "T", "F_N", "F_g")
 *   - a formula (LaTeX-friendly string, e.g. "F_g = mg")
 *   - a way to compute the direction (angle in degrees, vector convention)
 *     given the object and the scene
 *   - a way to compute the magnitude (default is 100, user can override)
 *   - whether the force is always present or only sometimes
 *
 * The system calls `computeForces(obj, scene)` to get the list of forces
 * acting on a given object. The list is rendered as an FBD overlay.
 *
 * Force types covered (mechanical physics 1):
 *
 *   1. gravity (F_g)         — always on any object with mass
 *   2. tension (T)           — when attached to a rope
 *   3. normal (N)            — when in contact with a surface
 *   4. friction (f)          — when in contact with a surface
 *   5. applied (F_app)       — user-added (e.g. via a vector primitive)
 *   6. spring (F_s)          — when attached to a spring (rope with k≠0)
 *   7. drag (F_d)            — when moving through a fluid (heuristic)
 *   8. buoyancy (F_b)        — when in a fluid (heuristic)
 *   9. magnetic (F_m)        — when in a magnetic field
 *  10. electric (F_e)        — when in an electric field
 *  11. centripetal (F_c)     — when on a circular path (heuristic)
 *  12. gravitational (F_g*)  — when in orbit (heuristic)
 *
 * The system is **conservative** — it only shows forces it can confidently
 * detect from relations. Unknown forces (e.g. an arbitrary applied force)
 * are visible to the user as vector primitives in the scene but are NOT
 * auto-detected as FBD forces. The user can add applied forces by adding
 * a vector primitive with `relations: [{ kind: "applied_to", target }]`.
 */

import type { FigurateScene, SceneObject, Vec2 } from "./dsl";

/** All force types supported by the FBD system. */
export type ForceType =
  | "gravity"
  | "tension"
  | "normal"
  | "friction_kinetic"
  | "friction_static"
  | "applied"
  | "spring"
  | "drag"
  | "buoyancy"
  | "magnetic"
  | "electric"
  | "centripetal"
  | "orbital_gravity";

/**
 * A force in an FBD. Pure data — the renderer turns this into SVG.
 * `direction` is in vector-primitive degrees (0° = right, 90° = up,
 * 180° = left, 270° = down). `magnitude` is in world units (pixels).
 */
export interface Force {
  type: ForceType;
  /** Symbol used to label the force, e.g. "T", "F_N", "F_g". */
  label: string;
  /** LaTeX-friendly formula string for the Inspector readout. */
  formula: string;
  /** Direction in vector-primitive degrees. */
  directionDeg: number;
  /** Length in world units (pixels). */
  magnitude: number;
  /** Color of the arrow. */
  color: string;
  /** A short note about when this force applies. */
  description: string;
  /** The "anchor" of the force — usually the object's center. */
  origin: Vec2;
  /** Whether the user has manually toggled this force off. */
  enabled: boolean;
  /** Force is present in this scene's setup. False = could apply but doesn't. */
  present: boolean;
}

/**
 * A `ForceGroup` is the FBD overlay for one object. It's a virtual
 * composite — not stored in the scene, computed on the fly.
 */
export interface ForceGroup {
  /** The object this FBD describes. */
  objectId: string;
  /** All candidate forces (some may be disabled). */
  forces: Force[];
}

/**
 * Compute the FBD force group for a single object.
 *
 * Walks the object's relations, type, and properties to determine which
 * forces could plausibly act on it. Returns a list of `Force` objects
 * with computed directions, magnitudes, formulas, and labels. All
 * forces default to `enabled: true` and `present: true`; the user can
 * toggle them off in the Inspector.
 */
export function computeForces(obj: SceneObject, scene: FigurateScene): ForceGroup {
  const forces: Force[] = [];

  // 1. Gravity — always (if object has mass)
  forces.push(computeGravity(obj, scene));

  // 2. Tension — if attached to a rope
  const tension = computeTension(obj, scene);
  if (tension) forces.push(tension);

  // 3. Normal & 4. Friction — if in contact with a surface
  //    (block rests on incline, block on ground, etc.)
  const contacts = computeContactForces(obj, scene);
  forces.push(...contacts);

  // 5. Spring — if attached to a spring (rope with k != 0)
  const spring = computeSpring(obj, scene);
  if (spring) forces.push(spring);

  // 6. Applied — if any vector primitive has `applied_to: obj.id`
  const applied = computeAppliedForces(obj, scene);
  forces.push(...applied);

  // 7. Drag & 8. Buoyancy — heuristic: object has `medium: "fluid"` param
  //    or scene has a fluid primitive. Default off.
  const drag = computeDrag(obj, scene);
  if (drag) forces.push(drag);
  const buoyancy = computeBuoyancy(obj, scene);
  if (buoyancy) forces.push(buoyancy);

  // 9. Magnetic — if scene has a magnetic_field primitive and the
  //    object has a charge. Default off (rare).
  const magnetic = computeMagnetic(obj, scene);
  if (magnetic) forces.push(magnetic);

  // 10. Electric — if scene has an electric_field primitive and the
  //     object has a charge.
  const electric = computeElectric(obj, scene);
  if (electric) forces.push(electric);

  // 11. Centripetal — if object is on a circular path. Heuristic.
  const centripetal = computeCentripetal(obj, scene);
  if (centripetal) forces.push(centripetal);

  // 12. Orbital gravity — if object is a satellite.
  const orbital = computeOrbitalGravity(obj, scene);
  if (orbital) forces.push(orbital);

  return { objectId: obj.id, forces };
}

/**
 * Apply user overrides from the FBD store to a fresh `ForceGroup`.
 * The store keeps per-object, per-force overrides for:
 *   - enabled flag (boolean)
 *   - magnitude (number)
 *   - direction (number, degrees)
 * Returns a new ForceGroup with the overrides applied.
 */
export function applyFbdOverrides(
  group: ForceGroup,
  overrides: Record<string, unknown> | undefined
): ForceGroup {
  if (!overrides) return group;
  // Master toggle: if `_visible` is false, hide all forces.
  if (overrides["_visible"] === false) {
    return {
      ...group,
      forces: group.forces.map((f) => ({ ...f, enabled: false })),
    };
  }
  return {
    ...group,
    forces: group.forces.map((f) => {
      const enabled = overrides[f.type];
      const mag = overrides[`_mag_${f.type}`];
      const dir = overrides[`_dir_${f.type}`];
      return {
        ...f,
        enabled: typeof enabled === "boolean" ? enabled : f.enabled,
        magnitude: typeof mag === "number" ? mag : f.magnitude,
        directionDeg: typeof dir === "number" ? dir : f.directionDeg,
      };
    }),
  };
}

// ─── Individual force computations ───────────────────────────────

function computeGravity(obj: SceneObject, _scene: FigurateScene): Force {
  return {
    type: "gravity",
    label: "F_g",
    formula: "F_g = m \\cdot g",
    // 270° in vector convention = down in screen-space
    directionDeg: 270,
    magnitude: 90,
    color: "#e74c3c",
    description: "Gravitational force on the object. Always present (acts on all mass).",
    origin: { x: obj.transform.x, y: obj.transform.y },
    enabled: true,
    present: true,
  };
}

function computeTension(
  obj: SceneObject,
  scene: FigurateScene
): Force | null {
  // Find a rope primitive that has this object as `to` (bob-end)
  // OR as `from` (anchor-end, but in that case the force is on the
  // other end of the rope, not this one).
  const rope = scene.objects.find((o) => {
    if (o.type !== "rope") return false;
    const toId = o.params.to as string | undefined;
    return toId === obj.id;
  });
  if (!rope) return null;
  const fromId = rope.params.from as string | undefined;
  if (!fromId) return null;
  const pivot = scene.objects.find((o) => o.id === fromId);
  if (!pivot) return null;
  // Tension direction: from the bob, toward the pivot
  const dx = pivot.transform.x - obj.transform.x;
  const dy = pivot.transform.y - obj.transform.y;
  // In vector convention: cos θ = dx/L, -sin θ = dy/L → θ = atan2(-dy, dx)
  const dir = (Math.atan2(-dy, dx) * 180) / Math.PI;
  return {
    type: "tension",
    label: "T",
    formula: "T = (\\text{from rope tension})",
    directionDeg: dir,
    magnitude: 100,
    color: "#3498db",
    description: "Tension along the rope toward the pivot.",
    origin: { x: obj.transform.x, y: obj.transform.y },
    enabled: true,
    present: true,
  };
}

function computeContactForces(
  obj: SceneObject,
  scene: FigurateScene
): Force[] {
  const out: Force[] = [];
  // Find a `rests_on` relation from this object to an incline/ground.
  const contactRel = (obj.relations ?? []).find(
    (r) => r.kind === "rests_on"
  );
  if (!contactRel) return out;
  const surface = scene.objects.find((o) => o.id === contactRel.target);
  if (!surface) return out;
  // The surface's "up" direction. For an incline, that's inclineAngle + 90°
  // (perpendicular to the surface, pointing away from the surface). For a
  // ground, that's just 270° (down) — and N is 90° (up).
  let normalDir: number;
  let frictionDir: number;
  if (surface.type === "incline") {
    const a = (surface.params.angleDeg as number) ?? 0;
    // In vector convention, the incline's "up" is at angle (a + 90°).
    normalDir = a + 90;
    // Friction along the incline. Up-the-slope is a, down-the-slope is
    // a + 180°. We default to "up-the-slope" (a) since friction
    // opposes motion; if user wants the other direction, they can flip
    // it in the Inspector.
    frictionDir = a;
  } else if (surface.type === "ground") {
    normalDir = 90; // up
    frictionDir = 0; // rightward by default; can flip
  } else {
    return out;
  }
  out.push({
    type: "normal",
    label: "F_N",
    formula: "F_N = (\\text{surface reaction})",
    directionDeg: normalDir,
    magnitude: 80,
    color: "#27ae60",
    description: "Normal force from the surface. Perpendicular to the contact.",
    origin: { x: obj.transform.x, y: obj.transform.y },
    enabled: true,
    present: true,
  });
  out.push({
    type: "friction_kinetic",
    label: "f",
    formula: "f = \\mu_k \\cdot F_N",
    directionDeg: frictionDir,
    magnitude: 50,
    color: "#f39c12",
    description: "Kinetic friction along the surface. Opposes motion.",
    origin: { x: obj.transform.x, y: obj.transform.y },
    enabled: true,
    present: true,
  });
  return out;
}

function computeSpring(
  obj: SceneObject,
  scene: FigurateScene
): Force | null {
  // A spring is a rope primitive with a non-zero stiffness param.
  const spring = scene.objects.find((o) => {
    if (o.type !== "rope") return false;
    const k = o.params.stiffness as number | undefined;
    return k !== undefined && k > 0;
  });
  if (!spring) return null;
  // Check if the spring is attached to this object
  const fromId = spring.params.from as string | undefined;
  const toId = spring.params.to as string | undefined;
  if (toId !== obj.id && fromId !== obj.id) return null;
  // Spring force points from object toward the spring's other end.
  const otherId = toId === obj.id ? fromId : toId;
  const other = scene.objects.find((o) => o.id === otherId);
  if (!other) return null;
  const dx = other.transform.x - obj.transform.x;
  const dy = other.transform.y - obj.transform.y;
  const dir = (Math.atan2(-dy, dx) * 180) / Math.PI;
  return {
    type: "spring",
    label: "F_s",
    formula: "F_s = -k \\cdot x",
    directionDeg: dir,
    magnitude: 70,
    color: "#9b59b6",
    description: "Spring force toward the other end of the spring.",
    origin: { x: obj.transform.x, y: obj.transform.y },
    enabled: true,
    present: true,
  };
}

function computeAppliedForces(
  obj: SceneObject,
  scene: FigurateScene
): Force[] {
  const out: Force[] = [];
  // Find vector primitives that have `applied_to: obj.id` relation
  // OR have a custom relation kind like "applied_to" (we use "origin_at"
  // currently, but the FBD system also recognizes a special "applied" flag).
  for (const v of scene.objects) {
    if (v.type !== "vector") continue;
    const isApplied = (v.relations ?? []).some(
      (r) => {
        const targetId = "target" in r ? r.target : null;
        if (targetId !== obj.id) return false;
        // FBD treats origin_at as "this vector is anchored at the
        // object, so it's an applied force on the object". The kind
        // union doesn't include "applied_to" yet, so we accept the
        // existing origin_at relation as the canonical "applied" link.
        return r.kind === "origin_at";
      }
    );
    if (!isApplied) continue;
    const angleDeg = (v.params.angleDeg as number) ?? 0;
    const magnitude = (v.params.magnitude as number) ?? 80;
    const label = (v.params.label as string) ?? "F";
    out.push({
      type: "applied",
      label,
      formula: "F_{\\text{app}} = (\\text{user-defined})",
      directionDeg: angleDeg,
      magnitude,
      color: (v.params.color as string) ?? "#1f6feb",
      description: "User-applied force. Edit angle/magnitude to change.",
      origin: { x: obj.transform.x, y: obj.transform.y },
      enabled: true,
      present: true,
    });
  }
  return out;
}

function computeDrag(obj: SceneObject, _scene: FigurateScene): Force | null {
  // Heuristic: if obj has `medium: "fluid"` param, it's in a fluid → drag.
  // We don't know velocity, so default to "opposite of typical motion"
  // — for a pendulum bob, that's along its velocity (tangent to the arc).
  // For a static block, no drag. Default OFF.
  if (obj.params?.medium !== "fluid") return null;
  return {
    type: "drag",
    label: "F_d",
    formula: "F_d = -b v \\quad \\text{or} \\quad \\tfrac{1}{2} \\rho v^2 C_d A",
    directionDeg: 0, // user can override in Inspector
    magnitude: 60,
    color: "#16a085",
    description: "Drag force (opposes velocity). Default direction; edit in Inspector.",
    origin: { x: obj.transform.x, y: obj.transform.y },
    enabled: false, // default off — heuristic
    present: true,
  };
}

function computeBuoyancy(obj: SceneObject, _scene: FigurateScene): Force | null {
  if (obj.params?.medium !== "fluid") return null;
  return {
    type: "buoyancy",
    label: "F_b",
    formula: "F_b = \\rho_{\\text{fluid}} V g",
    directionDeg: 90, // up
    magnitude: 60,
    color: "#3498db",
    description: "Buoyancy (upward force from displaced fluid).",
    origin: { x: obj.transform.x, y: obj.transform.y },
    enabled: false,
    present: true,
  };
}

function computeMagnetic(obj: SceneObject, scene: FigurateScene): Force | null {
  // Heuristic: scene has a `magnetic_field` primitive and object has a charge.
  const hasField = scene.objects.some((o) => o.type === "magnetic_field");
  const charge = obj.params?.charge as number | undefined;
  if (!hasField || charge === undefined || charge === 0) return null;
  return {
    type: "magnetic",
    label: "F_m",
    formula: "\\vec{F}_m = q \\vec{v} \\times \\vec{B}",
    directionDeg: 0, // user can adjust; right-hand rule is contextual
    magnitude: 80,
    color: "#e67e22",
    description: "Magnetic force (perpendicular to velocity and field).",
    origin: { x: obj.transform.x, y: obj.transform.y },
    enabled: false,
    present: true,
  };
}

function computeElectric(obj: SceneObject, scene: FigurateScene): Force | null {
  const hasField = scene.objects.some((o) => o.type === "electric_field");
  const charge = obj.params?.charge as number | undefined;
  if (!hasField || charge === undefined || charge === 0) return null;
  return {
    type: "electric",
    label: "F_e",
    formula: "\\vec{F}_e = q \\vec{E}",
    directionDeg: 0,
    magnitude: 80,
    color: "#8e44ad",
    description: "Electric force (along the field, + for +q).",
    origin: { x: obj.transform.x, y: obj.transform.y },
    enabled: false,
    present: true,
  };
}

function computeCentripetal(
  obj: SceneObject,
  _scene: FigurateScene
): Force | null {
  // Heuristic: object has `circular: true` param, or it's a known
  // circular-motion case (e.g. a ball on a string being whirled).
  if (obj.params?.circular !== true) return null;
  return {
    type: "centripetal",
    label: "F_c",
    formula: "F_c = \\frac{m v^2}{r}",
    directionDeg: 0, // toward center — user can adjust
    magnitude: 90,
    color: "#d35400",
    description: "Centripetal force (toward center of circular path).",
    origin: { x: obj.transform.x, y: obj.transform.y },
    enabled: false,
    present: true,
  };
}

function computeOrbitalGravity(
  obj: SceneObject,
  _scene: FigurateScene
): Force | null {
  if (obj.params?.satellite !== true) return null;
  return {
    type: "orbital_gravity",
    label: "F_g*",
    formula: "F_g = \\frac{G M m}{r^2}",
    directionDeg: 0, // toward central mass
    magnitude: 100,
    color: "#c0392b",
    description: "Gravitational force (Newton's law, for orbits).",
    origin: { x: obj.transform.x, y: obj.transform.y },
    enabled: false,
    present: true,
  };
}

/**
 * Scan the entire scene and count how many forces could be auto-detected.
 * Returns a per-object summary.
 */
export function detectAllForces(
  scene: FigurateScene
): Array<{ objectId: string; forceCount: number; forces: Force[] }> {
  const out: Array<{ objectId: string; forceCount: number; forces: Force[] }> = [];
  for (const obj of scene.objects) {
    const fbd = computeForces(obj, scene);
    // Only count present+enabled-by-default forces
    const present = fbd.forces.filter((f) => f.present);
    if (present.length > 0) {
      out.push({
        objectId: obj.id,
        forceCount: present.length,
        forces: present,
      });
    }
  }
  return out;
}

/**
 * Force type metadata — labels, colors, descriptions. Used by the
 * Inspector to render the per-force toggle list.
 */
export const FORCE_META: Record<
  ForceType,
  { label: string; color: string; description: string; category: string }
> = {
  gravity: {
    label: "Gravity (F_g)",
    color: "#e74c3c",
    description: "Gravitational force (always on mass).",
    category: "field",
  },
  tension: {
    label: "Tension (T)",
    color: "#3498db",
    description: "Tension along a rope/cable.",
    category: "contact",
  },
  normal: {
    label: "Normal (F_N)",
    color: "#27ae60",
    description: "Normal force from a surface.",
    category: "contact",
  },
  friction_kinetic: {
    label: "Friction, kinetic (f)",
    color: "#f39c12",
    description: "Kinetic friction along a surface.",
    category: "contact",
  },
  friction_static: {
    label: "Friction, static (f_s)",
    color: "#f39c12",
    description: "Static friction (≤ μ_s N).",
    category: "contact",
  },
  applied: {
    label: "Applied (F_app)",
    color: "#1f6feb",
    description: "User-defined applied force.",
    category: "user",
  },
  spring: {
    label: "Spring (F_s)",
    color: "#9b59b6",
    description: "Hooke's law spring force.",
    category: "contact",
  },
  drag: {
    label: "Drag (F_d)",
    color: "#16a085",
    description: "Drag (opposes motion in a fluid).",
    category: "field",
  },
  buoyancy: {
    label: "Buoyancy (F_b)",
    color: "#3498db",
    description: "Buoyancy (Archimedes' principle).",
    category: "field",
  },
  magnetic: {
    label: "Magnetic (F_m)",
    color: "#e67e22",
    description: "Magnetic force on a moving charge.",
    category: "field",
  },
  electric: {
    label: "Electric (F_e)",
    color: "#8e44ad",
    description: "Electric force on a charge.",
    category: "field",
  },
  centripetal: {
    label: "Centripetal (F_c)",
    color: "#d35400",
    description: "Net inward force on circular path.",
    category: "kinematic",
  },
  orbital_gravity: {
    label: "Orbital gravity (F_g*)",
    color: "#c0392b",
    description: "Newtonian gravity for orbits.",
    category: "field",
  },
};
