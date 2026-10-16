import { randomUUID } from 'node:crypto';
import { validateMemory, validateMetric, validatePlan } from './store.mjs';
import { metricLabel, DOMAIN_LABELS, KIND_LABELS, PLAN_KIND_LABELS, STATUS_LABELS } from './catalog.mjs';
import { chartPayload, renderMetricChart } from './charts.mjs';
import { planWorkout, workoutPlanRecord } from './fitness.mjs';
import { planTraining, retainedTrainingRecovery, validateTrainingLog, validateTrainingRecovery, trainingFeedbackText, trainingToday, RECOVERY_FATIGUE, RECOVERY_SORENESS, FOCUS_LABELS } from './training.mjs';
import { parseTrainingImport, validateTrainingRecords } from './training-import.mjs';

const deletionWarning = '删除数据库中的此项及其历史；旧聊天、图表、导出、备份不会随之删除。';
const privacy = item => item.cloud_allowed ? '允许在相关新对话中发送给个人DeepSeek' : '仅本地保存，不自动发送给模型';

export class LocalActions {
  constructor(store, { renderChart = renderMetricChart, clock = Date.now, trainingDate = trainingToday } = {}) {
    this.store = store;
    this.renderChart = renderChart;
    this.clock = clock;
    this.trainingDate = trainingDate;
    this.pending = new Map();
  }

