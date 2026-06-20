/**
 * Library — left sidebar. Shows the primitive palette grouped by category.
 * Drag (or click) to add to canvas.
 */

import { listPrimitives, listPrimitivesByCategory, allCategories, type PrimitiveDefinition } from "../core/registry";
import { useSceneStore } from "../core/scene";
import clsx from "clsx";
import { useState } from "react";

export function Library() {
  const addObject = useSceneStore((s) => s.addObject);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["mechanics"]));

  const filtered = listPrimitives().filter((p) =>
    p.label.toLowerCase().includes(search.toLowerCase()) ||
    p.type.toLowerCase().includes(search.toLowerCase())
  );

  const grouped = allCategories().map((cat) => ({
    cat,
    items: filtered.filter((p) => p.category === cat),
  }));

  return (
    <aside className="library">
      <div className="library-header">
        <h2>Library</h2>
        <input
          type="search"
          placeholder="Search primitives..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="library-search"
        />
      </div>
      <div className="library-list">
        {grouped.map(({ cat, items }) =>
          items.length === 0 ? null : (
            <CategoryGroup
              key={cat}
              cat={cat}
              items={items}
              expanded={expanded.has(cat)}
              onToggle={() => {
                const next = new Set(expanded);
                next.has(cat) ? next.delete(cat) : next.add(cat);
                setExpanded(next);
              }}
              onAdd={(type) => addObject(type)}
            />
          )
        )}
      </div>
    </aside>
  );
}

function CategoryGroup({
  cat,
  items,
  expanded,
  onToggle,
  onAdd,
}: {
  cat: string;
  items: PrimitiveDefinition[];
  expanded: boolean;
  onToggle: () => void;
  onAdd: (type: string) => void;
}) {
  return (
    <div className="library-group">
      <button className="library-group-header" onClick={onToggle}>
        <span className={clsx("caret", { open: expanded })}>▶</span>
        <span>{cat}</span>
        <span className="count">{items.length}</span>
      </button>
      {expanded && (
        <div className="library-items">
          {items.map((p) => (
            <button
              key={p.type}
              className="library-item"
              title={p.description}
              onClick={() => onAdd(p.type)}
            >
              <PrimitiveIcon type={p.type} />
              <span className="library-item-label">{p.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Small icon preview — just a tiny SVG version of the primitive.
 * Falls back to a colored square.
 */
function PrimitiveIcon({ type }: { type: string }) {
  // a 32x32 viewport showing the primitive in miniature
  const W = 32, H = 32;
  const style = { width: W, height: H };
  switch (type) {
    case "pendulum_pivot":
      return (
        <svg viewBox={`0 0 ${W} ${H}`} style={style}>
          <rect x="6" y="6" width="20" height="3" fill="#333" />
          <line x1="8" y1="9" x2="6" y2="14" stroke="#333" />
          <line x1="14" y1="9" x2="12" y2="14" stroke="#333" />
          <line x1="20" y1="9" x2="18" y2="14" stroke="#333" />
          <line x1="26" y1="9" x2="24" y2="14" stroke="#333" />
        </svg>
      );
    case "pendulum_bob":
      return (
        <svg viewBox={`0 0 ${W} ${H}`} style={style}>
          <line x1="16" y1="2" x2="16" y2="14" stroke="#444" strokeWidth="1" />
          <circle cx="16" cy="22" r="8" fill="#fff" stroke="#222" strokeWidth="1.5" />
          <text x="16" y="32" textAnchor="middle" fontSize="7" fontStyle="italic" fill="#444">m</text>
        </svg>
      );
    case "incline":
      return (
        <svg viewBox={`0 0 ${W} ${H}`} style={style}>
          <line x1="6" y1="26" x2="26" y2="10" stroke="#222" strokeWidth="2" />
          <line x1="8" y1="26" x2="5" y2="28" stroke="#222" />
          <line x1="13" y1="22" x2="10" y2="24" stroke="#222" />
          <line x1="18" y1="18" x2="15" y2="20" stroke="#222" />
          <line x1="23" y1="14" x2="20" y2="16" stroke="#222" />
        </svg>
      );
    case "block":
      return (
        <svg viewBox={`0 0 ${W} ${H}`} style={style}>
          <rect x="8" y="12" width="16" height="10" fill="#fff" stroke="#222" strokeWidth="1.5" rx="1" />
        </svg>
      );
    case "ground":
      return (
        <svg viewBox={`0 0 ${W} ${H}`} style={style}>
          <line x1="2" y1="22" x2="30" y2="22" stroke="#333" strokeWidth="2" />
          <line x1="6" y1="22" x2="3" y2="26" stroke="#333" />
          <line x1="12" y1="22" x2="9" y2="26" stroke="#333" />
          <line x1="18" y1="22" x2="15" y2="26" stroke="#333" />
          <line x1="24" y1="22" x2="21" y2="26" stroke="#333" />
        </svg>
      );
    case "vector":
      return (
        <svg viewBox={`0 0 ${W} ${H}`} style={style}>
          <line x1="4" y1="24" x2="24" y2="10" stroke="#c0392b" strokeWidth="2" />
          <polygon points="24,10 20,8 22,14" fill="#c0392b" />
        </svg>
      );
    case "axes":
      return (
        <svg viewBox={`0 0 ${W} ${H}`} style={style}>
          <line x1="4" y1="20" x2="28" y2="20" stroke="#333" strokeWidth="1" />
          <line x1="14" y1="28" x2="14" y2="4" stroke="#333" strokeWidth="1" />
        </svg>
      );
    case "angle_marker":
      return (
        <svg viewBox={`0 0 ${W} ${H}`} style={style}>
          <line x1="16" y1="22" x2="28" y2="22" stroke="#1f6feb" />
          <path d="M 26 22 A 10 10 0 0 0 16 12" fill="none" stroke="#1f6feb" />
        </svg>
      );
    case "text_label":
      return (
        <svg viewBox={`0 0 ${W} ${H}`} style={style}>
          <text x="16" y="20" textAnchor="middle" fontSize="12" fill="#222">A</text>
        </svg>
      );
    default:
      return (
        <svg viewBox={`0 0 ${W} ${H}`} style={style}>
          <rect x="6" y="6" width="20" height="20" fill="#eee" stroke="#999" />
        </svg>
      );
  }
}