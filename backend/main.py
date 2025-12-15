from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from models import (
    SimulationRequest, SolverResult, EmbeddedScheduleResponse, 
    GlobalScheduleConfig, NodeSchedule, ScheduleSlot
)
from topology import TopologyManager
from solver import NetworkSolver
import time
from typing import List, Dict

app = FastAPI(title="LoRa Mesh Optimizer", version="0.0.1")
resp_id = 0

# Allow CORS for React Frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi import Request, status
import logging

logging.basicConfig(level=logging.ERROR)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # Log the original exception details
    logging.error(f"Validation error: {exc.errors()}")
    
    # Try to read and log the request body
    try:
        # Note: reading the body here might prevent the endpoint from reading it again.
        # For pure debugging, this is fine.
        body = await request.body()
        logging.error(f"Request body causing error: {body.decode('utf-8')}")
    except Exception as e:
        logging.error(f"Failed to read request body: {e}")

    # Return a JSON response with details
    content = {
        "status_code": status.HTTP_422_UNPROCESSABLE_ENTITY,
        "message": "Validation error",
        "details": exc.errors(), # Provides specific field-level errors
    }
    return JSONResponse(
        content=content, 
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY
    )


@app.get("/")
def health_check():
    return {"status": "online", "version": "0.0.1"}

@app.post("/optimize", response_model=SolverResult)
def run_optimization(request: SimulationRequest):
    # Logic to handle retrans_mode logic for solver
    # If retrans_mode == 0 (None), force ack_overhead_ratio to 0 for the solver math
    if request.config.retrans_mode == 0:
        request.config.ack_overhead_ratio = 0.0
        
    try:
        start_time = time.time()
        
        # 1. Build Topology
        # Note: Logic inside TopologyManager now prioritizes link_overrides
        # allowing full manual graph injection via API.
        topo = TopologyManager(request.nodes, request.link_overrides, request.config)
        topo.build()
        
        print(f"Topology Built: {len(topo.links)} links, {len(topo.cliques)} cliques detected.")
        
        # 2. Run Solver
        solver = NetworkSolver(topo)
        result = solver.solve()
        
        duration = time.time() - start_time
        print(f"Optimization completed in {duration:.3f}s. Status: {result.status}")
        
        return result
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/generate_schedule", response_model=EmbeddedScheduleResponse)
def generate_schedule(request: SimulationRequest):
    global resp_id
    # 1. Prepare Config for Solver
    # If retrans_mode == 0, disable ACK overhead in solver
    if request.config.retrans_mode == 0:
        request.config.ack_overhead_ratio = 0.0

    # 2. Run Solver
    try:
        topo = TopologyManager(request.nodes, request.link_overrides, request.config)
        topo.build()
        
        solver = NetworkSolver(topo)
        result = solver.solve()
        
        # We proceed even if not "Optimal" to give best effort result
        if result.status not in ["Optimal", "Feasible"]:
             print(f"Warning: Solver status is {result.status}")

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Solver Error: {str(e)}")

    # 3. Calculate Timing Parameters
    # frame_s_index: 0=10s, 1=20s, 2=40s, 3=80s
    idx = request.config.frame_s_index
    frame_duration_s = 10 * (2 ** idx)
    TICK_DURATION_S = 0.002 # 2ms per tick
    TOTAL_TICKS = int(frame_duration_s / TICK_DURATION_S)

    # 4. Map SF Overrides
    # (src, dst) -> sf
    link_sf_map = {}
    for link in request.link_overrides:
        link_sf_map[(link.source_id, link.target_id)] = link.spreading_factor

    # 5. Build Tree (Parent/Child)
    # Heuristic: The link carrying the most flow OUT of a node points to its parent.
    parents: Dict[int, int] = {}
    children: Dict[int, List[int]] = {n.id: [] for n in request.nodes}

    for node in request.nodes:
        if node.type == "BASE_STATION":
            # Base station is its own parent (or 0)
            parents[node.id] = node.id
            continue

        best_parent = -1
        max_flow = -1.0
        
        # Check outgoing links in active_links
        for link_res in result.active_links:
            if link_res.source_id == node.id:
                if link_res.flow_bps > max_flow:
                    max_flow = link_res.flow_bps
                    best_parent = link_res.target_id
        
        # Fallback if no flow (disconnected node) -> self
        if best_parent == -1:
            parents[node.id] = node.id
        else:
            parents[node.id] = best_parent

    # Populate children lists based on parents
    for node_id, parent_id in parents.items():
        if node_id != parent_id:
            children[parent_id].append(node_id)

    # 6. Build Node Schedules
    node_schedules = []
    
    for node in request.nodes:
        my_slots = []
        
        # Find all links involving this node
        for link_res in result.active_links:
            is_tx = (link_res.source_id == node.id)
            is_rx = (link_res.target_id == node.id)
            
            if not (is_tx or is_rx):
                continue
            
            other = link_res.target_id if is_tx else link_res.source_id
            
            # Lookup SF (default to -1 if not in overrides)
            sf = link_sf_map.get((link_res.source_id, link_res.target_id), -1)

            # Process fragments
            for frag in link_res.schedule:
                start_tick = int(frag.start * TOTAL_TICKS)
                dur_ticks = int(frag.duration * TOTAL_TICKS)
                
                # Filter out tiny artifacts
                if dur_ticks <= 0:
                    continue

                slot = ScheduleSlot(
                    other_id=other,
                    is_tx=1 if is_tx else 0,
                    is_ack=1 if frag.is_ack else 0,
                    sf=sf,
                    ch=link_res.channel,
                    start_tick=start_tick,
                    dur_ticks=dur_ticks
                )
                my_slots.append(slot)
        
        # Sort slots by start_tick
        my_slots.sort(key=lambda x: x.start_tick)
        
        node_schedules.append(NodeSchedule(
            node_id=node.id,
            parent_id=parents.get(node.id, 0),
            children=children.get(node.id, []),
            slots=my_slots
        ))

    # 7. Construct Response
    resp = EmbeddedScheduleResponse(
        schedule_id=resp_id,
        global_conf=GlobalScheduleConfig(
            frame_s_index=request.config.frame_s_index,
            num_frames_max=request.config.num_frames_max,
            test_payload_bytes=32, # Configurable?
            retrans_mode=request.config.retrans_mode,
            min_ack_epochs_before_retry=request.config.min_ack_epochs_before_retry,
            arq_max_retries=request.config.arq_max_retries,
            arq_window=request.config.arq_window,
            data_max_outstanding_gen=request.config.data_max_outstanding_gen,
            data_max_outstanding_relay=request.config.data_max_outstanding_relay,
            data_max_age_frames=request.config.data_max_age_frames
        ),
        nodes=node_schedules
    )

    resp_id += 1

    return resp

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)