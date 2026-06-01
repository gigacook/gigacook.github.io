// =============================================================
// STATE
// =============================================================
const S = {
  sessionId: localStorage.getItem('kir_session') || null,
  mode: 'quiz',
  specialties: [],  // grouped tree
  subjects: [],     // flat list

  // quiz
  quizMode: 'normal', quizSubject: '', quizTopic: '', quizTags: '',
  currentQ: null, answered: false,
  quizN: 20,
  quizSpecialty: '',
  timerMode: 'nerd',
  quizRunId: null,
  totalScore: +(localStorage.getItem('kir_score') || 0),
  quizRun: { active: false, done: false, queue: [], position: 0, originalN: 0, results: [], reinserted: null },

  // exam
  examQuestions: [], examAnswers: {}, examIndex: 0,
  examActive: false, examDone: false, examResults: null,

  // study/explore
  browseSubject: null, browseTopic: null, browseSpecialty: null, activeTab: 'questions',
  exploreSubject: null, exploreTopic: null, activeTags: new Set(),
  openStudySpec: new Set(),   // expanded specialty slugs in study sidebar
  openExploreSpec: new Set(), // expanded specialty slugs in explore sidebar

  stats: { seen: 0, correct: 0, incorrect: 0, archived: 0, accuracy: 0 },
};

const TIMER_CFG = {
  granny: { s: 90, mult: 0.5, label: '🧓 Granny' },
  nerd:   { s: 45, mult: 1.0, label: '🤓 Nerd'   },
  alien:  { s: 18, mult: 5.0, label: '👽 Alien'  },
};
const DIFF_OPTS = [
  { key: 'granny', icon: '🐢', name: 'Turtle', tip: 'relaxed pace' },
  { key: 'nerd',   icon: '🙂', name: 'Human',  tip: 'balanced' },
  { key: 'alien',  icon: '👽', name: 'Alien',  tip: 'fast' },
];
const BASE_SCORE = { 'lätt':50,'latt':50,'medel':100,'svår':200,'svar':200 };
let _qtimer = null;

// Shared lookup tables so onclick handlers can reference by index (avoids
// embedding user strings directly in onclick attributes).
const _D = { subjects: [], topics: [], questions: [], matrix: [] };

