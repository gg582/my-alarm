# Slava 5671 Functional Print and Housing Plan

## 1. Objective

Develop the current reference-based Slava 5671 model into a serviceable mechanical alarm-clock assembly that can be manufactured and adjusted for reliable operation. Exact factory-profile replication is not required. Tooth forms, clearances, and local plate geometry may be optimized near their current estimates when that improves meshing, winding, regulation, assembly, or printing.

This document is a plan only. It does not change the current web renderer, simulation, or STEP exporter.

## 2. Scope and manufacturing assumptions

- Use the current `cad/export_step.py` model as the layout baseline, not as a certified factory drawing.
- Use FDM-printed PETG or ABS for the external housing, bezel, movement carrier, rear cover, keys, and external alarm lever.
- Use high-resolution resin printing or machining for prototype gears and small levers. Production gear material and process must be selected from measured wear and torque tests.
- Use metal arbors, purchased jewels, metal mainsprings, and a metal hairspring. Do not rely on printed plastic for jewel press fits, pivot surfaces, or spring elasticity.
- Use metal threaded inserts, reamed holes, or metal liners where FDM accuracy is insufficient.
- Preserve the Slava 5671 train ratios, approximately 55.8 mm equivalent movement caliber, 19 mm movement height, independent time and alarm barrels, central alarm indication, and manual alarm shutoff function.
- The work is mechanical and CAD-only. No new web control is required.

## 3. Required mechanical architecture

The final assembly will contain:

1. A front bezel and transparent crystal.
2. A structural mid-shell.
3. A removable movement carrier that locates the mainplate without loading the arbors.
4. The time and alarm movement, including purchased or metal microcomponents.
5. A bell and unobstructed hammer chamber.
6. A removable rear plate with winding, regulation, and alarm-switch access.
7. Three rear-plate fastening screws on a 120-degree central bolt circle.
8. Independent detachable winding keys for the time and alarm barrels.
9. An external two-position alarm ON/OFF lever linked to the internal saw-wheel shutoff lever.

## 4. Work packages

### A. Freeze the mechanical baseline and keep-out map

- Export a complete arbor, jewel, screw, pillar, spring, hammer, and moving-envelope coordinate table.
- Mark keep-out volumes for the center arbor, motion works, both winding arbors, balance, regulator, hammer travel, bell, alarm shutoff travel, and all bridge screws.
- Distinguish fixed clearance zones from swept moving volumes.
- Assign every housing screw, access opening, boss, and support rib to a location outside those zones.
- Record which current dimensions are reference-derived and which are adjustable manufacturing parameters.

Deliverable: a dimensioned assembly layout and a keep-out drawing shared by the movement and housing CAD.

### B. Tune the tooth forms for reliable operation

- Retain the current tooth counts and train ratios.
- Replace generic going-train and barrel-to-pinion tooth forms with parameterized involute profiles based on the existing pitch radii.
- Keep the hammer-fork saw wheel, ratchets, and escape wheel as separate functional profile types; do not substitute involute teeth for these parts.
- Tune addendum modification, root fillets, backlash, and center-distance offsets together.
- Start with a measurable backlash coupon set rather than assuming one printer tolerance. Initial test ranges may be 0.03–0.08 mm for machined gears and 0.10–0.20 mm for resin prototypes.
- Permit small center-distance adjustments near the current estimates if tooth contact remains correct and the train ratio is unchanged.
- Check a full revolution of every wheel and pinion pair, including worst-case eccentricity and axial offset.
- Tune the escape-wheel locking and impulse faces together with pallet position and toe-in. Do not scale the escape teeth independently of the pallets.
- Verify that the alarm barrel can drive the saw wheel through the full alarm run without tooth wedging or excessive hammer drag.

Acceptance: no cyclic tight spot, tooth-tip interference, loss of drive, or visible step discontinuity during slow manual rotation.

### C. Implement a usable escapement speed regulator

