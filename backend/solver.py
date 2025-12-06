import pulp
from typing import List, Dict, Tuple
from models import SolverResult, LinkResult, GeneratorResult, NodeType
from topology import TopologyManager
# NEW IMPORT
from scheduler import TDMAScheduler

class NetworkSolver:
    def __init__(self, topology: TopologyManager):
        self.topo = topology
        self.nodes = topology.nodes
        self.links = topology.links
        self.caps = topology.link_capacities
        self.cliques = topology.cliques
        
        self.generators = [n.id for n in self.nodes.values() if n.type == NodeType.GENERATOR]
        self.base_stations = [n.id for n in self.nodes.values() if n.type == NodeType.BASE_STATION]
        
        self.channels = list(range(self.topo.config.num_channels))

    def solve(self) -> SolverResult:
        # ... (Previous Pass 1 and Pass 2 logic remains UNCHANGED) ...
        # ... Just copy the solve() code from previous turn until the return statement ...
        
        if not self.generators or not self.base_stations:
            return self._empty_result("No Generators or Base Stations defined")

        # PASS 1
        prob1 = pulp.LpProblem("Pass1_Fairness", pulp.LpMaximize)
        x = pulp.LpVariable("FairRate", lowBound=0)
        total_capacity = sum(self.caps.values())
        if total_capacity > 0:
            prob1 += (x <= total_capacity, "Sanity_Bound")
        
        f = {gen: pulp.LpVariable.dicts(f"f_{gen}", self.links, lowBound=0) for gen in self.generators}
        t_keys = [(u, v, c) for (u, v) in self.links for c in self.channels]
        t = pulp.LpVariable.dicts("t", t_keys, lowBound=0, upBound=1)
        prob1 += x
        self._add_flow_conservation(prob1, f, x_var=x)
        self._add_capacity_constraints(prob1, f, t)
        self._add_radio_constraints(prob1, t)
        self._add_clique_constraints(prob1, t)
        prob1.solve(pulp.PULP_CBC_CMD(msg=False))
        if pulp.LpStatus[prob1.status] != "Optimal":
            return self._empty_result(f"Pass 1 {pulp.LpStatus[prob1.status]}")
        fair_rate_floor = pulp.value(x)
        print(f"[Solver] Pass 1 Fair Rate: {fair_rate_floor}")
        
        active_mask = None
        if self.topo.config.enable_pass_2_sparsification and fair_rate_floor > 0.001:
            active_mask = self._solve_pass_2(fair_rate_floor)
            if active_mask is None:
                print("[Solver] Pass 2 Infeasible/Failed. Falling back to full topology.")
        
        # PASS 3
        return self._solve_pass_3(fair_rate_floor, active_mask)

    # ... (Keep _solve_pass_2 logic unchanged) ...
    def _solve_pass_2(self, fair_rate_floor: float):
        prob2 = pulp.LpProblem("Pass2_Sparsity", pulp.LpMinimize)
        t_keys = [(u, v, c) for (u, v) in self.links for c in self.channels]
        u_bin = pulp.LpVariable.dicts("u_bin", t_keys, cat='Binary')
        t = pulp.LpVariable.dicts("t", t_keys, lowBound=0, upBound=1)
        f = {gen: pulp.LpVariable.dicts(f"f2_{gen}", self.links, lowBound=0) for gen in self.generators}
        prob2 += pulp.lpSum([u_bin[k] for k in t_keys])
        self._add_flow_conservation(prob2, f, x_val=fair_rate_floor * 0.9999)
        self._add_capacity_constraints(prob2, f, t)
        self._add_radio_constraints(prob2, t)
        self._add_clique_constraints(prob2, t)
        for k in t_keys: prob2 += (t[k] <= u_bin[k])
        prob2.solve(pulp.PULP_CBC_CMD(msg=False))
        if pulp.LpStatus[prob2.status] != "Optimal": return None 
        mask = {}
        for k in t_keys: mask[k] = 1 if pulp.value(u_bin[k]) > 0.5 else 0
        return mask

    def _solve_pass_3(self, fair_rate_floor: float, active_mask: Dict = None) -> SolverResult:
        prob3 = pulp.LpProblem("Pass3_Throughput", pulp.LpMaximize)
        
        r_gen = pulp.LpVariable.dicts("r_gen", self.generators, lowBound=0)
        t_keys = [(u, v, c) for (u, v) in self.links for c in self.channels]
        t = pulp.LpVariable.dicts("t", t_keys, lowBound=0, upBound=1)
        f = {
            gen: pulp.LpVariable.dicts(f"f3_{gen}", self.links, lowBound=0)
            for gen in self.generators
        }
        
        prob3 += pulp.lpSum([r_gen[g] for g in self.generators])
        
        for g in self.generators:
            prob3 += (r_gen[g] >= fair_rate_floor * 0.9999)
            
        if active_mask:
            for k in t_keys:
                if active_mask.get(k, 0) == 0:
                    prob3 += (t[k] == 0)
        
        self._add_flow_conservation(prob3, f, r_gen_vars=r_gen)
        self._add_capacity_constraints(prob3, f, t)
        self._add_radio_constraints(prob3, t)
        self._add_clique_constraints(prob3, t)
        
        prob3.solve(pulp.PULP_CBC_CMD(msg=False))
        
        if pulp.LpStatus[prob3.status] != "Optimal":
             return self._empty_result(f"Pass 3 {pulp.LpStatus[prob3.status]}")

        # Build Results
        link_results = []
        for (u, v, c) in t_keys:
            val_t = pulp.value(t[(u, v, c)])
            if val_t and val_t > 0.001:
                total_link_flow = sum(pulp.value(f[g][(u,v)]) for g in self.generators)
                total_link_time = sum(pulp.value(t[(u,v,ch)]) for ch in self.channels)
                
                flow_on_channel = 0
                if total_link_time > 0:
                    flow_on_channel = total_link_flow * (val_t / total_link_time)

                link_results.append(LinkResult(
                    source_id=u, target_id=v, channel=c,
                    airtime_fraction=val_t,
                    capacity_bps=self.caps[(u,v)],
                    flow_bps=flow_on_channel
                ))
        
        gen_results = [GeneratorResult(node_id=g, rate_bps=pulp.value(r_gen[g])) for g in self.generators]
        
        # ==========================================
        # NEW: Run the Production Scheduler
        # ==========================================
        print("[Solver] Running Resource-Constrained Scheduler...")
        scheduler = TDMAScheduler(link_results, self.cliques, self.topo.config.num_channels)
        scheduled_links = scheduler.schedule()

        return SolverResult(
            status=pulp.LpStatus[prob3.status],
            fair_rate=fair_rate_floor,
            total_throughput=sum(gr.rate_bps for gr in gen_results),
            active_links=scheduled_links,
            generator_rates=gen_results,
            clique_count=len(self.cliques)
        )

    # ... (Keep helpers _add_flow_conservation, etc. unchanged) ...
    def _add_flow_conservation(self, prob, f, x_var=None, x_val=None, r_gen_vars=None):
        for gen in self.generators:
            for n_id in self.nodes:
                flow_out = pulp.lpSum([f[gen][l] for l in self.links if l[0] == n_id])
                flow_in = pulp.lpSum([f[gen][l] for l in self.links if l[1] == n_id])
                net_flow = flow_out - flow_in
                if n_id == gen:
                    if r_gen_vars is not None: prob += (net_flow == r_gen_vars[gen])
                    elif x_var is not None: prob += (net_flow == x_var)
                    elif x_val is not None: prob += (net_flow == x_val)
                elif n_id in self.base_stations: pass
                else: prob += (net_flow == 0)

    def _add_capacity_constraints(self, prob, f, t):
        for l in self.links:
            total_flow = pulp.lpSum([f[g][l] for g in self.generators])
            total_time = pulp.lpSum([t[(l[0], l[1], c)] for c in self.channels])
            prob += (total_flow <= self.caps[l] * total_time)

    def _add_radio_constraints(self, prob, t):
        for n_id in self.nodes:
            relevant_t = []
            for (u, v) in self.links:
                if u == n_id or v == n_id:
                    for c in self.channels:
                        relevant_t.append(t[(u, v, c)])
            prob += (pulp.lpSum(relevant_t) <= 1.0)

    def _add_clique_constraints(self, prob, t):
        for clique in self.cliques:
            for c in self.channels:
                clique_time = pulp.lpSum([t[(l[0], l[1], c)] for l in clique])
                prob += (clique_time <= 1.0)
    
    def _empty_result(self, status):
        return SolverResult(status=status, fair_rate=0, total_throughput=0, active_links=[], generator_rates=[], clique_count=0)