import React, { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Tooltip, useMap, Pane } from 'react-leaflet';
import { MODE_COLORS, PERSONA_COLORS, routePath, unwrap, fmtH, fmtMoney } from '../lib.js';

const svg = L.svg({ padding: 0.5 });
const MODES = ['sea', 'air', 'rail', 'road'];

function FitTo({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.flyToBounds(bounds, { padding: [60, 60], duration: 0.9, maxZoom: 6 });
  }, [bounds, map]);
  return null;
}

const pulseIcon = (kind) => L.divIcon({
  className: 'pulse-marker', iconSize: [14, 14], iconAnchor: [7, 7],
  html: `<span class="${kind === 'advisory' ? 'adv' : ''}"></span>`,
});

// Leaflet paints SVG/canvas attributes directly, so map colours are resolved per theme here.
const MAP_THEME = {
  light: { base: 'World_Light_Gray_Base', ref: 'World_Light_Gray_Reference', hub: '#7b8598', hubOpacity: 0.55, net: 0.3,
           chokeFill: '#ffffff', halo: '#ffffff', flow: '#ffffff', crit: '#e5484d', origin: '#3355ff', dest: '#0a8fd4', via: '#ffffff', viaStroke: '#151823' },
  dark: { base: 'World_Dark_Gray_Base', ref: 'World_Dark_Gray_Reference', hub: '#aab3c2', hubOpacity: 0.4, net: 0.2,
          chokeFill: '#161a23', halo: '#161a23', flow: '#ffffff', crit: '#ff6369', origin: '#6f8bff', dest: '#38b2f0', via: '#161a23', viaStroke: '#eef0f5' },
};

