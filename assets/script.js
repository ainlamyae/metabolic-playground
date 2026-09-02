// Metabolic Playground — standalone extraction of the "Tune" sheet from the
// ledger app's Health Indicator panel. No saving, no pinning: every box is
// either typed or computed live, and reloading the page resets it to the
// default profile below. `currentSettings` stays permanently empty — it
// exists only so the ported calorie/BMR math can read its inputs through the
// same getSetting() overlay the original app uses to preview unsaved edits,
// which here is simply the only mode there is.

let currentSettings = {};

function getSetting(key, fallback) {
  const raw = currentSettings[key];
  const num = Number(raw);
  return raw !== undefined && raw !== '' && !Number.isNaN(num) ? num : fallback;
}

function getSettingString(key, fallback) {
  const raw = currentSettings[key];
  return raw !== undefined && raw !== '' ? raw : fallback;
}

// ---------------------------------------------------------------------------
// Ported math (charts.js in the ledger app). Trimmed of every setting that
// only ever fed a persisted plan — the pinning system, the wellness-log body
// mass sourcing, privacy masking — since none of those exist without saving.
// ---------------------------------------------------------------------------

const BODY_MASS_TARGET_KG_DEFAULT = 82;
const ACTIVITY_TARGET_MIN_DEFAULT = 100;

// Protein per kg of LEAN mass, not total mass. 1.8-2.2 spans what the
// resistance-training literature supports for holding lean mass in an energy
// deficit: Morton et al. 2018 (Br J Sports Med) puts the point above which
// fat-free-mass gains stop accruing at ~1.6 g/kg total mass with a 2.2 upper
// confidence bound, and Helms et al. 2014 recommends scaling to fat-free mass
// instead, which is what makes 1.8-2.2 the same advice expressed against LBM.
const PROTEIN_G_PER_KG_LBM_MIN_DEFAULT = 1.8;
const PROTEIN_G_PER_KG_LBM_MAX_DEFAULT = 2.2;

// The fiber band's two coefficients. 14 g/1000 kcal is the USDA/Dietary Guidelines for
// Americans rule of thumb (derived from the ~25g/2000kcal adult reference intake); 0.5 g/kg
// body weight is a common upper-bound heuristic so the ceiling scales with the person rather
// than staying a flat number regardless of size.
const FIBER_G_PER_1000_KCAL_MIN_DEFAULT = 14;
const FIBER_G_PER_KG_MAX_DEFAULT = 0.5;

// The fat band's two coefficients — 20-35% of total energy from fat is the Institute of
// Medicine's Acceptable Macronutrient Distribution Range for adults (Dietary Reference
// Intakes for Energy, Carbohydrate, Fiber, Fat, Fatty Acids, Cholesterol, Protein, and Amino
// Acids, 2005), the same range the USDA Dietary Guidelines for Americans carries forward.
// Both ends scale off Eᵢₙ (percent of intake calories), unlike fiber's floor/ceiling on two
// different bases, since that's how the AMDR itself is defined.
const FAT_PCT_OF_KCAL_MIN_DEFAULT = 20;
const FAT_PCT_OF_KCAL_MAX_DEFAULT = 35;
// Fat's fixed energy density (Atwater) — grams per kcal, not a personal parameter, so it's a
// plain constant rather than an overridable setting the way the two percentages above are.
const KCAL_PER_G_FAT = 9;

// Intensity assumed for the activity target (3.0 walking, 5.0 compound
// lifting, 7.0 jogging).
const ACTIVITY_MET_FALLBACK = 3.5;
const ACTIVITY_MET_SETTING_KEYS = ['ACTIVITY_MET', 'ACTIVITY_MET_DEFAULT'];

function activityMet() {
  for (const key of ACTIVITY_MET_SETTING_KEYS) {
    const met = getSetting(key, null);
    if (met !== null) return met;
  }
  return ACTIVITY_MET_FALLBACK;
}

// Energy density of body fat — a population constant, not a personal one.
const GENERIC_KCAL_PER_KG_FAT = 7700;

// ACSM form: 1 MET = 3.5 mL O₂/kg/min and a litre of O₂ releases ~5 kcal (200
// mL per kcal), so 3.5/200 kcal per MET per kg per minute.
const MET_ML_O2_PER_KG_MIN_DEFAULT = 3.5;
const ML_O2_PER_KCAL = 200;

function kcalPerMetKgMin() {
  return getSetting('KCAL_PER_MET_KG_MIN', MET_ML_O2_PER_KG_MIN_DEFAULT) / ML_O2_PER_KCAL;
}

function metKcal(met, bodyMassKg, minutes) {
  return met * bodyMassKg * minutes * kcalPerMetKgMin();
}

// Mifflin-St Jeor BMR (kcal/day).
function mifflinStJeorBmr(bodyMassKg, heightCm, age, sex) {
  return 10 * bodyMassKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
}

// Katch-McArdle (1996): BMR = 370 + 21.6 × LBM.
const KATCH_BASE_KCAL = 370;
const KATCH_KCAL_PER_KG_LBM = 21.6;

function katchMcArdleBmr(lbmKg) {
  return KATCH_BASE_KCAL + KATCH_KCAL_PER_KG_LBM * lbmKg;
}

// The LBM this equation is evaluated at, rounded to the same 0.1 kg the LBM
// box and the protein band show — so the trace's `370 + 21.6 × 61.4` multiplies
// out to the BMR printed beside it instead of missing it by a kcal.
function bmrLeanBodyMassKg(bodyMassKg, heightCm, sex) {
  return Math.round(boerLeanBodyMassKg(bodyMassKg, heightCm, sex) * 10) / 10;
}

const BMR_FORMULA_KEY = 'BMR_FORMULA';
const BMR_FORMULA_DEFAULT = 'mifflin';

function bmrFormula() {
  return getSettingString(BMR_FORMULA_KEY, BMR_FORMULA_DEFAULT) === 'katch' ? 'katch' : BMR_FORMULA_DEFAULT;
}

// Age is a Mifflin term only — Katch-McArdle reads lean mass instead.
function bmrNeedsAge(formula = bmrFormula()) {
  return formula !== 'katch';
}

function bmrKcal(bodyMassKg, heightCm, age, sex, formula = bmrFormula()) {
  return formula === 'katch'
    ? katchMcArdleBmr(bmrLeanBodyMassKg(bodyMassKg, heightCm, sex))
    : mifflinStJeorBmr(bodyMassKg, heightCm, age, sex);
}

// Thermic effect of food: Eᵢₙ = (BMR + Eₐ − D) / (1 − f). Defaults to 0, which
// is the plain sum with no digestion cost counted.
const TEF_PERCENT_KEY = 'TEF_PERCENT_OF_INTAKE';
const TEF_PERCENT_DEFAULT = 0;
const TEF_PERCENT_MAX = 90;

function tefPercent() {
  return getSetting(TEF_PERCENT_KEY, TEF_PERCENT_DEFAULT);
}

function tefDivisor(percent = tefPercent()) {
  return 1 - Math.min(Math.max(percent, 0), TEF_PERCENT_MAX) / 100;
}

// Metabolic adaptation: BMR_adapt(t) = BMR × (1 − λt), λt capped near 10-15%
// by week 10-12. Reported, never planned with — see adaptedPlateauKg below.
const ADAPT_PCT_PER_WEEK_KEY = 'BMR_ADAPT_PCT_PER_WEEK';
const ADAPT_PCT_CAP_KEY = 'BMR_ADAPT_PCT_CAP';
const ADAPT_PCT_PER_WEEK_DEFAULT = 1;
const ADAPT_PCT_CAP_DEFAULT = 12;

function adaptationFraction(days, pctPerWeek, pctCap) {
  const grown = (pctPerWeek / 100) * (days / 7);
  return Math.max(0, Math.min(grown, pctCap / 100));
}

// What the activity target implies at `bodyMassKg`. Gross, not net of resting.
function activityTargetKcal(bodyMassKg) {
  return metKcal(activityMet(), bodyMassKg, getSetting('ACTIVITY_TARGET_MIN', ACTIVITY_TARGET_MIN_DEFAULT));
}

// The daily intake target at ONE body mass and age — the single identity
// every mode on the sheet rearranges. `age` is a direct parameter (the ledger
// app instead reads a stored birth date; there's nothing to store here, so
// the typed age just flows straight through). Null when an input is missing.
function calorieTargetDetail(bodyMassKg, age) {
  const heightCm = getSetting('HEIGHT_CM', null);
  const sex = getSettingString('SEX', null);
  const weeklyFatLossKg = getSetting('WEEKLY_FAT_LOSS_KG', null);

  const haveAllInputs = bodyMassKg !== null && heightCm !== null && (age !== null || !bmrNeedsAge())
    && (sex === 'male' || sex === 'female') && weeklyFatLossKg !== null;
  if (!haveAllInputs) return null;

  const bmr = bmrKcal(bodyMassKg, heightCm, age, sex);
  const activityKcal = activityTargetKcal(bodyMassKg);

  const divisor = tefDivisor();
  const kcal = Math.round((bmr + activityKcal - (weeklyFatLossKg * GENERIC_KCAL_PER_KG_FAT) / 7) / divisor);

  return { kcal, bmr, activityKcal, weeklyFatLossKg, tefKcal: kcal * (1 - divisor), tefDivisor: divisor };
}

