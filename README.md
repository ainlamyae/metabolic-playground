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

## Running it

A static page with no build step and no backend — clone it and open `index.html`, or serve the folder with anything that serves static files, e.g.:

```
npx serve .
```

## Origin

Extracted from the [ledger](https://github.com/ainlamyae/ledger) app's Health Formula Playground, which previews these same equations before writing them back to a personal settings sheet. This copy drops the save/pin machinery — there's nothing here to persist to — and keeps only the calculator.
