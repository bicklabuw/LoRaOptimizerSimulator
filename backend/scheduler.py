from typing import List, Dict, Set, Tuple
from models import LinkResult, ScheduleFragment

# Resolution: 10,000 ticks = 1 logical TDMA frame
TICKS_PER_FRAME = 10000


class TDMAScheduler:
    """
    TDMA scheduler that:
    - Schedules each link individually (no hard TxBlocks).
    - Is channel-aware: cliques are enforced per channel.
    - Uses a structured greedy ordering to naturally group
      same-node, same-channel links together.
    - Runs a simple left-compaction pass to reduce fragmentation.
    - Emits extra logging and an ASCII visualization when overflow occurs.
    """

    def __init__(self, links: List[LinkResult], cliques: List[List[Tuple[int, int]]], num_channels: int):
        self.links = links
        self.num_channels = num_channels

        # Use cliques exactly as the solver sees them: directed (u, v) pairs.
        self.clique_sets: List[Set[Tuple[int, int]]] = []
        for c in cliques:
            self.clique_sets.append(set(c))

        # Stable link index space
        self.link_index: Dict[Tuple[int, int, int], int] = {}
        for i, link in enumerate(self.links):
            key = (link.source_id, link.target_id, link.channel)
            self.link_index[key] = i

        # Map link index -> clique ids
        self.link_clique_map: Dict[int, List[int]] = {i: [] for i in range(len(self.links))}
        for i, link in enumerate(self.links):
            pair = (link.source_id, link.target_id)
            for c_idx, c_set in enumerate(self.clique_sets):
                if pair in c_set:
                    self.link_clique_map[i].append(c_idx)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def schedule(self) -> List[LinkResult]:
        print(f"\n[Scheduler] Starting schedule for {len(self.links)} links...")

        # Collect all node IDs present
        node_ids: Set[int] = set()
        for l in self.links:
            node_ids.add(l.source_id)
            node_ids.add(l.target_id)
        node_ids_sorted = sorted(node_ids)

        # Precompute durations in ticks for links with non-trivial airtime
        durations: Dict[int, int] = {}
        conflict_degree: Dict[int, int] = {}
        active_indices: List[int] = []

        for i, link in enumerate(self.links):
            if link.airtime_fraction <= 1e-6:
                link.schedule = []
                continue

            # Floor instead of round to avoid overshooting 100% due to rounding
            raw = link.airtime_fraction * TICKS_PER_FRAME
            ticks = int(raw)
            if ticks <= 0 and link.airtime_fraction > 1e-9:
                ticks = 1

            durations[i] = ticks
            conflict_degree[i] = len(self.link_clique_map.get(i, []))
            active_indices.append(i)

        if not active_indices:
            print("[Scheduler] No active links to schedule.")
            return self.links

        # Log nodes and links before scheduling
        print(f"[Scheduler] Nodes present: {', '.join(str(n) for n in node_ids_sorted)}")
        print("[Scheduler] Active links (index: src->dst ch, airtime_fraction, ticks, cliques):")
        for idx in active_indices:
            link = self.links[idx]
            print(
                f"  [{idx}] {link.source_id}->{link.target_id} ch{link.channel}, "
                f"airtime={link.airtime_fraction:.4f}, ticks={durations[idx]}, "
                f"cliques={self.link_clique_map.get(idx, [])}"
            )

        # Structured ordering: group by (source, channel), then longest & most conflicting first
        def sort_key(idx: int):
            link = self.links[idx]
            return (
                link.source_id,
                link.channel,
                -durations[idx],
                -conflict_degree[idx],
            )

        task_order = sorted(active_indices, key=sort_key)

        # Resource tables (only for the "core" frame [0, TICKS_PER_FRAME))
        node_busy: Dict[int, bytearray] = {nid: bytearray(TICKS_PER_FRAME) for nid in node_ids_sorted}
        clique_busy: Dict[int, List[bytearray]] = {
            c_idx: [bytearray(TICKS_PER_FRAME) for _ in range(self.num_channels)]
            for c_idx in range(len(self.clique_sets))
        }

        # placements[idx] = (start_tick, end_tick) in absolute ticks (may exceed TICKS_PER_FRAME)
        placements: Dict[int, Tuple[int, int]] = {}

        overflow_indices: List[int] = []
        overflow_serial_start: int = TICKS_PER_FRAME  # where we start placing links entirely beyond the frame

        # First-pass placement
        for idx in task_order:
            link = self.links[idx]
            src, dst, ch = link.source_id, link.target_id, link.channel
            dur = durations[idx]
            clist = self.link_clique_map.get(idx, [])

            best_start = -1
            t = 0

            # Try to place with a start inside the core frame,
            # allowing the end to spill beyond TICKS_PER_FRAME if needed.
            while t < TICKS_PER_FRAME:
                free = True
                core_end = min(t + dur, TICKS_PER_FRAME)
                for k in range(t, core_end):
                    # Node half-duplex (TX or RX)
                    if node_busy[src][k] or node_busy[dst][k]:
                        free = False
                        break
                    # Clique / interference per channel
                    for cid in clist:
                        if clique_busy[cid][ch][k]:
                            free = False
                            break
                    if not free:
                        break

                if free:
                    best_start = t
                    break
                t += 1

            if best_start == -1:
                # Could not place with any start in [0, TICKS_PER_FRAME).
                # Place this link sequentially beyond the nominal frame.
                print(
                    f"[Scheduler] ⚠ Overflow while placing link {src}->{dst} ch{ch} "
                    f"(idx={idx}, dur={dur} ticks, cliques={clist}). "
                    f"Scheduling it beyond the nominal frame tail."
                )
                overflow_indices.append(idx)
                best_start = overflow_serial_start
                overflow_serial_start += dur

            # Reserve resources in the core frame region if applicable
            if best_start < TICKS_PER_FRAME:
                end_core = min(best_start + dur, TICKS_PER_FRAME)
                for k in range(best_start, end_core):
                    node_busy[src][k] = 1
                    node_busy[dst][k] = 1
                    for cid in clist:
                        clique_busy[cid][ch][k] = 1

            placements[idx] = (best_start, best_start + dur)

        # Convert placements into normalized schedule fragments (temporarily using TICKS_PER_FRAME)
        for idx, (s_tick, e_tick) in placements.items():
            link = self.links[idx]
            link.schedule = [
                ScheduleFragment(
                    start=s_tick / TICKS_PER_FRAME,
                    duration=(e_tick - s_tick) / TICKS_PER_FRAME,
                    is_ack=False,
                )
            ]

        print("[Scheduler] Initial greedy placement complete. Running compaction pass...")

        # Local compaction within the core frame
        self._compact_per_source_channel(node_busy, clique_busy, durations, placements)

        # Determine maximum tick used (including partial or full overflow)
        max_tick = 0
        for _, (s_tick, e_tick) in placements.items():
            if e_tick > max_tick:
                max_tick = e_tick

        if max_tick <= 0:
            max_tick = TICKS_PER_FRAME

        if max_tick > TICKS_PER_FRAME:
            stretch = max_tick / TICKS_PER_FRAME
            print(
                f"[Scheduler] ℹ Frame stretched from {TICKS_PER_FRAME} to {max_tick} ticks "
                f"(x{stretch:.3f}). Actual throughput is effectively scaled down by 1/{stretch:.3f}."
            )

        # Recompute overflow_indices: any link whose end exceeds the core frame
        overflow_indices = [idx for idx, (s_tick, e_tick) in placements.items() if e_tick > TICKS_PER_FRAME]

        if overflow_indices:
            print(f"[Scheduler] ⚠ {len(overflow_indices)} link(s) extend beyond the nominal frame.")
            self._debug_visualize(overflow_indices, placements, node_busy)

        # Renormalize all schedule fragments to [0, max_tick]
        for idx, (s_tick, e_tick) in placements.items():
            link = self.links[idx]
            if not link.schedule:
                continue
            frag = link.schedule[0]
            frag.start = s_tick / max_tick
            frag.duration = (e_tick - s_tick) / max_tick

        # Extra: print per-node contiguous busy blocks (in ticks and normalized)
        self._print_node_blocks(placements)

        print("[Scheduler] Schedule complete.")
        return self.links

    # ------------------------------------------------------------------
    # Local compaction
    # ------------------------------------------------------------------
    def _compact_per_source_channel(
        self,
        node_busy: Dict[int, bytearray],
        clique_busy: Dict[int, List[bytearray]],
        durations: Dict[int, int],
        placements: Dict[int, Tuple[int, int]],
    ) -> None:
        """
        Simple left-compaction within the core frame:
        For each (source, channel) pair:
          - Collect all links with that (source, channel) that were scheduled
            at least partially inside the core region.
          - Sort them by current start time.
          - For each in order:
              - Remove its current occupancy in the core frame region.
              - Try to shift it left (earlier in time) but not before the end
                of the previously compacted link for the same (source, channel).
              - Re-reserve resources at the earliest feasible time.
        """
        groups: Dict[Tuple[int, int], List[int]] = {}

        for idx, (s_tick, e_tick) in placements.items():
            if s_tick >= TICKS_PER_FRAME:
                # Entirely outside core frame; skip compaction for this one
                continue
            link = self.links[idx]
            key = (link.source_id, link.channel)
            groups.setdefault(key, []).append(idx)

        for (src, ch), idx_list in groups.items():
            idx_list.sort(key=lambda i: placements[i][0])
            last_end_tick = 0

            for idx in idx_list:
                link = self.links[idx]
                dst = link.target_id
                dur = durations[idx]
                clist = self.link_clique_map.get(idx, [])

                s_tick, e_tick = placements[idx]
                s_core = max(0, s_tick)
                e_core = min(TICKS_PER_FRAME, e_tick)

                # Remove current occupancy in core frame
                for k in range(s_core, e_core):
                    node_busy[src][k] = 0
                    node_busy[dst][k] = 0
                    for cid in clist:
                        clique_busy[cid][ch][k] = 0

                # Try to shift left, but not before last_end_tick
                best_start = -1
                t = last_end_tick
                while t < TICKS_PER_FRAME:
                    free = True
                    core_end = min(t + dur, TICKS_PER_FRAME)
                    for k in range(t, core_end):
                        if node_busy[src][k] or node_busy[dst][k]:
                            free = False
                            break
                        for cid in clist:
                            if clique_busy[cid][ch][k]:
                                free = False
                                break
                        if not free:
                            break
                    if free:
                        best_start = t
                        break
                    t += 1

                if best_start == -1:
                    best_start = s_core

                # Reserve in core region
                end_core = min(best_start + dur, TICKS_PER_FRAME)
                for k in range(best_start, end_core):
                    node_busy[src][k] = 1
                    node_busy[dst][k] = 1
                    for cid in clist:
                        clique_busy[cid][ch][k] = 1

                # Maintain total duration; adjust placement
                offset = s_tick - s_core
                new_s_tick = best_start + offset
                new_e_tick = new_s_tick + dur
                placements[idx] = (new_s_tick, new_e_tick)

                last_end_tick = best_start + dur

    # ------------------------------------------------------------------
    # Debug visualization (ASCII time vs node)
    # ------------------------------------------------------------------
    def _debug_visualize(
        self,
        overflow_indices: List[int],
        placements: Dict[int, Tuple[int, int]],
        node_busy: Dict[int, bytearray],
    ) -> None:
        """
        Print a coarse ASCII visualization of the schedule around overflow.
        - X axis: time (80 columns).
        - Y axis: nodes (all nodes present).
        For each channel used by overflow links, we show which nodes are
        busy over time in the core frame. Also mark approximate overflow
        windows with bars.
        """
        print("\n[Scheduler] Debug visualization (coarse, per channel):")

        if not overflow_indices:
            print("  (No overflow indices to visualize.)")
            return

        # Use all nodes that exist in node_busy
        all_nodes_sorted = sorted(node_busy.keys())

        # Derive set of channels relevant to overflows
        overflow_channels: Set[int] = set()
        for idx in overflow_indices:
            link = self.links[idx]
            overflow_channels.add(link.channel)

        WIDTH = 80
        ticks_per_col = max(1, TICKS_PER_FRAME // WIDTH)

        for ch in sorted(overflow_channels):
            print(f"\n  [Channel {ch}]")
            # For each node, draw a row
            for n in all_nodes_sorted:
                row = ["." for _ in range(WIDTH)]
                busy = node_busy.get(n, bytearray(TICKS_PER_FRAME))
                for col in range(WIDTH):
                    start_k = col * ticks_per_col
                    end_k = min(TICKS_PER_FRAME, (col + 1) * ticks_per_col)
                    for k in range(start_k, end_k):
                        if busy[k]:
                            row[col] = "#"
                            break
                print(f"    Node {n:3d}: {''.join(row)}")

            # Show approximate overflow intervals as bars
            print("    Overflow link windows (approx):")
            for idx in overflow_indices:
                link = self.links[idx]
                if link.channel != ch:
                    continue
                s_tick, e_tick = placements[idx]
                if s_tick >= TICKS_PER_FRAME:
                    print(
                        f"      {link.source_id}->{link.target_id} (idx={idx}, dur={e_tick - s_tick}): "
                        f"[starts beyond core frame]"
                    )
                else:
                    s_tick_clipped = max(0, s_tick)
                    e_tick_clipped = min(TICKS_PER_FRAME, e_tick)
                    if e_tick_clipped <= s_tick_clipped:
                        continue
                    s_col = s_tick_clipped // ticks_per_col
                    e_col = max(s_col + 1, e_tick_clipped // ticks_per_col)
                    bar = [" "] * WIDTH
                    for c in range(max(0, s_col), min(WIDTH, e_col)):
                        bar[c] = "X"
                    print(
                        f"      {link.source_id}->{link.target_id} "
                        f"(idx={idx}, dur={e_tick - s_tick}): "
                        f"{''.join(bar)}"
                    )

            print("")  # blank line between channels

    # ------------------------------------------------------------------
    # Extra detailed debug: per-node contiguous blocks
    # ------------------------------------------------------------------
    def _print_node_blocks(self, placements: Dict[int, Tuple[int, int]]) -> None:
        """
        For each node, print its contiguous busy blocks as [start_tick, end_tick)
        and also normalized [0,1] based on the stretched frame length.
        """
        # Compute max_tick to normalize
        max_tick = 0
        for _, (s_tick, e_tick) in placements.items():
            if e_tick > max_tick:
                max_tick = e_tick
        if max_tick <= 0:
            max_tick = TICKS_PER_FRAME

        # Collect blocks per node
        node_blocks: Dict[int, List[Tuple[int, int]]] = {}

        for idx, (s_tick, e_tick) in placements.items():
            link = self.links[idx]
            u, v = link.source_id, link.target_id
            for n in (u, v):
                node_blocks.setdefault(n, []).append((s_tick, e_tick))

        # Merge & print
        print("\n[Scheduler] Per-node contiguous busy blocks:")
        for n in sorted(node_blocks.keys()):
            blocks = sorted(node_blocks[n], key=lambda x: x[0])
            merged: List[Tuple[int, int]] = []
            for s, e in blocks:
                if not merged:
                    merged.append((s, e))
                else:
                    last_s, last_e = merged[-1]
                    if s <= last_e:  # contiguous or overlapping
                        merged[-1] = (last_s, max(last_e, e))
                    else:
                        merged.append((s, e))
            print(f"  Node {n}:")
            for s, e in merged:
                print(
                    f"    [{s:5d}, {e:5d}) ticks   "
                    f"({s / max_tick:.4f}, {e / max_tick:.4f})"
                )
