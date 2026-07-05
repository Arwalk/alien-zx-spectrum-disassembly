#!/usr/bin/env python
"""Scripted-input gameplay tracer for Alien (ZX Spectrum, BUGFIX 1.7).

Drives skoolkit's pure-Python Z80 simulator from alien.z80 (PC=36457
GameEntry), simulating keypresses to get past the intro screens and into
real gameplay, while collecting an execution map of every PC executed.

Stages are reactive: a key is pressed for `hold` frames when PC first
reaches the stage's target address (a key-polling loop), so no frame
timings need to be known in advance.

Usage:
  play_trace.py OUTMAP MAXOPS [--shipmap K] [--difficulty K] [--seed N]
"""
import argparse
import random
import sys
import time
from collections import Counter

from skoolkit.simulator import Simulator
from skoolkit.simutils import from_snapshot, PC, T
from skoolkit.snapshot import Snapshot

FRAME_T = 69888
IFF = 26

# key name -> (half-row index, bit)
KEYS = {
    'CS': (0, 0), 'Z': (0, 1), 'X': (0, 2), 'C': (0, 3), 'V': (0, 4),
    'A': (1, 0), 'S': (1, 1), 'D': (1, 2), 'F': (1, 3), 'G': (1, 4),
    'Q': (2, 0), 'W': (2, 1), 'E': (2, 2), 'R': (2, 3), 'T': (2, 4),
    '1': (3, 0), '2': (3, 1), '3': (3, 2), '4': (3, 3), '5': (3, 4),
    '0': (4, 0), '9': (4, 1), '8': (4, 2), '7': (4, 3), '6': (4, 4),
    'P': (5, 0), 'O': (5, 1), 'I': (5, 2), 'U': (5, 3), 'Y': (5, 4),
    'EN': (6, 0), 'L': (6, 1), 'K': (6, 2), 'J': (6, 3), 'H': (6, 4),
    'SP': (7, 0), 'SS': (7, 1), 'M': (7, 2), 'N': (7, 3), 'B': (7, 4),
}

WATCH = {
    36457: 'GameEntry', 42581: 'DrawIntroScreen', 42821: 'DrawShipMap',
    43242: 'IntroductionMode', 43610: 'OptionsScreen', 44561: 'ScreenTransition',
    45401: 'InitCrewPositions', 31417: 'InitGameView', 36481: 'MainLoop',
    44815: 'PauseMenu', 40826: 'UpdateAlien', 37733: 'AlienKillPrimitive',
    37584: 'CrewHitsAlien', 44125: 'Auto_AC5D(endgame?)', 45019: 'CtrlRoom45019',
    45080: 'CtrlRoom45080', 38715: 'Kill38715', 38784: 'CrewAction6',
}


class ScriptedKeyboard:
    """Reactive key script + gameplay key cycling."""

    def __init__(self, stages, gameplay_keys, seed=1):
        self.stages = stages          # list of (target_pc, key, hold_frames)
        self.stage_idx = 0
        self.press_key = None
        self.press_until = -1         # frame when current press ends
        self.gameplay = False
        self.gameplay_keys = gameplay_keys
        self.rng = random.Random(seed)
        self.keyboard = [0] * 8
        self.log = []

    def next_target(self):
        if self.stage_idx < len(self.stages):
            return self.stages[self.stage_idx][0]
        return -1

    def ready(self):
        # don't fire the next stage until the previous press was released
        return self.press_key is None

    def trigger(self, frame):
        target, key, hold = self.stages[self.stage_idx]
        self.press_key = key
        self.press_until = frame + hold
        self.log.append((frame, f'stage {self.stage_idx}: hit {target}, press {key}'))
        self.stage_idx += 1
        if self.stage_idx == len(self.stages):
            self.gameplay = True

    def set_frame(self, frame):
        kb = [0] * 8
        if self.press_key is not None:
            if frame < self.press_until:
                r, b = KEYS[self.press_key]
                kb[r] |= 1 << b
            else:
                self.press_key = None
        elif self.gameplay and self.gameplay_keys:
            # cycle: each 45-frame slot -> hold a key for 12 frames
            slot, phase = divmod(frame, 45)
            if phase < 12:
                key = self.gameplay_keys[slot % len(self.gameplay_keys)]
                r, b = KEYS[key]
                kb[r] |= 1 << b
        self.keyboard = kb


