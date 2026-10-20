// Builds docs/Pratirup_Presentation.pptx. Every metric is read from
// results/benchmark.json (which embeds the CGMacros external results), so the
// deck cannot drift from the experiments.
// Run: cd docs/deck && npm install && npm run build

const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");

const ROOT = path.resolve(__dirname, "..", "..");
const B = JSON.parse(fs.readFileSync(path.join(ROOT, "results", "benchmark.json"), "utf8"));
const E = B.external;
const T = B.forecast.test;
const SHOTS = path.join(ROOT, "docs", "screenshots");

const C = {
  ink: "15232A", muted: "56676F", line: "D9E1E5", petrol: "0D5F73", petrolDeep: "0A3B47", soft: "E1EFF2",
  bg2: "F3F6F7", white: "FFFFFF", green: "2E8B57", amber: "C98A00", orange: "D2691E", red: "C0392B",
  grey: "9AA9B1", greyLight: "C5CFD4", gold: "B28A4A", teal: "5AA3B5",
};
const HEAD = "Cambria";
const BODY = "Calibri";
const f1 = (x) => (x === null || x === undefined ? "—" : x.toFixed(1));
const f2 = (x) => x.toFixed(2);
const pct = (x, d = 0) => (x * 100).toFixed(d) + "%";

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5 in
pres.title = "Pratirup: a glucose digital twin for type 2 diabetes care teams";
pres.author = "Team Aflatoon, Scaler School of Technology";
pres.subject = "Happiest Health Digital Twin Challenge 2026";
pres.theme = { headFontFace: HEAD, bodyFontFace: BODY };

const FOOT = "Pratirup · Team Aflatoon · Scaler School of Technology · research prototype, not a medical device";
pres.defineSlideMaster({
  title: "CONTENT",
  background: { color: C.white },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.35, w: 12.1, h: 0.85, fontFace: HEAD,
      fontSize: 30, bold: true, color: C.ink, valign: "middle", align: "left", margin: 0 }, text: "" } },
    { text: { text: FOOT, options: { x: 0.6, y: 7.02, w: 10, h: 0.3, fontSize: 9, color: C.muted, fontFace: BODY, margin: 0 } } },
  ],
  slideNumber: { x: 12.25, y: 7.02, w: 0.5, h: 0.3, fontSize: 9, color: C.muted, fontFace: BODY, align: "right" },
});
pres.defineSlideMaster({
  title: "DARK",
  background: { color: C.petrolDeep },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.8, y: 2.2, w: 11.7, h: 1.3, fontFace: HEAD,
      fontSize: 54, bold: true, color: C.white, valign: "bottom", align: "left", margin: 0 }, text: "" } },
  ],
});

function text(slide, t, opts) {
  slide.addText(t, { fontFace: BODY, fontSize: 15, color: C.ink, margin: 0, valign: "top", isTextBox: true, ...opts });
}
function stat(slide, x, y, w, big, label, color = C.petrol) {
  text(slide, big, { x, y, w, h: 0.95, fontFace: HEAD, fontSize: 44, bold: true, color, valign: "bottom" });
  text(slide, label, { x, y: y + 1.0, w, h: 0.9, fontSize: 13, color: C.muted });
}
function card(slide, x, y, w, h, title, body, fill = C.bg2, titleColor = C.petrol) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: fill }, line: { color: fill }, rectRadius: 0.08 });
  text(slide, title, { x: x + 0.22, y: y + 0.18, w: w - 0.44, h: 0.4, fontSize: 15, bold: true, color: titleColor });
  text(slide, body, { x: x + 0.22, y: y + 0.62, w: w - 0.44, h: h - 0.75, fontSize: 13, color: C.ink });
}
function chip(slide, x, y, label, color) {
  const w = 0.085 * label.length + 0.4;
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h: 0.32, fill: { color: C.white }, line: { color, width: 1 }, rectRadius: 0.16 });
  text(slide, label, { x, y: y + 0.01, w, h: 0.3, fontSize: 10.5, color, align: "center", valign: "middle" });
  return w;
}
function bullets(items, size = 15) {
  return items.map((t, i) => ({ text: t, options: { bullet: { indent: 16 }, breakLine: i < items.length - 1, paraSpaceAfter: 6, fontSize: size } }));
}
function content(title, section) {
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: section });
  s.addText(title, { placeholder: "title" });
  return s;
}
const chartBase = {
  catAxisLabelFontFace: BODY, valAxisLabelFontFace: BODY, dataLabelFontFace: BODY, legendFontFace: BODY,
  catAxisLabelColor: C.muted, valAxisLabelColor: C.muted, dataLabelColor: C.ink, catAxisLabelFontSize: 12,
  valAxisLabelFontSize: 10, dataLabelFontSize: 10, legendFontSize: 11, legendColor: C.ink,
  valGridLine: { color: "E3E9EC", size: 0.5 }, catGridLine: { style: "none" }, catAxisLineShow: false,
};

