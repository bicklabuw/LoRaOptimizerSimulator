import React, { useState, useEffect, useMemo } from 'react';
import NetworkMap from './components/NetworkMap';
import ControlPanel from './components/ControlPanel';
import { optimizeNetwork } from './api';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const INITIAL_NODES = [
  { id: 1, name: 'Gen A', type: 'GENERATOR', lat: 43.0745, lon: -89.4012 },
  { id: 2, name: 'Gen B', type: 'GENERATOR', lat: 43.0720, lon: -89.3980 },
  { id: 3, name: 'Relay 1', type: 'RELAY', lat: 43.0730, lon: -89.4000 },
  { id: 4, name: 'Sink', type: 'BASE_STATION', lat: 43.0715, lon: -89.4015 },
];

const INITIAL_CONFIG = {
  frequency_hz: 915000000,
  tx_power_dbm: 22.0,
  enable_pass_2_sparsification: true,
  use_map_data: true
};

function App() {
  const [nodes, setNodes] = useState(INITIAL_NODES);
  const [config, setConfig] = useState(INITIAL_CONFIG);
  const [linkOverrides, setLinkOverrides] = useState([]); 
  const [result, setResult] = useState(null);
  const [scheduledLinks, setScheduledLinks] = useState([]); 
  
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [mapMode, setMapMode] = useState('on'); 
  const [showGhostLinks, setShowGhostLinks] = useState(true);
  const [showCliques, setShowCliques] = useState(false); // NEW STATE
  const [isStale, setIsStale] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  const [currentTime, setCurrentTime] = useState(0); 
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0); 
  const [viewMode, setViewMode] = useState('tdma'); 

  useEffect(() => {
    let animationFrame;
    if (isPlaying) {
      const loop = () => {
        setCurrentTime(prev => {
          const next = prev + (0.0015 * playbackSpeed);
          return next > 1.0 ? 0 : next; 
        });
        animationFrame = requestAnimationFrame(loop);
      };
      animationFrame = requestAnimationFrame(loop);
    }
    return () => cancelAnimationFrame(animationFrame);
  }, [isPlaying, playbackSpeed]);

  const getDistanceMeters = (n1, n2) => {
    const R = 6371e3; 
    const φ1 = n1.lat * Math.PI/180;
    const φ2 = n2.lat * Math.PI/180;
    const Δφ = (n2.lat-n1.lat) * Math.PI/180;
    const Δλ = (n2.lon-n1.lon) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const getEstimatedCapacity = (dist) => {
    // Max comms range approx 2000m
    if (dist > 2000) return 0;
    if (dist > 1000) return 300; 
    if (dist > 500) return 1700;
    return 5400; 
  };

  // 1. Ghost Links (Potential Comms)
  const ghostLinks = useMemo(() => {
    if (!showGhostLinks) return [];
    const links = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const n1 = nodes[i];
        const n2 = nodes[j];
        const dist = getDistanceMeters(n1, n2);
        const cap = getEstimatedCapacity(dist);
        if (cap > 0) { 
          links.push({ 
            source_id: n1.id, target_id: n2.id, capacity: cap, distance: dist
          });
        }
      }
    }
    return links;
  }, [nodes, showGhostLinks]);

  // 2. Interference Links (Potential Collisions)
  // Logic: Interference Range is typically ~1.5x Communication Range
  const interferenceLinks = useMemo(() => {
    if (!showCliques) return [];
    const links = [];
    const MAX_COMMS_RANGE = 2000;
    const INTERFERENCE_RANGE = MAX_COMMS_RANGE * 1.5; // 3000m

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const n1 = nodes[i];
        const n2 = nodes[j];
        const dist = getDistanceMeters(n1, n2);
        
        // If within interference range
        if (dist < INTERFERENCE_RANGE) { 
          links.push({ 
            source_id: n1.id, target_id: n2.id, distance: dist
          });
        }
      }
    }
    return links;
  }, [nodes, showCliques]);

  const handleRunOptimization = async () => {
    setIsOptimizing(true);
    try {
      const data = await optimizeNetwork(nodes, config, linkOverrides);
      if (data.status !== "Optimal") {
        alert(`Optimization Failed: ${data.status}`);
      } else {
        setResult(data);
        // data.active_links contains the backend schedule
        setScheduledLinks(data.active_links);
        
        setIsStale(false);
        setCurrentTime(0);
        setIsPlaying(true);
      }
    } catch (err) {
      console.error(err);
      alert("Backend Error: Check console.");
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleNodeMove = (id, newLat, newLon) => {
    setIsStale(true); 
    setNodes(prev => prev.map(n => 
      n.id === id ? { ...n, lat: newLat, lon: newLon } : n
    ));
  };

  return (
    <div className="flex h-screen w-screen font-sans text-gray-800 overflow-hidden relative">
      <div 
        className={`absolute left-0 top-0 h-full bg-white shadow-2xl z-[2000] transition-transform duration-300 ease-in-out ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <ControlPanel 
          nodes={nodes}
          setNodes={setNodes}
          config={config}
          setConfig={setConfig}
          linkOverrides={linkOverrides}
          setLinkOverrides={setLinkOverrides}
          onRun={handleRunOptimization}
          isOptimizing={isOptimizing}
          result={result}
          mapMode={mapMode}
          setMapMode={setMapMode}
          showGhostLinks={showGhostLinks}
          setShowGhostLinks={setShowGhostLinks}
          showCliques={showCliques}       // NEW
          setShowCliques={setShowCliques} // NEW
          playback={{ isPlaying, setIsPlaying, currentTime, setCurrentTime, playbackSpeed, setPlaybackSpeed }}
          viewMode={viewMode}
          setViewMode={setViewMode}
          isStale={isStale}
          setIsStale={setIsStale}
        />
        
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="absolute top-4 -right-10 bg-white p-2 rounded-r-md shadow-md border-y border-r border-gray-200 text-gray-600 hover:text-blue-600 flex items-center justify-center"
          title={isSidebarOpen ? "Collapse Sidebar" : "Expand Sidebar"}
        >
          {isSidebarOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
        </button>
      </div>

      <div className={`flex-1 h-full w-full relative transition-all duration-300 ${isSidebarOpen ? 'pl-80' : 'pl-0'}`}>
        <div className="w-full h-full relative bg-slate-50">
          
          {/* Abstract Grid Background */}
          <div className={`absolute inset-0 pointer-events-none z-0 transition-opacity duration-500 ${mapMode === 'off' ? 'opacity-100' : 'opacity-0'}`}
               style={{ 
                 backgroundColor: '#f1f5f9',
                 backgroundImage: 'radial-gradient(#94a3b8 1px, transparent 1px)',
                 backgroundSize: '20px 20px'
               }} 
          />

          <div className="absolute inset-0 z-10">
            <NetworkMap 
                nodes={nodes} 
                onNodeMove={handleNodeMove}
                activeLinks={scheduledLinks} 
                ghostLinks={ghostLinks}
                interferenceLinks={interferenceLinks} // NEW
                mapMode={mapMode}
                currentTime={currentTime}
                isPlaying={isPlaying}
                isStale={isStale}
                viewMode={viewMode}
                isSidebarOpen={isSidebarOpen}
                showCliques={showCliques} // NEW
            />
          </div>

          <div className="absolute top-4 right-4 bg-white/95 p-4 rounded-lg shadow-xl z-20 backdrop-blur border border-gray-200 min-w-[220px] pointer-events-none">
              <h3 className="font-bold text-xs text-gray-400 uppercase tracking-wider mb-2 flex justify-between items-center">
                Network Status
                {isStale && <span className="text-yellow-600 bg-yellow-100 px-1.5 py-0.5 rounded text-[10px] font-bold">CHANGED</span>}
              </h3>
              {result ? (
                <div className={`space-y-1 ${isStale ? 'opacity-50 grayscale' : ''}`}>
                   <div className="text-2xl font-bold text-blue-600 flex items-baseline gap-1">
                     {result.total_throughput.toFixed(0)} <span className="text-sm font-normal text-gray-500">bps</span>
                   </div>
                   <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 mt-2">
                     <div>
                       <div className="uppercase text-[10px] tracking-wider">Fair Rate</div>
                       <div className="font-medium text-gray-700">{result.fair_rate.toFixed(0)} bps</div>
                     </div>
                     <div>
                       <div className="uppercase text-[10px] tracking-wider">Latency</div>
                       <div className="font-medium text-gray-700">~{(1/result.fair_rate * 8 * 1000).toFixed(0)} ms</div>
                     </div>
                   </div>
                </div>
              ) : (
                <div className="text-sm text-gray-400 italic py-2">
                  {isOptimizing ? "Calculating..." : "Ready to Optimize"}
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;