export default function MapView({ network, routes, selected, onSelect, disrupted = {}, advisories = [], banner, theme = 'light' }) {
  const T = MAP_THEME[theme] || MAP_THEME.light;
  const [layers, setLayers] = useState({ sea: true, air: false, rail: true, road: false, hubs: true });
  const hubIndex = useMemo(() => Object.fromEntries((network?.nodes || []).map((n) => [n.id, n])), [network]);

  const netLines = useMemo(() => {
    if (!network) return {};
    const out = { sea: [], air: [], rail: [], road: [] };
    for (const e of network.edges) {
      const a = hubIndex[e.source], b = hubIndex[e.target];
      if (!a || !b || !out[e.mode]) continue;
      out[e.mode].push(unwrap([[a.lat, a.lon], [b.lat, b.lon]]));
    }
    return out;
  }, [network, hubIndex]);

  const paths = useMemo(() => (routes || []).map((r) => routePath(r)), [routes]);
  const bounds = useMemo(() => {
    const segs = paths[selected];
    if (!segs?.length) return null;
    return L.latLngBounds(segs.flatMap((s) => s.pts));
  }, [paths, selected]);

  const selRoute = routes?.[selected];
  const routeHubs = useMemo(() => {
    if (!selRoute) return [];
    const seen = new Map();
    for (const l of selRoute.legs) {
      if (l.from_coords[0] != null && !seen.has(l.from)) seen.set(l.from, { id: l.from, name: l.from_name, c: l.from_coords });
      if (l.to_coords[0] != null && !seen.has(l.to)) seen.set(l.to, { id: l.to, name: l.to_name, c: l.to_coords });
    }
    return [...seen.values()];
  }, [selRoute]);

  return (
    <div className="map-wrap">
      <MapContainer center={[22, 40]} zoom={2.4} minZoom={2} worldCopyJump zoomSnap={0.25} preferCanvas attributionControl>
        <TileLayer key={`base-${theme}`}
          url={`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${T.base}/MapServer/tile/{z}/{y}/{x}`}
          attribution='Tiles &copy; <a href="https://www.esri.com/">Esri</a> — Esri, HERE, Garmin, &copy; OpenStreetMap contributors'
          maxZoom={16} />
        <TileLayer key={`ref-${theme}`} url={`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${T.ref}/MapServer/tile/{z}/{y}/{x}`}
          maxZoom={16} opacity={0.8} zIndex={650} />

        {MODES.map((m) => layers[m] && (netLines[m] || []).map((pts, i) => (
          <Polyline key={`${m}-${i}-${theme}`} positions={pts} interactive={false}
            pathOptions={{ color: MODE_COLORS[m], weight: 1, opacity: m === 'air' ? T.net * 0.5 : T.net }} />
        )))}

        {layers.hubs && network?.nodes.map((n) => {
          const isChoke = n.type === 'choke_point';
          return (
            <CircleMarker key={`${n.id}-${theme}`} center={[n.lat, n.lon]} radius={isChoke ? 4 : Math.max(1.6, (n.importance || 5) / 3)}
              pathOptions={{ color: isChoke ? '#e59a12' : T.hub, weight: isChoke ? 2 : 0, fillColor: isChoke ? T.chokeFill : T.hub,
                fillOpacity: isChoke ? 1 : T.hubOpacity }}>
              <Tooltip direction="top" offset={[0, -4]}>
                <b>{n.display_name}</b><br /><span className="muted">{n.country} · {n.type.replace('_', ' ')} · {n.modes.join(', ')}</span>
              </Tooltip>
            </CircleMarker>
          );
        })}

        <Pane name="routes" style={{ zIndex: 450 }}>
          {paths.map((segs, ri) => ri !== selected && segs.map(({ leg, pts }, i) => (
            <Polyline key={`alt-${ri}-${i}`} positions={pts} eventHandlers={{ click: () => onSelect?.(ri) }}
              pathOptions={{ renderer: svg, color: PERSONA_COLORS[routes[ri].persona], weight: 2.4, opacity: 0.6, dashArray: '5 8' }} />
          )))}
          {(paths[selected] || []).map(({ leg, pts }, i) => (
            <React.Fragment key={`sel-${i}-${theme}`}>
              <Polyline positions={pts} pathOptions={{ renderer: svg, color: T.halo, weight: 8, opacity: 0.9 }} />
              <Polyline positions={pts} pathOptions={{ renderer: svg, color: leg.intel_source === 'SCENARIO' ? T.crit : MODE_COLORS[leg.mode], weight: 4, opacity: 1 }}>
                <Tooltip sticky>
                  <b className={`mode-${leg.mode}`}>{leg.mode}</b> · {leg.from_name} → {leg.to_name}<br />
                  {Math.round(leg.distance_km).toLocaleString()} km · {fmtH(leg.eta)} travel + {fmtH(leg.delay_band.p85)} buffer · {fmtMoney(leg.cost)}
                </Tooltip>
              </Polyline>
              <Polyline positions={pts} interactive={false} pathOptions={{ renderer: svg, color: T.flow, weight: 1.5, opacity: 0.7, className: 'flow' }} />
            </React.Fragment>
          ))}
        </Pane>

        <Pane name="route-hubs" style={{ zIndex: 460 }}>
          {routeHubs.map((h, i) => (
            <CircleMarker key={`${h.id}-${theme}`} center={h.c} radius={i === 0 || i === routeHubs.length - 1 ? 7 : 4.5}
              pathOptions={{ renderer: svg, color: i === 0 || i === routeHubs.length - 1 ? T.halo : T.viaStroke, weight: 2.5,
                fillColor: i === 0 ? T.origin : i === routeHubs.length - 1 ? T.dest : T.via, fillOpacity: 1 }}>
              <Tooltip direction="top" offset={[0, -6]} permanent={i === 0 || i === routeHubs.length - 1}>{h.name}</Tooltip>
            </CircleMarker>
          ))}
        </Pane>

        {Object.entries(disrupted).map(([id, d]) => hubIndex[id] && (
          <Marker key={`d-${id}`} position={[hubIndex[id].lat, hubIndex[id].lon]} icon={pulseIcon('scenario')} zIndexOffset={1000}>
            <Tooltip direction="right" offset={[8, 0]}><b className="text-crit">{hubIndex[id].display_name}</b><br />{d.reason}</Tooltip>
          </Marker>
        ))}
        {advisories.map((id) => hubIndex[id] && !disrupted[id] && (
          <Marker key={`a-${id}`} position={[hubIndex[id].lat, hubIndex[id].lon]} icon={pulseIcon('advisory')} />
        ))}
        <FitTo bounds={bounds} />
      </MapContainer>

      {banner}

      <div className="map-overlay map-legend panel">
        <div className="lrow">
          {MODES.map((m) => (
            <label key={m} className="check" style={{ fontSize: 12 }}>
              <input type="checkbox" checked={layers[m]} onChange={(e) => setLayers({ ...layers, [m]: e.target.checked })} />
              <span className="sw" style={{ background: MODE_COLORS[m] }} />{m[0].toUpperCase() + m.slice(1)}
            </label>
          ))}
          <label className="check" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={layers.hubs} onChange={(e) => setLayers({ ...layers, hubs: e.target.checked })} /> Hubs
          </label>
        </div>
        <div className="lrow muted">
          <span><span className="sw" style={{ background: T.crit }} />Disrupted leg</span>
          <span><span className="sw" style={{ background: '#e59a12', height: 8, width: 8, borderRadius: 4 }} />Strait or canal</span>
          <span>Dashed lines: other options (click to switch)</span>
        </div>
      </div>
      {network && (
        <div className="map-overlay map-stats panel">
          <span><b>{network.nodes.length}</b>ports &amp; hubs</span>
          <span><b>{network.edges.length.toLocaleString()}</b>connections</span>
        </div>
      )}
    </div>
  );
}
