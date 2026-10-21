// Types mirror the real API responses saved in web/fixtures/*.json.
// Demo clock: integer "demo minutes" = wear-day index * 1440 + minute of day.

export type Mode = 'replay' | 'live'
export type Status = 'monitoring' | 'ended' | 'not_started' | 'warming_up' | 'no_recent_data'
export type Trend =
  | 'rising_fast'
  | 'rising'
  | 'rising_slow'
  | 'steady'
  | 'falling_slow'
  | 'falling'
  | 'falling_fast'
export type RiskKind = 'hypo' | 'hyper' | 'hyper2'
/** Kinds that raise an interruptive alert (model v2). `hyper` (>180) is a ranking signal only. */
export type AlertKind = 'hypo' | 'hyper2'
export type TierName = 'urgent' | 'act' | 'watch' | 'data' | 'review' | 'stable' | 'waiting' | 'ended'
export type DriverSource = 'cgm' | 'logs' | 'clinical record' | 'personal history' | 'time'

export interface Meta {
  product: string
  version: string
  disclaimer: string
  clock: { min: number; max: number; step_min: number; default: number }
  thresholds_mgdl: { hypo_l2: number; hypo: number; hyper: number; hyper_l2: number }
  horizons_min: number[]
  /** Legacy per-kind classifier thresholds (v1 design). The alert policy below is what fires alerts. */
  alert_thresholds: Record<RiskKind, number>
  alert_policy?: {
    kinds: AlertKind[]
    /** probability thresholds on the classifier output, per alerting kind */
    thresholds: Record<AlertKind, number>
    cooldown_min: number
    false_alert_budget_per_day: number
  }
  model_version?: string
  model: { trained_at?: string; git_commit?: string; train_patients?: number; seed?: number }
  personalisation: Record<string, { lambda: number; halflife: number }>
  provenance: {
    clinical_record: string
    cgm: string
    forecast: string
    sensitivity: string
    time_shift: string
  }
  demo_population: string
}

export interface PatientSummary {
  recording_id: string
  patient_id: string
  display_id: string
  age: number | null
  sex: string | null
  bmi: number | null
  diabetes_duration_y: number | null
  hba1c_pct: number | null
  hba1c_mmolmol: number | null
  egfr: number | null
  cpeptide_fasting_nmol: number | null
  regimen: string[]
  regimen_text: string
  other_agents_text: string
  complications: string[]
  comorbidities: string[]
  source: string
  original_start?: string
}

export interface RiskItem {
  p: number | null
  threshold: number
  at_risk: boolean
  above_threshold: boolean
  label: string
}
export type Risk = Record<RiskKind, RiskItem>

export interface Stats24h {
  n: number
  coverage?: number
  mean?: number
  cv_pct?: number | null
  tir?: number
  tar?: number
  tar_l2?: number
  tbr?: number
  tbr_l2?: number
  gmi_pct?: number
}

export interface AlertInfo {
  kind: AlertKind
  /** demo minute the alert fired (worklist only) */
  t: number
  label: string
}

export interface WorklistPatient {
  recording_id: string
  mode: Mode
  summary: PatientSummary
  clock: { t: number; label: string }
  status: Status
  minutes_since_reading: number | null
  glucose: number | null
  trend: Trend | null
  forecast_60: { horizon: number; yhat: number; lo: number; hi: number } | null
  risk: Risk
  stats_24h: Stats24h
  /** alert fired in the last 60 min, if any */
  alert: AlertInfo | null
  priority: { tier: number; name: TierName; reason: string }
}

export interface Worklist {
  t: number
  label: string
  patients: WorklistPatient[]
}

export interface PatientRecord {
  recording_id: string
  mode: Mode
  summary: PatientSummary
  fhir: FhirBundle
  start_demo: number
  end_demo: number
}

export interface FhirBundle {
  resourceType: string
  type?: string
  id?: string
  entry?: { resource: Record<string, unknown> & { resourceType: string } }[]
  [k: string]: unknown
}

export type EventKind = 'meal' | 'insulin' | 'oral' | 'csii_bolus' | 'csii_basal_rate' | 'insulin_iv'

export interface TwinEvent {
  t: number
  kind: EventKind
  detail: string
  amount: number | null
  unit: string | null
  category: string | null
}

export interface PastForecast {
  issued_t: number
  target_t: number
  yhat: number
  lo: number
  hi: number
  yhat_population: number
  actual: number | null
}

export interface HorizonForecast {
  horizon: number
  target_t: number
  yhat: number
  lo: number
  hi: number
  yhat_population: number
  primary: boolean
}

export interface Driver {
  feature: string
  label: string
  source: DriverSource | string
  value: string
  contribution: number
}

