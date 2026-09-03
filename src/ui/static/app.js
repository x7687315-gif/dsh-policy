/* 🧋 dsh-policy management UI — vanilla JS, fetch-based, no dependencies. */
/* global document, fetch */

const $ = (selector) => document.querySelector(selector)
const api = async (path, options) => {
  const res = await fetch(path, options)
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

let CURRENT_RULES = { project: null, global: null }

// --- tabs -------------------------------------------------------------------

document.querySelectorAll('#tabs button').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.remove('active'))
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
    button.classList.add('active')
    $(`#tab-${button.dataset.tab}`).classList.add('active')
    refreshTab(button.dataset.tab)
  })
})

function refreshTab(tab) {
  if (tab === 'dashboard') loadOverview()
  if (tab === 'rules') loadRules()
  if (tab === 'candidates') loadCandidates()
  if (tab === 'records') loadRecords()
  if (tab === 'projects') loadProjects()
  if (tab === 'evidence') loadEvidence()
}

// --- dashboard ----------------------------------------------------------------

async function loadOverview() {
  const { status, body } = await api('/api/overview')
  if (status !== 200) { $('#overview').textContent = '加载失败'; return }
  const items = [
    [body.policy.projectRules, '项目硬规则'],
    [body.policy.globalRules, '全局硬规则'],
    [body.candidatesPending, '待审候选'],
    [body.guards, '生效提醒'],
    [body.preferences, '生效偏好'],
    [body.projects, '受管项目'],
    [body.evidenceSessions, '证据会话'],
  ]
  $('#overview').innerHTML = items.map(([num, label]) =>
    `<div class="card"><div class="num">${num}</div><div class="label">${label}</div></div>`).join('')
  $('#conn').textContent = '已连接 ✓'
}

// --- hard rules ---------------------------------------------------------------

async function loadRules() {
  const { body } = await api('/api/policy')
  CURRENT_RULES = body
  const scope = $('#rules-scope').value
  $('#rules-paths').textContent = scope === 'global' ? body.paths.global : body.paths.project
  const doc = scope === 'global' ? body.global : body.project
  const tbody = $('#rules-table tbody')
  tbody.innerHTML = ''
  for (const rule of (doc?.policy?.hard ?? [])) {
    const tr = document.createElement('tr')
    const isDeny = 'denyTools' in rule
    const content = isDeny
      ? `MUST NOT：${rule.denyTools.join(', ')}`
      : `改动后必须 ${typeof rule.require === 'string' ? rule.require : `通过 "${rule.require.tool}"`}${rule.require.passPattern ? `（/${rule.require.passPattern}/）` : ''}`
    tr.innerHTML = `
      <td><span class="tag ${rule.enabled === false ? 'off' : 'on'}">${rule.enabled === false ? '停用' : '启用'}</span></td>
      <td>${rule.id}</td><td>${isDeny ? '禁止型' : '验证型'}</td><td>${content}</td>
      <td>
        <button data-act="toggle" data-id="${rule.id}">${rule.enabled === false ? '启用' : '停用'}</button>
        <button data-act="edit" data-id="${rule.id}">编辑</button>
        <button data-act="del" data-id="${rule.id}" class="danger">删除</button>
      </td>`
    tbody.appendChild(tr)
  }
  tbody.querySelectorAll('button').forEach(button => button.addEventListener('click', () => ruleAction(button.dataset)))
}

function currentDoc() {
  const scope = $('#rules-scope').value
  return scope === 'global'
    ? (CURRENT_RULES.global ?? { project: 'global', scope: 'global', policy: { hard: [] } })
    : (CURRENT_RULES.project ?? { project: 'my-project', policy: { hard: [] } })
}

function setMsg(id, text, ok) {
  const el = $(id)
  el.textContent = text
  el.className = `msg ${ok ? 'ok' : 'bad'}`
}

