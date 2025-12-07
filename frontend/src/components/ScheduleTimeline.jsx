import React, { useMemo, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, Maximize2, Minimize2, Info, Play, Pause, Activity, Wifi, ArrowLeftRight } from 'lucide-react';

const ScheduleTimeline = ({ 
  nodes, 
  result, 
  currentTime, 
  onSeek, 
  isOpen, 
  setIsOpen,
  darkMode,
  hoveredLinkKey,
  setHoveredLinkKey,
  isPlaying,
  onTogglePlay
}) => {
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [tooltipData, setTooltipData] = useState(null);
  const scrollContainerRef = useRef(null);
  const TOTAL_DURATION_SEC = 10; 

  // --- Helper: Calculate Distance ---
  const getDistance = (n1, n2) => {
    if (!n1 || !n2) return 0;
    const R = 6371e3; 
    const φ1 = n1.lat * Math.PI/180;
    const φ2 = n2.lat * Math.PI/180;
    const Δφ = (n2.lat - n1.lat) * Math.PI/180;
    const Δλ = (n2.lon - n1.lon) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  };

  // --- Data Processing ---
  const rows = useMemo(() => {
    if (!result?.active_links) return [];
    
    const groups = {};
    result.active_links.forEach(link => {
       const n1Id = Math.min(link.source_id, link.target_id);
       const n2Id = Math.max(link.source_id, link.target_id);
       const key = `${n1Id}-${n2Id}`;
       
       if (!groups[key]) {
           groups[key] = { 
               id: key, 
               n1: n1Id, 
               n2: n2Id, 
               forward: [], 
               reverse: [],
               // Stats
               capacitySum: 0,
               airtimeFwd: 0,
               airtimeRev: 0
           };
       }
       
       const fragments = link.schedule || [];
       const dur = fragments.reduce((acc, f) => acc + f.duration, 0);

       // Accumulate Capacity & Airtime
       groups[key].capacitySum += (link.capacity_bps || 0);

       if (link.source_id === n1Id) {
           groups[key].forward.push(...fragments);
           groups[key].airtimeFwd += dur;
       } else {
           groups[key].reverse.push(...fragments);
           groups[key].airtimeRev += dur;
       }
    });
    
    // Attach Distance to each group
    return Object.values(groups).map(g => {
        const node1 = nodes.find(n => n.id === g.n1);
        const node2 = nodes.find(n => n.id === g.n2);
        return {
            ...g,
            distance: getDistance(node1, node2)
        };
    });
  }, [result, nodes]);

  const handleTimelineClick = (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, x / rect.width));
      onSeek(pct);
  };

  const handleHeaderClick = (e) => {
      if (e.target.closest('button')) return;
      if (isFullScreen) {
          setIsFullScreen(false);
          setIsOpen(false);
      } else {
          setIsOpen(!isOpen);
      }
  };

  const getNodeInfo = (id) => {
      const n = nodes.find(node => node.id === id);
      return n ? n : { name: `Node ${id}`, type: 'UNKNOWN' };
  };

  const containerBg = darkMode ? 'bg-gray-900 text-gray-200' : 'bg-white text-gray-800';
  const headerBorder = darkMode ? 'border-gray-700' : 'border-gray-200';
  const gridBorder = darkMode ? 'border-gray-800' : 'border-gray-100';
  const stickyBg = darkMode ? '#111827' : '#ffffff';

  let heightStyle = '40px'; 
  if (isOpen) heightStyle = '300px'; 
  if (isFullScreen) heightStyle = '100%'; 
  const isActive = isOpen || isFullScreen;

  return (
    <div 
        className={`fixed left-0 right-0 z-[3000] border-t shadow-[0_-4px_20px_rgba(0,0,0,0.1)] transition-all duration-300 ease-in-out flex flex-col ${containerBg} ${headerBorder}`}
        style={{ height: heightStyle, bottom: 0 }}
    >
        {/* --- Header Bar --- */}
        <div 
            className={`h-10 flex-shrink-0 flex items-center justify-between px-4 cursor-pointer hover:bg-opacity-80 transition-colors border-b ${headerBorder} ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}
            onClick={handleHeaderClick}
        >
            <div className="flex items-center gap-3 font-bold text-xs uppercase tracking-wider select-none">
                {isActive ? <ChevronDown size={16}/> : <ChevronUp size={16}/>}
                
                <button 
                    onClick={(e) => {
                        e.stopPropagation();
                        onTogglePlay();
                    }}
                    className={`p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors z-50 ${isPlaying ? 'text-blue-500' : ''}`}
                    title={isPlaying ? "Pause" : "Play"}
                >
                    {isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                </button>

                <span>TDMA Schedule Logic Analyzer</span>
                <span className={`ml-4 font-mono font-normal ${darkMode?'text-blue-400':'text-blue-600'}`}>
                    {(currentTime * TOTAL_DURATION_SEC * 1000).toFixed(0)}ms
                </span>
            </div>

            <div className="flex items-center gap-4">
                {isActive && (
                    <div className="flex items-center gap-4 text-[10px] font-medium opacity-70 mr-4">
                        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-500 rounded-sm"></div> FWD Data</div>
                        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-purple-500 rounded-sm"></div> REV Data/ACK</div>
                    </div>
                )}
                <button 
                    onClick={() => {
                        if (!isFullScreen && !isOpen) setIsOpen(true);
                        setIsFullScreen(!isFullScreen);
                    }}
                    className={`p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors`}
                    title={isFullScreen ? "Exit Fullscreen" : "Fullscreen"}
                >
                    {isFullScreen ? <Minimize2 size={14}/> : <Maximize2 size={14}/>}
                </button>
            </div>
        </div>

        {/* --- Scrollable Body --- */}
        <div className="flex-1 overflow-auto relative" ref={scrollContainerRef}>
            <div className="flex min-w-full min-h-full">
                
                {/* 1. Sticky Sidebar (Labels) */}
                <div className={`sticky left-0 z-30 w-44 flex-shrink-0 border-r ${headerBorder}`} style={{ backgroundColor: stickyBg }}>
                    <div className={`h-6 border-b ${headerBorder} sticky top-0 z-40`} style={{ backgroundColor: stickyBg }}></div>
                    
                    {rows.map(row => {
                        const isHovered = row.id === hoveredLinkKey;
                        return (
                            <div 
                                key={row.id} 
                                className={`h-12 border-b text-[10px] flex flex-col justify-center px-3 font-mono transition-colors ${gridBorder} ${isHovered ? (darkMode ? 'bg-cyan-900/30' : 'bg-cyan-50') : ''}`}
                                onMouseEnter={() => setHoveredLinkKey(row.id)}
                                onMouseLeave={() => setHoveredLinkKey(null)}
                            >
                                <div 
                                    className="font-bold text-xs truncate flex items-center gap-1 cursor-pointer w-full"
                                    onMouseEnter={(e) => {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setTooltipData({
                                            x: rect.right + 10,
                                            y: rect.top,
                                            row: row
                                        });
                                    }}
                                    onMouseLeave={() => setTooltipData(null)}
                                >
                                    <span>Link {row.n1}↔{row.n2}</span>
                                    <Info size={10} className="opacity-50" />
                                </div>
                                <div className="opacity-50 text-[9px] mt-0.5 flex justify-between">
                                    <span>{(row.distance).toFixed(0)}m</span>
                                    <span>{(row.capacitySum / 1000).toFixed(1)} kbps</span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* 2. Chart Content */}
                <div className="flex-1 relative min-w-[600px]"> 
                    <div 
                        className="absolute top-0 bottom-0 z-20 w-px bg-red-500 pointer-events-none shadow-[0_0_4px_rgba(239,68,68,0.5)]"
                        style={{ left: `${currentTime * 100}%` }}
                    />
                    <div className={`h-6 border-b sticky top-0 z-10 select-none ${headerBorder}`} style={{ backgroundColor: stickyBg }}>
                        {Array.from({ length: TOTAL_DURATION_SEC + 1 }).map((_, i) => (
                            <div key={i} className="absolute bottom-0 text-[9px] font-mono border-l pl-1 opacity-50" 
                                 style={{ left: `${(i / TOTAL_DURATION_SEC) * 100}%`, borderColor: darkMode ? '#475569' : '#cbd5e1' }}>
                                {i}s
                            </div>
                        ))}
                    </div>

                    <div className="relative" onClick={handleTimelineClick}>
                        {rows.map(row => {
                            const isHovered = row.id === hoveredLinkKey;
                            return (
                                <div 
                                    key={row.id} 
                                    className={`h-12 border-b relative w-full group ${gridBorder} ${isHovered ? (darkMode ? 'bg-cyan-900/30' : 'bg-cyan-50') : (darkMode ? 'hover:bg-gray-800/30' : 'hover:bg-blue-50/30')}`}
                                    onMouseEnter={() => setHoveredLinkKey(row.id)}
                                    onMouseLeave={() => setHoveredLinkKey(null)}
                                >
                                    <div className="absolute top-1 bottom-[50%] left-0 right-0">
                                        {row.forward.map((frag, i) => (
                                            <div 
                                                key={`fwd-${i}`}
                                                className="absolute top-1 bottom-1 bg-blue-500 rounded-sm hover:brightness-110 transition-all cursor-crosshair opacity-80"
                                                style={{ left: `${frag.start * 100}%`, width: `${Math.max(0.2, frag.duration * 100)}%` }}
                                            />
                                        ))}
                                    </div>
                                    <div className="absolute top-[50%] bottom-1 left-0 right-0">
                                        {row.reverse.map((frag, i) => (
                                            <div 
                                                key={`rev-${i}`}
                                                className="absolute top-1 bottom-1 bg-purple-500 rounded-sm hover:brightness-110 transition-all cursor-crosshair opacity-80"
                                                style={{ left: `${frag.start * 100}%`, width: `${Math.max(0.2, frag.duration * 100)}%` }}
                                            />
                                        ))}
                                    </div>
                                    {Array.from({ length: TOTAL_DURATION_SEC }).map((_, i) => i > 0 && (
                                        <div key={i} className={`absolute top-0 bottom-0 w-px ${darkMode?'bg-gray-800':'bg-gray-50'}`} style={{left: `${(i/TOTAL_DURATION_SEC)*100}%`}} />
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>

        {/* --- ENHANCED BREAKOUT TOOLTIP --- */}
        {tooltipData && (
            <div 
                className={`fixed z-[3100] p-4 rounded-lg shadow-2xl border pointer-events-none min-w-[220px] backdrop-blur-sm ${darkMode ? 'bg-slate-800/95 border-slate-600 text-gray-200' : 'bg-white/95 border-gray-200 text-gray-800'}`}
                style={{ 
                    left: tooltipData.x, 
                    top: Math.min(window.innerHeight - 200, Math.max(10, tooltipData.y - 50)) // Prevent off-screen vertical
                }}
            >
                <div className="flex justify-between items-center mb-3 border-b border-gray-500/30 pb-2">
                    <span className="font-bold text-xs uppercase tracking-wider">Link Stats</span>
                    <span className="text-[10px] font-mono opacity-60">ID: {tooltipData.row.id}</span>
                </div>

                {/* Nodes */}
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mb-4 text-xs font-medium">
                     <div className="text-right truncate">{getNodeInfo(tooltipData.row.n1).name}</div>
                     <ArrowLeftRight size={12} className="opacity-40" />
                     <div className="truncate">{getNodeInfo(tooltipData.row.n2).name}</div>
                </div>

                {/* Metrics Grid */}
                <div className="space-y-3 text-xs">
                    
                    {/* Distance */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 opacity-70">
                            <Activity size={12} /> <span>Distance</span>
                        </div>
                        <span className="font-mono">{tooltipData.row.distance.toFixed(0)}m</span>
                    </div>

                    {/* Capacity */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 opacity-70">
                            <Wifi size={12} /> <span>Capacity</span>
                        </div>
                        <span className="font-mono font-bold text-green-500">{(tooltipData.row.capacitySum).toFixed(0)} bps</span>
                    </div>

                    {/* Airtime & Balance */}
                    <div className="pt-2 border-t border-gray-500/20">
                        <div className="flex justify-between mb-1 opacity-70">
                             <span>Airtime Usage</span>
                             <span>{((tooltipData.row.airtimeFwd + tooltipData.row.airtimeRev) * 100).toFixed(1)}%</span>
                        </div>
                        
                        {/* Visual Balance Bar */}
                        <div className="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden flex">
                            <div style={{ width: `${(tooltipData.row.airtimeFwd / (tooltipData.row.airtimeFwd + tooltipData.row.airtimeRev || 1)) * 100}%` }} className="bg-blue-500 h-full" />
                            <div className="bg-purple-500 flex-1 h-full" />
                        </div>
                        <div className="flex justify-between text-[9px] mt-1 opacity-60 font-mono">
                             <span>FWD: {(tooltipData.row.airtimeFwd * 1000 * TOTAL_DURATION_SEC).toFixed(0)}ms</span>
                             <span>REV: {(tooltipData.row.airtimeRev * 1000 * TOTAL_DURATION_SEC).toFixed(0)}ms</span>
                        </div>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
};

export default ScheduleTimeline;