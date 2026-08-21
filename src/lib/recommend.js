/* ==========================================================
   SmartPath — local recommendation engine

   Scores the eight questionnaire answers against the five Senior High
   School strands and a catalogue of careers. Pure arithmetic in the
   browser: no network, no model, no key, and the same answers always
   produce the same result.

   The shape of the scoring is deliberate:

   - Absolute interest alone is not enough. A student who rates everything
     5 would "fit" every strand, which tells them nothing. So each score
     blends how strongly they rated the traits a strand needs (absolute)
     with how much they favoured those traits over their own average
     (relative). The second half is what separates a real preference from
     general enthusiasm.

   - GAS is scored differently on purpose. It is the strand for students
     who have not narrowed down yet, so it rewards an even spread rather
     than a peak — the flatter and more uniformly interested the answers,
     the better GAS fits. Scoring it with trait weights like the others
     would make it a weak copy of whatever strand was nearest.

   Every number a student sees can be traced back to answers they gave,
   which is what makes the explanations honest rather than decorative.

   Two things sit on top of that base model:

   - An adjustment layer. The weights below are the starting model, never
     mutated. A student's feedback ("this fits me", "not for me") is stored
     as deltas against them, so the base is always visible beside the
     adjusted value and can be reset in one click.

   - A trace. Every score returned carries the arithmetic that produced it —
     each trait's rating, its weight, its contribution, the subtotals and
     the formula — so the result can be checked by hand rather than taken on
     trust. `verifyTrace` re-adds the trace and confirms it reproduces the
     score, which keeps the explanation honest as the code changes.
   ========================================================== */

export const TRAITS = [
  { key: "math_interest", label: "Math" },
  { key: "science_interest", label: "Science" },
  { key: "business_interest", label: "Business" },
  { key: "communication_interest", label: "Communication" },
  { key: "technology_interest", label: "Technology" },
  { key: "creative_interest", label: "Creative work" },
  { key: "hands_on_interest", label: "Hands-on work" },
];

export const TRAIT_KEYS = TRAITS.map((t) => t.key);
const LABEL = Object.fromEntries(TRAITS.map((t) => [t.key, t.label]));

/* The eighth question. Each activity nudges the strands it genuinely
   signals — a nudge, not a verdict, so one dropdown cannot outvote seven
   considered ratings. */
export const ACTIVITIES = [
  { value: "solving_math_problems", label: "Solving math problems",
    bonus: { STEM: 1, ABM: 0.35 } },
  { value: "doing_science_experiments", label: "Doing science experiments",
    bonus: { STEM: 1 } },
  { value: "running_a_business", label: "Running a small business",
    bonus: { ABM: 1, TVL: 0.3 } },
  { value: "public_speaking", label: "Speaking or presenting",
    bonus: { HUMSS: 1, ABM: 0.4 } },
  { value: "working_with_computers", label: "Working with computers",
    bonus: { STEM: 0.7, TVL: 0.7 } },
  { value: "drawing_or_designing", label: "Drawing or designing",
    bonus: { HUMSS: 0.6, TVL: 0.6 } },
  { value: "building_or_repairing", label: "Building or repairing things",
    bonus: { TVL: 1 } },
];

export const ACTIVITY_VALUES = ACTIVITIES.map((a) => a.value);
const ACTIVITY_BY_VALUE = Object.fromEntries(ACTIVITIES.map((a) => [a.value, a]));

/* How much each strand leans on each trait. Zero means the strand does not
   ask for that trait, not that it is unwelcome. */
export const STRANDS = [
  {
    id: "STEM",
    name: "STEM",
    full: "Science, Technology, Engineering and Mathematics",
    blurb: "Built on problem-solving with numbers, experiments and systems.",
    weights: { math_interest: 3, science_interest: 3, technology_interest: 2, hands_on_interest: 1 },
  },
  {
    id: "ABM",
    name: "ABM",
    full: "Accountancy, Business and Management",
    blurb: "Money, markets and running things — analytical, but people-facing.",
    weights: { business_interest: 3, communication_interest: 2, math_interest: 2, technology_interest: 0.5 },
  },
  {
    id: "HUMSS",
    name: "HUMSS",
    full: "Humanities and Social Sciences",
    blurb: "Language, people and ideas — writing, teaching, law, social work.",
    weights: { communication_interest: 3, creative_interest: 2, business_interest: 0.75, science_interest: 0.5 },
  },
  {
    id: "TVL",
    name: "TVL",
    full: "Technical-Vocational-Livelihood",
    blurb: "A trade you can work in straight out of Grade 12.",
    weights: { hands_on_interest: 3, technology_interest: 2, creative_interest: 1.5, business_interest: 1 },
  },
  {
    id: "GAS",
    name: "GAS",
    full: "General Academic Strand",
    blurb: "Keeps your options open while you decide.",
    /* scored by evenness — see gasScore below */
    weights: null,
  },
];

