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
  groups: ForceGroup[];
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

export function FBDRenderer({ groups, scale = 1.0 }: FBDRendererProps) {
  // Memoize the FBD computation per groups list. The list is recomputed
  // by the parent when the scene or selected object changes, so we
  // don't need to subscribe to anything here.
  const elements = useMemo<ReactNode>(() => {
    if (groups.length === 0) return null;
    const out: ReactNode[] = [];
    for (const group of groups) {
      // Count how many forces are visible. We'll offset each force's
      // origin by a small amount perpendicular to its direction, so
      // multiple forces emanating from the same point don't overlap
      // on top of each other. The offset is small (1-2px) so it
      // doesn't visually shift the arrows much.
      const visibleForces = group.forces.filter((f) => f.enabled && f.present);
      const totalForces = visibleForces.length;
      for (let i = 0; i < group.forces.length; i++) {
        const f = group.forces[i];
        if (!f.enabled || !f.present) continue;
        // Compute the visible-rank of this force (0..totalForces-1).
        const visibleRank = visibleForces.indexOf(f);
        // Offset perpendicular to the force direction, in screen units.
        // 1.5px per force, centered around the middle.
        const perpRad = ((f.directionDeg - 90) * Math.PI) / 180;
        const offsetPx = (visibleRank - (totalForces - 1) / 2) * 1.5;
        const origin = {
          x: f.origin.x + offsetPx * Math.cos(perpRad),
          y: f.origin.y - offsetPx * Math.sin(perpRad),
        };
        const end = arrowEndpoint(origin, f.magnitude * scale, f.directionDeg);
        out.push(
          <g key={`fbd-${group.objectId}-${f.type}`} className="fbd-force">
            <line
              x1={origin.x}
              y1={origin.y}
              x2={end.x}
              y2={end.y}
              stroke={f.color}
              strokeWidth={2}
              strokeLinecap="round"
            />
            {arrowHead(end, f.directionDeg, f.color)}
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
    }
    return out;
  }, [groups, scale]);

  if (groups.length === 0) return null;
  return <g className="fbd-layer">{elements}</g>;
}