// =============================================================
// API
// =============================================================
async function get(url, params = {}) {
  if (S.sessionId) params.session_id = S.sessionId;
  const qs = Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const r = await fetch(qs ? `${url}?${qs}` : url);
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return r.json();
}
async function post(url, body = {}) {
  if (S.sessionId) body.session_id = S.sessionId;
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${url} → ${r.status}`);
  return r.json();
}

// =============================================================
// SESSION & STATS
// =============================================================
async function initSession() {
  if (!S.sessionId) {
    const d = await post('/session');
    S.sessionId = d.session_id;
    localStorage.setItem('kir_session', S.sessionId);
  }
  updateStats(await get('/stats'));
}
function updateStats(st) {
  if (!st) return;
  S.stats = st;
  el('s-seen').textContent      = st.seen;
  el('s-correct').textContent   = st.correct;
  el('s-incorrect').textContent = st.incorrect;
  el('s-acc').textContent       = st.accuracy + '%';
  // Refresh quiz progress panel if visible
  const panel = el('quiz-progress');
  if (panel) { panel.innerHTML = buildProgressPanel(); wireProgressPanel(); }
}

function genId() {
  return 'r' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

function resetRun() {
  S.quizRun = { active: false, done: false, queue: [], position: 0, originalN: 0, results: [], reinserted: null };
  S.currentQ = null;
  S.answered = false;
  S.quizRunId = null;
}

async function saveRun() {
  const run = S.quizRun;
  if (!S.quizRunId || (!run.active && !run.done)) return;
  const results = run.results
    .filter(r => r.question)
    .map(r => ({ id: r.question.id, correct: r.is_correct, score: r.score || 0, timedOut: r.timedOut || false }));
  post('/runs/save', {
    run_id:       S.quizRunId,
    mode:         S.quizMode,
    subject:      S.quizSubject,
    specialty:    S.quizSpecialty,
    timer_mode:   S.timerMode,
    question_ids: run.queue.map(q => q.id),
    position:     run.position,
    results,
    done:         run.done,
    n:            run.originalN,
  }).catch(() => {});
}

function calcScore(diff, correct) {
  if (!correct) return 0;
  const base = BASE_SCORE[diff] || 100;
  const cfg  = TIMER_CFG[S.timerMode];
  return cfg ? Math.round(base * cfg.mult) : base;
}

function levelInfo(pts) {
  const lvl = Math.floor(Math.pow(Math.max(pts, 0) / 100, 0.6));
  const at  = n => 100 * Math.pow(n, 5 / 3);
  const pct = at(lvl + 1) > at(lvl)
    ? Math.min(100, Math.round((pts - at(lvl)) / (at(lvl + 1) - at(lvl)) * 100))
    : 100;
  return { lvl, pct };
}

function updateScoreDisplay() {
  const { lvl, pct } = levelInfo(S.totalScore);
  const lv = el('score-level'); if (lv) lv.textContent = 'Lv ' + lvl;
  const br = el('score-bar');   if (br) br.style.width  = pct + '%';
  const pt = el('score-pts');   if (pt) pt.textContent  = S.totalScore.toLocaleString() + ' pts';
}

function buildDiffPanel(panelId) {
  const buttons = DIFF_OPTS.map(d => {
    const cfg = TIMER_CFG[d.key];
    const tip = `${d.name} – ${cfg.s}s per question (${d.tip})`;
    return `<button class="diff-btn${d.key === S.timerMode ? ' active' : ''}" data-diff="${d.key}" data-tip="${tip}">
      <span class="diff-icon">${d.icon}</span>
    </button>`;
  }).join('');
  const activeOpt = DIFF_OPTS.find(d => d.key === S.timerMode);
  return `<div style="display:flex;flex-direction:column;gap:.25rem">
    <div class="diff-panel" id="${panelId}">
      ${buttons}
      <button class="diff-off-btn${!S.timerMode ? ' active' : ''}" data-diff="" data-tip="No timer">Off</button>
    </div>
    <div class="diff-mode-label">Mode: <strong>${activeOpt ? activeOpt.name + ' ' + activeOpt.icon : 'Off'}</strong></div>
  </div>`;
}

function wireDiffPanel(panelId) {
  const panel = el(panelId);
  if (!panel) return;
  panel.onclick = e => {
    const btn = e.target.closest('[data-diff]');
    if (!btn) return;
    S.timerMode = btn.dataset.diff;
    resetRun();
    document.querySelectorAll('.diff-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.diff === S.timerMode));
    document.querySelectorAll('.diff-off-btn').forEach(b =>
      b.classList.toggle('active', S.timerMode === ''));
    const activeOpt = DIFF_OPTS.find(d => d.key === S.timerMode);
    document.querySelectorAll('.diff-mode-label').forEach(lbl => {
      lbl.innerHTML = `Mode: <strong>${activeOpt ? activeOpt.name + ' ' + activeOpt.icon : 'Off'}</strong>`;
    });
  };
}

function buildTimerBar() {
  const cfg = TIMER_CFG[S.timerMode];
  if (!cfg) return '';
  return `<div id="q-timer" style="display:flex;align-items:center;gap:.5rem;margin-bottom:.6rem">
    <span id="timer-secs" style="font-size:.75rem;font-weight:600;color:var(--muted);min-width:24px;text-align:right">${cfg.s}s</span>
    <div style="flex:1;height:4px;background:var(--border);border-radius:2px;overflow:hidden">
      <div id="timer-fill" style="height:100%;width:100%;background:var(--success);border-radius:2px;transition:width 1s linear,background .3s"></div>
    </div>
    <span style="font-size:.65rem;color:var(--muted)">${cfg.label}</span>
  </div>`;
}

function stopQTimer() {
  if (_qtimer) { clearInterval(_qtimer); _qtimer = null; }
}

function startQTimer(seconds, onTimeout) {
  stopQTimer();
  let rem = seconds;
  _qtimer = setInterval(() => {
    rem--;
    const fill = el('timer-fill'), secs = el('timer-secs');
    if (fill) {
      const pct = Math.max(0, rem / seconds * 100);
      fill.style.width = pct + '%';
      fill.style.background = pct > 50 ? 'var(--success)' : pct > 25 ? 'var(--warn)' : 'var(--danger)';
    }
    if (secs) secs.textContent = rem + 's';
    if (rem <= 0) { stopQTimer(); onTimeout(); }
  }, 1000);
}

async function handleQTimeout() {
  if (S.answered || !S.currentQ || !el('quiz-area')) { stopQTimer(); return; }
  S.answered = true;
  document.querySelectorAll('.option-btn').forEach(b => b.disabled = true);
  const d = await post('/answer', { question_id: S.currentQ.id, selected: null });
  const q = d.question;
  updateStats(d.stats);
  const run = S.quizRun;
  if (run.active) run.results.push({ question: S.currentQ, selected: null, is_correct: false, score: 0, timedOut: true });
  document.querySelectorAll('.option-btn').forEach(b => { if (b.dataset.letter === q.correct) b.classList.add('correct'); });
  const expl = el('explanation-area');
  if (expl) expl.innerHTML = `<div class="explanation-box" style="background:#fef2f2;border-color:#fecaca">
    <h4 style="color:var(--danger)">⏱ Time's up! — 0 pts</h4>
    <div>${esc(q.explanation)}</div></div>`;
  const actions = el('quiz-actions');
  if (actions) actions.innerHTML = `<button class="btn btn-primary" data-qa="next">Next →</button>
    <button class="btn btn-outline btn-sm" data-qa="archive">Archive</button>
    <button class="btn btn-ghost btn-sm" data-qa="chain">Topic chain</button>`;
  saveRun();
}

function handleExamTimeout() {
  stopQTimer();
  if (!S.examActive || !el('exam-options')) return;
  if (S.examIndex < S.examQuestions.length - 1) { S.examIndex++; renderExamQuestion(); }
}

function trackLocalAnswer(question, isCorrect) {
  if (!S.localStats) S.localStats = { by_subject:{}, specialty_total:1095, old_exam_total:1079, specialty_seen:0, old_exam_seen:0 };
  const isOld = question.specialty === 'old_exam';
  if (isOld) {
    S.localStats.old_exam_seen = (S.localStats.old_exam_seen||0) + 1;
  } else {
    S.localStats.specialty_seen = (S.localStats.specialty_seen||0) + 1;
    const subj = question.subject;
    if (!S.localStats.by_subject[subj]) S.localStats.by_subject[subj] = {seen:0,correct:0,incorrect:0};
    S.localStats.by_subject[subj].seen++;
    if (isCorrect) S.localStats.by_subject[subj].correct++;
    else S.localStats.by_subject[subj].incorrect++;
  }
}

// =============================================================
// UTIL
// =============================================================
function el(id)  { return document.getElementById(id); }
function app()   { return el('app'); }

// Safe attribute value: escape for use inside double-quoted HTML attributes.
function attr(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;');
}
// Safe text content (no attributes).
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function diffBadge(d) {
  const m = { 'lätt':'badge-green','latt':'badge-green','medel':'badge-yellow','svår':'badge-red','svar':'badge-red' };
  const lm = { 'lätt':'Lätt','latt':'Lätt','medel':'Medel','svår':'Svår','svar':'Svår' };
  return `<span class="badge ${m[d]||'badge-gray'}">${lm[d]||esc(d)||'?'}</span>`;
}
function typBadge(t) { return t ? `<span class="badge badge-purple">${esc(t)}</span>` : ''; }

function list(arr) {
  if (!arr || !arr.length) return '<span class="text-muted">—</span>';
  return '<ul>' + arr.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>';
}

function statusClass(q) {
  if (q.archived)     return 'qs-archived';
  if (q.is_correct)   return 'qs-correct';
  if (q.is_incorrect) return 'qs-incorrect';
  if (q.seen)         return 'qs-seen';
  return 'qs-unseen';
}

// =============================================================
// ROUTING
// =============================================================
function switchMode(mode) {
  S.mode = mode;
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  const btn = el('nav-' + mode);
  if (btn) btn.classList.add('active');
  render();
}
function render() {
  switch (S.mode) {
    case 'study':   renderStudy();   break;
    case 'quiz':    renderQuiz();    break;
    case 'exam':    renderExam();    break;
    case 'explore': renderExplore(); break;
    case 'profile': renderProfile(); break;
  }
}

// =============================================================
// STUDY MODE
// =============================================================
async function renderStudy() {

  app().innerHTML = `
    <div class="pane-layout">
      <div class="sidebar">
        <div class="sidebar-search">
          <input id="subj-search" placeholder="Search subjects…" oninput="filterStudySubjects()"/>
        </div>
        <div class="sidebar-list" id="subj-list"></div>
      </div>
      <div class="content" id="study-content">
        <div class="empty">Select a subject to begin studying</div>
      </div>
    </div>`;
  buildSpecialtySidebar('subj-list', S.specialties, 'study');
  if (S.browseSubject)   loadStudySubject(S.browseSubject);
  else if (S.browseSpecialty) loadSpecialtyOverview(S.browseSpecialty);
}

// Two-level specialty tree for both study and explore sidebars.
function buildSpecialtySidebar(containerId, specialties, mode) {
  const openSet = mode === 'study' ? S.openStudySpec : S.openExploreSpec;
  const query   = (el(mode === 'study' ? 'subj-search' : 'exp-search')?.value || '').toLowerCase();

  // Build flat subject list for data-si indexing
  const flat = [];
  specialties.forEach(sp => sp.subjects.forEach(s => flat.push(s)));
  _D.subjects = flat;

  const c = el(containerId);
  if (!c) return;

  // Filter specialties by search query
  const filtered = specialties.map(sp => ({
    ...sp,
    subjects: sp.subjects.filter(s => !query || s.subject.toLowerCase().includes(query)),
  })).filter(sp => !query || sp.subjects.length > 0 ||
    sp.display_name.toLowerCase().includes(query));

  c.innerHTML = filtered.map(sp => {
    const isOpen = openSet.has(sp.specialty) || (query && sp.subjects.length > 0);
    const subjectRows = isOpen ? sp.subjects.map(s => {
      const gIdx = flat.indexOf(s);
      return `<div class="titem${S.browseSubject===s.subject?' active':''}" data-si="${gIdx}">
        <span>${esc(s.subject)}</span>
        <span class="cnt">${s.question_count}q</span>
      </div>`;
    }).join('') : '';

    return `<div>
      <div class="sitem spec-hdr${isOpen?' open':''}" data-spec="${sp.specialty}">
        <span>${esc(sp.display_name)}</span>
        <span style="display:flex;gap:.4rem;align-items:center">
          <span class="cnt">${sp.question_count}q</span>
          <span class="spec-arr">${isOpen ? '▾' : '▸'}</span>
        </span>
      </div>
      ${subjectRows ? `<div class="spec-subjects">${subjectRows}</div>` : ''}
    </div>`;
  }).join('');

  c.onclick = e => {
    const hdr = e.target.closest('[data-spec]');
    if (hdr) {
      const sp = filtered.find(x => x.specialty === hdr.dataset.spec);
      if (!sp) return;
      if (sp.subjects.length === 1 && !query) {
        // Single subject — click goes straight to it
        mode === 'study' ? loadStudySubject(sp.subjects[0].subject)
                         : loadExploreSubject(sp.subjects[0].subject);
      } else {
        if (mode === 'study') {
          loadSpecialtyOverview(sp.specialty);
        } else {
          if (openSet.has(sp.specialty)) openSet.delete(sp.specialty);
          else openSet.add(sp.specialty);
          buildSpecialtySidebar(containerId, specialties, mode);
        }
      }
      return;
    }
    const item = e.target.closest('[data-si]');
    if (item) {
      const s = _D.subjects[+item.dataset.si];
      if (!s) return;
      mode === 'study' ? loadStudySubject(s.subject) : loadExploreSubject(s.subject);
    }
  };
}

function filterStudySubjects() {
  buildSpecialtySidebar('subj-list', S.specialties, 'study');
}

async function loadSpecialtyOverview(specKey) {
  S.browseSpecialty = specKey;
  const sp = S.specialties.find(s => s.specialty === specKey);
  const sc = el('study-content');
  if (!sp || !sc) return;

  if (!S.localStats) {
    try { S.localStats = await get('/stats'); } catch(_) { S.localStats = { by_subject: {} }; }
  }
  const bySubj = S.localStats?.by_subject || {};
  let totalSeen = 0, totalCorrect = 0;
  sp.subjects.forEach(s => {
    const st = bySubj[s.subject] || {};
    totalSeen    += st.seen    || 0;
    totalCorrect += st.correct || 0;
  });
  const pctSeen = sp.question_count ? Math.round(totalSeen / sp.question_count * 100) : 0;
  const pctAcc  = totalSeen ? Math.round(totalCorrect / totalSeen * 100) : 0;
  const accColor = pctAcc >= 70 ? 'var(--success)' : pctAcc >= 50 ? 'var(--warn)' : 'var(--danger)';

  const subjRows = sp.subjects.map(s => {
    const st  = bySubj[s.subject] || {};
    const seen = st.seen || 0, corr = st.correct || 0;
    const pct  = s.question_count ? Math.round(seen / s.question_count * 100) : 0;
    const acc  = seen ? Math.round(corr / seen * 100) : 0;
    const aC   = acc >= 70 ? 'var(--success)' : acc >= 50 ? 'var(--warn)' : 'var(--danger)';
    return `<div class="subj-ov-row" data-subj="${attr(s.subject)}">
      <span class="subj-ov-name">${esc(s.subject)} <span style="font-weight:400;color:var(--muted);font-size:.75rem">(${seen}/${s.question_count})</span></span>
      <div class="subj-ov-bar"><div class="subj-ov-fill" style="width:${pct}%"></div></div>
      <span class="subj-ov-pct">${pct}%</span>
      <span class="subj-ov-acc" style="color:${seen ? aC : 'var(--muted)'}">${seen ? acc+'%' : '–'}</span>
    </div>`;
  }).join('');

  sc.innerHTML = `
    <div class="spec-ov">
      <div class="spec-ov-head">
        <h2 class="spec-ov-title">${esc(sp.display_name)}</h2>
        <div class="spec-ov-meta">
          <span>${sp.question_count} questions</span>
          <span class="dot-sep"></span>
          <span>${sp.subjects.length} subject${sp.subjects.length !== 1 ? 's' : ''}</span>
          <span class="dot-sep"></span><span>${totalSeen} seen &nbsp;·&nbsp; ${pctSeen}% covered</span>
        </div>
      </div>

      <div class="spec-ov-progress">
        <div class="spec-ov-stat-row">
          <span class="spec-ov-lbl">Seen</span>
          <div class="spec-ov-bar-wrap"><div class="spec-ov-bar-fill" style="width:${pctSeen}%;background:var(--primary)"></div></div>
          <span class="spec-ov-val">${pctSeen}%</span>
        </div>
        <div class="spec-ov-stat-row">
          <span class="spec-ov-lbl">Accuracy</span>
          <div class="spec-ov-bar-wrap"><div class="spec-ov-bar-fill" style="width:${pctAcc}%;background:${accColor}"></div></div>
          <span class="spec-ov-val">${pctAcc}%</span>
        </div>
      </div>

      <div class="spec-ov-actions">
        <button class="btn btn-primary btn-sm" data-sq="">Quiz All</button>
        <button class="btn btn-outline btn-sm" data-sq="high_yield">High Yield</button>
        <button class="btn btn-outline btn-sm" data-sq="medel">Medium</button>
        <button class="btn btn-outline btn-sm" data-sq="hard">Hard</button>
        <button class="btn btn-ghost btn-sm"   data-sq="unseen">Unseen</button>
      </div>

      ${sp.subjects.length > 1 ? `
      <div class="section-header" style="margin-top:1.25rem">Subjects</div>
      <div class="subj-ov-list">${subjRows}</div>` : ''}
    </div>`;

  sc.querySelector('.spec-ov-actions').onclick = e => {
    const btn = e.target.closest('[data-sq]');
    if (btn) startSpecialtyQuiz(specKey, btn.dataset.sq || null);
  };
  sc.querySelectorAll('.subj-ov-row').forEach(row => {
    row.onclick = () => loadStudySubject(row.dataset.subj);
  });
}

async function startSpecialtyQuiz(specKey, mode) {
  S.quizSpecialty = specKey;
  S.quizSubject   = '';
  S.quizTags      = '';

  if (mode === 'medel' || mode === 'hard') {
    const d    = await get('/quiz/batch', { n: 200, mode: 'normal', specialty: specKey });
    const diffs = mode === 'hard' ? ['svår', 'svar'] : ['medel'];
    const pool  = (d.questions || []).filter(q => diffs.includes(q.difficulty));
    if (!pool.length) return;
    S.quizMode  = 'normal';
    S.quizRun   = { active: true, done: false, queue: pool, position: 0, originalN: pool.length, results: [], reinserted: new Set() };
    S.quizRunId = genId();
    S.currentQ  = pool[0];
    S.answered  = false;
    switchMode('quiz');
    const area = el('quiz-area');
    if (area) { area.innerHTML = buildRunHeader() + buildTimerBar() + buildQuestionCard(S.currentQ); wireQuizArea(); }
    const cfg = TIMER_CFG[S.timerMode]; if (cfg) startQTimer(cfg.s, handleQTimeout);
    return;
  }

  S.quizMode = mode || 'normal';
  resetRun();
  switchMode('quiz');
  setTimeout(loadNextQ, 50);
}

async function loadStudySubject(subject) {
  S.browseSubject = subject;
  S.browseTopic = null;
  // Highlight active subject in sidebar
  document.querySelectorAll('#subj-list [data-si]').forEach(el => {
    const s = _D.subjects[+el.dataset.si];
    el.classList.toggle('active', s && s.subject === subject);
  });

  const sc = el('study-content');
  if (!sc) return;
  sc.innerHTML = '<div class="loading">Loading…</div>';

  const [topics, hy] = await Promise.all([
    get('/topics', { subject }),
    get('/high_yield', { subject }),
  ]);

  _D.topics = topics;
  const topicRows = topics.map((t, i) =>
    `<div class="titem" data-ti="${i}">
       <span>${esc(t.subtopic)}</span>
       <span class="cnt">${t.question_count}q${t.matrix_count ? ' ·'+t.matrix_count+'m' : ''}</span>
     </div>`
  ).join('');

  sc.innerHTML = `
    <div style="display:flex;height:100%;overflow:hidden">
      <div style="width:220px;flex-shrink:0;border-right:1px solid var(--border);overflow-y:auto" id="study-topic-col">
        ${topicRows}
      </div>
      <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
        <div style="padding:.15rem 1.25rem .35rem;flex-shrink:0">
          <button class="study-back-btn" id="study-back">BACK</button>
        </div>
        <div style="flex:1;overflow-y:auto;padding:0 1.25rem 1.25rem" id="topic-detail">
        <div class="card">
          <div class="card-title">${esc(subject)}</div>
          <div class="card-subtitle">${topics.length} topics · ${hy.questions.length} questions</div>
          <div class="section-header" style="margin-top:.75rem">High-Yield Topics</div>
          <div style="display:flex;flex-wrap:wrap;gap:.35rem;margin-bottom:.25rem">
            ${hy.topics.slice(0,8).map(t => `
            <div class="hy-row" data-hy="${attr(t.subtopic)}" style="display:inline-flex;align-items:center;gap:.4rem;cursor:pointer">
              <span style="font-size:.84rem">${esc(t.subtopic)}</span>
              <span class="text-muted" style="font-size:.75rem;flex-shrink:0">${t.count}q</span>
              <div class="hy-bar" style="width:52px;margin-top:0">
                <div class="hy-bar-fill" style="width:${Math.min(100,t.count/(hy.topics[0]?.count||1)*100)}%"></div>
              </div>
            </div>`).join('')}
          </div>
          <div class="btn-row">
            <button class="btn btn-primary btn-sm" data-action="quiz-subject">Quiz this subject</button>
            <button class="btn btn-outline btn-sm" data-action="coverage">Coverage map</button>
            <button class="btn btn-outline btn-sm" data-action="matrix-full">Full matrix</button>
          </div>
        </div>
      </div>
      </div>
    </div>`;

  // Topic column click
  const topicCol = el('study-topic-col');
  topicCol.onclick = e => {
    const item = e.target.closest('[data-ti]');
    if (item) loadStudyTopic(subject, _D.topics[+item.dataset.ti].subtopic);
  };

  // Back button
  el('study-back').onclick = () => {
    S.browseSubject = null;
    S.browseTopic   = null;
    document.querySelectorAll('#subj-list [data-si]').forEach(e => e.classList.remove('active'));
    if (S.browseSpecialty) loadSpecialtyOverview(S.browseSpecialty);
    else sc.innerHTML = '<div class="empty">Select a subject to begin studying</div>';
  };

  // Detail action buttons
  const detail = el('topic-detail');
  detail.onclick = e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) {
      const hy = e.target.closest('[data-hy]');
      if (hy) loadStudyTopic(subject, hy.dataset.hy);
      return;
    }
    const act = btn.dataset.action;
    if (act === 'quiz-subject')  switchToQuiz(subject);
    else if (act === 'coverage') openCoverage(subject);
    else if (act === 'matrix-full') openMatrixFull(subject);
  };
}

async function loadStudyTopic(subject, topic) {
  S.browseTopic = topic;
  // Highlight topic
  document.querySelectorAll('#study-topic-col .titem').forEach(el => {
    const t = _D.topics[+el.dataset.ti];
    el.classList.toggle('active', t && t.subtopic === topic);
  });

  const detail = el('topic-detail');
  if (!detail) return;
  detail.innerHTML = '<div class="loading">Loading…</div>';

  const [qs, mx] = await Promise.all([
    get('/questions', { subject, topic }),
    get('/matrix',    { topic }),
  ]);

  _D.questions = qs;
  detail.innerHTML = `
    <div class="card" style="margin-bottom:.75rem">
      <div class="card-title">${esc(topic)}</div>
      <div class="text-muted" style="margin-bottom:.5rem">${esc(subject)}</div>
      <div class="btn-row" style="margin-top:.5rem">
        <button class="btn btn-primary btn-sm" data-action="quiz-topic">Quiz this topic</button>
      </div>
    </div>
    <div class="tabs" id="study-tabs">
      <button class="tab${S.activeTab==='questions'?' active':''}" data-tab="questions">Questions (${qs.length})</button>
      <button class="tab${S.activeTab==='matrix'?' active':''}"    data-tab="matrix">Matrix (${mx.length})</button>
    </div>
    <div id="tab-content">
      ${S.activeTab === 'questions' ? buildQList(qs) : buildMatrixList(mx)}
    </div>`;

  detail.onclick = e => {
    // Tab switching
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      S.activeTab = tab.dataset.tab;
      detail.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === S.activeTab));
      el('tab-content').innerHTML = S.activeTab === 'questions' ? buildQList(qs) : buildMatrixList(mx);
      return;
    }
    // Action buttons
    const btn = e.target.closest('[data-action]');
    if (btn && btn.dataset.action === 'quiz-topic') { switchToQuiz(subject, topic); return; }
    // Question click
    const qrow = e.target.closest('[data-qidx]');
    if (qrow) { openChain(_D.questions[+qrow.dataset.qidx].id); return; }
  };
}

// =============================================================
// QUIZ RUN SESSIONS
// =============================================================
const MODE_META = {
  normal:          { icon: '🎯', label: 'Normal' },
  high_yield:      { icon: '⭐', label: 'High Yield' },
  weak:            { icon: '💪', label: 'Weak' },
  unseen:          { icon: '🆕', label: 'Unseen' },
  review_archived: { icon: '📁', label: 'Archived' },
  tag:             { icon: '🏷', label: 'By tag' },
};

async function loadRecentRuns() {
  try { return await get('/runs/recent'); } catch(_) { return []; }
}

function buildRunCard(run) {
  const meta    = MODE_META[run.mode] || { icon: '🎯', label: run.mode };
  const total   = (run.question_ids || []).length;
  const pos     = run.position || 0;
  const correct = (run.results || []).filter(r => r.correct).length;
  const ans     = (run.results || []).length;
  const acc     = ans ? Math.round(correct / ans * 100) : null;
  const pct     = total ? Math.round(pos / total * 100) : 0;
  const subj    = run.subject || '';
  const statTxt = run.done
    ? (acc !== null ? acc + '% acc' : 'Done')
    : `Q ${pos} / ${total}`;

  return `<div class="run-card${run.done ? ' run-card-done' : ''}" data-resume="${run.run_id}">
    <div class="run-card-icon">${meta.icon}</div>
    <div class="run-card-body">
      <div class="run-card-mode">${meta.label}</div>
      ${subj ? `<div class="run-card-subj">${esc(subj)}</div>` : ''}
      <div class="run-card-stat">${statTxt}</div>
      ${!run.done && total ? `<div class="run-card-bar"><div class="run-card-fill" style="width:${pct}%"></div></div>` : ''}
    </div>
    ${!run.done ? '<span class="run-card-resume">▶</span>' : ''}
  </div>`;
}

function buildRecentRunsHtml(runs) {
  if (!runs.length) return '';
  const incompleteRun = runs.find(r => !r.done);
  let html = '';

  if (incompleteRun && !S.quizRun.active) {
    const meta  = MODE_META[incompleteRun.mode] || { icon: '🎯', label: incompleteRun.mode };
    const total = (incompleteRun.question_ids || []).length;
    const pos   = incompleteRun.position || 0;
    const subj  = incompleteRun.subject ? ' · ' + incompleteRun.subject : '';
    html += `<div class="continue-banner" id="continue-banner">
      <span>${meta.icon} <strong>${meta.label}${subj}</strong> — Q${pos}/${total}</span>
      <button class="btn btn-primary btn-sm" data-resume="${incompleteRun.run_id}">Resume</button>
      <button class="btn btn-outline btn-sm" id="dismiss-continue">Start new</button>
    </div>`;
  }

  html += `<div class="recent-runs-wrap">
    <div class="section-header" style="margin-top:.5rem;margin-bottom:.4rem">Recent sessions</div>
    <div class="recent-runs-list">${runs.map(buildRunCard).join('')}</div>
  </div>`;
  return html;
}

function wireRecentRuns() {
  const area = el('recent-runs-area');
  if (!area) return;
  area.onclick = e => {
    const resumeBtn = e.target.closest('[data-resume]');
    if (resumeBtn) { resumeRun(resumeBtn.dataset.resume); return; }
    const dismiss = e.target.closest('#dismiss-continue');
    if (dismiss) { const b = el('continue-banner'); if (b) b.remove(); }
  };
}

async function resumeRun(runId) {
  try {
    const runData = await get(`/runs/load/${runId}`);
    if (!runData?.question_ids?.length) return;

    const questions = await post('/questions/hydrate', { ids: runData.question_ids });
    if (!questions?.length) return;

    const qById = {};
    questions.forEach(q => { qById[q.id] = q; });

    const fullResults = (runData.results || []).map(r => ({
      question:   qById[r.id] || { id: r.id },
      selected:   null,
      is_correct: r.correct,
      score:      r.score || 0,
      timedOut:   r.timedOut || false,
    }));

    S.quizRunId     = runId;
    S.quizMode      = runData.mode      || 'normal';
    S.quizSubject   = runData.subject   || '';
    S.quizSpecialty = runData.specialty || '';
    S.timerMode     = runData.timer_mode || '';
    S.quizN         = runData.n         || questions.length;
    S.quizRun = {
      active:    !runData.done,
      done:      !!runData.done,
      queue:     questions,
      position:  runData.position || 0,
      originalN: runData.n || questions.length,
      results:   fullResults,
      reinserted: new Set(),
    };
    S.currentQ = runData.done ? null : (questions[runData.position] || null);
    S.answered = false;

    switchMode('quiz');
    if (!runData.done && S.currentQ) {
      const area = el('quiz-area');
      if (area) { area.innerHTML = buildRunHeader() + buildTimerBar() + buildQuestionCard(S.currentQ); wireQuizArea(); }
      const cfg = TIMER_CFG[S.timerMode]; if (cfg) startQTimer(cfg.s, handleQTimeout);
    }
  } catch(e) { console.warn('resumeRun failed', e); }
}

// =============================================================
// QUIZ MODE
// =============================================================
async function renderQuiz() {
  if (S.quizRun.done) { renderQuizRunResults(); return; }

  if (!S.localStats) {
    try { S.localStats = await get('/stats'); } catch(_) { S.localStats = { by_subject: {}, specialty_total: 1095, old_exam_total: 1079 }; }
  }

  const specOpts = ['<option value="">All specialties</option>',
    ...S.specialties.map(sp => {
      const num = (sp.specialty.match(/^(\d+)/) || [])[1] || '';
      const label = num ? `${num} ${sp.display_name}` : sp.display_name;
      return `<option value="${attr(sp.specialty)}"${sp.specialty===S.quizSpecialty?' selected':''}>${esc(label)}</option>`;
    })
  ].join('');

  const activeSpec = S.specialties.find(s => s.specialty === S.quizSpecialty);
  const subjPool = activeSpec ? activeSpec.subjects : S.subjects;
  const opts = ['<option value="">All subjects</option>',
    ...subjPool.map(s =>
      `<option value="${attr(s.subject)}"${s.subject===S.quizSubject?' selected':''}>${esc(s.subject)}</option>`)
  ].join('');

  const modeOpts = [
    ['normal','Normal'],['high_yield','High Yield'],['weak','Weak (incorrect)'],
    ['unseen','Unseen'],['review_archived','Review archived'],['tag','By tag'],
  ].map(([v,l]) => `<option value="${v}"${v===S.quizMode?' selected':''}>${l}</option>`).join('');

  const nOpts = [10, 20, 30, 50].map(n =>
    `<option value="${n}"${n===S.quizN?' selected':''}>${n}</option>`).join('');


  const run = S.quizRun;
  let areaHtml;
  if (run.active && S.currentQ) {
    areaHtml = buildRunHeader() + buildQuestionCard(S.currentQ);
  } else if (S.currentQ) {
    areaHtml = buildQuestionCard(S.currentQ);
  } else {
    areaHtml = '<div class="empty" style="margin-top:2rem">Press "Next →" to start a run</div>';
  }

  app().innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 250px;height:100%;overflow:hidden">
      <div style="overflow-y:auto;padding:1.25rem 1rem" id="quiz-main">
        <div class="quiz-controls">
          <label>Mode<select id="quiz-mode-sel">${modeOpts}</select></label>
          <label>Specialty<select id="quiz-spec-sel">${specOpts}</select></label>
          <label>Subject<select id="quiz-subj-sel">${opts}</select></label>
          <label>Questions<select id="quiz-n-sel">${nOpts}</select></label>
          ${buildDiffPanel('diff-panel-quiz')}
          ${S.quizMode==='tag'&&S.quizTags?`<span class="badge badge-blue" style="align-self:flex-end">${esc(S.quizTags)}</span>`:''}
          <button class="btn btn-primary" id="quiz-next-btn">Next →</button>
        </div>
        <div id="quiz-area">${areaHtml}</div>
        <div id="recent-runs-area" style="margin-top:.75rem"></div>
      </div>
      <div style="border-left:1px solid var(--border);overflow-y:auto;background:white" id="quiz-progress">
        ${buildProgressPanel()}
      </div>
    </div>`;

  el('quiz-next-btn').onclick = loadNextQ;
  el('quiz-n-sel').onchange = () => { S.quizN = +el('quiz-n-sel').value; };
  el('quiz-mode-sel').onchange = () => { S.quizMode = el('quiz-mode-sel').value; resetRun(); };
  el('quiz-spec-sel').onchange = () => {
    S.quizSpecialty = el('quiz-spec-sel').value;
    S.quizSubject = '';
    const sp = S.specialties.find(s => s.specialty === S.quizSpecialty);
    const pool = sp ? sp.subjects : S.subjects;
    const subjSel = el('quiz-subj-sel');
    if (subjSel) {
      subjSel.innerHTML = '<option value="">All subjects</option>' +
        pool.map(s => `<option value="${attr(s.subject)}">${esc(s.subject)}</option>`).join('');
    }
    resetRun();
  };
  el('quiz-subj-sel').onchange = () => { S.quizSubject = el('quiz-subj-sel').value; S.quizTopic = ''; resetRun(); };
  if (S.currentQ && S.answered) wireAnsweredState();
  wireQuizArea();
  wireProgressPanel();
  wireDiffPanel('diff-panel-quiz');
  if (!S.quizRun.active) {
    loadRecentRuns().then(runs => {
      const area = el('recent-runs-area');
      if (area && runs.length) { area.innerHTML = buildRecentRunsHtml(runs); wireRecentRuns(); }
    });
  }
}

