#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

try:
    import cadquery as cq
except ImportError as error:
    raise SystemExit(
        "CadQuery is required. Install it with: python3 -m pip install -r cad/requirements.txt"
    ) from error

Point = tuple[float, float]
Hole = tuple[float, float, float]

CALIBER_MM = 55.8
MOVEMENT_HEIGHT_MM = 19.0
PRESS_INTERFERENCE_MM = 0.01
OUTPUT_DIR = Path(__file__).resolve().parent / "output"

POS = {
    "barrel": (-11.8303354585, 10.9203096540),
    "center": (0.0, 0.0),
    "third": (9.1786513993, 5.0992507774),
    "fourth": (0.1276846001, -3.9517160218),
    "escape": (-3.4245533087, -11.5636543978),
    "fork": (2.0754466913, -14.8636543978),
    "balance": (6.5754466913, -17.8636543978),
    "alarm_barrel": (15.0, 9.0),
    "saw": (13.0342431483, -4.7602979619),
    "hammer": (17.0, -9.0),
}

JEWELS = {
    "escape": {"part": "30712/26-120", "outside": 1.20, "hole": 0.26, "pivot": 0.24},
    "fork": {"part": "30712/15-100", "outside": 1.00, "hole": 0.15, "pivot": 0.13},
    "balance": {"part": "30710/16-120", "outside": 1.20, "hole": 0.16, "pivot": 0.14},
}
CAP_JEWEL = {"part": "30713-120", "outside": 1.20, "thickness": 0.20}
HAIRSPRING = {
    "turns": 6.5,
    "inner_radius": 1.10,
    "outer_radius": 5.00,
    "ribbon_width": 0.18,
    "thickness": 0.08,
    "z0": 7.30,
    "outer_stud_offset": (5.05, 1.40),
}
TRAIN_SCREWS = [(-20.0, 15.0), (-16.0, 3.0), (-5.0, 18.0), (7.0, 10.0), (-5.6, -13.3)]
ALARM_SCREWS = [(18.0, 19.0), (22.0, 7.0), (18.0, -7.0)]
ALARM_WHEEL_PLATE_SCREWS = [(-18.0, 14.0), (20.0, 10.0), (0.0, -23.0)]


@dataclass
class Part:
    shape: cq.Workplane
    material: str
    color: cq.Color


def polygon_area(points: list[Point]) -> float:
    return abs(sum(
        x0 * y1 - x1 * y0
        for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1])
    )) / 2


def mainplate_outline() -> list[Point]:
    traced = [
        (157, 26), (174, 20), (198, 21), (222, 25), (242, 37), (250, 46),
        (253, 71), (263, 82), (277, 98), (307, 96), (326, 99), (338, 108),
        (345, 126), (348, 147), (365, 176), (374, 209), (379, 246), (375, 278),
        (362, 310), (342, 333), (314, 351), (281, 362), (240, 370), (204, 372),
        (174, 368), (143, 359), (111, 345), (87, 328), (69, 307), (49, 277),
        (38, 245), (36, 210), (40, 176), (48, 144), (60, 113), (78, 87),
        (99, 64), (126, 43),
    ]
    scale = math.sqrt(math.pi * (CALIBER_MM / 2) ** 2 / polygon_area(traced))
    return [((x - 208) * scale, (199 - y) * scale) for x, y in traced]


def alarm_wheel_plate_outline() -> list[Point]:
    return [(x * 0.96, y * 0.96) for x, y in mainplate_outline()]


def cylinder(radius: float, z0: float, z1: float, xy: Point = (0, 0)) -> cq.Workplane:
    return (
        cq.Workplane("XY")
        .workplane(offset=z0)
        .circle(radius)
        .extrude(z1 - z0)
        .translate((xy[0], xy[1], 0))
    )


def box(size: tuple[float, float, float], center: Point, z: float, angle: float = 0) -> cq.Workplane:
    return (
        cq.Workplane("XY")
        .box(*size)
        .rotate((0, 0, 0), (0, 0, 1), math.degrees(angle))
        .translate((center[0], center[1], z))
    )


def prism(outline: list[Point], z0: float, z1: float) -> cq.Workplane:
    return cq.Workplane("XY").workplane(offset=z0).polyline(outline).close().extrude(z1 - z0)


def ring(outer: float, inner: float, z0: float, z1: float, xy: Point = (0, 0)) -> cq.Workplane:
    return cylinder(outer, z0, z1, xy).cut(cylinder(inner, z0 - 0.1, z1 + 0.1, xy))


def fuse(parts: Iterable[cq.Workplane]) -> cq.Workplane:
    items = list(parts)
    result = items[0]
    for item in items[1:]:
        result = result.union(item)
    return result


def drill(shape: cq.Workplane, holes: Iterable[Hole], z0: float, z1: float) -> cq.Workplane:
    result = shape
    for x, y, diameter in holes:
        result = result.cut(cylinder(diameter / 2, z0 - 0.2, z1 + 0.2, (x, y)))
    return result


def bar(start: Point, end: Point, width0: float, width1: float, z0: float, z1: float) -> cq.Workplane:
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = math.hypot(dx, dy)
    nx, ny = -dy / length, dx / length
    return prism([
        (start[0] + nx * width0 / 2, start[1] + ny * width0 / 2),
        (end[0] + nx * width1 / 2, end[1] + ny * width1 / 2),
        (end[0] - nx * width1 / 2, end[1] - ny * width1 / 2),
        (start[0] - nx * width0 / 2, start[1] - ny * width0 / 2),
    ], z0, z1)


