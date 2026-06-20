/**
 * DSL Editor — bottom panel. Shows the live JSON scene, lets you edit it
 * directly. Errors are caught and surfaced in red.
 */

import { useEffect, useState } from "react";
import { useSceneStore } from "../core/scene";

export function DSLEditor() {
  const scene = useSceneStore((s) => s.scene);
  const exportJSON = useSceneStore((s) => s.exportJSON);
  const importJSON = useSceneStore((s) => s.importJSON);

  const [text, setText] = useState(() => exportJSON());
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // keep the editor in sync with the scene (live update)
  useEffect(() => {
    setText(exportJSON());
  }, [scene, exportJSON]);

  function applyEdit() {
    try {
      JSON.parse(text); // validate first
      importJSON(text);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className={`dsl-editor ${open ? "open" : ""}`}>
      <button className="dsl-toggle" onClick={() => setOpen(!open)}>
        {open ? "▼" : "▲"} JSON DSL {open ? "" : "(edit scene directly)"}
      </button>
      {open && (
        <div className="dsl-body">
          <textarea
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={applyEdit}
            className="dsl-textarea"
          />
          {error && <div className="dsl-error">⚠ {error}</div>}
          <div className="dsl-actions">
            <button onClick={() => navigator.clipboard.writeText(text)}>Copy</button>
            <button onClick={applyEdit}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}