/**
 * SceneRenderer — turns the JSON scene into SVG.
 *
 * Also handles special primitives (rope needs to look up other objects to find
 * its endpoints; angle markers are placed at a vertex specified in params).
 *
 * Interaction model (Figma-style):
 *   - click an object          : select it (clears other selection)
 *   - shift+click              : toggle it in the selection
 *   - click empty canvas       : start a rubber-band marquee; on release,
 *                                every object inside the rect is selected
 *   - click empty canvas (no drag) : deselect all
 *   - drag an object           : move it (or all selected, if >1)
 *   - Alt+drag                 : constraint-aware — solver re-derives everything
 *                                from the dragged object's new position. This is
 *                                how you tilt a pendulum: Alt-drag the bob and
 *                                only its angle changes; the rope, vectors, and
 *                                θ-arc all follow.
 */

import { useMemo, useState } from "react";
import type { FigurateScene, SceneObject, Vec2 } from "../core/dsl";
import { getPrimitive } from "../core/registry";
import type { DerivedCache } from "../core/derivation";
import { findSnapTarget, type SnapCandidate } from "../core/snap";
import { ensureDefaultAttachPoints } from "../core/snap";
import { FBDRenderer } from "./FBDRenderer";

// Make sure each primitive has at least default attach points registered.
// Idempotent — safe to call at module load.
ensureDefaultAttachPoints();

interface SceneRendererProps {
  scene: FigurateScene;
  /** Derived values keyed by `${objectId}::${field}`. The renderer passes
   *  per-object slices to each primitive's `render` function. */
  derived: DerivedCache;
  selectedId: string | null;
  selectedIds: string[];
  onSelect: (id: string | null) => void;
  onToggleSelect: (id: string) => void;
  onSelectInRect: (rect: { x: number; y: number; w: number; h: number }) => void;
  onSetTransform: (id: string, transform: Partial<{ x: number; y: number }>) => void;
  onNudge: (ids: string[], dx: number, dy: number) => void;
  onCommitDrag: () => void;
  /** Apply a snap target on mouseup. Creates the relation and finalizes
   *  the drag. Re-runs inference so the smart decorations activate. */
  onApplySnap: (candidate: SnapCandidate) => void;
  /** The free-body diagrams for the scene. The renderer overlays these
   *  on top of the regular objects. The list is built in App.tsx from
   *  the per-object FBD state and the global FBD force toggles. */
  fbdGroups: import("../core/forces").ForceGroup[];
  /** Viewport for zoom/pan. Applied as a transform on the inner <g>. */
  viewport: { x: number; y: number; zoom: number };
  onSetViewport: (vp: Partial<{ x: number; y: number; zoom: number }>) => void;
  onResetViewport: () => void;
  /** Spawn a primitive at the given world position. Used by drag-to-spawn. */
  onSpawn: (type: string, position: { x: number; y: number }) => void;
}

