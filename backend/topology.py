import math
import networkx as nx
import json
from typing import List, Tuple, Dict
from models import Node, LinkOverride, SimulationConfig
from geopy.distance import geodesic

class TopologyManager:
    def __init__(self, nodes: List[Node], overrides: List[LinkOverride], config: SimulationConfig):
        self.nodes = {n.id: n for n in nodes}
        # Map: (u, v) -> capacity
        self.known_links = {(lo.source_id, lo.target_id): lo.capacity_bps for lo in overrides}
        self.config = config
        
        # Derived structures
        self.links: List[Tuple[int, int]] = []
        self.link_capacities: Dict[Tuple[int, int], float] = {}
        self.interference_graph: nx.Graph = nx.Graph()
        self.cliques: List[List[Tuple[int, int]]] = []

    def build(self):
        """Main pipeline to build the network model"""
        self._identify_links()
        self._build_conflict_graph()
        self._find_cliques()

    def _identify_links(self):
        """
        Populates self.links based on input data.
        If 'overrides' (Neighbor Table) exists, we use that exclusively.
        Otherwise, we fall back to physics estimates.
        """
        # 1. Use provided Neighbor Table (Preferred)
        if self.known_links:
            for (u, v), cap in self.known_links.items():
                if cap > 0:
                    self.links.append((u, v))
                    self.link_capacities[(u, v)] = cap
            return

        # 2. Fallback: Physics calculation (for pure simulation)
        node_ids = list(self.nodes.keys())
        for i in range(len(node_ids)):
            for j in range(len(node_ids)):
                u_id = node_ids[i]
                v_id = node_ids[j]
                if u_id == v_id: continue
                
                dist = self._get_distance(self.nodes[u_id], self.nodes[v_id])
                cap = self._calculate_rf_capacity(dist)
                
                if cap > 0:
                    self.links.append((u_id, v_id))
                    self.link_capacities[(u_id, v_id)] = cap

    def _build_conflict_graph(self):
        """
        Nodes in this graph are LINKS. 
        Edges exist if links cannot be active simultaneously on the SAME channel.
        """
        self.interference_graph.add_nodes_from(self.links)
        
        link_list = self.links
        
        # Build a helper set for fast lookup of "Is X a neighbor of Y?"
        # We assume if a link exists in self.links, they are neighbors/can interfere.
        neighbor_set = set(self.links)

        for i in range(len(link_list)):
            for j in range(i + 1, len(link_list)):
                l1 = link_list[i] # u -> v
                l2 = link_list[j] # a -> b
                
                u, v = l1[0], l1[1]
                a, b = l2[0], l2[1]

                conflict = False
                
                # Condition 1: Shared Node (Radio Constraint)
                # A node cannot Transmit and Receive at the same time
                # Nor can it handle two different links at the same time
                if len({u, v, a, b}) < 4:
                    conflict = True
                
                # Condition 2: Interference (The "Can I Hear You" Test)
                # If we rely on comms range, we check the neighbor set.
                
                # Does Sender U jam Receiver B?
                elif (u, b) in neighbor_set:
                    conflict = True
                
                # Does Sender A jam Receiver V?
                elif (a, v) in neighbor_set:
                    conflict = True
                
                if conflict:
                    self.interference_graph.add_edge(l1, l2)

    def _find_cliques(self):
        self.cliques = list(nx.find_cliques(self.interference_graph))

    def _get_distance(self, n1: Node, n2: Node) -> float:
        if n1.lat is not None and n2.lat is not None:
            return geodesic((n1.lat, n1.lon), (n2.lat, n2.lon)).meters
        return 0.0

    def _calculate_rf_capacity(self, dist: float) -> float:
        # Fallback physics if no table provided
        # Simple threshold for demo
        if dist > 2000: return 0.0
        if dist > 1000: return 500.0  # SF12
        if dist > 500: return 2000.0  # SF9
        return 5400.0                 # SF7

def export_topology_to_json(filename: str, nodes: List[Node], overrides: List[LinkOverride], config: SimulationConfig):
    """
    Exports a topology configuration to a JSON file compatible with the Frontend import.
    """
    data = {
        "nodes": [
            {
                "id": n.id, "name": n.name, "type": n.type, 
                "lat": n.lat, "lon": n.lon, 
                "radio_count": n.radio_count, "elevation_m": n.elevation_m
            } for n in nodes
        ],
        "link_overrides": [
            {
                "source_id": l.source_id, "target_id": l.target_id, 
                "capacity_bps": l.capacity_bps
            } for l in overrides
        ],
        "config": {
            "num_channels": config.num_channels,
            "frequency_hz": config.frequency_hz,
            "tx_power_dbm": config.tx_power_dbm,
            "enable_pass_2_sparsification": config.enable_pass_2_sparsification
        }
    }
    
    try:
        # Ensure filename ends with .json
        if not filename.endswith('.json'):
            filename += '.json'
            
        with open(filename, 'w') as f:
            json.dump(data, f, indent=2)
        print(f"   -> 💾 Saved topology to {filename}")
        return True
    except Exception as e:
        print(f"   -> ⚠ Failed to save topology: {e}")
        return False