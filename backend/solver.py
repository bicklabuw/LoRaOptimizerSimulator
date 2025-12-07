import pulp
from typing import List, Dict, Tuple

from models import SolverResult, LinkResult, GeneratorResult, ScheduleDiagnostics, NodeType
from topology import TopologyManager
from scheduler import TDMAScheduler


class NetworkSolver:
    """
    3-pass LP / MILP solver for max-min fair routing + TDMA airtime allocation.

    Pass 1 (LP): Maximize common fair rate x for all generators.
    Pass 2 (MILP, optional): Minimize total link-channel usage while keeping
        fairness within a small tolerance of Pass 1.
    Pass 3 (LP): Maximize total throughput subject to fairness floor and the
        sparsified topology from Pass 2.

    This version removes the old "virtual sink downlinks" and instead models
    ACK/overhead airtime explicitly as a proportional load on reverse links.
    """

    def __init__(self, topology: TopologyManager):
        self.topo = topology
        self.nodes = topology.nodes                      # id -> Node
        self.links: List[Tuple[int, int]] = topology.links  # directed links (u, v)
        self.caps: Dict[Tuple[int, int], float] = topology.link_capacities
        self.cliques = topology.cliques

        self.generators: List[int] = [
            n.id for n in self.nodes.values() if n.type == NodeType.GENERATOR
        ]
        self.base_stations: List[int] = [
            n.id for n in self.nodes.values() if n.type == NodeType.BASE_STATION
        ]

        # Channel indices
        self.channels: List[int] = list(range(self.topo.config.num_channels))

        # ACK overhead ratio: "gamma" = ack_bits / data_bits
        # (kept in SimulationConfig, but interpreted here as bit-ratio)
        self.ack_ratio: float = self.topo.config.ack_overhead_ratio

        # Build a reverse-link map for ACK airtime constraints
        self.reverse_link: Dict[Tuple[int, int], Tuple[int, int]] = {}
        link_set = set(self.links)
        for u, v in self.links:
            if (v, u) in link_set:
                self.reverse_link[(u, v)] = (v, u)

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------
    def solve(self) -> SolverResult:
        if not self.generators or not self.base_stations or not self.links:
            return self._empty_result("No generators, base stations, or links")

        # PASS 1: Max-min fairness
        fair_rate_floor, status = self._solve_pass_1()
        if status != "Optimal":
            return self._empty_result(f"Pass 1 {status}")

        print(f"[Solver] Pass 1 Fair Rate: {fair_rate_floor:.3f} bps")

        # PASS 2: Topology sparsification (optional)
        active_mask = None
        if self.topo.config.enable_pass_2_sparsification and fair_rate_floor > 0.0:
            active_mask, status2 = self._solve_pass_2(fair_rate_floor)
            if status2 != "Optimal":
                # Fallback: skip sparsification and continue with full topology
                print(f"[Solver] Pass 2 {status2}, skipping sparsification.")
                active_mask = None

        # PASS 3: Max total throughput with fairness floor
        return self._solve_pass_3(fair_rate_floor, active_mask)

    # ------------------------------------------------------------------
    # Pass 1: Max-min fairness
    # ------------------------------------------------------------------
    def _solve_pass_1(self) -> Tuple[float, str]:
        prob = pulp.LpProblem("Pass1_Fairness", pulp.LpMaximize)

        # Fair rate variable
        x = pulp.LpVariable("FairRate", lowBound=0)

        # Flow and airtime variables
        f = {g: pulp.LpVariable.dicts(f"f1_{g}", self.links, lowBound=0) for g in self.generators}
        t_keys = [(u, v, c) for (u, v) in self.links for c in self.channels]
        t = pulp.LpVariable.dicts("t1", t_keys, lowBound=0, upBound=1)

        # Objective: maximize common rate x
        prob += x

        # Constraints
        self._add_flow_conservation(prob, f, x_var=x)
        self._add_capacity_constraints(prob, f, t)
        self._add_radio_constraints(prob, t)
        self._add_clique_constraints(prob, t)
        self._add_ack_constraints(prob, f, t)

        prob.solve(pulp.PULP_CBC_CMD(msg=False))
        status = pulp.LpStatus[prob.status]

        if status != "Optimal":
            return 0.0, status

        fair_rate = float(pulp.value(x)) if pulp.value(x) is not None else 0.0
        return fair_rate, status

    # ------------------------------------------------------------------
    # Pass 2: Sparsification MILP
    # ------------------------------------------------------------------
    def _solve_pass_2(self, fair_rate_floor: float):
        prob = pulp.LpProblem("Pass2_Sparsity", pulp.LpMinimize)

        t_keys = [(u, v, c) for (u, v) in self.links for c in self.channels]
        u_bin = pulp.LpVariable.dicts("u_bin", t_keys, cat="Binary")
        t = pulp.LpVariable.dicts("t2", t_keys, lowBound=0, upBound=1)
        f = {g: pulp.LpVariable.dicts(f"f2_{g}", self.links, lowBound=0) for g in self.generators}

        # Objective: minimize number of active link-channel pairs
        prob += pulp.lpSum([u_bin[k] for k in t_keys])

        # Fairness floor, with small relaxation factor
        self._add_flow_conservation(prob, f, x_val=fair_rate_floor * 0.9999)
        self._add_capacity_constraints(prob, f, t)
        self._add_radio_constraints(prob, t)
        self._add_clique_constraints(prob, t)
        self._add_ack_constraints(prob, f, t)

        # Channel binding: airtime only if active
        for k in t_keys:
            prob += (t[k] <= u_bin[k])

        prob.solve(pulp.PULP_CBC_CMD(msg=False))
        status = pulp.LpStatus[prob.status]

        active_mask: Dict[Tuple[int, int, int], int] = {}
        if status == "Optimal":
            for k in t_keys:
                if pulp.value(u_bin[k]) is not None and pulp.value(u_bin[k]) > 0.5:
                    active_mask[k] = 1
                else:
                    active_mask[k] = 0

        return active_mask, status

    # ------------------------------------------------------------------
    # Pass 3: Maximize total throughput with fairness floor
    # ------------------------------------------------------------------
    def _solve_pass_3(self, fair_rate_floor: float, active_mask: Dict = None) -> SolverResult:
        prob = pulp.LpProblem("Pass3_Throughput", pulp.LpMaximize)

        # Per-generator rates
        r_gen = pulp.LpVariable.dicts("r_gen", self.generators, lowBound=0)

        # Flow and airtime variables
        t_keys = [(u, v, c) for (u, v) in self.links for c in self.channels]
        t = pulp.LpVariable.dicts("t3", t_keys, lowBound=0, upBound=1)
        f = {g: pulp.LpVariable.dicts(f"f3_{g}", self.links, lowBound=0) for g in self.generators}

        # Objective: maximize sum of generator rates
        prob += pulp.lpSum([r_gen[g] for g in self.generators])

        # Fairness floor for each generator
        for g in self.generators:
            prob += (r_gen[g] >= fair_rate_floor * 0.9999)

        # Apply sparsified topology mask, if provided
        if active_mask is not None:
            for k in t_keys:
                if active_mask.get(k, 0) == 0:
                    prob += (t[k] == 0)

        # Constraints
        self._add_flow_conservation(prob, f, r_gen_vars=r_gen)
        self._add_capacity_constraints(prob, f, t)
        self._add_radio_constraints(prob, t)
        self._add_clique_constraints(prob, t)
        self._add_ack_constraints(prob, f, t)

        prob.solve(pulp.PULP_CBC_CMD(msg=False))
        status = pulp.LpStatus[prob.status]

        if status != "Optimal":
            return self._empty_result(f"Pass 3 {status}")

        # ------------------------------------------------------------------
        # Build results
        # ------------------------------------------------------------------
        # Generator rates
        gen_results: List[GeneratorResult] = []
        for g in self.generators:
            val = pulp.value(r_gen[g])
            gen_results.append(
                GeneratorResult(node_id=g, rate_bps=float(val) if val is not None else 0.0)
            )

        # Active links with per-channel airtime and total flow
        link_results: List[LinkResult] = []
        for (u, v) in self.links:
            cap = self.caps[(u, v)]
            # Total flow (sum over generators)
            total_flow = 0.0
            for g in self.generators:
                val = pulp.value(f[g][(u, v)])
                if val is not None:
                    total_flow += float(val)

            # For each channel, decide airtime fraction and record only if non-trivial
            for c in self.channels:
                val_t = pulp.value(t[(u, v, c)])
                airtime = float(val_t) if val_t is not None else 0.0
                if airtime <= 1e-6 and total_flow <= 1e-6:
                    continue

                link_results.append(
                    LinkResult(
                        source_id=u,
                        target_id=v,
                        channel=c,
                        airtime_fraction=airtime,
                        capacity_bps=cap,
                        flow_bps=total_flow,
                    )
                )

        print("[Solver] Scheduling links...")
        scheduler = TDMAScheduler(link_results, self.cliques, self.topo.config.num_channels)
        scheduled_links = scheduler.schedule()

        # Build schedule diagnostics (defensive defaults in case you ever change scheduler)
        frame_ticks = getattr(scheduler, "frame_ticks", 10000)
        frame_stretch = getattr(scheduler, "frame_stretch", 1.0)
        had_overflow = getattr(scheduler, "had_overflow", False)
        overflow_indices = getattr(scheduler, "overflow_link_indices", [])

        schedule_diagnostics = ScheduleDiagnostics(
            frame_ticks=frame_ticks,
            frame_stretch=frame_stretch,
            had_overflow=had_overflow,
            overflow_links=[
                (
                    scheduled_links[i].source_id,
                    scheduled_links[i].target_id,
                    scheduled_links[i].channel,
                )
                for i in overflow_indices
            ],
        )

        return SolverResult(
            status=status,
            fair_rate=fair_rate_floor,
            total_throughput=sum(gr.rate_bps for gr in gen_results),
            active_links=scheduled_links,
            generator_rates=gen_results,
            clique_count=len(self.cliques),
            schedule_diagnostics=schedule_diagnostics,
        )

    # ------------------------------------------------------------------
    # Constraint helpers
    # ------------------------------------------------------------------
    def _add_flow_conservation(self, prob, f, x_var=None, x_val=None, r_gen_vars=None):
        """
        Flow conservation for each commodity (generator) at each node.

        For each generator g and node v:
            sum_out(g, v) - sum_in(g, v) = Δ

        where Δ is:
            * x_var / x_val / r_gen_vars[g]   if v == g (source)
            * 0                                if v is relay
            * unconstrained (no equality)      if v is a base station
        """
        for g in self.generators:
            for n_id in self.nodes:
                flow_out = pulp.lpSum([f[g][l] for l in self.links if l[0] == n_id])
                flow_in = pulp.lpSum([f[g][l] for l in self.links if l[1] == n_id])
                net = flow_out - flow_in

                if n_id == g:
                    if r_gen_vars is not None:
                        prob += (net == r_gen_vars[g])
                    elif x_var is not None:
                        prob += (net == x_var)
                    elif x_val is not None:
                        prob += (net == x_val)
                elif n_id in self.base_stations:
                    # Sink nodes: no explicit equality constraint; they absorb flow.
                    continue
                else:
                    prob += (net == 0)

    def _add_capacity_constraints(self, prob, f, t):
        """
        Standard link capacity:
            sum_k f_k(l) <= Cap_l * sum_c t_l,c
        """
        for l in self.links:
            total_flow = pulp.lpSum([f[g][l] for g in self.generators])
            total_time = pulp.lpSum([t[(l[0], l[1], c)] for c in self.channels])
            prob += (total_flow <= self.caps[l] * total_time)

    def _add_radio_constraints(self, prob, t):
        """
        Half-duplex radio constraints:
            For each node v:
                sum_{l incident on v} sum_c t_l,c <= N_radio(v)
        Currently we assume 1 radio per node (N_radio = 1).
        """
        for n_id in self.nodes:
            relevant_t = []
            for (u, v) in self.links:
                if u == n_id or v == n_id:
                    for c in self.channels:
                        relevant_t.append(t[(u, v, c)])
            prob += (pulp.lpSum(relevant_t) <= 1.0)

    def _add_clique_constraints(self, prob, t):
        """
        Maximal clique constraints:

        For each clique Q and channel c:
            sum_{l in Q} t_l,c <= 1
        """
        for clique in self.cliques:
            for c in self.channels:
                clique_time = pulp.lpSum([t[(l[0], l[1], c)] for l in clique])
                prob += (clique_time <= 1.0)

    def _add_ack_constraints(self, prob, f, t):
        """
        ACK / overhead airtime constraints.

        For each data link l = (u, v) that has a reverse link r = (v, u),
        we require that there is enough airtime on r to carry ACK bits
        proportional to the forward data bits.

        Let gamma = ack_ratio = ack_bits / data_bits. Then:

            gamma * F_l <= Cap_r * sum_c t_r,c

        where F_l is the total data rate on (u, v) (sum over generators),
        and Cap_r is the RF capacity of the reverse link.
        """
        gamma = self.ack_ratio
        if gamma <= 0.0:
            return

        for l in self.links:
            u, v = l
            if l not in self.reverse_link:
                continue  # No reverse path; skip ACK constraint for this link

            r = self.reverse_link[l]
            # Total forward data on l
            total_fwd = pulp.lpSum([f[g][l] for g in self.generators])
            # Total airtime on reverse link r
            total_ack_time = pulp.lpSum([t[(r[0], r[1], c)] for c in self.channels])
            prob += (gamma * total_fwd <= self.caps[r] * total_ack_time)

    # ------------------------------------------------------------------
    # Utility
    # ------------------------------------------------------------------
    def _empty_result(self, status: str) -> SolverResult:
        return SolverResult(
            status=status,
            fair_rate=0.0,
            total_throughput=0.0,
            active_links=[],
            generator_rates=[],
            clique_count=len(self.cliques),
        )
