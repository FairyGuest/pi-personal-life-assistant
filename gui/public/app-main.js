import { createLocalForms } from './forms.js';
import { createFitnessTools } from './fitness-tools.js';
const $ = selector => document.querySelector(selector);
let savedDrafts = [];
try { savedDrafts = JSON.parse(sessionStorage.getItem('life-drafts') || '[]'); } catch {}
const state = { view: 'overview', dashboard: null, messages: [], dialogs: new Map(), sessions: [], current: {}, streamingText: '', drafts: new Map(Array.isArray(savedDrafts) ? savedDrafts : []), connected: false, metric: 'weight_kg', metricOffset: 0, notificationIds: new Set(), commandPending: false };
let token = location.hash.slice(1);
if (/^[a-f0-9]{64}$/.test(token)) { sessionStorage.setItem('life-window-token', token); history.replaceState(null, '', '/'); }
else token = sessionStorage.getItem('life-window-token') || '';
const icons = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2v-9.5A8.5 8.5 0 0 1 10.5 4h2a8.5 8.5 0 0 1 8.5 7.5Z"/><path d="M7 11h9M7 15h6"/>',
  fitness: '<path d="M2 12h4l3-8 5 16 3-8h5"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  plans: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M8 10h8M8 14h5M8 18h6"/>',
  skills: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4M18 4h4"/>',
  learning: '<path d="M12 5C7 2 2 4 2 4v15s5-2 10 1c5-3 10-1 10-1V4s-5-2-10 1zM12 5v15"/>',
  finance: '<path d="M4 21V10M10 21V5M16 21v-7M22 21H2"/>',
  career: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12c6 3 12 3 18 0M12 12v4"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  leaf: '<path d="M20 3C6 2 2 10 7 17s15 1 13-14Z M5 21l10-12M9 15h6"/>',
};
const domainLabels = { general: '生活', career: '职业', finance: '理财', learning: '学习', fitness: '身体', relationships: '情感' };
const kindLabels = { fact: '事实', goal: '目标', assumption: '假设', preference: '偏好', unknown: '待确认', milestone: '里程碑', task: '行动', job: '求职' };
const statusLabels = { planned: '待开始', active: '进行中', done: '已完成', paused: '暂停', deferred: '延后', applied: '已投递', test: '笔试', interview: '面试', offer: 'Offer', rejected: '未通过', withdrawn: '已撤回', waiting: '等待反馈' };
const sections = [['overview', '生活看板', 'home'], ['chat', '和助手聊聊', 'chat'], ['fitness', '身体与锻炼', 'fitness'], ['profile', '我的资料', 'profile'], ['plans', '目标与行动', 'plans'], ['skills', '场景技能', 'skills']];
const svgNamespace = 'http://www.w3.org/2000/svg';
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function icon(name) { const node = element('span', 'nav-icon'); node.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.leaf}</svg>`; return node; }
function button(text, className, callback) { const node = element('button', className, text); node.type = 'button'; node.addEventListener('click', () => Promise.resolve().then(callback).catch(report)); return node; }
function report(error) { toast(error?.message || '操作失败，请重试。'); }
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('#toast').hidden = true; }, 7000); }
async function api(route, body) {
  const options = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Life-Token': token }, body: JSON.stringify(body) };
  let response; let data;
  try {
    response = await fetch(route, { ...options, signal: AbortSignal.timeout(route === '/api/command' ? 3600000 : route === '/api/local/commit' ? 300000 : 30000) });
    data = await response.json();
  } catch (error) {
    if (error.name === 'TimeoutError') throw new Error('本地服务响应超时，不会自动重试。若刚才正在保存，请先核对记录是否已保存，再决定是否重试。');
    throw error;
  }
  if (!response.ok) throw new Error(data.error || '无法连接生活助手。');
  return data;
}
function setConnection(connected) { state.connected = connected; $('#connection-dot').classList.toggle('connected', connected); $('#connection-label').textContent = connected ? '个人 DeepSeek · 已连接' : '连接中断 · 等待恢复'; updateComposer(); }
let dashboardRequest = 0;
async function refreshData() { const request = ++dashboardRequest; const data = await api(`/api/dashboard?history=${Boolean(state.profileHistory)}`); if (request !== dashboardRequest) return; state.dashboard = data; if (state.view !== 'chat') await renderView(); }
const localForms = createLocalForms({ api, data: () => state.dashboard, changed: refreshData, toast });
const fitnessDraft = {};
async function refreshSessions() { state.sessions = await api('/api/sessions'); renderSessions(); }
function renderSessions() {
  const container = $('#sessions'); container.replaceChildren();
  for (const session of state.sessions) { const item = button(session.name, `session-item${session.id === state.current.sessionId ? ' active' : ''}`, async () => { saveDraft(); await command('switch', { sessionId: session.id }); showView('chat'); restoreDraft(); }); item.title = session.name; item.append(element('small', '', `${new Date(session.modified).toLocaleDateString('zh-CN')} · ${session.messageCount}条`)); container.append(item); }
}
function showView(name) {
  if (!sections.some(item => item[0] === name)) return;
  state.view = name;
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === name));
  $('#breadcrumb').textContent = `我的空间 / ${sections.find(item => item[0] === name)[1]}`;
  $('#view').hidden = name === 'chat'; $('#chat').hidden = name !== 'chat';
  if (name === 'chat') { renderMessages(); updateComposer(); $('#message-input').focus(); }
  else renderView().catch(report);
}
function saveDraft() { if (state.current.sessionId) { state.drafts.set(state.current.sessionId, $('#message-input').value); try { sessionStorage.setItem('life-drafts', JSON.stringify([...state.drafts].slice(-50))); } catch {} } }
function restoreDraft() { $('#message-input').value = state.drafts.get(state.current.sessionId) || ''; }
async function command(type, fields = {}) {
  if (state.commandPending) throw new Error('请先完成当前操作。');
  state.commandPending = true; updateComposer();
  try { return await api('/api/command', { ...fields, type, expectedSessionId: state.current.sessionId }); }
  finally { state.commandPending = false; updateComposer(); refreshSessions().catch(() => {}); refreshData().catch(() => {}); }
}
async function localCommand(message) { if (state.current.busy) throw new Error('请先停止当前对话。'); await command('prompt', { message }); }
function beginChat(message) { showView('chat'); $('#message-input').value = message; saveDraft(); }
function heading(title, subtitle, action) { const node = element('div', 'page-heading'); const text = element('div'); text.append(element('span', 'eyebrow', 'YOUR LIFE, IN PERSPECTIVE'), element('h1', '', title), element('p', '', subtitle)); node.append(text); if (action) node.append(action); return node; }
function card(title, action) { const node = element('section', 'card'); const header = element('div', 'card-header'); header.append(element('h2', '', title)); if (action) header.append(action); node.append(header); return node; }
function empty(title, description, iconName = 'leaf', compact = false) { const node = element('div', `empty${compact ? ' compact' : ''}`); node.append(icon(iconName), element('strong', '', title), element('p', '', description)); return node; }
function badge(cloud) { return element('span', `badge${cloud ? ' cloud' : ''}`, cloud ? '已授权云端' : '仅本地'); }
function localNotice(text) { return element('div', 'privacy-note', text); }
function kpi(label, value, unit, note, iconName) { const node = element('article', 'kpi'); const labelNode = element('div', 'kpi-label'); labelNode.append(element('span', '', label), icon(iconName)); const number = element('div', 'kpi-number', String(value)); number.append(element('small', '', unit)); node.append(labelNode, number, element('div', 'kpi-note', note)); return node; }
function planRow(plan) { const node = element('div', 'plan-row'); const text = element('div'); text.append(element('strong', '', plan.title), element('small', '', plan.next_action || '还没有下一步行动')); if (plan.due_date) text.append(element('small', '', `复盘 / 截止：${plan.due_date}`)); node.append(element('span', 'plan-bullet'), text, element('span', 'plan-status', statusLabels[plan.status] || plan.status)); return node; }
function svgElement(tag, attributes = {}) { const node = document.createElementNS(svgNamespace, tag); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value)); return node; }
function drawChart(panel) {
  const chart = svgElement('svg', { viewBox: '0 0 600 220', class: 'panel-chart', role: 'img', 'aria-label': `${panel.label}历史趋势，按实际测量日期显示，缺失不补零` });
  const values = [...panel.raw_points, ...panel.daily, ...panel.averages].map(point => point.value).filter(value => value !== null);
  if (!values.length) return empty('还没有测量记录', `记录一次${panel.label}，趋势会从真实的数据开始。`, 'fitness');
  const time = date => Date.parse(`${date}T00:00:00Z`) / 86400000;
  const firstDay = time(panel.daily[0].date); const lastDay = time(panel.daily.at(-1).date);
  const minimum = Math.min(...values); const maximum = Math.max(...values); const padding = Math.max((maximum - minimum) * .18, .5);
  const low = minimum - padding; const high = maximum + padding;
  const x = point => 44 + (lastDay === firstDay ? .5 : (time(point.date) - firstDay) / (lastDay - firstDay)) * 537;
  const y = point => 180 - (point.value - low) / (high - low) * 155;
  for (let index = 0; index < 4; index++) { const position = 25 + index * 51.6; chart.append(svgElement('line', { x1: 44, y1: position, x2: 582, y2: position, class: 'gridline' })); const label = svgElement('text', { x: 3, y: position + 3 }); label.textContent = (high - index / 3 * (high - low)).toFixed(1); chart.append(label); }
  function line(points, className) { let previous; let pathData = ''; for (const point of points) { if (point.value === null) { previous = null; continue; } const join = previous && time(point.date) - time(previous.date) <= 1; pathData += `${join ? 'L' : 'M'}${x(point).toFixed(2)},${y(point).toFixed(2)} `; previous = point; } chart.append(svgElement('path', { d: pathData, class: className })); }
  line(panel.daily, 'daily-line'); line(panel.averages, 'average-line');
  for (const point of panel.raw_points) { const dot = svgElement('circle', { cx: x(point), cy: y(point), r: 2.5, class: 'raw-point' }); const title = svgElement('title'); title.textContent = `${point.date} ${point.time || ''}：${point.value}${panel.unit}（原始测量）`; dot.append(title); chart.append(dot); }
  for (const point of panel.daily) { const dot = svgElement('circle', { cx: x(point), cy: y(point), r: 3.6, class: 'daily-point' }); const title = svgElement('title'); title.textContent = `${point.date}：${point.value.toFixed(2)}${panel.unit}（${panel.daily_label}，共${point.count}次记录）`; dot.append(title); chart.append(dot); }
  for (const [point, anchor] of [[panel.daily[0], 'start'], [panel.daily.at(-1), 'end']]) { const label = svgElement('text', { x: x(point), y: 208, 'text-anchor': anchor }); label.textContent = point.date.slice(5); chart.append(label); }
  return chart;
}
function chartCard(panel, extraClass = '') { const node = card(`${panel.label}（${panel.unit}）`, element('small', '', `${panel.summary.records}次记录`)); if (extraClass) node.classList.add(extraClass); if (panel.daily.length) { const summary = element('div', 'chart-summary'); const latest = element('div'); latest.append(element('strong', '', `${Number(panel.daily.at(-1).value.toFixed(2))}`), element('small', '', `${panel.daily_label} · ${panel.daily.at(-1).date}`)); summary.append(latest); node.append(summary); } node.append(drawChart(panel)); const legend = element('div', 'chart-legend'); for (const [text, className] of [[panel.daily_label, ''], ['7日已观测均值', 'warm'], ['原始记录', 'pale']]) { const label = element('span'); label.append(element('i', `legend-dot ${className}`), document.createTextNode(text)); legend.append(label); } node.append(legend); return node; }
let viewRevision = 0;
async function renderView() {
  const revision = ++viewRevision;
  const target = $('#view'); const view = state.view; const data = state.dashboard;
  if (view === 'chat') return;
  if (!data) { target.replaceChildren(empty('正在整理你的空间', '连接本地资料，不会把看板数据发送给模型。')); return; }
  const fragment = document.createDocumentFragment();
  if (view === 'overview') {
    const date = element('div', 'date-card', new Date(`${data.today}T12:00:00`).toLocaleDateString('zh-CN', { weekday: 'long' })); date.append(element('strong', '', data.today.slice(5).replace('-', ' / ')));
    fragment.append(heading('把日子，过成自己的方向。', '从一个小行动开始，让职业、身体和未来慢慢对齐。', date));
    const metrics = await api('/api/series'); if (state.view !== view || revision !== viewRevision) return;
    const weight = metrics.panels.find(panel => panel.metric === 'weight_kg'); const waist = metrics.panels.find(panel => panel.metric === 'waist_cm');
    const recentWeight = data.latestMetrics.weight_kg; const recentWaist = data.latestMetrics.waist_cm;
    const kpis = element('div', 'kpi-grid'); kpis.append(kpi('最近一次体重', recentWeight?.value ?? '—', 'kg', recentWeight ? `${recentWeight.measured_date} ${recentWeight.measured_time || ''}` : '等待第一次记录', 'fitness'), kpi('最近一次腰围', recentWaist?.value ?? '—', 'cm', recentWaist ? `${recentWaist.measured_date} ${recentWaist.measured_time || ''}` : '保持相同测量口径', 'leaf'), kpi('待推进行动', data.summary.pending_tasks, '项', data.summary.overdue_tasks ? `${data.summary.overdue_tasks}项已过截止日，建议重新安排` : '只统计待开始 / 进行中的具体行动', 'plans')); fragment.append(kpis);
    const grid = element('div', 'dashboard-grid'); const left = element('div'); const right = element('div');
    const actions = card('今天，照顾一下自己', element('small', '', '一步就好')); if (data.pendingRecovery) actions.append(element('p', 'form-warning', `有${data.pendingRecovery}次训练待记录训练后的疲劳与酸痛。现在回顾，下一次计划才有依据。`), button('填写恢复反馈 →', 'secondary', () => showView('fitness'))); const quick = element('div', 'quick-grid');
    for (const [title, description, image, callback] of [['记录身体', '一次填写多项指标', 'fitness', () => localForms.metrics()], ['整理下一步', '目标、行动与复盘', 'plans', () => showView('plans')], ['聊一件心事', '不用急着给出答案', 'heart', () => beginChat('我想聊聊最近的情绪，请先听我说，再帮我澄清。')]]) { const node = button('', 'quick-item', callback); const imageNode = element('span', 'quick-icon'); imageNode.append(icon(image)); node.append(imageNode, element('strong', '', title), element('small', '', description)); quick.append(node); } actions.append(quick); left.append(actions, chartCard(weight, 'spaced'));
    const journey = element('section', 'card journey-card'); const journeyTop = element('div', 'journey-top'); journeyTop.append(element('span', 'eyebrow', 'A LONGER VIEW'), icon('leaf')); journey.append(journeyTop, element('h2', '', '先看清方向，\n再走好这一段。'), element('p', '', '生活助手会陪你梳理长期目标与阶段选择。具体建议基于你确认的现状，而不是凭空猜测。'), button('开始一次生活复盘 →', 'primary', () => beginChat('帮我做一次生活复盘：先问我当前阶段与优先事项，再规划本周一个可执行的行动。'))); right.append(journey);
    const plans = card('接下来的一小步', button('查看全部 →', 'text-button', () => showView('plans'))); plans.classList.add('spaced'); const pending = data.summary.next_actions; pending.forEach(plan => plans.append(planRow(plan))); if (!pending.length) plans.append(empty('还没有待办行动', '把一个长期愿望拆成一个本周的小目标。', 'plans', true)); plans.append(element('div', 'mini-footer', '保存需确认 · 不会自动交易、投递或设提醒')); right.append(plans); grid.append(left, right); fragment.append(grid, element('p', 'footer-note', '数据只取自你的本地记录 · 不替代医疗、投资或心理专业意见'));
  } else if (view === 'fitness') {
    fragment.append(heading('看见身体的变化。', '选择训练部位，记录真实组数与体感，再用自己的反馈调整下一次；测量趋势仍可随时查看。', button('＋ 记录测量', 'primary', () => localForms.metrics(undefined, state.metric))));
    const fitness = await api('/api/fitness'); if (state.view !== view || revision !== viewRevision) return;
    fragment.append(createFitnessTools({ info: fitness, api, localForms, draft: fitnessDraft, beginChat }));
    const toolbar = element('div', 'toolbar'); const select = element('select'); select.id = 'metric-select'; select.setAttribute('aria-label', '选择身体指标'); for (const [key, label] of Object.entries(data.metricLabels)) { const option = element('option', '', `${label}（${data.metricUnits[key]}）`); option.value = key; select.append(option); } select.value = state.metric; select.addEventListener('change', () => { state.metric = select.value; state.metricOffset = 0; renderView().catch(report); });
    const start = element('input'); start.type = 'date'; start.id = 'range-start'; start.setAttribute('aria-label', '开始日期'); start.value = state.start || ''; const end = element('input'); end.type = 'date'; end.id = 'range-end'; end.setAttribute('aria-label', '结束日期'); end.value = state.end || '';
    const historyToggle = element('label', 'inline-check'); const historyCheck = element('input'); historyCheck.type = 'checkbox'; historyCheck.checked = Boolean(state.metricHistory); historyCheck.addEventListener('change', () => { state.metricHistory = historyCheck.checked; state.metricOffset = 0; renderView().catch(report); }); historyToggle.append(historyCheck, document.createTextNode('显示旧版本'));
    toolbar.append(select, start, element('span', '', '至'), end, button('查看趋势', 'secondary', () => { state.start = start.value; state.end = end.value; state.metricOffset = 0; return renderView(); }), historyToggle, button('导出当前趋势', 'primary', () => localForms.chart(state.metric === 'waist_cm' ? ['waist_cm', 'weight_kg'] : [state.metric, 'waist_cm'], state.start, state.end))); fragment.append(toolbar);
    const selectedMetrics = state.metric === 'waist_cm' ? ['waist_cm', 'weight_kg'] : [state.metric, 'waist_cm'];
    const [series, history, files] = await Promise.all([api(`/api/series?metrics=${selectedMetrics.join(',')}&start=${state.start || ''}&end=${state.end || ''}`), api(`/api/metrics?metric=${state.metric}&offset=${state.metricOffset}&history=${Boolean(state.metricHistory)}&start=${state.start || ''}&end=${state.end || ''}`), api('/api/charts')]); if (state.view !== view || revision !== viewRevision) return;
    const charts = element('div', 'metric-grid'); series.panels.forEach(panel => charts.append(chartCard(panel))); fragment.append(charts, element('p', 'privacy-note spaced', '体重、腰围、体脂与静息心率显示同日日均；步数、睡眠和训练为当日最新总量，不重复相加。缺测不补零；历史和导出沿用同一日期范围。'));
    const historyCard = card(state.metricHistory ? '测量历史（含旧版本）' : '测量记录（当前有效）');
    historyCard.append(table(['日期 / 时间', '指标', '数值', '测量口径', '状态 / 隐私', '操作'], history.rows.map(row => { const actions = element('div', 'row-actions'); if (row.is_current) actions.append(button('更正', 'text-button', () => localForms.metrics(row)), button('删除', 'text-button', () => localForms.remove('metric', row))); actions.append(button('历史', 'text-button', () => showMetricHistory(row))); return [`${row.measured_date} ${row.measured_time || ''}`, data.metricLabels[row.metric], `${row.value} ${data.metricUnits[row.metric]}`, `${row.method || '未注明'}${row.note ? ` · ${row.note}` : ''}`, `${row.is_current ? '有效' : '已更正'} · ${row.cloud_allowed ? '已授权' : '仅本地'}`, actions]; })));
    if (!history.rows.length) historyCard.append(empty('没有历史测量', '不会用演示数字填充你的个人档案。', 'fitness', true)); const pager = element('div', 'pager'); const previous = button('上一页', 'secondary', () => { state.metricOffset = Math.max(0, state.metricOffset - 50); return renderView(); }); previous.disabled = state.metricOffset === 0; const next = button('下一页', 'secondary', () => { state.metricOffset += 50; return renderView(); }); next.disabled = !history.hasMore; pager.append(previous, element('span', '', `第${state.metricOffset / 50 + 1}页`), next); historyCard.append(pager); historyCard.classList.add('spaced'); fragment.append(historyCard);
    const downloads = card('已生成的本地图表与数据'); downloads.classList.add('spaced'); const list = element('div', 'download-list'); for (const file of files.slice(0, 20)) { const format = file.name.endsWith('-raw.csv') ? '原始测量CSV' : { png: '折线图PNG', svg: '矢量图SVG', html: '离线网页', csv: '每日统计CSV' }[file.name.split('.').at(-1)]; const link = element('a', 'download-link', `${new Date(file.modified).toLocaleString('zh-CN')} · ${format}`); link.href = `/api/chart/${encodeURIComponent(file.name)}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; list.append(link); } if (!files.length) list.append(element('p', 'muted', '点击“导出当前趋势”，确认后生成图表及中文CSV。')); downloads.append(list); fragment.append(downloads);
  } else if (view === 'profile') {
    fragment.append(heading('你的资料，你来定义。', '添加新资料，或在已有资料上直接编辑；旧版本自动保留。', button('＋ 添加资料', 'primary', () => localForms.memory())));
    fragment.append(localNotice('这里查看资料不调用模型。仅本地记录不会在后续新对话中自动共享；已授权记录会按场景发送给个人DeepSeek。聊天、数据库、图表和备份未加密，删除资料不会清除旧会话或旧导出。'));
    const toolbar = element('div', 'toolbar'); toolbar.append(button(state.profileHistory ? '查看当前资料' : '查看变更历史', 'secondary', async () => { state.profileHistory = !state.profileHistory; await refreshData(); }), button('导出全部资料', 'secondary', () => localCommand('/profile export')), button('创建本地备份', 'secondary', () => localCommand('/profile backup'))); fragment.append(toolbar);
    const rows = data.memory; const records = element('div', 'record-grid'); for (const row of rows) { const node = element('article', 'card record-card'); node.append(element('h3', '', row.key), element('p', '', `${row.value}${row.unit ? ` ${row.unit}` : ''}`)); const meta = element('div', 'record-meta'); meta.append(element('span', '', `${domainLabels[row.domain]} · ${kindLabels[row.kind]} · ${row.effective_date}${row.is_current ? '' : ' · 历史版本'}`), badge(row.cloud_allowed)); node.append(meta); if (row.is_current) { const actions = element('div', 'row-actions'); actions.append(button('编辑', 'text-button', () => localForms.memory(row)), button('删除', 'text-button', () => localForms.remove('memory', row))); node.append(actions); } records.append(node); } fragment.append(records); if (!rows.length) fragment.append(empty('个人资料还是一张白纸', '添加当前阶段、工作或偏好。每一项都由你确认。', 'profile')); fragment.append(element('p', 'footer-note', '当前页面最多显示100条 · 完整历史请使用导出'));
  } else if (view === 'plans') {
    fragment.append(heading('大方向，小行动。', '关联长期目标 → 阶段里程碑 → 具体行动，求职机会单独管理。', button('＋ 添加目标 / 行动', 'primary', () => localForms.plan()))); fragment.append(localNotice('编辑、状态更新、拆分下级和删除都可在当前卡片完成，保留修改历史。有未完成下级时不会把上级直接标为完成。这里不自动交易、投递或设置提醒。'));
    for (const [kind, title] of Object.entries(data.catalog.planKinds)) {
      const items = data.plans.filter(plan => plan.kind === kind); if (!items.length) continue;
      const group = element('section', 'plan-group'); group.append(element('h2', '', title)); const grid = element('div', 'record-grid');
      for (const plan of items) { const node = element('article', 'card record-card'); node.append(element('h3', '', plan.title), element('p', '', plan.next_action || '下一步还没有定义')); const meta = element('div', 'record-meta'); meta.append(element('span', '', `${domainLabels[plan.domain]} · ${statusLabels[plan.status]}`), badge(plan.cloud_allowed)); if (plan.due_date) meta.append(element('span', '', `日期 ${plan.due_date}`)); node.append(meta); if (plan.parent_id) node.append(element('div', 'plan-parent', `所属：${data.plans.find(row => row.id === plan.parent_id)?.title || '已关联的上级计划'}`)); if (plan.detail) node.append(element('p', 'muted spaced', plan.detail)); const actions = element('div', 'row-actions'); actions.append(button('编辑 / 改状态', 'text-button', () => localForms.plan(plan)), button('历史', 'text-button', () => showPlanHistory(plan)), button('删除', 'text-button', () => localForms.remove('plan', plan))); if (['goal', 'milestone'].includes(plan.kind)) actions.append(button('拆分下一步', 'text-button', () => localForms.plan(undefined, plan))); node.append(actions); grid.append(node); }
      group.append(grid); fragment.append(group);
    }
    if (!data.plans.length) fragment.append(empty('先留下一个方向', '职业里程碑、退休规划、学习计划或一个本周任务。', 'plans')); fragment.append(element('p', 'footer-note', '最多显示最近100条计划 · 计数使用数据库全量，不把长期目标误算成待办'));
  } else if (view === 'skills') {
    fragment.append(heading('不同的事，换一种思路。', '六个场景工作流，共享同一份你确认的资料。')); const grid = element('div', 'skills-grid'); const prompts = { 'life-planning': '请先问我当前阶段、重要目标与约束，再从宏观到微观帮我规划。', 'fitness-tracking': '帮我建立可持续的锻炼与指标记录习惯，先问测量口径和身体情况。', 'finance-planning': '帮我做退休规划，区分收益假设与安全提款，先核对收入、投入、大额支出和通胀口径。', 'career-search': '帮我分析求职漏斗和Agent岗位匹配，先问投递、笔试、面试转化及项目经历。', 'learning-research': '帮我制定学习与论文阅读计划，先问学习目标，再检索可核验的原始资料。', 'emotional-support': '我想聊聊最近的感受。请先共情与澄清，不急着判断或给我一堆建议。' }; const domainIcons = { general: 'plans', fitness: 'fitness', finance: 'finance', career: 'career', learning: 'learning', relationships: 'heart' };
    for (const skill of data.skills) { const node = element('article', 'card skill-card'); const picture = element('span', 'quick-icon'); picture.append(icon(domainIcons[skill.domain])); node.append(picture, element('h2', '', skill.title), element('p', '', skill.description), button('进入这个场景 →', 'secondary', () => beginChat(`/skill:${skill.name} ${prompts[skill.name]}`))); grid.append(node); } fragment.append(grid, element('p', 'footer-note', '选择场景只准备一条消息 · 点击发送后才调用个人DeepSeek'));
  }
  if (state.view === view && revision === viewRevision) target.replaceChildren(fragment);
}
function table(headers, rows) { const wrap = element('div', 'table-wrap'); const tableNode = element('table', 'data-table'); const head = element('thead'); const header = element('tr'); headers.forEach(text => header.append(element('th', '', text))); head.append(header); const body = element('tbody'); for (const row of rows) { const node = element('tr'); row.forEach(value => { const cell = element('td'); if (value instanceof Node) cell.append(value); else cell.textContent = value; node.append(cell); }); body.append(node); } tableNode.append(head, body); wrap.append(tableNode); return wrap; }
function showHistory(title, content) { $('#notice-dialog h2').textContent = title; $('#notice-content').textContent = content; if (!$('#notice-dialog').open) $('#notice-dialog').showModal(); }
async function showMetricHistory(row) { const records = await api(`/api/metric-history?recordId=${encodeURIComponent(row.record_id)}`); showHistory('这次测量的修改历史', records.map(item => `第${item.revision}版 · ${item.is_current ? '当前有效' : '历史'}\n${state.dashboard.metricLabels[item.metric]}：${item.value} ${state.dashboard.metricUnits[item.metric]}\n${item.measured_date} ${item.measured_time || ''}\n${item.method || ''} ${item.note || ''}\n${item.cloud_allowed ? '已授权云端' : '仅本地'}`).join('\n\n')); }
async function showPlanHistory(plan) { const records = await api(`/api/plan-history?id=${encodeURIComponent(plan.id)}`); showHistory('计划修改历史', records.map(item => `第${item.revision}版 · ${new Date(item.recorded_at).toLocaleString('zh-CN')}\n${item.title}\n${statusLabels[item.status]} · 下一步：${item.next_action || '未填写'}\n日期：${item.due_date || '未设置'}`).join('\n\n')); }
function formattedText(text) {
  const result = element('div', 'message-body'); let code = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) { if (code) code = null; else { code = element('pre'); result.append(code); } continue; }
    if (code) { code.append(document.createTextNode(`${line}\n`)); continue; }
    if (/^#{1,4} /.test(line)) { result.append(element('h2', '', line.replace(/^#+ /, ''))); continue; }
    const paragraph = element('div'); const parts = line.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g);
    for (const part of parts) { if (part.startsWith('**') && part.endsWith('**')) paragraph.append(element('strong', '', part.slice(2, -2))); else { const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/); if (link) { const node = element('a', '', link[1]); node.href = link[2]; node.target = '_blank'; node.rel = 'noopener noreferrer'; paragraph.append(node); } else paragraph.append(document.createTextNode(part)); } }
    if (!line) paragraph.append(element('br')); result.append(paragraph);
  }
  return result;
}
function renderMessages() {
  const container = $('#messages'); const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 90;
  const fragment = document.createDocumentFragment();
  if (!state.messages.length && !state.streamingText) { const node = element('div', 'chat-empty'); node.append(element('div', 'brand-mark', '栖'), element('h2', '', '今天，从哪里聊起？'), element('p', '', '工作、学习、理财、身体，或者只是一件心事。')); fragment.append(node); }
  for (const message of [...state.messages, ...(state.streamingText ? [{ role: 'assistant', text: state.streamingText }] : [])]) {
    const node = element('article', `message ${message.role}${message.isError ? ' error' : ''}`);
    if (message.role === 'toolResult') { const details = element('details'); details.append(element('summary', '', `${message.isError ? '操作未完成' : '工具结果'} · ${message.toolName || '生活工具'}`), element('pre', '', message.text)); node.append(details); }
    else { node.append(element('div', 'message-label', message.role === 'user' ? '我' : '栖 · 个人 DeepSeek'), formattedText(message.text || (message.isError ? '模型未能完成回复，请检查连接并重试。' : ''))); }
    fragment.append(node);
  }
  container.replaceChildren(fragment); if (nearBottom) container.scrollTop = container.scrollHeight;
  $('#session-title').textContent = state.current.sessionName || '新对话';
}
function updateComposer() { const busy = state.current.busy || state.current.operation || state.commandPending; $('#send').disabled = !state.connected || Boolean(busy); $('#stop').hidden = !busy; $('#new-session').disabled = Boolean(busy); $('#rename-session').disabled = Boolean(busy); $('#composer-hint').textContent = busy ? '助手处理中；有确认弹窗时，请先完成确认。' : 'Enter 发送 · Shift + Enter 换行'; }
let activeDialog;
function showNextDialog() {
  const dialog = $('#approval-dialog');
  if (activeDialog && state.dialogs.has(activeDialog.id)) return;
  if (dialog.open) dialog.close(); activeDialog = undefined;
  const next = [...state.dialogs.values()].find(item => item.expiresAt > Date.now()); if (!next) return;
  activeDialog = next;
  const inputMode = ['input', 'editor'].includes(next.method); const selectMode = next.method === 'select'; const confirmMode = next.method === 'confirm';
  $('#approval-kind').textContent = confirmMode ? '权限确认 · 不会自动批准' : '本地操作 · 你的输入不会自动发给模型';
  $('#approval-title').textContent = next.title || '请确认'; $('#approval-description').textContent = confirmMode ? '请核对本次操作及共享范围。不确定时，可以拒绝。' : '这是生活助手发起的交互。只有确认保存和云端授权后才生效。';
  $('#approval-message').textContent = next.message || ''; $('#approval-message').hidden = !next.message;
  $('#approval-value').hidden = !inputMode; $('#approval-label').hidden = !inputMode; $('#approval-value').value = next.prefill || ''; $('#approval-value').placeholder = next.placeholder || '';
  $('#approval-options').hidden = !selectMode; $('#approval-options').replaceChildren(); if (selectMode) for (const text of next.options || []) { const option = element('option', '', text); option.value = text; $('#approval-options').append(option); }
  $('#approval-accept').textContent = confirmMode ? '允许本次操作' : '确认'; $('#approval-expiry').textContent = '关闭或按 Esc 将取消本次操作；不会默认同意。'; $('#approval-accept').disabled = false; $('#approval-cancel').disabled = false;
  dialog.showModal(); if (inputMode) $('#approval-value').focus();
}
async function answerDialog(approve) {
  if (!activeDialog) return; const current = activeDialog;
  $('#approval-accept').disabled = true; $('#approval-cancel').disabled = true;
  const body = !approve ? { cancelled: true } : current.method === 'confirm' ? { confirmed: true } : { value: current.method === 'select' ? $('#approval-options').value : $('#approval-value').value };
  try { await api('/api/dialog', { id: current.id, ...body }); }
  catch (error) { report(error); }
  state.dialogs.delete(current.id);
  if (activeDialog?.id === current.id) { activeDialog = undefined; if ($('#approval-dialog').open) $('#approval-dialog').close(); }
  showNextDialog();
}
function notification(value) {
  if (state.notificationIds.has(value.id)) return; state.notificationIds.add(value.id);
  if (value.message?.length > 450) { $('#notice-content').textContent = value.message; if (!$('#notice-dialog').open) $('#notice-dialog').showModal(); }
  else toast(value.message || '操作完成。');
}
function receive(event) {
  const value = JSON.parse(event.data);
  if (value.type === 'snapshot') {
    const oldId = state.current.sessionId; saveDraft(); state.current = value.state; setConnection(value.state.connected); state.messages = value.messages; state.streamingText = value.streamingText || ''; state.dialogs = new Map(value.dialogs.map(dialog => [dialog.id, dialog]));
    if (oldId !== state.current.sessionId) restoreDraft(); for (const notice of value.notifications || []) notification(notice); showNextDialog(); renderMessages(); updateComposer(); renderSessions(); return;
  }
  if (value.type === 'agent_start') state.current.busy = true;
  if (value.type === 'data_changed') { refreshData().catch(report); return; }
  if (value.type === 'operation_start') state.current.operation = true;
  if (value.type === 'message_start' && value.message?.role === 'assistant') state.streamingText = '';
  if (value.type === 'message_update' && value.assistantMessageEvent?.type === 'text_delta') state.streamingText += value.assistantMessageEvent.delta;
  if (value.type === 'message_end') { const message = value.message; const text = typeof message.content === 'string' ? message.content : (message.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n'); if (['user', 'assistant', 'toolResult'].includes(message.role) && (text || message.role === 'assistant')) state.messages.push({ role: message.role, text, toolName: message.toolName, isError: message.isError || message.stopReason === 'error' }); if (message.role === 'assistant') state.streamingText = ''; }
  if (value.type === 'tool_execution_start') { $('#activity').hidden = false; $('#activity').textContent = `正在使用生活工具 · ${value.toolName}`; }
  if (value.type === 'tool_execution_end') { $('#activity').hidden = true; refreshData().catch(() => {}); }
  if (value.type === 'agent_settled') { state.current.busy = false; state.streamingText = ''; $('#activity').hidden = true; refreshData().catch(report); refreshSessions().catch(report); }
  if (value.type === 'extension_error') toast('生活工具出现异常，本次操作可能未完成。');
  if (value.type === 'bridge_error') { state.current.busy = false; state.current.operation = false; setConnection(false); toast(value.message); }
  if (value.type === 'extension_ui_request') { if (['input', 'editor', 'select', 'confirm'].includes(value.method)) { state.dialogs.set(value.id, value); showNextDialog(); } else if (value.method === 'notify') notification(value); }
  if (['dialog_answered', 'dialog_expired'].includes(value.type)) { state.dialogs.delete(value.id); showNextDialog(); }
  renderMessages(); updateComposer();
}
function localChoice(title, choices) {
  return new Promise(resolve => {
    const dialog = element('dialog', 'approval-dialog'); dialog.append(element('h2', '', title));
    function close(value) { dialog.close(); dialog.remove(); resolve(value); }
    for (const choice of choices) dialog.append(button(choice, 'secondary spaced', () => close(choice)));
    dialog.append(button('取消', 'secondary spaced', () => close(null))); dialog.addEventListener('cancel', event => { event.preventDefault(); close(null); }); document.body.append(dialog); dialog.showModal();
  });
}
$('#approval-form').addEventListener('submit', event => { event.preventDefault(); answerDialog(true).catch(report); }); $('#approval-cancel').addEventListener('click', () => answerDialog(false)); $('#approval-dialog').addEventListener('cancel', event => { event.preventDefault(); answerDialog(false); }); $('#notice-close').addEventListener('click', () => $('#notice-dialog').close());
$('#composer').addEventListener('submit', async event => { event.preventDefault(); const message = $('#message-input').value.trim(); if (!message || $('#send').disabled) return; $('#message-input').value = ''; saveDraft(); try { await command('prompt', { message }); } catch (error) { $('#message-input').value = message; saveDraft(); report(error); } });
$('#message-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('#composer').requestSubmit(); } }); $('#message-input').addEventListener('input', saveDraft);
$('#stop').addEventListener('click', () => api('/api/abort', {}).catch(report)); $('#new-session').addEventListener('click', async () => { try { saveDraft(); await command('new'); showView('chat'); restoreDraft(); } catch (error) { report(error); } });
$('#rename-session').addEventListener('click', async () => { const name = window.prompt('给这个对话起个名字', state.current.sessionName || ''); if (name?.trim()) { try { await command('rename', { name }); } catch (error) { report(error); } } }); $('#chat-profile').addEventListener('click', () => showView('profile'));
$('#shutdown').addEventListener('click', async () => { const choice = await localChoice('关闭本地服务？待确认操作会取消，当前生成会停止。', ['关闭服务']); if (choice) { await api('/api/shutdown', {}).catch(report); setConnection(false); toast('本地服务已关闭。下次双击“打开生活助手”即可重新启动。'); } });
$('.brand').addEventListener('click', event => { event.preventDefault(); showView('overview'); });
for (const [name, title, image] of sections) {
  const node = button('', `nav-item${name === state.view ? ' active' : ''}`, () => showView(name)); node.dataset.view = name; node.title = title; node.append(icon(image), element('span', 'nav-text', title)); $('#navigation').append(node);
  if (name === 'fitness') {
    const library = button('', 'nav-item', async () => { const info = await api('/api/fitness'); localForms.exerciseLibrary(info.options); });
    library.title = '动作库'; library.append(icon('learning'), element('span', 'nav-text', '动作库')); $('#navigation').append(library);
  }
}
setInterval(() => { const now = Date.now(); for (const [id, dialog] of state.dialogs) if (dialog.expiresAt <= now) state.dialogs.delete(id); showNextDialog(); }, 1000);
setInterval(() => { if (state.connected) { refreshData().catch(() => {}); refreshSessions().catch(() => {}); } }, 30000);
async function boot() {
  await api('/api/connect', { token }); await refreshData(); await refreshSessions();
  const events = new EventSource('/api/events'); events.addEventListener('message', receive); events.addEventListener('open', () => setConnection(true)); events.addEventListener('error', () => setConnection(false));
}
export const ready = boot();
