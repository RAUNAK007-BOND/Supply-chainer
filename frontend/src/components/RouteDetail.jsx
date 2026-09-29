import React, { useEffect, useState } from 'react';
import { Bell, BellOff, FileDown, FileText, Braces, Radar, Sparkles, ShieldAlert, Info, CornerDownRight, Snowflake } from 'lucide-react';
import { api, fmtH, fmtMoney, fmtPct, fmtSigned, fmtSignedMoney, riskClass, riskLabel, MODE_COLORS } from '../lib.js';
import { BandBar, ModeIcon, PersonaBadges, modeName } from './RouteBits.jsx';

const STACK = [
  ['transit', 'Travelling', MODE_COLORS.SEA], ['transfer', 'Loading & transfers', MODE_COLORS.TRANSFER],
  ['ml_buffer_p85', 'Predicted waiting time', '#8b5cf6'], ['scenario', 'Disruption', '#e5484d'], ['advisory', 'Seasonal delay', '#f2a114'],
];

function EtaComposition({ trace, total }) {
  return (
    <div>
      <div className="stack">
        {STACK.map(([k, , c]) => trace.eta[k] > 0 && <span key={k} style={{ width: `${(trace.eta[k] / total) * 100}%`, background: c }} title={`${k}: ${trace.eta[k]}h`} />)}
      </div>
      <div className="legend">
        {STACK.map(([k, label, c]) => trace.eta[k] > 0 && <span key={k}><i style={{ background: c }} />{label} <b className="mono">{fmtH(trace.eta[k])}</b></span>)}
      </div>
    </div>
  );
}

function ShapleyDrivers({ drivers }) {
  const max = Math.max(...drivers.contributions.map((c) => Math.abs(c.hours)), 1);
  return (
    <div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 10, lineHeight: 1.55 }}>
        The biggest wait is on <b style={{ color: 'var(--text)' }}>{drivers.leg}</b>. An average leg waits
        {' '}<b className="mono" style={{ color: 'var(--text)' }}>{drivers.base_value_h}h</b>; this one is predicted at
        {' '}<b className="mono" style={{ color: 'var(--text)' }}>{drivers.model_output_h}h</b>. Here is what adds or removes time:
      </div>
      {drivers.contributions.map((c) => (
        <div className="shap-row" key={c.feature}>
          <div className="f" title={`${c.feature} = ${c.value}`}>{c.feature}<small>{String(c.value)}</small></div>
          <div className="shap-bar">
            <span style={{
              left: c.hours >= 0 ? '50%' : `${50 - (Math.abs(c.hours) / max) * 50}%`,
              width: `${(Math.abs(c.hours) / max) * 50}%`,
              background: c.hours >= 0 ? '#e5484d' : '#10a37f',
            }} />
          </div>
          <div className={`mono ${c.hours >= 0 ? 'text-crit' : 'text-ok'}`} style={{ textAlign: 'right', fontWeight: 700 }}>{c.hours >= 0 ? '+' : ''}{c.hours.toFixed(1)}h</div>
        </div>
      ))}
      <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>Method: {drivers.method}</div>
    </div>
  );
}

