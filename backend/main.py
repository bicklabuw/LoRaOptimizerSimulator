from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from models import SimulationRequest, SolverResult
from topology import TopologyManager
from solver import NetworkSolver
import time

app = FastAPI(title="LoRa Mesh Optimizer", version="0.0.1")

# Allow CORS for React Frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def health_check():
    return {"status": "online", "version": "0.0.1"}

@app.post("/optimize", response_model=SolverResult)
def run_optimization(request: SimulationRequest):
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)