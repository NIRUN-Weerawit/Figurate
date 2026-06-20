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
  const selectedId = useSceneStore((s) => s.selectedId);
  const select = useSceneStore((s) => s.select);
  const updateTransform = useSceneStore((s) => s.updateTransform);
  const solve = useSceneStore((s) => s.solve);
  const undo = useSceneStore((s) => s.undo);
  const redo = useSceneStore((s) => s.redo);
  const removeObject = useSceneStore((s) => s.removeObject);
  const loadScene = useSceneStore((s) => s.loadScene);

  // load a sample scene on first mount so the canvas isn't blank
  useEffect(() => {
    if (scene.objects.length === 0) {
      loadScene(SAMPLE_SCENES.pendulum.scene, "load initial sample");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (meta && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId && (e.target as HTMLElement)?.tagName !== "INPUT" && (e.target as HTMLElement)?.tagName !== "TEXTAREA") {
          removeObject(selectedId);
          select(null);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, removeObject, selectedId, select]);

  return (
    <div className="app">
      <Toolbar />
      <div className="layout">
        <Library />
        <main className="canvas" onDragOver={(e) => e.preventDefault()}>
          <SceneRenderer
            scene={scene}
            selectedId={selectedId}
            onSelect={select}
            onDrag={(id, worldPos) => {
              updateTransform(id, worldPos);
              // re-solve every frame so dependent objects follow
              solve();
            }}
          />
          <div className="canvas-hint">
            Click an item in the Library to add it. Drag objects to reposition. Edit params on the right.
          </div>
        </main>
        <Inspector />
      </div>
      <DSLEditor />
    </div>
  );
}