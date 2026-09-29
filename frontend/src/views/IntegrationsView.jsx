import React, { useEffect, useState } from 'react';
import { Webhook, Plus, Trash2, Send, Brain, Braces, BookOpen } from 'lucide-react';
import { api } from '../lib.js';

const EVENTS = ['alert.created', 'scenario.activated', 'scenario.cleared', 'route.planned'];

const SAMPLE = `{
  "schema": "supplychainer.shipment_plan.v1",
  "plan_id": "3f2a9c1b7e44-1",
  "planned_departure": "2026-10-01T09:00:00Z",
  "eta": { "p50": "…", "p85": "…", "p95": "…" },
  "total_cost": { "amount": 3928.94, "currency": "USD" },
  "risk": { "peak_threat": 0.0, "exposed_disruptions": [], "scenario": "SUEZ_BLOCK" },
  "legs": [
    { "sequence": 1, "mode": "SEA", "movement": "TRANSIT",
      "from": { "hub_id": "PORT-SHANGHAI", "lat": 31.23, "lon": 121.49 },
      "to":   { "hub_id": "PORT-COLOMBO", … },
      "planned_departure": "…", "planned_arrival_p85": "…",
      "transit_hours": 188.2, "dwell_buffer_hours": { "p50": 18.1, "p85": 27.4, "p95": 36.0 },
      "cost": { "amount": 948.1, "currency": "USD" },
      "risk": { "threat": 0.0, "category": "none", "source": "BASELINE" } }
  ]
}`;

const WEBHOOK_SAMPLE = `POST <your-url>
X-Supplychainer-Event: alert.created
X-Supplychainer-Signature: sha256=<HMAC-SHA256(secret, raw body)>

{ "event": "alert.created", "sent_at": "…",
  "data": { "severity": "critical", "title": "Suez Canal Blockage: watched route exposed",
            "payload": { "affected_hubs": ["CHOKE-SUEZ"], "replan": { "eta_p85": 769.0, "rerouted": true, … } } } }`;