export interface TwinState {
  slot: number
  t: number
  glucose: number | null
  kalman: { level: number | null; rate_mgdl_per_min: number | null; level_sd: number | null }
  trend: Trend
  profile: { mean: number | null; sd: number | null; tar: number | null; tbr: number | null }
  data_quality: {
    readings_last_3h: number
    expected_last_3h: number
    issuable: boolean
    /** sensor-noise proxy over the last 3 h, mg/dL */
    signal_roughness_mgdl?: number | null
  }
  personal_correction: Record<string, number | null>
}

export interface TwinForecast {
  issued_t: number
  horizons: HorizonForecast[]
  risk: Risk
  /** alert that fired at this reading, if any */
  alert?: { kind: AlertKind; label: string } | null
  active_alerts: AlertKind[]
  drivers: {
    forecast_60?: Driver[]
    event?: { kind: RiskKind; items: Driver[]; units: string }
  }
}

export interface Twin {
  recording_id: string
  mode: Mode
  summary: PatientSummary
  clock: {
    t: number
    label: string
    status: Status
    minutes_since_reading: number | null
    window_start: number
  }
  observations: { t: number; glucose: number }[]
  fingersticks: { t: number; glucose: number }[]
  events: TwinEvent[]
  recent_alerts: { t: number; kinds: AlertKind[] }[]
  past_forecasts: PastForecast[]
  stats_24h: Stats24h
  state: TwinState | null
  forecast: TwinForecast | null
  abstain_reason: string | null
  disclaimer: string
}

export interface LedgerEntry {
  issued_t: number
  target_t: number
  yhat: number
  lo: number
  hi: number
  actual: number
  error: number
  inside: boolean
  glucose_at_issue: number | null
}

export interface Ledger {
  recording_id: string
  horizon: number
  t: number
  summary: {
    n_resolved: number
    pending: number
    mae?: number
    bias?: number
    mae_population_model?: number
    mae_persistence?: number
    coverage?: number
    nominal_coverage?: number
  }
  by_day: { day: number; n: number; mae: number; mae_persistence: number; coverage: number }[]
  entries: LedgerEntry[]
}

export type SensitivityChange =
  | { kind: 'add_meal'; grams: number; carb_grams: number }
  | { kind: 'remove_recent_meals' }
  | { kind: 'add_fast_insulin'; units: number }
  | { kind: 'remove_recent_insulin' }

export interface SensitivityPack {
  horizons: { horizon: number; yhat: number; lo: number; hi: number }[]
  risk: Record<RiskKind, number | null>
}

export interface Sensitivity {
  t: number
  label: string
  applied: string[]
  baseline: SensitivityPack
  scenario: SensitivityPack
  changed_features: { feature: string; label: string; before: string; after: string }[]
  ood_warnings: string[]
  disclaimer: string
}

export interface AgpBin {
  /** minute of day at the centre of the bin */
  tod: number
  n: number
  p5: number | null
  p25: number | null
  p50: number | null
  p75: number | null
  p95: number | null
}

export interface Agp {
  recording_id: string
  t: number
  available: boolean
  reason?: string
  n_readings: number
  days?: number
  coverage?: number
  sufficient?: boolean
  sufficiency_note?: string
  mean?: number
  gmi_pct?: number
  cv_pct?: number | null
  gri?: number
  /** fractions of time (0-1) */
  ranges?: { very_low: number; low: number; in_range: number; high: number; very_high: number }
  /** consensus targets as display strings, e.g. ">70%" */
  targets?: Record<string, string>
  profile?: AgpBin[]
  note?: string
}

export interface LiveSession {
  recording_id: string
  source: string
  running: boolean
  external: boolean
  ingested_readings: number
  alerts: number
}

// ---------------------------------------------------------------- evaluation

export interface ModelDef {
  key: string
  label: string
  kind: 'baseline' | 'comparison' | 'ablation' | 'pratirup' | string
}

export interface PointMetrics {
  n: number
  mae: number
  rmse: number
  bias?: number
  mard_pct?: number
  bands?: Record<string, { n: number; mae: number }>
  parkes?: Record<string, number>
}

export interface IntervalMetrics {
  coverage: number
  mean_width: number
  median_width?: number
  qhat?: number
}

export interface CalibrationBin {
  p_mean: number
  observed: number
  n: number
}

export interface EventSample {
  n: number
  prevalence: number
  auprc: number
  auroc: number
  brier?: number
}

export interface EventLevel {
  threshold: number
  episodes: number
  detected: number
  sensitivity: number
  alerts: number
  ppv: number | null
  false_alerts_per_day: number
  alerts_per_day: number
  sensitivity_lead30: number | null
  lead_time_median_min: number | null
  lead_time_iqr_min: [number, number] | number[] | null
  patient_days: number
}

export interface EventScorerResult {
  sample: EventSample
  event: EventLevel
  calibration?: CalibrationBin[]
}

