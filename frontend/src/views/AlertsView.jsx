import React, { useEffect, useState } from 'react';
import { Radio, CheckCheck, Bell, ExternalLink, ShieldOff, Siren } from 'lucide-react';
import { api, fmtH, fmtMoney, SEVERITY_COLOR, PERSONA_LABELS, riskClass, riskLabel, timeAgo } from '../lib.js';

const SEVERITY_TEXT = { critical: ['crit', 'Critical'], high: ['high', 'High'], medium: ['warn', 'Medium'] };

export default function AlertsView({ version, liveScenario, onOpenRun }) {
  const [scenarios, setScenarios] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [watchedCount, setWatchedCount] = useState(0);
  const [busy, setBusy] = useState(null);
  const [lastResult, setLastResult] = useState(null);

  const load = () => {
    api.alerts().then(setAlerts).catch(() => {});
    api.runs(true).then((r) => setWatchedCount(r.length)).catch(() => {});
  };
  const [names, setNames] = useState({});
  useEffect(() => {
    api.scenarios().then(setScenarios);
    api.network().then((n) => setNames(Object.fromEntries(n.nodes.map((h) => [h.id, h.display_name])))).catch(() => {});
  }, []);
  useEffect(load, [version]);

  const activate = async (id) => {
    setBusy(id ?? 'clear');
    try {
      const res = await api.setLiveScenario(id);
      setLastResult(id ? { name: res.scenario.name, n: res.alerts_raised.length } : null);
      load();
    } finally { setBusy(null); }
  };

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Disruptions</h1>
            <p>Turn on a disruption to see who it affects. Every route you’re <b>watching</b> that passes through the affected
              place gets an instant alert with a suggested new plan.</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span className="pill"><Bell size={14} /> Watching {watchedCount} route{watchedCount === 1 ? '' : 's'}</span>
            {liveScenario && <button className="btn danger" onClick={() => activate(null)} disabled={!!busy}><ShieldOff size={15} /> End disruption</button>}
          </div>
        </div>

        {lastResult && (
          <div className="callout info"><Siren size={16} style={{ flex: 'none' }} /> {lastResult.name} is now live. {lastResult.n} watched route{lastResult.n === 1 ? ' was' : 's were'} affected.
            {lastResult.n === 0 && watchedCount === 0 && ' Tip: plan a route and click “Watch this route” first.'}</div>
        )}

        <div className="grid-3">
          {scenarios.map((s) => {
            const live = liveScenario?.id === s.id;
            return (
              <div key={s.id} className={`scenario-card ${live ? 'live' : ''}`}>
                <h4>{s.name} {live && <span className="chip crit"><span className="dot crit" /> Live</span>}</h4>
                <p>{s.description}</p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span className="chip" style={{ textTransform: 'capitalize' }}>{s.category}</span>
                  <span className="chip">+{fmtH(s.delay_hours)} delay</span>
                  <span className={`chip ${riskClass(s.threat_level)}`}>{riskLabel(s.threat_level)} risk</span>
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}>Affects {s.affected_nodes.map((n) => names[n] || n).join(', ')}</div>
                <button className={`btn sm ${live ? '' : 'primary'}`} style={{ alignSelf: 'flex-start', marginTop: 4 }}
                  disabled={!!busy || live} onClick={() => activate(s.id)}>
                  {busy === s.id ? <span className="spinner" /> : <Radio size={14} />} {live ? 'Active now' : 'Go live'}
                </button>
              </div>
            );
          })}
        </div>

        <div className="panel">
          <div className="panel-h">
            <h2><Siren size={16} /> Alerts</h2>
            {alerts.some((a) => !a.acknowledged) && <button className="btn sm" onClick={() => api.ackAll().then(load)}><CheckCheck size={14} /> Mark all as read</button>}
          </div>
          {!alerts.length ? (
            <div className="empty"><Bell size={34} /><div>No alerts yet. Watch a route in the planner, then turn on a disruption here.</div></div>
          ) : alerts.map((a) => {
            const [sevCls, sevText] = SEVERITY_TEXT[a.severity] || ['warn', a.severity];
            const replan = a.payload?.replan;
            return (
            <div key={a.id} className={`alert-item ${a.acknowledged ? 'acked' : ''}`}>
              <div className="sev" style={{ background: SEVERITY_COLOR[a.severity] }} />
              <div>
                <h4>{a.title} <span className={`chip ${sevCls}`} style={{ marginLeft: 6 }}>{sevText}</span></h4>
                <p>{a.message}</p>
                {replan && (
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
                    Suggested {(PERSONA_LABELS[replan.persona] || replan.persona).toLowerCase()} route: {fmtH(replan.eta_p85)} · {fmtMoney(replan.total_cost)}
                    {replan.via?.length ? ` · via ${replan.via.slice(0, 5).join(' → ')}${replan.via.length > 5 ? '…' : ''}` : ''}
                  </div>
                )}
                <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>{timeAgo(a.created_at)}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {a.run_id && <button className="btn sm" onClick={() => onOpenRun(a.run_id)}><ExternalLink size={13} /> Open route</button>}
                {!a.acknowledged && <button className="btn sm ghost" onClick={() => api.ackAlert(a.id).then(load)}>Mark read</button>}
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