- Use the balance hairspring regulator to change effective hairspring length; do not treat the escape wheel as an independent speed-control device.
- Provide a rigid regulator pivot, twin regulator pins, and a fine-adjustment screw or friction-held lever.
- Add a rear-access screwdriver slot with a visible `- / +` scale and mechanical end stops.
- Prevent the regulator from touching the hairspring body, balance rim, balance cock, or rear plate throughout its travel.
- Preserve access to hairspring and balance service without removing the housing mid-shell.
- Record beat rate and amplitude before changing regulator position.

Acceptance: smooth regulation over a useful adjustment range, repeatable rate changes, no hairspring pinning at either end, and no regulator drift after vibration and winding tests.

### D. Complete independent time and alarm winding

- Provide separate winding arbors and detachable square-drive keys for the time and alarm barrels.
- Match the key socket to the actual square arbor; include insertion chamfers and a replaceable metal sleeve where wear is expected.
- Retain the time-barrel ratchet and click.
- Retain the alarm-barrel slipping bridle so full winding does not overload the spring or printed housing.
- Add rear-plate guide bushings around both winding openings. The bushings must locate the keys without carrying radial movement loads.
- Label the openings `TIME` and `ALARM`; prevent the two keys from being interchanged if their drives differ.
- Verify winding through the full spring range with the rear plate installed and with the clock standing in its normal orientation.

Acceptance: independent winding, no case rubbing, no arbor bending, positive ratchet action, controlled alarm-bridle slip, and no movement displacement under winding torque.

### E. Add a real external alarm ON/OFF mechanism

- Connect the external lever to the existing manual shutoff lever and its friction washer.
- Keep this manual shutoff separate from the straight spring-20 time-release mechanism.
- `ON`: retract the shutoff pawl from the saw-wheel teeth and allow the spring-20/hour-wheel release to start the alarm at the set time.
- `OFF`: insert the shutoff pawl between the saw-wheel teeth to stop an active alarm or prevent a pending alarm.
- Add two stable detents and labels `ON` and `OFF`.
- Use a guided slot and mechanical stops so the user cannot overtravel the internal pawl.
- Avoid transmitting switch force into the saw-wheel arbor, bridge, or housing wall.
- Verify that the switch remains in its selected position during winding, hammering, and normal handling.

Acceptance: at least 20 repeated ON/OFF cycles without slip or sticking, immediate stop during ringing, reliable pre-disable, and correct subsequent release after re-enabling.

### F. Design the rear plate and its drawing

Create a native rear-plate solid and a dimensioned manufacturing drawing containing:

- Time-winding access hole and guide-bushing seat.
- Alarm-winding access hole and guide-bushing seat.
- Regulator adjustment slot with travel limits and scale markings.
- Alarm ON/OFF lever slot, guide, detent pockets, and assembly access.
- Three central rear-plate through-holes spaced 120 degrees apart.
- Three matching housing bosses with metal threaded inserts or machine-screw nuts.
- Screw-head counterbores or countersinks and tool clearance.
- A locating lip or three-point register so screw clamping does not shift the movement.
- Bell ventilation and an unobstructed hammer/bell swept volume.
- Service access for rear-plate removal without pulling the winding arbors or regulator out of alignment.

Use M2 screws as the initial rear-plate fastening standard. Select the final bolt-circle diameter only after the central keep-out map is complete; do not place a boss over the center arbor, motion works, or bridge screw. Reinforce the central fastening region with ribs rather than making the entire plate excessively thick.

Initial FDM design values for test coupons:

- Rear-plate nominal thickness: 2.0–2.5 mm.
- Housing shell nominal thickness: 2.5–3.0 mm.
- Minimum rear-plate web around nonprecision openings: 2.0 mm.
- Screw-boss and insert zones: reinforced locally according to the selected insert specification.
- Precision bores: finish by reaming or use metal bushings instead of relying on as-printed dimensions.

The rear-plate drawing must include hole diameters, bolt-circle diameter, angular positions, thicknesses, counterbores, tolerances, insert specification, and a section view through the winding guides.