// ---------------------------------------------------------------- 1. Title
pres.addSection({ title: "Opening" });
{
  const s = pres.addSlide({ masterName: "DARK", sectionTitle: "Opening" });
  s.addText("Pratirup", { placeholder: "title" });
  text(s, "A glucose digital twin for type 2 diabetes care teams", { x: 0.8, y: 3.6, w: 11.5, h: 0.6, fontSize: 24, color: "D7E9EE", fontFace: HEAD });
  text(s, "प्रतिरूप (pratirūp): counterpart, likeness", { x: 0.8, y: 4.25, w: 11.5, h: 0.4, fontSize: 15, color: "9CC3CD", italic: true });
  text(s, [
    { text: "Team Aflatoon · Scaler School of Technology, Bengaluru", options: { breakLine: true, bold: true } },
    { text: "Dhruv Sharma · Pratyush Mishra · Anushika Chauhan", options: { breakLine: true } },
    { text: "Happiest Health Digital Twin Challenge 2026" },
  ], { x: 0.8, y: 5.25, w: 11.5, h: 1.1, fontSize: 15, color: C.white });
  text(s, "Research prototype. Not a medical device. All results are retrospective, on open research data.",
    { x: 0.8, y: 6.75, w: 11.5, h: 0.35, fontSize: 11, color: "9CC3CD" });
  s.addNotes("Introduce the team and the product. Pratirup keeps a continuously updated model of each patient that combines the clinical record with the CGM stream, forecasts the next 30 to 60 minutes, warns of excursions with measured uncertainty, and scores itself against what actually happens. Say up front that it is a research prototype.");
}

// ---------------------------------------------------------------- 2. Summary
{
  const s = content("What we built and what it achieves", "Opening");
  const d60 = B.bootstrap_test["60"].lgbm_full_vs_persistence;
  const red60 = -d60.diff / T["60"].persistence.mae;
  const hyper = B.events.test.hyper.classifier.event;
  stat(s, 0.6, 1.5, 3.9, "−" + pct(red60), `60-min forecast error vs last value carried forward on 20 unseen patients (95% CI ${f2(d60.ci95[0])} to ${f2(d60.ci95[1])} mg/dL)`);
  stat(s, 4.7, 1.5, 3.9, pct(B.intervals.test["60"].personal.coverage), "of outcomes fell inside the 80% prediction interval (60 min): the stated uncertainty is honest");
  stat(s, 8.8, 1.5, 3.9, pct(hyper.sensitivity_lead30), `of rises above 180 mg/dL flagged ≥ 30 min ahead, at ${f2(hyper.false_alerts_per_day)} false alerts per patient-day`);
  text(s, bullets([
    "A per-patient twin: clinical record + CGM + medication and meal logs, updated on every reading, scoring every forecast when its outcome arrives",
    "A clinician worklist, an explainable patient view, a forecast ledger, a what-if labelled as associational, live streaming, FHIR R4 records",
    `Validated twice: held-out ShanghaiT2DM patients (scored once, locked) and an external US cohort (CGMacros): 60-min MAE ${f1(E.transfer["60"].t2d.models["lgbm[full]"].mae)} vs ${f1(E.transfer["60"].t2d.models.persistence.mae)} mg/dL in T2D`,
    "Open: code, trained models, data pipeline and the scripts that regenerate every number on these slides",
  ]), { x: 0.6, y: 4.1, w: 12.1, h: 2.7 });
  s.addNotes("This is the whole story on one slide. The three numbers are from the locked test set. Everything on the following slides supports or qualifies these claims.");
}

// ---------------------------------------------------------------- 3. Problem
pres.addSection({ title: "Problem" });
{
  const s = content("Diabetes in India is common and poorly controlled", "Problem");
  stat(s, 0.6, 1.45, 3.0, "101 M", "adults with diabetes in India (ICMR-INDIAB-17, 2023)");
  stat(s, 3.8, 1.45, 3.0, "136 M", "with prediabetes (same survey)");
  stat(s, 7.0, 1.45, 3.0, "36%", "of people with diagnosed diabetes reach HbA1c < 7% (ICMR-INDIAB-13, 2022)", C.red);
  stat(s, 10.2, 1.45, 2.6, "< 25%", "consensus target for time above 180 mg/dL (Battelino 2019)", C.amber);
  card(s, 0.6, 4.15, 5.9, 2.0, "How CGM is reviewed today",
    "CGM use is growing in India through clinic-placed and short-term sensors. Clinicians review an ambulatory glucose profile after the fact, at a visit, separately from labs, complications and the drug regimen.");
  card(s, 6.8, 4.15, 5.9, 2.0, "The gap we address",
    "Nothing in a typical review combines the record with the live stream, tells the care team who is likely to go high or low in the next hour, or shows how trustworthy such a forecast has been for this patient.");
  s.addNotes("Sources: Anjana et al., Lancet Diabetes Endocrinol 2023 and 2022; Battelino et al., Diabetes Care 2019. The ADA 2026 Standards (Rec 7.15) recommend CGM for people with T2D on insulin, and for T2D on other drugs where CGM helps management.");
}

