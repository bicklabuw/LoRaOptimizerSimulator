import React, { useRef, useState } from 'react';
import { 
    Play, Pause, RefreshCw, Settings, Map as MapIcon, Grid, 
    Plus, Trash2, Eye, EyeOff, Dices, Clock, BarChart, 
    Eraser, Download, Upload, Bug, Zap
} from 'lucide-react';

const ControlPanel = ({ 
  nodes, setNodes, 
  config, setConfig,
  linkOverrides, setLinkOverrides,
  onRun, isOptimizing, 
  result, 
  mapMode, setMapMode,
  showGhostLinks, setShowGhostLinks,
  showCliques, setShowCliques, // New Prop
  playback,
  viewMode, setViewMode,
  isStale, setIsStale
}) => {
  const timelineRef = useRef(null);
  const fileInputRef = useRef(null);
  const [showRandomMenu, setShowRandomMenu] = useState(false);
  const [randConfig, setRandConfig] = useState({ sinks: 1, gens: 5, relays: 3, spread: 5 });

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

  const handleDebugDump = () => {
      console.group("🐞 Debug Dump");
      console.log("Nodes:", nodes);
      console.log("Overrides:", linkOverrides);
      console.log("Config:", config);
      
      if (result) {
          console.group("🔍 Schedule Analysis (Why is it overflowing?)");
          
          // 1. Calculate Node Saturation (Half-Duplex constraint)
          // A node is busy if it is TXing OR RXing.
          const nodeLoad = {};
          result.active_links.forEach(link => {
              const airtime = link.airtime_fraction;
              // Add to Source (TX)
              nodeLoad[link.source_id] = (nodeLoad[link.source_id] || 0) + airtime;
              // Add to Target (RX)
              nodeLoad[link.target_id] = (nodeLoad[link.target_id] || 0) + airtime;
          });

          const saturationTable = Object.entries(nodeLoad).map(([id, load]) => ({
              id: parseInt(id),
              utilization: (load * 100).toFixed(1) + '%',
              status: load > 1.0 ? "🔴 CRITICAL (Math Impossible)" : load > 0.9 ? "🟠 SATURATED (Frag Risk)" : "🟢 OK",
              raw: load
          })).sort((a,b) => b.raw - a.raw);

          console.log("Node Saturation Table (TX + RX Time):");
          console.table(saturationTable);
          console.log("NOTE: If utilization is < 100% but overflow still occurs, it is due to fragmentation (could not find a continuous block big enough).");
          
          console.groupEnd();

          console.log("Result Summary:", {
              fair_rate: result.fair_rate,
              total_tput: result.total_throughput,
              cliques: result.clique_count
          });
          
          console.log("Active Links Table:");
          const tableData = result.active_links.map(l => ({
              source: l.source_id,
              target: l.target_id,
              ch: l.channel,
              airtime: l.airtime_fraction.toFixed(3),
              frags: l.schedule ? l.schedule.length : 0,
              start: l.schedule[0]?.start.toFixed(3) || "N/A",
              dur: l.schedule[0]?.duration.toFixed(3) || "N/A",
              capacity: l.capacity_bps,
              flow: l.flow_bps.toFixed(1)
          })).sort((a,b) => parseFloat(a.start) - parseFloat(b.start));
          console.table(tableData);
      } else {
          console.log("No Result yet.");
      }
      console.groupEnd();
      alert("Debug info & Saturation Analysis dumped to Console (F12)");
  };

  const generateTopology = (style) => {
    setIsStale(true);
    const newNodes = [];
    const centerLat = 43.0731; const centerLon = -89.4012;
    const spreadDeg = randConfig.spread * 0.002; 
    let id = 1;
    for(let i=0; i<randConfig.sinks; i++) {
        const offsetLat = randConfig.sinks > 1 ? (Math.random()-0.5)*spreadDeg*0.5 : 0;
        const offsetLon = randConfig.sinks > 1 ? (Math.random()-0.5)*spreadDeg*0.5 : 0;
        newNodes.push({ id: id++, name: `Sink ${i+1}`, type: 'BASE_STATION', lat: centerLat + offsetLat, lon: centerLon + offsetLon });
    }
    if (style === 'CLUSTER') {
        for(let i=0; i<randConfig.relays; i++) {
            const angle = (i / randConfig.relays) * Math.PI * 2;
            const r = spreadDeg * 0.4;
            newNodes.push({ id: id++, name: `Relay ${i+1}`, type: 'RELAY', lat: centerLat + Math.sin(angle)*r, lon: centerLon + Math.cos(angle)*r });
        }
        for(let i=0; i<randConfig.gens; i++) {
            const angle = (i / randConfig.gens) * Math.PI * 2 + 0.5;
            const r = spreadDeg;
            newNodes.push({ id: id++, name: `Gen ${i+1}`, type: 'GENERATOR', lat: centerLat + Math.sin(angle)*r, lon: centerLon + Math.cos(angle)*r });
        }
    } else if (style === 'GRID') {
        const total = randConfig.gens + randConfig.relays + randConfig.sinks;
        const side = Math.ceil(Math.sqrt(total));
        let count = 0; let placedSinks = 0; let placedRelays = 0; let placedGens = 0;
        newNodes.length = 0; id = 1;
        for(let x=0; x<side; x++) {
            for(let y=0; y<side; y++) {
                if (placedSinks + placedRelays + placedGens >= total) break;
                let type = 'GENERATOR'; let name = `Gen ${placedGens+1}`;
                if (placedSinks < randConfig.sinks) { type = 'BASE_STATION'; name = `Sink ${placedSinks+1}`; placedSinks++; }
                else if (placedRelays < randConfig.relays) { type = 'RELAY'; name = `Relay ${placedRelays+1}`; placedRelays++; }
                else { placedGens++; }
                newNodes.push({ id: id++, name, type, lat: centerLat + (x - side/2) * spreadDeg * 0.5, lon: centerLon + (y - side/2) * spreadDeg * 0.5 });
            }
        }
    } else {
        for(let i=0; i<randConfig.relays; i++) { newNodes.push({ id: id++, name: `Relay ${i+1}`, type: 'RELAY', lat: centerLat + (Math.random()-0.5)*spreadDeg*2, lon: centerLon + (Math.random()-0.5)*spreadDeg*2 }); }
        for(let i=0; i<randConfig.gens; i++) { newNodes.push({ id: id++, name: `Gen ${i+1}`, type: 'GENERATOR', lat: centerLat + (Math.random()-0.5)*spreadDeg*2, lon: centerLon + (Math.random()-0.5)*spreadDeg*2 }); }
    }
    setNodes(newNodes);
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

  return (
    <div className="w-80 h-full flex flex-col bg-white">
      <div className="p-4 border-b border-gray-200 bg-gray-50 flex-shrink-0">
        <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <Settings className="w-5 h-5 text-blue-600" /> LoRa Optimizer
        </h1>
        <div className="text-xs text-gray-500 mt-1">v0.0.1 - Prototype</div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 min-h-0">
        <section>
          <div className="flex justify-between items-center mb-2">
             <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Display</h3>
          </div>
          <div className="flex gap-2 bg-gray-100 p-1 rounded-lg mb-3">
                <button onClick={() => setMapMode('on')} className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-xs font-medium transition-all ${mapMode === 'on' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}><MapIcon className="w-3 h-3" /> Map</button>
                <button onClick={() => setMapMode('off')} className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-xs font-medium transition-all ${mapMode === 'off' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}><Grid className="w-3 h-3" /> Abstract</button>
          </div>
          <div className="space-y-2">
            <button onClick={() => setShowGhostLinks(!showGhostLinks)} className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition-colors border ${showGhostLinks ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-600'}`}>
                    <span className="flex items-center gap-2">{showGhostLinks ? <Eye className="w-3 h-3"/> : <EyeOff className="w-3 h-3"/>} Potential Links</span>
            </button>
            <button onClick={() => setShowCliques && setShowCliques(!showCliques)} className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition-colors border ${showCliques ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-white border-gray-200 text-gray-600'}`}>
                    <span className="flex items-center gap-2"><Zap className="w-3 h-3"/> Show Interference</span>
            </button>
          </div>
        </section>

        <section>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Data</h3>
            <div className="flex gap-2">
                <button onClick={handleExport} className="flex-1 flex items-center justify-center gap-1 py-1.5 border rounded-md text-xs hover:bg-gray-50 text-gray-700"><Download className="w-3 h-3"/> Export</button>
                <button onClick={() => fileInputRef.current.click()} className="flex-1 flex items-center justify-center gap-1 py-1.5 border rounded-md text-xs hover:bg-gray-50 text-gray-700"><Upload className="w-3 h-3"/> Import</button>
                <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
                <button onClick={handleDebugDump} className="flex-none px-3 flex items-center justify-center gap-1 py-1.5 border rounded-md text-xs hover:bg-gray-100 text-gray-600" title="Dump Debug Info"><Bug className="w-3 h-3"/></button>
            </div>
        </section>

        {result && (
            <section className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2"><BarChart className="w-3 h-3" /> Analysis</h3>
                <div className="space-y-2 text-sm">
                    <div className="flex justify-between items-center"><span className="text-gray-600">Fair Rate</span><span className="font-mono font-bold text-blue-600">{result.fair_rate.toFixed(0)} bps</span></div>
                    <div className="flex justify-between items-center"><span className="text-gray-600">Total T-put</span><span className="font-mono font-bold text-green-600">{result.total_throughput.toFixed(0)} bps</span></div>
                    <div className="flex justify-between items-center pt-2 border-t border-slate-200 mt-2"><span className="text-gray-600">Active Links</span><span className="font-mono text-gray-700">{result.active_links.length}</span></div>
                    <div className="flex justify-between items-center"><span className="text-gray-600">Cliques</span><span className="font-mono text-gray-700">{result.clique_count}</span></div>
                </div>
            </section>
        )}

        {result && (
            <section className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Simulation</h3>
                <div className="flex gap-2 mb-3">
                    <button onClick={() => setViewMode('tdma')} className={`flex-1 py-1.5 rounded border text-xs font-medium flex items-center justify-center gap-1 transition-all ${viewMode === 'tdma' ? 'bg-blue-100 border-blue-300 text-blue-800' : 'bg-white border-gray-300 text-gray-600'}`}><Clock className="w-3 h-3" /> TDMA</button>
                    <button onClick={() => setViewMode('capacity')} className={`flex-1 py-1.5 rounded border text-xs font-medium flex items-center justify-center gap-1 transition-all ${viewMode === 'capacity' ? 'bg-blue-100 border-blue-300 text-blue-800' : 'bg-white border-gray-300 text-gray-600'}`}><BarChart className="w-3 h-3" /> Capacity</button>
                </div>
                <div className={`transition-all duration-300 ease-in-out overflow-hidden ${viewMode === 'tdma' ? 'max-h-12 opacity-100' : 'max-h-0 opacity-0'}`}>
                    <div className="flex items-center gap-2 text-xs text-gray-600 pt-1">
                        <span>Speed:</span>
                        <input type="range" min="0.1" max="5.0" step="0.1" value={playback.playbackSpeed} onChange={(e) => playback.setPlaybackSpeed(parseFloat(e.target.value))} className="flex-1 h-1 bg-gray-300 rounded-lg appearance-none cursor-pointer"/>
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
                <button onClick={() => setShowRandomMenu(!showRandomMenu)} className={`text-xs flex items-center gap-1 border border-blue-100 px-2 py-0.5 rounded transition-colors ${showRandomMenu ? 'bg-blue-100 text-blue-800' : 'bg-blue-50 text-blue-600 hover:text-blue-800'}`}><Dices className="w-3 h-3"/> Random</button>
            </div>
          </div>

          <div className={`bg-gray-50 border border-gray-200 rounded p-3 text-xs space-y-3 transition-all duration-300 overflow-hidden ${showRandomMenu ? 'max-h-80 opacity-100 mb-3' : 'max-h-0 opacity-0 mb-0'}`}>
                <div className="flex items-center justify-between"><span className="font-semibold text-red-600">Sinks:</span><div className="flex items-center gap-2"><button onClick={() => setRandConfig({...randConfig, sinks: Math.max(1, randConfig.sinks-1)})} className="w-5 h-5 bg-white border rounded flex items-center justify-center hover:bg-gray-100">-</button><span className="w-4 text-center">{randConfig.sinks}</span><button onClick={() => setRandConfig({...randConfig, sinks: randConfig.sinks+1})} className="w-5 h-5 bg-white border rounded flex items-center justify-center hover:bg-gray-100">+</button></div></div>
                <div className="flex items-center justify-between"><span className="font-semibold text-blue-600">Gens:</span><div className="flex items-center gap-2"><button onClick={() => setRandConfig({...randConfig, gens: Math.max(1, randConfig.gens-1)})} className="w-5 h-5 bg-white border rounded flex items-center justify-center hover:bg-gray-100">-</button><span className="w-4 text-center">{randConfig.gens}</span><button onClick={() => setRandConfig({...randConfig, gens: randConfig.gens+1})} className="w-5 h-5 bg-white border rounded flex items-center justify-center hover:bg-gray-100">+</button></div></div>
                <div className="flex items-center justify-between"><span className="font-semibold text-green-600">Relays:</span><div className="flex items-center gap-2"><button onClick={() => setRandConfig({...randConfig, relays: Math.max(0, randConfig.relays-1)})} className="w-5 h-5 bg-white border rounded flex items-center justify-center hover:bg-gray-100">-</button><span className="w-4 text-center">{randConfig.relays}</span><button onClick={() => setRandConfig({...randConfig, relays: randConfig.relays+1})} className="w-5 h-5 bg-white border rounded flex items-center justify-center hover:bg-gray-100">+</button></div></div>
                <div className="flex items-center justify-between"><span>Spread:</span><input type="range" min="1" max="10" value={randConfig.spread} onChange={(e) => setRandConfig({...randConfig, spread: parseInt(e.target.value)})} className="w-20 h-1 bg-gray-300 rounded-lg appearance-none cursor-pointer"/></div>
                <div className="grid grid-cols-3 gap-1 pt-1 border-t border-gray-100">
                    <button onClick={() => generateTopology('CLUSTER')} className="py-1.5 bg-white border hover:bg-blue-50 text-[10px] rounded font-medium text-gray-600">Cluster</button>
                    <button onClick={() => generateTopology('GRID')} className="py-1.5 bg-white border hover:bg-blue-50 text-[10px] rounded font-medium text-gray-600">Grid</button>
                    <button onClick={() => generateTopology('SCATTER')} className="py-1.5 bg-white border hover:bg-blue-50 text-[10px] rounded font-medium text-gray-600">Scatter</button>
                </div>
          </div>
          
          <div className="grid grid-cols-3 gap-2 mb-4">
            <button onClick={() => addNode('GENERATOR')} className="flex items-center justify-center gap-1 py-2 bg-blue-50 text-blue-700 text-xs font-bold rounded hover:bg-blue-100 border border-blue-200"><Plus className="w-3 h-3" /> Gen</button>
            <button onClick={() => addNode('RELAY')} className="flex items-center justify-center gap-1 py-2 bg-green-50 text-green-700 text-xs font-bold rounded hover:bg-green-100 border border-green-200"><Plus className="w-3 h-3" /> Relay</button>
            <button onClick={() => addNode('BASE_STATION')} className="flex items-center justify-center gap-1 py-2 bg-red-50 text-red-700 text-xs font-bold rounded hover:bg-red-100 border border-red-200"><Plus className="w-3 h-3" /> Sink</button>
          </div>
          <div className="space-y-2 max-h-[250px] overflow-y-auto">
            {nodes.map(node => (
              <div key={node.id} className="flex items-center justify-between text-sm bg-gray-50 p-2 rounded border border-gray-100 hover:border-gray-300 transition-colors group">
                <div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${node.type === 'GENERATOR' ? 'bg-blue-500' : node.type === 'RELAY' ? 'bg-green-500' : 'bg-red-500'}`} /><span className="font-medium text-gray-700">{node.name}</span></div>
                <button onClick={() => removeNode(node.id)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className={`p-4 border-t border-gray-200 bg-gray-50 flex flex-col justify-end gap-3 transition-all duration-300 ease-in-out ${viewMode === 'tdma' ? 'h-36' : 'h-24'}`}>
        <div className={`space-y-1 transition-all duration-300 ${viewMode === 'tdma' ? 'opacity-100 mb-4' : 'opacity-0 h-0 overflow-hidden mb-0'}`}>
          <div className="flex justify-between text-xs text-gray-500 font-medium"><span>TDMA Schedule</span><span className="font-mono">{currentMs}ms / 10000ms</span></div>
          <div className="flex items-center gap-2">
             <button onClick={() => playback.setIsPlaying(!playback.isPlaying)} className="p-1.5 rounded-full hover:bg-white hover:shadow text-gray-700 transition-all">{playback.isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}</button>
             <div ref={timelineRef} onClick={handleTimelineClick} className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden relative cursor-pointer hover:bg-gray-300 transition-colors">
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