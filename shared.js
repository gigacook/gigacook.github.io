// Data shared by the terminal and the Truth page.
const RAW = "https://raw.githubusercontent.com/gigacook";
const QUOTES_URL = `${RAW}/zeroCortisol/main/data/quotes.json`;
const EXAM_URL = `${RAW}/kirurgi.xyz/kirxyz/11_exams/normalized_exam_question_bank.json`;

function dayNumber(date = new Date()) {
  // UTC day, so the site and the profile README agree on "today".
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);
}

let quotesPromise = null;
function loadQuotes() {
  return quotesPromise || (quotesPromise = fetch(QUOTES_URL).then(r => {
    if (!r.ok) throw new Error("quotes " + r.status);
    return r.json();
  }).catch(e => { quotesPromise = null; throw e; }));
}

// Must match truth_of_the_day() in gigacook/gigacook scripts/update_readme.py.
function pickTruth(quotes, day = dayNumber()) {
  return quotes[(day * 97) % quotes.length];
}

let examPromise = null;
function loadExam() {
  return examPromise || (examPromise = fetch(EXAM_URL).then(r => {
    if (!r.ok) throw new Error("exam " + r.status);
    return r.json();
  }).then(all => all.filter(q => q.confidence === "high" && Array.isArray(q.options) && q.options.length))
    .catch(e => { examPromise = null; throw e; }));
}