// ---------------------------------------------------------------- 4. Landscape
{
  const s = content("Forecasting already exists. What is still missing", "Problem");
  const rows = [
    ["Product", "What it predicts", "Who sees it", "Uses clinical record?"],
    ["Dexcom G7", "Urgent low within 20 min", "Patient", "No"],
    ["Medtronic Guardian", "High / low up to 60 min", "Patient", "No"],
    ["Roche Accu-Chek SmartGuide", "Low in 30 min, 2-h trajectory, night low", "Patient", "No (CGM + logged carbs, insulin)"],
    ["LibreView, Dexcom Clarity, Glooko", "Retrospective reports", "Clinician", "No"],
    ["Pratirup", "+30 / +60 min (+120 exploratory), P(>180, >250, <70 in 60 min)", "Care team, ranked panel", "Yes, plus own error history"],
  ].map((r, i) => r.map((c, j) => ({ text: c, options: {
    bold: i === 0 || i === 5, color: i === 5 ? C.petrol : C.ink, fill: { color: i === 0 ? C.bg2 : (i === 5 ? C.soft : C.white) },
    fontSize: 13, fontFace: BODY, valign: "middle", margin: [4, 8, 4, 8] } })));
  s.addTable(rows, { x: 0.6, y: 1.45, w: 12.1, colW: [3.0, 4.2, 2.3, 2.6], border: { type: "solid", pt: 0.75, color: C.line }, rowH: 0.52 });
  text(s, "We do not claim forecasting as our novelty. What we did not find is a clinician-facing view that fuses the record, ranks a panel by imminent risk, explains each forecast and keeps a running score of its own accuracy.",
    { x: 0.6, y: 5.0, w: 12.1, h: 0.9, fontSize: 16, color: C.ink });
  text(s, "Sources: vendor documentation (Dexcom, Medtronic, Roche, Glooko), read Oct 2026. Vendor claims are not independent evidence of clinical benefit.",
    { x: 0.6, y: 6.3, w: 12.1, h: 0.4, fontSize: 11, color: C.muted });
  s.addNotes("Be explicit with the jury: Roche already ships a 2-hour forecast to patients. Our contribution is the clinician-facing twin with record fusion, triage, explanations and a self-scoring ledger.");
}

// ---------------------------------------------------------------- 5. Use case
{
  const s = content("Use case: a care team running a 14-day CGM programme", "Problem");
  const steps = [
    ["Wear", "Adult with T2D wears a CGM for 14 days; readings sync every 15 min"],
    ["Update", "The twin updates its state on every reading and logged meal or dose"],
    ["Triage", "The worklist ranks patients: low now, predicted low, predicted > 180 or > 250"],
    ["Act", "The educator reviews the forecast and its reasons, and calls the patient if needed"],
    ["Review", "At the visit, the doctor replays any moment: what the twin expected vs what happened"],
  ];
  steps.forEach(([h, b], i) => {
    const x = 0.6 + i * 2.48;
    s.addShape(pres.shapes.OVAL, { x: x + 0.85, y: 1.55, w: 0.6, h: 0.6, fill: { color: C.petrol }, line: { color: C.petrol } });
    text(s, String(i + 1), { x: x + 0.85, y: 1.55, w: 0.6, h: 0.6, fontSize: 18, bold: true, color: C.white, align: "center", valign: "middle" });
    if (i < steps.length - 1) s.addShape(pres.shapes.LINE, { x: x + 1.5, y: 1.85, w: 1.85, h: 0, line: { color: C.greyLight, width: 1.5 } });
    text(s, h, { x, y: 2.35, w: 2.3, h: 0.4, fontSize: 17, bold: true, color: C.ink, align: "center" });
    text(s, b, { x: x + 0.05, y: 2.8, w: 2.2, h: 1.6, fontSize: 13, color: C.muted, align: "center" });
  });
  card(s, 0.6, 4.75, 5.9, 2.0, "Outputs",
    "Primary: glucose at +30 and +60 min with an 80% prediction interval (+120 min exploratory). Secondary: calibrated probability of crossing 180 or 250, or falling below 70 mg/dL within 60 min (≥ 2 consecutive readings).");
  card(s, 6.8, 4.75, 5.9, 2.0, "Boundaries",
    "Clinicians make every decision. No dosing, diet or treatment advice. Whether triage improves outcomes is a hypothesis that needs a prospective study.");
  s.addNotes("Event thresholds come from the international consensus on time in range and were fixed before any model was trained.");
}

