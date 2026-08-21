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
function weightedScore(r01, weights) {
  const avg = mean(TRAIT_KEYS.map((k) => r01[k]));
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0) || 1;

  let absolute = 0;
  let relative = 0;
  const parts = [];

  for (const [key, w] of entries) {
    absolute += w * r01[key];
    relative += w * (r01[key] - avg);
    parts.push({ key, label: LABEL[key], weight: w, value: r01[key], share: (w * r01[key]) / total });
  }

  absolute /= total;
  relative /= total;

  parts.sort((a, b) => b.share - a.share);
  return { score: clamp01(0.65 * absolute + 0.35 * (0.5 + relative)), parts, absolute, relative };
}

/* GAS rewards a level profile: broadly interested, nothing dominating. */
function gasScore(r01) {
  const values = TRAIT_KEYS.map((k) => r01[k]);
  const avg = mean(values);
  const spread = stdev(values);
  /* 0.40 is roughly the spread of a strongly specialised profile */
  const evenness = clamp01(1 - spread / 0.4);
  return { score: clamp01(0.45 * avg + 0.55 * evenness), evenness, avg, spread };
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
    note: "Designing and checking structures — heavy on maths you can see standing up." },
  { title: "Software Developer", strand: "STEM", route: "degree",
    weights: { technology_interest: 3, math_interest: 2, creative_interest: 1 },
    note: "Building apps and systems; the entry route with the most self-taught success stories." },
  { title: "Data Analyst", strand: "STEM", route: "degree",
    weights: { math_interest: 3, technology_interest: 2, business_interest: 1.5 },
    note: "Turning numbers into decisions for a company or agency." },
  { title: "Medical Laboratory Scientist", strand: "STEM", route: "degree",
    weights: { science_interest: 3, hands_on_interest: 2, math_interest: 1 },
    note: "Lab work behind every diagnosis; steady hospital demand." },
  { title: "Nurse", strand: "STEM", route: "degree",
    weights: { science_interest: 3, communication_interest: 2, hands_on_interest: 2 },
    note: "Science plus people, and the clearest path to working abroad." },
  { title: "Architect", strand: "STEM", route: "degree",
    weights: { creative_interest: 3, math_interest: 2, technology_interest: 1.5, hands_on_interest: 1 },
    note: "Design that has to stand up — drawing and structure in equal measure." },
  { title: "Agricultural Technician", strand: "STEM", route: "short",
    weights: { science_interest: 2.5, hands_on_interest: 3, technology_interest: 1 },
    note: "Crops, soil and equipment — strong demand outside the cities." },

  { title: "Accountant", strand: "ABM", route: "degree",
    weights: { math_interest: 3, business_interest: 3, technology_interest: 1 },
    note: "Every organisation needs one; the CPA licence travels well." },
  { title: "Marketing Officer", strand: "ABM", route: "degree",
    weights: { business_interest: 3, communication_interest: 3, creative_interest: 2 },
    note: "Working out what people want and how to reach them." },
  { title: "Entrepreneur", strand: "ABM", route: "work",
    weights: { business_interest: 3, communication_interest: 2, creative_interest: 1.5, hands_on_interest: 1 },
    note: "Start small and learn by running it — no diploma required to begin." },
  { title: "Human Resources Officer", strand: "ABM", route: "degree",
    weights: { communication_interest: 3, business_interest: 2.5 },
    note: "Hiring, training and keeping people — business through the people side." },
  { title: "Bookkeeper", strand: "ABM", route: "short",
    weights: { math_interest: 2.5, business_interest: 2.5, technology_interest: 1 },
    note: "A short course gets you working for small businesses that cannot hire a CPA." },
  { title: "Bank Teller / Customer Service", strand: "ABM", route: "work",
    weights: { math_interest: 2, communication_interest: 2.5, business_interest: 2 },
    note: "A common first job that pays while you study part-time." },

  { title: "Teacher", strand: "HUMSS", route: "degree",
    weights: { communication_interest: 3, creative_interest: 1.5, science_interest: 1 },
    note: "Explaining things for a living; a licence and steady public-school demand." },
  { title: "Lawyer", strand: "HUMSS", route: "degree",
    weights: { communication_interest: 3, business_interest: 1.5, creative_interest: 1 },
    note: "Reading, arguing and writing precisely — a long road, but a clear one." },
  { title: "Journalist / Content Writer", strand: "HUMSS", route: "degree",
    weights: { communication_interest: 3, creative_interest: 2.5 },
    note: "Writing for a newsroom, a brand or yourself." },
  { title: "Social Worker", strand: "HUMSS", route: "degree",
    weights: { communication_interest: 3, science_interest: 1 },
    note: "Case work with families and communities; licensed and always needed." },
  { title: "Psychologist / Guidance Counsellor", strand: "HUMSS", route: "degree",
    weights: { communication_interest: 3, science_interest: 2 },
    note: "Understanding people formally — school, clinic or company." },
  { title: "Call Centre / BPO Associate", strand: "HUMSS", route: "work",
    weights: { communication_interest: 3, technology_interest: 1 },
    note: "Hires straight out of Grade 12 and pays while you figure out the rest." },

  { title: "Electrician", strand: "TVL", route: "short",
    weights: { hands_on_interest: 3, technology_interest: 2, math_interest: 1 },
    note: "TESDA certificate, licensed work, and demand everywhere there is wiring." },
  { title: "Automotive Technician", strand: "TVL", route: "short",
    weights: { hands_on_interest: 3, technology_interest: 2 },
    note: "Engines and diagnostics — increasingly computer work as well." },
  { title: "Welder / Fabricator", strand: "TVL", route: "short",
    weights: { hands_on_interest: 3, technology_interest: 1 },
    note: "A certificated trade with strong overseas demand." },
  { title: "Chef / Commercial Cook", strand: "TVL", route: "short",
    weights: { hands_on_interest: 3, creative_interest: 2, business_interest: 1 },
    note: "Kitchens hire on skill; hotels and cruise lines recruit from TVL." },
  { title: "Computer Systems Servicing Technician", strand: "TVL", route: "short",
    weights: { technology_interest: 3, hands_on_interest: 2.5 },
    note: "Networks and hardware — the TVL route into IT without a degree." },
  { title: "Graphic Designer", strand: "TVL", route: "work",
    weights: { creative_interest: 3, technology_interest: 2 },
    note: "A portfolio counts for more than a diploma; freelance work starts early." },
  { title: "Video Editor", strand: "TVL", route: "work",
    weights: { creative_interest: 3, technology_interest: 2.5 },
    note: "Learn the software, build a reel, and clients follow." },
  { title: "Dressmaker / Tailor", strand: "TVL", route: "short",
    weights: { hands_on_interest: 3, creative_interest: 2.5, business_interest: 1 },
    note: "A trade you can run from home as your own small business." },

  { title: "Civil Service / Government Administrative Officer", strand: "GAS", route: "degree",
    weights: { communication_interest: 2, business_interest: 2, math_interest: 1.5 },
    note: "A broad degree plus the civil service exam opens most government posts." },
  { title: "Tourism Officer", strand: "GAS", route: "degree",
    weights: { communication_interest: 2.5, business_interest: 2, creative_interest: 1.5 },
    note: "Hospitality and local government work; strong in tourist provinces." },
  { title: "Police Officer / Armed Forces", strand: "GAS", route: "work",
    weights: { hands_on_interest: 2.5, communication_interest: 1.5, science_interest: 1 },
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
export function recommend(answers, options) {
  const limit = (options && options.careerLimit) || 6;
  const r01 = normalise(answers);
  const activity = answers && ACTIVITY_BY_VALUE[answers.preferred_activity]
    ? answers.preferred_activity
    : null;
  const bonuses = activity ? ACTIVITY_BY_VALUE[activity].bonus : {};

  const strands = STRANDS.map((strand) => {
    const detail = strand.weights ? weightedScore(r01, strand.weights) : gasScore(r01);
    /* The activity is worth at most twelve points — a nudge between close
       strands, never enough to overturn the ratings. */
    const bonus = (bonuses[strand.id] || 0) * 0.12;
    const score = clamp01(detail.score + bonus);
    return {
      id: strand.id,
      name: strand.name,
      full: strand.full,
      blurb: strand.blurb,
      score,
      match: pct(score),
      activityBonus: Math.round(bonus * 100),
      why: explainStrand(strand, detail, r01, activity),
    };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const strandPct = Object.fromEntries(strands.map((s) => [s.id, s.match]));
  const topStrand = strands[0];

  const careers = CAREERS.map((career) => {
    const detail = weightedScore(r01, career.weights);
    /* Trait fit is what the work needs; strand fit keeps the list coherent
       with the strand result instead of contradicting it. */
    const score = clamp01(0.7 * detail.score + 0.3 * (strandPct[career.strand] / 100));
    return {
      title: career.title,
      strand: career.strand,
      route: career.route,
      note: career.note,
      score,
      match: pct(score),
      why: explainCareer(career, detail, strandPct[career.strand]),
    };
  })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);

  return { strands, careers, topStrand, activity };
}