const STRAND_BY_ID = Object.fromEntries(STRANDS.map((s) => [s.id, s]));

/* ---------------- the adjustment layer ----------------

   Feedback never overwrites the model above. It accumulates deltas here,
   which are added to the base weights at scoring time. That keeps three
   things true at once: the starting model stays inspectable, any adjusted
   weight can be shown as "3.0 -> 3.4 (+0.4 from your feedback)", and
   resetting is deleting the deltas rather than rebuilding anything. */

/* How far one piece of feedback may move a weight. Small on purpose: a
   student should see the ranking respond, not lurch. */
export const LEARNING_RATE = 0.35;

/* A weight may drift to at most double its base plus one, and never below
   zero, so no amount of clicking can make a trait dominate or vanish. */
function boundWeight(base, adjusted) {
  const ceiling = base * 2 + 1;
  return adjusted < 0 ? 0 : adjusted > ceiling ? ceiling : adjusted;
}

/* A per-career nudge, for when the traits look right but the student still
   says no. Deliberately small: the weights are what the explanation is built
   on, so a bias large enough to reorder the list on its own would make the
   maths panel misleading. One click is worth about a point and a half. */
const BIAS_STEP = 0.015;
const MAX_BIAS = 0.08;

export function emptyAdjustments() {
  return { strandWeights: {}, careerWeights: {}, careerBias: {}, history: [] };
}

function safeAdjustments(adj) {
  const base = emptyAdjustments();
  if (!adj || typeof adj !== "object") return base;
  return {
    strandWeights: adj.strandWeights || {},
    careerWeights: adj.careerWeights || {},
    careerBias: adj.careerBias || {},
    history: Array.isArray(adj.history) ? adj.history : [],
  };
}

/* Base weights plus this student's deltas, with the base kept alongside so
   the explanation can show both. */
function effectiveWeights(baseWeights, deltas) {
  const out = {};
  const keys = new Set([...Object.keys(baseWeights || {}), ...Object.keys(deltas || {})]);
  for (const key of keys) {
    const base = baseWeights[key] || 0;
    const delta = (deltas && deltas[key]) || 0;
    out[key] = { base, delta, value: boundWeight(base, base + delta) };
  }
  return out;
}

const plainWeights = (eff) => Object.fromEntries(Object.entries(eff).map(([k, v]) => [k, v.value]));

/* Learning rule.

   A student who says a career fits is telling us the traits that career
   leans on matter more to them than the base model assumed — and the
   evidence is strongest for the traits they themselves rated highly. So each
   weight moves by rate x signal x their own rating for that trait, scaled by
   how much the career leans on it. Saying "not for me" moves the same
   weights the other way.

   The career's strand gets half the same movement, because endorsing a
   career is partial evidence about the family it belongs to, not proof.

   Nothing here is random and nothing depends on other students: the same
   answers and the same feedback always produce the same weights. */
export function applyFeedback(adjustments, feedback) {
  const next = safeAdjustments(adjustments);
  const { kind, id, signal, answers } = feedback || {};
  if (!id || (signal !== 1 && signal !== -1)) return next;

  const r01 = normalise(answers);
  const bump = (bucket, key, trait, amount) => {
    bucket[key] = bucket[key] || {};
    bucket[key][trait] = (bucket[key][trait] || 0) + amount;
  };

  if (kind === "career") {
    const career = CAREERS.find((c) => c.title === id);
    if (!career) return next;
    const peak = Math.max(...Object.values(career.weights));
    for (const [trait, w] of Object.entries(career.weights)) {
      const step = LEARNING_RATE * signal * r01[trait] * (w / peak);
      bump(next.careerWeights, id, trait, step);
      bump(next.strandWeights, career.strand, trait, step * 0.5);
    }
    const bias = (next.careerBias[id] || 0) + BIAS_STEP * signal;
    next.careerBias[id] = Math.max(-MAX_BIAS, Math.min(MAX_BIAS, bias));
  } else if (kind === "strand") {
    const strand = STRAND_BY_ID[id];
    if (!strand || !strand.weights) return next;
    const peak = Math.max(...Object.values(strand.weights));
    for (const [trait, w] of Object.entries(strand.weights)) {
      bump(next.strandWeights, id, trait, LEARNING_RATE * signal * r01[trait] * (w / peak));
    }
  } else {
    return next;
  }

  next.history = next.history.concat([{
    at: new Date().toISOString(),
    kind,
    id,
    signal,
    answers: Object.fromEntries(TRAIT_KEYS.map((k) => [k, answers && answers[k]])),
  }]).slice(-50);

  return next;
}

