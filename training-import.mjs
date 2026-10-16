import { FOCUS_LABELS, trainingToday, validateTrainingLog } from './training.mjs';
import { entryFocuses } from './gui/public/training-model.js';

export function parseTrainingImport(content) {
  if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content, 'utf8') > 60000) throw new Error('请提供不超过60KB的UTF-8 JSON训练记录。');
  let document;
  try { document = JSON.parse(content.replace(/^\uFEFF/, '')); } catch { throw new Error('JSON格式无效，请按导入示例核对括号、逗号和双引号。'); }
  if (!document || document.format !== 'pi-training-v1' || !Array.isArray(document.records)) throw new Error('需要pi-training-v1格式和records数组；不能把训练计划或整个档案当作实际训练导入。');
  return document.records;
}

export function validateTrainingRecords(records, { cloudAllowed = false, source = '手动录入', date = trainingToday() } = {}) {
  if (!Array.isArray(records) || !records.length || records.length > 50) throw new Error('一次录入1—50天的实际训练记录，同一天请合为一条。');
  const dates = new Set();
  let totalSets = 0;
  return records.map((row, index) => {
    try {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('记录必须是对象。');
      if (typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error('训练日期应为YYYY-MM-DD。');
      const timestamp = Date.parse(`${row.date}T00:00:00Z`);
      if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== row.date || row.date > date) throw new Error('训练日期无效或在未来，实际记录只能填写已发生的训练。');
      if (dates.has(row.date)) throw new Error('同一天出现多条记录，请合并当天动作后重试。');
      dates.add(row.date);
      if (row.status !== undefined && row.status !== 'completed') throw new Error('独立导入只接受已发生的训练，不把计划或跳过记录导入为完成。');
      if (row.recovery !== undefined) throw new Error('恢复反馈请在导入后通过专用表单单独核对填写。');
      if (!Array.isArray(row.entries) || !row.entries.length) throw new Error('请至少填写一个实际动作。');
      const actual = validateTrainingLog({ ...row, entries: row.entries.map(entry => ({ ...entry, exercise_id: 'custom' })), status: 'completed', independent: true, source: row.source ?? source, cloud_allowed: cloudAllowed === true }, { mode: 'recorded', exercises: [] });
      totalSets += actual.entries.reduce((sum, entry) => sum + entry.sets.length, 0);
      if (totalSets > 5000) throw new Error('本批展开后超过5000组，请分批导入。');
      const focuses = [...new Set(actual.entries.flatMap(entry => entryFocuses(entry)))];
      const plan = { mode: 'recorded', date: row.date, split: null, focus: focuses[0], focuses, focus_label: focuses.map(focus => FOCUS_LABELS[focus]).join('＋'), title: '自主训练记录（无系统计划）', exercises: [], total_minutes: null, can_save: false };
      return { date: row.date, plan, actual };
    } catch (error) { throw new Error(`第${index + 1}条：${error.message}`); }
  });
}
