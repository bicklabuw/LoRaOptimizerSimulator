import React, { useRef, useState } from 'react';
import { 
    Play, Pause, RefreshCw, Settings, Map as MapIcon, Grid, 
    Plus, Trash2, Eye, EyeOff, Dices, Clock, BarChart, 
    Download, Upload, Bug, Moon, Sun, Minus, Pin
} from 'lucide-react';

const ControlPanel = ({ 
  nodes, setNodes, 
  config, setConfig,
  linkOverrides, setLinkOverrides,
  onRun, isOptimizing, 
  result, 
  mapMode, setMapMode,
  showPotentialLinks, setShowPotentialLinks,
  showOverrideLinks, setShowOverrideLinks,
  playback,
  viewMode, setViewMode,
  isStale, setIsStale,
  darkMode, setDarkMode,
  hoveredNodeId, setHoveredNodeId
}) => {
  const timelineRef = useRef(null);
  const fileInputRef = useRef(null);
  const [showRandomMenu, setShowRandomMenu] = useState(false);
  const [randConfig, setRandConfig] = useState({ sinks: 1, gens: 4, relays: 2, spread: 5 });

  const addNode = (type) => {
    setIsStale(true);
    const id = nodes.length > 0 ? Math.max(...nodes.map(n => n.id)) + 1 : 1;
    const centerLat = nodes.length ? nodes[0].lat : 43.0731;
    const centerLon = nodes.length ? nodes[0].lon : -89.4012;
    const jLat = (Math.random() - 0.5) * 0.005;
    const jLon = (Math.random() - 0.5) * 0.005;
    setNodes([...nodes, {
      id,
      name: `${type === 'GENERATOR' ? 'Gen' : type === 'RELAY' ? 'Relay' : 'Sink'} ${id}`,
      type,
      lat: centerLat + jLat, lon: centerLon + jLon
    }]);
  };

  const clearNodes = () => {
      if (window.confirm("Are you sure you want to clear all nodes?")) {
          setNodes([]);
          setLinkOverrides([]);
          setIsStale(true);
      }
  };

  const handleExport = () => {
      const data = { nodes, link_overrides: linkOverrides, config };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `network_topology_${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
  };

  const handleImport = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
          try {
              const data = JSON.parse(evt.target.result);
              if (data.nodes) setNodes(data.nodes);
              if (data.link_overrides) setLinkOverrides(data.link_overrides);
              if (data.config) setConfig({...config, ...data.config});
              setIsStale(true);
              alert("Topology Loaded Successfully!");
          } catch (err) {
              alert("Failed to parse JSON file.");
              console.error(err);
          }
      };
      reader.readAsText(file);
      e.target.value = null;
  };

  const generateTopology = (style) => {
    setIsStale(true);
    const newNodes = [];
    const centerLat = 43.0731; 
    const centerLon = -89.4012;
    const spread = randConfig.spread * 0.002; 
    let id = 1;

    const makeNode = (type, lat, lon) => ({
        id: id++,
        name: `${type === 'BASE_STATION' ? 'Sink' : type === 'GENERATOR' ? 'Gen' : 'Relay'} ${id}`,
        type, lat, lon
    });

    if (style === 'GRID') {
        const total = randConfig.sinks + randConfig.gens + randConfig.relays;
        const cols = Math.ceil(Math.sqrt(total));
        const rows = Math.ceil(total / cols);
        let count = 0;
        const types = [
            ...Array(randConfig.sinks).fill('BASE_STATION'),
            ...Array(randConfig.relays).fill('RELAY'),
            ...Array(randConfig.gens).fill('GENERATOR')
        ];
        
        for(let r=0; r<rows; r++) {
            for(let c=0; c<cols; c++) {
                if(count >= types.length) break;
                newNodes.push(makeNode(types[count], centerLat + r*spread*0.8, centerLon + c*spread*0.8));
                count++;
            }
        }
    } else if (style === 'CLUSTER') {
        for(let i=0; i<randConfig.sinks; i++) {
             newNodes.push(makeNode('BASE_STATION', centerLat + (Math.random()-0.5)*spread*0.5, centerLon + (Math.random()-0.5)*spread*0.5));
        }
        for(let i=0; i<randConfig.relays; i++) {
             newNodes.push(makeNode('RELAY', centerLat + (Math.random()-0.5)*spread*2, centerLon + (Math.random()-0.5)*spread*2));
        }
        for(let i=0; i<randConfig.gens; i++) {
             const anchor = newNodes.length > 0 ? newNodes[Math.floor(Math.random()*newNodes.length)] : {lat: centerLat, lon: centerLon};
             newNodes.push(makeNode('GENERATOR', anchor.lat + (Math.random()-0.5)*spread*0.5, anchor.lon + (Math.random()-0.5)*spread*0.5));
        }
    } else { 
        const all = [
             ...Array(randConfig.sinks).fill('BASE_STATION'),
             ...Array(randConfig.relays).fill('RELAY'),
             ...Array(randConfig.gens).fill('GENERATOR')
        ];
        all.forEach(type => {
            newNodes.push(makeNode(type, centerLat + (Math.random()-0.5)*spread*3, centerLon + (Math.random()-0.5)*spread*3));
        });
    }
    
    setNodes(newNodes);
    setLinkOverrides([]);
    setShowRandomMenu(false);
  };

  const removeNode = (id) => { setIsStale(true); setNodes(nodes.filter(n => n.id !== id)); };
  
  const handleTimelineClick = (e) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    playback.setCurrentTime(Math.max(0, Math.min(1, x / rect.width)));
  };
  const frameTotal = 10000; const currentMs = Math.round(playback.currentTime * frameTotal);

  const adjustRand = (key, delta) => {
      setRandConfig(prev => ({...prev, [key]: Math.max(0, prev[key] + delta)}));
  };

  return (
    <div className={`w-80 h-full flex flex-col border-r transition-colors duration-300 ${darkMode ? 'bg-gray-900 text-gray-100 border-gray-800' : 'bg-white text-gray-900 border-gray-200'}`}>
      <div className={`p-4 border-b flex-shrink-0 flex justify-between items-start transition-colors duration-300 ${darkMode ? 'bg-gray-900 border-gray-800' : 'bg-gray-50 border-gray-200'}`}>
        <div>
            <h1 className={`text-xl font-bold flex items-center gap-2 ${darkMode ? 'text-white' : 'text-gray-800'}`}>
            <Settings className="w-5 h-5 text-blue-600" /> LoRa Optimizer
            </h1>
            <div className={`text-xs mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>v0.0.3 - Beta</div>
        </div>
        <button onClick={() => setDarkMode(!darkMode)} className={`p-2 rounded-full transition-colors ${darkMode ? 'bg-gray-700 text-yellow-300 hover:bg-gray-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>

      <div className={`flex-1 overflow-y-auto p-4 space-y-6 min-h-0 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
        <section>
          <div className="flex justify-between items-center mb-2">
             <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Display</h3>
          </div>
          <div className={`flex gap-2 p-1 rounded-lg mb-3 ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
                <button onClick={() => setMapMode('on')} className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-xs font-medium transition-all ${mapMode === 'on' ? (darkMode ? 'bg-gray-700 text-blue-400 shadow' : 'bg-white text-blue-600 shadow') : (darkMode ? 'text-gray-400' : 'text-gray-500')}`}><MapIcon className="w-3 h-3" /> Map</button>
                <button onClick={() => setMapMode('off')} className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-xs font-medium transition-all ${mapMode === 'off' ? (darkMode ? 'bg-gray-700 text-blue-400 shadow' : 'bg-white text-blue-600 shadow') : (darkMode ? 'text-gray-400' : 'text-gray-500')}`}><Grid className="w-3 h-3" /> Abstract</button>
          </div>
          
          {/* New Granular Toggle Controls */}
          <div className="flex gap-2">
              <button 
                onClick={() => setShowPotentialLinks(!showPotentialLinks)} 
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-md text-xs border transition-colors ${
                    showPotentialLinks 
                    ? (darkMode ? 'bg-blue-900/30 border-blue-800 text-blue-300' : 'bg-blue-50 border-blue-200 text-blue-700') 
                    : (darkMode ? 'bg-gray-800 border-gray-700 text-gray-400' : 'bg-white border-gray-200 text-gray-600')
                }`}
              >
                  {showPotentialLinks ? <Eye className="w-3 h-3"/> : <EyeOff className="w-3 h-3"/>} Potential
              </button>
              <button 
                onClick={() => setShowOverrideLinks(!showOverrideLinks)} 
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-md text-xs border transition-colors ${
                    showOverrideLinks 
                    ? (darkMode ? 'bg-purple-900/30 border-purple-800 text-purple-300' : 'bg-purple-50 border-purple-200 text-purple-700') 
                    : (darkMode ? 'bg-gray-800 border-gray-700 text-gray-400' : 'bg-white border-gray-200 text-gray-600')
                }`}
              >
                  {showOverrideLinks ? <Eye className="w-3 h-3"/> : <EyeOff className="w-3 h-3"/>} Overrides
              </button>
          </div>
        </section>

        {/* ... Rest of the components (Data, Analysis, Simulation, Topology) remain the same ... */}
        {/* Included abbreviated for context continuity */}
        <section>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Data</h3>
            <div className="flex gap-2">
                <button onClick={handleExport} className={`flex-1 flex items-center justify-center gap-1 py-1.5 border rounded-md text-xs ${darkMode ? 'border-gray-700 hover:bg-gray-800 text-gray-300' : 'hover:bg-gray-50 text-gray-700'}`}><Download className="w-3 h-3"/> Export</button>
                <button onClick={() => fileInputRef.current.click()} className={`flex-1 flex items-center justify-center gap-1 py-1.5 border rounded-md text-xs ${darkMode ? 'border-gray-700 hover:bg-gray-800 text-gray-300' : 'hover:bg-gray-50 text-gray-700'}`}><Upload className="w-3 h-3"/> Import</button>
                <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
                <button onClick={() => console.log(nodes)} className={`flex-none px-3 flex items-center justify-center gap-1 py-1.5 border rounded-md text-xs ${darkMode ? 'border-gray-700 hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-600'}`} title="Dump Debug Info"><Bug className="w-3 h-3"/></button>
            </div>
        </section>

        {result && (
            <section className={`p-3 rounded-lg border transition-colors duration-300 ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                <h3 className={`text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-2 ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}><BarChart className="w-3 h-3" /> Analysis</h3>
                <div className="space-y-2 text-sm">
                    <div className="flex justify-between items-center"><span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Fair Rate</span><span className={`font-mono font-bold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>{result.fair_rate.toFixed(0)} bps</span></div>
                    <div className="flex justify-between items-center"><span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Total T-put</span><span className={`font-mono font-bold ${darkMode ? 'text-green-400' : 'text-green-600'}`}>{result.total_throughput.toFixed(0)} bps</span></div>
                    <div className={`flex justify-between items-center pt-2 border-t mt-2 ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}><span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Active Links</span><span className={`font-mono ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{result.active_links.length}</span></div>
                    <div className="flex justify-between items-center"><span className={darkMode ? 'text-gray-400' : 'text-gray-600'}>Cliques</span><span className={`font-mono ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{result.clique_count}</span></div>
                </div>
            </section>
        )}

        {result && (
            <section className={`p-3 rounded-lg border transition-colors duration-300 ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                <h3 className={`text-xs font-bold uppercase tracking-wider mb-2 ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Simulation</h3>
                <div className="flex gap-2 mb-3">
                    <button onClick={() => setViewMode('tdma')} className={`flex-1 py-1.5 rounded border text-xs font-medium flex items-center justify-center gap-1 transition-all ${viewMode === 'tdma' ? (darkMode ? 'bg-blue-900 border-blue-700 text-blue-200' : 'bg-blue-100 border-blue-300 text-blue-800') : (darkMode ? 'bg-gray-700 border-gray-600 text-gray-300' : 'bg-white border-gray-300 text-gray-600')}`}><Clock className="w-3 h-3" /> TDMA</button>
                    <button onClick={() => setViewMode('capacity')} className={`flex-1 py-1.5 rounded border text-xs font-medium flex items-center justify-center gap-1 transition-all ${viewMode === 'capacity' ? (darkMode ? 'bg-blue-900 border-blue-700 text-blue-200' : 'bg-blue-100 border-blue-300 text-blue-800') : (darkMode ? 'bg-gray-700 border-gray-600 text-gray-300' : 'bg-white border-gray-300 text-gray-600')}`}><BarChart className="w-3 h-3" /> Capacity</button>
                </div>
                <div className={`transition-all duration-300 ease-in-out overflow-hidden ${viewMode === 'tdma' ? 'max-h-12 opacity-100' : 'max-h-0 opacity-0'}`}>
                    <div className={`flex items-center gap-2 text-xs pt-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        <span>Speed:</span>
                        <input type="range" min="0.1" max="5.0" step="0.1" value={playback.playbackSpeed} onChange={(e) => playback.setPlaybackSpeed(parseFloat(e.target.value))} className={`flex-1 h-1 rounded-lg appearance-none cursor-pointer ${darkMode ? 'bg-gray-600' : 'bg-gray-300'}`}/>
                        <span className="w-8 text-right">{playback.playbackSpeed.toFixed(1)}x</span>
                    </div>
                </div>
            </section>
        )}

        <section>
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Topology</h3>
            <div className="flex gap-2">
                <button onClick={clearNodes} className="text-gray-400 hover:text-red-500" title="Clear All"><Trash2 className="w-4 h-4"/></button>
                <button onClick={() => setShowRandomMenu(!showRandomMenu)} className={`text-xs flex items-center gap-1 border px-2 py-0.5 rounded transition-colors ${showRandomMenu ? (darkMode ? 'bg-blue-900 text-blue-200 border-blue-700' : 'bg-blue-100 text-blue-800 border-blue-300') : (darkMode ? 'bg-gray-800 text-blue-400 border-gray-700' : 'bg-white text-blue-600 border-blue-100 hover:text-blue-800')}`}><Dices className="w-3 h-3"/> Random</button>
            </div>
          </div>

          <div className={`border rounded p-3 text-xs space-y-3 transition-all duration-300 overflow-hidden ${showRandomMenu ? 'max-h-96 opacity-100 mb-3' : 'max-h-0 opacity-0 mb-0'} ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                {/* Random Controls - Same as before */}
                {['sinks', 'gens', 'relays'].map(key => (
                    <div key={key} className="flex items-center justify-between">
                        <span className={`font-semibold capitalize ${key === 'sinks' ? (darkMode ? 'text-red-400' : 'text-red-600') : key === 'relays' ? (darkMode ? 'text-green-400' : 'text-green-600') : (darkMode ? 'text-blue-400' : 'text-blue-600')}`}>{key}:</span>
                        <div className="flex items-center gap-2">
                            <button onClick={() => adjustRand(key, -1)} className={`p-1 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}><Minus className="w-3 h-3"/></button>
                            <span className="w-4 text-center">{randConfig[key]}</span>
                            <button onClick={() => adjustRand(key, 1)} className={`p-1 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}><Plus className="w-3 h-3"/></button>
                        </div>
                    </div>
                ))}
                 <div className="flex items-center justify-between">
                        <span className={`font-semibold ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Spread:</span>
                        <div className="flex items-center gap-2">
                            <button onClick={() => adjustRand('spread', -1)} className={`p-1 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}><Minus className="w-3 h-3"/></button>
                            <span className="w-4 text-center">{randConfig.spread}</span>
                            <button onClick={() => adjustRand('spread', 1)} className={`p-1 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}><Plus className="w-3 h-3"/></button>
                        </div>
                </div>

                <div className={`grid grid-cols-3 gap-1 pt-2 border-t ${darkMode ? 'border-gray-700' : 'border-gray-100'}`}>
                    {['Cluster', 'Grid', 'Scatter'].map(type => (
                        <button key={type} onClick={() => generateTopology(type.toUpperCase())} className={`py-1.5 border hover:opacity-80 text-[10px] rounded font-medium ${darkMode ? 'bg-gray-700 border-gray-600 text-gray-300' : 'bg-white border-gray-200 text-gray-600'}`}>{type}</button>
                    ))}
                </div>
          </div>
          
          <div className="grid grid-cols-3 gap-2 mb-4">
            <button onClick={() => addNode('GENERATOR')} className={`flex items-center justify-center gap-1 py-2 text-xs font-bold rounded border transition-colors ${darkMode ? 'bg-blue-900/30 text-blue-300 hover:bg-blue-900/50 border-blue-800' : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200'}`}><Plus className="w-3 h-3" /> Gen</button>
            <button onClick={() => addNode('RELAY')} className={`flex items-center justify-center gap-1 py-2 text-xs font-bold rounded border transition-colors ${darkMode ? 'bg-green-900/30 text-green-300 hover:bg-green-900/50 border-green-800' : 'bg-green-50 text-green-700 hover:bg-green-100 border-green-200'}`}><Plus className="w-3 h-3" /> Relay</button>
            <button onClick={() => addNode('BASE_STATION')} className={`flex items-center justify-center gap-1 py-2 text-xs font-bold rounded border transition-colors ${darkMode ? 'bg-red-900/30 text-red-300 hover:bg-red-900/50 border-red-800' : 'bg-red-50 text-red-700 hover:bg-red-100 border-red-200'}`}><Plus className="w-3 h-3" /> Sink</button>
          </div>
          <div className="space-y-2 max-h-[250px] overflow-y-auto">
            {nodes.map(node => (
              <div 
                key={node.id} 
                className={`flex items-center justify-between text-sm p-2 rounded border transition-all cursor-pointer group ${
                    hoveredNodeId === node.id 
                    ? (darkMode ? 'bg-blue-900/40 border-blue-500 ring-1 ring-blue-600' : 'bg-blue-50 border-blue-400 ring-1 ring-blue-300')
                    : (darkMode ? 'bg-gray-800 border-gray-700 hover:border-gray-500' : 'bg-gray-50 border-gray-100 hover:border-gray-300')
                }`}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
              >
                <div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${node.type === 'GENERATOR' ? 'bg-blue-500' : node.type === 'RELAY' ? 'bg-green-500' : 'bg-red-500'}`} /><span className={`font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{node.name} <span className='text-[10px] text-gray-400'>#{node.id}</span></span></div>
                <button onClick={(e) => { e.stopPropagation(); removeNode(node.id); }} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className={`p-4 border-t flex flex-col justify-end gap-3 transition-all duration-300 ease-in-out ${viewMode === 'tdma' ? 'h-36' : 'h-24'} ${darkMode ? 'border-gray-800 bg-gray-900' : 'border-gray-200 bg-gray-50'}`}>
         {/* ... (Footer remains same as previous update) */}
         <div className={`space-y-1 transition-all duration-300 ${viewMode === 'tdma' ? 'opacity-100 mb-4' : 'opacity-0 h-0 overflow-hidden mb-0'}`}>
          <div className={`flex justify-between text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}><span>TDMA Schedule</span><span className="font-mono">{currentMs}ms / 10000ms</span></div>
          <div className="flex items-center gap-2">
             <button onClick={() => playback.setIsPlaying(!playback.isPlaying)} className={`p-1.5 rounded-full hover:shadow transition-all ${darkMode ? 'hover:bg-gray-800 text-gray-300' : 'hover:bg-white text-gray-700'}`}>{playback.isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}</button>
             <div ref={timelineRef} onClick={handleTimelineClick} className={`flex-1 h-3 rounded-full overflow-hidden relative cursor-pointer transition-colors ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}>
               <div className="h-full bg-blue-500" style={{ width: `${playback.currentTime * 100}%` }} />
             </div>
          </div>
        </div>
        <button 
          onClick={onRun} disabled={isOptimizing}
          className={`w-full py-3 rounded-lg flex items-center justify-center gap-2 text-white font-bold shadow-lg transition-all mt-auto ${isOptimizing ? 'bg-slate-400 cursor-not-allowed' : 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 hover:shadow-xl active:scale-[0.98]'}`}
        >
          {isOptimizing ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-current" />}
          {isOptimizing ? 'Solving...' : 'Run Optimizer'}
        </button>
      </div>
    </div>
  );
};

export default ControlPanel;