function IntelScan({ route }) {
  const [state, setState] = useState({ loading: false, data: null, error: null });
  useEffect(() => setState({ loading: false, data: null, error: null }), [route]);
  const hubs = [...new Set(route.legs.filter((l) => l.type === 'transit').map((l) => l.to))]
    .filter((h) => h.startsWith('PORT') || h.startsWith('CHOKE') || h.startsWith('AIR')).slice(0, 6);
  const run = async () => {
    setState({ loading: true, data: null, error: null });
    try { setState({ loading: false, data: await api.intelScan(hubs, route.primary_mode === 'AIR' ? 'air' : 'sea'), error: null }); }
    catch (e) { setState({ loading: false, data: null, error: 'The news scan could not run. Check that the backend is online and try again.' }); }
  };
  return (
    <div>
      <div className="dim" style={{ fontSize: 13, marginBottom: 12, lineHeight: 1.55 }}>
        Check today’s headlines for the main ports and straits on this route. Each story is scored for how serious it is and whether it affects this kind of transport.
      </div>
      <button className="btn sm" onClick={run} disabled={state.loading}>
        {state.loading ? <span className="spinner light" /> : <Radar size={14} />} Check news for {hubs.length} stops
      </button>
      {state.error && <div className="error-box" style={{ marginTop: 10 }}>{state.error}</div>}
      {state.data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {state.data.results.map((r) => (
            <div className="intel-item" key={r.hub}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 13 }}>{r.name}</b>
                <span className={`chip ${riskClass(r.threat)}`}>{riskLabel(r.threat)} risk</span>
                {r.category !== 'none' && <span className="chip" style={{ textTransform: 'capitalize' }}>{r.category}</span>}
                <span className="chip" style={{ marginLeft: 'auto' }}>{r.source === 'LIVE' ? 'Live news' : r.source === 'CACHE' ? 'Recent news' : 'No feed'}</span>
              </div>
              {r.headlines.length ? <ul>{r.headlines.map((h, i) => <li key={i}>{h}</li>)}</ul>
                : <div className="muted" style={{ fontSize: 12.5 }}>No live news reachable right now, so no risk was added.</div>}
              <div className="muted" style={{ fontSize: 11.5 }}>Severity {r.semantic_score} · relevance: {r.carf.rule}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RouteDetail({ result, route, index, runId, watched, onToggleWatch, maxEta }) {
  const impact = route.scenario_impact;
  const exposed = route.exposed_disruptions || [];
  return (
    <>
      <div className="panel detail-hero">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <PersonaBadges personas={route.personas} />
          <span className="chip"><ModeIcon mode={route.primary_mode} size={13} /> {modeName(route.primary_mode)}</span>
          <span className={`chip ${riskClass(route.threat_level)}`}><ShieldAlert size={13} /> {riskLabel(route.threat_level)} risk</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div className="label" style={{ marginBottom: 6 }}>Expected arrival</div>
            <div className="hero-eta mono">{(route.adjusted_eta / 24).toFixed(1)} days<small>{Math.round(route.adjusted_eta)}h</small></div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="label" style={{ marginBottom: 6 }}>Total cost</div>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }} className="mono">{fmtMoney(route.total_cost)}</div>
          </div>
        </div>
        <BandBar band={route.eta_band} max={maxEta} />
        <div className="muted" style={{ fontSize: 12, marginTop: -6 }}>
          85% of shipments on this route arrive within the planned time; 1 in 20 may take up to the worst case.
        </div>
        <p className="explain">{route.explanation}</p>

        {impact && (
          <div className={`callout ${impact.rerouted ? 'info' : impact.delta_eta > 0 ? 'crit' : 'ok'}`}>
            <CornerDownRight size={16} style={{ flex: 'none', marginTop: 2 }} />
            <div>
              <b>{result.active_scenario}:</b>{' '}
              {impact.rerouted ? 'we found a way around it' : exposed.length ? 'there is no cheaper way around, so this option takes the delay' : 'this option is not affected'}.
              {' '}<b className="mono">{impact.delta_eta > 0 ? '+' : impact.delta_eta < 0 ? '−' : ''}{fmtH(Math.abs(impact.delta_eta))}</b> and <b className="mono">{fmtSignedMoney(impact.delta_cost)}</b> compared with a normal week
              ({fmtH(impact.normal_eta)}, {fmtMoney(impact.normal_cost)}).
              {impact.rerouted && <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>Usual route: {impact.normal_path.join(' → ')}</div>}
            </div>
          </div>
        )}
        {route.advisories?.length > 0 && (
          <div className="callout warn"><Snowflake size={16} style={{ flex: 'none' }} /> This route uses a seasonal Arctic lane, so extra waiting time is included.</div>
        )}

        <div className="actions">
          {runId && (
            <button className={`btn sm ${watched ? 'on' : ''}`} onClick={onToggleWatch} title="Get an alert if a disruption hits this route">
              {watched ? <Bell size={14} /> : <BellOff size={14} />} {watched ? 'Watching' : 'Watch this route'}
            </button>
          )}
          {runId && <a className="btn sm" href={api.exportUrl(runId, 'pdf', index)}><FileText size={14} /> PDF report</a>}
          {runId && <a className="btn sm" href={api.exportUrl(runId, 'csv', index)}><FileDown size={14} /> Spreadsheet</a>}
          {runId && <a className="btn sm" href={api.exportUrl(runId, 'tms', index)}><Braces size={14} /> TMS file</a>}
        </div>
      </div>

      <div className="panel card">
        <div className="section-title" style={{ marginTop: 0 }}>Where the time goes</div>
        <EtaComposition trace={route.audit_trace} total={route.adjusted_eta} />
        <div className="section-title">Where the money goes</div>
        <div className="legend" style={{ marginTop: 0 }}>
          <span><i style={{ background: MODE_COLORS.SEA }} />Freight <b className="mono">{fmtMoney(route.audit_trace.cost.transit)}</b></span>
          <span><i style={{ background: MODE_COLORS.TRANSFER }} />Handling <b className="mono">{fmtMoney(route.audit_trace.cost.transfer)}</b></span>
          {route.audit_trace.cost.scenario > 0 && <span><i style={{ background: '#e5484d' }} />Disruption surcharge <b className="mono">{fmtMoney(route.audit_trace.cost.scenario)}</b></span>}
        </div>
      </div>

      <div className="panel card">
        <div className="section-title" style={{ marginTop: 0 }}>Step by step</div>
        <div className="timeline">
          {route.legs.map((l, i) => l.type === 'transfer' ? (
            <div className="leg handoff" key={i}>
              <div className="leg-ico"><ModeIcon mode="TRANSFER" size={12} /></div>
              <div className="leg-main"><div className="leg-title">Transfer at {l.to_name} · {fmtH(l.eta)}</div></div>
              <div className="leg-right">{fmtMoney(l.cost)}</div>
            </div>
          ) : (
            <div className={`leg ${l.intel_source === 'SCENARIO' ? 'hit' : ''}`} key={i}>
              <div className="leg-ico"><ModeIcon mode={l.mode} /></div>
              <div className="leg-main">
                <div className="leg-title">{l.to_name}</div>
                <div className="leg-sub">
                  <span className={`mode-${l.mode}`} style={{ fontWeight: 700 }}>{modeName(l.mode)}</span>
                  <span>{Math.round(l.distance_km).toLocaleString()} km</span>
                  <span>{fmtH(l.eta)} travel</span>
                  {l.delay_band.p85 > 0 && <span title={`Typical ${l.delay_band.p50}h · planned ${l.delay_band.p85}h · worst case ${l.delay_band.p95}h`}>+ {fmtH(l.delay_band.p85)} waiting</span>}
                  {l.threat > 0 && <span className={`chip ${riskClass(l.threat)}`} style={{ padding: '1px 8px', textTransform: 'capitalize' }}>{l.threat_category}</span>}
                </div>
                {l.intel_source !== 'BASELINE' && <div className="leg-reason">{l.event_delay > 0 && <b>+{fmtH(l.event_delay)} · </b>}{l.reason}</div>}
              </div>
              <div className="leg-right">{fmtH(l.leg_total_p85)}<div className="muted">{fmtMoney(l.cost)}</div></div>
            </div>
          ))}
        </div>
      </div>

      {route.drivers && (
        <div className="panel card">
          <div className="section-title" style={{ marginTop: 0 }}><Sparkles size={15} /> Why this wait?</div>
          <ShapleyDrivers drivers={route.drivers} />
        </div>
      )}

      <div className="panel card">
        <div className="section-title" style={{ marginTop: 0 }}><Radar size={15} /> Latest news on this route</div>
        <IntelScan route={route} />
      </div>

      <div className="muted" style={{ fontSize: 11.5, display: 'flex', gap: 6, lineHeight: 1.5, padding: '0 4px 8px' }}>
        <Info size={13} style={{ flex: 'none', marginTop: 2 }} /> {result.engine?.band_note} Calculated in {result.engine?.solve_ms} ms.
      </div>
    </>
  );
}