// Δm as a share of body mass. 0.5-1% of body mass per week is the usual
// sustainable range, and 1% the ceiling.
const WEEKLY_FAT_LOSS_PCT_FLOOR = 0.5;
const WEEKLY_FAT_LOSS_PCT_CEILING = 1;

function weeklyFatLossPct(weeklyFatLossKg, bodyMassKg) {
  if (weeklyFatLossKg === null || bodyMassKg === null || bodyMassKg <= 0) return null;
  return Math.round((weeklyFatLossKg / bodyMassKg) * 10000) / 100;
}

function weeklyFatLossKgFromPct(pct, bodyMassKg) {
  if (pct === null || bodyMassKg === null) return null;
  return Math.round((pct / 100) * bodyMassKg * 1000) / 1000;
}

const BOER_LBM_COEFFICIENTS = {
  male: { perKg: 0.407, perCm: 0.267, constant: -19.2 },
  female: { perKg: 0.252, perCm: 0.473, constant: -48.3 },
};

function boerLeanBodyMassCoefficients(sex) {
  return sex === 'male' ? BOER_LBM_COEFFICIENTS.male : BOER_LBM_COEFFICIENTS.female;
}

function boerLeanBodyMassKg(bodyMassKg, heightCm, sex) {
  const c = boerLeanBodyMassCoefficients(sex);
  return c.perKg * bodyMassKg + c.perCm * heightCm + c.constant;
}

// bodyMassKg / heightM².
function computeBmi(bodyMassKg, heightCm) {
  const heightM = heightCm / 100;
  return Math.round((bodyMassKg / (heightM * heightM)) * 10) / 10;
}

function bodyMassKgFromBmi(bmi, heightCm) {
  const heightM = heightCm / 100;
  return Math.round(bmi * heightM * heightM * 10) / 10;
}

const BMI_HEALTHY_MIN = 18.5;
const BMI_HEALTHY_MAX = 24.9;

function bmiVerdict(bmi) {
  if (bmi < 16) return { text: 'severely underweight', outside: true };
  if (bmi < BMI_HEALTHY_MIN) return { text: 'underweight', outside: true };
  if (bmi <= BMI_HEALTHY_MAX) return { text: `in the healthy ${BMI_HEALTHY_MIN}–${BMI_HEALTHY_MAX} band`, outside: false };
  if (bmi < 30) return { text: 'overweight', outside: true };
  if (bmi < 35) return { text: 'obese (class I)', outside: true };
  return { text: 'obese (class II+)', outside: true };
}

// UTC end to end: `new Date("YYYY-MM-DD")` parses as UTC midnight, and
// formatting that back in local time rolls it back a day in any
// negative-offset zone.
function parseIsoDateUTC(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function isoFromDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// A and B from "Maintenance is affine in body mass — M(m) = A + B×m": the
// body-mass-independent and body-mass-scaling halves of BMR + activity burn.
// Affine under both BMR equations, which is what lets one decay model serve
// them both.
function maintenanceAffineCoefficients({
  heightCm, age, sex, met, tau, kappa, formula = bmrFormula(), tef = tefPercent(),
}) {
  const activityPerKg = (met * tau * kappa) / ML_O2_PER_KCAL;
  const lbm = boerLeanBodyMassCoefficients(sex);
  const aBmr = formula === 'katch'
    ? KATCH_BASE_KCAL + KATCH_KCAL_PER_KG_LBM * (lbm.perCm * heightCm + lbm.constant)
    : 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
  const bBmr = formula === 'katch' ? KATCH_KCAL_PER_KG_LBM * lbm.perKg : 10;
  const divisor = tefDivisor(tef);

  return {
    a: aBmr / divisor,
    b: (bBmr + activityPerKg) / divisor,
    aBmr,
    bBmr,
    activityPerKg,
    tefDivisor: divisor,
    formula,
  };
}

// Where the mass actually levels off once BMR has adapted — the same
// m∞ = (Eᵢₙ − A)/B, with the BMR half of each coefficient scaled by (1 − λt).
function adaptedPlateauKg(intakeKcal, coefficients, adaptFraction) {
  const { aBmr, bBmr, activityPerKg, tefDivisor: divisor } = coefficients;
  const remaining = 1 - adaptFraction;
  return (intakeKcal - (remaining * aBmr) / divisor)
    / ((remaining * bBmr + activityPerKg) / divisor);
}

const BODY_MASS_AT_TARGET_TOLERANCE_KG = 0.1;

// The constant-intake journey — closed form of dm/dt = (Eᵢₙ − A − B·m)/ρ.
function projectTargetDays({
  intakeKcal, bodyMassKg, heightCm, age, sex, met, tau, kappa, targetKg, formula, tef,
}) {
  const { a, b } = maintenanceAffineCoefficients({ heightCm, age, sex, met, tau, kappa, formula, tef });
  const equilibriumKg = (intakeKcal - a) / b;

  if (Math.abs(bodyMassKg - targetKg) < BODY_MASS_AT_TARGET_TOLERANCE_KG) {
    return { a, b, equilibriumKg, status: 'reached' };
  }

  const ratio = (bodyMassKg - equilibriumKg) / (targetKg - equilibriumKg);
  if (!Number.isFinite(ratio) || ratio <= 1) {
    return { a, b, equilibriumKg, status: 'unreachable' };
  }

  const days = (GENERIC_KCAL_PER_KG_FAT / b) * Math.log(ratio);
  const eta = new Date();
  eta.setDate(eta.getDate() + Math.round(days));
  return { a, b, decayPerKg: b, equilibriumKg, days, etaIso: isoFromDate(eta), status: 'ok', journey: 'intake' };
}

// The OTHER trajectory — a pinned percentage's constant-fraction journey:
// m(t) = m × (1 − p/100)^(t/7). No plateau, so a positive rate always arrives.
function projectTargetDaysAtFixedPct({ bodyMassKg, targetKg, weeklyPct }) {
  const base = { decayPerKg: 0, equilibriumKg: 0, journey: 'pct' };
  if (Math.abs(bodyMassKg - targetKg) < BODY_MASS_AT_TARGET_TOLERANCE_KG) {
    return { ...base, status: 'reached' };
  }

  const kPerDay = -Math.log(1 - weeklyPct / 100) / 7;
  const decayPerKg = kPerDay * GENERIC_KCAL_PER_KG_FAT;
  const days = Math.log(bodyMassKg / targetKg) / kPerDay;
  if (!Number.isFinite(days) || days <= 0) {
    return {
      ...base,
      status: 'unreachable',
      reason: weeklyPct > 0
        ? 'the target is not below your current body mass'
        : 'a rate of 0% or less never moves the mass',
    };
  }

  const eta = new Date();
  eta.setDate(eta.getDate() + Math.round(days));
  return { ...base, decayPerKg, days, etaIso: isoFromDate(eta), status: 'ok' };
}

// ---------------------------------------------------------------------------
// The sheet itself (formula-playground.js in the ledger app). Trimmed of
// Save and the "which stays fixed" pin fieldsets — there is nowhere to save
// to, so every quantity here is either typed or computed for this session
// only.
// ---------------------------------------------------------------------------

// The profile a fresh load (or Reset) seeds the sheet with — the ledger app
// instead reads these from a saved weigh-in log and settings sheet, neither
// of which exists here.
// Matches BODY_MASS_TARGET_KG_DEFAULT, so a fresh load — Δm also defaults to
// 0 — opens on "already there" instead of a "never" note nobody asked for.
const DEFAULT_BODY_MASS_KG = BODY_MASS_TARGET_KG_DEFAULT;
const DEFAULT_HEIGHT_CM = 175;
const DEFAULT_AGE = 30;
const DEFAULT_SEX = 'male';

const FORMULA_FIELDS = [
  { key: 'KCAL_PER_MET_KG_MIN', inputId: 'formula-met-o2', fallback: () => MET_ML_O2_PER_KG_MIN_DEFAULT },
  { key: 'ACTIVITY_MET', inputId: 'formula-met', fallback: () => activityMet() },
  { key: 'ACTIVITY_TARGET_MIN', inputId: 'formula-activity-min', fallback: () => ACTIVITY_TARGET_MIN_DEFAULT },
  // No default: a blank weekly loss is exactly what opens the sheet on 0
  // (maintenance) rather than inventing a deficit.
  { key: 'WEEKLY_FAT_LOSS_KG', inputId: 'formula-weekly-loss', fallback: () => 0 },
  { key: 'BODY_MASS_TARGET_KG', inputId: 'formula-target', fallback: () => BODY_MASS_TARGET_KG_DEFAULT },
  { key: TEF_PERCENT_KEY, inputId: 'formula-tef-pct', fallback: () => TEF_PERCENT_DEFAULT },
];

const ADAPT_FORMULA_FIELDS = [
  { key: ADAPT_PCT_PER_WEEK_KEY, inputId: 'formula-adapt-per-week', fallback: () => ADAPT_PCT_PER_WEEK_DEFAULT },
  { key: ADAPT_PCT_CAP_KEY, inputId: 'formula-adapt-cap', fallback: () => ADAPT_PCT_CAP_DEFAULT },
];

const PROTEIN_FORMULA_FIELDS = [
  { key: 'PROTEIN_G_PER_KG_LBM_MIN', inputId: 'formula-protein-per-kg-min', fallback: () => PROTEIN_G_PER_KG_LBM_MIN_DEFAULT },
  { key: 'PROTEIN_G_PER_KG_LBM_MAX', inputId: 'formula-protein-per-kg-max', fallback: () => PROTEIN_G_PER_KG_LBM_MAX_DEFAULT },
];

// The fiber band's two coefficients, kept out of FORMULA_FIELDS for the same reason as
// PROTEIN_FORMULA_FIELDS: fiber feeds no calorie identity, so a blank one should only stop
// fiber from being computed, not the target.
const FIBER_FORMULA_FIELDS = [
  { key: 'FIBER_G_PER_1000_KCAL_MIN', inputId: 'formula-fiber-per-1000kcal-min', fallback: () => FIBER_G_PER_1000_KCAL_MIN_DEFAULT },
  { key: 'FIBER_G_PER_KG_MAX', inputId: 'formula-fiber-per-kg-max', fallback: () => FIBER_G_PER_KG_MAX_DEFAULT },
];

// The fat band's two coefficients, kept out of FORMULA_FIELDS for the same reason as
// FIBER_FORMULA_FIELDS: fat feeds no calorie identity, so a blank one should only stop fat
// from being computed, not the target.
const FAT_FORMULA_FIELDS = [
  { key: 'FAT_PCT_OF_KCAL_MIN', inputId: 'formula-fat-pct-min', fallback: () => FAT_PCT_OF_KCAL_MIN_DEFAULT },
  { key: 'FAT_PCT_OF_KCAL_MAX', inputId: 'formula-fat-pct-max', fallback: () => FAT_PCT_OF_KCAL_MAX_DEFAULT },
];

const FORMULA_SOLVE_FIELD_ID = {
  EIN: 'formula-ein',
  TARGET_MASS: 'formula-target',
  TAU: 'formula-activity-min',
  DELTA_M: 'formula-weekly-loss',
};

const FORMULA_TOGGLE_IDS = [...Object.values(FORMULA_SOLVE_FIELD_ID), 'formula-days', 'formula-eta', 'formula-weekly-loss-pct', 'formula-target-bmi'];

const FORMULA_COMPUTED_IDS = {
  EIN: ['formula-ein', 'formula-days', 'formula-eta'],
  TARGET_MASS: ['formula-target', 'formula-target-bmi'],
  FIXED_PCT: ['formula-weekly-loss', 'formula-ein', 'formula-days', 'formula-eta'],
};

// For TAU and DELTA_M, either Eᵢₙ or t can be the known that drives the solve
// — whichever you last typed into.
const dualKnownField = { TAU: 'ein', DELTA_M: 'days' };

let weeklyLossKnownField = 'kg';   // 'kg' | 'pct'
let targetMassKnownField = 'kg';   // 'kg' | 'bmi'

function targetBmiIsTyped() {
  if (currentSolveFor() === 'TARGET_MASS') return false;
  return targetMassKnownField === 'bmi';
}

function weeklyLossPctIsTyped() {
  const mode = currentSolveFor();
  if (mode === 'FIXED_PCT') return true;
  if (mode === 'DELTA_M') return false;
  return weeklyLossKnownField === 'pct';
}

// Which BMR equation the preview is running.
function currentBmrFormula() {
  return document.querySelector('input[name="formula-bmr-formula"]:checked').value;
}

function formulaBodyMassKg() {
  return formulaNumber('formula-body-mass-smooth');
}

function weeklyLossPctInPlay(weeklyLossKg, bodyMassKg) {
  return weeklyLossPctIsTyped()
    ? formulaNumber('formula-weekly-loss-pct')
    : weeklyFatLossPct(weeklyLossKg, bodyMassKg);
}

function computedIdsForMode(mode) {
  if (mode === 'TAU') {
    return dualKnownField.TAU === 'ein'
      ? ['formula-activity-min', 'formula-days', 'formula-eta']
      : ['formula-activity-min', 'formula-ein'];
  }
  if (mode === 'DELTA_M') {
    return dualKnownField.DELTA_M === 'ein'
      ? ['formula-weekly-loss', 'formula-weekly-loss-pct', 'formula-days', 'formula-eta']
      : ['formula-weekly-loss', 'formula-weekly-loss-pct', 'formula-ein'];
  }
  return FORMULA_COMPUTED_IDS[mode];
}

function currentSolveFor() {
  return document.querySelector('input[name="formula-solve-for"]:checked').value;
}

const FORMULA_DUAL_FIELD_IDS = ['formula-ein', 'formula-days', 'formula-eta'];

function applySolveForMode(mode) {
  const computed = new Set(computedIdsForMode(mode));
  const isDualMode = mode === 'TAU' || mode === 'DELTA_M';
  FORMULA_TOGGLE_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (isDualMode && FORMULA_DUAL_FIELD_IDS.includes(id)) {
      el.readOnly = false;
      el.classList.toggle('formula-field-computed', computed.has(id));
    } else {
      el.readOnly = computed.has(id);
      el.classList.remove('formula-field-computed');
    }
  });
}

