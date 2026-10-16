import { createTrainingExerciseEditor, showExerciseLibrary } from './training-editor.js';
import { entryFocuses } from './training-model.js';

const create = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const metricName = (catalog, key) => `${catalog.metrics[key].label}（${catalog.metrics[key].display_unit}）`;

export function createLocalForms({ api, data, changed, toast }) {
  let active = false;
  async function open(title, description, build, collect, action) {
    if (active) return;
    active = true;
    const dialog = create('dialog', 'local-form-dialog');
    const form = create('form'); const fields = create('div', 'local-form-fields'); const error = create('p', 'form-error'); error.setAttribute('role', 'alert');
    const preview = create('pre', 'local-preview'); preview.hidden = true;
    const warning = create('p', 'form-warning'); warning.hidden = true;
    const cancel = create('button', 'secondary', '取消'); cancel.type = 'button';
    const back = create('button', 'secondary', '返回修改'); back.type = 'button'; back.hidden = true;
    const save = create('button', 'primary', '核对并保存'); save.type = 'submit';
    const editActions = create('div', 'editor-footer-actions');
    const actions = create('div', 'dialog-actions'); actions.append(editActions, cancel, back, save);
    form.append(create('span', 'eyebrow', '本地管理 · 不调用模型'), create('h2', '', title), create('p', 'form-description', description), fields, preview, warning, error, actions); dialog.append(form); document.body.append(dialog);
    let prepared; let saving = false;
    const close = async () => { if (saving) return; if (prepared) await api('/api/local/cancel', { id: prepared.id }).catch(() => {}); dialog.close(); dialog.remove(); active = false; };
    cancel.addEventListener('click', close); dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    back.addEventListener('click', async () => { if (prepared) await api('/api/local/cancel', { id: prepared.id }).catch(() => {}); prepared = undefined; fields.hidden = false; editActions.hidden = false; preview.hidden = true; warning.hidden = true; back.hidden = true; save.textContent = '核对并保存'; error.textContent = ''; });
    const helpers = {
      field(label, name, value = '', type = 'text', options = {}) {
        const wrap = create('label', 'form-field'); const input = create(type === 'textarea' ? 'textarea' : 'input'); if (type !== 'textarea') input.type = type; input.name = name; input.value = value ?? ''; Object.assign(input, options); wrap.append(create('span', '', label), input); fields.append(wrap); return input;
      },
      select(label, name, dictionary, value) {
        const wrap = create('label', 'form-field'); const input = create('select'); input.name = name;
        for (const [key, title] of Object.entries(dictionary)) { const option = create('option', '', title); option.value = key; input.append(option); }
        if (value !== undefined) input.value = value; wrap.append(create('span', '', label), input); fields.append(wrap); return input;
      },
      note(text) { fields.append(create('p', 'form-description full-width', text)); },
      share(value = false, sensitive = false) {
        const wrap = create('label', 'form-check full-width'); const check = create('input'); check.type = 'checkbox'; check.name = 'cloud_allowed'; check.checked = sensitive ? false : value; check.disabled = sensitive; wrap.append(check, create('span', '', sensitive ? '敏感资料只能本地保存' : '允许在相关新对话中发给个人 DeepSeek（默认不勾选）')); fields.append(wrap); return check;
      }, fields, editActions,
    };
    const controls = build(helpers);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (saving) return; saving = true; error.textContent = ''; save.disabled = true; cancel.disabled = true; back.disabled = true;
      try {
        if (!prepared) { prepared = await api('/api/local/prepare', { action, input: await collect(controls) }); preview.textContent = prepared.summary; warning.textContent = prepared.warnings.join('\n'); warning.hidden = !prepared.warnings.length; fields.hidden = true; editActions.hidden = true; preview.hidden = false; back.hidden = false; save.textContent = action.endsWith('delete') ? '确认删除' : action === 'chart' ? '确认导出' : '确认保存'; }
        else { saving = true; cancel.disabled = true; back.disabled = true; const result = await api('/api/local/commit', { id: prepared.id }); prepared = undefined; dialog.close(); dialog.remove(); active = false; await changed(); toast(result.message); }
      } catch (failure) { error.textContent = failure.message; }
      finally { saving = false; save.disabled = false; cancel.disabled = false; back.disabled = false; }
    });
    dialog.showModal(); form.querySelector('input:not([type=checkbox]),select,textarea')?.focus();
  }

  const metrics = (previous, preferred) => {
    const { catalog, today, latestMetrics } = data();
    return open(previous ? '更正这次测量' : '记录身体与生活指标', '一次填写多项；空着代表不记录，不会补零。日期与时间共用，测量口径可逐项填写。', helper => {
      const date = helper.field('测量日期', 'measured_date', previous?.measured_date || today, 'date', { required: true, max: today });
      const time = helper.field('测量时间（选填）', 'measured_time', previous?.measured_time || '', 'time');
      const controls = [];
      const additional = create('details', 'additional-metrics full-width'); additional.append(create('summary', '', '更多指标：体脂、心率、步数、睡眠、训练')); if (preferred && !['weight_kg', 'waist_cm'].includes(preferred)) additional.open = true;
      for (const [key, item] of Object.entries(catalog.metrics)) {
        if (previous && key !== previous.metric) continue;
        const section = create('div', 'metric-input-row full-width'); const label = create('label', 'form-field'); const input = create('input'); input.type = 'number'; input.name = key; input.step = item.step; input.min = item.minimum; input.max = item.maximum; input.placeholder = '不记录则留空'; if (previous) { input.value = previous.value; input.required = true; }
        label.append(create('span', '', metricName(catalog, key)), input); const methodLabel = create('label', 'form-field'); const method = create('input'); method.name = `${key}_method`; method.value = previous?.method || latestMetrics[key]?.method || ''; method.placeholder = key === 'steps' || key === 'training_minutes' ? '设备 / 当天累计总量' : '如：晨起、同一设备'; method.maxLength = 160; methodLabel.append(create('span', '', '测量口径 / 设备（选填）'), method); section.append(label, methodLabel, create('small', 'full-width', item.hint)); if (previous || ['weight_kg', 'waist_cm'].includes(key)) helper.fields.append(section); else additional.append(section); controls.push({ key, input, method });
      }
      if (!previous) helper.fields.append(additional);
      const note = helper.field('备注（选填）', 'note', previous?.note || '', 'textarea', { maxLength: 300 }); const share = helper.share(Boolean(previous?.cloud_allowed)); return { date, time, controls, note, share };
    }, controls => ({ records: controls.controls.filter(row => row.input.value !== '').map(row => ({ metric: row.key, unit: catalog.metrics[row.key].unit, value: Number(row.input.value), measured_date: controls.date.value, measured_time: controls.time.value, method: row.method.value, note: controls.note.value, cloud_allowed: controls.share.checked, correction_of: previous?.id })) }), 'metric_save');
  };

  const memory = previous => {
    const { catalog, today } = data();
    return open(previous ? '更新个人资料' : '添加个人资料', '事实、目标与假设分别保存。编辑当前资料会保留原版本；更改字段名请另建资料。', helper => {
      const domain = helper.select('领域', 'domain', catalog.domains, previous?.domain || 'general'); domain.disabled = Boolean(previous);
      const key = helper.field('资料名称', 'key', previous?.key || '', 'text', { required: true, maxLength: 100, disabled: Boolean(previous), placeholder: '如：当前阶段、当前岗位、投资预算' });
      const kind = helper.select('信息类型', 'kind', catalog.kinds, previous?.kind || 'fact'); kind.disabled = Boolean(previous);
      const isHeight = previous?.domain === 'fitness' && previous.key === '身高' && previous.kind === 'fact';
      const value = helper.field(isHeight ? '身高（cm）' : '内容', 'value', previous?.value || '', isHeight ? 'number' : 'textarea', isHeight ? { required: true, min: 50, max: 250, step: '0.1' } : { required: true, maxLength: 1200 });
      const date = helper.field('生效日期', 'effective_date', previous?.effective_date || today, 'date', { required: true });
      const unit = helper.field('单位 / 口径（选填）', 'unit', previous?.unit || '', 'text', { maxLength: 40, placeholder: '如：税后元/月、年包万元' });
      if (isHeight) { unit.value = 'cm'; unit.disabled = true; }
      const sensitivity = helper.select('隐私级别', 'sensitivity', catalog.privacy, previous?.sensitivity || 'personal'); const share = helper.share(Boolean(previous?.cloud_allowed), sensitivity.value === 'sensitive');
      const refreshPrivacy = () => { if (domain.value === 'relationships') sensitivity.value = 'sensitive'; sensitivity.disabled = domain.value === 'relationships'; share.disabled = sensitivity.value === 'sensitive'; if (share.disabled) share.checked = false; };
      sensitivity.addEventListener('change', refreshPrivacy); domain.addEventListener('change', refreshPrivacy); refreshPrivacy();
      return { domain, key, kind, value, date, unit, sensitivity, share };
    }, controls => ({ domain: controls.domain.value, key: controls.key.value, kind: controls.kind.value, value: controls.value.value, effective_date: controls.date.value, unit: controls.unit.value, sensitivity: controls.sensitivity.value, cloud_allowed: controls.share.checked, expected_id: previous?.id }), 'memory_save');
  };

  const plan = (previous, parentPreset) => {
    const { catalog, today, plans } = data();
    return open(previous ? '编辑目标与行动' : '添加目标或行动', '长期目标 → 阶段里程碑 → 具体行动。求职机会单独管理；保存不代表自动执行。', helper => {
      const domain = helper.select('领域', 'domain', catalog.domains, previous?.domain || parentPreset?.domain || 'general');
      const kind = helper.select('计划类型', 'kind', catalog.planKinds, previous?.kind || (parentPreset?.kind === 'goal' ? 'milestone' : 'task'));
      const title = helper.field('标题', 'title', previous?.title || '', 'text', { required: true, maxLength: 160 });
      const parent = helper.select('所属目标 / 里程碑', 'parent_id', { '': '独立计划' }, previous?.parent_id || parentPreset?.id || '');
      const status = helper.select('当前状态', 'status', catalog.statuses, previous?.status || 'planned');
      const action = helper.field('下一步具体动作（选填）', 'next_action', previous?.next_action || '', 'textarea', { maxLength: 600 });
      const date = helper.field('复盘 / 截止日期（选填）', 'due_date', previous?.due_date || '', 'date');
      const detail = helper.field('补充说明（选填）', 'detail', previous?.detail || '', 'textarea', { maxLength: 1200 });
      const share = helper.share(Boolean(previous?.cloud_allowed), domain.value === 'relationships');
      function refresh() {
        const selectedParent = parent.value || previous?.parent_id || parentPreset?.id || ''; parent.replaceChildren(); const none = create('option', '', '独立计划'); none.value = ''; parent.append(none);
        for (const row of plans) if (row.id !== previous?.id && row.domain === domain.value && catalog.parentKinds[kind.value].includes(row.kind)) { const option = create('option', '', row.title); option.value = row.id; parent.append(option); }
        parent.value = [...parent.options].some(row => row.value === selectedParent) ? selectedParent : '';
        const selectedStatus = status.value; status.replaceChildren(); for (const key of kind.value === 'job' ? catalog.jobStatuses : catalog.planStatuses) { const option = create('option', '', catalog.statuses[key]); option.value = key; status.append(option); } status.value = [...status.options].some(row => row.value === selectedStatus) ? selectedStatus : 'planned';
        share.disabled = domain.value === 'relationships'; if (share.disabled) share.checked = false;
      }
      domain.addEventListener('change', refresh); kind.addEventListener('change', refresh); refresh(); return { domain, kind, title, parent, status, action, date, detail, share };
    }, controls => ({ id: previous?.id, expected_revision: previous?.revision, domain: controls.domain.value, kind: controls.kind.value, title: controls.title.value, parent_id: controls.parent.value || null, status: controls.status.value, next_action: controls.action.value, due_date: controls.date.value, detail: controls.detail.value, cloud_allowed: controls.share.checked }), 'plan_save');
  };

  const remove = (type, record) => {
    const input = type === 'memory' ? { domain: record.domain, key: record.key, kind: record.kind, expected_id: record.id } : type === 'plan' ? { id: record.id, expected_revision: record.revision } : { id: record.id };
    return open('删除此项与历史版本', '删除无法在界面撤销。旧聊天、图表和备份仍需另行处理。', helper => { helper.note('点击核对后会显示本次删除范围。'); return {}; }, () => input, `${type}_delete`);
  };
  const chart = (keys, start, end) => open('导出当前查看的趋势', '指标和日期沿用当前页面，不必再选一遍。不发送给模型。', helper => { helper.note(`${keys.map(key => metricName(data().catalog, key)).join('、')} · ${start || '全部历史'} 至 ${end || '最新记录'}`); return {}; }, () => ({ metrics: keys, start_date: start, end_date: end }), 'chart');
  const height = previous => open('保存长期身高', '身高用作本地 BMI 计算，更新保留历史。临时计算身高不会覆盖这份资料。', helper => {
    const value = helper.field('身高（cm）', 'height_cm', previous?.value || '', 'number', { required: true, min: 50, max: 250, step: '0.1' });
    const share = helper.share(Boolean(previous?.cloud_allowed)); return { value, share };
  }, controls => ({ domain: 'fitness', key: '身高', kind: 'fact', value: controls.value.value, unit: 'cm', effective_date: data().today, cloud_allowed: controls.share.checked, expected_id: previous?.id ?? null }), 'memory_save');
  const workout = input => open('加入今日行动', '这份计划仅保存为待开始行动，不把计划分钟数记为实际训练。', helper => { helper.note('核对动作、时长与身体状态；若状态变化，请取消并重新生成。'); return {}; }, () => input, 'workout_save');
  const training = input => open('保存分部位训练计划', '确认动作要领、组数和时间；只保存待执行的计划，不会虚构实际运动。', helper => { helper.note('计划和后续逐组训练记录都默认仅本地。训练感到疼痛或急性不适时请先停止并就医。'); return {}; }, () => input, 'training_save');
  const trainingSplit = (value, previous, labels) => open('记住常用训练分化', '分化只是安排训练部位的模板，不代表每周必须训练三天或五天。保存后下次打开自动带出，可随时改。', helper => {
    const split = helper.select('我的训练分化', 'split', labels, value);
    const share = helper.share(Boolean(previous?.cloud_allowed));
    helper.note('默认仅保存在本地；希望助手跨会话记住分化时，可单独勾选云端共享。每天仍可修改训练部位。'); return { split, share };
  }, controls => ({ domain: 'fitness', key: '训练分化', kind: 'preference', value: labels[controls.split.value], unit: '', effective_date: data().today, cloud_allowed: controls.share.checked, expected_id: previous?.id ?? null }), 'memory_save');
  const trainingLog = (previous, options = {}, initialExercises = []) => {
    const independent = !previous || previous.actual?.independent || previous.plan.mode === 'recorded';
    return open(previous?.actual ? '更正训练与反馈' : '记录实际训练', '按真实完成情况记录。先选动作，再用 kg × 次数/秒数 × 组数快速填写；不同组可展开单独修改。', helper => {
      const date = previous ? null : helper.field('训练日期', 'date', data().today, 'date', { required: true, max: data().today });
      const source = previous ? null : helper.field('记录来源', 'source', '手动录入', 'text', { required: true, maxLength: 160 });
      const status = helper.select('完成状态', 'status', independent ? { completed: '实际已发生（不表示完成参考计划）', ...(previous ? { skipped: '更正为未训练' } : {}) } : { completed: '已完成', partial: '部分完成', skipped: '跳过/未训练' }, previous?.actual?.status || 'completed');
      const duration = helper.field('实际训练分钟（不自动累加到每日指标）', 'duration_minutes', previous?.actual?.duration_minutes ?? '', 'number', { required: true, min: 0, max: 240, step: 1 });
      const exercises = createTrainingExerciseEditor({ helper, previous, independent, options, initialExercises, onPlanExerciseRemoved: () => { if (status.value === 'completed') status.value = 'partial'; } });
      if (!independent) helper.note('选用备选或移除计划动作时，完成状态会改为“部分完成”；只保存实际填写的动作与组数，不改写参考计划。');
      const energy = helper.select('本次主观强度', 'energy', { unknown: '未记录', easy: '轻松', normal: '适中', hard: '吃力' }, previous?.actual?.energy || 'unknown');
      const discomfort = helper.select('不适程度', 'discomfort', { unknown: '未记录', none: '无不适', mild: '轻微不适', pain: '疼痛/需停止' }, previous?.actual?.discomfort || 'unknown');
      const note = helper.field('体感、动作和恢复反馈（选填）', 'notes', previous?.actual?.notes || '', 'textarea', { maxLength: 500 });
      const share = helper.share(Boolean(previous?.cloud_allowed));
      helper.note('默认仅本地；只有勾选并确认后，后续对话才能读取。单只哑铃与总重量请用负重口径区分；组数不是推荐训练量。');
      return { date, source, status, duration, energy, discomfort, note, share, exercises };
    }, controls => ({ id: previous?.id, expected_revision: previous?.revision, date: controls.date?.value, source: controls.source?.value, independent, status: controls.status.value, duration_minutes: Number(controls.duration.value), energy: controls.energy.value, discomfort: controls.discomfort.value, notes: controls.note.value, cloud_allowed: controls.share.checked, entries: controls.exercises.collect({ allowEmpty: controls.status.value === 'skipped' }) }), previous ? 'training_log' : 'training_record');
  };
  const exerciseLibrary = (options = {}) => {
    if (active) return;
    return showExerciseLibrary({ library: options.exerciseLibrary?.records || [], selectionLabel: '开始记录', onSelect: selected => trainingLog(undefined, options, selected), onCustom: () => trainingLog(undefined, options) });
  };
  const trainingImport = () => open('导入实际训练记录', '支持本页标准JSON格式，不是任意运动App导出格式；文件只在本地解析，不调用模型。核对后才整批保存，同日已有实际记录时整批拒绝。', helper => {
    const sample = JSON.stringify({ format: 'pi-training-v1', records: [{ date: data().today, source: '我的训练笔记', duration_minutes: 45, entries: [{ name: '坐姿绳索划船', primary_focuses: ['back'], secondary_focuses: ['arms'], load_basis: 'machine', tracking_unit: 'reps', set_groups: [{ load_kg: 40, reps: 10, count: 4 }] }], notes: '' }] }, null, 2);
    const file = helper.field('选择JSON文件（或在下方粘贴）', 'training_file', '', 'file', { accept: '.json,application/json' });
    const content = helper.field('粘贴JSON记录（选文件时请留空）', 'training_json', '', 'textarea', { maxLength: 60000, placeholder: sample });
    const example = create('details', 'full-width'); example.append(create('summary', '', '查看标准格式示例'), create('pre', 'local-preview', sample)); helper.fields.append(example);
    helper.note('日期YYYY-MM-DD；部位：full_body全身 / chest胸 / back背 / legs腿臀 / shoulders肩 / arms手臂 / core核心。primary_focuses为主练，secondary_focuses为协同；旧版focus仍兼容。set_groups用count表示相同组数；也可用逐组sets，两者不可同时填写。计时用tracking_unit: seconds和seconds值。');
    helper.note('UTF-8文件不超过60KB，每批1—50天；每次最多30个动作，每动作1—50组，每批最多5000组。load_basis可填total总重/per_hand单只/machine器械/added额外/bodyweight徒手/unknown未知。不填写的体感、不适、负重、RIR保持未知；恢复反馈另填。示例不代表你做过。');
    const share = helper.share(false); return { file, content, share };
  }, async controls => {
    const file = controls.file.files[0];
    if (file && controls.content.value.trim()) throw new Error('文件和粘贴内容只能选择一种，避免导入错来源。');
    if (file && (!/\.json$/i.test(file.name) || file.size > 60000)) throw new Error('请选择不超过60KB的JSON文件。');
    return { content: file ? await file.text() : controls.content.value, cloud_allowed: controls.share.checked };
  }, 'training_import');
  const trainingRecovery = (previous, options) => open(previous.actual?.recovery ? '更正训练后恢复反馈' : '记录训练后的恢复情况', '仅在训练后的第二天或更晚填写。分别记录疲劳与每个实际练到的部位的酸痛，不把预想当作事实。', helper => {
    const fatigue = helper.select('训练后疲劳感', 'fatigue', { '': '请选择真实疲劳程度', ...options.recoveryFatigue }, previous.actual?.recovery?.fatigue || '');
    const soreness = {};
    const performed = [...new Set((previous.actual?.entries || []).flatMap(entry => entryFocuses(entry, previous.plan.exercises.find(item => item.id === entry.exercise_id))))];
    const targets = performed.length ? performed : previous.plan.mode === 'recovery' || previous.actual?.entries?.length ? ['full_body'] : previous.plan.focuses ?? [previous.focus];
    for (const focus of targets) soreness[focus] = helper.select(`${options.focus[focus]}酸痛程度`, `soreness_${focus}`, { '': '请选择真实酸痛程度', ...options.recoverySoreness }, previous.actual?.recovery?.soreness?.[focus] || '');
    const notes = helper.field('其他恢复情况（选填）', 'notes', previous.actual?.recovery?.notes || '', 'textarea', { maxLength: 300 });
    const share = helper.share(false);
    helper.note('默认仅本地；如果这次训练原已授权云端，不勾选将撤回它的后续读取权限。勾选并确认会同时授权实际组数和恢复反馈。');
    return { fatigue, soreness, notes, share };
  }, controls => ({ id: previous.id, expected_revision: previous.revision, fatigue: controls.fatigue.value, soreness: Object.fromEntries(Object.entries(controls.soreness).map(([focus, input]) => [focus, input.value])), notes: controls.notes.value, cloud_allowed: controls.share.checked }), 'training_recovery');
  const trainingDelete = row => open('删除训练及历史', '删除后无法在界面撤销；旧聊天、备份和已经共享的内容不会自动清除。', helper => { helper.note(`${row.date} · ${row.plan.focus_label}`); return {}; }, () => ({ id: row.id, expected_revision: row.revision }), 'training_delete');
  return { metrics, memory, plan, remove, chart, height, workout, training, trainingSplit, trainingLog, exerciseLibrary, trainingImport, trainingRecovery, trainingDelete, isOpen: () => active };
}
