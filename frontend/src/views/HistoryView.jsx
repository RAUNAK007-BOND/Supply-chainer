import React, { useEffect, useMemo, useState } from 'react';
import { History, Star, Trash2, ExternalLink, FileText, FileDown, GitCompareArrows } from 'lucide-react';
import { api, fmtH, fmtMoney, fmtPct, timeAgo, riskClass } from '../lib.js';
import { PersonaBadges } from '../components/RouteBits.jsx';

export default function HistoryView({ onOpenRun }) {
  const [runs, setRuns] = useState(null);
  const [filter, setFilter] = useState('all');
  const [compare, setCompare] = useState([]);

  const load = () => api.runs().then(setRuns).catch(() => setRuns([]));
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => (runs || []).filter((r) => filter === 'all' || (filter === 'watched' ? r.watched : r.scenario)), [runs, filter]);
  const toggleCompare = (id) => setCompare((c) => c.includes(id) ? c.filter((x) => x !== id) : [...c, id].slice(-4));
  const compared = (runs || []).filter((r) => compare.includes(r.id));

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Saved routes</h1>
            <p>Every route you plan is saved automatically. Reopen one, compare a few side by side, watch it for disruptions, or download a report.</p>
          </div>
          <div className="seg" style={{ width: 280 }}>
            {[['all', 'All'], ['watched', 'Watching'], ['scenario', 'Simulations']].map(([id, l]) => (
              <button key={id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>{l}</button>
            ))}
          </div>
        </div>

        {compared.length >= 2 && (
          <div className="panel">
            <div className="panel-h"><h2><GitCompareArrows size={14} /> Comparison</h2><button className="btn sm ghost" onClick={() => setCompare([])}>Clear</button></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Run</th><th>Scenario</th><th>Option</th><th>ETA p50 / p85 / p95</th><th>Cost</th><th>Peak threat</th><th>Mode</th></tr></thead>
                <tbody>
                  {compared.flatMap((r) => r.summary.map((s, i) => (
                    <tr key={`${r.id}-${i}`}>
                      <td>{i === 0 ? <><b>{r.origin} → {r.destination}</b><div className="muted mono" style={{ fontSize: 11 }}>{r.id}</div></> : ''}</td>
                      <td>{i === 0 ? (r.scenario || <span className="muted">normal</span>) : ''}</td>
                      <td><PersonaBadges personas={s.personas} /></td>
                      <td className="mono">{fmtH(s.eta_band?.p50)} / <b>{fmtH(s.eta_p85)}</b> / {fmtH(s.eta_band?.p95)}</td>
                      <td className="mono">{fmtMoney(s.cost)}</td>
                      <td><span className={`chip ${riskClass(s.threat)}`}>{fmtPct(s.threat)}</span></td>
                      <td>{s.mode}</td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="panel">
          {runs === null ? <div className="skeleton" style={{ height: 200, margin: 16 }} /> : !shown.length ? (
            <div className="empty"><History size={34} /><div>No saved runs yet — generate a route in the planner.</div></div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th style={{ width: 36 }}></th><th>Lane</th><th>Scenario</th><th>Options (ETA p85 · cost)</th><th>When</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id}>
                      <td><input type="checkbox" aria-label="Compare" checked={compare.includes(r.id)} onChange={() => toggleCompare(r.id)} style={{ accentColor: 'var(--accent)' }} /></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {r.watched && <Star size={14} fill="#f2a114" color="#f2a114" />}
                          <b>{r.origin} → {r.destination}</b>
                        </div>
                        <div className="muted" style={{ fontSize: 11.5 }}>{r.request.cargo_type} · {r.request.priority} · {r.request.transport_preference}</div>
                      </td>
                      <td>{r.scenario ? <span className="chip crit">{r.scenario}</span> : <span className="muted">normal</span>}</td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {r.summary.map((s, i) => (
                            <div key={i} style={{ fontSize: 12 }} className="mono">
                              <span className="dim">{s.personas.join('/').toLowerCase()}</span> · {fmtH(s.eta_p85)} · {fmtMoney(s.cost)}
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>{timeAgo(r.created_at)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn sm" onClick={() => onOpenRun(r.id, r.selected_index)} title="Open in planner"><ExternalLink size={13} /></button>{' '}
                        <button className={`btn sm ${r.watched ? 'on' : ''}`} title={r.watched ? 'Stop watching' : 'Watch'}
                          onClick={() => api.updateRun(r.id, { watched: !r.watched }).then(load)}><Star size={13} /></button>{' '}
                        <a className="btn sm" href={api.exportUrl(r.id, 'pdf', r.selected_index)} title="PDF report"><FileText size={13} /></a>{' '}
                        <a className="btn sm" href={api.exportUrl(r.id, 'csv', r.selected_index)} title="CSV audit"><FileDown size={13} /></a>{' '}
                        <button className="btn sm danger" title="Delete" onClick={() => api.deleteRun(r.id).then(load)}><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {compare.length === 1 && <div className="muted" style={{ fontSize: 12 }}>Tick one more run to compare side by side.</div>}
      </div>
    </div>
  );
}
