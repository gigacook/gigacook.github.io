// Data shared by the terminal and the Truth page.
const RAW = "https://raw.githubusercontent.com/gigacook";
const QUOTES_URL = `${RAW}/zeroCortisol/main/data/quotes.json`;
const EXAM_URL = `${RAW}/kirurgi.xyz/kirxyz/11_exams/normalized_exam_question_bank.json`;

function dayNumber(date = new Date()) {
  // The visitor's calendar day, counted like zeroCortisol's DayKey.dayNumber.
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

let quotesPromise = null;
function loadQuotes() {
  return quotesPromise || (quotesPromise = fetch(QUOTES_URL).then(r => {
    if (!r.ok) throw new Error("quotes " + r.status);
    return r.json();
  }).catch(e => { quotesPromise = null; throw e; }));
}

// Same pick as the zeroCortisol app (TruthOfDay.index in Scoring.swift) and the
// profile README: a scrambled walk through the whole corpus, one quote per day.
function pickTruth(quotes, day = dayNumber()) {
  const n = quotes.length;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  let stride = 1;
  if (n > 2) { stride = Math.max(1, Math.floor(n * 0.618)); while (gcd(stride, n) !== 1) stride++; }
  return quotes[(((day % n) * stride + 17) % n + n) % n];
}

let examPromise = null;
function loadExam() {
  return examPromise || (examPromise = fetch(EXAM_URL).then(r => {
    if (!r.ok) throw new Error("exam " + r.status);
    return r.json();
  }).then(all => all.filter(q => q.confidence === "high" && Array.isArray(q.options) && q.options.length))
    .catch(e => { examPromise = null; throw e; }));
}