export default function IntegrationsView() {
  const [hooks, setHooks] = useState([]);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState(['alert.created', 'scenario.activated']);
  const [created, setCreated] = useState(null);
  const [test, setTest] = useState(null);
  const [model, setModel] = useState(null);
  const [error, setError] = useState(null);

  const load = () => api.webhooks().then(setHooks).catch(() => {});
  useEffect(() => { load(); api.model().then(setModel).catch(() => {}); }, []);

  const add = async () => {
    setError(null);
    try { const h = await api.addWebhook(url, events); setCreated(h); setUrl(''); load(); }
    catch (e) { setError(e.message.includes('public demo') ? 'Webhooks are turned off on this public demo.' : 'Enter a valid http(s) URL.'); }
  };

  const importance = model?.feature_importance_p85 ? Object.entries(model.feature_importance_p85).sort((a, b) => b[1] - a[1]) : [];

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Integrations</h1>
            <p>Connect Supplychainer to your other systems. Send alerts to any URL, export shipment plans your TMS or ERP can read,
              and see how the delay model behind every arrival time performs.</p>
          </div>
        </div>

        <div className="grid-2">
          <div className="panel card">
            <div className="section-title" style={{ marginTop: 0 }}><Webhook size={13} /> Webhook subscriptions</div>
            <div className="field">
              <label htmlFor="hook">Endpoint URL</label>
              <input id="hook" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://tms.example.com/hooks/supplychainer" />
            </div>
            <div className="presets">
              {EVENTS.map((ev) => (
                <button key={ev} className={`chip click ${events.includes(ev) ? 'on' : ''}`}
                  onClick={() => setEvents((e) => e.includes(ev) ? e.filter((x) => x !== ev) : [...e, ev])}>{ev}</button>
              ))}
            </div>
            <div className="actions">
              <button className="btn primary sm" onClick={add} disabled={!url}><Plus size={14} /> Add webhook</button>
              <button className="btn sm" onClick={async () => setTest(await api.testWebhooks())} disabled={!hooks.length}><Send size={14} /> Send test ping</button>
            </div>
            {error && <div className="error-box" style={{ marginTop: 10 }}>{error}</div>}
            {created && <div className="callout ok" style={{ marginTop: 10, display: 'block' }}>Signing secret (shown once): <span className="mono" style={{ wordBreak: 'break-all' }}>{created.secret}</span></div>}
            {test && <div className="callout info" style={{ marginTop: 10, display: 'block' }}>{test.deliveries.map((d) => <div key={d.webhook_id} className="mono" style={{ fontSize: 12 }}>{d.webhook_id}: {d.status}</div>)}</div>}
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {hooks.map((h) => (
                <div key={h.id} className="intel-item" style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mono" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.url}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{h.events.join(', ')} · last: {h.last_status || 'never sent'}</div>
                  </div>
                  <button className="btn sm danger" onClick={() => api.deleteWebhook(h.id).then(load)} aria-label="Delete webhook"><Trash2 size={13} /></button>
                </div>
              ))}
              {!hooks.length && <div className="muted" style={{ fontSize: 12.5 }}>No webhooks yet.</div>}
            </div>
            <div className="section-title">Delivery format</div>
            <div className="code">{WEBHOOK_SAMPLE}</div>
          </div>

          <div className="panel card">
            <div className="section-title" style={{ marginTop: 0 }}><Brain size={13} /> Model card — quantile delay model</div>
            {model ? (
              <>
                <div className="grid-3" style={{ gap: 10 }}>
                  {['p50', 'p85', 'p95'].map((q) => (
                    <div key={q} className="panel stat" style={{ boxShadow: 'none' }}>
                      <div className="k">{q} hold-out coverage</div>
                      <div className="v mono">{model.holdout_coverage?.[q] ? `${(model.holdout_coverage[q].empirical_test_coverage * 100).toFixed(1)}%` : '—'}</div>
                      <div className="muted" style={{ fontSize: 11 }}>target {q.slice(1)}%</div>
                    </div>
                  ))}
                </div>
                <div className="section-title">Global feature importance (p85)</div>
                {importance.map(([f, v]) => (
                  <div key={f} className="shap-row" style={{ gridTemplateColumns: '170px 1fr 50px' }}>
                    <div className="f">{f}</div>
                    <div className="bar"><span style={{ width: `${v * 100}%`, background: 'var(--accent)' }} /></div>
                    <div className="mono" style={{ textAlign: 'right' }}>{(v * 100).toFixed(1)}%</div>
                  </div>
                ))}
                <div className="section-title">Per-mode calibration (historical p5 floor / cap)</div>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Mode</th><th>Floor</th><th>Cap</th><th>Observed p95</th></tr></thead>
                    <tbody>{Object.entries(model.calibration_profiles || {}).map(([m, p]) => (
                      <tr key={m}><td style={{ textTransform: 'uppercase' }}>{m}</td><td className="mono">{p.floor}h</td><td className="mono">{p.cap}h</td><td className="mono">{p.p95_observed}h</td></tr>
                    ))}</tbody>
                  </table>
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 10, lineHeight: 1.5 }}>
                  GradientBoosting quantile regressors (400 trees, depth 6) on the seeded 50k-row anchor dataset; p50/p95 trained with identical
                  hyper-parameters and encoders as the shipped p85 model (reproduced bit-for-bit). Per-route explanations use exact Shapley values.
                </div>
              </>
            ) : <div className="skeleton" style={{ height: 240 }} />}
          </div>
        </div>

        <div className="panel card">
          <div className="section-title" style={{ marginTop: 0 }}><Braces size={13} /> TMS / ERP export — supplychainer.shipment_plan.v1</div>
          <p className="dim" style={{ fontSize: 13, marginBottom: 10, lineHeight: 1.5 }}>
            <span className="mono">GET /api/runs/&#123;run_id&#125;/export?format=tms&amp;index=N</span> returns a self-contained shipment plan with absolute
            planned timestamps per leg (p85 plan) and the p50/p95 arrival envelope. CSV (<span className="mono">format=csv</span>) and a boardroom PDF
            (<span className="mono">format=pdf</span>) are also available from any route.
          </p>
          <div className="code">{SAMPLE}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
            <BookOpen size={13} /> Full OpenAPI reference at <a href="/docs" style={{ color: 'var(--accent)' }}>/docs</a>
          </div>
        </div>
      </div>
    </div>
  );
}
