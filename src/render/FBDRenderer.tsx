/**
 * FBD renderer — turns a `ForceGroup` into SVG. The output is a layer
 * that overlays the scene with the free-body diagram of the selected
 * object. The user can toggle individual forces in the Inspector.
 *
 * The renderer is a pure function: `renderFBD(group, view)` returns
 * the JSX for the FBD layer. It is called from SceneRenderer with
 * the currently-selected object's force group.
 */

import { useMemo, type ReactNode } from "react";
import type { Force, ForceGroup } from "../core/forces";

interface FBDRendererProps {
  group: ForceGroup | null;
  /** Visual scale of force arrows (default 1.0). */
  scale?: number;
}

/** Compute the arrow endpoint given an origin, magnitude, and angle (deg). */
function arrowEndpoint(origin: { x: number; y: number }, magnitude: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: origin.x + magnitude * Math.cos(rad),
    y: origin.y - magnitude * Math.sin(rad), // -sin for vector convention
  };
}

/** The SVG path for the arrow head (small triangle). */
function arrowHead(end: { x: number; y: number }, angleDeg: number, color: string) {
  const size = 8;
  const rad = (angleDeg * Math.PI) / 180;
  // Three points of the triangle: tip is at `end`, the two back points
  // are at angle ± 150° from the arrow direction.
  const back1 = {
    x: end.x - size * Math.cos(rad - Math.PI / 6),
    y: end.y + size * Math.sin(rad - Math.PI / 6),
  };
  const back2 = {
    x: end.x - size * Math.cos(rad + Math.PI / 6),
    y: end.y + size * Math.sin(rad + Math.PI / 6),
  };
  return (
    <polygon
      points={`${end.x},${end.y} ${back1.x},${back1.y} ${back2.x},${back2.y}`}
      fill={color}
      stroke={color}
      strokeWidth={1}
    />
  );
}

export function FBDRenderer({ group, scale = 1.0 }: FBDRendererProps) {
  // Memoize the FBD computation per group. The group is recomputed by
  // the parent when the scene or selected object changes, so we don't
  // need to subscribe to anything here.
  const elements = useMemo<ReactNode>(() => {
    if (!group) return null;
    const out: ReactNode[] = [];
    for (let i = 0; i < group.forces.length; i++) {
      const f = group.forces[i];
      if (!f.enabled || !f.present) continue;
      const end = arrowEndpoint(f.origin, f.magnitude * scale, f.directionDeg);
      out.push(
        <g key={`fbd-${group.objectId}-${f.type}`} className="fbd-force">
          {/* the line */}
          <line
            x1={f.origin.x}
            y1={f.origin.y}
            x2={end.x}
            y2={end.y}
            stroke={f.color}
            strokeWidth={2}
            strokeLinecap="round"
          />
          {/* the arrow head */}
          {arrowHead(end, f.directionDeg, f.color)}
          {/* the label, offset slightly to the side of the arrow */}
          <text
            x={end.x + 10}
            y={end.y - 5}
            fontSize={13}
            fontFamily="serif"
            fontStyle="italic"
            fontWeight="bold"
            fill={f.color}
          >
            {f.label}
          </text>
        </g>
      );
    }
    return out;
  }, [group, scale]);

  if (!group) return null;
  return <g className="fbd-layer">{elements}</g>;
}
