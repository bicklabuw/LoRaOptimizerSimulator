import sys
import os

# Ensure we can import local modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from models import Node, NodeType, LinkOverride, SimulationConfig
from topology import TopologyManager, export_topology_to_json
from solver import NetworkSolver

# Global accumulator for results
test_results = []


def run_test(name, nodes, overrides, config, expected_rate, tolerance=0.001):
    print(f"\n===================================================")
    print(f"TEST: {name}")
    print(f"---------------------------------------------------")

    # 1. Build Topology
    topo = TopologyManager(nodes, overrides, config)
    topo.build()
    print(f"Topology: {len(nodes)} nodes, {len(topo.links)} links, {len(topo.cliques)} cliques")

    # 2. Solve
    solver = NetworkSolver(topo)
    result = solver.solve()

    # 3. Verify
    print(f"Solver Status: {result.status}")
    print(f"Achieved Rate: {result.fair_rate:.2f} bps")
    print(f"Expected Rate: {expected_rate:.2f} bps")

    is_pass = False
    diff = 0.0

    if result.status == "Optimal":
        diff = abs(result.fair_rate - expected_rate)
        if expected_rate > 0:
            is_pass = diff <= (expected_rate * tolerance)
        else:
            is_pass = diff < 0.001

    if is_pass:
        print("✅ PASSED")
    else:
        print(f"❌ FAILED (Off by {diff:.2f} bps)")
        if result.active_links:
            print("\n   [Active Links Trace]")
            for l in sorted(result.active_links, key=lambda x: (x.source_id, x.target_id, x.channel)):
                print(
                    f"   -> Link {l.source_id}->{l.target_id} ch{l.channel}: "
                    f"Airtime={l.airtime_fraction:.3f}, Flow={l.flow_bps:.1f}, Cap={l.capacity_bps}"
                )
        else:
            print("\n   [No Active Links Found]")

        # Export failure for frontend debugging using the shared utility
        filename = f"failed_scenario_{name.replace(' ', '_').replace('/', '').lower()}"
        export_topology_to_json(filename, nodes, overrides, config)

    test_results.append({
        "name": name,
        "passed": is_pass,
        "achieved": result.fair_rate,
        "expected": expected_rate
    })


