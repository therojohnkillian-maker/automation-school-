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

- Terminal strips: each terminal number is one connection point; panel and field wires land on the same point.
- Resistors are ideal. Switches (S1 in M1) stay where they are put; push buttons spring back.
- No ammeter in the simulator yet: current is taught with a clamp meter in Learn and checked in the Prove test.

## Instruments (M2)
- 3-wire sensors switch only when their supply (BN–BU) is at least 18 V. PNP links BN to BK, NPN links BK to BU. Supply draw is modelled as 2.4 kΩ.
- Digital inputs are 3 kΩ between the input and its common, ON above 15 V either polarity (bidirectional input groups).
- A 2-wire transmitter is an ideal current source from + to −, limited to 3.8–20.5 mA (NAMUR NE 43 style), and 3.6 mA when failed. It needs at least its minimum voltage (10 V here); with less, the current falls to whatever keeps 10 V across it. Reversed or unpowered, it passes no current.
- Analog inputs and trip amplifiers are 250 Ω. Raw count 4 mA = 0, 20 mA = 27648, and 32767 outside −4864…32511 (VERIFY).
- Trip amplifier relays energise on alarm, with hysteresis. Supply to the trip amplifier is not modelled.
- No noise, cable capacitance or screen effects are modelled. Shielding is taught in Learn and Prove.

## Motor and overload
- States: stopped, starting, running, stalled, two phases only, coasting.
- Synchronous speed = 120 × f / poles. Running speed is the nameplate rated speed.
- Starting current = 6 × FLC for 1.2 s (VERIFY). Two-phase stall = 5 × FLC, losing a phase while running = 1.73 × FLC (VERIFY).
- Overload: first-order thermal model (time constant 100 s), trips at about 1.2 × setting, about 3 s at 7.2 × setting (simplified Class 10, VERIFY). It cannot be reset until it has cooled.
- No mechanical load curve. Acceleration is linear.
- 6-terminal motors (M3): each winding is a load between its 1 and 2 ends. The engine compares the voltage across the windings with the nameplate winding voltage: about 1 = correct; about 0.58 = star on a delta-rated motor (starting current × 1/3, acceleration about 3 × slower, running current 1.3 × FLC, so a starter stuck in star trips the overload in about half a minute); about 1.73 = delta on a star-rated motor (running current 2.5 × FLC). These multipliers are teaching values, not a motor model (VERIFY).
- An open winding can show voltage across it but carries no current. Two working windings stall the motor as single-phasing does.
- Insulation: each line terminal has 500 MΩ to PE by default; an insulation fault lowers one winding. The meter's IR range (500 V) reads MΩ and shows ">999 MΩ" above its range; the Ω range shows OL above 40 MΩ.
- Star-delta overload current: if a 6-terminal motor runs in delta through a delta contactor (no links in its terminal box), the overload feeding U1/V1/W1 is taken to carry winding current = line current ÷ √3. Otherwise it carries line current.
- Contactors release 30 ms after their coil loses voltage (pick-up is instant). This is why two contactors that change over at the same instant overlap without an interlock (VERIFY: typical release times vary by size and make). A contactor that keeps dropping out and pulling back in more than 5 times a second is reported as relay chatter.
- A push button press always lasts at least 150 ms of simulated time, as a real press does.
- On-delay timer: contacts 15-16 (NC) and 17-18 (NO) change over when the set time has elapsed with the coil energised; they reset as soon as the coil is de-energised. No timing tolerance.
- Soft starter: output follows the run signal (IN1-COM at 15 V or more). The motor fed from it starts at the current limit (× FLC) and reaches speed in the ramp time. If a supply phase is missing when the run signal comes on, it trips to FAULT until the run signal is removed. No soft stop, no bypass contactor model, no thyristor voltage waveforms.

## Multimeter and voltage indicator
- The meter is true-RMS: V~ shows only AC, V= only DC, so the wrong mode reads about 0.
- Ω refuses to read if the circuit is live or still connected to a supply conductor (including N and 0 V), and records a safety event.
- The voltage indicator shows voltage bands, not exact values. A faulty indicator shows nothing, which is why prove-test-prove matters.

## Safe isolation procedure
- Follows common UK practice: identify, switch off, lock and tag, prove-test-prove at the point of work, then decide. Your site procedure takes precedence (VERIFY #5).

## 3D equipment view (pilot, DOL starter)
- Generic devices built from simple shapes in code. They are not models of any manufacturer's product.
- The 3D view has no electrical logic. It shows what the circuit simulator reports (Q1 handle, KM1 flag, F2 trip flag and dial, push buttons, lamps, motor shaft) and sends button presses back to it.
- The motor shaft is shown slowed (1.2 rev/s at rated speed), because real speed would strobe on screen. A stalled motor shakes.
- KM1 terminals 2/4/6 are taken by the overload's plug-in pins, so they are not drawn. The supply, F1 and G1 appear only in the drawing.
- Terminal labels appear when you zoom in. Tapping one places a meter probe on the same terminal as in the drawing.
- Motor terminal box: IEC layout (W2 U2 V2 over U1 V1 W1) with delta links fitted. W2, U2 and V2 are shown but cannot be probed in this version.