async function savePolicy(doc, scope) {
  const { status, body } = await api(`/api/policy?scope=${scope}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
  if (status === 200 && body.ok) {
    setMsg('#rule-msg', `✓ 已保存（${body.rules} 条规则，下次插件激活时生效）`, true)
    CURRENT_RULES[scope] = doc
    loadRules()
  } else {
    setMsg('#rule-msg', `✗ ${(body.errors ?? ['保存失败']).join('\n')}`, false)
  }
}

function ruleAction({ act, id }) {
  const doc = currentDoc()
  const rules = doc.policy.hard
  const rule = rules.find(r => r.id === id)
  if (rule === undefined) return

  if (act === 'del') {
    if (!confirm(`删除规则 "${id}"？`)) return
    doc.policy.hard = rules.filter(r => r.id !== id)
    void savePolicy(doc, doc.scope ?? 'project')
    return
  }
  if (act === 'toggle') {
    rule.enabled = rule.enabled === false
    doc.policy.hard = rules
    void savePolicy(doc, doc.scope ?? 'project')
    return
  }
  if (act === 'edit') {
    $('#rule-id').value = rule.id
    $('#rule-remediation').value = rule.remediation ?? ''
    $('#rule-scope').value = doc.scope ?? 'project'
    if ('denyTools' in rule) {
      $('#rule-kind').value = 'deny'
      $('#rule-deny-tools').value = rule.denyTools.join(', ')
      syncKindRows()
    } else {
      $('#rule-kind').value = 'tool_pass'
      syncKindRows()
      if (typeof rule.require === 'string') {
        $('#rule-require-builtin').value = rule.require
        $('#rule-require-tool').value = ''
        $('#rule-require-pattern').value = ''
      } else {
        $('#rule-require-builtin').value = '__custom'
        $('#rule-require-tool').value = rule.require.tool
        $('#rule-require-pattern').value = rule.require.passPattern ?? ''
      }
      syncRequireRows()
    }
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
  }
}

function syncKindRows() {
  const deny = $('#rule-kind').value === 'deny'
  $('#rule-deny-row').style.display = deny ? 'flex' : 'none'
  $('#rule-require-row').style.display = deny ? 'none' : 'flex'
}
function syncRequireRows() {
  const custom = $('#rule-require-builtin').value === '__custom'
  $('#rule-require-tool').style.display = custom ? 'block' : 'none'
  $('#rule-require-pattern').style.display = custom ? 'block' : 'none'
}
$('#rule-kind').addEventListener('change', syncKindRows)
$('#rule-require-builtin').addEventListener('change', syncRequireRows)
$('#rules-scope').addEventListener('change', loadRules)
$('#rules-reload').addEventListener('click', loadRules)

$('#rule-form').addEventListener('submit', event => {
  event.preventDefault()
  const doc = currentDoc()
  const scope = $('#rule-scope').value
  const id = $('#rule-id').value.trim()
  if (id.length === 0) return setMsg('#rule-msg', '✗ 规则 ID 不能为空', false)
  const existing = doc.policy.hard.find(r => r.id === id)
  const base = existing ?? { id, enforcement: 'hard' }

  let rule
  if ($('#rule-kind').value === 'deny') {
    rule = { ...base, id, trigger: 'always', denyTools: $('#rule-deny-tools').value.split(',').map(s => s.trim()).filter(Boolean) }
    if (rule.denyTools.length === 0) return setMsg('#rule-msg', '✗ 禁止型规则至少需要一个工具名', false)
  } else {
    const builtin = $('#rule-require-builtin').value
    const require = builtin === '__custom'
      ? { kind: 'tool_pass', tool: $('#rule-require-tool').value.trim(), ...( $('#rule-require-pattern').value.trim() ? { passPattern: $('#rule-require-pattern').value.trim() } : {}) }
      : builtin
    rule = { ...base, id, trigger: 'code_change', require }
  }
  const remediation = $('#rule-remediation').value.trim()
  if (remediation.length > 0) rule.remediation = remediation
  else delete rule.remediation

  doc.policy.hard = [rule, ...doc.policy.hard.filter(r => r.id !== id)]
  void savePolicy(doc, scope)
})

// --- candidates ----------------------------------------------------------------

async function loadCandidates() {
  const { body } = await api('/api/candidates')
  const container = $('#candidates')
  if ((body.candidates ?? []).length === 0) {
    container.innerHTML = '<p class="muted">暂无待审候选 —— 观察引擎在积累足够证据并达到置信度阈值后才会提名。</p>'
    return
  }
  container.innerHTML = ''
  for (const candidate of body.candidates) {
    const confidencePct = Math.round(candidate.confidence * 100)
    const badge = confidencePct >= 75 ? 'high' : 'mid'
    const div = document.createElement('div')
    div.className = 'candidate'
    div.innerHTML = `
      <strong>${candidate.id}</strong>
      <span class="badge ${badge}">置信度 ${confidencePct}%</span>
      <div class="meta">kind=${candidate.kind} · 出现 ${candidate.occurrences} 次 · 跨 ${candidate.distinctSessions} 个会话</div>
      ${candidate.evidence.map(e => `<div class="evidence">· [${e.sessionId}] ${e.detail}</div>`).join('')}
      <div class="draft">${candidate.draftMessage}</div>
      <div class="actions">
        <button class="primary" data-act="confirm">确认</button>
        <button data-act="edit">编辑文案</button>
        <button class="danger" data-act="reject">拒绝</button>
        <button data-act="skip">跳过</button>
      </div>`
    div.querySelectorAll('.actions button').forEach(button => {
      button.addEventListener('click', async () => {
        const action = button.dataset.act
        let message
        if (action === 'edit') {
          message = prompt('修改提醒文案：', candidate.draftMessage)
          if (message === null || message.trim().length === 0) return
        }
        if (action === 'reject' && !confirm('拒绝该候选？同签名候选将永不复活（可随时在观察日志中重开）。')) return
        const res = await api('/api/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ candidateId: candidate.id, action, message }),
        })
        if (res.status === 200) loadCandidates()
        else alert(`操作失败：${(res.body.errors ?? []).join('\n')}`)
      })
    })
    container.appendChild(div)
  }
}

// --- records (guards + preferences) ----------------------------------------------

async function loadRecords() {
  const { body } = await api('/api/records')
  const guards = body.records.filter(r => r.kind === 'behavior_pattern')
  const prefs = body.records.filter(r => r.kind === 'preference')

  const guardsBody = $('#guards-table tbody')
  guardsBody.innerHTML = ''
  for (const record of guards) {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td><span class="tag ${record.enabled ? 'on' : 'off'}">${record.enabled ? '启用' : '停用'}</span></td>
      <td>${record.id}</td>
      <td>${record.value.message ?? ''}</td>
      <td class="muted">${record.provenance.candidateId ?? '手动'}</td>
      <td>
        <button data-id="${record.id}" data-on="${record.enabled}">${record.enabled ? '停用' : '启用'}</button>
        <button class="danger" data-id="${record.id}">删除</button>
      </td>`
    tr.querySelectorAll('button').forEach(button => button.addEventListener('click', () => recordAction(button.dataset.id, button.dataset.on === 'true' ? 'disable' : 'enable')))
    guardsBody.appendChild(tr)
  }

  const prefsBody = $('#prefs-table tbody')
  prefsBody.innerHTML = ''
  for (const record of prefs) {
    const applies = record.value.appliesTo ?? {}
    const conditions = [
      applies.language ? `语言:${applies.language}` : null,
      applies.fileGlob ? `Glob:${applies.fileGlob.join(',')}` : null,
      applies.taskRegex ? `正则:${applies.taskRegex}` : null,
    ].filter(Boolean).join(' · ') || '无条件'
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td><span class="tag ${record.enabled ? 'on' : 'off'}">${record.enabled ? '启用' : '停用'}</span></td>
      <td>${record.id}</td>
      <td>${record.value.text ?? ''}</td>
      <td class="muted">${conditions}</td>
      <td>${record.value.priority ?? 50}</td>
      <td>
        <button data-id="${record.id}" data-on="${record.enabled}">${record.enabled ? '停用' : '启用'}</button>
        <button class="danger" data-id="${record.id}">删除</button>
      </td>`
    tr.querySelectorAll('button').forEach(button => button.addEventListener('click', () => recordAction(button.dataset.id, button.dataset.on === 'true' ? 'disable' : 'enable')))
    prefsBody.appendChild(tr)
  }
}

async function recordAction(id, action) {
  if (action === 'delete') {
    if (!confirm(`删除记录 "${id}"？（写入审计日志）`)) return
    await api(`/api/records/${id}`, { method: 'DELETE' })
  } else {
    await api(`/api/records/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: action === 'enable' }),
    })
  }
  loadRecords()
}

