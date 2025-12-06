from pydantic import BaseModel
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

class SimulationConfig(BaseModel):
    num_channels: int = 1
    frequency_hz: float = 915_000_000
    tx_power_dbm: float = 22.0
    enable_pass_2_sparsification: bool = True 

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
    # List of time slots (fragments)
    schedule: List[ScheduleFragment] = [] 
    # start_offset is deprecated in favor of schedule list, but kept for compat if needed
    start_offset: float = 0.0

class GeneratorResult(BaseModel):
    node_id: int
    rate_bps: float

class SolverResult(BaseModel):
    status: str
    fair_rate: float
    total_throughput: float
    active_links: List[LinkResult]
    generator_rates: List[GeneratorResult]
    clique_count: int