import React, { useState, useEffect, useMemo } from 'react';
import NetworkMap from './components/NetworkMap';
import ControlPanel from './components/ControlPanel';
import ScheduleTimeline from './components/ScheduleTimeline';
import { optimizeNetwork } from './api';
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';

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
    if (dist > 2000) return 0;
    if (dist > 1000) return 300; 
    if (dist > 500) return 1700;
    return 5400; 
};

function App() {
  const [nodes, setNodes] = useState(INITIAL_NODES);
  const [config, setConfig] = useState(INITIAL_CONFIG);
  const [linkOverrides, setLinkOverrides] = useState([]); 
  const [result, setResult] = useState(null);
  const [scheduledLinks, setScheduledLinks] = useState([]); 
  
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [mapMode, setMapMode] = useState('on'); 
  
  const [showPotentialLinks, setShowPotentialLinks] = useState(true);
  const [showOverrideLinks, setShowOverrideLinks] = useState(true);
  
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);

  const [isStale, setIsStale] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [darkMode, setDarkMode] = useState(false); 
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [hoveredLinkKey, setHoveredLinkKey] = useState(null);
  
  const [currentTime, setCurrentTime] = useState(0); 
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0); 
  const [viewMode, setViewMode] = useState('tdma'); 

  // --- Dynamic Frame Duration Logic ---
  const frameDurationMs = result?.schedule_diagnostics?.frame_ticks || 10000;
  const hasOverflow = result?.schedule_diagnostics?.had_overflow || false;

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Updated Animation Loop
  useEffect(() => {
    let animationFrame;
    let lastTime = performance.now();

    if (isPlaying) {
      const loop = (now) => {
        const deltaMs = now - lastTime;
        lastTime = now;
        
        // Calculate step size: (Time Passed * Speed) / Total Duration
        const step = (deltaMs * playbackSpeed) / frameDurationMs;

        setCurrentTime(prev => {
          const next = prev + step;
          return next > 1.0 ? 0 : next; 
        });
        animationFrame = requestAnimationFrame(loop);
      };
      animationFrame = requestAnimationFrame(loop);
    }
    return () => cancelAnimationFrame(animationFrame);
  }, [isPlaying, playbackSpeed, frameDurationMs]);

  const handleLinkOverride = (sourceId, targetId, cap) => {
    setLinkOverrides(prev => {
      const filtered = prev.filter(l => !(l.source_id === sourceId && l.target_id === targetId));
      if (cap === null || cap === "") return filtered;
      return [...filtered, { source_id: sourceId, target_id: targetId, capacity_bps: parseInt(cap) }];
    });
    setIsStale(true);
  };

  const ghostLinks = useMemo(() => {
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
  }, [nodes]);

  const handleRunOptimization = async () => {
    setIsOptimizing(true);
    try {
      const data = await optimizeNetwork(nodes, config, linkOverrides);
      if (data.status !== "Optimal") {
        alert(`Optimization Failed: ${data.status}`);
      } else {
        setResult(data);
        setScheduledLinks(data.active_links);
        setIsStale(false);
        setCurrentTime(0);
        setIsPlaying(true);
        setIsTimelineOpen(true);
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
    <div className={`flex h-screen w-screen font-sans overflow-hidden relative transition-colors duration-500`}>
      <div 
        style={{ height: isTimelineOpen ? 'calc(100% - 300px)' : 'calc(100% - 40px)' }}
        className={`absolute left-0 top-0 shadow-2xl z-[2000] transition-all duration-300 ease-in-out ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } ${darkMode ? 'bg-gray-900 border-r border-gray-700' : 'bg-white border-r border-gray-200'}`}
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
          showPotentialLinks={showPotentialLinks}
          setShowPotentialLinks={setShowPotentialLinks}
          showOverrideLinks={showOverrideLinks}
          setShowOverrideLinks={setShowOverrideLinks}
          playback={{ isPlaying, setIsPlaying, currentTime, setCurrentTime, playbackSpeed, setPlaybackSpeed }}
          viewMode={viewMode}
          setViewMode={setViewMode}
          isStale={isStale}
          setIsStale={setIsStale}
          darkMode={darkMode}
          setDarkMode={setDarkMode}
          hoveredNodeId={hoveredNodeId}
          setHoveredNodeId={setHoveredNodeId}
          frameDurationMs={frameDurationMs} // Passed down
        />
        
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className={`absolute top-4 -right-10 p-2 rounded-r-md shadow-md border-y border-r flex items-center justify-center transition-colors ${
              darkMode 
              ? 'bg-gray-800 border-gray-700 text-gray-300 hover:text-white' 
              : 'bg-white border-gray-200 text-gray-600 hover:text-blue-600'
          }`}
          title={isSidebarOpen ? "Collapse Sidebar" : "Expand Sidebar"}
        >
          {isSidebarOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
        </button>
      </div>

      <div className={`flex-1 h-full w-full relative transition-all duration-300 ${isSidebarOpen ? 'pl-80' : 'pl-0'}`}>
        <div className={`w-full h-full relative transition-colors duration-500 ${darkMode ? 'bg-slate-950' : 'bg-slate-50'}`}>
          
          <div className={`absolute inset-0 pointer-events-none z-0 transition-opacity duration-500 ${mapMode === 'off' ? 'opacity-100' : 'opacity-0'}`}
               style={{ 
                 backgroundColor: darkMode ? '#0f172a' : '#f1f5f9',
                 backgroundImage: `radial-gradient(${darkMode ? '#334155' : '#94a3b8'} 1px, transparent 1px)`,
                 backgroundSize: '20px 20px',
                 transition: 'background-color 0.5s ease-in-out, background-image 0.5s ease-in-out'
               }} 
          />

          <div className="absolute inset-0 z-10" style={{ paddingBottom: isTimelineOpen ? '300px' : '40px', transition: 'padding-bottom 0.3s ease' }}>
            <NetworkMap 
                nodes={nodes} 
                onNodeMove={handleNodeMove}
                activeLinks={scheduledLinks} 
                ghostLinks={ghostLinks}
                linkOverrides={linkOverrides}
                onOverrideLink={handleLinkOverride}
                mapMode={mapMode}
                currentTime={currentTime}
                isPlaying={isPlaying}
                isStale={isStale}
                viewMode={viewMode}
                isSidebarOpen={isSidebarOpen}
                darkMode={darkMode}
                hoveredNodeId={hoveredNodeId}
                setHoveredNodeId={setHoveredNodeId}
                hoveredLinkKey={hoveredLinkKey}
                setHoveredLinkKey={setHoveredLinkKey}
                showPotentialLinks={showPotentialLinks}
                showOverrideLinks={showOverrideLinks}
                overflowLinks={result?.schedule_diagnostics?.overflow_links || []}
            />
          </div>

          {/* Network Status Card */}
          <div className={`absolute top-4 right-4 p-4 rounded-lg shadow-xl z-20 backdrop-blur border min-w-[220px] pointer-events-none transition-colors duration-300 ${
              darkMode 
              ? 'bg-gray-900/95 border-gray-700 text-gray-100' 
              : 'bg-white/95 border-gray-200 text-gray-800'
          }`}>
              <h3 className="font-bold text-xs text-gray-400 uppercase tracking-wider mb-2 flex justify-between items-center">
                Network Status
                {isStale && <span className="text-yellow-600 bg-yellow-100 dark:bg-yellow-900 dark:text-yellow-200 px-1.5 py-0.5 rounded text-[10px] font-bold">CHANGED</span>}
              </h3>
              
              {/* Overflow Warning */}
              {hasOverflow && (
                  <div className="mb-3 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300 text-xs px-2 py-1.5 rounded flex items-center gap-2 border border-red-200 dark:border-red-900">
                      <AlertTriangle size={14} />
                      <span className="font-bold">SCHEDULE OVERFLOW</span>
                  </div>
              )}

              {result ? (
                <div className={`space-y-1 ${isStale ? 'opacity-50 grayscale' : ''}`}>
                   <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 flex items-baseline gap-1">
                     {result.total_throughput.toFixed(0)} <span className="text-sm font-normal text-gray-500 dark:text-gray-400">bps</span>
                   </div>
                   <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400 mt-2">
                     <div>
                       <div className="uppercase text-[10px] tracking-wider">Fair Rate</div>
                       <div className={`font-medium ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>{result.fair_rate.toFixed(0)} bps</div>
                     </div>
                     <div>
                       <div className="uppercase text-[10px] tracking-wider">Latency</div>
                       <div className={`font-medium ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>~{(1/result.fair_rate * 8 * 1000).toFixed(0)} ms</div>
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

        <ScheduleTimeline 
            nodes={nodes}
            result={result} 
            currentTime={currentTime} 
            onSeek={setCurrentTime}
            isOpen={isTimelineOpen}
            setIsOpen={setIsTimelineOpen}
            darkMode={darkMode}
            hoveredLinkKey={hoveredLinkKey}
            setHoveredLinkKey={setHoveredLinkKey}
            isPlaying={isPlaying}
            onTogglePlay={() => setIsPlaying(!isPlaying)}
        />
      </div>
    </div>
  );
}

export default App;