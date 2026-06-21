/**
 * The pendulum primitive family: pivot + rope + bob.
 *
 * A "pendulum" in the spike is three separate objects:
 *   - pendulum_pivot : a fixed point (ceiling mount, drawn as a hatched bar)
 *   - rope           : a line from pivot to bob (drawn as a vector-like line)
 *   - pendulum_bob   : the mass at the end (drawn as a circle)
 *
 * The bob is attached to the pivot via a rope-length relation. The pendulum
 * "swing angle" lives in the bob's params. The solver keeps the bob at the
 * right world position when the angle changes.
 *
 * We expose them as 3 primitives rather than 1 composite so the user can
 * drag just the bob, or just the pivot, or replace the rope with a spring.
 */

import { registerPrimitive } from "../core/registry";
import type { PrimitiveDefinition } from "../core/registry";
import { findNonOverlappingPosition } from "../core/layout";

const pivot: PrimitiveDefinition = {
  type: "pendulum_pivot",
  category: "mechanics",
  label: "Pivot (ceiling mount)",
  description: "A fixed point where a rope, pendulum, or spring can attach.",
  anchors: ["center", "bottom"],
  params: [
    { name: "barWidth", type: "number", default: 60, min: 10, max: 200, unit: "px", description: "Width of the hatched bar" },
    { name: "hatchSpacing", type: "number", default: 8, min: 4, max: 20, unit: "px", description: "Hatch line spacing" },
  ],
  render: ({ transform, params, style: rawStyle }) => {
    const style = (rawStyle ?? {}) as { stroke?: string; strokeWidth?: number; fill?: string; rotation?: number };

    const w = (params.barWidth as number) ?? 60;
    const hatch = (params.hatchSpacing as number) ?? 8;
    const stroke = style?.stroke ?? "#333";
    const sw = style?.strokeWidth ?? 1.5;
    // Hatched bar at the top
    const lines: React.ReactNode[] = [];
    for (let i = 0; i <= w; i += hatch) {
      lines.push(
        <line
          key={i}
          x1={transform.x - w / 2 + i}
          y1={transform.y}
          x2={transform.x - w / 2 + i - 8}
          y2={transform.y + 8}
          stroke={stroke}
          strokeWidth={sw * 0.7}
        />
      );
    }
    return (
      <g>
        <rect
          x={transform.x - w / 2}
          y={transform.y}
          width={w}
          height={4}
          fill={stroke}
        />
        {lines}
      </g>
    );
  },
};

const bob: PrimitiveDefinition = {
  type: "pendulum_bob",
  category: "mechanics",
  label: "Pendulum bob (mass)",
  description: "A point mass hanging from a rope. Adjust angleDeg to swing.",
  anchors: ["center", "top"],
  params: [
    { name: "radius", type: "number", default: 18, min: 4, max: 60, unit: "px" },
    { name: "angleDeg", type: "number", default: 30, min: -90, max: 90, step: 1, unit: "°" },
    { name: "ropeLength", type: "number", default: 180, min: 30, max: 400, unit: "px" },
    { name: "mass", type: "number", default: 1, min: 0.01, max: 1000, step: 0.1, unit: "kg" },
    { name: "fill", type: "color", default: "#fff" },
  ],
  render: ({ transform, params, style: rawStyle }) => {
    const style = (rawStyle ?? {}) as { stroke?: string; strokeWidth?: number; fill?: string; rotation?: number };

    const r = (params.radius as number) ?? 18;
    const fill = (params.fill as string) ?? "#fff";
    const stroke = style?.stroke ?? "#222";
    const sw = style?.strokeWidth ?? 1.5;
    return (
      <g>
        <circle cx={transform.x} cy={transform.y} r={r} fill={fill} stroke={stroke} strokeWidth={sw} />
        <text
          x={transform.x}
          y={transform.y + r + 14}
          textAnchor="middle"
          fontSize={11}
          fill="#444"
          fontFamily="serif"
          fontStyle="italic"
        >
          m
        </text>
      </g>
    );
  },
};