  prepare(action, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('请填写操作表单。');
    this.prune();
    if (this.pending.size >= 100) throw new Error('待确认操作过多，请完成或取消后重试。');
    const store = this.store;
    let summary; let execute;
    const warnings = [];
    if (action === 'metric_save') {
      if (!Array.isArray(input.records) || !input.records.length || input.records.length > 7) throw new Error('一次填写1—7种指标。');
      const items = input.records.map(row => ({ ...validateMetric(row), correction_of: row.correction_of ?? null }));
      if (new Set(items.map(row => row.metric)).size !== items.length) throw new Error('一次记录中每种指标只填写一个值。');
      for (const item of items) {
        if (item.correction_of) {
          const previous = store.metric(item.correction_of);
          if (!previous?.is_current || previous.metric !== item.metric) throw new Error('更正对象已改变，请重新打开该记录。');
        }
      }
      const duplicates = store.metricDuplicates(items.filter(row => !row.correction_of));
      if (duplicates.length) warnings.push('存在同日、同值、同时间及同口径的记录。若是误点，请取消；若确实又测量了一次，可确认追加。');
      summary = items.map(item => `${metricLabel(item.metric)}：${item.value}\n${item.measured_date} ${item.measured_time || '未记录时间'} · ${item.method || '未注明口径'}${item.note ? `\n备注：${item.note}` : ''}\n${item.correction_of ? '更正原记录，保留历史' : '追加测量，不覆盖历史'} · ${privacy(item)}`).join('\n\n');
      const signature = () => store.metricDuplicates(items.filter(row => !row.correction_of)).map(row => row.id).sort().join(',');
      const observed = signature();
      execute = () => {
        if (signature() !== observed) throw new Error('确认期间出现新的重复记录，请重新核对。');
        const records = store.addMetrics(items, 'local-ui');
        return { message: items.some(row => row.correction_of) ? '已更正，原值保留在修改历史中。' : `已保存${records.length}项指标。`, records };
      };
    } else if (action === 'memory_save') {
      const item = validateMemory({ ...input, source: '本地表单确认' });
      const previous = store.currentMemory(item.domain, item.key, item.kind);
      if (input.expected_id !== undefined && (previous?.id ?? null) !== input.expected_id) throw new Error('资料已改变，请重新打开编辑。');
      summary = `${DOMAIN_LABELS[item.domain]} · ${KIND_LABELS[item.kind]}\n${item.key}\n原值：${previous?.value ?? '未记录'}\n新值：${item.value} ${item.unit}\n生效日期：${item.effective_date}\n${privacy(item)}\n变更保留历史。`;
      execute = () => ({ message: '资料已保存。', record: store.remember(item, 'local-ui', previous?.id ?? null) });
    } else if (action === 'training_save') {
      const plan = planTraining(input, { history: store.listTraining({ limit: 100 }) });
      if (!plan.can_save) throw new Error('当前状态不适合安排训练，请先处理身体不适。');
      if (store.database.prepare('SELECT id FROM training_sessions WHERE date=?').get(plan.date)) throw new Error('今日已有计划；需要组合胸、肩等部位，请在一份计划中勾选。');
      summary = `${plan.date} · ${plan.title}\n热身、力量或轻活动、放松共${plan.total_minutes}分钟\n${plan.exercises.map(item => `${item.name}：${item.sets}组×${item.reps} · 每组间休息${item.rest_seconds}秒 · ${item.rir}\n动作：${item.cues}\n避免：${item.avoid}`).join('\n') || '本次以轻松活动为主，无负重动作。'}\n${plan.warnings.join('\n')}\n仅本地保存为待执行训练；不会自动记录组数、时长或发送给AI。`;
      warnings.push(...plan.warnings);
      execute = () => {
        if (plan.date !== trainingToday()) throw new Error('已经跨日，请重新生成今日训练。');
        return { message: '专业训练计划已保存；完成后记录实际组数和体感。', record: store.saveTraining(plan, 'local-ui') };
      };
    } else if (action === 'training_record' || action === 'training_import') {
      const source = action === 'training_import' ? 'JSON文件/文本导入' : '手动录入';
      const cloudAllowed = input.cloud_allowed === true;
      const records = action === 'training_import' ? parseTrainingImport(input.content) : [input];
      const items = validateTrainingRecords(records, { cloudAllowed, source });
      const expected = items.map(item => {
        const previous = store.trainingOnDate(item.date);
        if (previous?.actual) throw new Error(`${item.date}已有实际训练，可能重复导入；请使用“更正实际训练”，不会覆盖或重复累计。`);
        return { id: previous?.id ?? null, revision: previous?.revision ?? null };
      });
      summary = items.map((item, index) => `${trainingFeedbackText(item)}\n${expected[index].id ? '当天参考计划保留不变，仅记录你真正做过的训练；不代表完成了原计划。' : '独立实际记录，不生成系统计划。'}\n${privacy(item.actual)}`).join('\n\n');
      warnings.push('按天保存；同一天已有实际记录时拒绝整批导入，不覆盖、不重复累计；不会自动改写每日运动分钟。');
      if (cloudAllowed) warnings.push('你已勾选共享：确认后，本批逐组记录和来源允许后续相关对话发给个人DeepSeek。文件中的共享标记不作为授权。');
      if (items.some(item => item.actual.discomfort === 'pain')) warnings.push('记录中包含疼痛反馈；不要照旧进阶，请停止不适动作并咨询专业人士。');
      const normalized = items.map(item => ({ date: item.date, ...item.actual }));
      execute = () => ({ message: `已保存${items.length}天的真实训练记录；未改写计划内容或每日累计指标。`, records: store.saveTrainingRecords(normalized, { cloudAllowed, source, expected }, 'local-ui') });
    } else if (action === 'training_log') {
      const previous = store.training(input.id);
      if (!previous || previous.revision !== input.expected_revision) throw new Error('训练记录已改变，请重新打开。');
      const actual = validateTrainingLog({ ...input, ...(previous.actual?.independent ? { independent: true } : {}), ...(previous.actual?.source ? { source: previous.actual.source } : {}) }, previous.plan);
      const recovery = retainedTrainingRecovery(previous.plan, previous.actual, actual);
      if (recovery) actual.recovery = recovery;
      summary = `${trainingFeedbackText({ ...previous, actual })}\n${privacy(actual)}\n保留修改历史；不会自动改写当天累计训练分钟。`;
      if (previous.actual?.recovery && !recovery && actual.status !== 'skipped') warnings.push('实际训练部位已更正；原恢复反馈不再适用，保存后请重新填写疲劳和酸痛。');
      if (actual.discomfort === 'pain') warnings.push('反馈疼痛后不要照旧进阶；建议停下并咨询专业人士。');
      if (actual.cloud_allowed) warnings.push('确认后，本次实际组数、负重与反馈将允许后续相关对话通过专用工具读取；以前聊天的发送范围无法撤回。');
      execute = () => ({ message: '实际训练和反馈已保存；需要的话再记录当天累计运动时长。', record: store.saveTrainingLog(previous.id, actual, previous.revision, 'local-ui') });
    } else if (action === 'training_recovery') {
      const previous = store.training(input.id);
      if (!previous || previous.revision !== input.expected_revision) throw new Error('训练记录已改变，请重新打开。');
      if (!['completed', 'partial'].includes(previous.status)) throw new Error('请先记录实际完成的训练。');
      const recovery = validateTrainingRecovery(input, previous.plan, previous.date, this.trainingDate(), previous.actual);
      const allowed = input.cloud_allowed === true;
      summary = `${previous.date} · ${previous.plan.focus_label}\n训练后恢复反馈（记录于${recovery.recorded_date}）\n疲劳：${RECOVERY_FATIGUE[recovery.fatigue]}\n${Object.entries(recovery.soreness).map(([focus, degree]) => `${FOCUS_LABELS[focus]}：${RECOVERY_SORENESS[degree]}`).join('\n')}\n${recovery.notes || ''}\n${privacy({ cloud_allowed: allowed })}\n修正会保留版本；不会自动发送给AI。`;
      const nextDay = new Date(Date.parse(`${previous.date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
      if (recovery.recorded_date > nextDay) warnings.push('超过训练次日才回忆填写，请只记录确定的感受；不把它当作当天实时评估。');
      if (allowed) warnings.push('同意共享后，这次训练的组数和恢复反馈都可能在未来对话中发给个人DeepSeek；取消勾选会撤回后续自动查询权限。');
      if (Object.values(recovery.soreness).includes('severe')) warnings.push('严重酸痛或活动受限时暂停相关部位训练；若有异常疼痛，请咨询专业人士。');
      execute = () => {
        if (this.trainingDate() !== recovery.recorded_date) throw new Error('已经跨日，请重新核对反馈的记录日期。');
        return { message: '已保存恢复反馈；下次规划会参考疲劳和各部位酸痛程度。', record: store.saveTrainingRecovery(previous.id, { ...recovery, cloud_allowed: allowed }, previous.revision, 'local-ui', recovery.recorded_date) };
      };
    } else if (action === 'training_delete') {
      const previous = store.training(input.id);
      if (!previous || previous.revision !== input.expected_revision) throw new Error('训练记录已改变，请重新打开。');
      summary = `${previous.date} · ${previous.plan.focus_label}\n删除此训练及全部修订历史。${deletionWarning}`;
      execute = () => ({ message: '已删除这次训练及其历史。', deleted: store.deleteTraining(previous.id, previous.revision, 'local-ui') });
    } else if (action === 'workout_save') {
      const workout = planWorkout(input);
      const item = validatePlan(workoutPlanRecord(workout));
      const existing = () => store.database.prepare('SELECT id FROM plans WHERE domain=? AND kind=? AND due_date=? AND title=?').get(item.domain, item.kind, item.due_date, item.title);
      if (existing()) throw new Error('这份今日训练已加入行动，请在“目标与行动”中编辑，不重复添加。');
      summary = `${item.title}\n共${workout.total_minutes}分钟 · ${workout.intensity}\n${item.detail}\n仅本地保存为待开始行动，不记录实际训练分钟。`;
      warnings.push(...workout.warnings);
      execute = () => {
        if (workout.date !== planWorkout(input).date) throw new Error('已经跨日，请重新生成今日训练。');
        return { message: '训练已加入今日行动；完成后再记录实际时长。', record: store.savePlan(item, 'local-ui', undefined, { uniqueDaily: true }) };
      };
    } else if (action === 'plan_save') {
      const previous = input.id ? store.plan(input.id) : null;
      if (input.id && !previous) throw new Error('计划不存在。');
      if (previous && input.expected_revision !== previous.revision) throw new Error('计划已改变，请重新打开编辑。');
      const item = validatePlan(input);
      store.validatePlanRelations(item, input.id);
      const parent = item.parent_id ? store.plan(item.parent_id) : null;
      summary = `${PLAN_KIND_LABELS[item.kind]} · ${DOMAIN_LABELS[item.domain]}\n${item.title}\n状态：${STATUS_LABELS[item.status]}\n下一步：${item.next_action || '未填写'}\n日期：${item.due_date || '未设置'}\n所属目标：${parent?.title ?? '独立计划'}\n${item.detail || ''}\n${privacy(item)}\n仅记录，不自动执行。`;
      execute = () => ({ message: '计划已保存。', record: store.savePlan({ ...item, id: input.id }, 'local-ui', previous?.revision) });
    } else if (action === 'metric_delete') {
      const item = store.metric(input.id);
      if (!item) throw new Error('此记录已经不存在。');
      const history = store.metricHistory(item.record_id);
      const latest = history[0];
      summary = `${metricLabel(latest.metric)}：${latest.value}\n${latest.measured_date}\n包含${history.length}个历史版本。\n${deletionWarning}`;
      execute = () => {
        if (store.metricHistory(item.record_id)[0]?.id !== latest.id) throw new Error('确认期间记录被更正，请重新核对。');
        return { message: `已删除${store.deleteMetric(input.id, 'local-ui')}个版本。` };
      };
    } else if (action === 'memory_delete') {
      const item = store.currentMemory(input.domain, input.key, input.kind);
      if (!item || item.id !== input.expected_id) throw new Error('资料已改变，请重新核对。');
      summary = `${item.key}：${item.value}\n${deletionWarning}`;
      execute = () => {
        if (store.currentMemory(item.domain, item.key, item.kind)?.id !== item.id) throw new Error('确认期间资料已改变，请重新核对。');
        return { message: `已删除${store.forgetMemory(item.domain, item.key, item.kind, 'local-ui')}个版本。` };
      };
    } else if (action === 'plan_delete') {
      const item = store.plan(input.id);
      if (!item || item.revision !== input.expected_revision) throw new Error('计划已改变，请重新核对。');
      summary = `${item.title}\n${deletionWarning}\n有下级计划时，需先调整关联后才能删除。`;
      execute = () => {
        if (store.plan(item.id)?.revision !== item.revision) throw new Error('确认期间计划已改变，请重新核对。');
        return { message: `已删除${store.deletePlan(item.id, 'local-ui')}项计划及其历史。` };
      };
    } else if (action === 'chart') {
      const payload = chartPayload(store, { metrics: input.metrics, start_date: input.start_date || undefined, end_date: input.end_date || undefined });
      summary = `指标：${payload.panels.map(row => metricLabel(row.metric)).join('、')}\n日期：${input.start_date || '全部历史'} 至 ${input.end_date || '最新记录'}\n基于当前查看范围的实际记录生成PNG、SVG、HTML和CSV，仅保存本地，不发送给模型。`;
      warnings.push('导出是未加密的数据副本，删除记录不会自动删除导出文件。');
      execute = async () => ({ message: '已生成图表，下载链接已更新。', chart: await this.renderChart(store.workspace, payload) });
    } else throw new Error('不支持此本地操作。');
    const id = randomUUID();
    const expiresAt = this.clock() + 300000;
    this.pending.set(id, { execute, expiresAt });
    return { id, expiresAt, summary, warnings, localOnly: true };
  }

  async commit(id) {
    const task = this.pending.get(id);
    if (!task || task.expiresAt <= this.clock()) throw new Error('确认已过期或被取消，请重新填写。');
    if (!task.promise) task.promise = Promise.resolve().then(task.execute);
    return task.promise;
  }

  cancel(id) { const task = this.pending.get(id); if (task && !task.promise) this.pending.delete(id); }
  prune() { for (const [id, task] of this.pending) if (task.expiresAt <= this.clock()) this.pending.delete(id); }
  close() { this.pending.clear(); }
}