// ---------------------------------------------------------------- 6. Twin
pres.addSection({ title: "Solution" });
{
  const s = content("What makes it a twin: a state that updates on every reading", "Solution");
  const blocks = [
    ["Clinical context", "Age, BMI, duration, HbA1c, C-peptide, eGFR, complications, drug classes (FHIR R4)", "observed"],
    ["Glycaemic state", "Kalman level, rate of change and their uncertainty; grows during sensor gaps", "estimated"],
    ["Event context", "Time since meals and fast insulin, insulin on board, oral agents, pump rate", "observed"],
    ["Personal profile", "Time in range so far; what this person's glucose usually does at this hour", "estimated"],
    ["Model trust", "Running mean of this patient's own resolved forecast errors", "estimated"],
    ["Data quality", "Readings in the last 3 h, age of last reading: abstain instead of guessing", "observed"],
  ];
  blocks.forEach(([h, b, k], i) => {
    const x = 0.6 + (i % 3) * 4.07, y = 1.45 + Math.floor(i / 3) * 1.9;
    card(s, x, y, 3.87, 1.72, h, b);
    chip(s, x + 3.87 - 1.3, y + 0.2, k, k === "observed" ? C.green : C.petrol);
  });
  text(s, [
    { text: "Update loop on each reading: ", options: { bold: true, color: C.petrol } },
    { text: "validate → Kalman update → resolve forecasts whose time has come → rebuild features from the past only → forecast + interval + risk → write to ledger → re-rank worklist. The streaming twin and the evaluated replay give identical outputs (parity test)." },
  ], { x: 0.6, y: 5.45, w: 12.1, h: 1.2, fontSize: 15 });
  s.addNotes("A dashboard with a model computes a score once. The twin keeps state, updates it every 15 minutes, and learns how wrong it has been for this specific patient. The parity test in the repo checks that the streaming implementation reproduces the benchmarked one exactly.");
}

// ---------------------------------------------------------------- 7. Architecture
{
  const s = content("Architecture (as built)", "Solution");
  const png = fs.readFileSync(path.join(ROOT, "docs", "architecture.png"));
  const aspect = png.readUInt32BE(16) / png.readUInt32BE(20);
  let iw = 12.1, ih = iw / aspect;
  if (ih > 5.65) { ih = 5.65; iw = ih * aspect; }
  s.addImage({ path: path.join(ROOT, "docs", "architecture.png"), x: (13.333 - iw) / 2, y: 1.25, w: iw, h: ih });
  s.addNotes("Static stream: the de-identified clinical record as FHIR R4. Dynamic stream: real CGM and timed logs, replayed or streamed. The engine holds the state; FastAPI and SQLite persist it; the React app is the clinician interface. Evaluation and CGMacros external validation are offline.");
}

// ---------------------------------------------------------------- 8. Data
{
  const s = content("Data: the two streams belong to the same patients", "Solution");
  card(s, 0.6, 1.45, 5.95, 2.0, "ShanghaiT2DM: train, test and demo",
    "100 adults with T2D, 109 recordings of 3–14 days. Libre H CGM every 15 min (112,462 readings). Linked clinical record (33 fields) plus timed insulin, oral-agent, pump and diet logs. Zhao et al., Scientific Data 2023. CC BY 4.0.", C.soft);
  card(s, 6.75, 1.45, 5.95, 2.0, "CGMacros: external validation only",
    "45 US adults (15 healthy, 16 prediabetes, 14 T2D), Libre Pro, Fitbit heart rate and activity, meal times. Free-living. Das et al., Scientific Data 2025 (PhysioNet). CC BY-NC-SA 4.0, not redistributed.");
  text(s, "Rejected", { x: 0.6, y: 3.85, w: 5, h: 0.4, fontSize: 16, bold: true, color: C.red });
  text(s, bullets([
    "Synthea + an unrelated CGM dataset: records and readings would belong to different people",
    "UCI Diabetes #34: type 1 diabetes, finger-prick readings, around 1991",
    "AI-READI: no redistribution right; fully synthetic physiology: tests only our own assumptions",
  ], 15), { x: 0.6, y: 4.35, w: 6.0, h: 2.4 });
  text(s, "Honest gaps", { x: 6.75, y: 3.85, w: 5, h: 0.4, fontSize: 16, bold: true, color: C.amber });
  text(s, bullets([
    "No open Indian CGM dataset exists: Chinese hospital cohort, partly in-hospital",
    "No genetic markers anywhere: shown as 'not recorded', never invented",
    "Diet is food weight, not nutrients (carbohydrate-dense-weight heuristic)",
  ], 15), { x: 6.75, y: 4.35, w: 5.95, h: 2.4 });
  s.addNotes("The brief allows simulated EHRs, but a real linked record is stronger evidence of fusion than a synthetic record joined to a stranger's CGM.");
}

