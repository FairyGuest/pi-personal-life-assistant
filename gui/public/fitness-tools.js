import { entryFocuses, setsSummary, LOAD_BASES } from './training-model.js';

const node = (tag, className, text) => { const result = document.createElement(tag); if (className) result.className = className; if (text !== undefined) result.textContent = text; return result; };
const action = (title, callback, className = 'secondary') => { const result = node('button', className, title); result.type = 'button'; result.addEventListener('click', callback); return result; };
const trainingStatus = { planned: '待训练', completed: '已完成', partial: '部分完成', skipped: '未训练' };
const trainingEnergy = { unknown: '未记录', easy: '轻松', normal: '适中', hard: '吃力' };
const trainingDiscomfort = { unknown: '未记录', none: '无', mild: '轻微', pain: '疼痛' };
function field(form, label, name, value, options) {
  const wrap = node('label', 'form-field'); const input = node(options.dictionary ? 'select' : 'input'); input.name = name;
  if (options.dictionary) for (const [key, title] of Object.entries(options.dictionary)) { const option = node('option', '', title); option.value = key; input.append(option); }
  else { input.type = 'number'; Object.assign(input, options); }
  input.value = value ?? ''; wrap.append(node('span', '', label), input); form.append(wrap); return input;
}

export function createFitnessTools({ info, api, localForms, draft = {}, beginChat }) {
  const grid = node('div', 'fitness-tools-grid');
  const bmiCard = node('section', 'card fitness-tool'); bmiCard.append(node('h2', '', 'BMI · 本地计算'), node('p', 'form-description', '自动参考长期身高与最近真实体重；手动计算不保存、不调用模型。'));
  const bmiResult = node('div', 'fitness-result'); bmiResult.setAttribute('aria-live', 'polite');
  function showBmi(result) {
    bmiResult.replaceChildren();
    if (result.status === 'missing') bmiResult.append(node('strong', '', `还需要：${result.missing.join('、')}`));
    else bmiResult.append(node('strong', 'bmi-number', `BMI ${result.bmi.toFixed(1)}`), node('span', 'fitness-category', result.category), node('p', 'form-description', result.standard_label), node('p', 'form-description', `${result.height_source}\n${result.weight_source}`));
    for (const warning of result.warnings || []) bmiResult.append(node('p', 'form-warning', warning));
    bmiResult.append(node('p', 'form-description', result.notice));
  }
  showBmi(draft.bmiResult || info.bmi);
  const bmiForm = node('form', 'local-form-fields');
  const height = field(bmiForm, '计算用身高（cm）', 'bmi_height_cm', draft.bmiInput?.height_cm ?? info.bmi.height_cm, { min: 50, max: 250, step: '0.1', required: true });
  const weight = field(bmiForm, '计算用体重（kg）', 'bmi_weight_kg', draft.bmiInput?.weight_kg ?? info.bmi.weight_kg, { min: 15, max: 500, step: '0.1', required: true });
  const standard = field(bmiForm, '成人参考标准', 'bmi_standard', draft.bmiInput?.standard || 'china', { dictionary: { china: '中国成人标准', who: 'WHO成人标准' } });
  const calculate = node('button', 'primary', '计算 BMI（不保存）'); calculate.type = 'submit'; bmiForm.append(calculate);
  const bmiError = node('p', 'form-error'); bmiError.setAttribute('role', 'alert');
  bmiForm.addEventListener('input', () => { draft.bmiInput = { height_cm: height.value, weight_kg: weight.value, standard: standard.value }; });
  bmiForm.addEventListener('submit', async event => { event.preventDefault(); calculate.disabled = true; bmiError.textContent = ''; try { draft.bmiResult = await api('/api/fitness/bmi', { height_cm: Number(height.value), weight_kg: Number(weight.value), standard: standard.value }); showBmi(draft.bmiResult); } catch (error) { bmiError.textContent = error.message; } finally { calculate.disabled = false; } });
  const bmiActions = node('div', 'row-actions'); bmiActions.append(action(info.height ? '修改长期身高' : '保存长期身高', () => localForms.height(info.height)), action('记录真实体重', () => localForms.metrics(undefined, 'weight_kg')));
  bmiCard.append(bmiResult, bmiForm, bmiError, bmiActions);
  const workoutCard = node('section', 'card fitness-tool'); workoutCard.append(node('h2', '', '规划今日训练'), node('p', 'form-description', '先选三分化、五分化或自主组合，再选今天要练的多个部位；分化不是每周固定训练天数。'));
  const workoutForm = node('form', 'local-form-fields'); const options = info.options;
  const preferredSplit = Object.entries(options.splits).find(([, title]) => title === info.splitPreference?.value)?.[0] || '';
  const controls = {
    split: field(workoutForm, '我的训练分化（先选择）', 'workout_split', draft.workoutInput?.split ?? preferredSplit, { dictionary: { '': '请选择三分化、五分化或自选', ...options.splits } }),
    day: field(workoutForm, '今天的分化训练日', 'workout_day', draft.workoutInput?.day || '', { dictionary: { '': '先选择训练分化' } }),
    goal: field(workoutForm, '今天的目标', 'workout_goal', draft.workoutInput?.goal || 'general', { dictionary: options.goals }),
    minutes: field(workoutForm, '可用时间（分钟）', 'workout_minutes', draft.workoutInput?.minutes ?? 30, { min: 10, max: 90, step: 1, required: true }),
    experience: field(workoutForm, '训练经验', 'workout_experience', draft.workoutInput?.experience || 'beginner', { dictionary: options.experience }),
    equipment: field(workoutForm, '可用器材', 'workout_equipment', draft.workoutInput?.equipment || 'none', { dictionary: options.equipment }),
    readiness: field(workoutForm, '今天身体状态', 'workout_readiness', draft.workoutInput?.readiness || 'unknown', { dictionary: options.readiness }),
    yesterday: field(workoutForm, '昨天的训练', 'workout_yesterday', draft.workoutInput?.yesterday || 'unknown', { dictionary: options.yesterday }),
  };
  const muscles = node('fieldset', 'muscle-selector full-width'); muscles.append(node('legend', '', '今天实际要练的部位（可以多选）'));
  const checks = Object.entries(options.focus).map(([key, title]) => { const label = node('label', 'muscle-choice'); const input = node('input'); input.type = 'checkbox'; input.name = `workout_focus_${key}`; input.value = key; label.append(input, node('span', '', title)); muscles.append(label); return { key, input }; });
  workoutForm.append(muscles);
  const dayField = controls.day.closest('label');
  function updateDays(value) {
    const days = options.days[controls.split.value] || {};
    controls.day.replaceChildren();
    for (const [key, title] of Object.entries({ '': '请选择本次训练日', ...Object.fromEntries(Object.entries(days).map(([key, item]) => [key, item.label])) })) { const choice = node('option', '', title); choice.value = key; controls.day.append(choice); }
    controls.day.value = value && days[value] ? value : '';
    dayField.style.display = controls.split.value === 'custom' || !controls.split.value ? 'none' : '';
  }
  updateDays(draft.workoutInput?.day);
  for (const { key, input } of checks) input.checked = Boolean(draft.workoutInput?.focuses?.includes(key));
  controls.split.addEventListener('change', () => { updateDays(''); for (const item of checks) item.input.checked = false; draft.workoutInput = collectWorkout(); });
  controls.day.addEventListener('change', () => { const suggested = options.days[controls.split.value]?.[controls.day.value]?.focuses || []; for (const item of checks) item.input.checked = suggested.includes(item.key); draft.workoutInput = collectWorkout(); });
  muscles.addEventListener('change', event => { if (event.target.value === 'full_body' && event.target.checked) { for (const item of checks) if (item.key !== 'full_body') item.input.checked = false; } else if (event.target.checked) checks.find(item => item.key === 'full_body').input.checked = false; draft.workoutInput = collectWorkout(); });
  const splitActions = node('div', 'row-actions full-width'); const rememberSplit = action('记住常用分化', () => localForms.trainingSplit(controls.split.value, info.splitPreference, options.splits)); rememberSplit.disabled = !controls.split.value; controls.split.addEventListener('change', () => { rememberSplit.disabled = !controls.split.value; }); splitActions.append(rememberSplit); workoutForm.append(splitActions);
  const generate = node('button', 'primary full-width', '生成今日训练（不保存）'); generate.type = 'submit'; workoutForm.append(generate);
  const workoutResult = node('div', 'fitness-result'); workoutResult.setAttribute('aria-live', 'polite'); const workoutError = node('p', 'form-error'); workoutError.setAttribute('role', 'alert');
  let workoutRevision = 0;
  const collectWorkout = () => ({ ...Object.fromEntries(Object.entries(controls).map(([key, control]) => [key, key === 'minutes' ? Number(control.value) : control.value])), focuses: checks.filter(item => item.input.checked).map(item => item.key) });
  function showWorkout(result, input) {
    workoutResult.replaceChildren();
    workoutResult.append(node('h3', '', result.title), node('p', 'form-description', `${result.date} · ${options.splits[result.split]}${result.day ? ` · ${options.days[result.split][result.day].label}` : ''} · ${result.total_minutes}分钟${result.intensity ? ` · ${result.intensity}` : ''}`));
    for (const warning of result.warnings) workoutResult.append(node('p', 'form-warning', warning));
    for (const block of result.blocks) { const row = node('div', 'workout-block'); row.append(node('strong', '', `${block.title} · ${block.minutes}分钟`), node('p', '', block.instructions)); workoutResult.append(row); }
    for (const item of result.exercises) { const row = node('div', 'workout-block'); row.append(node('strong', '', `${options.focus[item.focus]} · ${item.name} · ${item.sets}组 × ${item.reps} · 休息${item.rest_seconds}秒`), node('p', '', `动作要领：${item.cues}`), node('p', '', `避免：${item.avoid} · ${item.rir}`)); workoutResult.append(row); }
    for (const adaptation of result.adaptations || []) workoutResult.append(node('p', 'form-description', `上次${adaptation.previous}。${adaptation.suggestion}`));
    workoutResult.append(node('p', 'form-description', result.notice));
    if (result.can_save && info.training.some(row => row.date === result.date)) workoutResult.append(node('p', 'form-warning', '今日已经有训练计划，请到下方记录实际运动；胸肩等组合应放进同一份计划。'));
    else if (result.can_save) workoutResult.append(action('核对并保存训练计划', () => localForms.training(input), 'primary'));
  }
  if (draft.workoutResult && draft.workoutResult.date === info.today) showWorkout(draft.workoutResult, draft.workoutInput);
  workoutForm.addEventListener('input', () => { workoutRevision++; draft.workoutInput = collectWorkout(); draft.workoutResult = null; workoutResult.replaceChildren(node('p', 'form-description', '条件已修改，请重新生成后再保存。')); });
  workoutForm.addEventListener('submit', async event => {
    event.preventDefault(); generate.disabled = true; workoutError.textContent = ''; workoutResult.replaceChildren();
    const revision = ++workoutRevision;
    const input = collectWorkout(); draft.workoutInput = input;
    try {
      const result = await api('/api/fitness/workout', input);
      if (revision !== workoutRevision) return;
      draft.workoutResult = result; showWorkout(result, input);
    } catch (error) { workoutError.textContent = error.message; }
    finally { generate.disabled = false; }
  });
  const recordCard = node('section', 'card training-history');
  recordCard.append(node('h2', '', '记录真实训练'), node('p', 'form-description', '计划只是参考。没用系统计划也能补录日期、任意动作、逐组次数或秒数与负重；默认仅本地，不自动发送给AI。'));
  const recordActions = node('div', 'row-actions'); recordActions.append(action('＋ 直接记录训练', () => localForms.trainingLog(undefined, options), 'primary'), action('动作库', () => localForms.exerciseLibrary(options)), action('导入训练记录（JSON）', () => localForms.trainingImport())); recordCard.append(recordActions);
  recordCard.append(node('p', 'form-description', '不知道动作名称？打开动作库看图、搜索或按肌群/器材筛选；记录中也可以随时添加动作或选择备选。'));
  workoutCard.append(workoutForm, workoutError, workoutResult); grid.append(recordCard, bmiCard, workoutCard);
  const history = node('section', 'card training-history'); history.append(node('h2', '', '训练记录与反馈'), node('p', 'form-description', '只显示真实保存的训练；组数、负重、体感和不适都能更正并保留历史。默认仅本地，授权后AI才可跨会话读取。'));
  if (!info.training.length) history.append(node('p', 'muted', '还没有训练记录。可以直接录入或导入真正做过的训练，也可以先生成参考计划。'));
  function askShare(message) {
    return new Promise(resolve => {
      const dialog = node('dialog', 'local-form-dialog'); dialog.setAttribute('aria-label', '核对发给AI的训练信息'); const content = node('div');
      content.append(node('h2', '', '核对发给AI的训练信息'), node('p', 'form-description', '点击确认只会放入聊天草稿，不会自动发送。你还需要亲自点击发送；以后自动查询此记录则需要在记录里单独勾选云端共享。'), node('pre', 'local-preview', message));
      const controls = node('div', 'dialog-actions');
      const close = allowed => { dialog.close(); dialog.remove(); resolve(allowed); };
      const existingDraft = document.querySelector('#message-input')?.value || '';
      if (existingDraft.trim() && existingDraft !== message) {
        content.append(node('p', 'form-warning', '当前对话已有未发送草稿。请先发送或清空原草稿，再分享这次训练；不会覆盖你写的内容。'));
        controls.append(action('取消', () => close(false)), action('查看原草稿', () => { close(false); beginChat(existingDraft); }, 'primary'));
      } else controls.append(action('取消', () => close(false)), action('放进聊天草稿', () => close(true), 'primary'));
      content.append(controls); dialog.append(content); document.body.append(dialog);
      dialog.addEventListener('cancel', event => { event.preventDefault(); close(false); }); dialog.showModal();
    });
  }
  for (const session of info.training) {
    const item = node('article', 'training-entry');
    const actualLabel = session.actual ? [...new Set(session.actual.entries.flatMap(entry => entryFocuses(entry, session.plan.exercises.find(item => item.id === entry.exercise_id))).map(focus => options.focus[focus]).filter(Boolean))].join('＋') || session.plan.focus_label : session.plan.focus_label;
    item.append(node('h3', '', `${session.date} · ${actualLabel} · ${trainingStatus[session.status]}`), node('p', 'form-description', `${session.plan.mode === 'recorded' ? '自主实际记录 · 无系统计划' : `参考计划${session.plan.total_minutes}分钟 · ${session.plan.exercises.map(exercise => exercise.name).join('、') || '轻活动'}`} · ${session.cloud_allowed ? '允许后续对话读取' : '仅本地'}`));
    if (session.actual?.independent) item.append(node('p', 'form-description', `来源：${session.actual.source || '自主录入'} · 实际动作独立记录，不表示完成了参考计划。`));
    if (session.actual) {
      item.append(node('p', 'form-description', `实际${session.actual.duration_minutes}分钟 · ${session.actual.entries.reduce((sum, entry) => sum + entry.sets.length, 0)}组 · 体感${trainingEnergy[session.actual.energy]} · 不适${trainingDiscomfort[session.actual.discomfort]}`));
      if (session.actual.recovery) item.append(node('p', 'form-description', `恢复反馈（${session.actual.recovery.recorded_date}）：${options.recoveryFatigue[session.actual.recovery.fatigue]}；${Object.entries(session.actual.recovery.soreness).map(([focus, degree]) => `${options.focus[focus]}${options.recoverySoreness[degree]}`).join('、')}${session.actual.recovery.notes ? `；${session.actual.recovery.notes}` : ''}`));
      else if (session.date < info.today && ['completed', 'partial'].includes(session.status)) item.append(node('p', 'form-warning', '这次训练还缺训练后的恢复反馈：请回顾疲劳与每个部位的酸痛，帮助下次调整组数。'));
      if (session.actual.notes) item.append(node('p', 'form-description', `反馈：${session.actual.notes}`));
      if (session.actual.entries.length) { const details = node('details', 'training-sets'); details.append(node('summary', '', '查看动作与组数')); for (const entry of session.actual.entries) details.append(node('p', '', `${entry.name}：${setsSummary(entry.sets)} · ${LOAD_BASES[entry.load_basis || 'unknown']} · 主练：${(entry.primary_focuses || (entry.focus ? [entry.focus] : [])).map(focus => options.focus[focus]).join('＋') || '未标注'} · 协同：${(entry.secondary_focuses || []).map(focus => options.focus[focus]).join('＋') || '未标注'}`)); item.append(details); }
    }
    const actions = node('div', 'row-actions');
    actions.append(action(session.actual ? '更正实际训练' : '记录实际训练', () => localForms.trainingLog(session, options)));
    if (session.actual && ['completed', 'partial'].includes(session.status) && session.date < info.today) actions.append(action(session.actual.recovery ? '更正恢复反馈' : '填写训练后恢复反馈', () => localForms.trainingRecovery(session, options)));
    if (session.actual) actions.append(action('给AI反馈', async () => {
      const body = [`训练日期：${session.date}；${session.actual.independent ? `自主实际记录，不代表完成参考计划；来源：${session.actual.source || '未注明'}` : `分化：${options.splits[session.plan.split] || '未记录'}`}；部位：${actualLabel}；状态：${trainingStatus[session.actual.status]}；实际${session.actual.duration_minutes}分钟；体感：${trainingEnergy[session.actual.energy]}；不适：${trainingDiscomfort[session.actual.discomfort]}`, ...session.actual.entries.map(entry => `${entry.name}：${setsSummary(entry.sets)}；${LOAD_BASES[entry.load_basis || 'unknown']}；参与部位：${entryFocuses(entry).map(focus => options.focus[focus]).join('＋')}`), session.actual.notes ? `反馈：${session.actual.notes}` : '', session.actual.recovery ? `训练后恢复：${options.recoveryFatigue[session.actual.recovery.fatigue]}；${Object.entries(session.actual.recovery.soreness).map(([focus, degree]) => `${options.focus[focus]}${options.recoverySoreness[degree]}`).join('、')}；${session.actual.recovery.notes}` : '尚未填写训练后恢复反馈，不据此假设已恢复。'].filter(Boolean).join('\n');
      const message = `这是我实际做过的训练，请综合各部位组数与训练后疲劳、酸痛，在安全前提下分析下一次多部位计划。不要猜测未记录的动作、疾病或负重。\n${body}`;
      if (await askShare(message)) beginChat(message);
    }));
    actions.append(action('历史', async () => { const versions = await api(`/api/training-history?id=${encodeURIComponent(session.id)}`); const dialog = node('dialog', 'local-form-dialog'); dialog.append(node('h2', '', '训练修改历史'), node('pre', 'local-preview', versions.map(version => `第${version.revision}版 · ${trainingStatus[version.status]} · ${version.recorded_at}\n${version.actual ? `${version.actual.duration_minutes}分钟；${version.actual.entries.map(entry => `${entry.name} ${entry.sets.length}组`).join('、')}；${version.actual.notes}\n${version.actual.recovery ? `恢复：${options.recoveryFatigue[version.actual.recovery.fatigue]}，${Object.entries(version.actual.recovery.soreness).map(([focus, degree]) => `${options.focus[focus]}${options.recoverySoreness[degree]}`).join('、')}` : '未记恢复反馈'}` : '计划已保存，未记录实际训练'}`).join('\n\n')), action('关闭', () => { dialog.close(); dialog.remove(); })); dialog.addEventListener('cancel', event => { event.preventDefault(); dialog.close(); dialog.remove(); }); document.body.append(dialog); dialog.showModal(); }));
    actions.append(action('删除', () => localForms.trainingDelete(session)));
    item.append(actions); history.append(item);
  }
  grid.append(history); return grid;
}
