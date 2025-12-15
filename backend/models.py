from pydantic import BaseModel, Field
from typing import List, Optional
from enum import Enum

class NodeType(str, Enum):
    GENERATOR = "GENERATOR"
    RELAY = "RELAY"
    BASE_STATION = "BASE_STATION"

class Node(BaseModel):
    id: int
    name: str
    type: NodeType
    lat: Optional[float] = None
    lon: Optional[float] = None
    radio_count: int = 1
    elevation_m: float = 0.0

class LinkOverride(BaseModel):
    source_id: int
    target_id: int
    capacity_bps: float
    # Default to -1 to signify it wasn't inputted
    spreading_factor: int = -1  

class SimulationConfig(BaseModel):
    num_channels: int = 1
    frequency_hz: float = 915_000_000
    tx_power_dbm: float = 22.0
    enable_pass_2_sparsification: bool = True 
    
    # CHANGED: Dynamic overhead instead of fixed fraction
    # 0.10 means 10% of RX time is required for TX (ACKs/Beacons)
    ack_overhead_ratio: float = 0.10 
    
    # --- New Configs for Schedule Generation ---
    # 0=10s, 1=20s, 2=40s, 3=80s
    frame_s_index: int = 0  
    # 0=None, 1=Hop-by-Hop
    retrans_mode: int = 1   
    num_frames_max: int = 15
    min_ack_epochs_before_retry: int = 1
    arq_max_retries: int = 2
    arq_window: int = 128
    data_max_outstanding_gen: int = 128
    data_max_outstanding_relay: int = 64
    data_max_age_frames: int = 4

class SimulationRequest(BaseModel):
    nodes: List[Node]
    link_overrides: List[LinkOverride] = [] 
    config: SimulationConfig

class ScheduleFragment(BaseModel):
    start: float
    duration: float
    is_ack: bool = False

class LinkResult(BaseModel):
    source_id: int
    target_id: int
    channel: int
    airtime_fraction: float
    capacity_bps: float
    flow_bps: float
    schedule: List[ScheduleFragment] = [] 
    start_offset: float = 0.0

class GeneratorResult(BaseModel):
    node_id: int
    rate_bps: float

class ScheduleDiagnostics(BaseModel):
    # Total frame length in scheduler ticks (10000 = nominal)
    frame_ticks: int
    # How much the frame was stretched vs nominal (1.0 = no stretch)
    frame_stretch: float
    # True if any link had to be scheduled past the nominal frame
    had_overflow: bool
    # Optional list of (src, dst, channel) triples for links that extend past the frame
    overflow_links: List[tuple[int, int, int]] = []

class SolverResult(BaseModel):
    status: str
    fair_rate: float
    total_throughput: float
    active_links: List[LinkResult]
    generator_rates: List[GeneratorResult]
    clique_count: int
    schedule_diagnostics: Optional[ScheduleDiagnostics] = None

# --- New Output Models for /generate_schedule ---

class GlobalScheduleConfig(BaseModel):
    frame_s_index: int
    num_frames_max: int
    test_payload_bytes: int = 32

    retrans_mode: int
    min_ack_epochs_before_retry: int
    arq_max_retries: int
    arq_window: int

    data_max_outstanding_gen: int
    data_max_outstanding_relay: int
    data_max_age_frames: int

class ScheduleSlot(BaseModel):
    other_id: int
    is_tx: int         # 1=TX, 0=RX
    is_ack: int        # 1=ACK, 0=Data
    sf: int
    ch: int
    start_tick: int
    dur_ticks: int

class NodeSchedule(BaseModel):
    node_id: int
    parent_id: int
    children: List[int]
    slots: List[ScheduleSlot]

class EmbeddedScheduleResponse(BaseModel):
    schedule_id: int
    # This ensures the JSON key is "global" while the Python attribute is "global_conf"
    global_conf: GlobalScheduleConfig = Field(..., alias="global")
    nodes: List[NodeSchedule]

    class Config:
        # Allows creating the object using global_conf name
        populate_by_name = True