# VERIFY list (for the qualified engineer)

Items that must be checked before technicians train on the related content.

| # | Item | Used in | Status |
|---|---|---|---|
| 1 | Default DOL starting current multiple (6× FLC proposed) | Motor engine, M3 | Open |
| 2 | Simplified Class 10 overload trip curve points | Motor engine, M3/M4 | Open |
| 3 | Siemens analog input raw counts: over-range, under-range, wire break | Loop engine, M2 | Open |
| 4 | NAMUR NE 43 saturation and failure current values | Loop engine, M2 | Open |
| 5 | M0 safe isolation steps match the site procedure | M0 | Open |
| 6 | Wording of the standing safety notice (Settings → About, first run) | Whole app | Open |
| 7 | Two-phase stall (5 × FLC) and single-phasing (1.73 × FLC) current multiples | Motor engine, M3 | Open |
| 8 | DOL quiz Q5 and Learn: "often 6 to 8 times FLC" starting current | M3 | Open |
| 9 | DOL bench checklist: continuity and insulation resistance tests "to the site procedure" (test voltage not stated in the app) | M3 Apply | Open |
| 10 | Hazardous area zone definitions (Zone 0/1/2, 20/21/22) as worded in M0 | M0 | Open |
| 11 | M0 wording on live work, permits and arc flash | M0 | Open |
| 12 | M1: CAT III / CAT IV meter guidance as worded | M1 L1 | Open |
| 13 | M1: "230 V nominal is often 235–245 V on site" | M1 L1 | Open |
| 14 | M1: IEC 81346-2 letter codes (P for lamps, Q for power switching) and older codes (KM, H) as described | M1 L2 | Open |
| 15 | M1: cross-reference format "/3.4" (page.column) described as common, not universal | M1 L2 | Open |
| 16 | M2: digital input ON above 15 V / OFF below 5 V (IEC 61131-2 type 1 style) | DI engine, M2 L1 | Open |
| 17 | M2: 3-wire sensor colours BN +, BU 0 V, BK output | M2 L1 | Open |
| 18 | M2: transmitter minimum voltage "typically 10–12 V" and 700 Ω example | Loop engine, M2 L2 | Open |
| 19 | M2: Pt100 = 100 Ω at 0 °C, about 138.5 Ω at 100 °C | M2 L2 | Open |
| 20 | M2: raw count 32767 reported outside −4864…32511 (wire break / overflow) | Loop engine | Open |
| 21 | M2: Ex i (intrinsic safety) precautions as worded | M2 L2 | Open |
| 22 | T4: note that protective alarms are often fail-safe (de-energise on alarm) | Template T4 | Open |
| 23 | M3: IR test voltage "typically 500 V DC for 400 V equipment" and minimum "widely used 1 MΩ" for LV motors (site procedure governs) | M3 L2 | Open |
| 24 | M3: standard terminal box layout U1 V1 W1 over W2 U2 V2; delta links upright, star links across the bottom row | M3 L2 | Open |
| 25 | M3: star start current and torque = 1/3 of DOL; star-delta needs a 400 V Δ motor on 400 V | M3 L4 | Open |
| 26 | M3: overload in the winding circuit of a star-delta starter set to 0.58 × FLC | M3 L4, T3 | Open |
| 27 | M3: contactor release time 30 ms used in the simulator; star/delta and forward/reverse usually also mechanically interlocked | Engine, M3 L3/L4 | Open |
| 28 | M3: soft starter current limit example 3 × FLC, ramp 8 s; torque ∝ voltage²; thyristors are not an isolator | M3 L5 | Open |
| 29 | M3: motor model multipliers for wrong connections (0.58 → 1.3 × FLC running; 1.73 → 2.5 × FLC) | Engine | Open |
| 30 | M3 L4 timer 4 s: suitable as a teaching value; real settings come from commissioning | M3 L4, T3 | Open |
