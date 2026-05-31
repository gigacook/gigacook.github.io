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
  quizRun: { active: false, done: false, queue: [], position: 0, originalN: 0, results: [], reinserted: null },

  // exam
  examQuestions: [], examAnswers: {}, examIndex: 0,
  examActive: false, examDone: false, examResults: null,

  // study/explore
  browseSubject: null, browseTopic: null, activeTab: 'questions',
  exploreSubject: null, exploreTopic: null, activeTags: new Set(),
  openStudySpec: new Set(),   // expanded specialty slugs in study sidebar
  openExploreSpec: new Set(), // expanded specialty slugs in explore sidebar

  stats: { seen: 0, correct: 0, incorrect: 0, archived: 0, accuracy: 0 },
};

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

function resetRun() {
  S.quizRun = { active: false, done: false, queue: [], position: 0, originalN: 0, results: [], reinserted: null };
  S.currentQ = null;
  S.answered = false;
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
  if (S.browseSubject) loadStudySubject(S.browseSubject);
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
        if (openSet.has(sp.specialty)) openSet.delete(sp.specialty);
        else openSet.add(sp.specialty);
        buildSpecialtySidebar(containerId, specialties, mode);
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
      <div style="width:220px;flex-shrink:0;border-right:1px solid var(--border);overflow-y:auto;background:white" id="study-topic-col">
        ${topicRows}
      </div>
      <div style="flex:1;overflow-y:auto;padding:1.25rem" id="topic-detail">
        <div class="card">
          <div class="card-title">${esc(subject)}</div>
          <div class="card-subtitle">${topics.length} topics · ${hy.questions.length} questions</div>
          <div class="section-header" style="margin-top:.75rem">High-Yield Topics</div>
          ${hy.topics.slice(0,8).map(t => `
            <div class="hy-row" data-hy="${attr(t.subtopic)}" style="cursor:pointer">
              <span style="flex:1;font-size:.84rem">${esc(t.subtopic)}</span>
              <span class="text-muted" style="font-size:.75rem">${t.count}q</span>
              <div class="hy-bar" style="width:80px">
                <div class="hy-bar-fill" style="width:${Math.min(100,t.count/(hy.topics[0]?.count||1)*100)}%"></div>
              </div>
            </div>`).join('')}
          <div class="btn-row">
            <button class="btn btn-primary btn-sm" data-action="quiz-subject">Quiz this subject</button>
            <button class="btn btn-outline btn-sm" data-action="coverage">Coverage map</button>
            <button class="btn btn-outline btn-sm" data-action="matrix-full">Full matrix</button>
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
          ${S.quizMode==='tag'&&S.quizTags?`<span class="badge badge-blue" style="align-self:flex-end">${esc(S.quizTags)}</span>`:''}
          <button class="btn btn-primary" id="quiz-next-btn">Next →</button>
        </div>
        <div id="quiz-area">${areaHtml}</div>
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
    S.currentQ = d.questions[0];
    S.answered = false;
    if (area) { area.innerHTML = buildRunHeader() + buildQuestionCard(S.currentQ); wireQuizArea(); }
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
    renderQuizRunResults();
    return;
  }

  S.currentQ = run.queue[run.position];
  const area = el('quiz-area');
  if (area) { area.innerHTML = buildRunHeader() + buildQuestionCard(S.currentQ); wireQuizArea(); }
}

async function handleAnswer(letter) {
  if (S.answered || !S.currentQ) return;
  S.answered = true;
  document.querySelectorAll('.option-btn').forEach(b => b.disabled = true);

  const d = await post('/answer', { question_id: S.currentQ.id, selected: letter });
  const q = d.question;
  trackLocalAnswer(S.currentQ, d.is_correct);
  updateStats(d.stats);

  const run = S.quizRun;
  if (run.active) {
    run.results.push({ question: S.currentQ, selected: letter, is_correct: d.is_correct });
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
      <h4>${d.is_correct ? '✓ Correct!' : `✗ Incorrect — correct: ${q.correct}`}</h4>
      <div>${esc(q.explanation)}</div>
      ${q.distractors ? `<div class="distractors" style="margin-top:.4rem"><strong>Why others wrong:</strong> ${esc(q.distractors)}</div>` : ''}
      ${q.source ? `<div class="source" style="margin-top:.4rem;color:var(--muted);font-size:.75rem">Source: ${esc(q.source)}</div>` : ''}
    </div>`;

  const actions = el('quiz-actions');
  if (actions) actions.innerHTML = `
    <button class="btn btn-primary" data-qa="next">Next →</button>
    <button class="btn btn-outline btn-sm" data-qa="archive">Archive</button>
    <button class="btn btn-ghost btn-sm" data-qa="chain">Topic chain</button>`;
}

async function archiveCurrentQ() {
  if (!S.currentQ) return;
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
          <div class="results-label">${pct}% correct this run</div>
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
        <div class="results-label">${pct}% correct</div>
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
  _D.questions = d.archived_list || [];
  if (!_D.questions.length) {
    el('modal-body').innerHTML = '<div class="modal-title">Archived Questions</div><div class="empty">No archived questions</div>';
    return;
  }
  el('modal-body').innerHTML = `
    <div class="modal-title">Archived Questions (${_D.questions.length})</div>
    <div class="btn-row" style="margin-bottom:1rem">
      <button class="btn btn-primary btn-sm" id="quiz-archived-btn">Quiz archived questions</button>
    </div>
    <div id="archive-list">${buildArchivedList(_D.questions)}</div>`;
  el('quiz-archived-btn').onclick = () => {
    S.quizMode = 'review_archived'; S.quizTags = ''; S.quizSpecialty = ''; S.quizSubject = '';
    closeModal(); resetRun(); switchMode('quiz'); setTimeout(loadNextQ, 50);
  };
  wireArchivedList(el('archive-list'));
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
    render();
  } catch (e) {
    app().innerHTML = `<div class="full-width"><div class="empty">
      <p style="font-size:1rem;margin-bottom:.5rem">Failed to connect to server.</p>
      <p>Run: <code style="background:var(--bg);padding:2px 6px;border-radius:4px">python app.py</code></p>
    </div></div>`;
  }
}

window.addEventListener('DOMContentLoaded', init);
