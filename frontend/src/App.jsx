import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Route, Factory, History, BellRing, Plug, X, AlertTriangle, Sun, Moon } from 'lucide-react';
import Planner from './views/Planner.jsx';
import SuppliersView from './views/SuppliersView.jsx';
import HistoryView from './views/HistoryView.jsx';
import AlertsView from './views/AlertsView.jsx';
import IntegrationsView from './views/IntegrationsView.jsx';
import { api, SEVERITY_COLOR } from './lib.js';

const TABS = [
  { id: 'planner', label: 'Plan a route', icon: Route },
  { id: 'alerts', label: 'Disruptions', icon: BellRing },
  { id: 'history', label: 'Saved routes', icon: History },
  { id: 'suppliers', label: 'Suppliers', icon: Factory },
  { id: 'integrations', label: 'Integrations', icon: Plug },
];

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('sc-theme') || 'light'; } catch { return 'light'; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#161a23' : '#ffffff');
    try { localStorage.setItem('sc-theme', theme); } catch { /* storage unavailable */ }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

function useLiveStatus(onAlerts) {
  const [status, setStatus] = useState(null);
  const [connected, setConnected] = useState(false);
  const cb = useRef(onAlerts);
  cb.current = onAlerts;

  useEffect(() => {
    let ws, retry, poll, closed = false, everOpened = false, failures = 0, lastAlert = null;

    // Fallback for hosts/proxies that block WebSockets: poll status + new alerts over HTTP.
    const startPolling = () => {
      const tick = async () => {
        try {
          const s = await api.status();
          const alerts = await api.alerts();
          const newest = alerts.reduce((m, a) => Math.max(m, a.id), 0);
          const fresh = lastAlert == null ? [] : alerts.filter((a) => a.id > lastAlert).reverse();
          lastAlert = newest;
          setStatus({ ...s, live_scenario: s.live_scenario && { id: s.live_scenario.id, name: s.live_scenario.name } });
          setConnected(true);
          if (fresh.length) cb.current(fresh);
        } catch { setConnected(false); }
      };
      tick();
      poll = setInterval(tick, 3000);
    };

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      ws.onopen = () => { everOpened = true; failures = 0; setConnected(true); };
      ws.onmessage = (e) => {
        const s = JSON.parse(e.data);
        setStatus(s);
        if (s.new_alerts?.length) cb.current(s.new_alerts);
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        failures += 1;
        if (!everOpened && failures >= 2) startPolling();
        else retry = setTimeout(connect, 2500);
      };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); clearInterval(poll); ws && ws.close(); };
  }, []);
  return { status, connected };
}

export default function App() {
  const [tab, setTab] = useState('planner');
  const [toasts, setToasts] = useState([]);
  const [openRun, setOpenRun] = useState(null); // {id, index} to load into the planner
  const [alertsVersion, setAlertsVersion] = useState(0);

  const pushAlerts = useCallback((alerts) => {
    setToasts((t) => [...alerts.map((a) => ({ ...a, key: `${a.id}-${Date.now()}` })), ...t].slice(0, 4));
    setAlertsVersion((v) => v + 1);
    alerts.forEach((a) => setTimeout(() => setToasts((t) => t.filter((x) => x.id !== a.id)), 12000));
  }, []);
  const { status, connected } = useLiveStatus(pushAlerts);
  const [theme, toggleTheme] = useTheme();

  const engine = status?.engine_status;
  const engineDot = !connected ? 'crit' : engine === 'FULLY OPERATIONAL' ? 'ok' : engine === 'WARM-UP FAILED' ? 'crit' : 'warn';
  const openInPlanner = (id, index = 0) => { setOpenRun({ id, index, nonce: Date.now() }); setTab('planner'); };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Route size={18} strokeWidth={2.4} /></div>
          <div><span className="name">Supplychainer</span><small>Smarter, disruption-aware shipping routes</small></div>
        </div>
        <nav className="nav" aria-label="Main">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} aria-current={tab === id}>
              <Icon size={15} /> <span className="lbl">{label}</span>
              {id === 'alerts' && status?.unacked_alerts > 0 && <span className="count">{status.unacked_alerts}</span>}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          {status?.live_scenario && (
            <button className="pill live" onClick={() => setTab('alerts')} title="A live disruption is active across the platform">
              <span className="dot crit" /> Live: {status.live_scenario.name}
            </button>
          )}
          <span className="pill engine" title={`Risk engine: ${engine || 'connecting'}${status?.nlp_ready ? ' · news analysis on' : ''}${status?.ml_trained ? ' · delay model loaded' : ''}`}>
            <span className={`dot ${engineDot}`} />
            {!connected ? 'Reconnecting…' : engine === 'FULLY OPERATIONAL' ? 'All systems ready' : engine === 'WARM-UP FAILED' ? 'Engine error' : 'Warming up…'}
          </span>
          <button className="theme-btn" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </header>

      <main className="view">
        {tab === 'planner' && <Planner openRun={openRun} liveScenario={status?.live_scenario} theme={theme} />}
        {tab === 'alerts' && <AlertsView version={alertsVersion} liveScenario={status?.live_scenario} onOpenRun={openInPlanner} />}
        {tab === 'history' && <HistoryView onOpenRun={openInPlanner} />}
        {tab === 'suppliers' && <SuppliersView />}
        {tab === 'integrations' && <IntegrationsView />}
      </main>

      <div className="toasts" aria-live="polite">
        {toasts.map((a) => (
          <div key={a.key} className="toast panel" style={{ borderLeftColor: SEVERITY_COLOR[a.severity] }}>
            <AlertTriangle size={18} color={SEVERITY_COLOR[a.severity]} />
            <div>
              <h5>{a.title}</h5>
              <p>{a.message}</p>
              {a.run_id && <button className="btn sm" style={{ marginTop: 8 }} onClick={() => openInPlanner(a.run_id, 0)}>Open route</button>}
            </div>
            <button className="icon-btn" style={{ width: 24, height: 24, border: 0, boxShadow: 'none' }} aria-label="Dismiss"
              onClick={() => setToasts((t) => t.filter((x) => x.key !== a.key))}><X size={13} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