def gear_outline(teeth: int, pitch: float, tooth_height: float) -> list[Point]:
    points = []
    root = pitch - tooth_height * 0.55
    tip = pitch + tooth_height * 0.45
    step = math.tau / teeth
    for index in range(teeth):
        angle = index * step
        for fraction, radius in [(0, root), (0.18, root), (0.32, tip), (0.55, tip), (0.72, root)]:
            points.append((radius * math.cos(angle + step * fraction), radius * math.sin(angle + step * fraction)))
    return points


def saw_outline(teeth: int, radius: float) -> list[Point]:
    points = []
    step = math.tau / teeth
    for index in range(teeth):
        angle = index * step
        for fraction, scale in [(0, 0.8), (0.75, 1.0), (0.8, 0.8)]:
            points.append((radius * scale * math.cos(angle + step * fraction), radius * scale * math.sin(angle + step * fraction)))
    return points


def escape_outline(radius: float) -> list[Point]:
    points = []
    step = math.tau / 15
    for index in range(15):
        angle = index * step
        for fraction, scale in [
            (0, 0.66), (0.18, 0.72), (0.42, 0.91), (0.47, 1.0),
            (0.62, 1.0), (0.65, 0.89), (0.35, 0.74), (0.58, 0.66),
        ]:
            points.append((radius * scale * math.cos(angle + step * fraction), radius * scale * math.sin(angle + step * fraction)))
    return points


def local(shape: cq.Workplane, xy: Point) -> cq.Workplane:
    return shape.translate((xy[0], xy[1], 0))


def spoked_gear(
    teeth: int, pitch: float, tooth_height: float, z0: float, z1: float,
    xy: Point, bore: float, spokes: int = 5,
) -> cq.Workplane:
    root = pitch - tooth_height * 0.55
    inner = root * 0.82
    hub = max(1.1, pitch * 0.16)
    rim = local(prism(gear_outline(teeth, pitch, tooth_height), z0, z1), xy)
    rim = rim.cut(cylinder(inner, z0 - 0.1, z1 + 0.1, xy))
    parts = [rim, cylinder(hub, z0, z1, xy)]
    for index in range(spokes):
        angle = index * math.tau / spokes
        start = (xy[0] + math.cos(angle) * (hub - 0.25), xy[1] + math.sin(angle) * (hub - 0.25))
        end = (xy[0] + math.cos(angle) * (inner + 0.25), xy[1] + math.sin(angle) * (inner + 0.25))
        parts.append(bar(start, end, max(0.55, pitch * 0.065), max(0.55, pitch * 0.065), z0, z1))
    return fuse(parts).cut(cylinder(bore / 2, z0 - 0.1, z1 + 0.1, xy))


def screw(xy: Point, shaft_z0: float, head_z0: float, head_z1: float, radius: float = 0.95) -> cq.Workplane:
    shape = fuse([
        cylinder(0.43, shaft_z0, head_z0 + 0.05, xy),
        cylinder(radius, head_z0, head_z1, xy),
    ])
    slot = box((radius * 1.65, 0.20, 0.16), xy, head_z1 - 0.02, 0.35)
    return shape.cut(slot)


def dial_side_screw(xy: Point) -> cq.Workplane:
    shape = fuse([
        cylinder(0.43, -1.30, 0.60, xy),
        cylinder(0.82, -1.50, -1.30, xy),
    ])
    return shape.cut(box((1.35, 0.20, 0.16), xy, -1.48, 0.35))


def perforated_plate(outline: list[Point], holes: list[Hole], z0: float, z1: float) -> cq.Workplane:
    return drill(prism(outline, z0, z1), holes, z0, z1)


def make_pallet() -> cq.Workplane:
    xy = POS["fork"]
    z0, z1 = 3.0, 3.35
    local_parts = [
        ring(0.72, 0.24, z0, z1),
        bar((0, 0), (-0.85, 0.95), 0.62, 0.48, z0, z1),
        bar((-0.85, 0.95), (-1.2, 2.3), 0.48, 0.36, z0, z1),
        bar((-0.85, 0.95), (-2.6, 0), 0.48, 0.36, z0, z1),
        bar((0.15, -0.05), (3.75, -2.55), 0.58, 0.32, z0, z1),
        bar((3.75, -2.55), (4.65, -2.1), 0.32, 0.22, z0, z1),
        bar((3.75, -2.55), (4.65, -3.3), 0.32, 0.22, z0, z1),
    ]
    return local(fuse(local_parts), xy)