### G. Build the housing around the movement

- Locate the movement by the mainplate and dedicated mounting points, never by clamping a rotating arbor.
- Use a three-point movement support to avoid warping the mainplate.
- Separate the bell from the structural rear plate while retaining the bell mounting and acoustic openings.
- Provide hammer clearance over the full alarm stroke and at all assembly tolerances.
- Add a front dial register, crystal seat, and removable bezel.
- Keep winding keys and the alarm lever operable without removing the bezel or crystal.
- Avoid ribs in the balance, escapement, motion-work, and hammer keep-out volumes.
- Add alignment features so the rear plate can be removed and reinstalled without changing beat or alarm release timing.
- Provide a stable base and allow access to movement mounting screws for service.

Acceptance: the assembled housing does not change amplitude, beat, alarm release, winding torque, or hammer sound materially compared with the open bench assembly.

### H. Generate manufacturing files

Planned additional outputs:

- `cad/output/functional-movement.step`
- `cad/output/housing.step`
- `cad/output/movement-carrier.step`
- `cad/output/rear-plate.step`
- `cad/output/time-winding-key.step`
- `cad/output/alarm-winding-key.step`
- `cad/output/alarm-switch-lever.step`
- `cad/output/rear-plate-drawing.pdf`
- `cad/output/housing-assembly.step`
- An updated `cad/output/manifest.json` with process, material, fit, and part-role metadata
- A concise assembly and adjustment guide with screw torque, lubrication points, regulator direction, and alarm-switch operation

Each exported solid must be reimported and checked for validity. Drawing generation and manufacturing validation are separate tasks; file validity alone is not functional approval.

## 5. Verification sequence

1. **Fit coupons:** printer shrinkage, winding-guide holes, M2 inserts, lever slots, regulator slot, and rear-plate screw fit.
2. **Static CAD checks:** solid validity, assembly bounds, hole alignment, screw access, and rear-plate removal.
3. **Swept-volume checks:** all gears, balance, hairspring, pallets, hammer, regulator, and alarm shutoff over their complete travel.
4. **Going-train bench test:** manually rotate the complete train and check for cyclic tight spots.
5. **Escapement bench test:** measure beat rate and amplitude, then verify regulator response.
6. **Winding test:** fully wind both barrels through the rear plate and check for binding or housing deflection.
7. **Alarm test:** verify set-time release, full-wind alarm duration, manual stop, pre-disable, and repeated switching.
8. **Housing comparison:** repeat rate, amplitude, winding, and alarm tests with the housing installed.
9. **Durability test:** run continuously for 36 hours, inspect tooth wear and pivot condition, and repeat the alarm tests.
10. **Service test:** remove and reinstall the rear plate and movement carrier repeatedly; confirm that alignment and operation remain unchanged.

Record measured rate and alarm duration rather than claiming factory accuracy before testing. Stable 36-hour running without an unexplained stall is the minimum functional milestone. Regulation toward the manual's accuracy target follows only after stable operation is demonstrated.

## 6. Implementation order

1. Keep-out map and fit coupons.
2. Going-train tooth tuning and escapement contact tuning.
3. Metal/purchased microcomponent interfaces.
4. Time and alarm winding hardware.
5. Internal and external alarm shutoff linkage.
6. Regulator access and adjustment hardware.
7. Movement carrier and bell chamber.
8. Rear plate and three-screw central fastening.
9. Mid-shell, bezel, crystal, and base.
10. Full assembly export, drawings, bench validation, and iterative fit correction.

The rear plate and housing should not be finalized before the moving-envelope and access tests pass, because their openings and bosses depend on the tuned mechanical layout.

## 7. Explicit limits

- No claim of 100% factory-profile identity is required or implied.
- No claim that all components can be printed in ordinary FDM plastic.
- No claim of reliable operation based only on valid STEP solids.
- No change to the web presentation is necessary for this manufacturing track.
- Factory accuracy and long-term wear life require physical measurements and iterative prototypes, not visual similarity alone.
