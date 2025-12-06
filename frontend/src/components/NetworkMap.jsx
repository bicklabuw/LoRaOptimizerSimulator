import React, { useMemo, useRef, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Crosshair } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

// Fix Icons
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

const createCustomIcon = (color) => L.divIcon({
  className: 'custom-div-icon',
  html: `<div style="background-color: ${color}; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.4);"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7]
});

const Icons = {
  GENERATOR: createCustomIcon('#3b82f6'),
  RELAY: createCustomIcon('#10b981'),
  BASE_STATION: createCustomIcon('#ef4444')
};

// SVG Arrow points UP (0 deg)
const createArrowIcon = (color, angle) => L.divIcon({
    className: 'arrow-icon',
    html: `
      <div style="transform: rotate(${angle}deg); width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="${color}" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 22 22 12 18 2 22 12 2"></polygon>
        </svg>
      </div>
    `,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
});

const DraggableMarker = ({ node, onMove }) => {
  const markerRef = useRef(null);
  const eventHandlers = useMemo(() => ({
      drag(e) {
        const { lat, lng } = e.target.getLatLng();
        onMove(node.id, lat, lng);
      },
    }), [node.id, onMove]);

  return (
    <Marker
      draggable={true}
      eventHandlers={eventHandlers}
      position={[node.lat, node.lon]}
      icon={Icons[node.type]}
      ref={markerRef}
    >
      <Popup>
        <div className="text-sm">
            <strong>{node.name}</strong><br />
            <span className="text-gray-500">{node.type}</span><br/>
            <div className="text-xs mt-1 font-mono">{node.lat.toFixed(5)}, {node.lon.toFixed(5)}</div>
        </div>
      </Popup>
    </Marker>
  );
};

// --- Helpers ---
const RecenterControl = ({ nodes, doRecenter, setDoRecenter }) => {
    const map = useMap();
    useEffect(() => {
        if (doRecenter && nodes.length > 0) {
            const bounds = L.latLngBounds(nodes.map(n => [n.lat, n.lon]));
            map.flyToBounds(bounds, { padding: [50, 50], duration: 0.5 });
            setDoRecenter(false);
        }
    }, [doRecenter, nodes, map, setDoRecenter]);
    
    // Initial fit
    useEffect(() => {
        if (nodes.length > 0) {
            const bounds = L.latLngBounds(nodes.map(n => [n.lat, n.lon]));
            map.fitBounds(bounds, { padding: [50, 50], animate: false });
        }
    }, []);
    return null;
};

const ResizeMap = ({ isSidebarOpen }) => {
    const map = useMap();
    useEffect(() => {
        setTimeout(() => map.invalidateSize(), 300);
    }, [isSidebarOpen, map]);
    return null;
};

const NetworkMap = ({ 
  nodes, onNodeMove, activeLinks, ghostLinks, interferenceLinks
  mapMode, currentTime, isPlaying, isStale, viewMode, isSidebarOpen
}) => {
  const [doRecenter, setDoRecenter] = React.useState(false);

  // Recenter whenever the nodes array reference changes (new topology)
  useEffect(() => {
      setDoRecenter(true);
  }, [nodes.length]); 

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
    const x = Math.cos(lat1) * Math.sin(lat2) -
              Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
    const θ = Math.atan2(y, x);
    return (θ * 180 / Math.PI + 360) % 360; 
  };

  return (
    <div className="relative h-full w-full">
        {/* CSS to animate Map Fade and Fix Background */}
        <style>{`
            .leaflet-container {
                background: transparent !important; /* Allows dots to show through */
            }
            .leaflet-tile-pane {
                transition: opacity 0.5s ease-in-out;
                opacity: ${mapMode === 'on' ? 1 : 0};
            }
        `}</style>

        <MapContainer 
            center={center} 
            zoom={16} 
            style={{ height: '100%', width: '100%', background: 'transparent' }}
            zoomControl={false}
            attributionControl={false}
            preferCanvas={true} 
        >
            <RecenterControl nodes={nodes} doRecenter={doRecenter} setDoRecenter={setDoRecenter} />
            <ResizeMap isSidebarOpen={isSidebarOpen} />

            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

            {interferenceLinks && interferenceLinks.map((link, idx) => {
                const source = nodes.find(n => n.id === link.source_id);
                const target = nodes.find(n => n.id === link.target_id);
                if (!source || !target) return null;

                return (
                <Polyline 
                    key={`interf-${idx}`}
                    positions={[[source.lat, source.lon], [target.lat, target.lon]]}
                    pathOptions={{
                        color: '#d946ef', // Fuchsia-500
                        weight: 1,
                        opacity: 0.3,
                        dashArray: '2, 4'
                    }}
                    interactive={false} // Don't block clicks
                />
                );
            })}

            {ghostLinks.map((link, idx) => {
                const source = nodes.find(n => n.id === link.source_id);
                const target = nodes.find(n => n.id === link.target_id);
                if (!source || !target) return null;
                const isActive = !isStale && activeLinks.some(l => 
                    (l.source_id === link.source_id && l.target_id === link.target_id) ||
                    (l.source_id === link.target_id && l.target_id === link.source_id)
                );
                if (isActive) return null;

                return (
                <Polyline 
                    key={`ghost-${idx}`}
                    positions={[[source.lat, source.lon], [target.lat, target.lon]]}
                    pathOptions={{
                        color: getCapacityColor(link.capacity),
                        weight: 3,
                        opacity: mapMode === 'on' ? 0.9 : 0.6,
                        dashArray: '5, 8'
                    }}
                    interactive={true}
                >
                    <Tooltip sticky direction="top">
                        <div className="text-xs font-sans">
                            <strong>Potential Link</strong><br/>{link.capacity.toFixed(0)} bps
                        </div>
                    </Tooltip>
                </Polyline>
                );
            })}

            {!isStale && activeLinks.map((link, idx) => {
                const source = nodes.find(n => n.id === link.source_id);
                const target = nodes.find(n => n.id === link.target_id);
                if (!source || !target) return null;

                let isTransmitting = false;
                
                if (link.schedule && link.schedule.length > 0) {
                    for (const frag of link.schedule) {
                        const start = frag.start;
                        const end = start + frag.duration;
                        // Handle wraparound if needed, but usually linear 0-1
                        if (currentTime >= start && currentTime < end) {
                            isTransmitting = true;
                            break;
                        }
                    }
                }

                let color, opacity, weight;
                if (viewMode === 'capacity') {
                    color = getCapacityColor(link.capacity_bps);
                    opacity = 0.8;
                    weight = Math.max(3, link.airtime_fraction * 10);
                } else {
                    if (isTransmitting) {
                        color = '#fbbf24'; opacity = 1.0; weight = 6;
                    } else {
                        color = '#3b82f6'; opacity = isPlaying ? 0.15 : 0.6; weight = 3;
                    }
                }

                const midLat = (source.lat + target.lat) / 2;
                const midLon = (source.lon + target.lon) / 2;
                const bearing = getBearing(source.lat * Math.PI/180, source.lon * Math.PI/180, target.lat * Math.PI/180, target.lon * Math.PI/180);

                return (
                <React.Fragment key={`active-${idx}`}>
                    <Polyline positions={[[source.lat, source.lon], [target.lat, target.lon]]} pathOptions={{ color, weight, opacity }}>
                        <Tooltip sticky>
                            <div className="text-xs font-sans">
                                <div className="font-bold text-blue-600">Active Link</div>
                                <div>Ch: {link.channel}</div>
                                {/* Show Total Airtime */}
                                <div>Total Airtime: {(link.airtime_fraction*100).toFixed(1)}%</div>
                                <div>Frags: {link.schedule ? link.schedule.length : 0}</div>
                            </div>
                        </Tooltip>
                    </Polyline>
                    {(viewMode === 'capacity' || isTransmitting) && (
                        <Marker position={[midLat, midLon]} icon={createArrowIcon(color, bearing)} interactive={false} />
                    )}
                </React.Fragment>
                );
            })}

            {nodes.map(node => (
                <DraggableMarker key={node.id} node={node} onMove={onNodeMove} />
            ))}
        </MapContainer>

        <button 
            onClick={() => setDoRecenter(true)}
            className="absolute bottom-6 right-6 bg-white p-2 rounded shadow-lg hover:bg-gray-100 text-gray-700 z-[1000]"
            title="Fit to Screen"
        >
            <Crosshair size={24} />
        </button>
    </div>
  );
};

export default NetworkMap;