// ---------------------------------------------------------------- 9. Protocol
pres.addSection({ title: "Evidence" });
{
  const s = content("Models and an evaluation protocol fixed before testing", "Evidence");
  card(s, 0.6, 1.45, 5.95, 5.25, "Compared models",
    "Last value carried forward (persistence)\nKalman damped trend\nLinear autoregression (ridge)\nGRU sequence network (tuned on development data)\nLightGBM ladder: CGM → + logs → + clinical record → + personal history = Pratirup\nPratirup + online self-correction\nAverage of LightGBM and GRU (reported, not deployed)\n\nServed: LightGBM. It ties the GRU and gives exact per-feature attributions, conformal intervals and fast CPU inference.");
  const steps = [
    ["Patient-level split", "80 development patients (5 folds, stratified by insulin) and 20 test patients"],
    ["Every choice on development data", "Kalman, hyperparameters, GRU, conformal adjustment, calibration, alert thresholds"],
    ["No leakage", "Early stopping on held-out dev patients; a test proves features use only the past"],
    ["Test scored once", "Locked file records when; reruns need a logged reason"],
    ["Uncertainty of results", "Patient-level bootstrap 95% CIs for every comparison"],
  ];
  steps.forEach(([h, b], i) => {
    const y = 1.5 + i * 1.04;
    s.addShape(pres.shapes.OVAL, { x: 6.85, y: y + 0.05, w: 0.42, h: 0.42, fill: { color: C.petrol }, line: { color: C.petrol } });
    text(s, String(i + 1), { x: 6.85, y: y + 0.05, w: 0.42, h: 0.42, fontSize: 13, bold: true, color: C.white, align: "center", valign: "middle" });
    text(s, h, { x: 7.45, y, w: 5.25, h: 0.35, fontSize: 15, bold: true });
    text(s, b, { x: 7.45, y: y + 0.38, w: 5.25, h: 0.6, fontSize: 12.5, color: C.muted });
  });
  s.addNotes("This protocol is what makes the numbers believable. Nothing was tuned on the test patients.");
}

// ---------------------------------------------------------------- 10. Forecast results
{
  const s = content("Forecast accuracy on 20 unseen patients", "Evidence");
  const H = ["30", "60", "120"];
  const series = [
    ["Last value carried forward", "persistence"], ["Linear autoregression", "ridge_ar"], ["GRU sequence network", "gru_seq"], ["Pratirup", "lgbm[full]"],
  ].map(([name, k]) => ({ name, labels: ["+30 min", "+60 min", "+120 min (exploratory)"], values: H.map((h) => +T[h][k].mae.toFixed(1)) }));
  s.addChart(pres.charts.BAR, series, {
    x: 0.6, y: 1.35, w: 7.6, h: 5.4, barDir: "col", barGrouping: "clustered", barGapWidthPct: 60,
    chartColors: [C.grey, C.greyLight, C.gold, C.petrol], showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "0.0",
    showLegend: true, legendPos: "b", showTitle: true, title: "Mean absolute error, mg/dL (lower is better)", titleFontSize: 13,
    titleColor: C.ink, titleFontFace: BODY, valAxisMinVal: 0, ...chartBase,
  });
  const b = B.bootstrap_test;
  text(s, "vs last value carried forward", { x: 8.6, y: 1.45, w: 4.1, h: 0.4, fontSize: 15, bold: true, color: C.petrol });
  text(s, H.map((h, i) => ({ text: `+${h} min: ${f2(b[h].lgbm_full_vs_persistence.diff)} mg/dL (95% CI ${f2(b[h].lgbm_full_vs_persistence.ci95[0])} to ${f2(b[h].lgbm_full_vs_persistence.ci95[1])})`,
    options: { breakLine: i < 2, paraSpaceAfter: 6 } })), { x: 8.6, y: 1.9, w: 4.1, h: 1.5, fontSize: 13.5 });
  text(s, "Clinical safety", { x: 8.6, y: 3.55, w: 4.1, h: 0.4, fontSize: 15, bold: true, color: C.petrol });
  text(s, `Parkes type-2 error grid, zones A+B: ${f1(T["30"]["lgbm[full]"].parkes["A+B"])}% / ${f1(T["60"]["lgbm[full]"].parkes["A+B"])}% / ${f1(T["120"]["lgbm[full]"].parkes["A+B"])}% at 30 / 60 / 120 min`,
    { x: 8.6, y: 4.0, w: 4.1, h: 0.9, fontSize: 13.5 });
  text(s, "GRU vs Pratirup", { x: 8.6, y: 5.0, w: 4.1, h: 0.4, fontSize: 15, bold: true, color: C.petrol });
  text(s, `No measurable difference at 60 min: ${f2(b["60"].lgbm_full_vs_gru_seq.diff)} mg/dL (95% CI ${f2(b["60"].lgbm_full_vs_gru_seq.ci95[0])} to ${f2(b["60"].lgbm_full_vs_gru_seq.ci95[1])}). We serve the model we can explain.`,
    { x: 8.6, y: 5.45, w: 4.1, h: 1.3, fontSize: 13.5 });
  s.addNotes("Negative differences mean Pratirup is better. The 120-minute horizon answers the brief's '2 hours in advance' example directly: it is better than the baselines, but its error is large, so we keep it exploratory.");
}

