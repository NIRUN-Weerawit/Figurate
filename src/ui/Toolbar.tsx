/**
 * Toolbar — top bar with project title, undo/redo, reset, sample-load, export.
 */

import { useSceneStore } from "../core/scene";
import { SAMPLE_SCENES } from "../samples";

export function Toolbar() {
  const scene = useSceneStore((s) => s.scene);
  const undo = useSceneStore((s) => s.undo);
  const redo = useSceneStore((s) => s.redo);
  const resetScene = useSceneStore((s) => s.resetScene);
  const loadScene = useSceneStore((s) => s.loadScene);
  const past = useSceneStore((s) => s.past);
  const future = useSceneStore((s) => s.future);

  function exportSVG() {
    const svg = document.querySelector(".canvas svg");
    if (!svg) return;
    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(svg);
    // add the XML declaration
    source = '<?xml version="1.0" standalone="no"?>\r\n' + source;
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(scene.meta.title ?? "figurate").replace(/\s+/g, "-")}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportJSON() {
    const text = JSON.stringify(scene, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(scene.meta.title ?? "figurate").replace(/\s+/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJSON() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => loadScene(JSON.parse(reader.result as string));
      reader.readAsText(file);
    };
    input.click();
  }

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">◈</span>
        <span className="brand-name">Figurate</span>
        <span className="brand-tag">scientific diagrams</span>
      </div>
      <div className="toolbar-center">
        <button onClick={undo} disabled={past.length === 0} title="Undo (Cmd+Z)">↶ Undo</button>
        <button onClick={redo} disabled={future.length === 0} title="Redo (Cmd+Shift+Z)">↷ Redo</button>
        <button onClick={resetScene} title="Clear canvas">⟲ Reset</button>
      </div>
      <div className="toolbar-right">
        <select
          value=""
          onChange={(e) => {
            const key = e.target.value;
            if (key) loadScene(SAMPLE_SCENES[key].scene, `load sample: ${SAMPLE_SCENES[key].label}`);
          }}
        >
          <option value="">Load sample…</option>
          {Object.entries(SAMPLE_SCENES).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <button onClick={importJSON} title="Open a .json scene file">📂 Open</button>
        <button onClick={exportJSON} title="Download JSON scene">⌘ JSON</button>
        <button onClick={exportSVG} title="Download SVG figure">⬇ SVG</button>
      </div>
    </header>
  );
}