const FORMULA_EXPRESSION = `Smoothing the scale — daily weight carries water and glycogen, m(t) means clean mass
    m̄    =  (1/7) × Σ m(t−i),  i = 0…6
Lean body mass — Boer (1984)
    LBM  =  0.407×m  +  0.267×h  −  19.2      (♂)
    LBM  =  0.252×m  +  0.473×h  −  48.3      (♀)
Resting metabolic rate — Katch-McArdle (1996), from lean mass instead of age/sex
    BMR  =  370  +  21.6×LBM
Resting metabolic rate — Mifflin-St Jeor (1990)
    BMR  =  10×m  +  6.25×h  −  5×a  +  σ
Activity burn at the daily target — ACSM metabolic equation
    Eₐ   =  MET × m × τ × κ / ε
Weekly fat loss as a share of body mass — 0.5–1%/week band
    Δm%  =  100 × Δm / m
Daily energy deficit implied by the weekly fat-loss target
    D    =  (Δm × ρ) / 7
Thermic effect of food — a share of the very intake being solved for
    TEF  =  f × Eᵢₙ
Target daily intake — TEF folded in by solving, not by adding
    Eᵢₙ  =  BMR  +  Eₐ  +  TEF  −  D    =    (BMR  +  Eₐ  −  D) / (1 − f)
The target body mass as a BMI — 18.5–24.9 healthy band
    BMI_g =  m_g / (h/100)²
Maintenance is affine in body mass — M(m) = A + B×m
    A    =  (6.25×h  −  5×a  +  σ) / (1 − f)           under Mifflin
    B    =  (10  +  MET × τ × κ / ε) / (1 − f)         under Mifflin
    A    =  (370  +  21.6×(c_h×h + c_0)) / (1 − f)     under Katch
    B    =  (21.6×c_m  +  MET × τ × κ / ε) / (1 − f)   under Katch
Body mass at which Eᵢₙ becomes maintenance
    m∞   =  (Eᵢₙ  −  A) / B
Exponential decay toward m∞, not linear loss
    m(t) =  m∞  +  (m − m∞) × e^(−B×t/ρ)
    t    =  (ρ / B) × ln[ (m − m∞) / (m_g − m∞) ]
Proportional journey instead, when Δm% is what's held — no plateau, so no m∞
    m(t) =  m × (1 − Δm%/100)^(t/7)
    t    =  7 × ln(m / m_g) / −ln(1 − Δm%/100)
Metabolic adaptation — BMR sags faster than the lost mass alone predicts
    BMR_a(t) = BMR × (1 − λt),  λt capped at λt_max ≈ 10–15% by week 10–12
    m∞_a =  (Eᵢₙ − A_a) / B_a,  the BMR half of A and B scaled by (1 − λt)
Skeletal muscle mass — the fraction of LBM that actually stores glycogen
    m_musc =  s × LBM
Glycogen store, from muscle mass
    m_gly  =  g_musc × m_musc  +  g_liver
Glycogen-bound water — the swing glycogen alone accounts for, not fat
    ΔM_gly =  m_gly × (1 + r) / 1000
Daily protein band, scaled to lean mass
    P_min =  p_min × LBM
    P_max =  p_max × LBM
Fiber band — a floor from daily intake, a ceiling from body weight
    F_min =  f_min × (Eᵢₙ / 1000)
    F_max =  f_max × m
Fat band — both ends a share of intake, 20-35% AMDR
    G_min =  (k_min/100 × Eᵢₙ) / 9
    G_max =  (k_max/100 × Eᵢₙ) / 9`;

function formulaFieldValue(field) {
  return getSetting(field.key, null) ?? field.fallback();
}

// Runs fn with `currentSettings` overlaid by the sheet's own edits, so the
// preview goes through the real calorieTargetDetail/metKcal path instead of a
// second copy of the arithmetic that could disagree with it.
function withFormulaOverrides(overrides, fn) {
  const saved = currentSettings;
  currentSettings = { ...currentSettings, ...overrides };
  try {
    return fn();
  } finally {
    currentSettings = saved;
  }
}

function formulaNumber(inputId) {
  const raw = document.getElementById(inputId).value.trim();
  const num = Number(raw);
  return (raw === '' || Number.isNaN(num)) ? null : num;
}

function setComputedField(inputId, text) {
  document.getElementById(inputId).value = text;
}

function isoDateFromDays(days) {
  const eta = new Date();
  eta.setDate(eta.getDate() + Math.round(days));
  return isoFromDate(eta);
}

function daysFromTodayIso(dateIso) {
  return Math.round((parseIsoDateUTC(dateIso) - parseIsoDateUTC(isoFromDate(new Date()))) / 86400000);
}

