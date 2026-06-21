import { useEffect, useMemo } from "react";
import { Toolbar } from "./ui/Toolbar";
import { Library } from "./ui/Library";
import { Inspector } from "./ui/Inspector";
import { SceneRenderer } from "./render/SceneRenderer";
import { DSLEditor } from "./ui/DSLEditor";
import { useSceneStore } from "./core/scene";
import { SAMPLE_SCENES } from "./samples";
import { computeForces, applyFbdOverrides, detectAllForces } from "./core/forces";
import type { ForceGroup, Force } from "./core/forces";

export function App() {
  const scene = useSceneStore((s) => s.scene);
  const derived = useSceneStore((s) => s.derived);
  const selectedId = useSceneStore((s) => s.selectedId);
  const selectedIds = useSceneStore((s) => s.selectedIds);
  const select = useSceneStore((s) => s.select);
  const toggleSelect = useSceneStore((s) => s.toggleSelect);
  const selectInRect = useSceneStore((s) => s.selectInRect);
  const setTransform = useSceneStore((s) => s.setTransform);
  const applySnap = useSceneStore((s) => s.applySnap);
  const nudge = useSceneStore((s) => s.nudge);
  const solve = useSceneStore((s) => s.solve);
  const commit = useSceneStore((s) => s.commit);
  const undo = useSceneStore((s) => s.undo);
  const redo = useSceneStore((s) => s.redo);
  const removeObject = useSceneStore((s) => s.removeObject);
  const loadScene = useSceneStore((s) => s.loadScene);
  const addObject = useSceneStore((s) => s.addObject);
  const setViewport = useSceneStore((s) => s.setViewport);
  const resetViewport = useSceneStore((s) => s.resetViewport);
  const viewport = useSceneStore((s) => s.viewport);
  const fbdEnabled = useSceneStore((s) => s.fbdEnabled);
  const fbdGlobalEnabled = useSceneStore((s) => s.fbdGlobalEnabled);

  /**
   * Compute the FBD overlays for the whole scene. There are two sources
   * of visibility:
   *
   *   1. Per-object: when the user selects an object and toggles its
   *      FBD on, that object's FBD shows (with per-force sub-toggles).
   *   2. Global: when a force type is toggled on globally, that force
   *      is shown on every object that has it, regardless of selection.
   *
   * The result is a list of `ForceGroup`s — one per object that has
   * at least one visible force. The renderer draws them all.
   */
  const fbdGroups = useMemo(() => {
    const result: ForceGroup[] = [];
    // For each object in the scene, compute its base force group.
    // Then layer per-object + global overrides to decide which forces
    // are visible.
    for (const obj of scene.objects) {
      const base = computeForces(obj, scene);
      if (base.forces.length === 0) continue;
      const perObj = fbdEnabled[obj.id];
      // If the per-object FBD is off, AND no globally-enabled force
      // applies to this object, skip.
      const globallyVisible = base.forces.some(
        (f) => fbdGlobalEnabled[f.type] === true
      );
      // The per-object FBD is "visible" if the master toggle is on AND
      // at least one of the per-force toggles is true. We don't count
      // magnitude/direction overrides (those keys start with "_") as
      // visibility signals.
      const perObjectVisible = !!perObj && perObj["_visible"] !== false && Object.entries(perObj).some(
        ([k, v]) => v === true && !k.startsWith("_")
      );
      if (!globallyVisible && !perObjectVisible) continue;
      // Build the merged group: a force is visible if either
      //   - its per-object override is true, OR
      //   - its global override is true.
      // Apply per-object magnitude/direction overrides on top.
      const merged: ForceGroup = {
        objectId: obj.id,
        forces: base.forces.map((f): Force => {
          const perObjFlag = perObj?.[f.type];
          const perObjEnabled: boolean =
            typeof perObjFlag === "boolean" ? perObjFlag : f.enabled;
          const globalEnabled = fbdGlobalEnabled[f.type] === true;
          const mag = perObj?.[`_mag_${f.type}`];
          const dir = perObj?.[`_dir_${f.type}`];
          return {
            ...f,
            enabled: perObjEnabled || globalEnabled,
            magnitude: typeof mag === "number" ? mag : f.magnitude,
            directionDeg: typeof dir === "number" ? dir : f.directionDeg,
          };
        }),
      };
      // Keep only visible forces.
      merged.forces = merged.forces.filter((f) => f.enabled && f.present);
      if (merged.forces.length > 0) result.push(merged);
    }
    return result;
  }, [scene, fbdEnabled, fbdGlobalEnabled]);

  // Backwards-compat: `fbdGroup` is the selected object's FBD. The
  // renderer accepts a list now, but keep this for the Inspector.
  const fbdGroup = useMemo(() => {
    if (!selectedId) return null;
    return fbdGroups.find((g) => g.objectId === selectedId) ?? null;
  }, [fbdGroups, selectedId]);

  // load a sample scene on first mount so the canvas isn't blank
  useEffect(() => {
    if (scene.objects.length === 0) {
      const params = new URLSearchParams(window.location.search);
      const demo = params.get("demo");
      const sample = params.get("sample");
      const fbd = params.get("fbd");
      if (demo === "pendulum-composite") {
        // Drop a freshly-built pendulum composite so we can verify the
        // auto-decoration renders correctly.
        loadScene(SAMPLE_SCENES.empty.scene, "reset for demo");
        useSceneStore.getState().addObject("pendulum", { x: 450, y: 100 });
      } else if (demo === "incline-composite") {
        loadScene(SAMPLE_SCENES.empty.scene, "reset for demo");
        useSceneStore.getState().addObject("block_on_incline", { x: 250, y: 350 });
      } else if (sample && SAMPLE_SCENES[sample]) {
        // ?sample=incline, ?sample=pendulum, ?sample=freebody
        loadScene(SAMPLE_SCENES[sample].scene, `load ${sample} sample`);
        if (fbd === "on") {
          // Auto-trigger "Detect forces" for the loaded sample. This
          // makes testing easy: ?sample=incline&fbd=on loads the incline
          // and turns on FBD for every object.
          setTimeout(() => {
            const summary = detectAllForces(useSceneStore.getState().scene);
            for (const item of summary) {
              useSceneStore.getState().setFbdVisible(item.objectId, true);
            }
            if (summary.length > 0) {
              useSceneStore.getState().select(summary[0].objectId);
            }
          }, 100);
        }
      } else {
        loadScene(SAMPLE_SCENES.pendulum.scene, "load initial sample");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA";
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (meta && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (inField) return;
        if (selectedIds.length > 0) {
          for (const id of selectedIds) removeObject(id);
          select(null);
        } else if (selectedId) {
          removeObject(selectedId);
          select(null);
        }
      } else if (e.key === "Escape") {
        select(null);
      } else if (meta && e.key === "a") {
        e.preventDefault();
        const all = scene.objects.map((o) => o.id);
        useSceneStore.getState().setSelection(all);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, removeObject, selectedId, selectedIds, select, scene.objects]);

  return (
    <div className="app">
      <Toolbar />
      <div className="layout">
        <Library />
        <main className="canvas" onDragOver={(e) => e.preventDefault()}>
          <SceneRenderer
            scene={scene}
            derived={derived}
            selectedId={selectedId}
            selectedIds={selectedIds}
            onSelect={select}
            onToggleSelect={toggleSelect}
            onSelectInRect={selectInRect}
            onSetTransform={(id, t) => {
              setTransform(id, t);
              // Don't solve during drag — let objects move freely.
              // Solver will run on mouseup (onCommitDrag) to snap constrained objects.
            }}
            onNudge={(ids, dx, dy) => {
              nudge(ids, dx, dy);
              // Don't solve during drag for multi-select either.
            }}
            onCommitDrag={() => {
              solve();
              commit("drag");
            }}
            onApplySnap={(candidate) => {
              // The snap engine already set the position during drag;
              // on mouseup we just need to record the relation and
              // commit to history. applySnap also re-runs solve so
              // constraints are satisfied and inference runs to
              // activate the smart decorations.
              applySnap(candidate);
              commit("snap");
            }}
            fbdGroups={fbdGroups}
            viewport={viewport}
            onSetViewport={setViewport}
            onResetViewport={resetViewport}
            onSpawn={(type, position) => addObject(type, position)}
          />
          <div className="canvas-hint">
            Click to select · Shift+click to add · drag on empty canvas to marquee-select · drag to move · Alt+drag for constraint-aware.
          </div>
        </main>
        <Inspector />
      </div>
      <DSLEditor />
    </div>
  );
}