// ---------------------------------------------------------------- 11. Ablation
{
  const s = content("What each data stream adds, including what did not help", "Evidence");
  const ladder = [["CGM only", "lgbm[cgm]"], ["+ meal and drug logs", "lgbm[cgm+events]"], ["+ clinical record", "lgbm[cgm+events+ehr]"],
    ["+ personal history", "lgbm[full]"], ["+ online self-correction", "lgbm[full]+personal"]];
  s.addChart(pres.charts.BAR, [{ name: "60-min MAE", labels: ladder.map((l) => l[0]), values: ladder.map((l) => +T["60"][l[1]].mae.toFixed(2)) }], {
    x: 0.6, y: 1.35, w: 7.2, h: 5.4, barDir: "col", chartColors: [C.teal, C.teal, C.teal, C.petrol, C.petrol], showValue: true,
    dataLabelPosition: "outEnd", dataLabelFormatCode: "0.00", showLegend: false, showTitle: true, title: "60-min MAE, mg/dL, held-out patients",
    titleFontSize: 13, titleColor: C.ink, titleFontFace: BODY, valAxisMinVal: 13, valAxisMaxVal: 16.5, ...chartBase,
  });
  card(s, 8.15, 1.45, 4.55, 2.35, "Helped most: the patient's own history",
    "What this person's glucose usually does at this time of day, learned from their previous days. That is the twin's personal state at work.", C.soft);
  card(s, 8.15, 4.0, 4.55, 2.75, "Did not help measurably",
    `Clinical-record fields beyond CGM and logs; online self-correction (${f2(B.bootstrap_test["60"].lgbm_full_personal_vs_lgbm_full.diff)} mg/dL, CI crosses 0); Fitbit heart rate and activity in CGMacros (${f2(E.wearables["60"].bootstrap_wearable_minus_cgm.diff)} mg/dL, CI crosses 0). We report this rather than hide it.`);
  s.addNotes("The y-axis starts at 13 mg/dL so the differences are visible; the values are labelled. The record still drives triage, display and subgroup context, but it did not improve short-horizon accuracy here.");
}

// ---------------------------------------------------------------- 12. Uncertainty
{
  const s = content("Honest uncertainty: the 80% band holds about 80% of the time", "Evidence");
  ["30", "60", "120"].forEach((h, i) => {
    stat(s, 0.6 + i * 4.1, 1.5, 3.8, pct(B.intervals.test[h].personal.coverage, 1), `of outcomes inside the 80% interval at +${h} min (mean width ${f1(B.intervals.test[h].personal.mean_width)} mg/dL)`);
  });
  card(s, 0.6, 4.1, 5.9, 1.95, "How the interval is built",
    "Quantile models give a raw band; conformal calibration on out-of-fold predictions from development patients widens it just enough to reach 80%. The test patients were never used.", C.soft);
  card(s, 6.8, 4.1, 5.9, 1.95, "Why it matters clinically",
    `A care team can trust the band, not just the line. It held on CGMacros too: ${pct(E.transfer["60"].t2d.interval_coverage)} in T2D, ${pct(E.transfer["60"].prediabetes.interval_coverage)} in prediabetes. Under heavy sensor noise coverage falls (${pct(B.robustness_test.noise10.coverage_60)} at ±10 mg/dL), a known limitation.`);
  s.addNotes("Coverage is the share of real outcomes that fell inside the stated 80% interval on unseen patients. Close to 80% means the uncertainty shown on screen is honest.");
}

