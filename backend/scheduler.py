from typing import List, Dict, Set, Tuple
from models import LinkResult, ScheduleFragment

# Resolution: 10,000 ticks = 1 Frame
TICKS_PER_FRAME = 10000

class TxBlock:
    """Represents a contiguous block of airtime for a specific Source Node"""
    def __init__(self, source_id: int):
        self.source_id = source_id
        self.links: List[LinkResult] = []
        self.total_duration = 0.0
        self.start_tick = -1 

    def add_link(self, link: LinkResult):
        self.links.append(link)
        self.total_duration += link.airtime_fraction

class TDMAScheduler:
    def __init__(self, links: List[LinkResult], cliques: List[List[Tuple[int, int]]], num_channels: int):
        self.links = links
        self.num_channels = num_channels
        self.clique_sets = []
        for c in cliques:
            s = set()
            for u, v in c:
                s.add((u, v))
                s.add((v, u)) 
            self.clique_sets.append(s)

    def schedule(self) -> List[LinkResult]:
        print(f"\n[Scheduler] Starting schedule for {len(self.links)} links...")

        # 1. Group Links into TxBlocks (by Source Node)
        blocks_map: Dict[int, TxBlock] = {}
        
        for link in self.links:
            if link.airtime_fraction < 0.0001: continue
            if link.source_id not in blocks_map:
                blocks_map[link.source_id] = TxBlock(link.source_id)
            blocks_map[link.source_id].add_link(link)
            
        blocks = list(blocks_map.values())
        print(f"[Scheduler] Grouped into {len(blocks)} TxBlocks (Nodes: {[b.source_id for b in blocks]})")
        
        # 2. Build Conflict Graph for BLOCKS
        block_conflicts: Dict[int, Set[int]] = {i: set() for i in range(len(blocks))}
        
        for i in range(len(blocks)):
            for j in range(i + 1, len(blocks)):
                b1 = blocks[i]
                b2 = blocks[j]
                is_conflict = False
                
                # A. Node Constraints (Half-Duplex)
                nodes_b1 = {b1.source_id}
                for l in b1.links: nodes_b1.add(l.target_id)
                
                nodes_b2 = {b2.source_id}
                for l in b2.links: nodes_b2.add(l.target_id)
                
                if not nodes_b1.isdisjoint(nodes_b2):
                    is_conflict = True
                
                # B. RF Interference (Cliques)
                if not is_conflict:
                    for l1 in b1.links:
                        for l2 in b2.links:
                            pair_a = (l1.source_id, l1.target_id)
                            pair_b = (l2.source_id, l2.target_id)
                            for c_set in self.clique_sets:
                                if pair_a in c_set and pair_b in c_set:
                                    is_conflict = True
                                    break
                            if is_conflict: break
                        if is_conflict: break
                
                if is_conflict:
                    block_conflicts[i].add(j)
                    block_conflicts[j].add(i)

        print(block_conflicts)

        # 3. Greedy Scheduling
        sorted_indices = sorted(range(len(blocks)), key=lambda i: blocks[i].total_duration, reverse=True)
        schedule_map = {}
        
        for idx in sorted_indices:
            block = blocks[idx]
            duration_ticks = int(block.total_duration * TICKS_PER_FRAME)
            if duration_ticks == 0 and block.total_duration > 0: duration_ticks = 1
                
            neighbors = block_conflicts[idx]
            scheduled_neighbors = []
            for n_idx in neighbors:
                if n_idx in schedule_map:
                    n_start = schedule_map[n_idx]
                    n_dur = int(blocks[n_idx].total_duration * TICKS_PER_FRAME) or 1
                    scheduled_neighbors.append((n_start, n_dur))
            
            best_start = -1
            
            # Linear scan for gap
            for t in range(0, TICKS_PER_FRAME - duration_ticks + 1, 10):
                my_start = t
                my_end = t + duration_ticks
                collision = False
                for (n_start, n_dur) in scheduled_neighbors:
                    n_end = n_start + n_dur
                    if my_start < n_end and my_end > n_start:
                        collision = True
                        break
                if not collision:
                    best_start = t
                    break
            
            if best_start == -1:
                print(f"[Scheduler] ⚠ CRITICAL WARN: Overflow for Node {block.source_id} (Size {duration_ticks})")
                best_start = 0 
            
            schedule_map[idx] = best_start
            block.start_tick = best_start
            print(f"[Scheduler] Assigned Node {block.source_id}: Start={best_start}, Dur={duration_ticks}")

        # 4. Unpack
        final_links = []
        for idx, block in enumerate(blocks):
            current_offset_fraction = float(block.start_tick) / TICKS_PER_FRAME
            
            for link in block.links:
                frag = ScheduleFragment(
                    start=current_offset_fraction,
                    duration=link.airtime_fraction,
                    is_ack=False
                )
                link.schedule = [frag]
                final_links.append(link)
                current_offset_fraction += link.airtime_fraction
        
        print("[Scheduler] Schedule complete.")
        return final_links