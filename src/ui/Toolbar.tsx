/**
 * Toolbar — top bar with project title, undo/redo, reset, sample-load, export.
 */

import { useState } from "react";
import { useSceneStore } from "../core/scene";
import { SAMPLE_SCENES } from "../samples";
import { detectAllForces, FORCE_META } from "../core/forces";
import clsx from "clsx";

export function Toolbar() {
  const scene = useSceneStore((s) => s.scene);
  const undo = useSceneStore((s) => s.undo);
  const redo = useSceneStore((s) => s.redo);
  const resetScene = useSceneStore((s) => s.resetScene);
  const loadScene = useSceneStore((s) => s.loadScene);
  const past = useSceneStore((s) => s.past);
  const future = useSceneStore((s) => s.future);
  const setFbdVisible = useSceneStore((s) => s.setFbdVisible);
  const select = useSceneStore((s) => s.select);
  const [toast, setToast] = useState<string | null>(null);

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

  /**
   * Scan the scene and turn on the FBD overlay for every object that
   * has at least one auto-detectable force. The user can then click
   * any object to see and tweak its FBD in the Inspector.
   */
  function detectForces() {
    const summary = detectAllForces(scene);
    if (summary.length === 0) {
      setToast("No forces detected. Add some objects first.");
      setTimeout(() => setToast(null), 2500);
      return;
    }
    let total = 0;
    for (const item of summary) {
      setFbdVisible(item.objectId, true);
      total += item.forceCount;
    }
    // Auto-select the first object so the user immediately sees its FBD.
    select(summary[0].objectId);
    setToast(
      `Detected ${total} force${total === 1 ? "" : "s"} on ${summary.length} object${summary.length === 1 ? "" : "s"}.`
    );
    setTimeout(() => setToast(null), 3500);
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
        <button
          onClick={detectForces}
          title="Auto-detect forces on every object and show the FBD overlay"
        >
          ⚡ Detect forces
        </button>
      </div>
      <div className="toolbar-right">
        {/* Global FBD force toggles — show a force on EVERY object that
            has it, regardless of selection. Independent of the per-object
            FBD toggles in the Inspector. */}
        <GlobalForceToggles />
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
      {toast && <div className="toast">{toast}</div>}
    </header>
  );
}

/**
 * The "global FBD force toggles" dropdown. Each force type has a
 * checkbox that, when checked, shows that force on every object that
 * has it — regardless of selection. Independent of the per-object
 * FBD toggles in the Inspector.
 *
 * The user can also press "All on" / "All off" for quick toggling.
 */
function GlobalForceToggles() {
  const fbdGlobalEnabled = useSceneStore((s) => s.fbdGlobalEnabled);
  const setFbdGlobalEnabled = useSceneStore((s) => s.setFbdGlobalEnabled);
  const [open, setOpen] = useState(false);
  const enabledCount = Object.values(fbdGlobalEnabled).filter(Boolean).length;
  return (
    <div className="global-forces">
      <button
        className={clsx("btn-toggle", { active: enabledCount > 0 })}
        onClick={() => setOpen((v) => !v)}
        title="Show a force on every object that has it, regardless of selection"
      >
        ⚙ Forces {enabledCount > 0 ? `(${enabledCount})` : ""}
      </button>
      {open && (
        <div className="global-forces-panel">
          <div className="global-forces-header">
            <strong>Force visibility</strong>
            <div className="global-forces-actions">
              <button onClick={() => {
                for (const f of Object.keys(FORCE_META)) {
                  setFbdGlobalEnabled(f, true);
                }
              }}>All on</button>
              <button onClick={() => {
                for (const f of Object.keys(fbdGlobalEnabled)) {
                  setFbdGlobalEnabled(f, false);
                }
              }}>All off</button>
            </div>
          </div>
          {Object.entries(FORCE_META).map(([type, meta]) => (
            <label key={type} className="global-forces-row">
              <input
                type="checkbox"
                checked={fbdGlobalEnabled[type] === true}
                onChange={(e) => setFbdGlobalEnabled(type, e.target.checked)}
              />
              <span style={{ color: meta.color, fontWeight: "bold" }}>●</span>
              <span>{meta.label}</span>
              <span className="global-forces-cat">{meta.category}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}