const rope: PrimitiveDefinition = {
  type: "rope",
  category: "mechanics",
  label: "Rope / string",
  description: "A massless inextensible rope between two points.",
  anchors: ["start", "end"],
  params: [
    { name: "from", type: "string", default: "" },
    { name: "to", type: "string", default: "" },
    { name: "color", type: "color", default: "#444" },
    { name: "thickness", type: "number", default: 1.5, min: 0.5, max: 5, step: 0.1, unit: "px" },
  ],
  // rope needs access to other objects to find endpoints, so render is
  // handled specially in SceneRenderer. We provide a stub here.
  render: () => null,
};

const incline: PrimitiveDefinition = {
  type: "incline",
  category: "mechanics",
  label: "Inclined surface",
  description: "An angled line, hatched on the underside. Blocks and spheres can rest on it.",
  anchors: ["start", "end", "top", "center"],
  params: [
    { name: "length", type: "number", default: 220, min: 40, max: 600, unit: "px" },
    { name: "angleDeg", type: "number", default: 25, min: -89, max: 89, step: 1, unit: "°" },
    { name: "thickness", type: "number", default: 4, min: 1, max: 12, unit: "px" },
    { name: "hatching", type: "boolean", default: true },
  ],
  render: ({ transform, params, style: rawStyle }) => {
    const style = (rawStyle ?? {}) as { stroke?: string; strokeWidth?: number; fill?: string; rotation?: number };

    const length = (params.length as number) ?? 220;
    const angleDeg = (params.angleDeg as number) ?? 25;
    const thickness = (params.thickness as number) ?? 4;
    const hatching = (params.hatching as boolean) ?? true;
    const stroke = style?.stroke ?? "#222";
    const sw = style?.strokeWidth ?? thickness;

    const rad = (angleDeg * Math.PI) / 180;
    const x2 = transform.x + length * Math.cos(rad);
    const y2 = transform.y - length * Math.sin(rad); // screen y inverted

    const hatchLines: React.ReactNode[] = [];
    if (hatching) {
      const spacing = 12;
      for (let i = 0; i <= length; i += spacing) {
        const sx = transform.x + i * Math.cos(rad);
        const sy = transform.y - i * Math.sin(rad);
        // hatch line goes perpendicular-downward from the surface
        const px = sx - 10 * Math.sin(rad);
        const py = sy - 10 * Math.cos(rad);
        hatchLines.push(
          <line
            key={i}
            x1={sx}
            y1={sy}
            x2={px}
            y2={py}
            stroke={stroke}
            strokeWidth={sw * 0.5}
            opacity={0.5}
          />
        );
      }
    }

    return (
      <g>
        {hatchLines}
        <line x1={transform.x} y1={transform.y} x2={x2} y2={y2} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      </g>
    );
  },
};

const block: PrimitiveDefinition = {
  type: "block",
  category: "mechanics",
  label: "Block",
  description: "A rectangle (drawn block). Common in inclined-plane problems.",
  anchors: ["center", "top", "bottom", "left", "right"],
  params: [
    { name: "width", type: "number", default: 60, min: 8, max: 200, unit: "px" },
    { name: "height", type: "number", default: 40, min: 8, max: 200, unit: "px" },
    { name: "fill", type: "color", default: "#fff" },
    { name: "mass", type: "number", default: 2, min: 0.01, max: 1000, step: 0.1, unit: "kg" },
  ],
  render: ({ transform, params, style: rawStyle, derived }) => {
    const style = (rawStyle ?? {}) as { stroke?: string; strokeWidth?: number; fill?: string; rotation?: number };

    const w = (params.width as number) ?? 60;
    const h = (params.height as number) ?? 40;
    const fill = (params.fill as string) ?? "#fff";
    const stroke = style?.stroke ?? "#222";
    const sw = style?.strokeWidth ?? 1.5;
    // Rotation: prefer the derived value (e.g. block-on-incline mirrors the
    // incline's angle), then transform.rotation, then style.rotation as a
    // last-resort fallback. This is the "smart primitive" pattern: the
    // derivation system owns the value when there's a rule; the user can
    // still set it manually otherwise.
    const rot = (derived?.["transform.rotation"] as number | undefined)
      ?? transform.rotation
      ?? style?.rotation
      ?? 0;
    return (
      <g transform={`rotate(${rot} ${transform.x} ${transform.y})`}>
        <rect
          x={transform.x - w / 2}
          y={transform.y - h / 2}
          width={w}
          height={h}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          rx={2}
        />
      </g>
    );
  },
};