class ScriptTracer:
    def __init__(self, script):
        self.script = script

    def read_port(self, registers, port):
        if port % 2 == 0:
            h = (port // 256) ^ 0xFF
            v = 0x40
            i = 0
            kb = self.script.keyboard
            while h:
                if h % 2:
                    v |= kb[i]
                h //= 2
                i += 1
            return v ^ 0xFF
        return 0xFF

    def write_port(self, registers, port, value):
        pass


def main():
    p = argparse.ArgumentParser()
    p.add_argument('outmap')
    p.add_argument('maxops', type=int)
    p.add_argument('--z80', default='alien.z80')
    p.add_argument('--start', type=int, default=36457, help='start PC (default GameEntry)')
    p.add_argument('--shipmap', default='1', help='key for ship-map screen')
    p.add_argument('--difficulty', default='3', help='key for options screen')
    p.add_argument('--confirm', default='5', help='second key on options screen')
    p.add_argument('--seed', type=int, default=1)
    p.add_argument('--gameplay-keys', default='6,7,8,5,0,6,8,7,5,0,EN,6,7,8,5,0,Y,6,7,8,5,0,N')
    p.add_argument('--poke', action='append', default=[],
                   help='ADDR,BYTE[,BYTE...] pokes applied before run')
    p.add_argument('--no-speed-pokes', action='store_true')
    args = p.parse_args()

    stages = [
        (42808, 'Z', 6),              # intro: any-key loop
        (43038, args.shipmap, 6),     # ship map: 1=Short, 2=Long, 3=Introduction
        (43038, '4', 6),              # ship map: key 4 = confirm (GameModeJump)
        (43737, args.difficulty, 6),  # options: keys 1-5
        (43737, args.confirm, 6),     # options again: confirm/start?
        (43896, 'Y', 8),              # Y-prompt poll (port $DFFE bit 4)
    ]
    gameplay_keys = [k for k in args.gameplay_keys.split(',') if k]
    script = ScriptedKeyboard(stages, gameplay_keys, args.seed)

    snapshot = Snapshot.get(args.z80)
    sim = from_snapshot(Simulator, snapshot, {}, {}, {'fast_djnz': False, 'fast_ldir': False}, None)
    tracer = ScriptTracer(script)
    sim.set_tracer(tracer)

    memory = sim.memory
    registers = sim.registers
    if not args.no_speed_pokes:
        memory[949] = 201        # ROM BEEPER -> RET (silence music, huge speedup)
        memory[36449:36451] = [50, 0]   # frame busy-wait LD BC,4863 -> LD BC,50
        memory[40333] = 1        # sound-effect inter-toggle delay D: 64 -> 1
        memory[40335] = 8        # sound-effect outer loop B: 255 -> 8
    for spec in args.poke:
        parts = [int(x) for x in spec.split(',')]
        for i, b in enumerate(parts[1:]):
            memory[parts[0] + i] = b

    opcodes = sim.opcodes
    frame_duration = sim.frame_duration
    int_active = sim.int_active
    pc = registers[PC] = args.start
    exec_map = set()
    watch_seen = {}
    tstates = registers[T]
    frame0 = prev_frame = tstates // frame_duration
    target = script.next_target()
    operations = 0
    maxops = args.maxops
    hist = Counter()
    begin = time.time()

    while operations < maxops:
        opcodes[memory[pc]]()
        tstates = registers[T]
        exec_map.add(pc)

        if registers[IFF] and tstates % frame_duration < int_active:
            sim.accept_interrupt(registers, memory, pc)
            tstates = registers[T]

        pc = registers[PC]
        operations += 1

        if pc == target and script.ready():
            script.trigger(prev_frame - frame0)
            target = script.next_target()
        if pc in WATCH and pc not in watch_seen:
            watch_seen[pc] = prev_frame - frame0

        if operations % 512 == 0:
            hist[pc] += 1
            frame = tstates // frame_duration
            if frame > prev_frame:
                prev_frame = frame
                script.set_frame(frame - frame0)

    dt = time.time() - begin
    frames = prev_frame - frame0
    print(f'{operations} ops in {dt:.1f}s ({operations/dt/1e6:.2f} Mops/s), '
          f'{frames} frames (~{frames/50:.0f}s game time), stopped at PC={pc} (${pc:04X})')
    print(f'exec map: {len(exec_map)} unique addresses')
    for f, msg in script.log:
        print(f'  frame {f}: {msg}')
    print('watch first-hits:')
    for a, f in sorted(watch_seen.items(), key=lambda x: x[1]):
        print(f'  frame {f}: {WATCH[a]} ({a}/${a:04X})')
    print('PC sample hot spots:')
    for a, n in hist.most_common(8):
        print(f'  ${a:04X} ({a}): {n}')

    with open(args.outmap, 'w') as f:
        for a in sorted(exec_map):
            f.write(f'${a:04X}\n')


if __name__ == '__main__':
    main()
