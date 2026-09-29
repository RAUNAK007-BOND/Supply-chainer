import React, { useEffect, useRef, useState } from 'react';
import { Anchor, Plane, TrainFront, Warehouse, AlertTriangle } from 'lucide-react';
import { api } from '../lib.js';

const TYPE_ICON = {
  port: [Anchor, '#1597d8'], airport: [Plane, '#8b5cf6'], rail_hub: [TrainFront, '#e59a12'],
  rail_terminal: [TrainFront, '#e59a12'], distribution_hub: [Warehouse, '#14a594'], choke_point: [AlertTriangle, '#f06a1c'],
};

export function HubIcon({ type, size = 15 }) {
  const [Icon, color] = TYPE_ICON[type] || [Warehouse, '#8a94a6'];
  return <span className="type-ico"><Icon size={size} color={color} /></span>;
}

export default function HubSearch({ label, value, onSelect, placeholder, id }) {
  const [q, setQ] = useState(value?.name || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const timer = useRef();

  useEffect(() => { setQ(value?.name || ''); }, [value?.id, value?.name]);

  const search = (text) => {
    setQ(text);
    clearTimeout(timer.current);
    if (text.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      try { setResults(await api.searchHubs(text.trim())); setOpen(true); setHl(0); } catch { setResults([]); }
    }, 160);
  };

  const choose = (h) => { onSelect({ id: h.id, name: h.display_name }); setQ(h.display_name); setOpen(false); };

  const onKey = (e) => {
    if (!open || !results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(h + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); choose(results[hl]); }
    if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" value={q} placeholder={placeholder} autoComplete="off"
        role="combobox" aria-expanded={open} aria-controls={`${id}-list`}
        onChange={(e) => search(e.target.value)} onKeyDown={onKey}
        onFocus={() => results.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && results.length > 0 && (
        <div className="suggest" id={`${id}-list`} role="listbox">
          {results.map((h, i) => (
            <button key={h.id} role="option" aria-selected={i === hl} className={i === hl ? 'hl' : ''}
              onMouseDown={(e) => e.preventDefault()} onClick={() => choose(h)} onMouseEnter={() => setHl(i)}>
              <HubIcon type={h.type} />
              <div style={{ minWidth: 0 }}>
                <div className="t">{h.display_name}</div>
                <div className="s">{h.id} · {h.country} · {h.modes.join(' / ')}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
