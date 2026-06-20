/**
 * Primitive registry — the vocabulary of objects users can put on the canvas.
 *
 * A primitive is a *type definition*:
 *   - metadata (name, category, icon, description)
 *   - params schema (which parameters it takes, with defaults)
 *   - the SVG fragment that renders it, given a transform + params
 *
 * Note: relations are not declared here — they're attached per-object in the scene.
 * This keeps the registry simple and lets the constraint solver treat all primitives
 * generically (it only needs anchor points + transform coords).
 */

import type { Anchor, Vec2 } from "./dsl";

export type ParamType = "number" | "string" | "boolean" | "color" | "angle";

export interface ParamSchema {
  name: string;
  type: ParamType;
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  description?: string;
}

export type PrimitiveCategory = "mechanics" | "fields" | "optics" | "circuits" | "geometry" | "annotation";

export interface PrimitiveDefinition {
  type: string;
  category: PrimitiveCategory;
  label: string;
  description: string;
  /** anchor points this primitive exposes (the solver uses these) */
  anchors: Anchor[];
  params: ParamSchema[];
  /** SVG renderer; receives transform + params + style */
  render: (props: RenderProps) => React.ReactNode;
}

export interface RenderProps {
  transform: { x: number; y: number; rotation?: number; scale?: number };
  params: Record<string, unknown>;
  style?: Record<string, unknown>;
  selected?: boolean;
}

const registry = new Map<string, PrimitiveDefinition>();

export function registerPrimitive(def: PrimitiveDefinition): void {
  registry.set(def.type, def);
}

export function getPrimitive(type: string): PrimitiveDefinition | undefined {
  return registry.get(type);
}

export function listPrimitives(): PrimitiveDefinition[] {
  return Array.from(registry.values());
}

export function listPrimitivesByCategory(cat: PrimitiveCategory): PrimitiveDefinition[] {
  return listPrimitives().filter((p) => p.category === cat);
}

export function allCategories(): PrimitiveCategory[] {
  return ["mechanics", "fields", "optics", "circuits", "geometry", "annotation"];
}

/**
 * Convenience: get the default params object for a primitive type.
 */
export function defaultParams(type: string): Record<string, unknown> {
  const def = getPrimitive(type);
  if (!def) throw new Error(`Unknown primitive type: ${type}`);
  const out: Record<string, unknown> = {};
  for (const p of def.params) out[p.name] = p.default;
  return out;
}

/**
 * Convenience: get the default transform for a primitive type.
 */
export function defaultTransform(type: string): { x: number; y: number } {
  return { x: 0, y: 0 };
}

/**
 * Convert a params object + transform into the local-space anchor positions
 * the constraint solver uses. For the spike we just expose center; primitives
 * can override by exporting named anchors.
 */
export function localAnchor(type: string, anchor: Anchor, params: Record<string, unknown>): Vec2 {
  const def = getPrimitive(type);
  if (!def) return { x: 0, y: 0 };

  // Primitive-specific anchor geometry. For the spike we hard-code the
  // common cases. Later we'll let each primitive export an anchors() fn.
  switch (type) {
    case "pendulum_bob":
      return { x: 0, y: 0 };
    case "pendulum_pivot":
      return { x: 0, y: 0 };
    case "incline":
      return inclineAnchor(anchor, params);
    case "block":
      return blockAnchor(anchor, params);
    case "vector":
      // vectors use anchor at origin (the vector tail)
      return { x: 0, y: 0 };
    default:
      return { x: 0, y: 0 };
  }
}

function inclineAnchor(anchor: Anchor, params: Record<string, unknown>): Vec2 {
  const length = (params.length as number) ?? 200;
  const angleDeg = (params.angleDeg as number) ?? 30;
  const rad = (angleDeg * Math.PI) / 180;
  // incline extends from (0,0) (bottom-left) to (length, 0) before rotation
  // anchor positions are in pre-rotation local coords
  switch (anchor) {
    case "start":
      return { x: 0, y: 0 };
    case "end":
      return { x: length, y: 0 };
    case "center":
      return { x: length / 2, y: 0 };
    case "top":
      return { x: length, y: 0 }; // top of incline is the high end
    default:
      return { x: 0, y: 0 };
  }
}

function blockAnchor(anchor: Anchor, params: Record<string, unknown>): Vec2 {
  const w = (params.width as number) ?? 60;
  const h = (params.height as number) ?? 40;
  switch (anchor) {
    case "center":
      return { x: 0, y: 0 };
    case "top":
      return { x: 0, y: -h / 2 };
    case "bottom":
      return { x: 0, y: h / 2 };
    case "left":
      return { x: -w / 2, y: 0 };
    case "right":
      return { x: w / 2, y: 0 };
    default:
      return { x: 0, y: 0 };
  }
}