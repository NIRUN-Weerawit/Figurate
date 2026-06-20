/**
 * SceneRenderer — turns the JSON scene into SVG.
 *
 * Also handles special primitives (rope needs to look up other objects to find
 * its endpoints; angle markers are placed at a vertex specified in params).
 */

import { useMemo } from "react";
import type { FigurateScene, SceneObject, Vec2 } from "../core/dsl";
import { getPrimitive } from "../core/registry";

interface SceneRendererProps {
  scene: FigurateScene;
  onSelect?: (id: string | null) => void;
  selectedId?: string | null;
  onDrag?: (id: string, worldPos: Vec2) => void;
}

/**
 * Convert a DOM event to SVG world coordinates using the SVG element's
 * screen CTM. Module-scope so the inner RenderObject can use it.
 */
function eventToWorld(e: MouseEvent | React.MouseEvent, svg: SVGSVGElement): Vec2 {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const transformed = pt.matrixTransform(ctm.inverse());
  return { x: transformed.x, y: transformed.y };
}

export function SceneRenderer({ scene, onSelect, selectedId, onDrag }: SceneRendererProps) {
  // Sort by zIndex then by insertion order
  const sorted = useMemo(
    () => [...scene.objects].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)),
    [scene.objects]
  );

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="100%"
      height="100%"
      viewBox={`0 0 ${scene.canvas.width} ${scene.canvas.height}`}
      style={{ background: scene.canvas.background, cursor: "default", userSelect: "none" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onSelect?.(null);
      }}
    >
      <defs>
        <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="#333" />
        </marker>
        <pattern
          id="grid"
          width={scene.canvas.grid?.spacing ?? 20}
          height={scene.canvas.grid?.spacing ?? 20}
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1" cy="1" r="1" fill={scene.canvas.grid?.color ?? "#ddd"} />
        </pattern>
      </defs>

      {scene.canvas.grid?.enabled && (
        <rect x="0" y="0" width={scene.canvas.width} height={scene.canvas.height} fill="url(#grid)" />
      )}

      {sorted.map((obj) => (
        <RenderObject
          key={obj.id}
          obj={obj}
          scene={scene}
          isSelected={selectedId === obj.id}
          onSelect={onSelect}
          onDrag={onDrag}
        />
      ))}
    </svg>
  );
}

function RenderObject({
  obj,
  scene,
  isSelected,
  onSelect,
  onDrag,
}: {
  obj: SceneObject;
  scene: FigurateScene;
  isSelected: boolean;
  onSelect?: (id: string | null) => void;
  onDrag?: (id: string, worldPos: Vec2) => void;
}) {
  const def = getPrimitive(obj.type);
  if (!def) return null;

  // Special case: rope is drawn between two other objects
  if (obj.type === "rope") {
    return <RopeRenderer obj={obj} scene={scene} isSelected={isSelected} onSelect={onSelect} />;
  }

  // Special case: vector respects style.rotation
  const styleWithRotation = {
    ...obj.style,
    rotation: obj.transform.rotation ?? 0,
  };

  const handleMouseDown = (e: React.MouseEvent<SVGGElement>) => {
    e.stopPropagation();
    onSelect?.(obj.id);
    if (!onDrag) return;
    // capture the SVG element now — `e.currentTarget` becomes null after the
    // synchronous handler returns, and we need it inside the global listener.
    const svg = (e.currentTarget as SVGGElement).ownerSVGElement;
    if (!svg) return;
    const startPt = eventToWorld(e, svg);
    const startTransform = { ...obj.transform };
    function onMove(ev: MouseEvent) {
      const w = eventToWorld(ev, svg!);
      onDrag!(obj.id, {
        x: startTransform.x + (w.x - startPt.x),
        y: startTransform.y + (w.y - startPt.y),
      });
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <g
      onMouseDown={handleMouseDown}
      style={{ cursor: onDrag ? "grab" : "pointer" }}
    >
      {def.render({
        transform: obj.transform,
        params: obj.params,
        style: styleWithRotation,
        selected: isSelected,
      })}
      {isSelected && (
        <circle
          cx={obj.transform.x}
          cy={obj.transform.y}
          r={6}
          fill="none"
          stroke="#1f6feb"
          strokeWidth={1.5}
          strokeDasharray="3,3"
        />
      )}
    </g>
  );
}

function RopeRenderer({
  obj,
  scene,
  isSelected,
  onSelect,
}: {
  obj: SceneObject;
  scene: FigurateScene;
  isSelected: boolean;
  onSelect?: (id: string | null) => void;
}) {
  const fromId = obj.params.from as string;
  const toId = obj.params.to as string;
  const color = (obj.params.color as string) ?? "#444";
  const thickness = (obj.params.thickness as number) ?? 1.5;

  const fromObj = scene.objects.find((o) => o.id === fromId);
  const toObj = scene.objects.find((o) => o.id === toId);

  if (!fromObj || !toObj) return null;

  return (
    <g onMouseDown={(e) => { e.stopPropagation(); onSelect?.(obj.id); }} style={{ cursor: "pointer" }}>
      <line
        x1={fromObj.transform.x}
        y1={fromObj.transform.y}
        x2={toObj.transform.x}
        y2={toObj.transform.y}
        stroke={color}
        strokeWidth={thickness}
        strokeLinecap="round"
      />
      {isSelected && (
        <circle cx={fromObj.transform.x} cy={fromObj.transform.y} r={5} fill="none" stroke="#1f6feb" strokeWidth={1.5} />
      )}
    </g>
  );
}