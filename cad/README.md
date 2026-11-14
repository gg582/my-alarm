# Slava 5671 STEP export

This is a CAD-only export path. It adds no controls, downloads, or runtime code to the web application.

## Generate

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r cad/requirements.txt
npm run export:step
```

The exporter writes native OpenCascade B-rep solids, not triangulated render meshes:

- `cad/output/slava-5671.step`: named assembly, including the plates, wheels, arbors, escapement, alarm linkage, hands, jewels, and bell.
- `cad/output/mainplate.step`
- `cad/output/train-bridge.step`
- `cad/output/pallet-bridge.step`
- `cad/output/balance-cock.step`
- `cad/output/alarm-bridge.step`
- `cad/output/alarm-wheel-plate.step`: dial-side alarm wheel plate with the central bushing bore, motion-work arbor holes, and three mounting-screw holes.
- `cad/output/hairspring.step`: one continuous flat spring with inner terminal and pierced outer stud eye.
- `cad/output/hairspring-collet.step`: split staff collet with a 0.20 mm terminal slot.
- `cad/output/hairspring-stud.step`: slotted outer stud with a 0.18 mm retaining pin.
- `cad/output/manifest.json`: dimensions, materials, part bounds, volumes, and solid counts.

The command reimports every STEP file, checks solid validity, verifies the 19.000 mm overall height, checks the train center distances, and confirms the cylindrical jewel-seat diameters in the exported plates. The hairspring and both fittings must each reimport as exactly one valid solid; the spring is also checked for its 0.08 mm stock thickness and 0.20 mm outer eye.

## Dimensions and fit

All coordinates and STEP units are millimetres. The dial and hands are on the front of the mainplate; the going train, bridges, and bell are on the back.

The manual specifies a **55.8 mm equivalent caliber**, not a guaranteed circular mainplate diameter. The irregular Figure 1 plate outline is scaled so its unperforated area equals the area of a 55.8 mm circle: `2445.447 mm²`. The bell and the complete front-to-back assembly define the exported `64.400 × 64.400 × 19.000 mm` bounds.

The six hole-jewel seats use a 0.01 mm diametral press interference, following the friction-setting procedure in the jewel reference. Cap jewels have blind pockets in separate steel settings.

| Location | Purchased jewel | Jewel OD / hole | Plate or setting seat |
| --- | --- | --- | --- |
| Escape, upper and lower | Seitz 30712/26-120 | 1.20 / 0.26 mm | 1.190 mm |
| Pallet staff, upper and lower | Seitz 30712/15-100 | 1.00 / 0.15 mm | 0.990 mm |
| Balance, upper and lower | Seitz 30710/16-120 | 1.20 / 0.16 mm | 1.190 mm |
| Balance caps, upper and lower | Seitz 30713-120 | 1.20 mm OD | 1.190 mm blind pocket |

The pallet stones and impulse jewel complete the manual's 11-jewel count: six hole jewels, two cap jewels, two pallet stones, and one impulse jewel. The pallet stones use a fork arrangement in the XY plane: their long axes are X-referenced and toed into the escape-wheel contact directions at -0.2284 and -0.8491 radians, with a 1.40 mm Z thickness. Purchased jewels are simplified in the assembly; their seats and mating pivot diameters are the manufacturing interface.

The 6.5-turn hairspring uses a 520-segment radial profile at 80 segments per turn. Its 1.10–5.00 mm radial span, 0.18 mm ribbon width, and 0.08 mm thickness leave a nominal 0.42 mm radial gap between turns. The inner tongue fits the split collet, and the outer eye fits the stud pin; both terminals are fused into the same exported solid. Export validation rejects a missing or truncated spiral by checking its two-dimensional bounds and minimum body volume. These dimensions describe flat-stock microfabrication geometry, not an FDM-printable process guarantee.

## References and limits

- L. V. Shamonova, *Repair of Mechanical Alarm Clocks* (1987), Figure 1 and pp. 4, 12–14: [manual](https://www.cccp-forum.it/docs/books/Shamonova%20-%20Remont%20mekhanicheskikh%20budilnikov%20(1987).pdf). This supplies the equivalent caliber, 19 mm height, construction, escapement, and alarm operation.
- S. V. Tarasov, *Pribory Vremeni* (1975): [caliber definition](https://www.cccp-forum.it/docs/books/Tarasov%20-%20Pribory%20Vremeni%20(1975).pdf). A round caliber is the plate seating diameter; a shaped movement uses an equivalent area-based diameter.
- [Early all-metal 5671 restoration](https://soviet-box.com/vintage-slava-11-jewels-alarm-clock): component layout, bridge profiles, motion works, ratchets, balance settings, and alarm parts.
- [Seitz 30712 catalogue listing](https://www.ofrei.com/page942.html), [30712/26-120 listing](https://www.beco-technic.com/en/Seitz-jewels-cylindrical-hole-N0-30712-OE-d-0-26-D-1-20-mm/216602F47), [balance jewel listing](https://julesborel.com/collections/jewels?page=2), and [cap jewel listing](https://julesborel.com/products/endstone-cap-jewel-od-1-20mm): purchased jewel sizes.
- [Vintage Watch Straps: jewel settings](https://www.vintagewatchstraps.com/watchjewels.php): friction-set jewels are pressed into a plate hole 0.01 mm smaller than the jewel.

No factory drawing with absolute tooth dimensions, individual plate thicknesses, or all arbor coordinates was found. Those values remain reference-photo-derived design parameters. The exporter verifies geometry and file integrity, but this is not a certified factory replacement drawing or a full kinematic interference analysis.
