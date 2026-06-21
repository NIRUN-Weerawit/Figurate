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
import { computeForces, applyFbdOverrides } from "../core/forces";

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
  const fbdEnabled = useSceneStore((s) => s.fbdEnabled);
  const setFbdVisible = useSceneStore((s) => s.setFbdVisible);
  const setFbdForceEnabled = useSceneStore((s) => s.setFbdForceEnabled);
  const setFbdForceMagnitude = useSceneStore((s) => s.setFbdForceMagnitude);
  const setFbdForceDirection = useSceneStore((s) => s.setFbdForceDirection);

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
            {def.params.map((p) => {
              // Special: rope `from` and `to` are scene object ids. Show
              // a combobox with all current object ids as suggestions.
              const isObjectRef =
                obj.type === "rope" && (p.name === "from" || p.name === "to");
              return (
                <ParamInput
                  key={p.name}
                  param={p}
                  value={obj.params[p.name] as number | string | boolean}
                  onChange={(v) => {
                    updateParams(obj.id, { [p.name]: v });
                    solve();
                  }}
                  comboboxOptions={isObjectRef ? scene.objects.map((o) => o.id) : undefined}
                />
              );
            })}
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

        {/* FBD (free-body diagram) section. Shows all detectable forces
            on this object. Master toggle + per-force checkboxes + magnitude
            and direction inputs. Computed on the fly from the object's
            relations and properties. */}
        <FbdSection
          obj={obj}
          fbdEnabled={fbdEnabled[obj.id]}
          onSetVisible={(v) => setFbdVisible(obj.id, v)}
          onSetForceEnabled={(ft, e) => setFbdForceEnabled(obj.id, ft, e)}
          onSetForceMagnitude={(ft, m) => setFbdForceMagnitude(obj.id, ft, m)}
          onSetForceDirection={(ft, d) => setFbdForceDirection(obj.id, ft, d)}
        />
      </div>
    </aside>
  );
}

function FbdSection({
  obj,
  fbdEnabled,
  onSetVisible,
  onSetForceEnabled,
  onSetForceMagnitude,
  onSetForceDirection,
}: {
  obj: SceneObject;
  fbdEnabled: Record<string, unknown> | undefined;
  onSetVisible: (v: boolean) => void;
  onSetForceEnabled: (forceType: string, enabled: boolean) => void;
  onSetForceMagnitude: (forceType: string, mag: number) => void;
  onSetForceDirection: (forceType: string, deg: number) => void;
}) {
  const scene = useSceneStore((s) => s.scene);
  // Re-compute the FBD every time the scene changes. The user's overrides
  // are applied via `applyFbdOverrides` so the toggle checkboxes
  // reflect the actual current state (not just the default `enabled`).
  const baseGroup = computeForces(obj, scene);
  const group = applyFbdOverrides(baseGroup, fbdEnabled);
  const visible = fbdEnabled ? fbdEnabled["_visible"] !== false : false;
  // Count present forces (the system thinks these are real)
  const present = group.forces.filter((f) => f.present);
  return (
    <section className="fbd-section">
      <h4>Free-body diagram</h4>
      <p className="hint">
        Auto-detected forces acting on this object. Toggle to show/hide each.
      </p>
      <div className="fbd-master">
        <label>
          <input
            type="checkbox"
            checked={visible}
            onChange={(e) => onSetVisible(e.target.checked)}
          />
          <span>Show FBD ({present.length} force{present.length === 1 ? "" : "s"} detected)</span>
        </label>
      </div>
      {visible && (
        <div className="fbd-forces">
          {group.forces.filter((f) => f.present).map((f) => {
            const enabled = fbdEnabled?.[f.type];
            const mag = fbdEnabled?.[`_mag_${f.type}`];
            const dir = fbdEnabled?.[`_dir_${f.type}`];
            return (
              <div key={f.type} className="fbd-force-row">
                <label className="fbd-force-label">
                  <input
                    type="checkbox"
                    checked={typeof enabled === "boolean" ? enabled : f.enabled}
                    onChange={(e) => onSetForceEnabled(f.type, e.target.checked)}
                  />
                  <span style={{ color: f.color, fontWeight: "bold" }}>
                    {f.label}
                  </span>
                  <span className="fbd-formula">{f.formula}</span>
                </label>
                {typeof enabled === "boolean" ? enabled : f.enabled ? (
                  <div className="fbd-force-controls">
                    <label>
                      <span className="unit">mag</span>
                      <input
                        type="number"
                        min={10}
                        max={500}
                        step={5}
                        value={typeof mag === "number" ? mag : f.magnitude}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!Number.isNaN(v)) onSetForceMagnitude(f.type, v);
                        }}
                      />
                    </label>
                    <label>
                      <span className="unit">dir°</span>
                      <input
                        type="number"
                        min={-360}
                        max={360}
                        step={5}
                        value={typeof dir === "number" ? dir : f.directionDeg}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!Number.isNaN(v)) onSetForceDirection(f.type, v);
                        }}
                      />
                    </label>
                  </div>
                ) : null}
                <p className="fbd-description">{f.description}</p>
              </div>
            );
          })}
          {present.length === 0 && (
            <p className="hint">No forces auto-detected. The FBD is empty for this object.</p>
          )}
        </div>
      )}
    </section>
  );
}

function ParamInput({
  param,
  value,
  onChange,
  comboboxOptions,
}: {
  param: { name: string; type: string; min?: number; max?: number; step?: number; unit?: string };
  value: number | string | boolean;
  onChange: (v: number | string | boolean) => void;
  /** When set (and the param is a string), render a combobox with these
   *  options instead of a plain text input. Used for rope `from`/`to`
   *  params, which reference scene object ids. */
  comboboxOptions?: string[];
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
  // Special: combobox for string params with provided options.
  if (param.type === "string" && comboboxOptions) {
    return (
      <ComboboxInput
        value={value as string}
        onChange={(v) => onChange(v)}
        options={comboboxOptions}
        placeholder={param.name}
      />
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

/**
 * A combobox-style text input with autocomplete suggestions from a list.
 * Used for rope `from`/`to` params where the user can either pick from
 * a list of scene objects or type a free-form id.
 */
function ComboboxInput({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  // Generate a unique id for the datalist so multiple comboboxes on the
  // same page don't collide.
  const listId = `cb-${Math.random().toString(36).slice(2, 9)}`;
  return (
    <div className="param-row combobox-row">
      <input
        type="text"
        list={listId}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="param-text"
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </div>
  );
}