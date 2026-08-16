# Metabolic Playground

Interactive calculator for the metabolic math behind weight management — BMR (Mifflin-St Jeor, Katch-McArdle), activity burn, thermic effect of food, and lean-mass-scaled protein targets. Solve for calories, target body mass, activity, or fat-loss rate from one linked set of equations.

Pick a "Solve for" mode and the rest of the sheet updates live as you type, with the full substituted arithmetic — every symbol replaced by the figure actually used — shown below it. Nothing is saved: reload the page, or hit Reset, and it goes back to the default profile.

## Solve for

- **Calories** — the daily intake that hits your weekly fat-loss target
- **Target body mass** — the mass a typed intake and day count actually arrive at
- **Activity** — the daily activity minutes (or, typing a day count instead, solved numerically) that close the gap to your target
- **Weekly fat loss** — the deficit a typed intake and day count imply
- **Weekly fat loss %** — hold the loss as a percentage of body mass instead of a fixed kg/week, which follows the proportional decay journey (no plateau) rather than the constant-intake one

Works for gaining too: a target above your current mass needs a negative Δm (a surplus) or a typed Eᵢₙ above maintenance. If the direction is wrong — say, a deficit typed against a gain target — the arrival-date note says so explicitly rather than just reporting "never."

## The equations

- Resting metabolic rate: **Mifflin-St Jeor** (1990, from body mass/height/age/sex) or **Katch-McArdle** (1996, from lean mass alone)
- Lean body mass: **Boer** (1984)
- Activity burn: the ACSM metabolic equation (MET × mass × minutes × O₂ uptake / oxygen energy yield)
- Thermic effect of food, folded into the intake identity by solving rather than adding
- Maintenance as an affine function of body mass, `M(m) = A + B×m`, under either BMR equation
- The target trajectory as exponential decay toward an equilibrium mass, `m(t) = m∞ + (m − m∞)·e^(−B·t/ρ)` — or, under a pinned fat-loss percentage, a proportional journey with no plateau
- Metabolic adaptation, reported (not planned with) as a BMR correction that grows with time on the diet
- A daily protein band scaled to lean mass rather than total mass

The full formula sheet, with sources, is shown at the top of the page.

## The body as a system

Treat the body as a control system with one input, one state variable, and a feedback loop — not a one-way pipe from food to weight.

```
                         ┌───────────────────────────────┐
                         │        BODY  (state: m)        │
   Eᵢₙ  ─────────────────▶   BMR(m) + Eₐ(m,τ) + TEF(Eᵢₙ)   │────▶  Δm  ────▶  m(t)
  (input, kcal/day,             (three draws on the           (output,           │
   the one lever you           same input, all functions      change in         │
   actually control)            of the current state)         body mass)        │
                         └───────────────────────────────┘                     │
                                        ▲                                       │
                                        └──────────── feedback: m(t) ───────────┘
```

- **Input** — daily caloric intake, `Eᵢₙ`. The only quantity actually set from outside the loop.
- **State** — body mass, `m(t)`, smoothed to `m̄ = (1/7)·Σm(t−i)` over the trailing week, since a single day's scale reading carries water and glycogen noise, not clean mass change.
- **Draws on the input** — three sinks that consume `Eᵢₙ` before any surplus or deficit shows up as `Δm`:
  - `BMR` — the baseline draw, and the term that closes the loop: it's a function of `m` itself (directly under Mifflin-St Jeor, via `LBM` under Katch-McArdle). Burn depends on mass, and mass changes because of the burn — that dependency is the feedback.
  - `Eₐ` — activity burn, an externally-set gain (`τ`, minutes) applied on top of the mass-dependent `MET` term.
  - `TEF` — a fixed fraction `f` of whatever `Eᵢₙ` turns out to be, solved for rather than added, since it scales with the very input it draws from.
- **Error signal** — the daily energy balance, `Eᵢₙ − (BMR + Eₐ + TEF)`, integrated through the energy density of tissue (`ρ`) into `Δm`.

Because `BMR` and `Eₐ` are affine in `m` (`M(m) = A + B·m`), holding `Eᵢₙ` fixed gives the loop a single equilibrium, `m∞ = (Eᵢₙ − A)/B`, and mass decays toward it exponentially rather than linearly — `m(t) = m∞ + (m−m∞)·e^(−Bt/ρ)`. As `m` falls toward `m∞`, the deficit `Eᵢₙ − M(m)` shrinks in lockstep, which is what makes it decay instead of running straight to zero: a first-order negative-feedback system, self-damping by construction.

A second, slower feedback path fights the first one: metabolic adaptation. `BMR_a(t) = BMR × (1 − λt)` drags the baseline draw down as time on the deficit accumulates (capped to `λt_max ≈ 10–15%` by week 10–12), pulling `A` and `B` down together and dragging the true equilibrium `m∞_a` above the naively-computed `m∞`. A plan built on the fast loop alone will undershoot its own forecast — the gap between `m∞` and `m∞_a` is exactly the overshoot the adaptation model predicts.

Under a pinned fat-loss percentage (`Δm%`) instead of a fixed `Eᵢₙ`, the loop is closed differently — intake is re-derived from the current mass every period rather than held constant — so there's no equilibrium at all, just proportional decay: `m(t) = m·(1 − Δm%/100)^(t/7)`.

`LBM` and the protein band (`P_min`, `P_max`) sit outside this loop — they scale with lean mass, not with the energy-balance state, and constrain the *composition* of the input rather than its size.

## Running it

A static page with no build step and no backend — clone it and open `index.html`, or serve the folder with anything that serves static files, e.g.:

```
npx serve .
```

## Origin

Extracted from the [ledger](https://github.com/ainlamyae/ledger) app's Health Formula Playground, which previews these same equations before writing them back to a personal settings sheet. This copy drops the save/pin machinery — there's nothing here to persist to — and keeps only the calculator.