export type EventsBlock = Record<string, Record<string, EventScorerResult>>
export type ForecastBlock = Record<string, Record<string, PointMetrics>>

export interface RobustnessEntry {
  abstention_rate: number
  mae_30_lgbm: number
  mae_30_persistence: number
  mae_60_lgbm: number
  mae_60_persistence: number
  coverage_30: number
  coverage_60: number
}

export interface SubgroupEntry {
  patients: number
  mae_30_lgbm: number
  mae_30_persistence: number
  mae_60_lgbm: number
  mae_60_persistence: number
  hyper_sensitivity: number
  hyper_false_alerts_per_day: number
}

export interface BootstrapEntry {
  diff: number
  ci95: [number, number]
  p_a_better: number
}

export interface ImportanceEntry {
  gain_top: { feature: string; share: number; label?: string }[]
  shap_by_group_mgdl: Record<string, number>
}

export interface VersionSummary {
  model_version: number | string
  evaluated_at?: string
  mae: Record<string, number>
  mae_persistence: Record<string, number>
  coverage_60: number
  noise10_mae_30: number
  noise10_mae_30_persistence: number
  alerts_per_day: number
  false_alerts_per_day: number | null
  alert_design: string
}

export interface AlertPolicyKind {
  episodes: number
  sensitivity: number
  sensitivity_lead30: number | null
  lead_time_median_min: number | null
}

export interface AlertPolicyResult {
  thresholds: Record<AlertKind, number>
  patient_days: number
  alerts_per_day: number
  false_alerts_per_day: number
  ppv: number | null
  hypo: AlertPolicyKind
  hyper2: AlertPolicyKind
}

export interface FoundationHorizon {
  mae: number
  rmse: number
  mae_persistence: number
  coverage_80: number
  mean_width_80: number
}
export interface FoundationBlock {
  n_forecasts: number
  seconds: number
  [horizon: string]: FoundationHorizon | number
}

export interface PerPatientMetric {
  mae_mean: number
  mae_sd: number
  rmse_mean: number
  rmse_sd: number
}

export interface Evaluation {
  meta: {
    generated_at: string
    dev_stage: {
      stage?: string
      generated_at?: string
      git_commit?: string
      dev_patients?: number
      dev_recordings?: number
      issuable_rows?: number
      runtime_s?: number
    }
    test_stage:
      | null
      | {
          stage?: string
          evaluated_at?: string
          git_commit?: string
          test_patients?: number
          test_recordings?: number
          issuable_rows?: number
          model_trained_at?: string
          reason?: string | null
        }
    dataset: string
    split: {
      unit: string
      dev_patients: number
      test_patients: number
      folds: number
      stratified_by: string
      seed: number
    }
    protocol: string[]
  }
  models: ModelDef[]
  event_scorers: { key: string; label: string }[]
  kalman?: unknown
  lgbm_tuning?: unknown
  gru?: unknown
  forecast: { dev_cv: ForecastBlock; test?: ForecastBlock }
  intervals: {
    dev_cv: Record<string, IntervalMetrics>
    test?: Record<string, { population: IntervalMetrics; personal: IntervalMetrics }>
  }
  events: { dev_cv: EventsBlock; test?: EventsBlock }
  thresholds?: Record<string, Record<string, number>>
  personalisation: {
    selected: Record<string, { lambda: number; halflife: number }>
    test?: Record<string, { mae_population: number; mae_personal: number }>
  }
  bootstrap_test?: Record<string, Record<string, BootstrapEntry>>
  alert_burden_test?: { by_kind: Record<string, number>; total_alerts_per_day: number }
  versions?: { current: number | string; v1?: VersionSummary; latest?: VersionSummary; changes?: string[] }
  alert_policy?: { dev?: AlertPolicyResult; test?: AlertPolicyResult; external_t2d?: AlertPolicyResult }
  foundation_model?: {
    model: string
    context_slots?: number
    protocol?: string
    test?: FoundationBlock
    dev?: FoundationBlock
  }
  per_patient_test?: Record<string, Record<string, PerPatientMetric>>
  noise_experiment_dev?: {
    train_noise_sd: number[]
    eval_noise_sd: number[]
    /** horizon -> "v1_clean_training|sd=10" -> { mae, mae_persistence } */
    results: Record<string, Record<string, { mae: number; mae_persistence: number }>>
    decision?: {
      clean_60_relative_change: number
      noisy10_30_relative_gain: number
      noisy10_30_beats_persistence: boolean
      adopt_v2: boolean
      rule: string
    }
  }
  robustness_test?: Record<string, RobustnessEntry>
  subgroups_test?: Record<string, SubgroupEntry>
  importance_test?: Record<string, ImportanceEntry>
  figures: string[]
  external?: unknown
}