// Every box maps to a would-be settings key except current body mass, which
// is a plain measurement scaling both terms of the formula.
function readFormulaInputs() {
  const mode = currentSolveFor();
  const overrides = {};
  const invalid = [];
  FORMULA_FIELDS.forEach((field) => {
    const num = formulaNumber(field.inputId);
    if (num === null) invalid.push(field.key);
    else overrides[field.key] = num;
  });

  const bodyMassKg = formulaBodyMassKg();
  const heightCm = formulaNumber('formula-height');
  const age = formulaNumber('formula-age');
  const sex = document.getElementById('formula-sex').value;
  const formula = currentBmrFormula();
  if (bodyMassKg === null) invalid.push('m̄ (smoothed body mass)');
  if (heightCm === null) invalid.push('HEIGHT_CM');
  // Age is a Mifflin input only — Katch-McArdle reads lean mass instead — so
  // on that equation a blank age isn't missing, it's simply not part of the model.
  if (age === null && bmrNeedsAge(formula)) invalid.push('BIRTH_DATE (age)');

  if (heightCm !== null) overrides.HEIGHT_CM = heightCm;
  overrides.SEX = sex;
  overrides[BMR_FORMULA_KEY] = formula;

  const preview = { ...overrides };

  // Blank exactly when the current mode is about to compute it — not
  // invalid, just not typed yet.
  const computed = computedIdsForMode(mode);
  const einIsTyped = !computed.includes('formula-ein');
  const daysIsTyped = !computed.includes('formula-days');

  const einKcal = einIsTyped ? formulaNumber('formula-ein') : null;
  if (einIsTyped && einKcal === null) invalid.push('Eᵢₙ (target daily intake)');

  const days = daysIsTyped ? formulaNumber('formula-days') : null;
  if (daysIsTyped && days === null) invalid.push('t (days)');

  if (mode === 'FIXED_PCT' && formulaNumber('formula-weekly-loss-pct') === null) {
    invalid.push('Δm% (weekly fat loss, % of body mass)');
  }

  return { mode, overrides, preview, bodyMassKg, heightCm, age, sex, formula, einKcal, days, invalid };
}

// The formula with every symbol replaced by the figure actually used.
//
// Δm%, TEF and BMI_g are NOT read here: each sits inside `rows` itself, appended by the
// mode that built it, at the spot the legend puts it (Δm% by D, TEF by Eᵢₙ, BMI_g by m_g),
// rather than tacked on after everything mode-specific is done.
function renderFormulaSubstituted(rows, plan = null) {
  const el = document.getElementById('formula-substituted');
  el.innerHTML = '';
  let lbmRows = [];
  try {
    lbmRows = renderLbmField();
  } catch (err) {
    console.error('Lean body mass failed to render', err);
  }
  let proteinRows = [];
  try {
    proteinRows = renderProteinFields();
  } catch (err) {
    console.error('Protein band failed to render', err);
  }
  // Independent of the protein block above — reads m̄ and Eᵢₙ, not LBM — but guarded
  // separately for the same reason every block here is: one throwing can't take the others
  // down with it.
  let fiberRows = [];
  try {
    fiberRows = renderFiberFields();
  } catch (err) {
    console.error('Fiber band failed to render', err);
  }
  // Independent of the fiber block above too — reads only Eᵢₙ, no body mass — but guarded
  // separately for the same reason.
  let fatRows = [];
  try {
    fatRows = renderFatFields();
  } catch (err) {
    console.error('Fat band failed to render', err);
  }
  let glycogenRows = [];
  try {
    glycogenRows = renderGlycogenSwingField();
  } catch (err) {
    console.error('Glycogen swing failed to render', err);
  }
  let correctionRows = [];
  try {
    correctionRows = renderCorrectionFields(plan);
  } catch (err) {
    console.error('Correction terms failed to render', err);
  }

  // LBM leads (it sits with the profile, ahead of everything `rows` itself starts with),
  // then `rows` — which carries Δm%, TEF and BMI_g inline, at the legend's own positions —
  // then the adaptation pair, then glycogen, protein, fiber and fat: the same order the
  // legend lists them in.
  [...lbmRows, ...(rows ?? []), ...correctionRows, ...glycogenRows, ...proteinRows, ...fiberRows, ...fatRows].forEach(([label, value]) => {
    const p = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = `${label}: `;
    p.append(strong, document.createTextNode(value));
    el.appendChild(p);
  });
}

function setEtaDate(iso) {
  document.getElementById('formula-eta').value = iso;
}

function setEtaNote(text) {
  document.getElementById('formula-eta-note').textContent = text;
}

// `direction` ({ bodyMassKg, targetKg }) is only read on the 'intake' journey's
// unreachable branch, to tell two different failures apart: an equilibrium
// past the target (a real plateau, just short of it) reads very differently
// from an equilibrium on the WRONG side of it — e.g. a target above m̄ with a
// typed Eᵢₙ still below maintenance, which is a deficit heading away from a
// gain goal, not a diet that merely falls short. Omitted by the 'pct' journey,
// which already carries its own reason string, and by callers where t itself
// was typed rather than solved for.
function renderFormulaDaysField(proj, direction = null) {
  if (proj === null) {
    setComputedField('formula-days', '');
    setEtaDate('');
    setEtaNote('');
    return;
  }
  if (proj.status === 'reached') {
    setComputedField('formula-days', '');
    setEtaDate('');
    setEtaNote('already there');
    return;
  }
  if (proj.status === 'unreachable') {
    setComputedField('formula-days', '');
    setEtaDate('');
    if (proj.journey === 'pct') {
      setEtaNote(`never — ${proj.reason}`);
      return;
    }
    const equilibriumKg = Math.round(proj.equilibriumKg * 10) / 10;
    if (direction !== null) {
      const { bodyMassKg, targetKg } = direction;
      const wantsGain = targetKg > bodyMassKg;
      const headingTowardTarget = wantsGain ? proj.equilibriumKg > bodyMassKg : proj.equilibriumKg < bodyMassKg;
      if (!headingTowardTarget) {
        setEtaNote(`never — Eᵢₙ needs to be ${wantsGain ? 'above' : 'below'} maintenance to reach a target ${wantsGain ? 'above' : 'below'} m̄ (a ${wantsGain ? 'negative' : 'positive'} Δm)`);
        return;
      }
    }
    setEtaNote(`never — plateaus at ${equilibriumKg} kg`);
    return;
  }
  setComputedField('formula-days', String(Math.round(proj.days)));
  setEtaDate(proj.etaIso);
  setEtaNote('');
}

// The one case with no closed form: TAU with a typed day count instead of a
// typed Eᵢₙ. Solved by bisection — h(B) changes sign at most once for a
// physically reachable target.
function solveBForTypedDays({ deficit, massToLose, t, rho, minB = 10 }) {
  const h = (B) => deficit * (1 - Math.exp((-B * t) / rho)) - massToLose * B;
  const lo = minB;
  const hi = 1e7;
  const hLo = h(lo);
  const hHi = h(hi);
  if (Math.abs(hLo) < 1e-9) return lo;
  if (Math.abs(hHi) < 1e-9) return hi;
  if (!Number.isFinite(hLo) || !Number.isFinite(hHi) || Math.sign(hLo) === Math.sign(hHi)) return null;

  let low = lo;
  let high = hi;
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    if (Math.sign(h(mid)) === Math.sign(hLo)) low = mid; else high = mid;
  }
  return (low + high) / 2;
}

// LBM and the protein band it implies, from whatever m, h and σ currently
// read — or null when any of the four numbers it needs is missing.
function readProteinFormula() {
  const bodyMassKg = formulaBodyMassKg();
  const heightCm = formulaNumber('formula-height');
  const sex = document.getElementById('formula-sex').value;
  const perKgMin = formulaNumber('formula-protein-per-kg-min');
  const perKgMax = formulaNumber('formula-protein-per-kg-max');
  if (bodyMassKg === null || heightCm === null || perKgMin === null || perKgMax === null) return null;

  const raw = boerLeanBodyMassKg(bodyMassKg, heightCm, sex);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const lbmKg = Math.round(raw * 10) / 10;

  const low = Math.min(perKgMin, perKgMax);
  const high = Math.max(perKgMin, perKgMax);
  return {
    bodyMassKg, heightCm, sex, lbmKg, perKgMin: low, perKgMax: high,
    minG: Math.round(lbmKg * low),
    maxG: Math.round(lbmKg * high),
  };
}

// The LBM box and its trace row alone — split out from the protein band below so it can
// sit with the profile (m̄/h/σ/BMR) at the top of the sheet, ahead of the calorie solve,
// while still sharing the one Boer read every other lean-mass consumer here (protein,
// glycogen) uses.
function renderLbmField() {
  const protein = readProteinFormula();

  if (protein === null) {
    setComputedField('formula-lbm', '—');
    return [];
  }

  const { lbmKg, bodyMassKg, heightCm, sex } = protein;
  setComputedField('formula-lbm', String(lbmKg));

  const coefficients = sex === 'male'
    ? `0.407 × ${bodyMassKg} + 0.267 × ${heightCm} − 19.2`
    : `0.252 × ${bodyMassKg} + 0.473 × ${heightCm} − 48.3`;
  return [['LBM', `${coefficients}  =  ${lbmKg} kg`]];
}