def main():
    # Common Config
    cfg = SimulationConfig(
        num_channels=1,
        frequency_hz=915e6,
        tx_power_dbm=22,
        enable_pass_2_sparsification=True,
    )

    # "Gamma" = ACK bits / data bits
    ack_ratio = getattr(cfg, "ack_overhead_ratio", 0.0)
    base_capacity = 5400.0  # nominal bit rate used in tests

    # For symmetric fwd/rev capacity links, effective single-link rate is:
    #   C_eff = C / (1 + gamma)
    def base_single_link_rate(C=base_capacity):
        return C / (1.0 + ack_ratio)

    # Helper for asymmetric fwd/rev capacities (Scenario 10):
    # Max F s.t. t_f >= F/Cf, t_r >= gamma*F/Cr, t_f + t_r <= 1
    # => F <= 1 / (1/Cf + gamma/Cr) = Cf * Cr / (Cr + gamma*Cf)
    def ack_limited_rate(Cf, Cr):
        if Cf <= 0.0 or Cr <= 0.0:
            return 0.0
        return (Cf * Cr) / (Cr + ack_ratio * Cf)

    # =======================================================
    # SCENARIO 1: The Direct Link (Baseline)
    # Gen A -> Sink (with reverse link for ACKs).
    # Expected: C / (1 + gamma)
    # =======================================================
    nodes_1 = [
        Node(id=1, name="Gen", type=NodeType.GENERATOR, lat=0, lon=0),
        Node(id=2, name="Sink", type=NodeType.BASE_STATION, lat=0.001, lon=0)
    ]
    overrides_1 = [
        LinkOverride(source_id=1, target_id=2, capacity_bps=base_capacity),
        LinkOverride(source_id=2, target_id=1, capacity_bps=base_capacity),  # reverse for ACKs
    ]

    run_test("Direct Link (Baseline)", nodes_1, overrides_1, cfg,
             expected_rate=base_single_link_rate())

    # =======================================================
    # SCENARIO 2: The Relay Penalty (Half Duplex)
    # Gen -> Relay -> Sink (with reverse links for ACKs).
    # Expected: 50% of single-link rate = C / (2 * (1 + gamma))
    # =======================================================
    nodes_2 = [
        Node(id=1, name="Gen", type=NodeType.GENERATOR, lat=0, lon=0),
        Node(id=2, name="Relay", type=NodeType.RELAY, lat=0.001, lon=0),
        Node(id=3, name="Sink", type=NodeType.BASE_STATION, lat=0.002, lon=0)
    ]
    overrides_2 = [
        LinkOverride(source_id=1, target_id=2, capacity_bps=base_capacity),
        LinkOverride(source_id=2, target_id=1, capacity_bps=base_capacity),  # ACK
        LinkOverride(source_id=2, target_id=3, capacity_bps=base_capacity),
        LinkOverride(source_id=3, target_id=2, capacity_bps=base_capacity),  # ACK
    ]

    run_test("2-Hop Relay (Half Duplex)", nodes_2, overrides_2, cfg,
             expected_rate=base_single_link_rate() / 2.0)

    # =======================================================
    # SCENARIO 3: The Interference Triangle (Shared Receiver)
    # Gen A -> Sink <- Gen B
    # Both Gens send to same Sink. Sink has 1 radio.
    # Expected: (C / (1 + gamma)) / 2 each.
    # =======================================================
    nodes_3 = [
        Node(id=1, name="Gen A", type=NodeType.GENERATOR, lat=0, lon=0),
        Node(id=2, name="Gen B", type=NodeType.GENERATOR, lat=0.0001, lon=0.0001),
        Node(id=3, name="Sink", type=NodeType.BASE_STATION, lat=0.001, lon=0)
    ]
    overrides_3 = [
        LinkOverride(source_id=1, target_id=3, capacity_bps=base_capacity),
        LinkOverride(source_id=3, target_id=1, capacity_bps=base_capacity),  # ACK
        LinkOverride(source_id=2, target_id=3, capacity_bps=base_capacity),
        LinkOverride(source_id=3, target_id=2, capacity_bps=base_capacity),  # ACK
    ]

    run_test("Interference Triangle", nodes_3, overrides_3, cfg,
             expected_rate=base_single_link_rate() / 2.0)

    # =======================================================
    # SCENARIO 4: The 'Hidden Node' (Spatial Reuse)
    # Gen A -> Sink A   ||   Gen B -> Sink B
    # Far apart. Should NOT interfere.
    # Expected: C / (1 + gamma) each.
    # =======================================================
    nodes_4 = [
        Node(id=1, name="Gen A", type=NodeType.GENERATOR, lat=0, lon=0),
        Node(id=2, name="Sink A", type=NodeType.BASE_STATION, lat=0.001, lon=0),
        Node(id=3, name="Gen B", type=NodeType.GENERATOR, lat=1.0, lon=0),
        Node(id=4, name="Sink B", type=NodeType.BASE_STATION, lat=1.001, lon=0),
    ]
    overrides_4 = [
        LinkOverride(source_id=1, target_id=2, capacity_bps=base_capacity),
        LinkOverride(source_id=2, target_id=1, capacity_bps=base_capacity),  # ACK
        LinkOverride(source_id=3, target_id=4, capacity_bps=base_capacity),
        LinkOverride(source_id=4, target_id=3, capacity_bps=base_capacity),  # ACK
    ]

    run_test("Spatial Reuse", nodes_4, overrides_4, cfg,
             expected_rate=base_single_link_rate())

    # =======================================================
    # SCENARIO 5: Asymmetric Interference (The "Jammer")
    # Gen A -> Sink A
    # Gen B -> Sink B
    # CRITICAL: Gen A is physically close to Sink B.
    # Expected: 2700 bps each in no-ACK world => C / (2 * (1 + gamma)) here.
    # =======================================================
    nodes_5 = [
        Node(id=1, name="Gen A", type=NodeType.GENERATOR, lat=0, lon=0),
        Node(id=2, name="Sink A", type=NodeType.BASE_STATION, lat=0, lon=-0.002),
        Node(id=3, name="Gen B", type=NodeType.GENERATOR, lat=0, lon=0.1),
        Node(id=4, name="Sink B", type=NodeType.BASE_STATION, lat=0, lon=0.0005)  # Close to Gen A
    ]
    overrides_5 = [
        # Main traffic + ACKs
        LinkOverride(source_id=1, target_id=2, capacity_bps=base_capacity),
        LinkOverride(source_id=2, target_id=1, capacity_bps=base_capacity),  # ACK
        LinkOverride(source_id=3, target_id=4, capacity_bps=base_capacity),
        LinkOverride(source_id=4, target_id=3, capacity_bps=base_capacity),  # ACK

        # Interference edge: Gen A -> Sink B (no reverse needed for ACK here)
        LinkOverride(source_id=1, target_id=4, capacity_bps=base_capacity),
        LinkOverride(source_id=4, target_id=1, capacity_bps=base_capacity), # ACK

         LinkOverride(source_id=2, target_id=4, capacity_bps=base_capacity),
        LinkOverride(source_id=4, target_id=2, capacity_bps=base_capacity), # ACK
    ]

    run_test("Asymmetric Interference", nodes_5, overrides_5, cfg,
             expected_rate=base_single_link_rate() / 2.0)

    # =======================================================
    # SCENARIO 6: Exposed Terminals (Parallel TX)
    # Gen A -> Sink A (West)
    # Gen B -> Sink B (East)
    # A and B hear each other, but Sinks are far apart.
    # Expected: C / (1 + gamma) each.
    # =======================================================
    nodes_6 = [
        Node(id=1, name="Gen A", type=NodeType.GENERATOR, lat=0, lon=0),
        Node(id=2, name="Sink A", type=NodeType.BASE_STATION, lat=0, lon=-1.0),
        Node(id=3, name="Gen B", type=NodeType.GENERATOR, lat=0, lon=0.001),  # Close to Gen A
        Node(id=4, name="Sink B", type=NodeType.BASE_STATION, lat=0, lon=1.0)
    ]
    overrides_6 = [
        # Main traffic + ACKs
        LinkOverride(source_id=1, target_id=2, capacity_bps=base_capacity),
        LinkOverride(source_id=2, target_id=1, capacity_bps=base_capacity),  # ACK
        LinkOverride(source_id=3, target_id=4, capacity_bps=base_capacity),
        LinkOverride(source_id=4, target_id=3, capacity_bps=base_capacity),  # ACK

        # Exposed terminal link (A <-> B)
        LinkOverride(source_id=1, target_id=3, capacity_bps=base_capacity),
        LinkOverride(source_id=3, target_id=1, capacity_bps=base_capacity),
    ]

    run_test("Exposed Terminals", nodes_6, overrides_6, cfg,
             expected_rate=base_single_link_rate())

    # =======================================================
    # SCENARIO 7: Sink Saturation (Star Topology)
    # 5 Generators -> 1 Sink
    # Sink Radio is 1.0 Time. Must split 5 ways.
    # Expected per gen: (C / (1 + gamma)) / 5
    # =======================================================
    nodes_7 = [Node(id=99, name="Sink", type=NodeType.BASE_STATION, lat=0, lon=0)]
    overrides_7 = []
    for i in range(5):
        nodes_7.append(Node(id=i, name=f"Gen{i}", type=NodeType.GENERATOR, lat=0.001, lon=i * 0.001))
        # Main traffic + ACKs
        overrides_7.append(LinkOverride(source_id=i, target_id=99, capacity_bps=base_capacity))
        overrides_7.append(LinkOverride(source_id=99, target_id=i, capacity_bps=base_capacity))  # ACK
        # Ensure they all interfere with each other at the Sink (gen-gen links)
        for j in range(i):
            overrides_7.append(LinkOverride(source_id=i, target_id=j, capacity_bps=base_capacity))

    run_test("Sink Saturation (5 Gens)", nodes_7, overrides_7, cfg,
             expected_rate=base_single_link_rate() / 5.0)

    # =======================================================
    # SCENARIO 8: The Bottleneck Relay (Butterfly)
    # G1 --\      /--> S1
    #       R --<
    # G2 --/      \--> S2
    #
    # Relay R must: RX G1, RX G2, TX S1, TX S2  -> 4 operations.
    # Expected: (C / (1 + gamma)) / 4
    # =======================================================
    nodes_8 = [
        Node(id=1, name="G1", type=NodeType.GENERATOR, lat=0, lon=0),
        Node(id=2, name="G2", type=NodeType.GENERATOR, lat=0, lon=0.001),
        Node(id=3, name="R", type=NodeType.RELAY, lat=0.002, lon=0.0005),
        Node(id=4, name="S1", type=NodeType.BASE_STATION, lat=0.004, lon=0),
        Node(id=5, name="S2", type=NodeType.BASE_STATION, lat=0.004, lon=0.001)
    ]
    overrides_8 = [
        # G1 -> R, G2 -> R + ACKs
        LinkOverride(source_id=1, target_id=3, capacity_bps=base_capacity),
        LinkOverride(source_id=3, target_id=1, capacity_bps=base_capacity),  # ACK
        LinkOverride(source_id=2, target_id=3, capacity_bps=base_capacity),
        LinkOverride(source_id=3, target_id=2, capacity_bps=base_capacity),  # ACK

        # R -> S1, R -> S2 + ACKs
        LinkOverride(source_id=3, target_id=4, capacity_bps=base_capacity),
        LinkOverride(source_id=4, target_id=3, capacity_bps=base_capacity),  # ACK
        LinkOverride(source_id=3, target_id=5, capacity_bps=base_capacity),
        LinkOverride(source_id=5, target_id=3, capacity_bps=base_capacity),  # ACK

        # Assume G1 and G2 interfere (close)
        LinkOverride(source_id=1, target_id=2, capacity_bps=base_capacity),
        LinkOverride(source_id=2, target_id=1, capacity_bps=base_capacity),
    ]

    run_test("Bottleneck Relay (Butterfly)", nodes_8, overrides_8, cfg,
             expected_rate=base_single_link_rate() / 4.0)

    # =======================================================
    # SCENARIO 9: The Long Chain (Interference Ripple)
    # G -> R1 -> R2 -> R3 -> S
    # 4 forwarding operations, all half-duplex.
    # Expected: (C / (1 + gamma)) / 4
    # =======================================================
    nodes_9 = [
        Node(id=0, name="G", type=NodeType.GENERATOR, lat=0, lon=0),
        Node(id=1, name="R1", type=NodeType.RELAY, lat=0, lon=0.001),
        Node(id=2, name="R2", type=NodeType.RELAY, lat=0, lon=0.002),
        Node(id=3, name="R3", type=NodeType.RELAY, lat=0, lon=0.003),
        Node(id=4, name="S", type=NodeType.BASE_STATION, lat=0, lon=0.004),
    ]
    overrides_9 = [
        # --- Traffic Links + ACKs ---
        LinkOverride(source_id=0, target_id=1, capacity_bps=base_capacity),
        LinkOverride(source_id=1, target_id=0, capacity_bps=base_capacity),  # ACK

        LinkOverride(source_id=1, target_id=2, capacity_bps=base_capacity),
        LinkOverride(source_id=2, target_id=1, capacity_bps=base_capacity),  # ACK

        LinkOverride(source_id=2, target_id=3, capacity_bps=base_capacity),
        LinkOverride(source_id=3, target_id=2, capacity_bps=base_capacity),  # ACK

        LinkOverride(source_id=3, target_id=4, capacity_bps=base_capacity),
        LinkOverride(source_id=4, target_id=3, capacity_bps=base_capacity),  # ACK

        # --- Interference Links (very low-cap "edges" just to generate cliques) ---
        LinkOverride(source_id=1, target_id=3, capacity_bps=0.001),
        LinkOverride(source_id=3, target_id=1, capacity_bps=0.001),

        LinkOverride(source_id=0, target_id=2, capacity_bps=0.001),
        LinkOverride(source_id=2, target_id=0, capacity_bps=0.001),

        LinkOverride(source_id=2, target_id=4, capacity_bps=0.001),
        LinkOverride(source_id=4, target_id=2, capacity_bps=0.001),
    ]

    run_test("Long Chain (25% Capacity)", nodes_9, overrides_9, cfg,
             expected_rate=(base_capacity - base_single_link_rate()) / 8.3 + base_single_link_rate() / 4.0)

    # =======================================================
    # SCENARIO 10: ACK-Limited Reverse Link
    #
    # 1 Gen -> 1 Sink, but reverse link has lower capacity.
    # Forward: 5400 bps, Reverse: 540 bps (e.g. weaker ACK link).
    #
    # Expected:
    #   F* = Cf * Cr / (Cr + gamma * Cf)
    # =======================================================
    nodes_10 = [
        Node(id=1, name="Gen", type=NodeType.GENERATOR, lat=0, lon=0),
        Node(id=2, name="Sink", type=NodeType.BASE_STATION, lat=0.001, lon=0)
    ]
    Cf = base_capacity
    Cr = base_capacity / 10.0  # weaker reverse link

    overrides_10 = [
        LinkOverride(source_id=1, target_id=2, capacity_bps=Cf),
        LinkOverride(source_id=2, target_id=1, capacity_bps=Cr),
    ]

    run_test("ACK-Limited Reverse Link", nodes_10, overrides_10, cfg,
             expected_rate=ack_limited_rate(Cf, Cr))

    # =======================================================
    # SUMMARY
    # =======================================================
    print("\n\n===================================================")
    print("TEST SUMMARY")
    print("===================================================")
    passed_count = sum(1 for r in test_results if r['passed'])

    for r in test_results:
        icon = "✅" if r['passed'] else "❌"
        note = ""
        if not r['passed']:
            note = f" (Got {r['achieved']:.1f}, Wanted {r['expected']:.1f})"
        print(f"{icon} {r['name']}{note}")

    print(f"\nTotal: {passed_count}/{len(test_results)} Passed")

    if passed_count != len(test_results):
        sys.exit(1)  # Exit with error code for CI/CD


if __name__ == "__main__":
    main()