/* How much this student's feedback has moved things, for the UI to show. */
export function adjustmentSummary(adjustments) {
  const adj = safeAdjustments(adjustments);
  const rows = [];
  for (const [strandId, deltas] of Object.entries(adj.strandWeights)) {
    const strand = STRAND_BY_ID[strandId];
    if (!strand || !strand.weights) continue;
    for (const [trait, delta] of Object.entries(deltas)) {
      const base = strand.weights[trait] || 0;
      const value = boundWeight(base, base + delta);
      if (Math.abs(value - base) >= 0.005) {
        rows.push({ scope: strandId, trait, label: LABEL[trait], base, value, delta: value - base });
      }
    }
  }
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { rows, count: adj.history.length, history: adj.history };
}

/* ---------------- scoring primitives ---------------- */

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/* Ratings arrive 1-5; everything downstream works in 0-1. */
function normalise(answers) {
  const out = {};
  for (const key of TRAIT_KEYS) {
    const raw = Number(answers && answers[key]);
    const safe = Number.isFinite(raw) ? Math.min(5, Math.max(1, raw)) : 3;
    out[key] = (safe - 1) / 4;
  }
  return out;
}

const mean = (nums) => nums.reduce((a, b) => a + b, 0) / (nums.length || 1);

function stdev(nums) {
  const m = mean(nums);
  return Math.sqrt(mean(nums.map((n) => (n - m) ** 2)));
}

/* One strand's fit, and the per-trait contributions behind it.

   absolute  — how highly they rated the traits this strand wants
   relative  — how far those traits sit above their own average, which is
               what distinguishes a preference from blanket enthusiasm */
const ABS_SHARE = 0.65;
const REL_SHARE = 0.35;

function weightedScore(r01, effective) {
  const avg = mean(TRAIT_KEYS.map((k) => r01[k]));
  const entries = Object.entries(effective);
  const total = entries.reduce((sum, [, w]) => sum + w.value, 0) || 1;

  let absolute = 0;
  let relative = 0;
  const parts = [];

  for (const [key, w] of entries) {
    absolute += w.value * r01[key];
    relative += w.value * (r01[key] - avg);
    parts.push({
      key,
      label: LABEL[key],
      rating: Math.round(r01[key] * 4) + 1,
      value: r01[key],
      baseWeight: w.base,
      weight: w.value,
      adjusted: Math.abs(w.value - w.base) >= 0.005,
      contribution: w.value * r01[key],
      share: (w.value * r01[key]) / total,
    });
  }

  absolute /= total;
  relative /= total;

  parts.sort((a, b) => b.share - a.share);
  const score = clamp01(ABS_SHARE * absolute + REL_SHARE * (0.5 + relative));

  return {
    score,
    parts,
    absolute,
    relative,
    trace: {
      kind: "weighted",
      rows: parts,
      totalWeight: total,
      studentAverage: avg,
      absolute,
      relative,
      blended: ABS_SHARE * absolute + REL_SHARE * (0.5 + relative),
      formula: "(" + ABS_SHARE + " x absolute) + (" + REL_SHARE + " x (0.5 + relative))",
    },
  };
}

/* GAS rewards a level profile: broadly interested, nothing dominating. */
const GAS_AVG_SHARE = 0.45;
const GAS_EVEN_SHARE = 0.55;
const GAS_SPREAD_REFERENCE = 0.4;

function gasScore(r01) {
  const values = TRAIT_KEYS.map((k) => r01[k]);
  const avg = mean(values);
  const spread = stdev(values);
  /* 0.40 is roughly the spread of a strongly specialised profile */
  const evenness = clamp01(1 - spread / GAS_SPREAD_REFERENCE);
  const blended = GAS_AVG_SHARE * avg + GAS_EVEN_SHARE * evenness;

  return {
    score: clamp01(blended),
    evenness,
    avg,
    spread,
    parts: [],
    trace: {
      kind: "evenness",
      rows: TRAIT_KEYS.map((k) => ({
        key: k, label: LABEL[k], rating: Math.round(r01[k] * 4) + 1, value: r01[k],
      })),
      average: avg,
      spread,
      spreadReference: GAS_SPREAD_REFERENCE,
      evenness,
      blended,
      formula: "(" + GAS_AVG_SHARE + " x average) + (" + GAS_EVEN_SHARE +
        " x evenness), where evenness = 1 - (spread / " + GAS_SPREAD_REFERENCE + ")",
    },
  };
}

