/* ── State ── */
let G = { guild: '', guilds: [], page: 'overview', cases: { filter: 'all', search: '', pageN: 0 } };

const PAGE_SIZE  = 20;
const PAGE_TITLES = { overview: 'Overview', cases: 'Moderation', staff: 'Staff Profiles',
                      activity: 'Activity', departments: 'Departments', training: 'Training', loa: 'Leave of Absence' };

/* ── Sidebar drawer (mobile) ── */
function openSidebar()  { document.body.classList.add('sidebar-open'); }
function closeSidebar() { document.body.classList.remove('sidebar-open'); }

/* ── Init ── */
async function init() {
  // Wire nav — close drawer on mobile after selection
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => { navigate(el.dataset.page); closeSidebar(); });
  });

  // Load guilds
  try {
    const guilds = await api('/api/guilds');
    G.guilds = guilds;
    const sel = document.getElementById('guild-sel');
    sel.innerHTML = guilds.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
    if (guilds.length) { G.guild = guilds[0].id; sel.value = G.guild; }
    sel.addEventListener('change', () => { G.guild = sel.value; loadPage(); });
  } catch { document.getElementById('guild-sel').innerHTML = '<option>No guilds</option>'; }

  // Bot status
  checkStatus();
  loadPage();
}

async function checkStatus() {
  try {
    const s = await api('/api/status');
    const dot  = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    dot.className  = 'dot ' + (s.online ? 'online' : 'offline');
    text.textContent = s.online ? `${esc(s.tag)} • ${s.guilds}g` : 'Offline';
  } catch {
    document.getElementById('status-dot').className = 'dot offline';
    document.getElementById('status-text').textContent = 'Offline';
  }
}

function navigate(page) {
  G.page = page;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  document.getElementById('page-title').textContent = PAGE_TITLES[page] || page;
  loadPage();
}

async function loadPage() {
  const ts = new Date().toLocaleTimeString();
  document.getElementById('last-refresh').textContent = `Updated ${ts}`;
  const content = document.getElementById('content');
  content.innerHTML = `<div class="loader-wrap"><div class="spinner"></div></div>`;
  try {
    switch (G.page) {
      case 'overview':    await renderOverview();    break;
      case 'cases':       await renderCases();       break;
      case 'staff':       await renderStaff();       break;
      case 'activity':    await renderActivity();    break;
      case 'departments': await renderDepartments(); break;
      case 'training':    await renderTraining();    break;
      case 'loa':         await renderLOA();         break;
    }
  } catch (e) {
    content.innerHTML = `<div class="section"><div class="section-body" style="color:var(--red)">Error loading data: ${esc(e.message)}</div></div>`;
  }
}

function refresh() { loadPage(); checkStatus(); }