const ground: PrimitiveDefinition = {
  type: "ground",
  category: "mechanics",
  label: "Ground",
  description: "A horizontal hatched surface. Blocks rest on it.",
  anchors: ["start", "end", "center", "top"],
  params: [
    { name: "extent", type: "number", default: 600, min: 50, max: 2000, unit: "px" },
    { name: "thickness", type: "number", default: 2, min: 1, max: 8, unit: "px" },
  ],
  render: ({ transform, params, style: rawStyle }) => {
    const style = (rawStyle ?? {}) as { stroke?: string; strokeWidth?: number; fill?: string; rotation?: number };

    const extent = (params.extent as number) ?? 600;
    const sw = style?.strokeWidth ?? 2;
    const stroke = style?.stroke ?? "#333";
    const hatchLines: React.ReactNode[] = [];
    for (let i = 0; i <= extent; i += 12) {
      hatchLines.push(
        <line
          key={i}
          x1={transform.x - extent / 2 + i}
          y1={transform.y}
          x2={transform.x - extent / 2 + i - 6}
          y2={transform.y + 6}
          stroke={stroke}
          strokeWidth={sw * 0.8}
        />
      );
    }
    return (
      <g>
        {hatchLines}
        <line
          x1={transform.x - extent / 2}
          y1={transform.y}
          x2={transform.x + extent / 2}
          y2={transform.y}
          stroke={stroke}
          strokeWidth={sw}
        />
      </g>
    );
  },
};

const vector: PrimitiveDefinition = {
  type: "vector",
  category: "annotation",
  label: "Vector (force / velocity)",
  description: "An arrow with optional magnitude and label. Use for forces, velocities, etc.",
  anchors: ["center", "start", "end"],
  params: [
    { name: "magnitude", type: "number", default: 80, min: 5, max: 400, unit: "px" },
    { name: "angleDeg", type: "number", default: 0, min: -360, max: 360, step: 1, unit: "°" },
    { name: "color", type: "color", default: "#c0392b" },
    { name: "thickness", type: "number", default: 2, min: 0.5, max: 8, step: 0.1, unit: "px" },
    { name: "dashed", type: "boolean", default: false },
    { name: "label", type: "string", default: "F" },
  ],
  render: ({ transform, params, scene, objId, derived }) => {
      // Angle: prefer the derived value (e.g. T vector auto-aims at the
      // pivot; N vector is perpendicular to the incline; mg is always
      // straight down). Falls back to the user-editable params.angleDeg.
      const mag = (params.magnitude as number) ?? 80;
      const angleDeg = (derived?.["params.angleDeg"] as number | undefined)
        ?? (params.angleDeg as number) ?? 0;
      const color = (params.color as string) ?? "#c0392b";
      const thickness = (params.thickness as number) ?? 2;
      const dashed = (params.dashed as boolean) ?? false;
      const label = (params.label as string) ?? "F";
      const rad = (angleDeg * Math.PI) / 180;
      const x2 = transform.x + mag * Math.cos(rad);
      const y2 = transform.y - mag * Math.sin(rad);

      // Arrowhead
      const headLen = 12;
      const headAngle = Math.PI / 6;
      const ax1 = x2 - headLen * Math.cos(rad - headAngle);
      const ay1 = y2 + headLen * Math.sin(rad - headAngle);
      const ax2 = x2 - headLen * Math.cos(rad + headAngle);
      const ay2 = y2 + headLen * Math.sin(rad + headAngle);

      // Label position: just past the arrowhead, nudged to avoid overlapping
      // other objects in the scene.
      const labelOffset = 16;
      const natural = {
        x: x2 + labelOffset * Math.cos(rad),
        y: y2 - labelOffset * Math.sin(rad),
      };
      const finalLabel = scene && objId
        ? findNonOverlappingPosition(natural, objId, scene.objects)
        : natural;
      const lx = finalLabel.x;
      const ly = finalLabel.y;

    return (
      <g>
        <line
          x1={transform.x}
          y1={transform.y}
          x2={x2}
          y2={y2}
          stroke={color}
          strokeWidth={thickness}
          strokeDasharray={dashed ? "6,4" : undefined}
          strokeLinecap="round"
        />
        <polygon
          points={`${x2},${y2} ${ax1},${ay1} ${ax2},${ay2}`}
          fill={color}
          stroke={color}
          strokeWidth={thickness}
          strokeLinejoin="round"
        />
        <text
          x={lx}
          y={ly}
          textAnchor={Math.abs(Math.cos(rad)) > 0.3 ? (Math.cos(rad) > 0 ? "start" : "end") : "middle"}
          dominantBaseline={Math.abs(Math.sin(rad)) > 0.3 ? (Math.sin(rad) > 0 ? "auto" : "hanging") : "middle"}
          fontSize={14}
          fill={color}
          fontFamily="serif"
          fontStyle="italic"
          fontWeight="bold"
        >
          {label}
        </text>
      </g>
    );
  },
};