export function SceneRenderer({
  scene,
  derived,
  selectedId,
  selectedIds,
  onSelect,
  onToggleSelect,
  onSelectInRect,
  onSetTransform,
  onNudge,
  onCommitDrag,
  onApplySnap,
  fbdGroups,
  viewport,
  onSetViewport,
  onResetViewport,
  onSpawn,
}: SceneRendererProps) {
  // Sort by zIndex then by insertion order
  const sorted = useMemo(
    () => [...scene.objects].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)),
    [scene.objects]
  );
  const visibleObjects = useMemo(
    () => sorted.filter((o) => o.visible !== false),
    [sorted]
  );

  // Marquee select state
  const [marquee, setMarquee] = useState<null | {
    x0: number; y0: number; x1: number; y1: number;
  }>(null);

  function onCanvasMouseDown(e: React.MouseEvent<SVGRectElement>) {
    // The handler is bound to the grid rect, so we only fire when the user
    // clicks the canvas (not an object above it). The grid rect covers the
    // entire SVG, and objects are drawn on top with `stopPropagation` in
    // their own handlers — so we only get here for genuine empty-canvas clicks.
    e.stopPropagation();
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const pt = eventToWorld(e, svg);
    const start = { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
    setMarquee(start);
    function onMove(ev: MouseEvent) {
      const w = eventToWorld(ev, svg!);
      setMarquee((m) => (m ? { ...m, x1: w.x, y1: w.y } : null));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setMarquee((m) => {
        if (!m) return null;
        const x = Math.min(m.x0, m.x1);
        const y = Math.min(m.y0, m.y1);
        const w = Math.abs(m.x1 - m.x0);
        const h = Math.abs(m.y1 - m.y0);
        if (w < 3 && h < 3) {
          // Treated as a click on empty canvas — deselect.
          onSelect(null);
        } else {
          onSelectInRect({ x, y, w, h });
        }
        return null;
      });
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="100%"
      height="100%"
      viewBox={`0 0 ${scene.canvas.width} ${scene.canvas.height}`}
      style={{ background: scene.canvas.background, cursor: "default", userSelect: "none" }}
      onWheel={(e) => {
        // Zoom: plain wheel (no modifier). Shift+wheel = horizontal pan,
        // plain wheel = zoom. We avoid Ctrl+wheel because Chrome
        // intercepts it as "browser zoom" and resizes the whole page
        // rather than letting our handler run.
        e.preventDefault();
        const svg = e.currentTarget;
        const ctm = svg.getScreenCTM();
        if (!ctm) return;
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const worldPt = pt.matrixTransform(ctm.inverse());
        if (e.shiftKey) {
          // Shift+wheel: horizontal pan (right = +x).
          const dx = e.deltaY || e.deltaX;
          onSetViewport({ x: viewport.x - dx * 0.5, y: viewport.y });
        } else {
          // Plain wheel: zoom (1.1 per notch).
          const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
          const oldZoom = viewport.zoom;
          const newZoom = Math.max(0.1, Math.min(8, oldZoom * factor));
          // Adjust pan so the cursor stays anchored in world space.
          const newX = worldPt.x - (worldPt.x - viewport.x) * (newZoom / oldZoom);
          const newY = worldPt.y - (worldPt.y - viewport.y) * (newZoom / oldZoom);
          onSetViewport({ x: newX, y: newY, zoom: newZoom });
        }
      }}
      onMouseDown={(e) => {
        // Pan: middle-mouse or space+left-click.
        if (e.button === 1 || (e.button === 0 && e.altKey)) {
          e.preventDefault();
          const startX = e.clientX;
          const startY = e.clientY;
          const startVpX = viewport.x;
          const startVpY = viewport.y;
          // Convert screen delta to world delta.
          const ctm = (e.currentTarget as SVGSVGElement).getScreenCTM();
          const scale = ctm ? ctm.a : 1; // x-scale (inverse of zoom)
          const onMove = (ev: MouseEvent) => {
            const dxScreen = ev.clientX - startX;
            const dyScreen = ev.clientY - startY;
            onSetViewport({
              x: startVpX - dxScreen / scale,
              y: startVpY - dyScreen / scale,
            });
          };
          const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        }
      }}
      onDragOver={(e) => {
        // Allow drop from library.
        if (e.dataTransfer.types.includes("application/x-figurate-type")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(e) => {
        const type = e.dataTransfer.getData("application/x-figurate-type");
        if (!type) return;
        e.preventDefault();
        const svg = e.currentTarget;
        const ctm = svg.getScreenCTM();
        if (!ctm) return;
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const worldPt = pt.matrixTransform(ctm.inverse());
        onSpawn(type, { x: worldPt.x, y: worldPt.y });
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
          <path d={`M ${scene.canvas.grid?.spacing ?? 20} 0 L 0 0 0 ${scene.canvas.grid?.spacing ?? 20}`} fill="none" stroke={scene.canvas.grid?.color ?? "#e8e8e8"} strokeWidth={0.5} />
        </pattern>
      </defs>
      {/* Grid stays fixed in screen space so the user always has a
          visual reference for the canvas size, regardless of zoom/pan. */}
      <rect
        width={scene.canvas.width}
        height={scene.canvas.height}
        fill="url(#grid)"
        pointerEvents="all"
        onMouseDown={onCanvasMouseDown}
      />
      {/* Everything in this <g> is transformed by the viewport. The
          world coordinates of every object are interpreted in the
          post-transform space. */}
      <g transform={`translate(${viewport.x},${viewport.y}) scale(${viewport.zoom})`}>
        {visibleObjects.map((obj) => (
        <RenderObject
          key={obj.id}
          obj={obj}
          scene={scene}
          derived={derived}
          isSelected={selectedId === obj.id || selectedIds.includes(obj.id)}
          onSelect={onSelect}
          onToggleSelect={onToggleSelect}
          selectedIds={selectedIds}
          onSetTransform={onSetTransform}
          onNudge={onNudge}
          onCommitDrag={onCommitDrag}
          onApplySnap={onApplySnap}
        />
      ))}
      {marquee && (
        <rect
          x={Math.min(marquee.x0, marquee.x1)}
          y={Math.min(marquee.y0, marquee.y1)}
          width={Math.abs(marquee.x1 - marquee.x0)}
          height={Math.abs(marquee.y1 - marquee.y0)}
          fill="#1f6feb"
          fillOpacity={0.07}
          stroke="#1f6feb"
          strokeWidth={1}
          strokeDasharray="4,3"
          pointerEvents="none"
        />
      )}
      {/* FBD overlay — renders on top of objects but below the selection
          circles. Each force is an arrow with a label. The user toggles
          which forces to show in the Inspector or via the global force
          toggles in the toolbar. */}
        <FBDRenderer groups={fbdGroups} />
      </g>
      {/* Viewport HUD — fixed in screen space, shows zoom + reset button.
          Stays readable regardless of pan/zoom. */}
      <g style={{ pointerEvents: "all" }}>
        <rect
          x={scene.canvas.width - 130}
          y={scene.canvas.height - 36}
          width={120}
          height={26}
          rx={4}
          fill="var(--panel)"
          stroke="var(--panel-border)"
          strokeWidth={1}
        />
        <text
          x={scene.canvas.width - 120}
          y={scene.canvas.height - 19}
          fontSize={11}
          fill="var(--text-dim)"
          fontFamily="monospace"
        >
          {(viewport.zoom * 100).toFixed(0)}%
        </text>
        <text
          x={scene.canvas.width - 24}
          y={scene.canvas.height - 19}
          fontSize={11}
          fill="var(--text)"
          fontFamily="monospace"
          style={{ cursor: "pointer" }}
          onClick={onResetViewport}
        >
          reset
        </text>
      </g>
    </svg>
  );
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

function RenderObject({
  obj,
  scene,
  derived,
  isSelected,
  onSelect,
  onToggleSelect,
  selectedIds,
  onSetTransform,
  onNudge,
  onCommitDrag,
  onApplySnap,
}: {
  obj: SceneObject;
  scene: FigurateScene;
  derived: DerivedCache;
  isSelected: boolean;
  onSelect: (id: string | null) => void;
  onToggleSelect: (id: string) => void;
  selectedIds: string[];
  onSetTransform: (id: string, transform: Partial<{ x: number; y: number }>) => void;
  onNudge: (ids: string[], dx: number, dy: number) => void;
  onCommitDrag: () => void;
  onApplySnap: (candidate: SnapCandidate) => void;
}) {
  const def = getPrimitive(obj.type);
  if (!def) return null;

  // Special case: rope is drawn between two other objects
  if (obj.type === "rope") {
    return (
      <RopeRenderer
        obj={obj}
        scene={scene}
        isSelected={isSelected}
        onSelect={onSelect}
        onToggleSelect={onToggleSelect}
      />
    );
  }

  // Special case: vector respects style.rotation
  const styleWithRotation = {
    ...obj.style,
    rotation: obj.transform.rotation ?? 0,
  };

  const handleMouseDown = (e: React.MouseEvent<SVGGElement>) => {
    e.stopPropagation();
    // Selection: shift toggles, plain click selects-this (but keep group if
    // the user clicked something that wasn't in the current selection).
    if (e.shiftKey) {
      onToggleSelect(obj.id);
    } else if (!selectedIds.includes(obj.id)) {
      onSelect(obj.id);
    }
    // Drag: always start a drag, even for newly-clicked objects.
    const svg = (e.currentTarget as SVGGElement).ownerSVGElement;
    if (!svg) return;
    const startPt = eventToWorld(e, svg);
    const startTransform = { x: obj.transform.x, y: obj.transform.y };
    // The set of ids we're dragging is the current selection, or just this one
    // if it wasn't in the selection.
    const dragIds = selectedIds.includes(obj.id) ? selectedIds : [obj.id];
    const dragStart = new Map<string, { x: number; y: number }>();
    for (const id of dragIds) {
      const o = scene.objects.find((oo) => oo.id === id);
      if (o) dragStart.set(id, { x: o.transform.x, y: o.transform.y });
    }
    const constraintAware = e.altKey;
    let lastPos = startPt;
    // Snap state. While `snap` is non-null, the renderer is previewing
    // a snap target. On mouseup, we apply the snap (create relation + set position).
    let snap: SnapCandidate | null = null;

    function onMove(ev: MouseEvent) {
      const w = eventToWorld(ev, svg!);
      const dx = w.x - startPt.x;
      const dy = w.y - startPt.y;
      lastPos = w;
      // Snap detection (only when dragging a single object — multi-select
      // doesn't snap, the user can group-drag freely).
      if (dragIds.length === 1) {
        const dragged = scene.objects.find((o) => o.id === obj.id);
        if (dragged) {
          // Build a "what would the dragged object look like at this position"
          // pseudo-object for the snap query. The real object is still at its
          // original position; the snap engine compares attach points as if the
          // object were at the candidate position.
          const candidate: SceneObject = {
            ...dragged,
            transform: {
              ...dragged.transform,
              x: startTransform.x + dx,
              y: startTransform.y + dy,
            },
          };
          const candidateScene: FigurateScene = {
            ...scene,
            objects: scene.objects.map((o) =>
              o.id === dragged.id ? candidate : o
            ),
          };
          snap = findSnapTarget(candidate, candidateScene);
          if (snap) {
            // Apply the snap position to the dragged object. The relation
            // is created on mouseup, not here, so the user can drag away
            // if they change their mind.
            onSetTransform(obj.id, snap.snapPosition);
            return;
          }
        }
      }
      // No snap: regular drag.
      if (constraintAware) {
        onSetTransform(obj.id, {
          x: startTransform.x + dx,
          y: startTransform.y + dy,
        });
      } else if (dragIds.length > 1) {
        onNudge(dragIds, dx - (lastDx ?? 0), dy - (lastDy ?? 0));
        lastDx = dx;
        lastDy = dy;
      } else {
        onSetTransform(obj.id, {
          x: startTransform.x + dx,
          y: startTransform.y + dy,
        });
      }
    }
    let lastDx = 0;
    let lastDy = 0;
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // If a snap was active, apply it now: create the relation, set
      // the position, and re-run inference so the smart decorations
      // activate. The position is already set during onMove, so we
      // just need the relation.
      if (snap) {
        onApplySnap(snap);
      } else {
        onCommitDrag();
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    // unused
    void lastPos;
  };

  return (
    <g
      onMouseDown={handleMouseDown}
      style={{ cursor: "grab" }}
    >
      {def.render({
        transform: obj.transform,
        params: obj.params,
        style: styleWithRotation,
        selected: isSelected,
        scene,
        objId: obj.id,
        // Slice the per-scene derived cache down to just this object's
        // fields, with the key prefix stripped. So if a derivation wrote
        // to "tension1::params.angleDeg", the renderer sees:
        //   derived = { "params.angleDeg": 28 }
        derived: sliceDerivedFor(derived, obj.id),
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
          pointerEvents="none"
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
  onToggleSelect,
}: {
  obj: SceneObject;
  scene: FigurateScene;
  isSelected: boolean;
  onSelect: (id: string | null) => void;
  onToggleSelect: (id: string) => void;
}) {
  const fromId = obj.params.from as string;
  const toId = obj.params.to as string;
  const color = (obj.params.color as string) ?? "#444";
  const thickness = (obj.params.thickness as number) ?? 1.5;

  const fromObj = scene.objects.find((o) => o.id === fromId);
  const toObj = scene.objects.find((o) => o.id === toId);

  if (!fromObj || !toObj) {
    return (
      <g>
        <line x1={obj.transform.x} y1={obj.transform.y} x2={obj.transform.x + 50} y2={obj.transform.y} stroke="#999" strokeWidth={1} strokeDasharray="3,2" />
      </g>
    );
  }

  // Hitbox extends a little to make rope easy to click.
  const x1 = fromObj.transform.x;
  const y1 = fromObj.transform.y;
  const x2 = toObj.transform.x;
  const y2 = toObj.transform.y;
  // Compute perpendicular offset for the hitbox
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const HB = 12;

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey) onToggleSelect(obj.id);
    else onSelect(obj.id);
  };

  return (
    <g onMouseDown={handleMouseDown} style={{ cursor: "grab" }}>
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={isSelected ? "#1f6feb" : color}
        strokeWidth={Math.max(thickness, isSelected ? thickness + 1 : thickness)}
      />
      {/* transparent hitbox so a thin rope is still easy to click */}
      <polygon
        points={`${x1 + nx * HB},${y1 + ny * HB} ${x2 + nx * HB},${y2 + ny * HB} ${x2 - nx * HB},${y2 - ny * HB} ${x1 - nx * HB},${y1 - ny * HB}`}
        fill="transparent"
      />
    </g>
  );
}

/**
 * Slice a per-scene derived cache down to just the entries for a single
 * object, with the `objectId::` prefix stripped. So a cache like:
 *   { "tension1::params.angleDeg": 28, "tension1::transform.rotation": 0,
 *     "block1::transform.rotation": 25 }
 * becomes, for `objectId = "tension1"`:
 *   { "params.angleDeg": 28, "transform.rotation": 0 }
 *
 * Returns an empty object if no entries exist for the object — primitives
 * use `derived?.["..."] ?? fallback` so empty is safe.
 */
function sliceDerivedFor(cache: DerivedCache, objectId: string): Record<string, unknown> {
  const prefix = `${objectId}::`;
  const out: Record<string, unknown> = {};
  for (const key in cache) {
    if (key.startsWith(prefix)) {
      out[key.slice(prefix.length)] = cache[key];
    }
  }
  return out;
}