def make_hairspring() -> tuple[cq.Workplane, cq.Workplane, cq.Workplane]:
    outer = []
    inner = []
    turns = HAIRSPRING["turns"]
    width = HAIRSPRING["ribbon_width"]
    z0 = HAIRSPRING["z0"]
    z1 = z0 + HAIRSPRING["thickness"]
    balance_x, balance_y = POS["balance"]
    stud = (balance_x + HAIRSPRING["outer_stud_offset"][0], balance_y + HAIRSPRING["outer_stud_offset"][1])
    stud_angle = math.atan2(stud[1] - balance_y, stud[0] - balance_x)
    phase = stud_angle - turns * math.tau
    for index in range(520):
        t = index / 519
        angle = phase + t * turns * math.tau
        radius = HAIRSPRING["inner_radius"] + (HAIRSPRING["outer_radius"] - HAIRSPRING["inner_radius"]) * t
        outer.append((balance_x + (radius + width / 2) * math.cos(angle), balance_y + (radius + width / 2) * math.sin(angle)))
        inner.append((balance_x + (radius - width / 2) * math.cos(angle), balance_y + (radius - width / 2) * math.sin(angle)))
    inner_reversed = list(reversed(inner))

    spiral = prism(outer + inner_reversed, z0, z1)
    inner_start = (balance_x + 0.75 * math.cos(phase), balance_y + 0.75 * math.sin(phase))
    inner_end = (balance_x + 1.25 * math.cos(phase), balance_y + 1.25 * math.sin(phase))
    outer_start = (balance_x + 4.85 * math.cos(stud_angle), balance_y + 4.85 * math.sin(stud_angle))
    spring = fuse([
        spiral,
        bar(inner_start, inner_end, width, width, z0, z1),
        bar(outer_start, stud, width, width, z0, z1),
        ring(0.28, 0.10, z0, z1, stud),
    ])

    collet = ring(0.95, 0.50, z0, z0 + 0.25, POS["balance"])
    slit_center = (balance_x + 0.90 * math.cos(phase), balance_y + 0.90 * math.sin(phase))
    slit = box((0.50, width + 0.02, 0.30), slit_center, z0 + 0.125, phase)
    collet = collet.cut(slit)

    stud_body = fuse([
        cylinder(0.48, 6.80, z0 - 0.02, stud),
        cylinder(0.09, z0 - 0.02, z1 + 0.02, stud),
        cylinder(0.48, z1 + 0.02, 8.40, stud),
    ])
    return spring, collet, stud_body


def make_hand(length: float, width: float, ring_outer: float, bore: float, z0: float, z1: float) -> cq.Workplane:
    shape = fuse([
        ring(ring_outer, bore / 2, z0, z1),
        prism([
            (-width / 2, ring_outer * 0.65), (width / 2, ring_outer * 0.65),
            (width * 0.35, length * 0.88), (0, length),
            (-width * 0.35, length * 0.88),
        ], z0, z1),
    ])
    return shape.rotate((0, 0, 0), (0, 0, 1), 180)


