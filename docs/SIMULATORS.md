# Simulator simplifications

Learners and trainers should know where the simulators differ from real equipment. The app is for training only.

## Circuit (wiring) simulator
- Calculates behaviour from what was wired. Nothing is scripted.
- Supply is ideal: UK nominal 230/400 V 50 Hz (line-to-line exactly 400 V, line-to-neutral shown as 231 V). Control is 24 V DC from G1.
- Contacts are fully open or fully closed. No contact bounce, arcing or wear.
- No voltage drop, cable length, capacitance or transients.
- Unpowered parts take their voltage through loads (coils, lamps, motor windings) by nodal analysis. This is why back-feed and open returns read realistically. Floating conductors read 0 V; real meters may show "ghost" voltages.
- A short between two different potentials trips the nearest protective device: the PSU output first (24 V side), then F1, then Q1. N–PE faults do not trip an RCD.
- MPCB/MCB trip on short circuit only. The thermal overload F2 is the only overcurrent model.
- 24 V coils and lamps burn out if they get more than 100 V AC.
- Coils: 120 Ω, pull in at 20 V DC, drop out below 10 V DC. Lamps: 576 Ω.
- 0 V is treated as its own reference. It is not shown bonded to earth.

## Motor and overload
- States: stopped, starting, running, stalled, two phases only, coasting.
- Synchronous speed = 120 × f / poles. Running speed is the nameplate rated speed.
- Starting current = 6 × FLC for 1.2 s (VERIFY). Two-phase stall = 5 × FLC, losing a phase while running = 1.73 × FLC (VERIFY).
- Overload: first-order thermal model (time constant 100 s), trips at about 1.2 × setting, about 3 s at 7.2 × setting (simplified Class 10, VERIFY). It cannot be reset until it has cooled.
- No mechanical load curve. Acceleration is linear.

## Multimeter and voltage indicator
- The meter is true-RMS: V~ shows only AC, V= only DC, so the wrong mode reads about 0.
- Ω refuses to read if the circuit is live or still connected to a supply conductor (including N and 0 V), and records a safety event.
- The voltage indicator shows voltage bands, not exact values. A faulty indicator shows nothing, which is why prove-test-prove matters.

## Safe isolation procedure
- Follows common UK practice: identify, switch off, lock and tag, prove-test-prove at the point of work, then decide. Your site procedure takes precedence (VERIFY #5).
