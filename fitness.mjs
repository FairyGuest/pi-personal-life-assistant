import { HEIGHT_FIELD } from './catalog.mjs';
import { checkedDate, today } from './store.mjs';
import { FITNESS_OPTIONS } from './training.mjs';

export { FITNESS_OPTIONS } from './training.mjs';

const bmiNotice = 'BMI仅是成人筛查参考，不是诊断，也不能区分肌肉与脂肪；未成年人、孕期及特殊身体情况不应直接套用。不据此自动设置减重目标。';
const workoutNotice = '一般运动模板，不是医疗或康复处方；动作不熟悉先学习或请教教练。不憋气、不冲击极限，出现疼痛、头晕、胸痛或异常气短立即停止。';
const enumInput = (value, options, label) => { if (!Object.hasOwn(options, value)) throw new Error(`${label}选项无效。`); return value; };
const numberInput = (value, minimum, maximum, label) => { if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${label}请填写${minimum}—${maximum}之间的数值并核对单位。`); return value; };

export function calculateBmi({ height_cm, weight_kg, standard = 'china' }) {
  numberInput(height_cm, HEIGHT_FIELD.minimum, HEIGHT_FIELD.maximum, '身高（cm）');
  numberInput(weight_kg, 15, 500, '体重（kg）');
  enumInput(standard, { china: true, who: true }, 'BMI标准');
  const value = weight_kg / ((height_cm / 100) ** 2);
  const thresholds = standard === 'china' ? [18.5, 24, 28] : [18.5, 25, 30];
  const category = value < thresholds[0] ? '偏低' : value < thresholds[1] ? '正常范围' : value < thresholds[2] ? '超重范围' : '肥胖范围';
  return { bmi: Number(value.toFixed(1)), category, standard, standard_label: standard === 'china' ? '中国成人标准（18.5 / 24 / 28）' : 'WHO成人标准（18.5 / 25 / 30）', height_cm, weight_kg, formula: '体重（kg）÷ 身高（m）的平方', notice: bmiNotice };
}

export function bmiFromStore(store, input = {}, { cloudOnly = false, asOf = today() } = {}) {
  checkedDate(asOf);
  const heightRow = store.currentMemory('fitness', HEIGHT_FIELD.key, 'fact');
  const height = heightRow && (!cloudOnly || heightRow.cloud_allowed) && heightRow.unit === 'cm' && /^\d+(?:\.\d+)?$/.test(heightRow.value) ? heightRow : null;
  const weight = store.listMetrics({ metric: 'weight_kg', cloudOnly, limit: 1, end_date: asOf })[0] ?? null;
  const heightValue = input.height_cm ?? (height ? Number(height.value) : undefined);
  const weightValue = input.weight_kg ?? weight?.value;
  const scope = cloudOnly ? '只读取当前已授权的身高和最近已授权体重；缺失不代表本地没有资料' : '仅本地计算，不发送给模型；临时输入不会保存';
  const missing = [];
  if (heightValue === undefined) missing.push('身高（cm）');
  if (weightValue === undefined) missing.push('体重（kg）');
  if (missing.length) return { status: 'missing', missing, scope, height_cm: heightValue ?? null, weight_kg: weightValue ?? null, notice: bmiNotice };
  const result = calculateBmi({ height_cm: heightValue, weight_kg: weightValue, standard: input.standard });
  const temporaryWeight = input.weight_kg !== undefined;
  const ageDays = temporaryWeight ? null : Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${weight.measured_date}T00:00:00Z`)) / 86400000);
  return { ...result, status: 'ready', scope, height_source: input.height_cm !== undefined ? '临时输入（未保存）' : `长期资料 · ${height.effective_date}`, weight_source: temporaryWeight ? '临时输入（未保存）' : `最近${cloudOnly ? '已授权' : '真实'}测量 · ${weight.measured_date} ${weight.measured_time || ''}`, weight_age_days: ageDays, stale: ageDays !== null && ageDays > 30, warnings: ageDays > 30 ? ['体重记录超过30天，仅代表那次测量；建议先补充近期体重。'] : [] };
}