const pct = (score) => Math.round(score * 100);

/* ---------------- explanations ---------------- */

const RATING_WORD = ["Not at all", "A little", "Somewhat", "A lot", "Very much"];
const toFive = (v) => Math.round(v * 4) + 1;

function listPhrase(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return items[0] + " and " + items[1];
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

function explainStrand(strand, detail, r01, activity) {
  if (strand.id === "GAS") {
    const evenPct = Math.round(detail.evenness * 100);
    if (detail.evenness > 0.6) {
      return "Your ratings are spread evenly rather than pointing at one subject (" + evenPct +
        "% even), which is exactly who GAS is for — it keeps every door open while you decide.";
    }
    return "Your answers already lean in a clear direction, so GAS scores lower — it suits students " +
      "who are still weighing several paths.";
  }

  /* Name the traits that actually moved the number, using the student's own
     answers rather than a generic description of the strand. */
  const drivers = detail.parts
    .filter((p) => p.weight > 0 && p.value >= 0.5)
    .slice(0, 3)
    .map((p) => p.label + " (" + RATING_WORD[toFive(p.value) - 1].toLowerCase() + ")");

  const dampers = detail.parts
    .filter((p) => p.weight >= 2 && p.value <= 0.25)
    .slice(0, 2)
    .map((p) => p.label);

  let text;
  if (drivers.length) {
    text = "You rated " + listPhrase(drivers) + ", and those carry the most weight for " + strand.name + ".";
  } else {
    text = strand.name + " leans on " +
      listPhrase(detail.parts.slice(0, 2).map((p) => p.label.toLowerCase())) +
      ", which you rated low.";
  }

  if (dampers.length) {
    text += " " + listPhrase(dampers) + " matters here too, and that one you rated low.";
  }

  const act = activity && ACTIVITY_BY_VALUE[activity];
  if (act && act.bonus[strand.id] >= 0.6) {
    text += " Choosing “" + act.label.toLowerCase() + "” points the same way.";
  }

  return text;
}

/* ---------------- careers ---------------- */

/* Each career names the traits the work actually uses, the strand it sits
   under, and the route into it. `route` drives the existing filter:
   degree = a four-year course, short = TESDA or a certificate, work = you
   can start and learn on the job. */
export const CAREERS = [
  { title: "Civil Engineer", strand: "STEM", route: "degree",
    weights: { math_interest: 3, science_interest: 2, hands_on_interest: 2, technology_interest: 1 },
    courses: ["BS Civil Engineering"],
    skills: ["Technical drawing", "AutoCAD", "Physics fundamentals"],
    firstJobs: ["Site engineer", "CAD draftsman"],
    note: "Designing and checking structures — heavy on maths you can see standing up." },
  { title: "Software Developer", strand: "STEM", route: "degree",
    weights: { technology_interest: 3, math_interest: 2, creative_interest: 1 },
    courses: ["BS Computer Science", "BS Information Technology"],
    skills: ["Python or JavaScript", "Git", "Problem decomposition"],
    firstJobs: ["Junior developer", "QA tester"],
    note: "Building apps and systems; the entry route with the most self-taught success stories." },
  { title: "Data Analyst", strand: "STEM", route: "degree",
    weights: { math_interest: 3, technology_interest: 2, business_interest: 1.5 },
    courses: ["BS Statistics", "BS Information Systems"],
    skills: ["Excel and pivot tables", "SQL", "Charting data honestly"],
    firstJobs: ["Reports assistant", "Junior analyst"],
    note: "Turning numbers into decisions for a company or agency." },
  { title: "Medical Laboratory Scientist", strand: "STEM", route: "degree",
    weights: { science_interest: 3, hands_on_interest: 2, math_interest: 1 },
    courses: ["BS Medical Technology"],
    skills: ["Careful measurement", "Lab safety", "Record keeping"],
    firstJobs: ["Laboratory aide", "Phlebotomist"],
    note: "Lab work behind every diagnosis; steady hospital demand." },
  { title: "Nurse", strand: "STEM", route: "degree",
    weights: { science_interest: 3, communication_interest: 2, hands_on_interest: 2 },
    courses: ["BS Nursing"],
    skills: ["Anatomy", "Calm under pressure", "Clear bedside communication"],
    firstJobs: ["Nursing assistant", "Clinic staff"],
    note: "Science plus people, and the clearest path to working abroad." },
  { title: "Architect", strand: "STEM", route: "degree",
    weights: { creative_interest: 3, math_interest: 2, technology_interest: 1.5, hands_on_interest: 1 },
    courses: ["BS Architecture"],
    skills: ["Freehand drawing", "SketchUp or Revit", "Spatial reasoning"],
    firstJobs: ["Junior draftsman", "Design assistant"],
    note: "Design that has to stand up — drawing and structure in equal measure." },
  { title: "Agricultural Technician", strand: "STEM", route: "short",
    weights: { science_interest: 2.5, hands_on_interest: 3, technology_interest: 1 },
    courses: ["TESDA Agricultural Crops Production NC II", "BS Agriculture"],
    skills: ["Soil and crop basics", "Equipment maintenance"],
    firstJobs: ["Farm technician", "Agri-supply staff"],
    note: "Crops, soil and equipment — strong demand outside the cities." },

  { title: "Accountant", strand: "ABM", route: "degree",
    weights: { math_interest: 3, business_interest: 3, technology_interest: 1 },
    courses: ["BS Accountancy"],
    skills: ["Bookkeeping", "Excel", "Attention to detail"],
    firstJobs: ["Accounting clerk", "Audit associate"],
    note: "Every organisation needs one; the CPA licence travels well." },
  { title: "Marketing Officer", strand: "ABM", route: "degree",
    weights: { business_interest: 3, communication_interest: 3, creative_interest: 2 },
    courses: ["BS Marketing Management", "BS Business Administration"],
    skills: ["Copywriting", "Social media analytics", "Presenting"],
    firstJobs: ["Marketing assistant", "Social media coordinator"],
    note: "Working out what people want and how to reach them." },
  { title: "Entrepreneur", strand: "ABM", route: "work",
    weights: { business_interest: 3, communication_interest: 2, creative_interest: 1.5, hands_on_interest: 1 },
    courses: ["BS Entrepreneurship", "TESDA short courses in your trade"],
    skills: ["Costing and pricing", "Customer conversations", "Basic bookkeeping"],
    firstJobs: ["Online seller", "Market stall owner"],
    note: "Start small and learn by running it — no diploma required to begin." },
  { title: "Human Resources Officer", strand: "ABM", route: "degree",
    weights: { communication_interest: 3, business_interest: 2.5 },
    courses: ["BS Psychology", "BS Human Resource Management"],
    skills: ["Interviewing", "Labour law basics", "Record keeping"],
    firstJobs: ["HR assistant", "Recruitment associate"],
    note: "Hiring, training and keeping people — business through the people side." },
  { title: "Bookkeeper", strand: "ABM", route: "short",
    weights: { math_interest: 2.5, business_interest: 2.5, technology_interest: 1 },
    courses: ["TESDA Bookkeeping NC III"],
    skills: ["Double-entry basics", "Spreadsheets", "Discretion"],
    firstJobs: ["Bookkeeping clerk", "Store cashier-bookkeeper"],
    note: "A short course gets you working for small businesses that cannot hire a CPA." },
  { title: "Bank Teller / Customer Service", strand: "ABM", route: "work",
    weights: { math_interest: 2, communication_interest: 2.5, business_interest: 2 },
    courses: ["BS Business Administration", "any 2-year business course"],
    skills: ["Cash handling accuracy", "Polite firmness", "Basic maths under time pressure"],
    firstJobs: ["Bank teller", "Customer service associate"],
    note: "A common first job that pays while you study part-time." },

  { title: "Teacher", strand: "HUMSS", route: "degree",
    weights: { communication_interest: 3, creative_interest: 1.5, science_interest: 1 },
    courses: ["BS Education (Elementary or Secondary)"],
    skills: ["Explaining clearly", "Lesson planning", "Patience"],
    firstJobs: ["Teaching assistant", "Tutor"],
    note: "Explaining things for a living; a licence and steady public-school demand." },
  { title: "Lawyer", strand: "HUMSS", route: "degree",
    weights: { communication_interest: 3, business_interest: 1.5, creative_interest: 1 },
    courses: ["AB Political Science then Juris Doctor"],
    skills: ["Close reading", "Argument structure", "Precise writing"],
    firstJobs: ["Law office clerk", "Paralegal"],
    note: "Reading, arguing and writing precisely — a long road, but a clear one." },
  { title: "Journalist / Content Writer", strand: "HUMSS", route: "degree",
    weights: { communication_interest: 3, creative_interest: 2.5 },
    courses: ["AB Journalism", "AB Communication"],
    skills: ["Interviewing", "Editing your own work", "Meeting deadlines"],
    firstJobs: ["Contributor", "Content writer"],
    note: "Writing for a newsroom, a brand or yourself." },
  { title: "Social Worker", strand: "HUMSS", route: "degree",
    weights: { communication_interest: 3, science_interest: 1 },
    courses: ["BS Social Work"],
    skills: ["Interviewing", "Case documentation", "Emotional boundaries"],
    firstJobs: ["Community worker", "NGO field assistant"],
    note: "Case work with families and communities; licensed and always needed." },
  { title: "Psychologist / Guidance Counsellor", strand: "HUMSS", route: "degree",
    weights: { communication_interest: 3, science_interest: 2 },
    courses: ["BS Psychology then MA Guidance"],
    skills: ["Listening", "Statistics", "Confidentiality"],
    firstJobs: ["Psychometrician", "Guidance assistant"],
    note: "Understanding people formally — school, clinic or company." },
  { title: "Call Centre / BPO Associate", strand: "HUMSS", route: "work",
    weights: { communication_interest: 3, technology_interest: 1 },
    courses: ["No degree required to start"],
    skills: ["Spoken English", "Typing speed", "Staying calm on a call"],
    firstJobs: ["Customer service representative", "Technical support agent"],
    note: "Hires straight out of Grade 12 and pays while you figure out the rest." },

  { title: "Electrician", strand: "TVL", route: "short",
    weights: { hands_on_interest: 3, technology_interest: 2, math_interest: 1 },
    courses: ["TESDA Electrical Installation and Maintenance NC II"],
    skills: ["Wiring safety", "Reading circuit diagrams", "Tool discipline"],
    firstJobs: ["Electrician's helper", "Maintenance crew"],
    note: "TESDA certificate, licensed work, and demand everywhere there is wiring." },
  { title: "Automotive Technician", strand: "TVL", route: "short",
    weights: { hands_on_interest: 3, technology_interest: 2 },
    courses: ["TESDA Automotive Servicing NC I-II"],
    skills: ["Engine systems", "Diagnostic scanners", "Methodical fault-finding"],
    firstJobs: ["Shop apprentice", "Service technician"],
    note: "Engines and diagnostics — increasingly computer work as well." },
  { title: "Welder / Fabricator", strand: "TVL", route: "short",
    weights: { hands_on_interest: 3, technology_interest: 1 },
    courses: ["TESDA SMAW NC I-II"],
    skills: ["Weld types", "Blueprint reading", "Safety gear discipline"],
    firstJobs: ["Welder's helper", "Fabrication crew"],
    note: "A certificated trade with strong overseas demand." },
  { title: "Chef / Commercial Cook", strand: "TVL", route: "short",
    weights: { hands_on_interest: 3, creative_interest: 2, business_interest: 1 },
    courses: ["TESDA Cookery NC II", "BS Hotel and Restaurant Management"],
    skills: ["Knife skills", "Food safety", "Working fast and clean"],
    firstJobs: ["Commis cook", "Kitchen crew"],
    note: "Kitchens hire on skill; hotels and cruise lines recruit from TVL." },
  { title: "Computer Systems Servicing Technician", strand: "TVL", route: "short",
    weights: { technology_interest: 3, hands_on_interest: 2.5 },
    courses: ["TESDA Computer Systems Servicing NC II"],
    skills: ["Hardware assembly", "Network setup", "Troubleshooting method"],
    firstJobs: ["IT support staff", "Field technician"],
    note: "Networks and hardware — the TVL route into IT without a degree." },
  { title: "Graphic Designer", strand: "TVL", route: "work",
    weights: { creative_interest: 3, technology_interest: 2 },
    courses: ["No degree required", "BA Multimedia Arts"],
    skills: ["Canva then Figma or Illustrator", "Typography", "Taking feedback"],
    firstJobs: ["Junior designer", "Freelance layout artist"],
    note: "A portfolio counts for more than a diploma; freelance work starts early." },
  { title: "Video Editor", strand: "TVL", route: "work",
    weights: { creative_interest: 3, technology_interest: 2.5 },
    courses: ["No degree required", "BA Multimedia Arts"],
    skills: ["CapCut then Premiere or DaVinci", "Pacing and sound", "File organisation"],
    firstJobs: ["Editing assistant", "Freelance editor"],
    note: "Learn the software, build a reel, and clients follow." },
  { title: "Dressmaker / Tailor", strand: "TVL", route: "short",
    weights: { hands_on_interest: 3, creative_interest: 2.5, business_interest: 1 },
    courses: ["TESDA Dressmaking NC II"],
    skills: ["Pattern drafting", "Machine maintenance", "Costing a job"],
    firstJobs: ["Sewer in a shop", "Home-based tailor"],
    note: "A trade you can run from home as your own small business." },

  { title: "Civil Service / Government Administrative Officer", strand: "GAS", route: "degree",
    weights: { communication_interest: 2, business_interest: 2, math_interest: 1.5 },
    courses: ["Any 4-year degree plus the Civil Service Exam"],
    skills: ["Clear writing", "Records management", "Public service ethics"],
    firstJobs: ["Administrative aide", "Clerk II"],
    note: "A broad degree plus the civil service exam opens most government posts." },
  { title: "Tourism Officer", strand: "GAS", route: "degree",
    weights: { communication_interest: 2.5, business_interest: 2, creative_interest: 1.5 },
    courses: ["BS Tourism Management"],
    skills: ["Itinerary planning", "Hosting and guiding", "A second language"],
    firstJobs: ["Tour coordinator", "Front desk staff"],
    note: "Hospitality and local government work; strong in tourist provinces." },
  { title: "Police Officer / Armed Forces", strand: "GAS", route: "work",
    weights: { hands_on_interest: 2.5, communication_interest: 1.5, science_interest: 1 },
    courses: ["BS Criminology", "or any degree plus the entrance exam"],
    skills: ["Physical fitness", "Report writing", "Composure"],
    firstJobs: ["Patrolman", "Enlisted personnel"],
    note: "Entry by exam and training rather than a specific strand." },
];

function explainCareer(career, detail, strandPct) {
  const drivers = detail.parts
    .filter((p) => p.value >= 0.5)
    .slice(0, 2)
    .map((p) => p.label.toLowerCase());

  if (drivers.length) {
    return "Uses the " + listPhrase(drivers) + " you rated highest, and sits under " +
      career.strand + " (" + strandPct + "% fit).";
  }
  return "Sits under " + career.strand + " (" + strandPct + "% fit), but leans on " +
    listPhrase(detail.parts.slice(0, 2).map((p) => p.label.toLowerCase())) + ", which you rated low.";
}

/* ---------------- the public entry point ---------------- */

/* Returns every strand ranked with a match percentage and a reason, and the
   careers that follow from those answers, likewise ranked and explained. */
const CAREER_TRAIT_SHARE = 0.7;
const CAREER_STRAND_SHARE = 0.3;
const ACTIVITY_MAX_BONUS = 0.12;

/* Re-add a trace and check it reproduces the score it claims to explain.
   If this ever fails, the explanation shown to a student has drifted from
   the calculation, which is worse than showing nothing. */
export function verifyTrace(entry, tolerance) {
  const t = entry && entry.trace;
  if (!t) return { ok: false, reason: "no trace" };
  const eps = tolerance || 0.0005;

  if (t.kind === "weighted") {
    const total = t.rows.reduce((sum, r) => sum + r.weight, 0);
    const contributions = t.rows.reduce((sum, r) => sum + r.contribution, 0);
    const absolute = contributions / (total || 1);
    const relative =
      t.rows.reduce((sum, r) => sum + r.weight * (r.value - t.studentAverage), 0) / (total || 1);
    const blended = ABS_SHARE * absolute + REL_SHARE * (0.5 + relative);
    const final = Math.min(1, Math.max(0, blended + (t.activityBonus || 0)));
    return {
      ok: Math.abs(final - entry.score) < eps && Math.abs(total - t.totalWeight) < eps,
      recomputed: final,
      claimed: entry.score,
    };
  }

  if (t.kind === "evenness") {
    const evenness = Math.min(1, Math.max(0, 1 - t.spread / t.spreadReference));
    const blended = GAS_AVG_SHARE * t.average + GAS_EVEN_SHARE * evenness;
    const final = Math.min(1, Math.max(0, blended + (t.activityBonus || 0)));
    return { ok: Math.abs(final - entry.score) < eps, recomputed: final, claimed: entry.score };
  }

  if (t.kind === "career") {
    const total = t.rows.reduce((sum, r) => sum + r.weight, 0);
    const absolute = t.rows.reduce((sum, r) => sum + r.contribution, 0) / (total || 1);
    const relative =
      t.rows.reduce((sum, r) => sum + r.weight * (r.value - t.studentAverage), 0) / (total || 1);
    const traitFit = Math.min(1, Math.max(0, ABS_SHARE * absolute + REL_SHARE * (0.5 + relative)));
    const final = Math.min(
      1,
      Math.max(0, CAREER_TRAIT_SHARE * traitFit + CAREER_STRAND_SHARE * t.strandFit + (t.bias || 0))
    );
    return { ok: Math.abs(final - entry.score) < eps, recomputed: final, claimed: entry.score };
  }

  return { ok: false, reason: "unknown trace kind" };
}

/* Returns every strand ranked with a match percentage, a reason and the
   arithmetic behind it, plus the careers those answers point to, likewise
   ranked and explained.

   options.adjustments — this student's accumulated feedback, if any. */
export function recommend(answers, options) {
  const opts = options || {};
  const limit = opts.careerLimit || 6;
  const adj = safeAdjustments(opts.adjustments);

  const r01 = normalise(answers);
  const activity = answers && ACTIVITY_BY_VALUE[answers.preferred_activity]
    ? answers.preferred_activity
    : null;
  const activityDef = activity ? ACTIVITY_BY_VALUE[activity] : null;
  const bonuses = activityDef ? activityDef.bonus : {};

  /* When the trained model has already decided the strand, its scores are
     the ones to rank careers against. The heuristic below then serves only
     as a fallback for a questionnaire the model has not been given. */
  const supplied = opts.strandScores;

  const strands = supplied
    ? STRANDS.map((strand) => ({
        id: strand.id,
        name: strand.name,
        full: strand.full,
        blurb: strand.blurb,
        score: clamp01(supplied[strand.id] || 0),
        match: pct(clamp01(supplied[strand.id] || 0)),
        fromModel: true,
        adjusted: false,
      })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    : STRANDS.map((strand) => {
    const effective = strand.weights
      ? effectiveWeights(strand.weights, adj.strandWeights[strand.id])
      : null;
    const detail = effective ? weightedScore(r01, effective) : gasScore(r01);

    /* The activity is worth at most twelve points — a nudge between close
       strands, never enough to overturn the ratings. */
    const bonus = (bonuses[strand.id] || 0) * ACTIVITY_MAX_BONUS;
    const score = clamp01(detail.score + bonus);

    const trace = {
      ...detail.trace,
      activityBonus: bonus,
      activityLabel: activityDef ? activityDef.label : null,
      final: score,
    };

    return {
      id: strand.id,
      name: strand.name,
      full: strand.full,
      blurb: strand.blurb,
      score,
      match: pct(score),
      activityBonus: Math.round(bonus * 100),
      adjusted: effective ? Object.values(effective).some((w) => Math.abs(w.value - w.base) >= 0.005) : false,
      why: explainStrand(strand, detail, r01, activity),
      trace,
    };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const strandScore = Object.fromEntries(strands.map((s) => [s.id, s.score]));
  const strandPct = Object.fromEntries(strands.map((s) => [s.id, s.match]));
  const topStrand = strands[0];

  const careers = CAREERS.map((career) => {
    const effective = effectiveWeights(career.weights, adj.careerWeights[career.title]);
    const detail = weightedScore(r01, effective);
    const bias = adj.careerBias[career.title] || 0;

    /* Trait fit is what the work needs; strand fit keeps the list coherent
       with the strand result instead of contradicting it. */
    const blended =
      CAREER_TRAIT_SHARE * detail.score + CAREER_STRAND_SHARE * strandScore[career.strand];
    const score = clamp01(blended + bias);

    return {
      title: career.title,
      strand: career.strand,
      route: career.route,
      note: career.note,
      courses: career.courses || [],
      skills: career.skills || [],
      firstJobs: career.firstJobs || [],
      score,
      match: pct(score),
      adjusted: Object.values(effective).some((w) => Math.abs(w.value - w.base) >= 0.005) || Math.abs(bias) >= 0.005,
      why: explainCareer(career, detail, strandPct[career.strand]),
      trace: {
        ...detail.trace,
        kind: "career",
        traitFit: detail.score,
        strandId: career.strand,
        strandFit: strandScore[career.strand],
        bias,
        final: score,
        formula:
          "(" + CAREER_TRAIT_SHARE + " x trait fit) + (" + CAREER_STRAND_SHARE +
          " x " + career.strand + " fit)" + (Math.abs(bias) >= 0.005 ? " + your feedback" : ""),
      },
    };
  })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);

  return {
    strands,
    careers,
    topStrand,
    activity,
    adjustments: adjustmentSummary(adj),
  };
}

/* The same recommendations in the shape the career cards already use, so a
   failed AI call can fall back to them without a second rendering path.

   `fit` is the match percentage, `reality` the catalogue's honest note, and
   `local: true` marks the card so the UI can say where it came from rather
   than passing local suggestions off as the AI's. */
export function localCareerCards(answers, options) {
  const opts = options || {};
  const { careers } = recommend(answers, { ...opts, careerLimit: opts.careerLimit || 4 });
  return careers.map((c) => ({
    title: c.title,
    fit: c.match,
    route: c.route,
    why: c.why,
    courses: c.courses,
    skills: c.skills,
    firstJobs: c.firstJobs,
    reality: c.note,
    strand: c.strand,
    local: true,
  }));
}