$('#guard-form').addEventListener('submit', async event => {
  event.preventDefault()
  const message = $('#guard-message').value.trim()
  if (message.length === 0) return
  const { status, body } = await api('/api/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'behavior_pattern', value: { message, trigger: { always: true } } }),
  })
  setMsg('#guard-msg', status === 200 ? `✓ 已新增 ${body.record.id}` : '✗ 失败', status === 200)
  if (status === 200) { $('#guard-message').value = ''; loadRecords() }
})

$('#pref-form').addEventListener('submit', async event => {
  event.preventDefault()
  const text = $('#pref-text').value.trim()
  if (text.length === 0) return
  const glob = $('#pref-glob').value.split(',').map(s => s.trim()).filter(Boolean)
  const value = {
    text,
    ...( $('#pref-language').value.trim() ? { appliesTo: { language: $('#pref-language').value.trim() } } : {}),
  }
  const appliesTo = {}
  if ($('#pref-language').value.trim()) appliesTo.language = $('#pref-language').value.trim()
  if (glob.length > 0) appliesTo.fileGlob = glob
  if ($('#pref-regex').value.trim()) appliesTo.taskRegex = $('#pref-regex').value.trim()
  if (Object.keys(appliesTo).length > 0) value.appliesTo = appliesTo
  value.priority = Number($('#pref-priority').value) || 50

  const { status, body } = await api('/api/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'preference', value }),
  })
  setMsg('#pref-msg', status === 200 ? `✓ 已新增 ${body.record.id}` : '✗ 失败', status === 200)
  if (status === 200) { $('#pref-text').value = ''; loadRecords() }
})

