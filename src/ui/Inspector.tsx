/**
 * Inspector — right sidebar. Shows properties of the selected object and lets
 * the user edit them. Changes flow back through the scene store and re-run
 * the constraint solver.
 *
 * Three views:
 *  1. Nothing selected → empty state
 *  2. Single object that's the anchor of a composite → shows a "Decorations"
 *     panel with per-role visibility toggles, plus the object's own props
 *  3. Anything else (single plain object, or composite child) → shows
 *     position, params, relations, delete button
 *  4. Multi-select → shows a count and bulk actions
 */

import { useSceneStore } from "../core/scene";
import { getPrimitive } from "../core/registry";
import type { SceneObject } from "../core/dsl";

const ROLE_LABELS: Record<string, string> = {
  pivot: "Pivot (ceiling mount)",
  rope: "Rope / string",
  bob: "Pendulum bob",
  theta: "Angle θ (arc)",
  tension: "Tension vector T",
  weight: "Weight vector mg",
  incline: "Incline surface",
  block: "Block",
  gravity: "Gravity vector mg",
  normal: "Normal force N",
  friction: "Friction f",
};

export function Inspector() {
  const scene = useSceneStore((s) => s.scene);
  const selectedId = useSceneStore((s) => s.selectedId);
  const selectedIds = useSceneStore((s) => s.selectedIds);
  const select = useSceneStore((s) => s.select);
  const updateParams = useSceneStore((s) => s.updateParams);
  const setTransformAndSolve = useSceneStore((s) => s.setTransformAndSolve);
  const removeObject = useSceneStore((s) => s.removeObject);
  const solve = useSceneStore((s) => s.solve);
  const setRoleVisible = useSceneStore((s) => s.setRoleVisible);

  // Multi-select view
  if (selectedIds.length > 1) {
    return (
      <aside className="inspector">
        <header>
          <h3>{selectedIds.length} objects selected</h3>
        </header>
        <div className="inspector-body">
          <p>Drag any selected object to move the group. Press Delete to remove all.</p>
          <button
            className="btn-danger"
            onClick={() => {
              for (const id of selectedIds) removeObject(id);
              select(null);
            }}
          >
            Delete {selectedIds.length} objects
          </button>
        </div>
      </aside>
    );
  }

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

  // If this object is part of a composite, find the sibling decorations.
  const compositeSiblings = obj.compositeOf
    ? scene.objects.filter((o) => o.compositeOf === obj.compositeOf)
    : [];
  const isAnchor = compositeSiblings.length > 0 && compositeSiblings[0].id === obj.id;

  return (
    <aside className="inspector">
      <header>
        <h3>{def.label}</h3>
        <code className="id">{obj.id}</code>
        {obj.compositeOf && isAnchor && (
          <span className="composite-badge">composite anchor</span>
        )}
        {obj.compositeOf && !isAnchor && (
          <span className="composite-badge">composite decoration</span>
        )}
      </header>
      <div className="inspector-body">
        {isAnchor && compositeSiblings.length > 0 && (
          <section>
            <h4>Decorations</h4>
            <p className="hint">Toggle visibility for each piece of the composite.</p>
            {compositeSiblings.map((s) => (
              <div key={s.id} className="param-row role-row">
                <label>
                  <input
                    type="checkbox"
                    checked={s.visible !== false}
                    onChange={(e) => {
                      setRoleVisible(obj.compositeOf!, s.compositeRole ?? s.type, e.target.checked);
                      solve();
                    }}
                  />
                  <span>{ROLE_LABELS[s.compositeRole ?? ""] ?? s.compositeRole ?? s.type}</span>
                </label>
              </div>
            ))}
          </section>
        )}

        <section>
          <h4>Position</h4>
          <div className="param-row">
            <label>x</label>
            <input
              type="number"
              value={obj.transform.x.toFixed(1)}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v)) {
                  setTransformAndSolve(obj.id, { x: v });
                }
              }}
            />
            <label>y</label>
            <input
              type="number"
              value={obj.transform.y.toFixed(1)}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v)) {
                  setTransformAndSolve(obj.id, { y: v });
                }
              }}
            />
          </div>
        </section>

        {def.params.length > 0 && (
          <section>
            <h4>Parameters</h4>
            {def.params.map((p) => (
              <ParamInput
                key={p.name}
                param={p}
                value={obj.params[p.name] as number | string | boolean}
                onChange={(v) => {
                  updateParams(obj.id, { [p.name]: v });
                  solve();
                }}
              />
            ))}
          </section>
        )}

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