// Shared API client, formatting helpers and design constants.

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail ? JSON.stringify(data.detail) : `HTTP ${res.status}`);
  return data;
}

export const api = {
  status: () => request('/api/status'),
  network: () => request('/api/network'),
  scenarios: () => request('/api/scenarios'),
  searchHubs: (q) => request(`/api/hubs/search?q=${encodeURIComponent(q)}&limit=12`),
  recommend: (body) => request('/api/recommend', { method: 'POST', body }),
  runs: (watched = false) => request(`/api/runs?limit=100${watched ? '&watched=true' : ''}`),
  run: (id) => request(`/api/runs/${id}`),
  updateRun: (id, body) => request(`/api/runs/${id}`, { method: 'PATCH', body }),
  deleteRun: (id) => request(`/api/runs/${id}`, { method: 'DELETE' }),
  exportUrl: (id, format, index = 0) => `/api/runs/${id}/export?format=${format}&index=${index}`,
  liveScenario: () => request('/api/scenarios/live'),
  setLiveScenario: (scenario_id) => request('/api/scenarios/live', { method: 'POST', body: { scenario_id } }),
  alerts: () => request('/api/alerts'),
  ackAlert: (id) => request(`/api/alerts/${id}/ack`, { method: 'POST' }),
  ackAll: () => request('/api/alerts/ack-all', { method: 'POST' }),
  webhooks: () => request('/api/webhooks'),
  addWebhook: (url, events) => request('/api/webhooks', { method: 'POST', body: { url, events } }),
  deleteWebhook: (id) => request(`/api/webhooks/${id}`, { method: 'DELETE' }),
  testWebhooks: () => request('/api/webhooks/test', { method: 'POST' }),
  intelScan: (hubs, mode) => request('/api/intel/scan', { method: 'POST', body: { hubs, mode } }),
  model: () => request('/api/model'),
  suppliers: (body) => request('/api/suppliers', { method: 'POST', body }),
  supplierCategories: () => request('/api/suppliers/categories'),
};

// Mid-tone colours that read on both the light and the dark theme (icons, map lines, strips).
export const MODE_COLORS = {
  SEA: '#1597d8', AIR: '#8b5cf6', RAIL: '#e59a12', ROAD: '#14a594', TRANSFER: '#8a94a6',
  sea: '#1597d8', air: '#8b5cf6', rail: '#e59a12', road: '#14a594', transfer: '#8a94a6',
};

export const PERSONA_COLORS = { FASTEST: '#e59a12', BALANCED: '#3355ff', SAFEST: '#10a37f' };
export const PERSONA_LABELS = { FASTEST: 'Fastest', BALANCED: 'Best value', SAFEST: 'Most reliable' };

export const CARGO_TYPES = [
  { id: 'general', label: 'General cargo', note: 'All modes' },
  { id: 'perishable_urgent', label: 'Perishable / urgent', note: 'No sea legs' },
  { id: 'hazardous_waste', label: 'Hazardous', note: 'No air legs' },
  { id: 'oversize_heavy', label: 'Oversize / heavy', note: 'No long-haul road' },
];

export const PRESETS = [
  { label: 'Shanghai → Rotterdam', source: 'PORT-SHANGHAI', sourceName: 'Port of Shanghai', destination: 'PORT-ROTTERDAM', destName: 'Port of Rotterdam', scenario: 'SUEZ_BLOCK' },
  { label: 'Mumbai → Hamburg', source: 'PORT-MUMBAI', sourceName: 'Mumbai Port', destination: 'PORT-HAMBURG', destName: 'Port of Hamburg', scenario: 'RED_SEA_CONFLICT' },
  { label: 'Shenzhen → Los Angeles', source: 'PORT-SHENZHEN', sourceName: 'Port of Shenzhen', destination: 'HUB-LOSANGELES', destName: 'Los Angeles Logistics Hub', scenario: 'LA_PORT_STRIKE' },
];

export const fmtH = (h) => (h == null ? '—' : h >= 48 ? `${(h / 24).toFixed(1)}d` : `${Math.round(h)}h`);
export const fmtHours = (h) => (h == null ? '—' : `${Math.round(h).toLocaleString()}h`);
export const fmtMoney = (v) => {
  if (v == null) return '—';
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e4) return `$${(v / 1e3).toFixed(1)}k`;
  return `$${Math.round(v).toLocaleString()}`;
};
export const fmtPct = (x) => `${Math.round((x || 0) * 100)}%`;
export const fmtSigned = (v, unit = 'h') => `${v > 0 ? '+' : ''}${Math.round(v).toLocaleString()}${unit}`;
export const fmtSignedMoney = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtMoney(Math.abs(v))}`;
export const timeAgo = (ts) => {
  const s = Math.max(1, Math.round(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(ts * 1000).toLocaleDateString();
};

export const riskClass = (t) => (t >= 0.85 ? 'crit' : t >= 0.6 ? 'high' : t >= 0.3 ? 'warn' : 'ok');
export const riskColor = (t) => ({ crit: '#e5484d', high: '#f06a1c', warn: '#f2a114', ok: '#10a37f' })[riskClass(t)];
export const riskLabel = (t) => ({ crit: 'Severe', high: 'High', warn: 'Moderate', ok: 'Low' })[riskClass(t)];
export const SEVERITY_COLOR = { critical: '#e5484d', high: '#f06a1c', medium: '#f2a114' };

// Great-circle interpolation so long sea/air legs render as arcs, with longitudes unwrapped
// so trans-Pacific legs cross the antimeridian instead of wrapping around the globe.
export function arc(from, to, segments = 24) {
  const toRad = (d) => (d * Math.PI) / 180, toDeg = (r) => (r * 180) / Math.PI;
  const [lat1, lon1, lat2, lon2] = [toRad(from[0]), toRad(from[1]), toRad(to[0]), toRad(to[1])];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2));
  if (d < 0.02) return [from, to];
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    pts.push([toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))]);
  }
  return pts;
}

export function unwrap(points, startLon = null) {
  const out = [];
  let prev = startLon;
  for (const [lat, lon] of points) {
    let l = lon;
    if (prev != null) {
      while (l - prev > 180) l -= 360;
      while (l - prev < -180) l += 360;
    }
    out.push([lat, l]);
    prev = l;
  }
  return out;
}

export function routePath(route) {
  // One continuous polyline per transit leg, unwrapped relative to the previous leg.
  const segs = [];
  let lastLon = null;
  for (const leg of route.legs) {
    if (leg.type !== 'transit' || leg.from_coords[0] == null) continue;
    const curved = leg.mode === 'SEA' || leg.mode === 'AIR';
    const pts = unwrap(curved ? arc(leg.from_coords, leg.to_coords) : [leg.from_coords, leg.to_coords], lastLon);
    lastLon = pts[pts.length - 1][1];
    segs.push({ leg, pts });
  }
  return segs;
}