function renderProteinFields() {
  const protein = readProteinFormula();

  if (protein === null) {
    ['formula-protein-min', 'formula-protein-max'].forEach((id) => setComputedField(id, '—'));
    return [];
  }

  const { lbmKg, perKgMin, perKgMax, minG, maxG } = protein;
  setComputedField('formula-protein-min', String(minG));
  setComputedField('formula-protein-max', String(maxG));

  return [
    ['P_min', `${perKgMin} × ${lbmKg}  =  ${minG} g/day`],
    ['P_max', `${perKgMax} × ${lbmKg}  =  ${maxG} g/day`],
  ];
}

// The fiber band: a floor scaled to how much you eat (14 g/1000 kcal, the USDA/DGA rule of
// thumb) and a ceiling scaled to body weight (0.5 g/kg) — two different bases, unlike
// protein's single LBM, so neither end rides on a box the other computes.
//
// Reads formula-ein directly rather than re-deriving it: by the time renderFiberFields runs
// (from renderFormulaSubstituted, after the calorie half of the sheet), that box already
// holds this render's Eᵢₙ — typed or solved, in every mode — so this is the one read that
// can't disagree with what the sheet just showed.
function readFiberFormula() {
  const bodyMassKg = formulaBodyMassKg();
  const einKcal = formulaNumber('formula-ein');
  const perKcalMin = formulaNumber('formula-fiber-per-1000kcal-min');
  const perKgMax = formulaNumber('formula-fiber-per-kg-max');
  if (bodyMassKg === null || einKcal === null || perKcalMin === null || perKgMax === null) return null;

  return {
    bodyMassKg, einKcal, perKcalMin, perKgMax,
    minG: Math.round(perKcalMin * (einKcal / 1000)),
    maxG: Math.round(perKgMax * bodyMassKg),
  };
}

// The two fiber boxes and their trace rows — same pairing and same dash-on-missing-input
// convention renderProteinFields uses.
function renderFiberFields() {
  const fiber = readFiberFormula();

  if (fiber === null) {
    ['formula-fiber-min', 'formula-fiber-max'].forEach((id) => setComputedField(id, '—'));
    return [];
  }

  const { bodyMassKg, einKcal, perKcalMin, perKgMax, minG, maxG } = fiber;
  setComputedField('formula-fiber-min', String(minG));
  setComputedField('formula-fiber-max', String(maxG));

  return [
    ['F_min', `${perKcalMin} × (${einKcal} / 1000)  =  ${minG} g/day`],
    ['F_max', `${perKgMax} × ${bodyMassKg}  =  ${maxG} g/day`],
  ];
}

// The fat band: both ends a share of Eᵢₙ (20-35%, the IOM's Acceptable Macronutrient
// Distribution Range for adults) converted to grams at fat's fixed 9 kcal/g energy density —
// unlike fiber's two different bases, both k_min and k_max scale off the same Eᵢₙ, since
// that's how the AMDR itself is defined.
//
// Reads formula-ein directly, same reason readFiberFormula does: by the time
// renderFatFields runs (from renderFormulaSubstituted, after the calorie half of the sheet),
// that box already holds this render's Eᵢₙ — typed or solved, in every mode.
function readFatFormula() {
  const einKcal = formulaNumber('formula-ein');
  const pctMin = formulaNumber('formula-fat-pct-min');
  const pctMax = formulaNumber('formula-fat-pct-max');
  if (einKcal === null || pctMin === null || pctMax === null) return null;

  return {
    einKcal, pctMin, pctMax,
    minG: Math.round((pctMin / 100) * einKcal / KCAL_PER_G_FAT),
    maxG: Math.round((pctMax / 100) * einKcal / KCAL_PER_G_FAT),
  };
}

// The two fat boxes and their trace rows — same pairing and same dash-on-missing-input
// convention renderFiberFields uses.
function renderFatFields() {
  const fat = readFatFormula();

  if (fat === null) {
    ['formula-fat-min', 'formula-fat-max'].forEach((id) => setComputedField(id, '—'));
    return [];
  }

  const { einKcal, pctMin, pctMax, minG, maxG } = fat;
  setComputedField('formula-fat-min', String(minG));
  setComputedField('formula-fat-max', String(maxG));

  return [
    ['G_min', `(${pctMin}% × ${einKcal}) / ${KCAL_PER_G_FAT}  =  ${minG} g/day`],
    ['G_max', `(${pctMax}% × ${einKcal}) / ${KCAL_PER_G_FAT}  =  ${maxG} g/day`],
  ];
}

// m_musc, m_gly and the glycogen+water swing they imply, from whatever m, h and the four
// glycogen knobs currently read — or null when any of them is missing. Independent of
// "Solve for" like the protein band above: no calorie identity involves it, it's purely
// the explanation for why m and m̄ disagree day to day.
//
// LBM drives it rather than body mass directly, same reasoning Katch-McArdle and the
// protein band already use here: glycogen is stored in muscle (and the liver, which
// doesn't scale with a lifter's muscle mass at all), not in fat, so two people at the
// same body mass but different body composition don't carry the same glycogen store.
// But LBM alone overstates it: skeletal muscle is only about 40-50% of LBM — the rest is
// water, organs, skin and bone, none of which store meaningful glycogen — so applying a
// published muscle-TISSUE glycogen density (g/kg wet muscle) straight to LBM comes out
// roughly double. s cuts LBM down to that muscle share first, so g_musc can be the real
// muscle-tissue figure instead of a diluted per-LBM one.
function readGlycogenSwingFormula() {
  const bodyMassKg = formulaBodyMassKg();
  const heightCm = formulaNumber('formula-height');
  const sex = document.getElementById('formula-sex').value;
  const skeletalFrac = formulaNumber('formula-glycogen-skeletal-frac');
  const gPerKgMuscle = formulaNumber('formula-glycogen-per-kg-muscle');
  const liverG = formulaNumber('formula-glycogen-liver');
  const waterRatio = formulaNumber('formula-glycogen-water-ratio');
  if (bodyMassKg === null || heightCm === null || skeletalFrac === null || gPerKgMuscle === null
    || liverG === null || waterRatio === null) return null;

  const rawLbm = boerLeanBodyMassKg(bodyMassKg, heightCm, sex);
  if (!Number.isFinite(rawLbm) || rawLbm <= 0) return null;
  // Rounded to 0.1 kg before it's used further, same as readProteinFormula — otherwise
  // the trace's `s × LBM = m_musc` line would show a rounded LBM that doesn't actually
  // multiply out to the muscle mass figure beside it.
  const lbmKg = Math.round(rawLbm * 10) / 10;
  // s is a share of LBM, not of m̄: it's a fat-free-mass ratio (skeletal muscle vs. the
  // rest of LBM), and m̄ still carries the fat LBM has already had stripped out.
  const muscleKg = Math.round((lbmKg * (skeletalFrac / 100)) * 10) / 10;
  if (muscleKg <= 0) return null;

  const glycogenG = Math.round(gPerKgMuscle * muscleKg + liverG);
  return {
    lbmKg, skeletalFrac, muscleKg, gPerKgMuscle, liverG, glycogenG,
    waterRatio, swingKg: Math.round((glycogenG * (1 + waterRatio)) / 100) / 10,
  };
}

// The m_musc, m_gly and ΔM_gly boxes and their trace rows — always as a pair per box,
// same rule every other computed field here follows. A dash in all three when an input
// is missing.
function renderGlycogenSwingField() {
  const swing = readGlycogenSwingFormula();
  if (swing === null) {
    ['formula-glycogen-muscle', 'formula-glycogen-g', 'formula-glycogen-swing'].forEach((id) => setComputedField(id, '—'));
    return [];
  }

  const { lbmKg, skeletalFrac, muscleKg, gPerKgMuscle, liverG, glycogenG, waterRatio, swingKg } = swing;
  setComputedField('formula-glycogen-muscle', String(muscleKg));
  setComputedField('formula-glycogen-g', String(glycogenG));
  setComputedField('formula-glycogen-swing', String(swingKg));
  return [
    ['m_musc', `${skeletalFrac}% × ${lbmKg}  =  ${muscleKg} kg`],
    ['m_gly', `${gPerKgMuscle} × ${muscleKg} + ${liverG}  =  ${glycogenG} g`],
    ['ΔM_gly', `${glycogenG} × (1 + ${waterRatio}) / 1000  =  ${swingKg} kg`],
  ];
}

function syncTargetMassFromBmi() {
  if (!targetBmiIsTyped()) return;
  const bmi = formulaNumber('formula-target-bmi');
  const heightCm = formulaNumber('formula-height');
  if (bmi === null || heightCm === null || heightCm <= 0) return;
  document.getElementById('formula-target').value = String(bodyMassKgFromBmi(bmi, heightCm));
}

function renderTargetBmiField() {
  const targetKg = formulaNumber('formula-target');
  const heightCm = formulaNumber('formula-height');
  const el = document.getElementById('formula-target-bmi');
  const typed = targetBmiIsTyped();

  if (targetKg === null || heightCm === null || heightCm <= 0) {
    if (!typed) setComputedField('formula-target-bmi', '');
    el.classList.remove('formula-out-of-band');
    return [];
  }

  const bmi = computeBmi(targetKg, heightCm);
  if (!typed) setComputedField('formula-target-bmi', String(bmi));
  const verdict = bmiVerdict(bmi);
  el.classList.toggle('formula-out-of-band', verdict.outside);
  return [['BMI_g', `${targetKg} / (${heightCm / 100})²  =  ${bmi} kg/m² — ${verdict.text}`]];
}

