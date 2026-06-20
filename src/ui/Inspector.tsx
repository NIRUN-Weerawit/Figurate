/**
 * Inspector — right sidebar. Shows properties of the selected object and lets
 * the user edit them. Changes flow back through the scene store and re-run
 * the constraint solver.
 */

import { useSceneStore } from "../core/scene";
import { getPrimitive } from "../core/registry";
import type { SceneObject } from "../core/dsl";

export function Inspector() {
  const scene = useSceneStore((s) => s.scene);
  const selectedId = useSceneStore((s) => s.selectedId);
  const select = useSceneStore((s) => s.select);
  const updateParams = useSceneStore((s) => s.updateParams);
  const setTransform = useSceneStore((s) => s.setTransform);
  const removeObject = useSceneStore((s) => s.removeObject);

  const obj = selectedId ? scene.objects.find((o) => o.id === selectedId) : null;

  if (!obj) {
    return (
      <aside className="inspector inspector-empty">
        <div>
          <p>Select an object on the canvas to edit its properties.</p>
          <p className="hint">
            Click a primitive in the <strong>Library</strong> on the left to add it to the canvas.
            Then drag it to position it.
          </p>
        </div>
      </aside>
    );
  }

  const def = getPrimitive(obj.type);
  if (!def) return null;

  return (
    <aside className="inspector">
      <header>
        <h3>{def.label}</h3>
        <code className="id">{obj.id}</code>
      </header>
      <div className="inspector-body">
        <section>
          <h4>Position</h4>
          <div className="param-row">
            <label>x</label>
            <input
              type="number"
              value={obj.transform.x.toFixed(1)}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v)) setTransform(obj.id, { x: v });
              }}
            />
            <label>y</label>
            <input
              type="number"
              value={obj.transform.y.toFixed(1)}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v)) setTransform(obj.id, { y: v });
              }}
            />
          </div>
        </section>

        <section>
          <h4>Parameters</h4>
          {def.params.map((p) => (
            <ParamInput
              key={p.name}
              param={p}
              value={obj.params[p.name] as number | string | boolean}
              onChange={(v) => updateParams(obj.id, { [p.name]: v })}
            />
          ))}
        </section>

        {obj.relations && obj.relations.length > 0 && (
          <section>
            <h4>Relations</h4>
            {obj.relations.map((r, i) => (
              <div key={i} className="relation">
                <code>{r.kind}</code>
                {"target" in r ? <span> → <code>{r.target}</code></span> : null}
              </div>
            ))}
          </section>
        )}

        <section>
          <button
            className="btn-danger"
            onClick={() => {
              removeObject(obj.id);
              select(null);
            }}
          >
            Delete object
          </button>
        </section>
      </div>
    </aside>
  );
}

function ParamInput({
  param,
  value,
  onChange,
}: {
  param: { name: string; type: string; min?: number; max?: number; step?: number; unit?: string };
  value: number | string | boolean;
  onChange: (v: number | string | boolean) => void;
}) {
  const label = param.name;
  if (param.type === "number") {
    return (
      <div className="param-row">
        <label title={label}>
          {label}
          {param.unit && <span className="unit">({param.unit})</span>}
        </label>
        <input
          type="number"
          value={value as number}
          min={param.min}
          max={param.max}
          step={param.step ?? 1}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        />
        {param.type === "number" && param.min !== undefined && param.max !== undefined && (
          <input
            type="range"
            value={value as number}
            min={param.min}
            max={param.max}
            step={param.step ?? 1}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="param-slider"
          />
        )}
      </div>
    );
  }
  if (param.type === "boolean") {
    return (
      <div className="param-row">
        <label>{label}</label>
        <input
          type="checkbox"
          checked={value as boolean}
          onChange={(e) => onChange(e.target.checked)}
        />
      </div>
    );
  }
  if (param.type === "color") {
    return (
      <div className="param-row">
        <label>{label}</label>
        <input
          type="color"
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          type="text"
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          className="param-text"
        />
      </div>
    );
  }
  return (
    <div className="param-row">
      <label>{label}</label>
      <input
        type="text"
        value={value as string}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}