// ---------------------------------------------------------------- 12b. Alerts
{
  const s = content("Early warning: more episodes caught, earlier", "Evidence");
  const rows = [["Event within 60 min", "Scorer", "Episodes", "Sensitivity", "≥ 30 min warning", "PPV", "False alerts / patient-day", "AUPRC (prevalence)"]];
  [["hyper", "Rise above 180 mg/dL"], ["hyper2", "Rise above 250 mg/dL"], ["hypo", "Fall below 70 mg/dL"]].forEach(([k, label]) => {
    [["classifier", "Pratirup"], ["trend_rule", "Rate-of-change rule"]].forEach(([sc, scl], j) => {
      const v = B.events.test[k][sc], e = v.event;
      rows.push([j === 0 ? label : "", scl, j === 0 ? String(e.episodes) : "", pct(e.sensitivity, 1), pct(e.sensitivity_lead30, 1), pct(e.ppv, 1),
        f2(e.false_alerts_per_day), `${v.sample.auprc.toFixed(2)} (${v.sample.prevalence.toFixed(3)})`]);
    });
  });
  const cells = rows.map((r, i) => r.map((c) => ({ text: c, options: { bold: i === 0, fontSize: 13, fontFace: BODY,
    color: i > 0 && i % 2 === 1 ? C.petrol : C.ink, fill: { color: i === 0 ? C.bg2 : (i % 2 === 1 ? C.white : "FAFBFC") },
    margin: [3, 6, 3, 6], valign: "middle" } })));
  s.addTable(cells, { x: 0.6, y: 1.45, w: 12.1, colW: [2.3, 2.0, 1.0, 1.3, 1.45, 0.9, 1.55, 1.6], border: { type: "solid", pt: 0.75, color: C.line }, rowH: 0.45 });
  text(s, `Thresholds were set on development patients for ≤ 2 false alerts per patient-day, with a 60-min cooldown. On test patients the low-glucose alert overshot (${f2(B.events.test.hypo.classifier.event.false_alerts_per_day)} per day), and the three alert types together produce ${f1(B.alert_burden_test.total_alerts_per_day)} alerts per patient-day: too many for routine use. Next step: one merged alert stream with a shared cooldown, and budgets set with clinicians.`,
    { x: 0.6, y: 5.0, w: 12.1, h: 1.4, fontSize: 15, color: C.ink });
  s.addNotes("Sensitivity is per episode. The ≥ 30 min column is the clinically useful one: many detections otherwise come only 15 minutes ahead. AUPRC should be compared with prevalence, which is the score of a random ranking.");
}

// ---------------------------------------------------------------- 13. External
{
  const s = content("It transfers: external validation on a US cohort", "Evidence");
  const groups = [["T2D", "t2d"], ["Prediabetes", "prediabetes"], ["Healthy", "healthy"]];
  s.addChart(pres.charts.BAR, [
    { name: "Last value carried forward", labels: groups.map((g) => g[0]), values: groups.map((g) => +E.transfer["60"][g[1]].models.persistence.mae.toFixed(1)) },
    { name: "Pratirup (frozen, trained in Shanghai)", labels: groups.map((g) => g[0]), values: groups.map((g) => +E.transfer["60"][g[1]].models["lgbm[full]"].mae.toFixed(1)) },
  ], {
    x: 0.6, y: 1.35, w: 7.2, h: 5.4, barDir: "col", barGrouping: "clustered", chartColors: [C.grey, C.petrol], showValue: true,
    dataLabelPosition: "outEnd", dataLabelFormatCode: "0.0", showLegend: true, legendPos: "b", showTitle: true,
    title: "CGMacros, 60-min MAE, mg/dL", titleFontSize: 13, titleColor: C.ink, titleFontFace: BODY, valAxisMinVal: 0, ...chartBase,
  });
  const t2 = E.hyper_alerts.t2d.event;
  card(s, 8.15, 1.45, 4.55, 2.5, "Different country, sensor and setting",
    `Free-living US adults, Libre Pro, no refitting. Interval coverage stays at ${pct(E.transfer["60"].t2d.interval_coverage)} in T2D. Rise-above-180 alerts in T2D: ${pct(t2.sensitivity, 1)} sensitivity, ${pct(t2.ppv)} PPV, ${f2(t2.false_alerts_per_day)} false alerts per day.`, C.soft);
  card(s, 8.15, 4.15, 4.55, 2.6, "Where it does not help",
    "In healthy participants the gain over last value is close to zero: expected for a model trained on T2D. Medications and most labs are missing in CGMacros and were passed as missing, never as zero.");
  s.addNotes("The model was frozen; CGMacros was never used to train or tune it. CGMacros is CC BY-NC-SA and is downloaded by script, not redistributed.");
}

// ---------------------------------------------------------------- 14. Product
pres.addSection({ title: "Product" });
{
  const s = content("The product: what a care team sees", "Product");
  const shots = [["worklist.png", "Worklist: panel ranked by consensus targets and predicted risk"],
                 ["twin.png", "Patient twin: forecast band, past forecasts vs reality, drivers"]];
  const have = shots.filter(([f]) => fs.existsSync(path.join(SHOTS, f)));
  if (have.length === 2) {
    have.forEach(([f, cap], i) => {
      const x = 0.6 + i * 6.15;
      s.addImage({ path: path.join(SHOTS, f), x, y: 1.4, w: 5.95, h: 3.72 });
      s.addShape(pres.shapes.RECTANGLE, { x, y: 1.4, w: 5.95, h: 3.72, fill: { type: "none" }, line: { color: C.line, width: 0.75 } });
      text(s, cap, { x, y: 5.2, w: 5.95, h: 0.5, fontSize: 13, color: C.muted });
    });
  } else {
    text(s, "Screenshots are added by docs/capture_screenshots.py after the web app is built.", { x: 0.6, y: 3.2, w: 12, h: 0.6, fontSize: 16, color: C.muted });
  }
  let x = 0.6;
  for (const [label, color] of [["Research record", C.green], ["Replayed CGM", C.green], ["Model forecast", C.petrol], ["Sensitivity · not causal", C.amber], ["LIVE stream", C.petrol]]) {
    x += chip(s, x, 6.05, label, color) + 0.2;
  }
  text(s, "Also: forecast ledger · what-if · FHIR R4 record · live streaming · evidence page", { x: 0.6, y: 6.5, w: 12.1, h: 0.35, fontSize: 12.5, color: C.muted });
  s.addNotes("Show the live demo here. Every value on screen carries its provenance: research record, replayed CGM, model forecast, sensitivity, or live stream.");
}