const axes: PrimitiveDefinition = {
  type: "axes",
  category: "geometry",
  label: "Coordinate axes",
  description: "X/Y axes with optional labels.",
  anchors: ["center"],
  params: [
    { name: "size", type: "number", default: 160, min: 20, max: 600, unit: "px" },
    { name: "showLabels", type: "boolean", default: true },
  ],
  render: ({ transform, params }) => {
    const size = (params.size as number) ?? 160;
    const showLabels = (params.showLabels as boolean) ?? true;
    return (
      <g>
        <line x1={transform.x - size / 2} y1={transform.y} x2={transform.x + size / 2} y2={transform.y} stroke="#333" strokeWidth={1} markerEnd="url(#arrow)" />
        <line x1={transform.x} y1={transform.y + size / 2} x2={transform.x} y2={transform.y - size / 2} stroke="#333" strokeWidth={1} markerEnd="url(#arrow)" />
        {showLabels && (
          <>
            <text x={transform.x + size / 2 + 6} y={transform.y + 4} fontSize={12} fontStyle="italic" fill="#333">x</text>
            <text x={transform.x - 4} y={transform.y - size / 2 - 4} fontSize={12} fontStyle="italic" fill="#333">y</text>
          </>
        )}
      </g>
    );
  },
};

const angleMarker: PrimitiveDefinition = {
  type: "angle_marker",
  category: "annotation",
  label: "Angle marker",
  description: "An arc with a label between two directions.",
  anchors: ["center"],
  params: [
    { name: "vertexX", type: "number", default: 0 },
    { name: "vertexY", type: "number", default: 0 },
    { name: "fromAngleDeg", type: "number", default: 0, unit: "°" },
    { name: "toAngleDeg", type: "number", default: 30, unit: "°" },
    { name: "radius", type: "number", default: 30, min: 8, max: 100, unit: "px" },
    { name: "label", type: "string", default: "θ" },
    { name: "color", type: "color", default: "#1f6feb" },
  ],
  render: ({ transform, params, derived }) => {
    const r = (params.radius as number) ?? 30;
    // Prefer derived values (the derivation engine can override these
    // when this arc belongs to a composite — e.g. an incline composite
    // pins the arc's vertex to the lower-left corner of the incline).
    // Falls back to the user-editable params otherwise.
    const fromAngleDeg = (derived?.["params.fromAngleDeg"] as number | undefined)
      ?? (params.fromAngleDeg as number) ?? 0;
    const toAngleDeg = (derived?.["params.toAngleDeg"] as number | undefined)
      ?? (params.toAngleDeg as number) ?? 30;
    // Vertex: prefer derived (mirrors pivot position), then params, then
    // transform.
    const vx = (derived?.["params.vertexX"] as number | undefined)
      ?? (params.vertexX as number) ?? transform.x;
    const vy = (derived?.["params.vertexY"] as number | undefined)
      ?? (params.vertexY as number) ?? transform.y;
    const color = (params.color as string) ?? "#1f6feb";
    const label = (params.label as string) ?? "θ";
    // SCREEN convention: 0° = straight down, 90° = right, 180° = up,
    // 270° = left. This matches the convention used by the rope
    // (`pendulum_from`) and the incline (`angleDeg`).
    // For screen convention: end.x = vx + r*sin(rad), end.y = vy + r*cos(rad).
    const fromRad = (fromAngleDeg * Math.PI) / 180;
    const toRad = (toAngleDeg * Math.PI) / 180;
    const x1 = vx + r * Math.sin(fromRad);
    const y1 = vy + r * Math.cos(fromRad);
    const x2 = vx + r * Math.sin(toRad);
    const y2 = vy + r * Math.cos(toRad);
    const largeArc = Math.abs((toRad - fromRad)) > Math.PI ? 1 : 0;
    // The label is placed at the midpoint of the arc, slightly outside.
    const midRad = (fromRad + toRad) / 2;
    const lx = vx + (r + 12) * Math.sin(midRad);
    const ly = vy + (r + 12) * Math.cos(midRad);
    return (
      <g>
        <path
          d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 0 ${x2} ${y2}`}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
        />
        <text
          x={lx}
          y={ly}
          textAnchor="middle"
          fontSize={13}
          fontFamily="serif"
          fontStyle="italic"
          fontWeight="bold"
          fill={color}
        >
          {label}
        </text>
      </g>
    );
  },
};

const textLabel: PrimitiveDefinition = {
  type: "text_label",
  category: "annotation",
  label: "Text label",
  description: "Plain text. For LaTeX math use the Math label instead.",
  anchors: ["center"],
  params: [
    { name: "text", type: "string", default: "label" },
    { name: "fontSize", type: "number", default: 14, min: 8, max: 48 },
    { name: "color", type: "color", default: "#222" },
  ],
  render: ({ transform, params }) => {
    const text = (params.text as string) ?? "label";
    const fs = (params.fontSize as number) ?? 14;
    const color = (params.color as string) ?? "#222";
    return (
      <text x={transform.x} y={transform.y} fontSize={fs} fill={color} fontFamily="serif" textAnchor="middle">
        {text}
      </text>
    );
  },
};

/**
 * Composite: Pendulum
 *
 * Drop a "Pendulum" into the canvas and you get a fully-wired diagram:
 *   - pivot (ceiling mount)
 *   - rope from pivot to bob
 *   - bob hanging at angleDeg from pivot at distance ropeLength
 *   - angle-arc decoration labeled θ
 *   - tension vector T along the rope toward the pivot
 *   - weight vector mg pointing straight down
 *
 * All decorations are individual scene objects with `compositeRole` so the
 * Inspector can show visibility toggles per role. Default roles that ship
 * visible: rope, bob, theta, tension, weight. The pivot is the anchor and
 * is always visible.
 */
const pendulumComposite: PrimitiveDefinition = {
  type: "pendulum",
  category: "mechanics",
  label: "Pendulum (auto-decorated)",
  description: "Pivot + rope + bob, with auto-rendered θ angle arc, tension T, and weight mg.",
  anchors: ["center"],
  params: [],
  defaultDecorations: ["rope", "bob", "theta", "tension", "weight"],
  composite: {
    anchorType: "pendulum_pivot",
    build: (anchorPos) => {
      const ROPE_LENGTH = 180;
      const ANGLE_DEG = 30;
      return [
        // 0: pivot (anchor)
        {
          type: "pendulum_pivot",
          params: { barWidth: 90, hatchSpacing: 8 },
          transform: anchorPos,
          compositeRole: "pivot",
        },
        // 1: bob — placed at the end of the rope via pendulum_from
        {
          type: "pendulum_bob",
          params: { radius: 22, angleDeg: ANGLE_DEG, ropeLength: ROPE_LENGTH, mass: 1, fill: "#fff" },
          transform: { x: 0, y: 0 }, // solved
          relations: [{ kind: "pendulum_from", target: "<anchor>" } as never],
          compositeRole: "bob",
        },
        // 2: rope — drawn between pivot and bob
        {
          type: "rope",
          params: { from: "<anchor>", to: "<bob>", color: "#444", thickness: 1.5 },
          transform: { x: 0, y: 0 },
          compositeRole: "rope",
        },
        // 3: angle-arc θ at the pivot
        {
          type: "angle_marker",
          params: {
            vertexX: 0, vertexY: 0,
            fromAngleDeg: 0, toAngleDeg: ANGLE_DEG,
            radius: 44, label: "θ", color: "#1f6feb",
          },
          transform: anchorPos,
          relations: [{ kind: "origin_at", target: "<anchor>", anchor: "center" } as never],
          compositeRole: "theta",
        },
        // 4: tension T — along the rope from bob toward pivot
        {
          type: "vector",
          params: {
            magnitude: 80,
            angleDeg: 180 - ANGLE_DEG, // up-and-toward-pivot, in screen-y-down coords
            color: "#1f6feb", thickness: 2, label: "T",
          },
          transform: { x: 0, y: 0 },
          relations: [{ kind: "origin_at", target: "<bob>", anchor: "center" } as never],
          compositeRole: "tension",
        },
        // 5: weight mg — straight down from the bob
        {
          type: "vector",
          params: {
            magnitude: 90, angleDeg: -90,
            color: "#c0392b", thickness: 2, label: "mg",
          },
          transform: { x: 0, y: 0 },
          relations: [{ kind: "origin_at", target: "<bob>", anchor: "center" } as never],
          compositeRole: "weight",
        },
      ];
    },
  },
  render: () => null, // composites never render directly; children do
};

/**
 * Composite: Block on Incline
 *   - incline (anchor)
 *   - block resting on the incline at fraction 0.55
 *   - gravity mg vector
 *   - normal N vector (perpendicular to incline surface)
 *   - friction f vector (up the incline)
 *   - angle-arc θ at the incline base
 */
const blockOnInclineComposite: PrimitiveDefinition = {
  type: "block_on_incline",
  category: "mechanics",
  label: "Block on incline (auto-decorated)",
  description: "Incline + block, with gravity mg, normal N, friction f, and angle θ auto-rendered.",
  anchors: ["center"],
  params: [],
  defaultDecorations: ["block", "gravity", "normal", "friction", "theta"],
  composite: {
    anchorType: "incline",
    build: (anchorPos) => {
      const ANGLE = 25;
      const LENGTH = 280;
      return [
        // 0: incline (anchor)
        {
          type: "incline",
          params: { length: LENGTH, angleDeg: ANGLE, thickness: 4, hatching: true },
          transform: anchorPos,
          compositeRole: "incline",
        },
        // 1: block on incline
        {
          type: "block",
          params: { width: 70, height: 45, fill: "#fff", mass: 2 },
          transform: { x: 0, y: 0 },
          relations: [{ kind: "rests_on", target: "<anchor>", fraction: 0.55 } as never],
          compositeRole: "block",
        },
        // 2: gravity mg (straight down, anchored to block)
        {
          type: "vector",
          params: { magnitude: 100, angleDeg: -90, color: "#c0392b", thickness: 2.5, label: "mg" },
          transform: { x: 0, y: 0 },
          relations: [{ kind: "origin_at", target: "<block>", anchor: "center" } as never],
          compositeRole: "gravity",
        },
        // 3: normal N (perpendicular to incline, outward)
        {
          type: "vector",
          params: { magnitude: 90, angleDeg: 90 - ANGLE, color: "#1f6feb", thickness: 2.5, label: "N" },
          transform: { x: 0, y: 0 },
          relations: [{ kind: "origin_at", target: "<block>", anchor: "center" } as never],
          compositeRole: "normal",
        },
        // 4: friction f (up the incline = opposite of motion direction)
        {
          type: "vector",
          params: { magnitude: 42, angleDeg: 180 + ANGLE, color: "#e67e22", thickness: 2.5, label: "f" },
          transform: { x: 0, y: 0 },
          relations: [{ kind: "origin_at", target: "<block>", anchor: "center" } as never],
          compositeRole: "friction",
        },
        // 5: angle-arc θ at the incline base
        {
          type: "angle_marker",
          params: {
            vertexX: 0, vertexY: 0,
            fromAngleDeg: 0, toAngleDeg: ANGLE,
            radius: 50, label: `${ANGLE}°`, color: "#1f6feb",
          },
          transform: anchorPos,
          relations: [{ kind: "origin_at", target: "<anchor>", anchor: "center" } as never],
          compositeRole: "theta",
        },
      ];
    },
  },
  render: () => null,
};

export function registerAllPrimitives(): void {
  registerPrimitive(pivot);
  registerPrimitive(bob);
  registerPrimitive(rope);
  registerPrimitive(incline);
  registerPrimitive(block);
  registerPrimitive(ground);
  registerPrimitive(vector);
  registerPrimitive(axes);
  registerPrimitive(angleMarker);
  registerPrimitive(textLabel);
  // composites
  registerPrimitive(pendulumComposite);
  registerPrimitive(blockOnInclineComposite);
}