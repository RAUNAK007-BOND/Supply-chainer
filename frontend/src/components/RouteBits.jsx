import React from 'react';
import { Ship, Plane, TrainFront, Truck, ArrowLeftRight, Shuffle } from 'lucide-react';
import { MODE_COLORS, PERSONA_LABELS, fmtH, fmtMoney, riskClass, riskLabel } from '../lib.js';

const MODE_NAMES = { SEA: 'Sea', AIR: 'Air', RAIL: 'Rail', ROAD: 'Road', MULTIMODAL: 'Mixed modes' };

export function ModeIcon({ mode, size = 14 }) {
  const Icon = { SEA: Ship, AIR: Plane, RAIL: TrainFront, ROAD: Truck, TRANSFER: ArrowLeftRight, MULTIMODAL: Shuffle }[mode] || Truck;
  return <Icon size={size} color={MODE_COLORS[mode] || 'currentColor'} />;
}

export const modeName = (m) => MODE_NAMES[m] || m;

export function PersonaBadges({ personas }) {
  return personas.map((p) => <span key={p} className={`badge ${p}`}>{PERSONA_LABELS[p] || p}</span>);
}

// Typical (p50) to worst-case (p95) arrival range, with the planned (p85) marker, on a scale shared across options.
export function BandBar({ band, max, showLabels = true }) {
  const pct = (v) => `${Math.min(100, (v / max) * 100)}%`;
  return (
    <div>
      <div className="band" role="img" aria-label={`Arrival range: typical ${fmtH(band.p50)}, planned ${fmtH(band.p85)}, worst case ${fmtH(band.p95)}`}>
        <div className="track" />
        <div className="range" style={{ left: pct(band.p50), width: `calc(${pct(band.p95)} - ${pct(band.p50)})` }} />
        <div className="mark" style={{ left: pct(band.p85) }} />
      </div>
      {showLabels && (
        <div className="band-labels">
          <span>Typical <b>{fmtH(band.p50)}</b></span>
          <span>Planned <b>{fmtH(band.p85)}</b></span>
          <span>Worst case <b>{fmtH(band.p95)}</b></span>
        </div>
      )}
    </div>
  );
}

export function ModeStrip({ mix }) {
  const total = Object.values(mix || {}).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="mode-strip" title={Object.entries(mix || {}).map(([m, km]) => `${modeName(m)} ${Math.round(km).toLocaleString()} km`).join(' · ')}>
      {Object.entries(mix || {}).map(([m, km]) => <span key={m} style={{ width: `${(km / total) * 100}%`, background: MODE_COLORS[m] }} />)}
    </div>
  );
}

export function RiskValue({ threat }) {
  const cls = riskClass(threat);
  return <span className={cls === 'ok' ? 'text-ok' : cls === 'crit' || cls === 'high' ? 'text-crit' : 'text-warn'}>{riskLabel(threat)}</span>;
}

export function OptionCard({ route, selected, onClick, maxEta }) {
  const impact = route.scenario_impact;
  return (
    <button className={`option ${selected ? 'sel' : ''}`} onClick={onClick} aria-pressed={selected}>
      <div className="option-top">
        <PersonaBadges personas={route.personas} />
        <span className="chip" style={{ marginLeft: 'auto' }}><ModeIcon mode={route.primary_mode} size={13} /> {modeName(route.primary_mode)}</span>
      </div>
      <div className="kpis">
        <div className="kpi"><div className="v mono">{fmtH(route.adjusted_eta)}</div><div className="k">Arrival</div></div>
        <div className="kpi"><div className="v mono">{fmtMoney(route.total_cost)}</div><div className="k">Total cost</div></div>
        <div className="kpi"><div className="v"><RiskValue threat={route.threat_level} /></div><div className="k">Risk</div></div>
      </div>
      <BandBar band={route.eta_band} max={maxEta} showLabels={false} />
      <ModeStrip mix={route.mode_mix} />
      {impact && (impact.rerouted || impact.delta_eta !== 0) && (
        <div style={{ fontSize: 12.5 }} className="dim">
          {impact.rerouted ? '↻ Rerouted around the disruption · ' : 'Same route · '}
          <span className={`mono ${impact.delta_eta > 0 ? 'text-crit' : 'text-ok'}`} style={{ fontWeight: 700 }}>
            {impact.delta_eta > 0 ? '+' : ''}{fmtH(impact.delta_eta)}
          </span>{' '}vs a normal week
        </div>
      )}
    </button>
  );
}