function syncWeeklyLossFromPct() {
  if (!weeklyLossPctIsTyped()) return;
  const kg = weeklyFatLossKgFromPct(formulaNumber('formula-weekly-loss-pct'), formulaBodyMassKg());
  if (kg === null) return;
  document.getElementById('formula-weekly-loss').value = String(kg);
}

function formulaJourneyIsProportional() {
  return currentSolveFor() === 'FIXED_PCT';
}

function formulaProjection(args, weeklyPct) {
  if (formulaJourneyIsProportional() && weeklyPct !== null && weeklyPct > 0) {
    return projectTargetDaysAtFixedPct({
      bodyMassKg: args.bodyMassKg, targetKg: args.targetKg, weeklyPct,
    });
  }
  return projectTargetDays(args);
}

function formulaDaysRow(proj, { bodyMassKg, targetKg, weeklyPct, bRounded, eqRounded }) {
  if (proj.status !== 'ok') return [];
  if (proj.journey === 'pct') {
    return [['t', `7 × ln(${bodyMassKg} / ${targetKg}) / −ln(1 − ${weeklyPct}/100)  =  ${Math.round(proj.days)} days`]];
  }
  return [['t', `(7700 / ${bRounded}) × ln[(${bodyMassKg} − ${eqRounded}) / (${targetKg} − ${eqRounded})]  =  ${Math.round(proj.days)} days`]];
}

function weeklyLossPctVerdict(pct) {
  if (pct > WEEKLY_FAT_LOSS_PCT_CEILING) {
    return { text: `above the ${WEEKLY_FAT_LOSS_PCT_CEILING}%/week ceiling`, over: true };
  }
  if (pct >= WEEKLY_FAT_LOSS_PCT_FLOOR) {
    return { text: `in the ${WEEKLY_FAT_LOSS_PCT_FLOOR}–${WEEKLY_FAT_LOSS_PCT_CEILING}%/week band`, over: false };
  }
  if (pct > 0) return { text: `under the ${WEEKLY_FAT_LOSS_PCT_FLOOR}%/week floor`, over: false };
  if (pct === 0) return { text: 'maintenance', over: false };
  return { text: 'a surplus, not a deficit', over: false };
}

function renderWeeklyLossPctField() {
  const bodyMassKg = formulaBodyMassKg();
  const weeklyLossKg = formulaNumber('formula-weekly-loss');
  const derivedPct = weeklyFatLossPct(weeklyLossKg, bodyMassKg);
  const pctIsTyped = weeklyLossPctIsTyped();
  const pct = weeklyLossPctInPlay(weeklyLossKg, bodyMassKg);
  const pctEl = document.getElementById('formula-weekly-loss-pct');

  if (pct === null) {
    if (!pctIsTyped) setComputedField('formula-weekly-loss-pct', '');
    pctEl.classList.remove('formula-pct-over');
    return [];
  }

  if (!pctIsTyped) setComputedField('formula-weekly-loss-pct', String(pct));
  const verdict = weeklyLossPctVerdict(pct);
  pctEl.classList.toggle('formula-pct-over', verdict.over);

  if (derivedPct === null) return [];
  return [['Δm%', `100 × ${weeklyLossKg} / ${bodyMassKg}  =  ${derivedPct} %/week — ${verdict.text}`]];
}

function formulaBmrRow(bmr, { bodyMassKg, heightCm, age, sex, formula }) {
  if (formula === 'katch') {
    return ['BMR', `370 + 21.6 × ${bmrLeanBodyMassKg(bodyMassKg, heightCm, sex)}  =  ${Math.round(bmr)} kcal/day — Katch-McArdle, from lean mass`];
  }
  const sigma = sex === 'male' ? '+ 5' : '− 161';
  return ['BMR', `10 × ${bodyMassKg} + 6.25 × ${heightCm} − 5 × ${age} ${sigma}  =  ${Math.round(bmr)} kcal/day`];
}

function formulaAffineRows(coefficients, { heightCm, age, sex, met, tau, kappa }) {
  const { a, b, tefDivisor: divisor, formula } = coefficients;
  const lbm = boerLeanBodyMassCoefficients(sex);
  const sigma = sex === 'male' ? '+ 5' : '− 161';
  const aTerms = formula === 'katch'
    ? `370 + 21.6 × (${lbm.perCm} × ${heightCm} − ${Math.abs(lbm.constant)})`
    : `6.25 × ${heightCm} − 5 × ${age} ${sigma}`;
  const bTerms = formula === 'katch'
    ? `21.6 × ${lbm.perKg} + ${met} × ${tau} × ${kappa} / 200`
    : `10 + ${met} × ${tau} × ${kappa} / 200`;
  const byDivisor = divisor === 1 ? '' : `, all / ${Math.round(divisor * 1000) / 1000}`;
  return [
    ['A', `${aTerms}${byDivisor}  =  ${Math.round(a)} kcal/day`],
    ['B', `${bTerms}${byDivisor}  =  ${Math.round(b * 100) / 100} kcal/day per kg`],
  ];
}

function formulaEinRows(coefficients, { bmr, activityKcal, deficit, einKcal }) {
  const divisor = coefficients.tefDivisor;
  const sum = `${Math.round(bmr)} + ${Math.round(activityKcal)} − ${Math.round(deficit)}`;
  if (divisor === 1) return [['Eᵢₙ', `${sum}  =  ${Math.round(einKcal)} kcal/day`]];
  return [['Eᵢₙ', `(${sum}) / ${Math.round(divisor * 1000) / 1000}  =  ${Math.round(einKcal)} kcal/day`]];
}

function formulaDeficitRows(coefficients, { bmr, activityKcal, einKcal, deficit }) {
  const divisor = coefficients.tefDivisor;
  const head = `${Math.round(bmr)} + ${Math.round(activityKcal)} − `;
  const intake = divisor === 1
    ? `${Math.round(einKcal)}`
    : `${Math.round(einKcal)}×${Math.round(divisor * 1000) / 1000}`;
  return [['D', `${head}${intake}  =  ${Math.round(deficit)} kcal/day`]];
}

function readAdaptationInputs() {
  return {
    pctPerWeek: formulaNumber('formula-adapt-per-week'),
    pctCap: formulaNumber('formula-adapt-cap'),
  };
}

// The TEF box and its trace row — reads formula-ein and f (formula-tef-pct) directly, same
// reason readFiberFormula/readFatFormula do: by the time this runs, formula-ein already
// holds this render's value in every mode, so this can't disagree with what the sheet just
// showed. Split out from renderCorrectionFields so it can sit right above Eᵢₙ rather than
// down with the adaptation pair.
function readTefFormula() {
  const einKcal = formulaNumber('formula-ein');
  const tefPct = formulaNumber('formula-tef-pct');
  if (einKcal === null || tefPct === null) return null;
  return { einKcal, tefPct, tefKcal: Math.round(einKcal * (tefPct / 100)) };
}

function renderTefField() {
  const tef = readTefFormula();

  if (tef === null) {
    setComputedField('formula-tef', '—');
    return [];
  }

  const { einKcal, tefPct, tefKcal } = tef;
  setComputedField('formula-tef', String(tefKcal));
  // Only when there is one: at f = 0 the identity is true and empty, and a row reading
  // "0 × 1163 = 0" is three columns of nothing.
  if (tefKcal <= 0) return [];
  return [['TEF', `${tefPct}% × ${einKcal}  =  ${tefKcal} kcal/day`]];
}

function renderCorrectionFields(plan) {
  const bmrEl = 'formula-bmr-adapt';
  const plateauEl = 'formula-plateau-adapt';
  const { pctPerWeek, pctCap } = readAdaptationInputs();

  if (plan === null) {
    ['formula-bmr', 'formula-activity-kcal', 'formula-maintenance', 'formula-deficit', bmrEl, plateauEl].forEach((id) => setComputedField(id, '—'));
    return [];
  }

  const { intakeKcal, coefficients, bmr, activityKcal, deficit, days, journey } = plan;
  const rows = [];

  // Two figures with boxes but no trace rows of their own here — BMR and Eₐ already print
  // their substituted lines as rows of every mode, D prints its own in all but TARGET_MASS,
  // and M is just the BMR and Eₐ boxes added together in front of the reader.
  setComputedField('formula-bmr', String(Math.round(bmr)));
  setComputedField('formula-activity-kcal', String(Math.round(activityKcal)));
  setComputedField('formula-maintenance', String(Math.round(bmr + activityKcal)));
  setComputedField('formula-deficit', String(Math.round(deficit)));

  if (pctPerWeek === null || pctCap === null || bmr === null) {
    [bmrEl, plateauEl].forEach((id) => setComputedField(id, '—'));
    return rows;
  }

  const atCap = days === null;
  const fraction = atCap
    ? adaptationFraction(Infinity, pctPerWeek, pctCap)
    : adaptationFraction(days, pctPerWeek, pctCap);
  const adaptedBmr = bmr * (1 - fraction);
  const lostPct = Math.round(fraction * 1000) / 10;
  setComputedField(bmrEl, String(Math.round(adaptedBmr)));
  rows.push(['BMR_a', `${Math.round(bmr)} × (1 − ${lostPct}/100)  =  ${Math.round(adaptedBmr)} kcal/day — ${atCap ? `at the ${pctCap}% ceiling` : `by day ${Math.round(days)}`}`]);

  if (journey === 'pct') {
    setComputedField(plateauEl, '—');
    rows.push(['m∞_a', 'no plateau on a proportional journey, so no overshoot to report']);
    return rows;
  }

  const plateauKg = adaptedPlateauKg(intakeKcal, coefficients, fraction);
  const plainPlateauKg = (intakeKcal - coefficients.a) / coefficients.b;
  if (!Number.isFinite(plateauKg)) {
    setComputedField(plateauEl, '—');
    return rows;
  }

  const plateauRounded = Math.round(plateauKg * 10) / 10;
  const overshootKg = Math.round((plateauKg - plainPlateauKg) * 10) / 10;
  setComputedField(plateauEl, String(plateauRounded));
  rows.push(['m∞_a', `(${Math.round(intakeKcal)} − ${Math.round(coefficients.aBmr * (1 - fraction) / coefficients.tefDivisor)}) / ${Math.round(((1 - fraction) * coefficients.bBmr + coefficients.activityPerKg) / coefficients.tefDivisor * 100) / 100}  =  ${plateauRounded} kg${overshootKg > 0 ? ` — ${overshootKg} kg above m∞, which is the usual overshoot` : ''}`]);
  return rows;
}

