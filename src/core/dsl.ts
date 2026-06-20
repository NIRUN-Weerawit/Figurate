/**
 * Figurate JSON DSL — the canonical scene format.
 *
 * Every object in a Figurate scene has:
 *   - id            : unique identifier
 *   - type          : primitive type (e.g. "pendulum_bob", "incline", "vector")
 *   - params        : type-specific free parameters (angles, lengths, masses)
 *   - transform     : solved position/rotation/scale (filled by the constraint solver)
 *   - style         : optional rendering hints (color, stroke width, fill)
 *   - label         : optional math or text label
 *   - relations     : semantic links to other objects ("attached to", "perpendicular to", ...)
 *   - zIndex        : rendering order (higher = on top)
 *   - locked        : if true, the GUI won't let users drag this object
 *
 * The constraint solver turns (params + relations) into (transform). The GUI
 * round-trips: dragging an object overrides its transform and re-runs the solver.
 */

export type Vec2 = { x: number; y: number };

/**
 * Anchor points on an object. Most primitives expose at least center + 4 cardinal
 * points. Custom primitives can define their own anchor vocabulary.
 */
export type Anchor =
  | "center"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "topLeft"
  | "topRight"
  | "bottomLeft"
  | "bottomRight"
  | "start" // for line/rope: the "from" endpoint
  | "end"; // for line/rope: the "to" endpoint

/**
 * Semantic relations between objects. The solver understands these. The GUI
 * displays them as visual cues (snap lines, alignment guides).
 */
export type Relation =
  | { kind: "fixed_at"; point: Vec2 }
  | { kind: "origin_at"; target: string; anchor?: Anchor }
  | { kind: "attached_to"; target: string; anchor?: Anchor; selfAnchor?: Anchor }
  | { kind: "rests_on"; target: string; anchor?: Anchor; fraction?: number }
  | { kind: "perpendicular_to"; target: string }
  | { kind: "parallel_to"; target: string }
  | { kind: "equal_length_to"; target: string }
  | { kind: "angle_between"; target: string; angleDeg: number }
  | { kind: "tangent_to"; target: string; anchor?: Anchor }
  | { kind: "inside"; target: string }
  /**
   * pendulum_from: position object at polar coordinates relative to a pivot.
   * The distance and angle come from the *source* object's params
   * (ropeLength and angleDeg). This is the relation that makes the
   * "swing the pendulum" demo work.
   */
  | { kind: "pendulum_from"; target: string };

/**
 * A text or math label attached to an object.
 */
export type ObjectLabel =
  | { kind: "text"; content: string; offset?: Vec2; fontSize?: number; color?: string }
  | { kind: "math"; content: string; offset?: Vec2; fontSize?: number; color?: string };

/**
 * Style overrides. Always optional — primitives have sensible defaults.
 */
export interface Style {
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  fontFamily?: string;
}

export interface SceneObject<P = Record<string, unknown>> {
  id: string;
  type: string;
  params: P;
  transform: { x: number; y: number; rotation?: number; scale?: number };
  style?: Style;
  label?: ObjectLabel;
  relations?: Relation[];
  zIndex?: number;
  locked?: boolean;
}

export interface CanvasConfig {
  width: number;
  height: number;
  background: string;
  grid?: { enabled: boolean; spacing: number; color?: string };
}

export interface FigurateScene {
  version: "0.1.0";
  meta: {
    title?: string;
    subject?: string; // e.g. "physics:mechanics"
    notes?: string;
  };
  canvas: CanvasConfig;
  objects: SceneObject[];
}