/* ── API helper ── */
async function api(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = G.guild ? `${path}${sep}guild=${encodeURIComponent(G.guild)}` : path;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/* ── Overview ── */
async function renderOverview() {
  const d = await api('/api/overview');
  const content = document.getElementById('content');

  content.innerHTML = `
    <div class="stats-grid">
      ${statCard('Total Cases', d.totalCases, 'blue', 'All moderation actions')}
      ${statCard('Warnings', d.warnings, 'yellow', 'Active warnings issued')}
      ${statCard('Strikes', d.strikes, 'orange', d.activeStrikes + ' active')}
      ${statCard('Suspensions', d.suspensions, 'red', d.activeSuspensions + ' currently active')}
      ${statCard('Active Staff', d.activeStaff, 'green', d.totalTracked + ' total tracked')}
      ${statCard('On LOA', d.onLOA, 'cyan', 'Currently on leave')}
    </div>

    <div class="two-col">
      <div class="section">
        <div class="section-header"><h2>📋 Recent Cases</h2><span class="muted">Last 10</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Case</th><th>Type</th><th>User</th><th class="hide-mobile">Reason</th><th class="hide-mobile">Date</th></tr></thead>
            <tbody>
              ${d.recentCases.length ? d.recentCases.map(c => `
                <tr onclick="showCase(${JSON.stringify(c).replace(/"/g,'&quot;')})">
                  <td><code>${esc(c.id)}</code></td>
                  <td>${typeBadge(c.type)}</td>
                  <td class="muted">${shortId(c.userId)}</td>
                  <td class="hide-mobile" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.reason)}</td>
                  <td class="muted hide-mobile">${relDate(c.timestamp)}</td>
                </tr>`).join('') : '<tr><td colspan="5" class="empty">No cases yet</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div class="section" style="margin-bottom:20px">
          <div class="section-header"><h2>🏆 Top Activity</h2></div>
          <div class="section-body">
            ${d.topActivity.length ? d.topActivity.map((r, i) => `
              <div class="lb-row">
                <div class="lb-rank">${['🥇','🥈','🥉'][i] || i+1}</div>
                <div class="lb-info">
                  <div class="lb-name">${shortId(r.uid)}</div>
                  <div class="lb-sub">${r.messages} messages</div>
                </div>
                <div class="lb-score">${r.score}</div>
              </div>`).join('') : '<p class="muted" style="padding:10px 0">No activity tracked yet.</p>'}
          </div>
        </div>

        <div class="section">
          <div class="section-header"><h2>🏢 Departments</h2></div>
          <div class="section-body">
            ${d.departments.map(dept => `
              <div style="margin-bottom:14px">
                <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                  <span style="font-size:13px;font-weight:600">${esc(dept.name)}</span>
                  <span class="muted">${dept.members} members • ${dept.performance}/100</span>
                </div>
                <div class="progress-wrap">
                  <div class="progress-bar ${perfClass(dept.performance)}" style="width:${dept.performance}%"></div>
                </div>
              </div>`).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

/* ── Cases ── */
async function renderCases() {
  const content = document.getElementById('content');

  // Inject filter bar first
  content.innerHTML = `
    <div class="section">
      <div class="filter-bar">
        <select id="type-filter" onchange="G.cases.filter=this.value;G.cases.pageN=0;fetchAndRenderCases()">
          <option value="all">All Types</option>
          <option value="warn">⚠️ Warnings</option>
          <option value="strike">❗ Strikes</option>
          <option value="suspend">🔴 Suspensions</option>
          <option value="demote">📉 Demotions</option>
          <option value="terminate">🚫 Terminations</option>
          <option value="ban">🔨 Bans</option>
          <option value="note">📝 Notes</option>
        </select>
        <input id="case-search" type="text" placeholder="Search reason or case ID…" value=""
          oninput="G.cases.search=this.value;G.cases.pageN=0;fetchAndRenderCases()">
      </div>
      <div id="cases-body"><div class="loader-wrap"><div class="spinner"></div></div></div>
      <div id="cases-pager"></div>
    </div>`;

  await fetchAndRenderCases();
}

async function fetchAndRenderCases() {
  const body  = document.getElementById('cases-body');
  const pager = document.getElementById('cases-pager');
  if (!body) return;
  body.innerHTML = `<div class="loader-wrap"><div class="spinner"></div></div>`;

  const filter = G.cases.filter;
  const search = G.cases.search;
  const pageN  = G.cases.pageN;
  const d = await api(`/api/cases?type=${filter}&search=${encodeURIComponent(search)}&page=${pageN}`);

  body.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Case ID</th><th>Type</th><th>User</th><th class="hide-mobile">Moderator</th><th class="hide-mobile">Dept</th><th>Reason</th><th class="hide-mobile">Date</th></tr></thead>
        <tbody>
          ${d.cases.length ? d.cases.map(c => `
            <tr onclick="showCase(${JSON.stringify(c).replace(/"/g,'&quot;')})">
              <td><code style="font-size:12px">${esc(c.id)}</code></td>
              <td>${typeBadge(c.type)}</td>
              <td class="muted">${shortId(c.userId)}</td>
              <td class="muted hide-mobile">${shortId(c.moderatorId)}</td>
              <td class="muted hide-mobile">${esc(c.department || 'General')}</td>
              <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.reason)}</td>
              <td class="muted hide-mobile" style="white-space:nowrap">${relDate(c.timestamp)}</td>
            </tr>`).join('') : '<tr><td colspan="7" class="empty">No cases match your filters.</td></tr>'}
        </tbody>
      </table>
    </div>`;

  pager.innerHTML = d.total > PAGE_SIZE ? `
    <div class="pagination">
      <button class="page-btn" onclick="G.cases.pageN=${Math.max(0,pageN-1)};fetchAndRenderCases()" ${pageN===0?'disabled':''}>← Prev</button>
      <span class="page-info">Page ${pageN+1} of ${Math.ceil(d.total/PAGE_SIZE)} &nbsp;•&nbsp; ${d.total} cases</span>
      <button class="page-btn" onclick="G.cases.pageN=${pageN+1};fetchAndRenderCases()" ${(pageN+1)*PAGE_SIZE>=d.total?'disabled':''}>Next →</button>
    </div>` : `<div class="pagination"><span class="page-info">${d.total} case${d.total!==1?'s':''}</span></div>`;
}

