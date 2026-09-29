import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, Sparkles, SlidersHorizontal, Waypoints, Zap, AlertTriangle, Globe2 } from 'lucide-react';
import MapView from '../components/MapView.jsx';
import HubSearch from '../components/HubSearch.jsx';
import RouteDetail from '../components/RouteDetail.jsx';
import { OptionCard, ModeIcon } from '../components/RouteBits.jsx';
import { api, CARGO_TYPES, PRESETS } from '../lib.js';

const MODES = [['any', 'Any'], ['sea', 'Sea'], ['air', 'Air'], ['rail', 'Rail'], ['road', 'Road']];
const CHOKEPOINTS = ['CHOKE-SUEZ', 'CHOKE-BABEL', 'CHOKE-HORMUZ', 'CHOKE-MALACCA', 'CHOKE-PANAMA', 'CHOKE-CAPEGOOD', 'CHOKE-TAIWAN'];

export default function Planner({ openRun, liveScenario, theme }) {
  const [network, setNetwork] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [origin, setOrigin] = useState({ id: 'PORT-SHANGHAI', name: 'Port of Shanghai' });
  const [dest, setDest] = useState({ id: 'PORT-ROTTERDAM', name: 'Port of Rotterdam' });
  const [mode, setMode] = useState('any');
  const [policy, setPolicy] = useState('STRICT');
  const [cargo, setCargo] = useState('general');
  const [priority, setPriority] = useState('normal');
  const [scenario, setScenario] = useState('');
  const [avoid, setAvoid] = useState([]);
  const [costCeiling, setCostCeiling] = useState('');
  const [maxDays, setMaxDays] = useState('');
  const [seasonal, setSeasonal] = useState(false);

  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [watched, setWatched] = useState(false);
  const [watchNote, setWatchNote] = useState(null);

  useEffect(() => {
    api.network().then(setNetwork).catch(() => setError('We can’t reach the routing service. Start the backend (uvicorn on port 8000) and refresh.'));
    api.scenarios().then(setScenarios).catch(() => {});
  }, []);

  // Load a saved run (from History / an alert) into the planner.
  useEffect(() => {
    if (!openRun) return;
    api.run(openRun.id).then((run) => {
      const r = run.request;
      setOrigin({ id: r.source, name: r.source });
      setDest({ id: r.destination, name: r.destination });
      setMode(r.transport_preference || 'any'); setPolicy(r.routing_policy || 'STRICT');
      setCargo(r.cargo_type || 'general'); setPriority(r.priority || 'normal'); setScenario(r.scenario || '');
      setResult({ ...run.response, run_id: run.id });
      setSelected(openRun.index ?? run.selected_index ?? 0);
      setWatched(run.watched);
    }).catch((e) => setError(e.message));
  }, [openRun]);

  const nameOf = useMemo(() => Object.fromEntries((network?.nodes || []).map((n) => [n.id, n.display_name])), [network]);
  useEffect(() => { // prettify hub names after loading a run
    if (nameOf[origin.id] && origin.name === origin.id) setOrigin((o) => ({ ...o, name: nameOf[o.id] }));
    if (nameOf[dest.id] && dest.name === dest.id) setDest((d) => ({ ...d, name: nameOf[d.id] }));
  }, [nameOf, origin, dest]);

  const run = async (override = {}) => {
    const o = override.origin || origin, d = override.dest || dest;
    if (!o?.id || !d?.id) { setError('Choose where the shipment starts and where it’s going.'); return; }
    setLoading(true); setError(null); setWatchNote(null);
    const overrides = {};
    if (avoid.length) overrides.avoid_chokepoints = avoid;
    if (costCeiling) overrides.cost_ceiling = Number(costCeiling);
    if (maxDays) overrides.max_delay = Number(maxDays);
    if (seasonal) overrides.allow_seasonal_lanes = true;
    try {
      const data = await api.recommend({
        source: o.id, destination: d.id, transport_preference: mode, routing_policy: policy, cargo_type: cargo,
        priority, scenario: (override.scenario ?? scenario) || null, overrides,
      });
      if (data.error) { setError(data.error); setResult(null); }
      else {
        setResult(data);
        const bal = data.recommendations.findIndex((r) => r.personas.includes('BALANCED'));
        setSelected(bal >= 0 && (override.scenario ?? scenario) ? bal : 0);
        setWatched(false);
      }
    } catch (e) { setError('Couldn’t reach the routing service. Check that the backend is running, then try again.'); }
    finally { setLoading(false); }
  };

  const applyPreset = (p) => {
    const o = { id: p.source, name: p.sourceName }, d = { id: p.destination, name: p.destName };
    setOrigin(o); setDest(d); setScenario(p.scenario); setMode('any');
    run({ origin: o, dest: d, scenario: p.scenario });
  };

  const toggleWatch = async () => {
    if (!result?.run_id) return;
    const next = !watched;
    const res = await api.updateRun(result.run_id, { watched: next, selected_index: selected });
    setWatched(next);
    setWatchNote(next ? (res.alert ? `Heads up: ${res.alert.message}` : 'You’re watching this route. We’ll alert you if a disruption affects it.') : null);
  };
  useEffect(() => { // keep the watched option in sync with the selection
    if (watched && result?.run_id) api.updateRun(result.run_id, { selected_index: selected }).catch(() => {});
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const routes = result?.recommendations || [];
  const route = routes[selected];
  const maxEta = Math.max(...routes.map((r) => r.eta_band.p95), 1) * 1.05;

  const disrupted = useMemo(() => {
    const out = {};
    const add = (sid) => {
      const s = scenarios.find((x) => x.id === sid);
      s?.affected_nodes.forEach((n) => { out[n] = { reason: s.reason, name: s.name }; });
    };
    if (result?.request?.scenario) add(result.request.scenario);
    if (liveScenario?.id) add(liveScenario.id);
    return out;
  }, [scenarios, result, liveScenario]);

  const whatIf = scenarios.find((s) => s.id === result?.request?.scenario);
  const banner = (whatIf || liveScenario) && (
    <div className="map-overlay map-banner panel alert">
      <AlertTriangle size={16} style={{ flex: 'none' }} />
      <span>
        {whatIf ? <><b>Simulating:</b> {whatIf.name}. {whatIf.description}</> : null}
        {liveScenario && (!whatIf || whatIf.id !== liveScenario.id) ? <>{whatIf ? ' · ' : ''}<b>Live now:</b> {liveScenario.name}</> : null}
      </span>
    </div>
  );

  return (
    <div className={`planner ${route ? '' : 'no-detail'}`}>
      <aside className="side left">
        <div className="panel form-card">
          <div className="section-title" style={{ marginTop: 0 }}><Sparkles size={15} /> Try a sample trip</div>
          <div className="presets">
            {PRESETS.map((p) => <button key={p.label} className="chip click" onClick={() => applyPreset(p)}>{p.label}</button>)}
          </div>

          <div className="od">
            <HubSearch id="origin" label="From" value={origin} onSelect={setOrigin} placeholder="Search a port, airport or city" />
            <button className="icon-btn swap" title="Swap from and to" aria-label="Swap from and to"
              onClick={() => { setOrigin(dest); setDest(origin); }}><ArrowUpDown size={14} /></button>
            <HubSearch id="dest" label="To" value={dest} onSelect={setDest} placeholder="Search a port, airport or city" />
          </div>

          <div className="field">
            <span className="label">How should it travel?</span>
            <div className="seg" role="group" aria-label="Transport mode">
              {MODES.map(([id, label]) => (
                <button key={id} className={mode === id ? 'on' : ''} onClick={() => setMode(id)} aria-pressed={mode === id}>
                  {id !== 'any' && <ModeIcon mode={id.toUpperCase()} size={12} />}{label}
                </button>
              ))}
            </div>
          </div>
          {mode !== 'any' && (
            <div className="field">
              <span className="label">Other modes</span>
              <div className="seg">
                <button className={policy === 'STRICT' ? 'on' : ''} onClick={() => setPolicy('STRICT')}>Only this mode</button>
                <button className={policy === 'PREFERRED' ? 'on' : ''} onClick={() => setPolicy('PREFERRED')}>Prefer, allow others</button>
              </div>
            </div>
          )}

          <div className="row">
            <div className="field">
              <label htmlFor="cargo">What are you shipping?</label>
              <select id="cargo" className="select" value={cargo} onChange={(e) => setCargo(e.target.value)}>
                {CARGO_TYPES.map((c) => <option key={c.id} value={c.id}>{c.label} — {c.note}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <span className="label">How urgent is it?</span>
            <div className="seg">
              {['low', 'normal', 'urgent'].map((p) => <button key={p} className={priority === p ? 'on' : ''} onClick={() => setPriority(p)} style={{ textTransform: 'capitalize' }}>{p}</button>)}
            </div>
          </div>
          <div className="field">
            <label htmlFor="scenario">Simulate a disruption (optional)</label>
            <select id="scenario" className="select" value={scenario} onChange={(e) => setScenario(e.target.value)}
              style={scenario ? { borderColor: 'var(--crit)' } : undefined}>
              <option value="">None, a normal week</option>
              {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <details className="advanced">
            <summary><SlidersHorizontal size={14} /> More options</summary>
            <div className="field">
              <span className="label">Avoid these straits and canals</span>
              <div className="presets" style={{ marginBottom: 0 }}>
                {CHOKEPOINTS.map((c) => (
                  <button key={c} className={`chip click ${avoid.includes(c) ? 'on' : ''}`}
                    onClick={() => setAvoid((a) => a.includes(c) ? a.filter((x) => x !== c) : [...a, c])}>
                    {(nameOf[c] || c).replace('Strait of ', '').replace(' Strait', '')}
                  </button>
                ))}
              </div>
            </div>
            <div className="row">
              <div className="field"><label htmlFor="ceil">Budget limit ($)</label>
                <input id="ceil" className="input" type="number" min="0" value={costCeiling} onChange={(e) => setCostCeiling(e.target.value)} placeholder="No limit" /></div>
              <div className="field"><label htmlFor="maxd">Must arrive within (days)</label>
                <input id="maxd" className="input" type="number" min="1" value={maxDays} onChange={(e) => setMaxDays(e.target.value)} placeholder="Any" /></div>
            </div>
            <label className="check"><input type="checkbox" checked={seasonal} onChange={(e) => setSeasonal(e.target.checked)} /> Allow the seasonal Arctic sea route</label>
          </details>

          <button className="btn primary block" style={{ marginTop: 14, padding: '12px' }} onClick={() => run()} disabled={loading}>
            {loading ? <><span className="spinner" /> Finding routes…</> : <><Zap size={16} /> Find routes</>}
          </button>
          {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}
        </div>

        {routes.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="section-title" style={{ margin: '2px 2px 0' }}><Waypoints size={15} /> {routes.length} option{routes.length > 1 ? 's' : ''} found · pick one to see details</div>
            {routes.map((r, i) => <OptionCard key={i} route={r} selected={i === selected} onClick={() => setSelected(i)} maxEta={maxEta} />)}
          </div>
        )}
        {loading && !routes.length && [0, 1].map((i) => <div key={i} className="skeleton" style={{ height: 150 }} />)}
      </aside>

      <MapView network={network} routes={routes} selected={selected} onSelect={setSelected}
        disrupted={disrupted} advisories={route?.advisories || []} theme={theme}
        banner={<>
          {banner}
          {!routes.length && !loading && (
            <div className="map-overlay map-empty panel">
              <div className="hello"><Globe2 size={26} /></div>
              <h3>Where are you shipping today?</h3>
              <p>Choose where your cargo starts and ends, or try a sample trip. We’ll compare the fastest, best-value and most reliable routes, and warn you about anything that could slow them down.</p>
            </div>
          )}
        </>} />

      {route && (
        <aside className="side right">
          {watchNote && <div className="callout info" style={{ fontSize: 12.5 }}>{watchNote}</div>}
          <RouteDetail result={result} route={route} index={selected} runId={result.run_id} watched={watched}
            onToggleWatch={toggleWatch} maxEta={maxEta} />
        </aside>
      )}
    </div>
  );
}