// ---------------------------------------------------------------- 15. Limitations
{
  const s = content("Limitations we want the jury to know", "Product");
  const items = [
    ["Population", "Chinese hospital cohort, 2019–2021, partly in-hospital with regular meal times. Not Indian. External check covers the US, not India."],
    ["Size", "100 patients, 3–14 days each; 20 test patients. Hence bootstrap CIs on every claim."],
    ["Alert load", `${f1(B.alert_burden_test.total_alerts_per_day)} alerts per patient-day across three types; low-glucose alert above its false-alert budget.`],
    ["Sensor noise", `With ±10 mg/dL random noise added, the 30-min forecast is worse than last value (${f1(B.robustness_test.noise10.mae_30_lgbm)} vs ${f1(B.robustness_test.noise10.mae_30_persistence)}). Libre output is pre-smoothed; noisier devices need noise-augmented training.`],
    ["Causality", "The what-if shows model sensitivity, not the effect of eating or dosing."],
    ["Evidence level", "Retrospective only. No prospective, real-time or outcome study."],
  ];
  items.forEach(([h, b], i) => {
    const x = 0.6 + (i % 2) * 6.15, y = 1.45 + Math.floor(i / 2) * 1.8;
    card(s, x, y, 5.95, 1.62, h, b);
  });
  s.addNotes("Saying this ourselves is part of the pitch: every limitation here was found by our own tests.");
}

// ---------------------------------------------------------------- 16. Real world
{
  const s = content("Path to a real product", "Product");
  card(s, 0.6, 1.45, 3.9, 2.6, "Who would use and buy it (to validate)",
    "Diabetes clinic chains and digital-therapeutics programmes already running connected-CGM coaching. Value: triage of coach and educator time. Willingness to pay is untested.");
  card(s, 4.72, 1.45, 3.9, 2.6, "What a buyer would require",
    "Validation on Indian patients and diets, a prospective pilot with outcome measures, integration with sensor clouds and the clinic EHR (ABDM FHIR).");
  card(s, 8.84, 1.45, 3.86, 2.6, "Regulation and privacy",
    "Likely software as a medical device under India's Medical Devices Rules 2017 (CDSCO draft guidance, Oct 2025). Real data falls under the DPDP Act 2023 and Rules 2025.");
  text(s, "Next steps", { x: 0.6, y: 4.35, w: 6, h: 0.4, fontSize: 17, bold: true, color: C.petrol });
  text(s, bullets([
    "Merge the three alert types into one stream with a shared cooldown; set budgets with clinicians",
    "Noise-augmented training and a noise detector that widens intervals or abstains",
    "A prospective, observation-only pilot with an Indian diabetes clinic (forecasts hidden from care until validated)",
    "Interoperability: CGM vendor APIs and ABDM-compliant FHIR exchange",
  ], 14), { x: 0.6, y: 4.8, w: 12.1, h: 2.0 });
  s.addNotes("Customer demand and willingness to pay are hypotheses. The next step is evidence, not scale.");
}

// ---------------------------------------------------------------- 17. Close
{
  const s = pres.addSlide({ masterName: "DARK", sectionTitle: "Product" });
  s.addText("Thank you", { placeholder: "title" });
  text(s, "Everything shown is in the public repository: code, trained models, the locked test results and the scripts that regenerate every number.",
    { x: 0.8, y: 3.7, w: 11.5, h: 0.9, fontSize: 18, color: "D7E9EE" });
  text(s, "github.com/Spiritsfuse/pratirup", { x: 0.8, y: 4.75, w: 11.5, h: 0.5, fontSize: 20, bold: true, color: C.white, fontFace: HEAD });
  text(s, "Team Aflatoon · Dhruv Sharma · Pratyush Mishra · Anushika Chauhan · Scaler School of Technology, Bengaluru",
    { x: 0.8, y: 5.6, w: 11.5, h: 0.4, fontSize: 14, color: "9CC3CD" });
  s.addNotes("Invite questions on the protocol, the twin state, or the limitations.");
}

pres.writeFile({ fileName: path.join(ROOT, "docs", "Pratirup_Presentation.pptx") }).then((f) => console.log("wrote", f));