// --- projects ---------------------------------------------------------------------

async function loadProjects() {
  const { body } = await api('/api/projects')
  const tbody = $('#projects-table tbody')
  tbody.innerHTML = ''
  for (const [id, entry] of Object.entries(body.registry.projects ?? {})) {
    const tr = document.createElement('tr')
    const buttons = ['active', 'paused', 'completed'].map(state =>
      `<button data-id="${id}" data-state="${state}" ${entry.state === state ? 'disabled' : ''}>${state === 'active' ? '恢复' : state}</button>`).join(' ')
    tr.innerHTML = `<td>${id}</td><td><span class="tag ${entry.state === 'active' ? 'on' : 'off'}">${entry.state}</span></td><td>${buttons}</td>`
    tr.querySelectorAll('button:not([disabled])').forEach(button => button.addEventListener('click', async () => {
      const res = await api(`/api/projects/${encodeURIComponent(button.dataset.id)}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: button.dataset.state }),
      })
      if (res.status !== 200) alert(`失败：${(res.body.errors ?? []).join('\n')}`)
      loadProjects()
    }))
    tbody.appendChild(tr)
  }
  if (tbody.children.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="muted">暂无受管项目 —— 所有项目按 active 处理。</td></tr>'
  }
}

// --- evidence -----------------------------------------------------------------------

async function loadEvidence() {
  const { body } = await api('/api/evidence')
  const container = $('#evidence-list')
  container.innerHTML = ''
  if ((body.sessions ?? []).length === 0) {
    container.innerHTML = '<p class="muted">无证据会话（启动插件时设置 evidenceRoot 即开始记录）。</p>'
    return
  }
  const table = document.createElement('table')
  table.innerHTML = '<thead><tr><th>会话文件</th><th>大小</th><th>修改时间</th><th></th></tr></thead><tbody></tbody>'
  const tbody = table.querySelector('tbody')
  for (const session of body.sessions) {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td>${session.file}</td>
      <td>${(session.bytes / 1024).toFixed(1)} KB</td>
      <td class="muted">${new Date(session.modifiedAt).toLocaleString()}</td>
      <td><button data-file="${session.file}">查看最近 50 条</button></td>`
    tr.querySelector('button').addEventListener('click', async () => {
      const res = await api(`/api/evidence/${session.file}`)
      const events = (res.body.events ?? []).map(e => JSON.stringify(e)).join('\n')
      $('#evidence-view').textContent = events || '（空）'
    })
    tbody.appendChild(tr)
  }
  container.appendChild(table)
}

// --- boot ---------------------------------------------------------------------------

loadOverview()