function renderFormulaPreview() {
  syncTargetMassFromBmi();
  syncWeeklyLossFromPct();
  const { mode, preview, bodyMassKg, heightCm, age, sex, formula, einKcal, days, invalid } = readFormulaInputs();
  const noteEl = document.getElementById('formula-profile-note');

  const computedNow = computedIdsForMode(mode);
  const showFailure = (message) => {
    if (computedNow.includes('formula-ein')) setComputedField('formula-ein', '—');
    if (computedNow.includes('formula-days')) {
      setComputedField('formula-days', '');
      setEtaDate('');
      setEtaNote('');
    }
    renderFormulaSubstituted(null);
    noteEl.textContent = message;
  };

  if (invalid.length) {
    showFailure(`Needs a number in: ${invalid.join(', ')}.`);
    return;
  }

  const cantCompute = () => showFailure("Can't compute from these values.");

  const met = withFormulaOverrides(preview, activityMet);
  const kappa = preview.KCAL_PER_MET_KG_MIN;
  const bmr = bmrKcal(bodyMassKg, heightCm, age, sex, formula);
  const tef = preview[TEF_PERCENT_KEY];

  const profile = { heightCm, age, sex, met, kappa, formula, tef };
  const bmrRow = formulaBmrRow(bmr, { bodyMassKg, heightCm, age, sex, formula });

  noteEl.textContent = '';

  if (mode === 'EIN' || mode === 'FIXED_PCT') {
    const tau = preview.ACTIVITY_TARGET_MIN;
    const targetKg = preview.BODY_MASS_TARGET_KG;
    const detail = withFormulaOverrides(preview, () => calorieTargetDetail(bodyMassKg, age));
    if (detail === null) { cantCompute(); return; }
    const weeklyPct = weeklyLossPctInPlay(detail.weeklyFatLossKg, bodyMassKg);
    const coefficients = maintenanceAffineCoefficients({ ...profile, tau });
    const { a, b } = coefficients;
    const proj = formulaProjection({
      intakeKcal: detail.kcal, bodyMassKg, targetKg, tau, ...profile,
    }, weeklyPct);
    setComputedField('formula-ein', String(Math.round(detail.kcal)));
    renderFormulaDaysField(proj, { bodyMassKg, targetKg });

    const deficit = (detail.weeklyFatLossKg * GENERIC_KCAL_PER_KG_FAT) / 7;
    const bRounded = Math.round(b * 100) / 100;
    const eqRounded = Math.round(((detail.kcal - a) / b) * 10) / 10;
    const rows = [
      bmrRow,
      ['Eₐ', `${met} × ${bodyMassKg} × ${tau} × ${kappa} / 200  =  ${Math.round(detail.activityKcal)} kcal/day`],
      ...renderWeeklyLossPctField(),
      ['D', `${detail.weeklyFatLossKg} × 7700 / 7  =  ${Math.round(deficit)} kcal/day`],
      ...renderTefField(),
      ...formulaEinRows(coefficients, {
        bmr: detail.bmr, activityKcal: detail.activityKcal, deficit, einKcal: detail.kcal,
      }),
      ...renderTargetBmiField(),
    ];
    if (proj.journey !== 'pct') {
      rows.push(
        ...formulaAffineRows(coefficients, { heightCm, age, sex, met, tau, kappa }),
        ['m∞', `(${detail.kcal} − ${Math.round(a)}) / ${bRounded}  =  ${eqRounded} kg`],
      );
    }
    rows.push(...formulaDaysRow(proj, { bodyMassKg, targetKg, weeklyPct, bRounded, eqRounded }));
    renderFormulaSubstituted(rows, {
      intakeKcal: detail.kcal,
      coefficients,
      bmr: detail.bmr,
      activityKcal: detail.activityKcal,
      deficit,
      days: proj.status === 'ok' ? proj.days : null,
      journey: proj.journey,
    });
    return;
  }

  if (mode === 'TAU') {
    const deltaM = preview.WEEKLY_FAT_LOSS_KG;
    const deficit = (deltaM * GENERIC_KCAL_PER_KG_FAT) / 7;
    const targetKg = preview.BODY_MASS_TARGET_KG;
    const knownField = dualKnownField.TAU;

    const shape = maintenanceAffineCoefficients({ ...profile, tau: 0 });
    const divisor = shape.tefDivisor;

    let tau;
    if (knownField === 'ein') {
      const activityKcalNeeded = einKcal * divisor + deficit - bmr;
      tau = Math.round((activityKcalNeeded * ML_O2_PER_KCAL) / (met * bodyMassKg * kappa));
    } else {
      const c = (met * kappa) / ML_O2_PER_KCAL;
      const B = solveBForTypedDays({
        deficit: deficit / divisor,
        massToLose: bodyMassKg - targetKg,
        t: days,
        rho: GENERIC_KCAL_PER_KG_FAT,
        minB: shape.bBmr / divisor,
      });
      tau = B === null ? NaN : Math.round((B * divisor - shape.bBmr) / c);
    }
    if (!Number.isFinite(tau) || tau < 0) { cantCompute(); return; }
    setComputedField('formula-activity-min', String(tau));

    const coefficients = maintenanceAffineCoefficients({ ...profile, tau });
    const { a, b } = coefficients;
    const activityKcal = withFormulaOverrides(
      { ...preview, ACTIVITY_TARGET_MIN: tau },
      () => activityTargetKcal(bodyMassKg),
    );
    const einForDisplay = knownField === 'ein' ? einKcal : (bmr + activityKcal - deficit) / divisor;

    const weeklyPct = weeklyLossPctInPlay(deltaM, bodyMassKg);
    const projArgs = { intakeKcal: einForDisplay, bodyMassKg, targetKg, tau, ...profile };
    const proj = knownField === 'ein' ? formulaProjection(projArgs, weeklyPct) : projectTargetDays(projArgs);
    if (knownField === 'ein') {
      renderFormulaDaysField(proj, { bodyMassKg, targetKg });
    } else {
      setComputedField('formula-ein', String(Math.round(einForDisplay)));
      setEtaDate(isoDateFromDays(days));
      setEtaNote('');
    }

    const bRounded = Math.round(b * 100) / 100;
    const eqRounded = Math.round(((einForDisplay - a) / b) * 10) / 10;
    const rows = [];
    if (knownField === 'days') {
      rows.push(['τ', `solved numerically so that m(t=${days}) = ${targetKg} kg`]);
    }
    rows.push(
      bmrRow,
      ['Eₐ', `${met} × ${bodyMassKg} × ${tau} × ${kappa} / 200  =  ${Math.round(activityKcal)} kcal/day`],
      ...renderWeeklyLossPctField(),
      ['D', `${deltaM} × 7700 / 7  =  ${Math.round(deficit)} kcal/day`],
      ...renderTefField(),
      ...formulaEinRows(coefficients, { bmr, activityKcal, deficit, einKcal: einForDisplay }),
      ...renderTargetBmiField(),
    );
    if (proj.journey !== 'pct') {
      rows.push(
        ...formulaAffineRows(coefficients, { heightCm, age, sex, met, tau, kappa }),
        ['m∞', `(${Math.round(einForDisplay)} − ${Math.round(a)}) / ${bRounded}  =  ${eqRounded} kg`],
      );
    }
    rows.push(...formulaDaysRow(proj, { bodyMassKg, targetKg, weeklyPct, bRounded, eqRounded }));
    renderFormulaSubstituted(rows, {
      intakeKcal: einForDisplay,
      coefficients,
      bmr,
      activityKcal,
      deficit,
      days: knownField === 'days' ? days : (proj.status === 'ok' ? proj.days : null),
      journey: proj.journey,
    });
    return;
  }

  if (mode === 'TARGET_MASS') {
    const tau = preview.ACTIVITY_TARGET_MIN;
    const coefficients = maintenanceAffineCoefficients({ ...profile, tau });
    const { a, b } = coefficients;
    const equilibriumKg = (einKcal - a) / b;
    const mG = equilibriumKg + (bodyMassKg - equilibriumKg) * Math.exp((-b * days) / GENERIC_KCAL_PER_KG_FAT);
    if (!Number.isFinite(mG)) { cantCompute(); return; }
    const mGRounded = Math.round(mG * 10) / 10;
    setComputedField('formula-target', String(mGRounded));
    setEtaDate(isoDateFromDays(days));
    setEtaNote('');

    const bRounded = Math.round(b * 100) / 100;
    const eqRounded = Math.round(equilibriumKg * 10) / 10;
    renderFormulaSubstituted([
      ...renderTefField(),
      ...formulaAffineRows(coefficients, { heightCm, age, sex, met, tau, kappa }),
      ['m∞', `(${Math.round(einKcal)} − ${Math.round(a)}) / ${bRounded}  =  ${eqRounded} kg`],
      ['m_g', `${eqRounded} + (${bodyMassKg} − ${eqRounded}) × e^(−${bRounded}×${days}/7700)  =  ${mGRounded} kg`],
      ...renderTargetBmiField(),
      ...renderWeeklyLossPctField(),
    ], (() => {
      const activityKcal = withFormulaOverrides(preview, () => activityTargetKcal(bodyMassKg));
      return {
        intakeKcal: einKcal,
        coefficients,
        bmr,
        activityKcal,
        deficit: bmr + activityKcal - einKcal * coefficients.tefDivisor,
        days,
        journey: 'intake',
      };
    })());
    return;
  }

  // DELTA_M
  const tau = preview.ACTIVITY_TARGET_MIN;
  const targetKg = preview.BODY_MASS_TARGET_KG;
  const coefficients = maintenanceAffineCoefficients({ ...profile, tau });
  const { a, b } = coefficients;
  const activityKcal = withFormulaOverrides(preview, () => activityTargetKcal(bodyMassKg));
  const knownField = dualKnownField.DELTA_M;

  let einForDisplay;
  let decay;
  if (knownField === 'ein') {
    einForDisplay = einKcal;
  } else {
    decay = Math.exp((-b * days) / GENERIC_KCAL_PER_KG_FAT);
    const equilibriumKg = (targetKg - bodyMassKg * decay) / (1 - decay);
    einForDisplay = a + b * equilibriumKg;
  }
  if (!Number.isFinite(einForDisplay)) { cantCompute(); return; }

  const deficit = bmr + activityKcal - einForDisplay * coefficients.tefDivisor;
  const deltaMSolved = Math.round((deficit * 7 / GENERIC_KCAL_PER_KG_FAT) * 100) / 100;
  if (!Number.isFinite(deltaMSolved)) { cantCompute(); return; }
  setComputedField('formula-weekly-loss', String(deltaMSolved));

  const bRounded = Math.round(b * 100) / 100;
  const eqRounded = Math.round(((einForDisplay - a) / b) * 10) / 10;

  if (knownField === 'ein') {
    const weeklyPct = weeklyFatLossPct(deltaMSolved, bodyMassKg);
    const proj = formulaProjection({
      intakeKcal: einForDisplay, bodyMassKg, targetKg, tau, ...profile,
    }, weeklyPct);
    renderFormulaDaysField(proj, { bodyMassKg, targetKg });

    renderFormulaSubstituted([
      bmrRow,
      ['Eₐ', `${met} × ${bodyMassKg} × ${tau} × ${kappa} / 200  =  ${Math.round(activityKcal)} kcal/day`],
      ...formulaDeficitRows(coefficients, { bmr, activityKcal, einKcal: einForDisplay, deficit }),
      ...renderTefField(),
      ['Δm', `${Math.round(deficit)} × 7 / 7700  =  ${deltaMSolved} kg/week`],
      ...(proj.journey === 'pct' ? [] : [
        ...formulaAffineRows(coefficients, { heightCm, age, sex, met, tau, kappa }),
        ['m∞', `(${Math.round(einForDisplay)} − ${Math.round(a)}) / ${bRounded}  =  ${eqRounded} kg`],
      ]),
      ...formulaDaysRow(proj, { bodyMassKg, targetKg, weeklyPct, bRounded, eqRounded }),
      ...renderTargetBmiField(),
      ...renderWeeklyLossPctField(),
    ], {
      intakeKcal: einForDisplay,
      coefficients,
      bmr,
      activityKcal,
      deficit,
      days: proj.status === 'ok' ? proj.days : null,
      journey: proj.journey,
    });
    return;
  }

  setEtaDate(isoDateFromDays(days));
  setEtaNote('');
  setComputedField('formula-ein', String(Math.round(einForDisplay)));

  const decayRounded = Math.round(decay * 1000) / 1000;
  renderFormulaSubstituted([
    ...formulaAffineRows(coefficients, { heightCm, age, sex, met, tau, kappa }),
    ['m∞', `(${targetKg} − ${bodyMassKg}×${decayRounded}) / (1 − ${decayRounded})  =  ${eqRounded} kg`],
    ['Eᵢₙ', `${Math.round(a)} + ${bRounded} × ${eqRounded}  =  ${Math.round(einForDisplay)} kcal/day`],
    ...renderTefField(),
    bmrRow,
    ['Eₐ', `${met} × ${bodyMassKg} × ${tau} × ${kappa} / 200  =  ${Math.round(activityKcal)} kcal/day`],
    ...formulaDeficitRows(coefficients, { bmr, activityKcal, einKcal: einForDisplay, deficit }),
    ['Δm', `${Math.round(deficit)} × 7 / 7700  =  ${deltaMSolved} kg/week`],
    ...renderTargetBmiField(),
    ...renderWeeklyLossPctField(),
  ], {
    intakeKcal: einForDisplay,
    coefficients,
    bmr,
    activityKcal,
    deficit,
    days,
    journey: 'intake',
  });
}