def build() -> tuple[dict[str, Part], dict[str, cq.Workplane]]:
    parts: dict[str, Part] = {}
    plates: dict[str, cq.Workplane] = {}

    def add(name: str, shape: cq.Workplane, material: str, color: tuple[float, float, float]) -> None:
        parts[name] = Part(shape, material, cq.Color(*color))

    brass = (0.72, 0.55, 0.24)
    steel = (0.72, 0.74, 0.78)
    nickel = (0.66, 0.68, 0.70)
    ruby = (0.55, 0.015, 0.05)
    blue = (0.10, 0.18, 0.50)

    outline = mainplate_outline()
    mainplate = prism(outline, 0, 1.2)
    mainplate_holes = [
        (*POS["barrel"], 1.50), (*POS["center"], 1.10), (*POS["third"], 0.42),
        (*POS["fourth"], 0.42), (*POS["alarm_barrel"], 1.50), (*POS["saw"], 0.48),
        (*POS["hammer"], 0.72), (7.2, 7.8, 0.42), (-4.6, 2.4, 0.36),
        *[(x, y, 0.86) for x, y in TRAIN_SCREWS + ALARM_SCREWS + ALARM_WHEEL_PLATE_SCREWS],
        *[(POS[key][0], POS[key][1], data["outside"] - PRESS_INTERFERENCE_MM) for key, data in JEWELS.items()],
    ]
    mainplate = drill(mainplate, mainplate_holes, 0, 1.2)
    plates["mainplate"] = mainplate
    add("mainplate", mainplate, "CuZn37 nickel plated", nickel)

    alarm_wheel_plate = perforated_plate(alarm_wheel_plate_outline(), [
        (0, 0, 1.80), (-4.6, 2.4, 0.56), (7.6, 3.2, 0.56), (7.2, 7.8, 0.68),
        *[(x, y, 0.86) for x, y in ALARM_WHEEL_PLATE_SCREWS],
    ], -1.30, -1.10)
    plates["alarm-wheel-plate"] = alarm_wheel_plate
    add("alarm_wheel_plate", alarm_wheel_plate, "CuZn37 nickel plated", nickel)

    train_outline = [
        (-24.5, 12), (-23.5, 19), (-18, 23), (-10, 24), (-3, 22), (4, 18),
        (10, 13), (12.5, 8), (10.5, 4.2), (5, 3.4), (2, 1), (2, -4),
        (1.5, -7), (0, -10), (-2, -13), (-4, -15.5), (-6.5, -16), (-9, -14),
        (-11, -10), (-12, -6), (-15, -1), (-21, 3), (-24, 7),
    ]
    train_holes = [
        (*POS["barrel"], 1.50), (*POS["center"], 1.10), (*POS["third"], 0.42), (*POS["fourth"], 0.42),
        (*POS["escape"], JEWELS["escape"]["outside"] - PRESS_INTERFERENCE_MM),
        *[(x, y, 0.86) for x, y in TRAIN_SCREWS],
    ]
    train_bridge = perforated_plate(train_outline, train_holes, 5.2, 6.4)
    plates["train-bridge"] = train_bridge
    add("train_bridge", train_bridge, "CuZn37 nickel plated", nickel)

    alarm_outline = [
        (10, 22), (18, 23), (24, 18), (26, 10), (25, 5), (22, 3),
        (20, 5), (20, 9), (18, 12), (17, 10), (18, 5), (20, 1),
        (22, -4), (22, -8), (18, -12), (14, -10), (11.5, -7), (12, -4),
        (16, 3), (13, 10), (9, 15),
    ]
    alarm_bridge = perforated_plate(alarm_outline, [
        (*POS["alarm_barrel"], 1.50), (*POS["saw"], 0.48), (*POS["hammer"], 0.72),
        *[(x, y, 0.86) for x, y in ALARM_SCREWS],
    ], 5.2, 6.4)
    plates["alarm-bridge"] = alarm_bridge
    add("alarm_bridge", alarm_bridge, "CuZn37 nickel plated", nickel)

    fork_x, fork_y = POS["fork"]
    pallet_local = [
        (-3.0, 2.6), (-2.75, 3.45), (-1.9, 3.8), (-1.0, 3.45), (-0.25, 2.55),
        (0.8, 1.45), (1.35, 0.65), (1.4, -0.2), (0.85, -0.95), (-0.1, -1.55),
        (-0.85, -3.2), (-1.45, -4.0), (-2.35, -3.55), (-2.8, -2.2), (-2.65, -0.65),
        (-2.9, 0.85),
    ]
    pallet_bridge = perforated_plate([(x + fork_x, y + fork_y) for x, y in pallet_local], [
        (fork_x, fork_y, JEWELS["fork"]["outside"] - PRESS_INTERFERENCE_MM),
        (fork_x - 2.0, fork_y + 2.8, 0.86), (fork_x - 1.4, fork_y - 2.55, 0.86),
    ], 4.9, 5.55)
    plates["pallet-bridge"] = pallet_bridge
    add("pallet_bridge", pallet_bridge, "CuZn37 nickel plated", nickel)

    balance_x, balance_y = POS["balance"]
    balance_local = [
        (-7.4, 3.7), (-7.2, 4.8), (-6.3, 5.35), (-5.25, 5.1), (-4.55, 4.15),
        (-3.75, 2.85), (-2.25, 1.85), (-1.25, 1.55), (0.05, 1.7), (1.25, 1.05),
        (1.75, -0.1), (1.85, -2.0), (2.45, -4.45), (2.6, -6.0), (2.05, -7.35),
        (1.0, -7.95), (-0.15, -7.65), (-0.75, -6.75), (-0.85, -5.35), (-0.45, -3.45),
        (-0.65, -1.85), (-1.45, -0.9), (-2.5, -0.15), (-3.85, 0.85), (-5.1, 1.75),
        (-6.25, 2.3), (-7.1, 2.75),
    ]
    balance_cock = perforated_plate([(x + balance_x, y + balance_y) for x, y in balance_local], [
        (balance_x, balance_y, JEWELS["balance"]["outside"] - PRESS_INTERFERENCE_MM),
        (balance_x - 6.2, balance_y + 3.7, 0.86), (balance_x + 1.0, balance_y - 6.4, 0.86),
    ], 8.1, 8.65)
    plates["balance-cock"] = balance_cock
    add("balance_cock", balance_cock, "CuZn37 nickel plated", nickel)

    for name, key, z0, z1 in [
        ("escape_lower_jewel", "escape", 0.35, 0.85),
        ("escape_upper_jewel", "escape", 5.55, 6.05),
        ("pallet_lower_jewel", "fork", 0.35, 0.85),
        ("pallet_upper_jewel", "fork", 5.00, 5.50),
        ("balance_lower_jewel", "balance", 0.00, 0.55),
        ("balance_upper_jewel", "balance", 8.12, 8.67),
    ]:
        data = JEWELS[key]
        add(name, ring(data["outside"] / 2, data["hole"] / 2, z0, z1, POS[key]), "synthetic ruby purchased part " + data["part"], ruby)

    for name, z0 in [("balance_lower_cap", -0.25), ("balance_upper_cap", 8.70)]:
        add(name, cylinder(CAP_JEWEL["outside"] / 2, z0, z0 + CAP_JEWEL["thickness"], POS["balance"]), "synthetic ruby purchased part 30713-120", ruby)
        setting = cylinder(1.45, z0 - 0.05, z0 + 0.25, POS["balance"])
        pocket_z0 = z0 if name == "balance_lower_cap" else z0 - 0.10
        pocket_z1 = z0 + 0.30 if name == "balance_lower_cap" else z0 + CAP_JEWEL["thickness"]
        pocket = cylinder((CAP_JEWEL["outside"] - PRESS_INTERFERENCE_MM) / 2, pocket_z0, pocket_z1, POS["balance"])
        add(name + "_setting", setting.cut(pocket), "steel jewel setting", steel)

    for name, key, teeth, pitch, height, z0, z1, bore in [
        ("center_wheel", "center", 80, 9.0, 0.65, 1.4, 3.2, 0.90),
        ("third_wheel", "third", 75, 11.0, 0.60, 1.4, 3.2, 0.40),
        ("fourth_wheel", "fourth", 64, 7.0, 0.55, 1.4, 3.0, 0.40),
    ]:
        add(name, spoked_gear(teeth, pitch, height, z0, z1, POS[key], bore), "CuZn37", brass)

    escape_rim = local(prism(escape_outline(4.6), 2.2, 3.0), POS["escape"])
    escape_rim = escape_rim.cut(cylinder(4.6 * 0.60, 2.1, 3.1, POS["escape"]))
    escape_parts = [escape_rim, cylinder(0.69, 2.2, 3.0, POS["escape"])]
    for index in range(5):
        angle = index * math.tau / 5
        start = (POS["escape"][0] + 0.46 * math.cos(angle), POS["escape"][1] + 0.46 * math.sin(angle))
        end = (POS["escape"][0] + 2.95 * math.cos(angle), POS["escape"][1] + 2.95 * math.sin(angle))
        escape_parts.append(bar(start, end, 0.35, 0.25, 2.2, 3.0))
    add("escape_wheel", fuse(escape_parts).cut(cylinder(0.30, 2.1, 3.1, POS["escape"])), "CuZn37", brass)

    for name, key, leaves, radius, z0, z1 in [
        ("center_pinion", "center", 12, 2.6, 3.2, 5.2),
        ("third_pinion", "third", 8, 1.5, 3.2, 4.8),
        ("fourth_pinion", "fourth", 10, 1.8, 3.0, 4.6),
        ("escape_pinion", "escape", 8, 1.4, 1.4, 3.4),
    ]:
        pinion_bore = {"center": 0.44, "third": 0.19, "fourth": 0.19, "escape": 0.30}[key]
        pinion = local(prism(gear_outline(leaves, radius, radius * 0.45), z0, z1), POS[key])
        add(name, pinion.cut(cylinder(pinion_bore, z0 - 0.1, z1 + 0.1, POS[key])), "steel", steel)

    for name, key, radius, z0, z1, pivot_diameter in [
        ("center_arbor", "center", 0.44, 0.2, 5.6, 0.36),
        ("third_arbor", "third", 0.19, 0.2, 5.5, 0.34),
        ("fourth_arbor", "fourth", 0.19, 0.2, 5.5, 0.34),
        ("escape_arbor", "escape", 0.30, 0.2, 5.55, JEWELS["escape"]["pivot"]),
        ("pallet_staff", "fork", 0.24, 0.2, 4.95, JEWELS["fork"]["pivot"]),
    ]:
        arbor = cylinder(radius, 1.0, z1, POS[key])
        arbor = fuse([
            arbor,
            cylinder(pivot_diameter / 2, z0, 1.15, POS[key]),
            cylinder(pivot_diameter / 2, z1 - 0.15, z1 + 0.65, POS[key]),
        ])
        add(name, arbor, "hardened steel", steel)

    add("pallet_fork", make_pallet(), "hardened steel", steel)
    pallet_entry = prism([(-0.72, -0.28), (0.72, -0.28), (0.76, 0.22), (0.62, 0.34), (-0.72, 0.30)], 2.05, 3.45)
    pallet_exit = pallet_entry.rotate((0, 0, 0), (0, 0, 1), math.degrees(-0.8491 + 0.2284))
    entry = pallet_entry.rotate((0, 0, 0), (0, 0, 1), math.degrees(-0.2284)).translate((fork_x - 1.2, fork_y + 2.3, 0))
    exit_stone = pallet_exit.translate((fork_x - 2.6, fork_y, 0))
    add("pallet_entry_stone", entry, "synthetic ruby purchased pallet stone", ruby)
    add("pallet_exit_stone", exit_stone, "synthetic ruby purchased pallet stone", ruby)

    balance_rim = ring(7.6, 6.4, 5.4, 6.6, POS["balance"])
    balance_bar = bar((balance_x - 6.6, balance_y), (balance_x + 6.6, balance_y), 1.3, 1.3, 5.55, 6.45)
    add("balance_wheel", fuse([balance_rim, balance_bar]).cut(cylinder(0.50, 5.3, 6.7, POS["balance"])), "CuZn37 monometallic", brass)
    balance_staff = fuse([
        cylinder(0.5, 3.2, 8.1, POS["balance"]),
        cylinder(JEWELS["balance"]["pivot"] / 2, -0.05, 3.4, POS["balance"]),
        cylinder(JEWELS["balance"]["pivot"] / 2, 8.0, 8.70, POS["balance"]),
    ])
    add("balance_staff", balance_staff, "hardened steel", steel)
    add("double_roller", ring(1.7, 0.50, 4.2, 5.2, POS["balance"]), "steel", steel)
    add("impulse_jewel", cylinder(0.38, 4.0, 5.4, (balance_x + 1.35, balance_y)), "synthetic ruby purchased roller jewel", ruby)
    hairspring, hairspring_collet, hairspring_stud = make_hairspring()
    add("hairspring", hairspring, "0.08 mm blued spring steel", blue)
    add("hairspring_collet", hairspring_collet, "slit steel hairspring collet", steel)
    add("hairspring_stud", hairspring_stud, "slotted steel outer hairspring stud", steel)

    regulator = fuse([
        ring(0.72, 0.30, 8.64, 8.82, POS["balance"]),
        bar((balance_x + 0.3, balance_y + 0.1), (balance_x + 4.8, balance_y + 1.25), 0.52, 0.34, 8.66, 8.82),
    ])
    add("regulator", regulator, "steel", steel)
    for index, (x, y) in enumerate([(4.65, 1.08), (4.95, 1.38)]):
        add(f"regulator_pin_{index + 1}", cylinder(0.10, 7.05, 8.86, (balance_x + x, balance_y + y)), "steel", steel)

    for name, key, teeth, pitch, height, z0, z1 in [
        ("time_barrel_gear", "barrel", 96, 13.5, 0.75, 1.4, 4.4),
        ("alarm_barrel_gear", "alarm_barrel", 96, 12.5, 0.75, 1.4, 4.0),
    ]:
        barrel_gear = local(prism(gear_outline(teeth, pitch, height), z0, z1), POS[key])
        barrel_gear = barrel_gear.cut(cylinder(pitch - 1.1, z0 - 0.1, z1 + 0.1, POS[key]))
        add(name, barrel_gear, "CuZn37", brass)
        add(name + "_drum", ring(pitch - 1.0, pitch - 1.5, 1.4, 3.8, POS[key]), "CuZn37", brass)
        add(name + "_cover", ring(pitch - 1.0, 0.65, 3.8, 4.0, POS[key]), "CuZn37", brass)
        ratchet = local(prism(saw_outline(7, 3.4 if key == "barrel" else 3.0), 4.0, 4.8), POS[key])
        square_drive = box((1.07, 1.07, 1.0), POS[key], 4.4)
        add(name + "_ratchet", ratchet.cut(square_drive), "steel", steel)
        barrel_arbor = fuse([
            cylinder(0.65, 0.2, 4.0, POS[key]),
            box((1.05, 1.05, 0.8), POS[key], 4.4),
            cylinder(0.40, 4.8, 5.8, POS[key]),
        ])
        add(name + "_arbor", barrel_arbor, "hardened steel", steel)

    saw_wheel = local(prism(saw_outline(14, 4.6), 2.4, 3.2), POS["saw"])
    add("hammer_fork_saw_wheel", saw_wheel.cut(cylinder(0.23, 2.3, 3.3, POS["saw"])), "CuZn37", brass)
    saw_pinion = local(prism(gear_outline(12, 1.4, 0.63), 1.4, 2.4), POS["saw"])
    add("hammer_fork_saw_pinion", saw_pinion.cut(cylinder(0.23, 1.3, 2.5, POS["saw"])), "steel", steel)
    add("hammer_fork_arbor", cylinder(0.23, 0.2, 5.6, POS["saw"]), "steel", steel)

    guard_xy = (19.5, -2.5)
    guard_outline = [
        (1.0, 0.9), (0.4, 1.45), (-1.8, 1.25), (-4.8, 1.8), (-6.8, 2.65),
        (-7.75, 2.8), (-8.35, 2.1), (-8.15, 1.15), (-7.2, 0.65),
        (-5.0, 0.55), (-2.2, -0.25), (-0.6, -0.95), (0.75, -0.75), (1.2, 0),
    ]
    add("alarm_shutoff_guard", perforated_plate([(x + guard_xy[0], y + guard_xy[1]) for x, y in guard_outline], [(*guard_xy, 0.72)], 4.0, 4.35), "steel", steel)
    add("alarm_guard_arbor", cylinder(0.35, 0.2, 5.0, guard_xy), "steel", steel)

    hammer_xy = POS["hammer"]
    outer = [(hammer_xy[0] + 1.65 * math.cos(i * math.pi / 32), hammer_xy[1] + 1.65 * math.sin(i * math.pi / 32)) for i in range(33)]
    inner = [(hammer_xy[0] + 1.08 * math.cos(i * math.pi / 32), hammer_xy[1] + 1.08 * math.sin(i * math.pi / 32)) for i in reversed(range(33))]
    hammer_fork = prism(outer + inner, 2.8, 3.35)
    add("hammer_fork", hammer_fork, "steel", steel)
    hammer_arm = fuse([
        bar(hammer_xy, (hammer_xy[0] + 2.8, hammer_xy[1] - 2.4), 0.48, 0.34, 3.5, 3.85),
        bar((hammer_xy[0] + 2.8, hammer_xy[1] - 2.4), (hammer_xy[0] + 9.6, hammer_xy[1] - 3.1), 0.34, 0.28, 3.5, 3.85),
    ])
    add("hammer_arm", hammer_arm, "steel", steel)
    add("hammer_head", cylinder(1.6, 2.8, 5.2, (hammer_xy[0] + 10.0, hammer_xy[1] - 3.2)), "steel", steel)
    add("hammer_staff", cylinder(0.35, 0.2, 5.0, hammer_xy), "steel", steel)

    hour_wheel = ring(8.23, 0.80, -1.05, -0.35)
    hour_tab = box((1.2, 1.2, 0.70), (0, -7.6), -0.70)
    add("hour_wheel", fuse([hour_wheel, hour_tab]), "CuZn37", brass)
    alarm_wheel = local(prism(gear_outline(72, 7.2, 0.4), -2.15, -1.35), POS["center"])
    alarm_wheel = alarm_wheel.cut(cylinder(0.82, -2.25, -1.25))
    notch = box((2.1, 2.2, 1.0), (0, -6.8), -1.75)
    add("alarm_wheel", alarm_wheel.cut(notch), "CuZn37", brass)
    add("alarm_wheel_bushing", ring(0.82, 0.50, -2.25, -1.05), "CuZn37", brass)
    add("cannon_pinion", ring(1.82, 0.46, -2.40, -1.60), "CuZn37", brass)
    minute_xy = (-4.6, 2.4)
    add("minute_wheel", local(prism(gear_outline(36, 3.4, 0.35), -2.30, -1.75), minute_xy).cut(cylinder(0.18, -2.4, -1.65, minute_xy)), "CuZn37", brass)
    add("minute_wheel_pinion", local(prism(gear_outline(8, 1.1, 0.49), -1.10, -0.35), minute_xy), "steel", steel)
    alarm_idler = (7.6, 3.2)
    add("alarm_idler", local(prism(gear_outline(30, 3.0, 0.35), -2.2, -1.65), alarm_idler).cut(cylinder(0.18, -2.3, -1.55, alarm_idler)), "CuZn37", brass)
    add("alarm_setting_pinion", local(prism(gear_outline(12, 1.4, 0.63), -2.0, -1.45), (7.2, 7.8)), "CuZn37", brass)
    stop_xy = (10.2, 5.5)
    stop_spring = fuse([
        bar((stop_xy[0], stop_xy[1] - 5.0), (stop_xy[0] + 0.25, stop_xy[1] + 5.8), 0.68, 0.55, -2.35, -2.05),
        bar((stop_xy[0] + 0.25, stop_xy[1] + 5.8), (stop_xy[0] - 0.35, stop_xy[1] + 6.6), 0.55, 0.38, -2.35, -2.05),
    ])
    add("alarm_stop_spring", stop_spring, "spring steel", steel)
    add("alarm_release_link", bar((10.35, 0.2), (17.1, -3.1), 0.38, 0.30, 1.15, 4.15), "steel", steel)

    add("dial", ring(26.5, 0.65, -2.65, -2.40), "painted brass", (0.87, 0.85, 0.73))
    add("alarm_hand", make_hand(22.0, 0.70, 2.05, 1.10, -3.00, -2.80), "CuZn37", brass)
    add("hour_hand", make_hand(18.0, 1.0, 1.75, 1.44, -3.35, -3.15), "blued steel", blue)
    add("minute_hand", make_hand(23.5, 0.68, 1.35, 0.92, -3.75, -3.55), "blued steel", blue)
    add("hand_retainer", cylinder(0.42, -4.0, -3.75), "steel", steel)

    bell_profile = [
        (0, 15.0), (20, 15.0), (27, 14.7), (30.5, 13.0), (32, 10.0),
        (32.2, 1.0), (31.4, 0.6), (31.2, 9.8), (29.8, 12.6),
        (26.5, 14.1), (20, 14.4), (0, 14.4),
    ]
    bell = cq.Workplane("XZ").polyline(bell_profile).close().revolve(360, (0, 0), (0, 1))
    add("bell_back_cover", bell, "stamped steel", steel)

    for index, xy in enumerate(TRAIN_SCREWS):
        add(f"train_bridge_screw_{index + 1}", screw(xy, 0.6, 6.38, 6.68), "steel slotted screw", steel)
    for index, xy in enumerate(ALARM_SCREWS):
        add(f"alarm_bridge_screw_{index + 1}", screw(xy, 0.6, 6.38, 6.68), "steel slotted screw", steel)
    for index, xy in enumerate(ALARM_WHEEL_PLATE_SCREWS):
        add(f"alarm_wheel_plate_screw_{index + 1}", dial_side_screw(xy), "steel slotted screw", steel)
    for index, xy in enumerate([(fork_x - 2.0, fork_y + 2.8), (fork_x - 1.4, fork_y - 2.55)]):
        add(f"pallet_bridge_screw_{index + 1}", screw(xy, 0.6, 5.52, 5.82, 0.82), "steel slotted screw", steel)
    for index, xy in enumerate([(balance_x - 6.2, balance_y + 3.7), (balance_x + 1.0, balance_y - 6.4)]):
        add(f"balance_cock_screw_{index + 1}", screw(xy, 0.6, 8.62, 8.94, 0.90), "steel slotted screw", steel)

    return parts, plates