function buildRunHeader() {
  const run = S.quizRun;
  const pos = run.position + 1;
  const total = run.queue.length;
  const pct = total ? Math.round(run.position / total * 100) : 0;
  return `<div class="exam-header">
    <span class="exam-counter">Q ${pos} / ${total}</span>
    <div class="exam-bar"><div class="exam-bar-fill" style="width:${pct}%"></div></div>
  </div>`;
}

async function startQuizRun() {
  const area = el('quiz-area');
  if (area) area.innerHTML = '<div class="loading">Preparing run…</div>';
  try {
    const params = { n: S.quizN, mode: S.quizMode, specialty: S.quizSpecialty, subject: S.quizSubject, topic: S.quizTopic };
    if (S.quizMode === 'tag' && S.quizTags) params.tags = S.quizTags;
    const d = await get('/quiz/batch', params);
    if (!d.questions || !d.questions.length) {
      if (area) area.innerHTML = '<div class="empty">No questions available for this selection.</div>';
      return;
    }
    S.quizRun = { active: true, done: false, queue: d.questions, position: 0, originalN: d.questions.length, results: [], reinserted: new Set() };
    S.quizRunId = genId();
    S.currentQ = d.questions[0];
    S.answered = false;
    if (area) { area.innerHTML = buildRunHeader() + buildTimerBar() + buildQuestionCard(S.currentQ); wireQuizArea(); }
    const cfg = TIMER_CFG[S.timerMode]; if (cfg) startQTimer(cfg.s, handleQTimeout);
  } catch(e) {
    if (area) area.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`;
  }
}

function buildProgressPanel() {
  const ls = S.localStats || {};
  const bySubj = ls.by_subject || {};
  const specTotal = ls.specialty_total || S.subjects.reduce((a,s)=>a+(s.question_count||0),0);
  const specSeen  = ls.specialty_seen ?? S.stats.seen;
  const specPct   = specTotal ? Math.round(specSeen/specTotal*100) : 0;
  const oldTotal  = ls.old_exam_total || 1079;
  const oldSeen   = ls.old_exam_seen  || 0;
  const oldPct    = oldTotal ? Math.round(oldSeen/oldTotal*100) : 0;

  const specRows = S.specialties.map(sp => {
    let seen=0, correct=0;
    sp.subjects.forEach(s => {
      const st = bySubj[s.subject]||{};
      seen += st.seen||0; correct += st.correct||0;
    });
    const pct = sp.question_count ? Math.round(seen/sp.question_count*100) : 0;
    const acc  = seen ? Math.round(correct/seen*100) : 0;
    const isActive = S.quizSubject && sp.subjects.some(s=>s.subject===S.quizSubject);
    return `
      <div class="prog-spec-row${isActive?' prog-active':''}" data-spec="${attr(sp.specialty)}" title="${esc(sp.display_name)}: ${seen}/${sp.question_count} seen, ${acc}% accuracy">
        <div style="display:flex;justify-content:space-between;font-size:.73rem;margin-bottom:2px">
          <span style="font-weight:${isActive?'700':'500'};truncate">${esc(sp.display_name)}</span>
          <span style="color:var(--muted)">${pct}%</span>
        </div>
        <div style="height:5px;background:var(--border);border-radius:3px;overflow:hidden">
          <div style="height:100%;border-radius:3px;background:${isActive?'var(--primary)':'#93c5fd'};width:${pct}%;transition:width .3s"></div>
        </div>
        <div style="font-size:.65rem;color:var(--muted);margin-top:1px">${seen}/${sp.question_count} &nbsp; ${acc}% acc</div>
      </div>`;
  }).join('');

  return `
    <div style="padding:.85rem">
      <div style="font-size:.78rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-bottom:.6rem">Progress</div>
      <div style="background:var(--bg);border-radius:8px;padding:.65rem .75rem;margin-bottom:.6rem">
        <div style="display:flex;justify-content:space-between;font-size:.75rem;margin-bottom:3px">
          <span>Specialty bank</span><span style="color:var(--primary);font-weight:700">${specPct}%</span>
        </div>
        <div style="height:7px;background:var(--border);border-radius:4px;overflow:hidden;margin-bottom:4px">
          <div style="height:100%;background:var(--primary);width:${specPct}%;border-radius:4px;transition:width .4s"></div>
        </div>
        <div style="font-size:.7rem;color:var(--muted)">${specSeen} / ${specTotal} questions</div>
      </div>
      <div style="background:var(--bg);border-radius:8px;padding:.65rem .75rem;margin-bottom:.75rem">
        <div style="display:flex;justify-content:space-between;font-size:.75rem;margin-bottom:3px">
          <span>Past exams</span><span style="color:var(--warn);font-weight:700">${oldPct}%</span>
        </div>
        <div style="height:7px;background:var(--border);border-radius:4px;overflow:hidden;margin-bottom:4px">
          <div style="height:100%;background:var(--warn);width:${oldPct}%;border-radius:4px;transition:width .4s"></div>
        </div>
        <div style="font-size:.7rem;color:var(--muted)">${oldSeen} / ${oldTotal} questions</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.3rem;margin-bottom:.75rem;text-align:center">
        <div style="background:#f0fdf4;border-radius:6px;padding:.3rem .25rem">
          <div style="font-size:1rem;font-weight:700;color:var(--success)">${S.stats.correct||0}</div>
          <div style="font-size:.65rem;color:var(--muted)">correct</div>
        </div>
        <div style="background:#fef2f2;border-radius:6px;padding:.3rem .25rem">
          <div style="font-size:1rem;font-weight:700;color:var(--danger)">${S.stats.incorrect||0}</div>
          <div style="font-size:.65rem;color:var(--muted)">wrong</div>
        </div>
        <div style="background:#eff6ff;border-radius:6px;padding:.3rem .25rem">
          <div style="font-size:1rem;font-weight:700;color:var(--primary)">${S.stats.accuracy||0}%</div>
          <div style="font-size:.65rem;color:var(--muted)">acc</div>
        </div>
      </div>
      <div style="font-size:.72rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.4rem">By specialty — click to filter</div>
      <div id="spec-progress-list">${specRows}</div>
    </div>`;
}

function wireProgressPanel() {
  const list = el('spec-progress-list');
  if (!list) return;
  list.onclick = e => {
    const row = e.target.closest('[data-spec]');
    if (!row) return;
    const sp = S.specialties.find(x => x.specialty === row.dataset.spec);
    if (!sp || !sp.subjects.length) return;
    S.quizMode = 'unseen'; S.quizSpecialty = sp.specialty; S.quizSubject = ''; S.quizTopic = ''; S.quizTags = '';
    resetRun();
    renderQuiz().then(() => loadNextQ());
  };
}

function wireQuizArea() {
  const area = el('quiz-area');
  if (!area) return;
  area.onclick = e => {
    const ob = e.target.closest('.option-btn');
    if (ob && !ob.disabled) { handleAnswer(ob.dataset.letter); return; }
    const btn = e.target.closest('[data-qa]');
    if (!btn) return;
    const act = btn.dataset.qa;
    if (act === 'next')    loadNextQ();
    else if (act === 'archive') archiveCurrentQ();
    else if (act === 'chain' && S.currentQ) openChain(S.currentQ.id);
  };
}

function buildQuestionCard(q, showActions = true) {
  const letters = Object.keys(q.options || {});
  return `
    <div class="card">
      <div class="question-meta">
        ${diffBadge(q.difficulty)} ${typBadge(q.typ)}
        <span class="badge badge-blue">${esc(q.subtopic)}</span>
        ${q.needs_review ? '<span class="badge badge-yellow">Review needed</span>' : ''}
      </div>
      <div class="question-text">${esc(q.question)}</div>
      <div class="options" id="options-list">
        ${letters.map(k =>
          `<button class="option-btn" data-letter="${k}">${k}. ${esc(q.options[k])}</button>`
        ).join('')}
      </div>
      <div id="explanation-area"></div>
      ${showActions ? `<div class="btn-row" id="quiz-actions">
        <button class="btn btn-outline btn-sm" data-qa="archive">Archive</button>
        <button class="btn btn-ghost btn-sm"   data-qa="chain">Topic chain</button>
      </div>` : ''}
    </div>`;
}

function wireAnsweredState() {
  // Disable buttons after answer revealed
  document.querySelectorAll('.option-btn').forEach(b => b.disabled = true);
}

async function loadNextQ() {
  if (el('quiz-mode-sel')) S.quizMode     = el('quiz-mode-sel').value;
  if (el('quiz-spec-sel')) S.quizSpecialty = el('quiz-spec-sel').value;
  if (el('quiz-subj-sel')) S.quizSubject  = el('quiz-subj-sel').value;
  if (el('quiz-n-sel'))    S.quizN        = +el('quiz-n-sel').value;

  const run = S.quizRun;

  if (!run.active) { await startQuizRun(); return; }

  run.position++;
  S.answered = false;

  if (run.position >= run.queue.length) {
    run.active = false;
    run.done = true;
    S.currentQ = null;
    saveRun();
    renderQuizRunResults();
    return;
  }

  S.currentQ = run.queue[run.position];
  const area = el('quiz-area');
  if (area) { area.innerHTML = buildRunHeader() + buildTimerBar() + buildQuestionCard(S.currentQ); wireQuizArea(); }
  const cfg = TIMER_CFG[S.timerMode]; if (cfg) startQTimer(cfg.s, handleQTimeout);
}

async function handleAnswer(letter) {
  if (S.answered || !S.currentQ) return;
  S.answered = true;
  stopQTimer();
  document.querySelectorAll('.option-btn').forEach(b => b.disabled = true);

  const d = await post('/answer', { question_id: S.currentQ.id, selected: letter });
  const q = d.question;
  trackLocalAnswer(S.currentQ, d.is_correct);
  updateStats(d.stats);

  const score = calcScore(S.currentQ.difficulty, d.is_correct);
  if (d.is_correct) { S.totalScore += score; localStorage.setItem('kir_score', S.totalScore); updateScoreDisplay(); }

  const run = S.quizRun;
  if (run.active) {
    run.results.push({ question: S.currentQ, selected: letter, is_correct: d.is_correct, score });
    if (!d.is_correct) {
      if (!run.reinserted) run.reinserted = new Set();
      if (!run.reinserted.has(S.currentQ.id)) {
        run.reinserted.add(S.currentQ.id);
        const delay = 3 + Math.floor(Math.random() * 3);
        const insertAt = Math.min(run.position + 1 + delay, run.queue.length);
        run.queue.splice(insertAt, 0, S.currentQ);
      }
    }
  }

  document.querySelectorAll('.option-btn').forEach(b => {
    if (b.dataset.letter === q.correct)                b.classList.add('correct');
    else if (b.dataset.letter === letter && !d.is_correct) b.classList.add('incorrect');
  });

  const expl = el('explanation-area');
  if (expl) expl.innerHTML = `
    <div class="explanation-box">
      <h4>${d.is_correct ? `✓ Correct! <span style="font-size:.8rem;font-weight:500">+${score} pts</span>` : `✗ Incorrect — correct: ${q.correct} <span style="font-size:.8rem;font-weight:400;color:var(--muted)">0 pts</span>`}</h4>
      <div>${esc(q.explanation)}</div>
      ${q.distractors ? `<div class="distractors" style="margin-top:.4rem"><strong>Why others wrong:</strong> ${esc(q.distractors)}</div>` : ''}
      ${q.source ? `<div class="source" style="margin-top:.4rem;color:var(--muted);font-size:.75rem">Source: ${esc(q.source)}</div>` : ''}
    </div>`;

  const actions = el('quiz-actions');
  if (actions) actions.innerHTML = `
    <button class="btn btn-primary" data-qa="next">Next →</button>
    <button class="btn btn-outline btn-sm" data-qa="archive">Archive</button>
    <button class="btn btn-ghost btn-sm" data-qa="chain">Topic chain</button>`;
  saveRun();
}

async function archiveCurrentQ() {
  if (!S.currentQ) return;
  stopQTimer();
  const d = await post('/archive', { question_id: S.currentQ.id });
  updateStats(d.stats);
  loadNextQ();
}

function renderQuizRunResults() {
  const run = S.quizRun;
  const byId = {};
  run.results.forEach(r => { byId[r.question.id] = r; });
  const unique = Object.values(byId);
  const total = unique.length;
  const correct = unique.filter(r => r.is_correct).length;
  const pct = total ? Math.round(correct / total * 100) : 0;
  const incorrectQs = unique.filter(r => !r.is_correct).map(r => r.question);
  const color = pct >= 70 ? 'var(--success)' : pct >= 50 ? 'var(--warn)' : 'var(--danger)';

  const rows = unique.map(r => `
    <div class="result-row ${r.is_correct ? 'correct' : 'incorrect'}">
      <span class="result-icon">${r.is_correct ? '✓' : '✗'}</span>
      <div class="result-body">
        <div class="result-q">${esc(r.question.question.substring(0, 100))}${r.question.question.length > 100 ? '…' : ''}</div>
        <div class="result-ans">
          <span class="chip">${esc(r.question.subtopic)}</span>
          ${diffBadge(r.question.difficulty)}
        </div>
      </div>
    </div>`).join('');

  app().innerHTML = `
    <div class="full-width">
      <div style="max-width:640px;margin:0 auto">
        <div class="results-header">
          <div class="results-score" style="color:${color}">${correct} / ${total}</div>
          <div class="results-label">${pct}% correct this run &nbsp;·&nbsp; +${run.results.reduce((s,r)=>s+(r.score||0),0)} pts</div>
          <div class="btn-row" style="justify-content:center;margin-top:1rem">
            ${incorrectQs.length ? `<button class="btn btn-danger" id="retry-wrong-btn">Repeat incorrect (${incorrectQs.length})</button>` : ''}
            <button class="btn btn-primary" id="new-run-btn">New run</button>
            <button class="btn btn-outline" id="back-quiz-btn">Quiz menu</button>
          </div>
        </div>
        <div>${rows}</div>
      </div>
    </div>`;

  if (incorrectQs.length) {
    el('retry-wrong-btn').onclick = () => {
      S.quizRun = { active: true, done: false, queue: [...incorrectQs], position: 0, originalN: incorrectQs.length, results: [], reinserted: new Set() };
      S.currentQ = incorrectQs[0];
      S.answered = false;
      S.mode = 'quiz';
      document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
      const nb = el('nav-quiz');
      if (nb) nb.classList.add('active');
      renderQuiz();
    };
  }
  el('new-run-btn').onclick = () => { resetRun(); switchMode('quiz'); setTimeout(loadNextQ, 50); };
  el('back-quiz-btn').onclick = () => { resetRun(); switchMode('quiz'); };
}

function switchToQuiz(subject, topic) {
  S.quizSubject   = subject || '';
  S.quizTopic     = topic   || '';
  S.quizMode      = 'normal';
  const sp = S.specialties.find(s => s.subjects.some(sub => sub.subject === subject));
  S.quizSpecialty = sp ? sp.specialty : '';
  resetRun();
  switchMode('quiz');
  setTimeout(loadNextQ, 50);
}

// =============================================================
// EXAM MODE
// =============================================================
async function renderExam() {
  if (S.examDone)   { renderExamResults(S.examResults); return; }
  if (S.examActive) { renderExamQuestion();              return; }
  renderExamStart();
}

function renderExamStart() {
  const ls = S.localStats || {};
  const specSeen  = ls.specialty_seen  ?? S.stats.seen;
  const specTotal = ls.specialty_total ?? 1095;
  const oldSeen   = ls.old_exam_seen   ?? 0;
  const oldTotal  = ls.old_exam_total  ?? 1079;
  const specPct   = specTotal ? Math.round(specSeen/specTotal*100) : 0;
  const oldPct    = oldTotal  ? Math.round(oldSeen/oldTotal*100)   : 0;

  app().innerHTML = `
    <div class="full-width centered">
      <div class="exam-start" style="max-width:680px">
        <h2 style="font-size:1.6rem;margin-bottom:.4rem">Tentamen</h2>
        <p style="color:var(--muted);margin-bottom:1.5rem;font-size:.9rem">60 frågor. Ingen feedback ges under tentamen — resultat visas i slutet.</p>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem">

          <div class="exam-source-card" id="src-specialty" data-src="specialty" style="border:2px solid var(--primary);background:#eff6ff">
            <div style="font-size:1.1rem;font-weight:700;color:var(--primary);margin-bottom:.3rem">Specialitetsbank</div>
            <p style="font-size:.82rem;color:var(--muted);margin-bottom:.75rem">15 Anestesi · 15 Kirurgi · 15 Ortopedi · 15 Övriga</p>
            <div style="font-size:.75rem;margin-bottom:3px;display:flex;justify-content:space-between">
              <span>Din täckning</span><span style="color:var(--primary);font-weight:700">${specPct}%</span>
            </div>
            <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden">
              <div style="height:100%;background:var(--primary);width:${specPct}%;border-radius:3px"></div>
            </div>
            <div style="font-size:.7rem;color:var(--muted);margin-top:3px">${specSeen} / ${specTotal} frågor sedda</div>
          </div>

          <div class="exam-source-card" id="src-old" data-src="old_exam" style="border:2px solid var(--border)">
            <div style="font-size:1.1rem;font-weight:700;margin-bottom:.3rem">Gamla tentor</div>
            <p style="font-size:.82rem;color:var(--muted);margin-bottom:.75rem">Frågor från normaliserade gamla tentamen (${oldTotal} totalt)</p>
            <div style="font-size:.75rem;margin-bottom:3px;display:flex;justify-content:space-between">
              <span>Din täckning</span><span style="color:var(--warn);font-weight:700">${oldPct}%</span>
            </div>
            <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden">
              <div style="height:100%;background:var(--warn);width:${oldPct}%;border-radius:3px"></div>
            </div>
            <div style="font-size:.7rem;color:var(--muted);margin-top:3px">${oldSeen} / ${oldTotal} frågor sedda</div>
          </div>
        </div>

        <div style="display:flex;justify-content:center;margin-bottom:1.25rem">
          ${buildDiffPanel('diff-panel-exam')}
        </div>
        <div style="text-align:center">
          <button class="btn btn-primary" id="start-exam-btn" style="padding:.6rem 2rem;font-size:1rem">Starta tentamen</button>
        </div>
      </div>
    </div>`;

  S.examSource = 'specialty';  // default

  // Source card selection
  document.querySelectorAll('.exam-source-card').forEach(card => {
    card.onclick = () => {
      S.examSource = card.dataset.src;
      document.querySelectorAll('.exam-source-card').forEach(c => {
        c.style.border = '2px solid var(--border)';
        c.style.background = 'white';
      });
      card.style.border = '2px solid var(--primary)';
      card.style.background = '#eff6ff';
    };
  });

  wireDiffPanel('diff-panel-exam');
  el('start-exam-btn').onclick = startExam;
}

async function startExam() {
  const d = await post('/exam/generate', { source: S.examSource || 'specialty' });
  S.examQuestions   = d.questions;
  S.examAnswers     = {};
  S.examIndex       = 0;
  S.examActive      = true;
  S.examDone        = false;
  S.examSourceUsed  = d.source || 'specialty';
  renderExamQuestion();
}

function renderExamQuestion() {
  const q   = S.examQuestions[S.examIndex];
  const n   = S.examQuestions.length;
  const pct = (S.examIndex / n * 100).toFixed(1);
  const ans = Object.keys(S.examAnswers).length;

  const dots = S.examQuestions.map((_, i) =>
    `<div class="edot${S.examAnswers[i]?' answered':''}${i===S.examIndex?' current':''}" data-ei="${i}">${i+1}</div>`
  ).join('');

  app().innerHTML = `
    <div class="full-width centered">
      <div class="exam-header">
        <span class="exam-counter">Q ${S.examIndex+1} / ${n}</span>
        <div class="exam-bar"><div class="exam-bar-fill" style="width:${pct}%"></div></div>
        <span class="exam-counter" style="color:var(--success)" id="exam-ans-count">${ans} answered</span>
      </div>
      ${buildTimerBar()}
      <div class="card">
        <div class="question-meta">
          ${diffBadge(q.difficulty)}
          <span class="badge badge-blue">${esc(q.subtopic)}</span>
          <span class="badge badge-gray">${esc(q.specialty||'')}</span>
        </div>
        <div class="question-text">${esc(q.question)}</div>
        <div class="options" id="exam-options">
          ${Object.entries(q.options||{}).map(([k,v]) =>
            `<button class="option-btn${S.examAnswers[S.examIndex]===k?' selected':''}" data-letter="${k}">${k}. ${esc(v)}</button>`
          ).join('')}
        </div>
      </div>
      <div class="exam-grid" id="exam-dots">${dots}</div>
      <div class="exam-nav">
        <button class="btn btn-outline" id="exam-prev" ${S.examIndex===0?'disabled':''}>← Previous</button>
        ${S.examIndex < n-1
          ? `<button class="btn btn-primary" id="exam-next">Next →</button>`
          : `<button class="btn btn-success" id="exam-submit">Submit Exam</button>`}
      </div>
    </div>`;

  const ecfg = TIMER_CFG[S.timerMode]; if (ecfg) startQTimer(ecfg.s, handleExamTimeout);

  el('exam-options').onclick = e => {
    const ob = e.target.closest('.option-btn');
    if (ob) examSelect(ob.dataset.letter);
  };
  el('exam-dots').onclick = e => {
    const dot = e.target.closest('[data-ei]');
    if (dot) { S.examIndex = +dot.dataset.ei; renderExamQuestion(); }
  };
  el('exam-prev').onclick = () => { S.examIndex = Math.max(0, S.examIndex-1); renderExamQuestion(); };
  const next = el('exam-next');
  if (next) next.onclick = () => { S.examIndex++; renderExamQuestion(); };
  const sub = el('exam-submit');
  if (sub) sub.onclick = submitExam;
}

function examSelect(letter) {
  S.examAnswers[S.examIndex] = letter;
  document.querySelectorAll('#exam-options .option-btn').forEach(b =>
    b.classList.toggle('selected', b.dataset.letter === letter));
  document.querySelectorAll('#exam-dots .edot').forEach((d, i) =>
    d.classList.toggle('answered', !!S.examAnswers[i]));
  const cnt = el('exam-ans-count');
  if (cnt) cnt.textContent = Object.keys(S.examAnswers).length + ' answered';
}

async function submitExam() {
  stopQTimer();
  const answers = {};
  S.examQuestions.forEach((q, i) => { if (S.examAnswers[i]) answers[q.id] = S.examAnswers[i]; });
  const d = await post('/exam/submit', { answers, source: S.examSourceUsed || 'specialty' });
  S.examActive = false; S.examDone = true; S.examResults = d;
  // Update local stats for old exam tracking
  if (S.examSourceUsed === 'old_exam') {
    if (!S.localStats) S.localStats = { by_subject:{}, old_exam_seen:0, old_exam_total:1079, specialty_seen:0, specialty_total:1095 };
    S.localStats.old_exam_seen = (S.localStats.old_exam_seen||0) + Object.keys(answers).length;
  }
  S.localStats = null;  // force refresh on next quiz render
  updateStats(d.stats);
  renderExamResults(d);
}

function renderExamResults(d) {
  const examScore = d.results.reduce((sum, r) => sum + calcScore(r.difficulty || 'medel', r.is_correct), 0);
  if (examScore > 0) { S.totalScore += examScore; localStorage.setItem('kir_score', S.totalScore); updateScoreDisplay(); }
  const pct   = d.percentage;
  const color = pct >= 70 ? 'var(--success)' : pct >= 50 ? 'var(--warn)' : 'var(--danger)';
  _D.questions = d.results.map(r => ({ id: r.question_id }));

  const rows = d.results.map((r, i) => `
    <div class="result-row ${r.is_correct?'correct':'incorrect'}" data-qidx="${i}" style="cursor:pointer">
      <span class="result-icon">${r.is_correct ? '✓' : '✗'}</span>
      <div class="result-body">
        <div class="result-q">${esc(r.question.substring(0,120))}${r.question.length>120?'…':''}</div>
        <div class="result-ans">
          Your: <strong>${r.selected||'—'}</strong> &nbsp; Correct: <span class="right">${r.correct}</span>
          &nbsp; <span class="chip">${esc(r.subject)}</span> <span class="chip">${esc(r.subtopic)}</span>
        </div>
      </div>
    </div>`).join('');

  app().innerHTML = `
    <div class="full-width">
      <div class="results-header">
        <div class="results-score" style="color:${color}">${d.score}/${d.total}</div>
        <div class="results-label">${pct}% correct &nbsp;·&nbsp; +${examScore} pts</div>
        <div style="margin-top:1rem">
          <button class="btn btn-primary" id="new-exam-btn">New Exam</button>
          <button class="btn btn-outline" id="review-wrong-btn" style="margin-left:.5rem">Review incorrect</button>
        </div>
      </div>
      <div id="results-list">${rows}</div>
    </div>`;

  el('new-exam-btn').onclick = () => { S.examDone=false; S.examActive=false; renderExamStart(); };
  el('review-wrong-btn').onclick = () => { S.quizMode='weak'; S.quizSpecialty=''; S.quizSubject=''; resetRun(); switchMode('quiz'); setTimeout(loadNextQ,50); };
  el('results-list').onclick = e => {
    const row = e.target.closest('[data-qidx]');
    if (row) openChain(d.results[+row.dataset.qidx].question_id);
  };
}

// =============================================================
// EXPLORE MODE
// =============================================================
async function renderExplore() {

  app().innerHTML = `
    <div class="pane-layout">
      <div class="sidebar">
        <div class="sidebar-search">
          <input id="exp-search" placeholder="Filter subjects…" oninput="filterExploreSubjects()"/>
        </div>
        <div class="sidebar-list" id="exp-subj-list"></div>
      </div>
      <div class="content" id="explore-content">
        <div class="empty">Select a subject to explore all data</div>
      </div>
    </div>`;
  buildExploreSidebar();
  if (S.exploreSubject) loadExploreSubject(S.exploreSubject);
}

function buildExploreSidebar() {
  buildSpecialtySidebar('exp-subj-list', S.specialties, 'explore');
}

function filterExploreSubjects() {
  buildSpecialtySidebar('exp-subj-list', S.specialties, 'explore');
}

async function loadExploreSubject(subject) {
  S.exploreSubject = subject;
  S.activeTags = new Set();
  document.querySelectorAll('#exp-subj-list [data-si]').forEach(el => {
    const s = _D.subjects[+el.dataset.si];
    el.classList.toggle('active', s && s.subject === subject);
  });

  const ec = el('explore-content');
  if (!ec) return;
  ec.innerHTML = '<div class="loading">Loading…</div>';

  const [topics, mx, hy] = await Promise.all([
    get('/topics', { subject }),
    get('/matrix', { subject }),
    get('/high_yield', { subject }),
  ]);
  _D.topics = topics;

  const allTags = [...new Set(mx.flatMap(m => m.tags||[]))];

  ec.innerHTML = `
    <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
      <div style="padding:.75rem 1rem;background:white;border-bottom:1px solid var(--border);flex-shrink:0">
        <div style="font-weight:700;font-size:1rem;margin-bottom:.3rem">${esc(subject)}</div>
        <div id="tag-bar" style="display:flex;flex-wrap:wrap;gap:.3rem;margin-bottom:.4rem">
          ${allTags.map(t => `<span class="tag" data-etag="${attr(t)}">${esc(t)}</span>`).join('')}
        </div>
        <div class="btn-row" style="margin-top:.25rem">
          <button class="btn btn-outline btn-sm" data-expact="coverage">Coverage map</button>
          <button class="btn btn-outline btn-sm" data-expact="matrix-full">Full matrix</button>
          <button class="btn btn-primary btn-sm" data-expact="quiz">Quiz subject</button>
          <button class="btn btn-success btn-sm" id="quiz-tag-btn" data-expact="quiz-tag" style="display:none">Quiz by tag</button>
        </div>
      </div>
      <div style="flex:1;overflow:hidden;display:flex">
        <div style="width:200px;flex-shrink:0;border-right:1px solid var(--border);overflow-y:auto" id="exp-topic-col">
          ${topics.map((t, i) => `
            <div class="titem" data-ti="${i}">
              <span>${esc(t.subtopic)}</span><span class="cnt">${t.question_count}q</span>
            </div>`).join('')}
        </div>
        <div style="flex:1;overflow-y:auto;padding:1rem" id="exp-detail">
          ${buildExploreOverview(hy, mx)}
        </div>
      </div>
    </div>`;

  ec.onclick = e => {
    // Tag filter
    const tag = e.target.closest('[data-etag]');
    if (tag) { toggleExploreTag(tag.dataset.etag, subject); return; }
    // Action buttons
    const btn = e.target.closest('[data-expact]');
    if (btn) {
      const act = btn.dataset.expact;
      if (act === 'coverage')         openCoverage(subject);
      else if (act === 'matrix-full') openMatrixFull(subject);
      else if (act === 'quiz')        switchToQuiz(subject);
      else if (act === 'quiz-tag') {
        S.quizMode = 'tag'; S.quizTags = [...S.activeTags].join(',');
        S.quizSubject = subject; S.quizSpecialty = '';
        const spObj = S.specialties.find(s => s.subjects.some(sub => sub.subject === subject));
        if (spObj) S.quizSpecialty = spObj.specialty;
        resetRun(); switchMode('quiz'); setTimeout(loadNextQ, 50);
      }
      return;
    }
    // Topic column
    const ti = e.target.closest('[data-ti]');
    if (ti) { loadExploreTopic(subject, _D.topics[+ti.dataset.ti].subtopic); return; }
    // Question rows in detail pane
    const qrow = e.target.closest('[data-qidx]');
    if (qrow) { openChain(_D.questions[+qrow.dataset.qidx].id); return; }
  };
}

function buildExploreOverview(hy, mx) {
  return `
    <div class="section-header">High-Yield Topics</div>
    ${hy.topics.slice(0,6).map(t => `
      <div style="display:flex;gap:.75rem;align-items:center;margin-bottom:.35rem;cursor:pointer" data-hy-topic="${attr(t.subtopic)}">
        <span style="flex:1;font-size:.84rem">${esc(t.subtopic)}</span>
        <span class="text-muted" style="font-size:.75rem">${t.count}q</span>
        <div class="hy-bar" style="width:70px">
          <div class="hy-bar-fill" style="width:${Math.min(100,t.count/(hy.topics[0]?.count||1)*100)}%"></div>
        </div>
      </div>`).join('')}
    <div class="section-header" style="margin-top:1rem">Matrix Entities (${mx.length})</div>
    ${mx.slice(0,4).map(m => buildMatrixEntity(m)).join('')}
    ${mx.length > 4 ? `<p class="text-muted" style="font-size:.8rem">+${mx.length-4} more — click a topic to see all</p>` : ''}`;
}

async function loadExploreTopic(subject, topic) {
  S.exploreTopic = topic;
  document.querySelectorAll('#exp-topic-col .titem').forEach(el => {
    const t = _D.topics[+el.dataset.ti];
    el.classList.toggle('active', t && t.subtopic === topic);
  });

  const detail = el('exp-detail');
  if (!detail) return;
  detail.innerHTML = '<div class="loading">Loading…</div>';

  const [qs, mx] = await Promise.all([
    get('/questions', { subject, topic }),
    get('/matrix', { topic }),
  ]);

  let filtered = qs;
  if (S.activeTags.size) {
    const activeMx = mx.filter(m => m.tags.some(t => S.activeTags.has(t)));
    if (activeMx.length) {
      const entitySet = new Set(activeMx.map(m => m.entity));
      filtered = qs.filter(q => entitySet.has(q.subtopic));
    }
  }
  _D.questions = filtered;

  detail.innerHTML = `
    <div class="card" style="margin-bottom:.75rem">
      <div class="card-title">${esc(topic)}</div>
      <button class="btn btn-primary btn-sm" data-expact="quiz-topic">Quiz this topic</button>
    </div>
    <div class="section-header">Matrix (${mx.length})</div>
    ${mx.map(m => buildMatrixEntity(m)).join('') || '<div class="empty">No matrix entries</div>'}
    <div class="section-header">Questions (${filtered.length})</div>
    ${buildQList(filtered)}`;

  // Wire quiz-topic button via parent onclick (already set up on ec)
  detail.querySelector('[data-expact="quiz-topic"]').onclick = e => {
    e.stopPropagation();
    switchToQuiz(subject, topic);
  };
}

function toggleExploreTag(tag, subject) {
  if (S.activeTags.has(tag)) S.activeTags.delete(tag);
  else S.activeTags.add(tag);
  document.querySelectorAll('[data-etag]').forEach(el =>
    el.classList.toggle('active', S.activeTags.has(el.dataset.etag)));
  // Show/hide "Quiz by tag" button
  const qb = el('quiz-tag-btn');
  if (qb) {
    qb.style.display = S.activeTags.size ? '' : 'none';
    qb.textContent = S.activeTags.size
      ? `Quiz by tag (${[...S.activeTags].join(', ')})`
      : 'Quiz by tag';
  }
  if (S.exploreTopic) loadExploreTopic(subject, S.exploreTopic);
}

// =============================================================
// SHARED RENDERERS
// =============================================================
function buildQList(questions) {
  if (!questions.length) return '<div class="empty">No questions</div>';
  _D.questions = questions;
  return questions.map((q, i) => `
    <div class="q-row" data-qidx="${i}">
      <span class="q-status ${statusClass(q)}"></span>
      <div class="q-text">${esc(q.question.substring(0,120))}${q.question.length>120?'…':''}</div>
      <div class="q-badges">${diffBadge(q.difficulty)}</div>
    </div>`).join('');
}

function buildMatrixList(entities) {
  if (!entities.length) return '<div class="empty">No matrix entries</div>';
  return entities.map(m => buildMatrixEntity(m)).join('');
}

function buildMatrixEntity(m) {
  const rows = [
    ['When to suspect', m.when_to_suspect],
    ['Discriminators',  m.discriminators],
    ['Investigation',   m.investigation],
    ['Initial mgmt',    m.initial_management],
    ['Definitive mgmt', m.definitive_management],
    ['Complications',   m.complications],
    ['Pitfalls',        m.pitfalls],
    ['Memory hooks',    m.memory_hooks],
  ].filter(([, v]) => v && v.length);

  return `
    <div class="matrix-entity">
      <div class="matrix-entity-title">
        <span>${esc(m.entity)}</span><span class="chip">${esc(m.area)}</span>
      </div>
      ${m.tags && m.tags.length ? `<div style="margin-bottom:.5rem">${m.tags.map(t=>`<span class="tag" data-etag="${attr(t)}">${esc(t)}</span>`).join('')}</div>` : ''}
      ${rows.map(([label, items]) => `
        <div class="matrix-row">
          <span class="matrix-label">${label}</span>
          <div class="matrix-val">${list(items)}</div>
        </div>`).join('')}
    </div>`;
}

// =============================================================
// MODALS
// =============================================================
function openModal(html) {
  el('modal-body').innerHTML = html;
  el('modal').classList.remove('hidden');
}
function closeModal() { el('modal').classList.add('hidden'); }

async function openChain(qid) {
  openModal('<div class="loading">Loading chain…</div>');
  const d = await get('/chain', { question_id: qid });
  const q = d.question;
  _D.questions = d.sibling_questions || [];

  el('modal-body').innerHTML = `
    <div class="modal-title">Topic Chain: ${esc(q.subtopic)} → ${esc(q.subject)}</div>
    <div class="question-meta">${diffBadge(q.difficulty)} ${typBadge(q.typ)} <span class="badge badge-blue">${esc(q.subject)}</span></div>
    <div class="question-text" style="margin-top:.75rem">${esc(q.question)}</div>
    <div style="background:var(--bg);border-radius:8px;padding:.75rem;margin:.75rem 0;font-size:.85rem">
      ${Object.entries(q.options||{}).map(([k,v])=>`<div><strong>${k}</strong>  ${esc(v)}</div>`).join('')}
    </div>
    <div class="explanation-box">
      <h4>Correct: ${q.correct}</h4>
      <div>${esc(q.explanation)}</div>
      ${q.distractors ? `<div class="distractors" style="margin-top:.4rem"><strong>Why others wrong:</strong> ${esc(q.distractors)}</div>` : ''}
      ${q.source ? `<div class="source" style="margin-top:.4rem;font-size:.75rem;color:var(--muted)">Source: ${esc(q.source)}</div>` : ''}
    </div>
    ${d.matrix_entities.length ? `
      <div class="section-header" style="margin-top:1rem">Matrix Entities</div>
      ${d.matrix_entities.map(m => buildMatrixEntity(m)).join('')}` : ''}
    ${_D.questions.length ? `
      <div class="section-header" style="margin-top:1rem">Related Questions (same subtopic)</div>
      <div id="chain-siblings">${buildQList(_D.questions.slice(0,5))}</div>` : ''}
    <div class="btn-row" style="margin-top:1rem">
      <button class="btn btn-outline btn-sm" id="chain-archive-btn">Archive this question</button>
    </div>`;

  el('chain-archive-btn').onclick = async () => {
    const d2 = await post('/archive', { question_id: qid });
    updateStats(d2.stats);
    closeModal();
  };
  const siblings = el('chain-siblings');
  if (siblings) {
    siblings.onclick = e => {
      const qrow = e.target.closest('[data-qidx]');
      if (qrow) openChain(_D.questions[+qrow.dataset.qidx].id);
    };
  }
}

async function openCoverage(subject) {
  openModal('<div class="loading">Loading coverage map…</div>');
  const d = await get('/coverage', { subject });
  el('modal-body').innerHTML = `
    <div class="modal-title">Coverage Map — ${esc(subject)}</div>
    <div class="coverage-content">${esc(d.content)}</div>`;
}

async function openMatrixFull(subject) {
  openModal('<div class="loading">Loading matrix…</div>');
  const d = await get('/matrix_full', { subject });
  el('modal-body').innerHTML = `
    <div class="modal-title">Decision Matrix — ${esc(subject)}</div>
    <div class="coverage-content">${esc(d.content)}</div>`;
}

async function openCurriculum() {
  openModal('<div class="loading">Loading curriculum…</div>');
  const d = await get('/curriculum');
  const html = d.subjects.map((s, i) => `
    <div style="border:1px solid var(--border);border-radius:8px;margin-bottom:.5rem;overflow:hidden">
      <div class="curr-toggle" data-ci="${i}" style="padding:.6rem 1rem;cursor:pointer;display:flex;justify-content:space-between;align-items:center;background:var(--bg)">
        <span style="font-weight:600;font-size:.9rem">${esc(s.name)}</span>
        <span style="display:flex;align-items:center;gap:.5rem">
          <span class="badge badge-gray">${s.requirements.length} reqs</span>
          <span id="ci-icon-${i}">▼</span>
        </span>
      </div>
      <div id="ci-body-${i}" style="display:none;padding:.5rem 1rem .75rem">
        ${s.requirements.map(r => `<div class="curr-req">${esc(r)}</div>`).join('')}
      </div>
    </div>`).join('');

  el('modal-body').innerHTML = `
    <div class="modal-title">Curriculum (${d.subjects.length} subjects)</div>
    <p class="text-muted" style="margin-bottom:1rem;font-size:.82rem">Click a subject to expand its requirements.</p>
    <div id="curr-list">${html}</div>`;

  el('curr-list').onclick = e => {
    const toggle = e.target.closest('[data-ci]');
    if (!toggle) return;
    const i = toggle.dataset.ci;
    const body = el(`ci-body-${i}`);
    const icon = el(`ci-icon-${i}`);
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    icon.textContent   = open ? '▼' : '▲';
  };
}

async function openStats() {
  openModal('<div class="loading">Loading stats…</div>');
  const d = await get('/stats');
  updateStats(d);
  _D.questions = d.archived_list || [];

  const bySubj = Object.entries(d.by_subject || {})
    .sort(([,a],[,b]) => b.seen - a.seen)
    .map(([subj, st]) => {
      const acc = st.seen ? Math.round(st.correct/st.seen*100) : 0;
      return `<div style="display:flex;gap:.75rem;align-items:center;padding:.3rem 0;border-bottom:1px solid var(--border);font-size:.82rem">
        <span style="flex:1">${esc(subj)}</span>
        <span class="chip">${st.seen}q</span>
        <span style="color:var(--success)">${st.correct}✓</span>
        <span style="color:var(--danger)">${st.incorrect}✗</span>
        <span style="color:var(--muted)">${acc}%</span>
      </div>`;
    }).join('');

  el('modal-body').innerHTML = `
    <div class="modal-title">Session Stats</div>
    <div class="stat-grid">
      <div class="stat-card"><div class="val">${d.seen}</div><div class="lbl">Seen</div></div>
      <div class="stat-card"><div class="val" style="color:var(--success)">${d.correct}</div><div class="lbl">Correct</div></div>
      <div class="stat-card"><div class="val" style="color:var(--danger)">${d.incorrect}</div><div class="lbl">Incorrect</div></div>
      <div class="stat-card"><div class="val">${d.accuracy}%</div><div class="lbl">Accuracy</div></div>
    </div>
    ${d.incorrect > 0 ? `<div class="btn-row" style="margin-bottom:.5rem">
      <button class="btn btn-danger btn-sm" id="quiz-wrong-btn">Quiz incorrect questions (${d.incorrect})</button>
    </div>` : ''}
    <div class="section-header">By Subject</div>
    ${bySubj || '<div class="empty">No questions answered yet</div>'}
    ${_D.questions.length ? `
      <div class="section-header" style="margin-top:1rem">Archived (${_D.questions.length})</div>
      <div id="stats-archived">${buildArchivedList(_D.questions)}</div>` : ''}`;

  const arc = el('stats-archived');
  if (arc) wireArchivedList(arc);
  const qwb = el('quiz-wrong-btn');
  if (qwb) qwb.onclick = () => {
    S.quizMode = 'weak'; S.quizTags = ''; S.quizSpecialty = ''; S.quizSubject = '';
    closeModal(); resetRun(); switchMode('quiz'); setTimeout(loadNextQ, 50);
  };
}

async function openArchive() {
  openModal('<div class="loading">Loading archived…</div>');
  const d = await get('/stats');
  S.localStats = d;
  _D.questions = d.archived_list || [];

  if (!_D.questions.length) {
    el('modal-body').innerHTML = '<div class="modal-title">Archived Questions</div><div class="empty">No archived questions</div>';
    return;
  }

  // All 10 specialties always shown; add Old Exam pill only if present in archived list
  const presentSpecKeys = [...new Set(_D.questions.map(q => q.specialty).filter(Boolean))];
  const specDefs = [
    ...S.specialties,
    ...(presentSpecKeys.includes('old_exam') ? [{ specialty: 'old_exam', display_name: 'Old Exam' }] : []),
  ];

  const activeSpecs = new Set(specDefs.map(sp => sp.specialty)); // all ON by default
  const selected    = new Set();                                  // selected question IDs

  function visible() {
    return _D.questions.filter(q => !q.specialty || activeSpecs.has(q.specialty));
  }

  async function quizSelected(qids) {
    const qs = await post('/questions/hydrate', { ids: qids });
    if (!qs?.length) return;
    const shuffled = [...qs].sort(() => Math.random() - 0.5);
    S.quizMode = 'review_archived'; S.quizSubject = ''; S.quizSpecialty = ''; S.quizTags = '';
    S.quizRun  = { active: true, done: false, queue: shuffled, position: 0, originalN: shuffled.length, results: [], reinserted: new Set() };
    S.quizRunId = genId();
    S.currentQ  = shuffled[0];
    S.answered  = false;
    closeModal();
    switchMode('quiz');
    const area = el('quiz-area');
    if (area) { area.innerHTML = buildRunHeader() + buildTimerBar() + buildQuestionCard(S.currentQ); wireQuizArea(); }
    const cfg = TIMER_CFG[S.timerMode]; if (cfg) startQTimer(cfg.s, handleQTimeout);
  }

  function render() {
    const vis    = visible();
    const selVis = vis.filter(q => selected.has(q.id));
    const total  = _D.questions.length;
    const nVis   = vis.length;
    const nSel   = selVis.length;

    const specPills = specDefs.map(sp => {
      const on  = activeSpecs.has(sp.specialty);
      const has = presentSpecKeys.includes(sp.specialty);
      return `<button class="arch-spec-pill${on ? ' on' : ''}${has ? '' : ' arch-pill-empty'}" data-arch-spec="${attr(sp.specialty)}">${esc(sp.display_name)}</button>`;
    }).join('');

    const quizLabel = nSel > 0 ? `Quiz Selected (${nSel})` : `Quiz All ${total} questions`;

    const cards = vis.map((q, i) => {
      const sel = selected.has(q.id);
      return `<div class="arch-card${sel ? ' arch-selected' : ''}" data-arch-idx="${i}">
        <span class="arch-check${sel ? ' on' : ''}"></span>
        <div class="q-text" style="flex:1;font-size:.84rem;line-height:1.45;pointer-events:none">${esc((q.question||'').substring(0, 100))}…</div>
        <button class="btn btn-outline btn-sm arch-restore" data-arch-restore="${i}">Restore</button>
      </div>`;
    }).join('') || '<div class="empty">No questions for selected specialties</div>';

    el('modal-body').innerHTML = `
      <div class="modal-title">Archived Questions (${total})</div>
      ${specPills ? `<div class="arch-spec-bar">${specPills}</div>` : ''}
      <div class="btn-row" style="margin-bottom:.75rem;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" id="arch-quiz-btn">${quizLabel}</button>
        <button class="btn btn-outline btn-sm" id="arch-mark-all">Mark All ${nVis}</button>
        <button class="btn btn-ghost btn-sm"   id="arch-unmark-all">Unmark All</button>
      </div>
      <div id="archive-list">${cards}</div>`;

    el('modal-body').querySelectorAll('[data-arch-spec]').forEach(pill => {
      pill.onclick = () => {
        const sp = pill.dataset.archSpec;
        if (activeSpecs.has(sp)) activeSpecs.delete(sp); else activeSpecs.add(sp);
        render();
      };
    });

    el('arch-quiz-btn').onclick = () => {
      if (nSel > 0) { quizSelected(selVis.map(q => q.id)); return; }
      S.quizMode = 'review_archived'; S.quizTags = ''; S.quizSpecialty = ''; S.quizSubject = '';
      closeModal(); resetRun(); switchMode('quiz'); setTimeout(loadNextQ, 50);
    };
    el('arch-mark-all').onclick   = () => { vis.forEach(q => selected.add(q.id)); render(); };
    el('arch-unmark-all').onclick = () => { selected.clear(); render(); };

    el('archive-list').onclick = async e => {
      // Restore button — must check first
      const restoreBtn = e.target.closest('.arch-restore');
      if (restoreBtn) {
        const q = vis[+restoreBtn.dataset.archRestore];
        if (!q) return;
        const d2 = await post('/restore', { question_id: q.id });
        updateStats(d2.stats);
        _D.questions = _D.questions.filter(qq => qq.id !== q.id);
        selected.delete(q.id);
        render();
        return;
      }
      // Card click — toggle selection
      const card = e.target.closest('[data-arch-idx]');
      if (card) {
        const q = vis[+card.dataset.archIdx];
        if (!q) return;
        if (selected.has(q.id)) selected.delete(q.id); else selected.add(q.id);
        render();
      }
    };
  }

  render();
}

function buildArchivedList(questions) {
  return questions.map((q, i) => `
    <div style="display:flex;align-items:flex-start;gap:.75rem;padding:.5rem;border:1px solid var(--border);border-radius:6px;margin-bottom:.35rem">
      <span class="q-status qs-archived" style="margin-top:4px"></span>
      <div class="q-text" style="flex:1;cursor:pointer" data-qidx="${i}">${esc((q.question||'').substring(0,100))}…</div>
      <button class="btn btn-outline btn-sm" data-restore="${i}">Restore</button>
    </div>`).join('');
}

function wireArchivedList(container) {
  container.onclick = async e => {
    const restoreBtn = e.target.closest('[data-restore]');
    if (restoreBtn) {
      const q = _D.questions[+restoreBtn.dataset.restore];
      const d2 = await post('/restore', { question_id: q.id });
      updateStats(d2.stats);
      openArchive();
      return;
    }
    const qrow = e.target.closest('[data-qidx]');
    if (qrow) openChain(_D.questions[+qrow.dataset.qidx].id);
  };
}

// =============================================================
// PROFILE TAB
// =============================================================
async function renderProfile() {
  app().innerHTML = '<div class="full-width"><div class="loading">Loading profile…</div></div>';
  const d = await get('/stats');
  S.localStats = d;
  updateStats(d);

  const specSeen  = d.specialty_seen  ?? d.seen;
  const specTotal = d.specialty_total ?? 1095;
  const oldSeen   = d.old_exam_seen   ?? 0;
  const oldTotal  = d.old_exam_total  ?? 1079;
  const bySubj    = d.by_subject || {};

  const specRows = S.specialties.map(sp => {
    let seen=0, correct=0;
    sp.subjects.forEach(s => { const st=bySubj[s.subject]||{}; seen+=st.seen||0; correct+=st.correct||0; });
    const pct = sp.question_count ? Math.round(seen/sp.question_count*100) : 0;
    const acc  = seen ? Math.round(correct/seen*100) : 0;
    const accColor = acc>=70?'var(--success)':acc>=50?'var(--warn)':'var(--danger)';
    return `
      <div style="display:grid;grid-template-columns:120px 1fr 55px 55px;gap:.5rem;align-items:center;padding:.45rem 0;border-bottom:1px solid var(--border)">
        <span style="font-size:.82rem;font-weight:600">${esc(sp.display_name)}</span>
        <div>
          <div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden">
            <div style="height:100%;background:var(--primary);width:${pct}%;border-radius:4px;transition:width .4s"></div>
          </div>
          <div style="font-size:.67rem;color:var(--muted);margin-top:2px">${seen}/${sp.question_count} (${pct}%)</div>
        </div>
        <span style="font-size:.78rem;text-align:center;color:${accColor};font-weight:600">${seen?acc+'%':'—'}</span>
        <div style="display:flex;flex-direction:column;gap:3px">
          <button class="btn btn-primary btn-sm" style="padding:2px 6px;font-size:.7rem" data-prof-quiz="${attr(sp.specialty)}">Quiz</button>
          <button class="btn btn-outline btn-sm" style="padding:2px 6px;font-size:.7rem" data-prof-unseen="${attr(sp.specialty)}">Unseen</button>
        </div>
      </div>`;
  }).join('');

  app().innerHTML = `
    <div class="full-width" style="max-width:820px;margin:0 auto;padding:1.5rem">
      <h2 style="font-size:1.3rem;font-weight:700;margin-bottom:1.25rem">Profile</h2>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.75rem;margin-bottom:1.5rem">
        <div class="stat-card"><div class="val">${d.seen}</div><div class="lbl">Questions seen</div></div>
        <div class="stat-card"><div class="val" style="color:var(--success)">${d.correct}</div><div class="lbl">Correct</div></div>
        <div class="stat-card"><div class="val" style="color:var(--danger)">${d.incorrect}</div><div class="lbl">Incorrect</div></div>
        <div class="stat-card"><div class="val">${d.accuracy}%</div><div class="lbl">Accuracy</div></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1.5rem">
        <div class="card" style="padding:.85rem">
          <div style="font-size:.8rem;font-weight:600;color:var(--muted);margin-bottom:.5rem;text-transform:uppercase">Specialty Bank</div>
          <div style="font-size:1.8rem;font-weight:800;color:var(--primary)">${Math.round(specSeen/specTotal*100)||0}%</div>
          <div style="font-size:.78rem;color:var(--muted);margin:.25rem 0 .5rem">${specSeen} / ${specTotal} seen</div>
          <div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden">
            <div style="height:100%;background:var(--primary);width:${Math.round(specSeen/specTotal*100)||0}%;border-radius:4px"></div>
          </div>
        </div>
        <div class="card" style="padding:.85rem">
          <div style="font-size:.8rem;font-weight:600;color:var(--muted);margin-bottom:.5rem;text-transform:uppercase">Past Exams</div>
          <div style="font-size:1.8rem;font-weight:800;color:var(--warn)">${Math.round(oldSeen/oldTotal*100)||0}%</div>
          <div style="font-size:.78rem;color:var(--muted);margin:.25rem 0 .5rem">${oldSeen} / ${oldTotal} seen</div>
          <div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden">
            <div style="height:100%;background:var(--warn);width:${Math.round(oldSeen/oldTotal*100)||0}%;border-radius:4px"></div>
          </div>
        </div>
      </div>

      ${d.incorrect > 0 || d.archived > 0 ? `
      <div style="display:flex;gap:.5rem;margin-bottom:1.5rem;flex-wrap:wrap">
        ${d.incorrect > 0 ? `<button class="btn btn-danger btn-sm" id="prof-weak">Quiz incorrect (${d.incorrect})</button>` : ''}
        ${d.archived  > 0 ? `<button class="btn btn-outline btn-sm" id="prof-archive">Review archived (${d.archived})</button>` : ''}
        <button class="btn btn-outline btn-sm" id="prof-unseen">Quiz unseen</button>
      </div>` : ''}

      <div class="card" style="padding:1rem">
        <div style="display:grid;grid-template-columns:120px 1fr 55px 55px;gap:.5rem;padding:.3rem 0;border-bottom:2px solid var(--border);margin-bottom:.3rem">
          <span style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--muted)">Specialty</span>
          <span style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--muted)">Progress</span>
          <span style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--muted);text-align:center">Acc</span>
          <span></span>
        </div>
        ${specRows}
      </div>
    </div>`;

  // Wire action buttons
  const wb = el('prof-weak');
  if (wb) wb.onclick = () => { S.quizMode='weak'; S.quizTags=''; S.quizSpecialty=''; S.quizSubject=''; resetRun(); switchMode('quiz'); setTimeout(loadNextQ,50); };
  const ab = el('prof-archive');
  if (ab) ab.onclick = openArchive;
  const ub = el('prof-unseen');
  if (ub) ub.onclick = () => { S.quizMode='unseen'; S.quizSpecialty=''; S.quizSubject=''; S.quizTags=''; resetRun(); switchMode('quiz'); setTimeout(loadNextQ,50); };

  // Per-specialty quiz buttons
  document.querySelectorAll('[data-prof-quiz]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      S.quizMode='normal'; S.quizSpecialty=btn.dataset.profQuiz; S.quizSubject=''; S.quizTags='';
      resetRun(); switchMode('quiz'); setTimeout(loadNextQ,50);
    };
  });
  document.querySelectorAll('[data-prof-unseen]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      S.quizMode='unseen'; S.quizSpecialty=btn.dataset.profUnseen; S.quizSubject=''; S.quizTags='';
      resetRun(); switchMode('quiz'); setTimeout(loadNextQ,50);
    };
  });
}

// =============================================================
// INIT
// =============================================================
async function init() {
  el('nav-quiz').classList.add('active');
  try {
    await initSession();
    S.specialties = await get('/specialties');
    S.subjects = S.specialties.flatMap(sp => sp.subjects);
    updateScoreDisplay();
    render();
  } catch (e) {
    app().innerHTML = `<div class="full-width"><div class="empty">
      <p style="font-size:1rem;margin-bottom:.5rem">Failed to connect to server.</p>
      <p>Run: <code style="background:var(--bg);padding:2px 6px;border-radius:4px">python app.py</code></p>
    </div></div>`;
  }
}

window.addEventListener('DOMContentLoaded', init);
