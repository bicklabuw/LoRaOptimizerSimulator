import React, { useMemo, useRef, useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Crosshair, Edit2 } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import iconMarker from 'leaflet/dist/images/marker-icon.png';
import iconRetina from 'leaflet/dist/images/marker-icon-2x.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl: iconMarker,
  iconRetinaUrl: iconRetina,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

const createCustomIcon = (color, isLarge) => L.divIcon({
  className: 'custom-div-icon',
  html: `
    <div style="
        background-color: ${color}; 
        width: ${isLarge ? 18 : 14}px; 
        height: ${isLarge ? 18 : 14}px; 
        border-radius: 50%; 
        border: ${isLarge ? '3px' : '2px'} solid white; 
        box-shadow: 0 2px 4px rgba(0,0,0,0.4);
        transition: width 0.1s, height 0.1s; 
    "></div>`,
  iconSize: [isLarge ? 18 : 14, isLarge ? 18 : 14],
  iconAnchor: [isLarge ? 9 : 7, isLarge ? 9 : 7]
});

const createArrowIcon = (color, angle) => L.divIcon({
    className: 'arrow-icon',
    html: `
      <div style="transform: rotate(${angle}deg); width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="${color}" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 22 22 12 18 2 22 12 2"></polygon>
        </svg>
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
});

const DraggableMarker = ({ node, onMove, hoveredNodeId, setHoveredNodeId }) => {
  const markerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const isLarge = (hoveredNodeId === node.id) || isDragging;

  const icon = useMemo(() => {
     let color = '#3b82f6';
     if (node.type === 'RELAY') color = '#10b981';
     if (node.type === 'BASE_STATION') color = '#ef4444';
     return createCustomIcon(color, isLarge);
  }, [node.type, isLarge]);

  const eventHandlers = useMemo(() => ({
      dragstart() { setIsDragging(true); setHoveredNodeId(node.id); },
      drag(e) { const { lat, lng } = e.target.getLatLng(); onMove(node.id, lat, lng); },
      dragend(e) { setIsDragging(false); const { lat, lng } = e.target.getLatLng(); onMove(node.id, lat, lng); setHoveredNodeId(null); },
      mouseover(e) { if(!isDragging) { e.target.openTooltip(); setHoveredNodeId(node.id); } },
      mouseout(e) { if(!isDragging) { setHoveredNodeId(null); } }
    }), [node.id, onMove, setHoveredNodeId, isDragging]);

  return (
    <Marker
      draggable={true}
      eventHandlers={eventHandlers}
      position={[node.lat, node.lon]}
      icon={icon}
      ref={markerRef}
      zIndexOffset={isLarge ? 1000 : 0}
      autoPan={true}
    >
      <Tooltip direction="top" offset={[0, -10]} opacity={0.9}>
         <div className="font-sans text-xs"><span className="font-bold">{node.name}</span> <span className="text-gray-400">#{node.id}</span></div>
      </Tooltip>
      <Popup>
        <div className="text-sm min-w-[150px] pt-1 pr-4">
            <div className="flex justify-between items-center mb-1 border-b pb-1">
                <strong>{node.name}</strong>
                <span className="text-xs bg-gray-100 rounded px-1 text-gray-500">#{node.id}</span>
            </div>
            <div className="text-gray-600 text-xs mb-1">{node.type}</div>
            <div className="font-mono text-[10px] text-gray-400">{node.lat.toFixed(5)}, {node.lon.toFixed(5)}</div>
        </div>
      </Popup>
    </Marker>
  );
};

const RecenterControl = ({ nodes, doRecenter, setDoRecenter }) => {
    const map = useMap();
    useEffect(() => {
        if (doRecenter && nodes.length > 0) {
            const bounds = L.latLngBounds(nodes.map(n => [n.lat, n.lon]));
            map.flyToBounds(bounds, { padding: [50, 50], duration: 0.8 });
            setDoRecenter(false);
        }
    }, [doRecenter, nodes, map, setDoRecenter]);
    return null;
};

const NetworkMap = ({ 
  nodes, onNodeMove, activeLinks, ghostLinks, 
  linkOverrides, onOverrideLink,
  mapMode, currentTime, isPlaying, isStale, viewMode, 
  darkMode, hoveredNodeId, setHoveredNodeId,
  showPotentialLinks, showOverrideLinks
}) => {
  const [doRecenter, setDoRecenter] = React.useState(false);
  useEffect(() => { setDoRecenter(true); }, [nodes.length]); 

  const groupedLinks = useMemo(() => {
      const groups = {};
      if (isStale) return groups;
      activeLinks.forEach(link => {
          const id1 = Math.min(link.source_id, link.target_id);
          const id2 = Math.max(link.source_id, link.target_id);
          const key = `${id1}-${id2}`;
          if (!groups[key]) groups[key] = { id1, id2, forward: null, reverse: null };
          if (link.source_id === id1) groups[key].forward = link;
          else groups[key].reverse = link;
      });
      return groups;
  }, [activeLinks, isStale]);

  const center = useMemo(() => {
    if (nodes.length === 0) return [43.0731, -89.4012];
    const lat = nodes.reduce((sum, n) => sum + n.lat, 0) / nodes.length;
    const lon = nodes.reduce((sum, n) => sum + n.lon, 0) / nodes.length;
    return [lat, lon];
  }, [nodes.length]); 

  const getCapacityColor = (bps) => {
    if (bps >= 5400) return '#10b981'; 
    if (bps >= 1700) return '#f59e0b'; 
    return '#ef4444'; 
  };

  const getBearing = (lat1, lon1, lat2, lon2) => {
    const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
    return ((Math.atan2(y, x) * 180 / Math.PI + 360) % 360); 
  };

  return (
    <div className="relative h-full w-full">
        <style>{`
            .leaflet-container { background: transparent !important; }
            .leaflet-tile-pane { transition: opacity 0.5s ease-in-out; opacity: ${mapMode === 'on' ? 1 : 0}; }
            .leaflet-popup-content-wrapper { border-radius: 8px; }
            .leaflet-popup-close-button {
                opacity: 1 !important; 
                width: 24px !important; height: 24px !important;
                display: flex; align-items: center; justify-content: center;
                top: 4px !important; right: 4px !important;
                color: #64748b !important;
                font-size: 18px !important;
                border-radius: 50%;
                transition: background 0.2s;
            }
            .leaflet-popup-close-button:hover { background-color: rgba(0,0,0,0.05); color: #ef4444 !important; }
            .leaflet-interactive { cursor: pointer; }
        `}</style>

        <MapContainer center={center} zoom={16} style={{ height: '100%', width: '100%', background: 'transparent' }} zoomControl={false} attributionControl={false} preferCanvas={true}>
            <RecenterControl nodes={nodes} doRecenter={doRecenter} setDoRecenter={setDoRecenter} />
            {darkMode ? <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" /> : <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />}

            {/* Ghost Links Layer */}
            {ghostLinks.map((link) => {
                const n1 = nodes.find(n => n.id === link.source_id);
                const n2 = nodes.find(n => n.id === link.target_id);
                if(!n1 || !n2) return null;
                
                // Hide ghost if active link exists
                const isActive = groupedLinks[`${Math.min(n1.id,n2.id)}-${Math.max(n1.id,n2.id)}`];
                if(isActive) return null;

                const color = getCapacityColor(link.capacity);
                const override = linkOverrides.find(o => (o.source_id === n1.id && o.target_id === n2.id) || (o.source_id === n2.id && o.target_id === n1.id));
                const isOverridden = !!override;

                // FILTERING LOGIC
                if (isOverridden && !showOverrideLinks) return null;
                if (!isOverridden && !showPotentialLinks) return null;

                return (
                    <Polyline 
                        key={`ghost-${n1.id}-${n2.id}`} 
                        positions={[[n1.lat, n1.lon], [n2.lat, n2.lon]]} 
                        pathOptions={{ 
                            color: isOverridden ? '#d946ef' : color, // Purple for overrides
                            weight: 5, 
                            dashArray: isOverridden ? '8, 8' : '6, 6', 
                            opacity: 0.6 
                        }}
                        eventHandlers={{
                            mouseover: (e) => {
                                e.target.setStyle({ weight: 8, opacity: 0.9 });
                                e.target.openTooltip();
                            },
                            mouseout: (e) => {
                                e.target.setStyle({ weight: 5, opacity: 0.6 });
                            }
                        }}
                    >
                         <Tooltip sticky>
                            <div className="text-xs font-sans min-w-[150px]">
                                <div className="font-bold border-b pb-1 mb-1 text-gray-500 flex justify-between items-center">
                                    <span>Potential Link</span>
                                    {isOverridden && <span className="text-[9px] bg-purple-100 text-purple-600 px-1 rounded uppercase tracking-wider">Overridden</span>}
                                </div>
                                <div className="flex justify-between gap-4"><span>Est. Capacity:</span><span className="font-mono" style={{color}}>{link.capacity} bps</span></div>
                                <div className="flex justify-between gap-4"><span>Distance:</span><span className="font-mono">{Math.round(link.distance)}m</span></div>
                                {isOverridden && (
                                    <div className="flex justify-between gap-4 mt-1 pt-1 border-t border-gray-100">
                                        <span className="text-purple-500">Forced:</span>
                                        <span className="font-mono font-bold text-purple-600">{override.capacity_bps} bps</span>
                                    </div>
                                )}
                            </div>
                        </Tooltip>
                        <Popup minWidth={220}>
                            <div className="p-1 pt-2 pr-4">
                                <h4 className="font-bold text-sm mb-2 flex items-center gap-2"><Edit2 size={12}/> Configure Potential Link</h4>
                                <div className="bg-gray-50 p-2 rounded border border-gray-100 mb-2">
                                    <div className="text-xs text-gray-500 mb-1 flex justify-between">
                                        <span>Capacity (Bidirectional)</span>
                                        <span className="font-mono">{link.capacity} bps</span>
                                    </div>
                                    <input type="number" placeholder={`Auto (${link.capacity})`} className="w-full text-xs border rounded px-1 py-1"
                                        defaultValue={override?.capacity_bps || ''}
                                        onBlur={(e) => { 
                                            onOverrideLink(n1.id, n2.id, e.target.value); 
                                            onOverrideLink(n2.id, n1.id, e.target.value); 
                                        }}
                                    />
                                </div>
                                <div className="text-[10px] text-gray-500 italic border-t pt-1 mt-1 leading-tight">
                                    Set <b>0</b> to disable link.<br/>Clear input to return to <b>Auto</b>.
                                </div>
                            </div>
                        </Popup>
                    </Polyline>
                )
            })}

            {/* Active Links */}
            {!isStale && Object.values(groupedLinks).map((group) => {
                const node1 = nodes.find(n => n.id === group.id1);
                const node2 = nodes.find(n => n.id === group.id2);
                if (!node1 || !node2) return null;

                let activeTx = null; 
                const checkSched = (link, from, to) => {
                    if (!link?.schedule) return null;
                    for (const frag of link.schedule) {
                        if (currentTime >= frag.start && currentTime < (frag.start + frag.duration)) {
                            const isAck = frag.is_ack === true || frag.type === 'ACK' || frag.duration < 0.005; 
                            return { from, to, isAck };
                        }
                    }
                    return null;
                };
                const fwdTx = checkSched(group.forward, node1, node2);
                const revTx = checkSched(group.reverse, node2, node1);
                if (fwdTx) activeTx = fwdTx;
                if (revTx) activeTx = revTx;

                let color = '#3b82f6';
                let weight = 3;
                let opacity = isPlaying ? 0.2 : 0.6;
                let dashArray = null;
                const isOverridden = linkOverrides.some(o => (o.source_id === group.id1 && o.target_id === group.id2) || (o.source_id === group.id2 && o.target_id === group.id1));
                if (isOverridden) dashArray = '4, 4';

                if (viewMode === 'capacity') {
                    const maxCap = Math.max(group.forward?.capacity_bps || 0, group.reverse?.capacity_bps || 0);
                    color = getCapacityColor(maxCap);
                    opacity = 0.8; weight = 6; 
                } else if (activeTx) {
                    if (activeTx.isAck) { color = '#d946ef'; weight = 5; opacity = 1.0; } 
                    else { color = '#eab308'; weight = 6; opacity = 1.0; }
                }

                const midLat = (node1.lat + node2.lat) / 2;
                const midLon = (node1.lon + node2.lon) / 2;

                return (
                    <React.Fragment key={`link-${group.id1}-${group.id2}`}>
                        <Polyline positions={[[node1.lat, node1.lon], [node2.lat, node2.lon]]} pathOptions={{ color, weight, opacity, dashArray }} eventHandlers={{ mouseover: (e) => e.target.openTooltip() }}>
                            <Tooltip sticky>
                                <div className="text-xs font-sans min-w-[200px]">
                                    <div className="font-bold border-b pb-1 mb-1">Link {group.id1} ↔ {group.id2}</div>
                                    <div className="grid grid-cols-[30px_1fr] gap-x-2 gap-y-1">
                                        <span className="text-gray-500 font-bold">Dir</span><span className="text-gray-500 font-mono text-right">Cap / Airtime</span>
                                        <span className="text-blue-600">Fwd</span><span className="font-mono text-right">{group.forward?.capacity_bps || 0}bps / {((group.forward?.airtime_fraction||0)*100).toFixed(1)}%</span>
                                        <span className="text-blue-600">Rev</span><span className="font-mono text-right">{group.reverse?.capacity_bps || 0}bps / {((group.reverse?.airtime_fraction||0)*100).toFixed(1)}%</span>
                                    </div>
                                </div>
                            </Tooltip>
                            <Popup minWidth={220}>
                                <div className="p-1 pt-2 pr-4">
                                    <h4 className="font-bold text-sm mb-2 flex items-center gap-2"><Edit2 size={12}/> Link Configuration</h4>
                                    <div className="space-y-3">
                                        <div className="bg-gray-50 p-2 rounded border border-gray-100">
                                            <div className="text-xs font-bold text-gray-700 mb-1 flex justify-between"><span>{node1.name} → {node2.name}</span> <span className="text-gray-400 font-normal">Cur: {group.forward?.capacity_bps}</span></div>
                                            <input type="number" placeholder={`Override (Cur: ${group.forward?.capacity_bps})`} className="w-full text-xs border rounded px-1 py-1"
                                                defaultValue={linkOverrides.find(l => l.source_id === node1.id && l.target_id === node2.id)?.capacity_bps || ''}
                                                onBlur={(e) => onOverrideLink(node1.id, node2.id, e.target.value)}
                                            />
                                        </div>
                                        <div className="bg-gray-50 p-2 rounded border border-gray-100">
                                            <div className="text-xs font-bold text-gray-700 mb-1 flex justify-between"><span>{node2.name} → {node1.name}</span> <span className="text-gray-400 font-normal">Cur: {group.reverse?.capacity_bps}</span></div>
                                            <input type="number" placeholder={`Override (Cur: ${group.reverse?.capacity_bps})`} className="w-full text-xs border rounded px-1 py-1"
                                                defaultValue={linkOverrides.find(l => l.source_id === node2.id && l.target_id === node1.id)?.capacity_bps || ''}
                                                onBlur={(e) => onOverrideLink(node2.id, node1.id, e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <div className="text-[10px] text-gray-500 italic border-t pt-1 mt-2 leading-tight">
                                        Set <b>0</b> to disable link.<br/>Clear input to return to <b>Auto</b>.
                                    </div>
                                </div>
                            </Popup>
                        </Polyline>
                        {(viewMode === 'tdma' && activeTx) && (
                            <Marker position={[midLat, midLon]} icon={createArrowIcon(color, getBearing(activeTx.from.lat * Math.PI/180, activeTx.from.lon * Math.PI/180, activeTx.to.lat * Math.PI/180, activeTx.to.lon * Math.PI/180))} interactive={false} />
                        )}
                    </React.Fragment>
                );
            })}

            {nodes.map(node => (
                <DraggableMarker key={node.id} node={node} onMove={onNodeMove} hoveredNodeId={hoveredNodeId} setHoveredNodeId={setHoveredNodeId} />
            ))}
        </MapContainer>
        <button onClick={() => setDoRecenter(true)} className="absolute bottom-6 right-6 bg-white dark:bg-gray-700 dark:text-white p-2 rounded shadow-lg hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 z-[1000]" title="Fit to Screen"><Crosshair size={24} /></button>
    </div>
  );
};

export default NetworkMap;