// Fills every box from the default demo profile — what a fresh load, and
// Reset, both seed the sheet with.
function loadDefaultInputs() {
  [...FORMULA_FIELDS, ...PROTEIN_FORMULA_FIELDS, ...FIBER_FORMULA_FIELDS, ...FAT_FORMULA_FIELDS, ...ADAPT_FORMULA_FIELDS].forEach((field) => {
    document.getElementById(field.inputId).value = formulaFieldValue(field);
  });
  document.getElementById('formula-body-mass-smooth').value = DEFAULT_BODY_MASS_KG;
  document.getElementById('formula-height').value = DEFAULT_HEIGHT_CM;
  document.getElementById('formula-age').value = DEFAULT_AGE;
  document.getElementById('formula-sex').value = DEFAULT_SEX;
}

function initSheet() {
  document.getElementById('formula-expression').textContent = FORMULA_EXPRESSION;
  document.querySelector('input[name="formula-solve-for"][value="EIN"]').checked = true;
  dualKnownField.TAU = 'ein';
  dualKnownField.DELTA_M = 'days';
  weeklyLossKnownField = 'kg';
  targetMassKnownField = 'kg';
  document.querySelector('input[name="formula-bmr-formula"][value="mifflin"]').checked = true;
  loadDefaultInputs();
  applySolveForMode('EIN');
  renderFormulaPreview();
}

function wireSheet() {
  [...FORMULA_FIELDS.map((f) => f.inputId).filter((id) => id !== 'formula-weekly-loss' && id !== 'formula-target'),
    ...PROTEIN_FORMULA_FIELDS.map((f) => f.inputId),
    ...FIBER_FORMULA_FIELDS.map((f) => f.inputId),
    ...FAT_FORMULA_FIELDS.map((f) => f.inputId),
    ...ADAPT_FORMULA_FIELDS.map((f) => f.inputId),
    'formula-body-mass-smooth', 'formula-height', 'formula-age',
    'formula-glycogen-skeletal-frac', 'formula-glycogen-per-kg-muscle', 'formula-glycogen-liver',
    'formula-glycogen-water-ratio'].forEach((id) => {
    document.getElementById(id).addEventListener('input', renderFormulaPreview);
  });
  document.getElementById('formula-sex').addEventListener('change', renderFormulaPreview);

  document.querySelectorAll('input[name="formula-bmr-formula"]').forEach((radio) => {
    radio.addEventListener('change', renderFormulaPreview);
  });

  [['formula-weekly-loss', 'kg'], ['formula-weekly-loss-pct', 'pct']].forEach(([id, field]) => {
    document.getElementById(id).addEventListener('input', () => {
      weeklyLossKnownField = field;
      renderFormulaPreview();
    });
  });

  [['formula-target', 'kg'], ['formula-target-bmi', 'bmi']].forEach(([id, field]) => {
    document.getElementById(id).addEventListener('input', () => {
      targetMassKnownField = field;
      renderFormulaPreview();
    });
  });

  const markDualKnown = (field) => {
    const mode = currentSolveFor();
    if (mode === 'TAU' || mode === 'DELTA_M') {
      dualKnownField[mode] = field;
      applySolveForMode(mode);
    }
  };
  document.getElementById('formula-ein').addEventListener('input', () => {
    markDualKnown('ein');
    renderFormulaPreview();
  });
  document.getElementById('formula-days').addEventListener('input', () => {
    markDualKnown('days');
    renderFormulaPreview();
  });

  document.getElementById('formula-eta').addEventListener('change', (event) => {
    if (event.target.readOnly || !event.target.value) return;
    markDualKnown('days');
    document.getElementById('formula-days').value = String(daysFromTodayIso(event.target.value));
    renderFormulaPreview();
  });

  document.querySelectorAll('input[name="formula-solve-for"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      applySolveForMode(currentSolveFor());
      renderFormulaPreview();
    });
  });

  document.getElementById('formula-reset-btn').addEventListener('click', () => {
    loadDefaultInputs();
    renderFormulaPreview();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  wireSheet();
  initSheet();
  document.getElementById('footer-year').textContent = new Date().getFullYear();
});
