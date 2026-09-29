import React, { useEffect, useState } from 'react';
import { Factory, ShieldAlert, ArrowUp, ArrowDown, PackageCheck, AlertTriangle } from 'lucide-react';
import { api, fmtMoney } from '../lib.js';

const URGENCY = {
  CRITICAL: ['crit', 'var(--crit)', 'var(--crit-soft)', 'Urgent'],
  HIGH: ['high', 'var(--high)', 'var(--high-soft)', 'Needs attention'],
  LOW: ['ok', 'var(--ok)', 'var(--ok-soft)', 'All good'],
};

export default function SuppliersView() {
  const [categories, setCategories] = useState(['Electronics']);
  const [scenarios, setScenarios] = useState([]);
  const [form, setForm] = useState({ category: 'Electronics', current_inventory: 1000, safety_stock: 1500, demand_forecast: 800, scenario: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const [names, setNames] = useState({});
  useEffect(() => {
    api.supplierCategories().then(setCategories).catch(() => {});
    api.scenarios().then(setScenarios).catch(() => {});
    api.network().then((n) => setNames(Object.fromEntries(n.nodes.map((h) => [h.id, h.display_name])))).catch(() => {});
  }, []);
  const nm = (id) => names[id] || id;
  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      try { setData(await api.suppliers({ ...form, scenario: form.scenario || null })); } finally { setLoading(false); }
    }, 200);
    return () => clearTimeout(t);
  }, [form]);

  const num = (k) => (e) => setForm({ ...form, [k]: Math.max(0, parseInt(e.target.value || '0', 10)) });
  const advice = data?.advice;
  const [cls, color, soft, urgencyText] = URGENCY[advice?.urgency_level] || URGENCY.LOW;

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Suppliers</h1>
            <p>See which supplier to buy from right now. We weigh price, delivery time and reliability, and adjust for any
              disruption on each supplier’s shipping route. Pick a disruption to see how the ranking changes.</p>
          </div>
        </div>

        <div className="panel card">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div className="field"><label htmlFor="cat">Product category</label>
              <select id="cat" className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {categories.map((c) => <option key={c}>{c}</option>)}
              </select></div>
            <div className="field"><label htmlFor="inv">Stock on hand</label><input id="inv" className="input" type="number" value={form.current_inventory} onChange={num('current_inventory')} /></div>
            <div className="field"><label htmlFor="ss">Minimum stock to keep</label><input id="ss" className="input" type="number" value={form.safety_stock} onChange={num('safety_stock')} /></div>
            <div className="field"><label htmlFor="fc">Expected demand</label><input id="fc" className="input" type="number" value={form.demand_forecast} onChange={num('demand_forecast')} /></div>
            <div className="field"><label htmlFor="sc">Disruption</label>
              <select id="sc" className="select" value={form.scenario} onChange={(e) => setForm({ ...form, scenario: e.target.value })}>
                <option value="">None, a normal week</option>
                {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
          </div>
        </div>

        {advice && (
          <div className="panel card" style={{ borderColor: color }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div className="type-ico" style={{ width: 44, height: 44, borderRadius: 13, background: soft, color }}><ShieldAlert size={21} /></div>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <span className={`chip ${cls}`}>{urgencyText}</span>
                </div>
                <div style={{ fontSize: 17, fontWeight: 700 }}>{advice.recommendation}</div>
                <div className="dim" style={{ fontSize: 13.5, marginTop: 6 }}>
                  After expected demand you’ll have {advice.projected_inventory.toLocaleString()} units left
                  {advice.shortage_quantity > 0 && `, ${advice.shortage_quantity.toLocaleString()} short of your minimum`}.
                  {advice.recommended_supplier && <> Best supplier right now: <b style={{ color: 'var(--text)' }}>{advice.recommended_supplier.name}</b> ({advice.recommended_supplier.effective_lead_time} days).</>}
                </div>
                {advice.ranking_shift && <div className="callout warn" style={{ marginTop: 10 }}><AlertTriangle size={15} /> {advice.ranking_shift}</div>}
              </div>
            </div>
          </div>
        )}

        <div className="panel">
          <div className="panel-h"><h2><Factory size={16} /> Ranked suppliers {loading && <span className="spinner light" />}</h2></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Rank</th><th>Supplier</th><th>Unit price</th><th>Delivery time</th><th>Reliability</th><th>Disruption</th><th>Overall score</th></tr></thead>
              <tbody>
                {(data?.suppliers || []).map((s) => (
                  <tr key={s.id}>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                      <b>{s.rank}</b>{' '}
                      {s.rank_change > 0 && <span className="text-ok"><ArrowUp size={12} />{s.rank_change}</span>}
                      {s.rank_change < 0 && <span className="text-crit"><ArrowDown size={12} />{-s.rank_change}</span>}
                    </td>
                    <td><b>{s.name}</b><div className="muted" style={{ fontSize: 12 }}>{nm(s.location_hub)}{s.transit_choke_points?.length ? ` · via ${s.transit_choke_points.map(nm).join(', ')}` : ''}</div></td>
                    <td className="mono">{fmtMoney(s.unit_cost)}</td>
                    <td className="mono">{s.effective_lead_time} days
                      {s.audit_trace.penalties.lead_time_impact > 0 && <div className="text-crit" style={{ fontSize: 11.5 }}>+{s.audit_trace.penalties.lead_time_impact} days delay</div>}</td>
                    <td>
                      <div className="bar" style={{ width: 90 }}><span style={{ width: `${s.audit_trace.scores.reliability * 100}%`, background: s.audit_trace.scores.reliability > 0.85 ? 'var(--ok)' : s.audit_trace.scores.reliability > 0.7 ? 'var(--warn)' : 'var(--crit)' }} /></div>
                      <div className="muted mono" style={{ fontSize: 11.5, marginTop: 3 }}>{Math.round(s.audit_trace.scores.reliability * 100)}%</div>
                    </td>
                    <td>{s.exposed_to.length ? s.exposed_to.map((n) => <span key={n} className="chip crit" style={{ marginRight: 4 }}>{nm(n)}</span>) : <span className="chip ok"><PackageCheck size={12} /> Not affected</span>}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className="bar" style={{ width: 90 }}><span style={{ width: `${s.decision_score * 100}%`, background: 'var(--accent)' }} /></div>
                        <span className="mono">{s.decision_score.toFixed(2)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
