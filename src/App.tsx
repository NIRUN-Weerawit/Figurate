import { useEffect } from "react";
import { Toolbar } from "./ui/Toolbar";
import { Library } from "./ui/Library";
import { Inspector } from "./ui/Inspector";
import { SceneRenderer } from "./render/SceneRenderer";
import { DSLEditor } from "./ui/DSLEditor";
import { useSceneStore } from "./core/scene";
import { SAMPLE_SCENES } from "./samples";

export function App() {
  const scene = useSceneStore((s) => s.scene);
  const derived = useSceneStore((s) => s.derived);
  const selectedId = useSceneStore((s) => s.selectedId);
  const selectedIds = useSceneStore((s) => s.selectedIds);
  const select = useSceneStore((s) => s.select);
  const toggleSelect = useSceneStore((s) => s.toggleSelect);
  const selectInRect = useSceneStore((s) => s.selectInRect);
  const setTransform = useSceneStore((s) => s.setTransform);
  const nudge = useSceneStore((s) => s.nudge);
  const solve = useSceneStore((s) => s.solve);
  const commit = useSceneStore((s) => s.commit);
  const undo = useSceneStore((s) => s.undo);
  const redo = useSceneStore((s) => s.redo);
  const removeObject = useSceneStore((s) => s.removeObject);
  const loadScene = useSceneStore((s) => s.loadScene);

  // load a sample scene on first mount so the canvas isn't blank
  useEffect(() => {
    if (scene.objects.length === 0) {
      const params = new URLSearchParams(window.location.search);
      const demo = params.get("demo");
      const sample = params.get("sample");
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