/* ── Staff ── */
async function renderStaff() {
  const d = await api('/api/staff');
  const content = document.getElementById('content');

  content.innerHTML = `
    <div class="section">
      <div class="section-header"><h2>👥 Staff Records</h2><span class="muted">${d.length} tracked members</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>User</th><th>Status</th><th>Strikes</th><th class="hide-mobile">Warnings</th><th class="hide-mobile">Suspensions</th><th class="hide-mobile">Promotions</th><th class="hide-mobile">Trainings</th></tr></thead>
          <tbody>
            ${d.length ? d.map(s => `
              <tr>
                <td><code>${shortId(s.uid)}</code></td>
                <td>${statusBadge(s)}</td>
                <td>${s.activeStrikes > 0 ? `<span style="color:var(--orange);font-weight:700">${s.activeStrikes}</span>` : '0'}</td>
                <td class="hide-mobile">${s.warnings}</td>
                <td class="hide-mobile">${s.suspensions}</td>
                <td class="hide-mobile">${s.promotions}</td>
                <td class="hide-mobile">${s.trainings}</td>
              </tr>`).join('') : '<tr><td colspan="7" class="empty">No staff records yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* ── Activity ── */
async function renderActivity() {
  const d = await api('/api/activity');
  const content = document.getElementById('content');
  const medals  = ['🥇','🥈','🥉'];

  content.innerHTML = `
    <div class="two-col">
      <div class="section">
        <div class="section-header"><h2>🏆 All-Time Leaderboard</h2></div>
        <div class="section-body">
          ${d.allTime.length ? d.allTime.map((r,i) => `
            <div class="lb-row">
              <div class="lb-rank">${medals[i] || `<span style="color:var(--muted)">${i+1}</span>`}</div>
              <div class="lb-info">
                <div class="lb-name">${shortId(r.uid)}</div>
                <div class="lb-sub">${r.messages.toLocaleString()} messages • last seen ${relDate(r.lastSeen)}</div>
              </div>
              <div class="lb-score">⭐ ${r.score}</div>
            </div>`).join('') : '<p class="muted">No activity data yet.</p>'}
        </div>
      </div>

      <div class="section">
        <div class="section-header"><h2>📅 This Week</h2></div>
        <div class="section-body">
          ${d.weekly.length ? d.weekly.map((r,i) => `
            <div class="lb-row">
              <div class="lb-rank">${medals[i] || `<span style="color:var(--muted)">${i+1}</span>`}</div>
              <div class="lb-info">
                <div class="lb-name">${shortId(r.uid)}</div>
                <div class="lb-sub">${(r.weekMessages||0).toLocaleString()} messages this week</div>
              </div>
              <div class="lb-score" style="color:var(--cyan)">💬 ${r.weekMessages||0}</div>
            </div>`).join('') : '<p class="muted">No weekly data yet.</p>'}
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-header"><h2>📊 Full Activity Table</h2><span class="muted">${d.allTime.length} members</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Rank</th><th>User</th><th>Total Messages</th><th class="hide-mobile">This Week</th><th>Score</th><th class="hide-mobile">Last Seen</th></tr></thead>
          <tbody>
            ${d.allTime.map((r,i) => `
              <tr>
                <td class="muted">#${i+1}</td>
                <td><code>${shortId(r.uid)}</code></td>
                <td>${r.messages.toLocaleString()}</td>
                <td class="hide-mobile">${(r.weekMessages||0).toLocaleString()}</td>
                <td><span style="color:var(--yellow);font-weight:700">${r.score}</span></td>
                <td class="muted hide-mobile">${relDate(r.lastSeen)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* ── Departments ── */
async function renderDepartments() {
  const d = await api('/api/departments');
  const content = document.getElementById('content');

  content.innerHTML = `
    <div class="dept-grid">
      ${d.map(dept => `
        <div class="dept-card">
          <h3>🏢 ${esc(dept.name)}</h3>
          <div class="dept-meta">
            <span>👥 ${dept.members} members</span>
            <span>⭐ ${dept.performance}/100</span>
          </div>
          <div class="progress-wrap">
            <div class="progress-bar ${perfClass(dept.performance)}" style="width:${dept.performance}%"></div>
          </div>
          ${dept.memberList.length ? `
            <div class="dept-members">
              ${dept.memberList.slice(0,8).map(id => `<code style="font-size:11px;margin-right:4px">${shortId(id)}</code>`).join('')}
              ${dept.memberList.length > 8 ? `<span class="muted">+${dept.memberList.length-8} more</span>` : ''}
            </div>` : `<p class="muted" style="font-size:12px;margin-top:10px">No members assigned</p>`}
          ${dept.notes ? `<p style="font-size:12px;color:var(--muted);margin-top:8px">${esc(dept.notes)}</p>` : ''}
        </div>`).join('')}
    </div>`;
}

/* ── Training ── */
async function renderTraining() {
  const d = await api('/api/training');
  const content = document.getElementById('content');

  content.innerHTML = `
    <div class="section">
      <div class="section-header"><h2>🎓 Training Sessions</h2><span class="muted">${d.length} total</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th class="hide-mobile">ID</th><th>Name</th><th>Status</th><th class="hide-mobile">Instructor</th><th class="hide-mobile">Attendees</th><th>Passed</th><th>Failed</th><th class="hide-mobile">Date</th></tr></thead>
          <tbody>
            ${d.length ? d.map(t => `
              <tr>
                <td class="hide-mobile"><code style="font-size:12px">${esc(t.id)}</code></td>
                <td><strong>${esc(t.name)}</strong></td>
                <td>${statusLabel('badge-'+t.status, t.status)}</td>
                <td class="muted hide-mobile">${t.instructor ? shortId(t.instructor) : '—'}</td>
                <td class="hide-mobile">${t.attendees}</td>
                <td><span style="color:var(--green)">${t.passed}</span></td>
                <td><span style="color:var(--red)">${t.failed}</span></td>
                <td class="muted hide-mobile">${relDate(t.created)}</td>
              </tr>`).join('') : '<tr><td colspan="8" class="empty">No training sessions yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* ── LOA ── */
async function renderLOA() {
  const d = await api('/api/loa');
  const content = document.getElementById('content');

  const active = d.filter(l => l.active);
  const hist   = d.filter(l => !l.active);

  content.innerHTML = `
    ${active.length ? `
      <div class="section" style="margin-bottom:20px">
        <div class="section-header"><h2>🌴 Currently On Leave</h2><span class="badge badge-approved">${active.length} active</span></div>
        <div class="section-body">
          <div class="loa-list">
            ${active.map(l => `
              <div class="loa-card">
                <div>
                  <h4><code>${shortId(l.uid)}</code></h4>
                  <p>📋 ${esc(l.reason || '—')}</p>
                  <p>🗓️ ${esc(l.startDate || '?')} → ${esc(l.endDate || '?')}</p>
                </div>
                <span class="badge badge-approved">Active</span>
              </div>`).join('')}
          </div>
        </div>
      </div>` : ''}

    <div class="section">
      <div class="section-header"><h2>📋 LOA History</h2><span class="muted">${hist.length} past requests</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>User</th><th>Reason</th><th>Start</th><th>End</th><th>Status</th></tr></thead>
          <tbody>
            ${d.length ? d.map(l => `
              <tr>
                <td><code>${shortId(l.uid)}</code></td>
                <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.reason||'—')}</td>
                <td class="muted">${esc(l.startDate||'—')}</td>
                <td class="muted">${esc(l.endDate||'—')}</td>
                <td>${l.active ? '<span class="badge badge-approved">Active</span>' : '<span class="badge badge-terminate">Completed</span>'}</td>
              </tr>`).join('') : '<tr><td colspan="5" class="empty">No LOA records.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* ── Case modal ── */
function showCase(c) {
  document.getElementById('modal-body').innerHTML = `
    <div class="modal-title">${typeBadge(c.type)} &nbsp; ${esc(c.id)}</div>
    <div class="modal-grid">
      <div class="modal-field"><label>User ID</label><div class="val"><code>${esc(c.userId)}</code></div></div>
      <div class="modal-field"><label>Moderator ID</label><div class="val"><code>${esc(c.moderatorId)}</code></div></div>
      <div class="modal-field"><label>Action</label><div class="val">${typeBadge(c.type)}</div></div>
      <div class="modal-field"><label>Department</label><div class="val">${esc(c.department||'General')}</div></div>
      <div class="modal-field"><label>Date</label><div class="val">${c.timestamp ? new Date(c.timestamp).toLocaleString() : '—'}</div></div>
      <div class="modal-field"><label>Status</label><div class="val">${esc(c.status||'active')}</div></div>
    </div>
    <div class="modal-field"><label>Reason</label><div class="val">${esc(c.reason||'—')}</div></div>
    <div class="modal-field"><label>Evidence</label><div class="val">${esc(c.evidence||'None provided')}</div></div>
  `;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ── Helpers ── */
function statCard(label, value, color, sub = '') {
  return `<div class="stat-card ${color}"><div class="label">${label}</div><div class="value">${value ?? 0}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
}

function typeBadge(type) {
  const map = { warn:'badge-warn', strike:'badge-strike', suspend:'badge-suspend', demote:'badge-demote',
                terminate:'badge-terminate', ban:'badge-ban', unban:'badge-unban', note:'badge-note' };
  const labels = { warn:'Warning', strike:'Strike', suspend:'Suspension', demote:'Demotion',
                   terminate:'Termination', ban:'Ban', unban:'Unban', note:'Note' };
  return `<span class="badge ${map[type]||'badge-note'}">${labels[type]||type}</span>`;
}

function statusBadge(s) {
  if (s.isTerminated) return `<span class="badge badge-terminated">Terminated</span>`;
  if (s.isBanned)     return `<span class="badge badge-terminated">Banned</span>`;
  if (s.isSuspended)  return `<span class="badge badge-suspended">Suspended</span>`;
  if (s.isLOA)        return `<span class="badge badge-loa">LOA</span>`;
  return `<span class="badge badge-active">Active</span>`;
}

function statusLabel(cls, label) {
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

function perfClass(p) {
  return p >= 70 ? 'perf-high' : p >= 40 ? 'perf-mid' : 'perf-low';
}

function relDate(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const min  = 60000, hr = 3600000, day = 86400000;
  if (diff < min)  return 'Just now';
  if (diff < hr)   return `${Math.floor(diff/min)}m ago`;
  if (diff < day)  return `${Math.floor(diff/hr)}h ago`;
  if (diff < day*7)return `${Math.floor(diff/day)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function shortId(id) {
  if (!id) return '—';
  return `…${String(id).slice(-6)}`;
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Start ── */
window.addEventListener('DOMContentLoaded', init);