def shape_solids(shape: cq.Workplane) -> list[cq.Solid]:
    return shape.solids().vals()


def cylindrical_diameters(shape: cq.Workplane) -> list[float]:
    return [
        face._geomAdaptor().Cylinder().Radius() * 2
        for face in shape.faces().vals()
        if face.geomType() == "CYLINDER"
    ]


def export() -> None:
    parts, plates = build()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    assembly = cq.Assembly(name="Slava_5671_early_all_metal")
    manifest_parts = []
    total_solids = 0

    for name, part in parts.items():
        solids = shape_solids(part.shape)
        if not solids or not all(solid.isValid() for solid in solids):
            raise RuntimeError(f"Invalid or empty solid: {name}")
        total_solids += len(solids)
        assembly.add(part.shape, name=name, color=part.color)
        bounds = part.shape.val().BoundingBox()
        if name in {"pallet_entry_stone", "pallet_exit_stone"}:
            if abs(bounds.zlen - 1.40) > 1e-6 or max(bounds.xlen, bounds.ylen) < 1.45:
                raise RuntimeError(f"Pallet stone must use its toe-in planar fork orientation: {name}")
        manifest_parts.append({
            "name": name,
            "material": part.material,
            "solid_count": len(solids),
            "volume_mm3": round(sum(solid.Volume() for solid in solids), 6),
            "bounds_mm": [bounds.xmin, bounds.ymin, bounds.zmin, bounds.xmax, bounds.ymax, bounds.zmax],
        })

    assembly_path = OUTPUT_DIR / "slava-5671.step"
    assembly.export(str(assembly_path))
    expected_plate_seats = {
        "mainplate": [data["outside"] - PRESS_INTERFERENCE_MM for data in JEWELS.values()],
        "train-bridge": [JEWELS["escape"]["outside"] - PRESS_INTERFERENCE_MM],
        "pallet-bridge": [JEWELS["fork"]["outside"] - PRESS_INTERFERENCE_MM],
        "balance-cock": [JEWELS["balance"]["outside"] - PRESS_INTERFERENCE_MM],
        "alarm-bridge": [],
        "alarm-wheel-plate": [],
    }
    for name, shape in plates.items():
        path = OUTPUT_DIR / f"{name}.step"
        cq.exporters.export(shape, str(path))
        roundtrip = cq.importers.importStep(str(path))
        diameters = cylindrical_diameters(roundtrip)
        for expected in expected_plate_seats[name]:
            if not any(abs(actual - expected) < 1e-6 for actual in diameters):
                raise RuntimeError(f"Missing {expected:.3f} mm jewel seat in {path}")

    for name in ["hairspring", "hairspring_collet", "hairspring_stud"]:
        path = OUTPUT_DIR / f"{name.replace('_', '-')}.step"
        cq.exporters.export(parts[name].shape, str(path))
        roundtrip = cq.importers.importStep(str(path))
        solids = roundtrip.solids().vals()
        if len(solids) != 1 or not solids[0].isValid():
            raise RuntimeError(f"{name} must round trip as one valid solid")
        if name == "hairspring":
            spring_bounds = roundtrip.val().BoundingBox()
            if abs(spring_bounds.zlen - HAIRSPRING["thickness"]) > 1e-6:
                raise RuntimeError(f"Hairspring thickness is {spring_bounds.zlen:.6f} mm")
            if spring_bounds.xlen < 9.0 or spring_bounds.ylen < 9.0 or solids[0].Volume() < 1.5:
                raise RuntimeError("Hairspring spiral body is missing or truncated")
            if not any(abs(diameter - 0.20) < 1e-6 for diameter in cylindrical_diameters(roundtrip)):
                raise RuntimeError("Hairspring outer stud eye is missing its 0.20 mm hole")

    imported = cq.importers.importStep(str(assembly_path))
    imported_solids = imported.solids().vals()
    if len(imported_solids) != total_solids or not all(solid.isValid() for solid in imported_solids):
        raise RuntimeError(f"STEP round trip failed: expected {total_solids} valid solids, got {len(imported_solids)}")
    bounds = imported.val().BoundingBox()
    if abs(bounds.zlen - MOVEMENT_HEIGHT_MM) > 1e-6:
        raise RuntimeError(f"Movement height is {bounds.zlen:.6f} mm, expected {MOVEMENT_HEIGHT_MM:.6f} mm")

    mesh_center_distances = {}
    for first, second, expected in [
        ("barrel", "center", 16.1),
        ("center", "third", 10.5),
        ("third", "fourth", 12.8),
        ("fourth", "escape", 8.4),
        ("alarm_barrel", "saw", 13.9),
    ]:
        actual = math.dist(POS[first], POS[second])
        if abs(actual - expected) > 1e-6:
            raise RuntimeError(f"Mesh center distance {first}/{second}: {actual:.6f} mm")
        mesh_center_distances[f"{first}/{second}"] = actual

    manifest = {
        "units": "mm",
        "caliber_equivalent_diameter": CALIBER_MM,
        "mainplate_unperforated_area_mm2": polygon_area(mainplate_outline()),
        "movement_height": bounds.zlen,
        "assembly_bounds_mm": [bounds.xmin, bounds.ymin, bounds.zmin, bounds.xmax, bounds.ymax, bounds.zmax],
        "solid_count": total_solids,
        "jewels": JEWELS,
        "cap_jewel": CAP_JEWEL,
        "press_interference": PRESS_INTERFERENCE_MM,
        "seat_diameters": {key: data["outside"] - PRESS_INTERFERENCE_MM for key, data in JEWELS.items()},
        "mesh_center_distances": mesh_center_distances,
        "hairspring": {
            **HAIRSPRING,
            "minimum_radial_gap": (HAIRSPRING["outer_radius"] - HAIRSPRING["inner_radius"]) / HAIRSPRING["turns"] - HAIRSPRING["ribbon_width"],
            "outer_eye_diameter": 0.20,
            "collet_slit_width": HAIRSPRING["ribbon_width"] + 0.02,
        },
        "parts": manifest_parts,
    }
    (OUTPUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Exported {total_solids} valid solids to {assembly_path}")
    print(f"Assembly bounds: {bounds.xlen:.3f} x {bounds.ylen:.3f} x {bounds.zlen:.3f} mm")
    print(f"Mainplate equivalent diameter: {CALIBER_MM:.3f} mm; area: {manifest['mainplate_unperforated_area_mm2']:.3f} mm^2")
    for key, diameter in manifest["seat_diameters"].items():
        print(f"{key} jewel seat: {diameter:.3f} mm")
    print(f"Hairspring: {HAIRSPRING['ribbon_width']:.3f} x {HAIRSPRING['thickness']:.3f} mm ribbon, one valid solid")


if __name__ == "__main__":
    sys.setrecursionlimit(10000)
    export()