export function planWorkout(input = {}, { date = today() } = {}) {
  checkedDate(date);
  const goal = enumInput(input.goal ?? 'general', FITNESS_OPTIONS.goals, '训练目标');
  const experience = enumInput(input.experience ?? 'beginner', FITNESS_OPTIONS.experience, '训练经验');
  const equipment = enumInput(input.equipment ?? 'none', FITNESS_OPTIONS.equipment, '器材');
  const readiness = enumInput(input.readiness ?? 'unknown', FITNESS_OPTIONS.readiness, '身体状态');
  const yesterday = enumInput(input.yesterday ?? 'unknown', FITNESS_OPTIONS.yesterday, '昨天训练');
  const minutes = numberInput(input.minutes ?? 30, 10, 90, '可用时间（分钟）');
  if (!Number.isInteger(minutes)) throw new Error('训练分钟数请填写整数。');
  const preferences = { goal, experience, equipment, readiness, yesterday, minutes };
  const base = { date, preferences, requested_minutes: minutes, notice: workoutNotice, assumption: '仅依据本次自报状态生成；不推断伤病、体重、完成情况或医疗许可。' };
  if (['pain', 'ill', 'red_flags'].includes(readiness)) {
    const urgent = readiness === 'red_flags';
    return { ...base, mode: 'blocked', title: '今天先不安排训练', total_minutes: 0, blocks: [], warnings: [urgent ? '不要训练；如果正在胸痛、晕厥或异常呼吸困难，请立即寻求急救 / 拨打120。' : '先休息，不自行安排康复动作；伤病、发热或医嘱限制需咨询医生后再制定适合的计划。'], can_save: false };
  }
  const recovery = goal === 'recovery' || readiness !== 'normal' || yesterday !== 'rest';
  const total = recovery ? Math.min(minutes, 20) : experience === 'beginner' ? Math.min(minutes, 40) : minutes;
  const warmup = Math.min(8, Math.max(3, Math.round(total * 0.16)));
  const cooldown = Math.min(6, Math.max(2, Math.round(total * 0.1)));
  const main = total - warmup - cooldown;
  const warnings = [];
  if (readiness === 'unknown' || yesterday === 'unknown') warnings.push('状态或昨天训练尚不明确，先给低强度轻活动；核对后可重新生成。');
  if (readiness === 'tired' || yesterday === 'hard') warnings.push('疲劳或较重训练后优先恢复，今天不安排重力量或间歇冲刺。');
  if (total < minutes) warnings.push(`本次先安排${total}分钟，不必用满${minutes}分钟；以恢复和循序渐进为先。`);
  const blocks = [{ title: '热身', minutes: warmup, instructions: '缓慢走动，轻柔活动肩、髋、踝，逐渐升温；不做疼痛方向的拉伸。' }];
  if (recovery) blocks.push({ title: '轻活动', minutes: main, instructions: '轻松步行，呼吸平稳、能完整交谈；疲劳加重随时结束。无需达到配速或步数目标。' });
  else if (goal === 'fat_loss' || main < 12) blocks.push({ title: '低冲击有氧', minutes: main, instructions: '步行或轻快走；能完整交谈、不喘到说不出话。短时段也算积累，不强求速度或热量。' });
  else {
    const cardio = goal === 'strength' ? 0 : Math.max(4, Math.round(main * 0.3));
    const exercises = equipment === 'none' ? '椅子坐站、靠墙俯卧撑、臀桥、鸟狗式' : equipment === 'dumbbells' ? '轻哑铃椅子坐站、支撑单臂划船、靠墙俯卧撑、鸟狗式' : '轻重量腿举、坐姿划船、器械胸推、鸟狗式（器械设置先请教教练）';
    blocks.push({ title: '基础力量', minutes: main - cardio, instructions: `${exercises}。各动作先${experience === 'beginner' ? '1—2' : '2'}组、每组6—10次，左右动作两侧都做；组间休息60—90秒包含在时段内。保留至少3次余力，时间到就结束，不必做完所有组数。` });
    if (cardio) blocks.push({ title: '轻快走', minutes: cardio, instructions: '选择平地，保持能完整交谈的强度，感觉疲劳可放慢。' });
  }
  blocks.push({ title: '放松', minutes: cooldown, instructions: '慢走降速、恢复呼吸，舒适范围内轻柔伸展；不强压关节或拉到疼痛。' });
  return { ...base, mode: recovery ? 'recovery' : 'training', title: recovery ? '今日恢复与轻活动' : `今日${FITNESS_OPTIONS.goals[goal]}训练`, total_minutes: total, intensity: recovery ? '轻松，主观用力2—3 / 10' : '轻至中等，主观用力3—5 / 10', blocks, warnings, can_save: true };
}

export function workoutPlanRecord(workout) {
  if (!workout.can_save) throw new Error('当前状态不适合安排训练，请先处理不适或咨询医生。');
  return { domain: 'fitness', kind: 'task', title: `${workout.date} · ${workout.title}`, status: 'planned', due_date: workout.date, next_action: `先检查身体状态，再按计划进行${workout.total_minutes}分钟；完成后记录当天累计实际训练分钟。`, detail: [workout.intensity, ...workout.blocks.map(block => `${block.title} ${block.minutes}分钟：${block.instructions}`), ...workout.warnings, workout.notice, '这是计划，不是完成记录；只记录实际发生的训练。'].join('\n'), cloud_allowed: false };
}
