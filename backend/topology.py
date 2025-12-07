import math
import json
from typing import List, Tuple, Dict

import networkx as nx
from geopy.distance import geodesic

from models import Node, LinkOverride, SimulationConfig, NodeType


class TopologyManager:
    """
    Topology + conflict graph builder.

    Responsibilities:
    - Decide which directed links (u, v) exist and their RF capacities.
    - Build an edge-based conflict graph between links based on:
        * shared endpoints (half-duplex / same-radio),
        * sender jamming another receiver.
    - Compute maximal cliques of the conflict graph for the LP/MILP.
    """

    def __init__(self, nodes: List[Node], overrides: List[LinkOverride], config: SimulationConfig):
        # Public attributes used by the solver
        self.nodes: Dict[int, Node] = {n.id: n for n in nodes}
        self.known_links: Dict[Tuple[int, int], float] = {
            (lo.source_id, lo.target_id): lo.capacity_bps for lo in overrides
        }
        self.config = config

        # Populated by build()
        self.links: List[Tuple[int, int]] = []                # directed links (u, v)
        self.link_capacities: Dict[Tuple[int, int], float] = {}  # (u, v) -> capacity_bps
        self.interference_graph: nx.Graph = nx.Graph()
        self.cliques: List[List[Tuple[int, int]]] = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def build(self) -> None:
        """Run all preprocessing steps."""
        self._identify_links()
        self._build_conflict_graph()
        self._find_cliques()

    # ------------------------------------------------------------------
    # Link identification
    # ------------------------------------------------------------------
    def _identify_links(self) -> None:
        """
        Populate self.links and self.link_capacities.

        If link_overrides are provided, we trust them and build exactly those
        directed links (subject to capacity_bps > 0).

        Otherwise, we create a directed link (u, v) for every ordered pair of
        distinct nodes whose RF capacity is > 0 according to _calculate_rf_capacity.
        """
        self.links.clear()
        self.link_capacities.clear()

        if self.known_links:
            for (u, v), cap in self.known_links.items():
                if cap > 0.0:
                    self.links.append((u, v))
                    self.link_capacities[(u, v)] = cap
            return

        node_ids = list(self.nodes.keys())
        for i in range(len(node_ids)):
            for j in range(len(node_ids)):
                u_id = node_ids[i]
                v_id = node_ids[j]
                if u_id == v_id:
                    continue

                dist = self._get_distance(self.nodes[u_id], self.nodes[v_id])
                cap = self._calculate_rf_capacity(dist)
                if cap > 0.0:
                    self.links.append((u_id, v_id))
                    self.link_capacities[(u_id, v_id)] = cap

    # ------------------------------------------------------------------
    # Conflict graph and cliques
    # ------------------------------------------------------------------
    def _build_conflict_graph(self) -> None:
        """
        Build an undirected conflict graph where:
        - Each vertex is a directed link (u, v).
        - An undirected edge between l1 and l2 means they cannot be active
          simultaneously on the same channel.

        Conflict rules:
        - If the two links share any endpoint (u, v, a, or b), they conflict
          (half-duplex / same-radio constraint).
        - Else, if the transmitter of l1 can jam the receiver of l2,
          or the transmitter of l2 can jam the receiver of l1, they conflict.
          This is approximated by checking if (u, b) or (a, v) is itself a
          valid link in the connectivity graph.
        """
        self.interference_graph = nx.Graph()
        self.interference_graph.add_nodes_from(self.links)

        link_list = list(self.links)
        neighbor_set = set(self.links)

        for i in range(len(link_list)):
            for j in range(i + 1, len(link_list)):
                l1 = link_list[i]
                l2 = link_list[j]
                u, v = l1
                a, b = l2

                conflict = False

                # Node sharing (any common endpoint)
                if len({u, v, a, b}) < 4:
                    conflict = True
                # Sender of l1 can jam receiver of l2
                elif (u, b) in neighbor_set:
                    conflict = True
                # Sender of l2 can jam receiver of l1
                elif (a, v) in neighbor_set:
                    conflict = True

                if conflict:
                    self.interference_graph.add_edge(l1, l2)

    def _find_cliques(self) -> None:
        """Compute maximal cliques of the conflict graph."""
        self.cliques = list(nx.find_cliques(self.interference_graph))

    # ------------------------------------------------------------------
    # RF / geometry helpers
    # ------------------------------------------------------------------
    def _get_distance(self, n1: Node, n2: Node) -> float:
        """
        Compute distance in meters between two nodes.

        If lat/lon are provided, use geodesic distance.
        Otherwise, treat as co-located (distance 0).
        """
        if n1.lat is not None and n2.lat is not None:
            return geodesic((n1.lat, n1.lon), (n2.lat, n2.lon)).meters
        return 0.0

    def _calculate_rf_capacity(self, dist: float) -> float:
        """
        Very simple RF capacity model (placeholder):

        - > 2000 m  -> no link
        - 1000–2000 ->  500 bps
        -  500–1000 -> 2000 bps
        -    0–500  -> 5400 bps
        """
        if dist > 2000:
            return 0.0
        if dist > 1000:
            return 500.0
        if dist > 500:
            return 2000.0
        return 5400.0


# ----------------------------------------------------------------------
# Utility for exporting a topology + config to JSON for offline debugging
# ----------------------------------------------------------------------
def export_topology_to_json(
    filename: str,
    nodes: List[Node],
    overrides: List[LinkOverride],
    config: SimulationConfig,
) -> bool:
    data = {
        "nodes": [
            {
                "id": n.id,
                "name": n.name,
                "type": n.type,
                "lat": n.lat,
                "lon": n.lon,
            }
            for n in nodes
        ],
        "link_overrides": [
            {
                "source_id": l.source_id,
                "target_id": l.target_id,
                "capacity_bps": l.capacity_bps,
            }
            for l in overrides
        ],
        "config": dict(config),
    }

    try:
        if not filename.endswith(".json"):
            filename += ".json"
        with open(filename, "w") as f:
            json.dump(data, f, indent=2)
        print(f"   -> 💾 Saved topology to {filename}")
        return True
    except Exception as e:
        print(f"   -> ⚠ Failed to save topology: {e}")
        return False
