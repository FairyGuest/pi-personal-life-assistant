import { TRAINING_LIMITS, LOAD_BASES, entryFocuses, expandSetGroup, setsSummary } from './gui/public/training-model.js';

export const FITNESS_OPTIONS = {
  goals: { general: '保持健康与运动习惯', fat_loss: '减脂与体能', strength: '力量与肌肉', recovery: '恢复与轻活动' },
  experience: { beginner: '刚开始 / 很久没练', regular: '有规律训练经验' },
  equipment: { none: '徒手 / 户外', dumbbells: '哑铃', gym: '健身房' },
  readiness: { unknown: '还不确定', normal: '状态正常，无疼痛不适', tired: '疲劳 / 睡眠不足', pain: '疼痛 / 伤病 / 医嘱限制', ill: '发热 / 急性不适', red_flags: '胸痛 / 晕厥 / 异常呼吸困难' },
  yesterday: { unknown: '不确定 / 未记录', rest: '休息或轻活动', hard: '较重训练 / 明显酸痛' },
};

export const FOCUS_LABELS = { full_body: '全身', chest: '胸部', back: '背部', legs: '腿臀', shoulders: '肩部', arms: '手臂', core: '核心' };
export const SPLIT_LABELS = { three: '三分化（推 / 拉 / 腿）', five: '五分化（胸 / 背 / 腿 / 肩 / 手臂）', custom: '自主组合部位' };
export const SPLIT_DAYS = {
  three: { push: { label: '推：胸、肩、手臂', focuses: ['chest', 'shoulders', 'arms'] }, pull: { label: '拉：背、手臂', focuses: ['back', 'arms'] }, legs: { label: '腿：腿臀、核心', focuses: ['legs', 'core'] } },
  five: Object.fromEntries(['chest', 'back', 'legs', 'shoulders', 'arms'].map(focus => [focus, { label: FOCUS_LABELS[focus], focuses: [focus] }])),
};
export const RECOVERY_FATIGUE = { recovered: '恢复良好', tired: '有些疲劳', exhausted: '非常疲劳' };
export const RECOVERY_SORENESS = { none: '没有酸痛', mild: '轻微酸痛', moderate: '明显酸痛', severe: '严重酸痛/影响活动' };

const exercise = (name, cues, avoid) => ({ name, cues, avoid });
const LIBRARY = {
  chair_squat: exercise('椅子坐站', '双脚稳踩地面，屈髋坐向稳固椅子，再用脚掌发力站起；保持膝盖与脚尖方向一致。', '不要借惯性跌坐；出现膝、髋疼痛即停。'),
  goblet_squat: exercise('哑铃杯式深蹲', '双手将轻哑铃贴近胸前，屈髋屈膝至舒适深度，脚掌踩稳后站起。', '不要塌腰或为了更深而牺牲稳定。'),
  leg_press: exercise('轻重量腿举', '调整座椅使骨盆稳定，脚掌贴住踏板，以可控速度伸屈膝。', '不要锁死膝盖或让腰部离开靠垫。'),
  glute_bridge: exercise('臀桥', '仰卧屈膝、脚跟稳踩地面，收紧腹部后抬起臀部，顶端短暂停顿。', '不要过度拱腰或屏息。'),
  db_hinge: exercise('哑铃髋铰链', '轻哑铃贴近大腿，膝微屈，臀部向后，背部自然伸直，再从髋部发力站起。', '不要弓背硬拉；动作不熟练请先空手学习。'),
  step_up: exercise('低台阶踏步', '选择稳固低台阶，上台阶时前脚踩实，下台阶缓慢控制；可扶固定扶手。', '不要选择过高台阶或跳下。'),
  wall_pushup: exercise('靠墙俯卧撑', '双手略宽于肩，身体保持一条线，屈肘靠近墙面后推回；全程呼吸。', '不要耸肩、塌腰或锁死肘。'),
  incline_pushup: exercise('高位俯卧撑', '双手扶稳固的固定台面，躯干收紧，屈肘下放后推回。', '不要使用可能滑动的桌椅；不适就退回靠墙版。'),
  floor_press: exercise('哑铃地板卧推', '仰卧屈膝，从轻重量开始，肘部可控触地后推起，腕部保持中立。', '不要在疲劳时独自挑战重重量。'),
  chest_press: exercise('器械推胸', '调座椅让手柄接近胸部高度，肩胛稳定，控制推起及回放。', '不要借身体反弹或耸肩顶推。'),
  bird_dog: exercise('鸟狗式', '四点支撑，轻收腹，缓慢伸出对侧手脚，保持骨盆稳定，再换侧。', '不要抬腿过高或扭转腰背。'),
  prone_w: exercise('俯卧W夹肩', '俯卧或站立微俯身，手臂成W形，肩胛轻向后下方收紧，缓慢放松。', '不要耸肩、猛拉或出现肩痛仍继续。'),
  reverse_fly: exercise('轻哑铃俯身反向飞鸟', '屈髋微俯身，轻重量向两侧抬臂至舒适幅度，慢慢放下。', '不要甩臂或为了抬高重量而含胸弓背。'),
  db_row: exercise('支撑单臂哑铃划船', '一手扶稳固定支撑，另一手沿身体向髋部方向划，顶端短暂停。', '不要身体大幅旋转或耸肩借力。'),
  seated_row: exercise('器械坐姿划船', '坐稳后让肩胛先向后收，再把手柄划向躯干，缓慢回放。', '不要后仰猛拽或圆背。'),
  lateral_raise: exercise('轻哑铃侧平举', '手肘微屈，以轻重量侧抬至舒适高度，慢速下降。', '不要耸肩、甩臂或在疼痛范围训练。'),
  wall_slide: exercise('靠墙肩胛滑动', '背部轻靠墙，双臂在无痛范围向上滑动，保持肩颈放松。', '不要强迫肩膀贴墙或顶着疼痛活动。'),
  db_press: exercise('轻哑铃肩推', '坐稳收腹，轻重量在舒适范围推起，缓慢回放。', '有肩部疼痛或活动受限时不要做过顶推举。'),
  biceps_curl: exercise('哑铃弯举', '上臂靠近身体，控制抬起和放下，保持手腕中立。', '不要身体后仰甩动。'),
  cable_curl: exercise('绳索弯举', '站稳后上臂固定，控制前臂屈伸，全程自然呼吸。', '不要用身体摆动加速。'),
  triceps_extension: exercise('绳索下压', '上臂靠近身体，缓慢伸肘后还原，肩部保持放松。', '不要锁死肘或大幅摆动躯干。'),
  wall_triceps: exercise('靠墙窄距推', '双手略窄于肩撑墙，肘沿身体侧屈伸，保持身体稳定。', '肘、腕痛时停下，不必为了窄距而挤压关节。'),
  isometric_curl: exercise('双手对抗弯举', '一手轻托另一手手腕，弯起手臂时提供可控阻力，慢慢还原，两侧交替练习。', '不要猛拉手腕或在肘部疼痛时继续。'),
  dead_bug: exercise('死虫式', '仰卧屈髋屈膝，呼气时缓慢放下对侧手脚，腰背保持舒适稳定。', '不要屏息或让腰部明显拱起。'),
  side_plank: exercise('屈膝侧平板', '侧卧屈膝，以前臂和膝盖支撑抬髋，保持肩、髋稳定。', '肩或腰不适时缩短时间或停止。'),
};

const POOLS = {
  full_body: { none: ['chair_squat', 'wall_pushup', 'glute_bridge', 'prone_w', 'bird_dog'], dumbbells: ['goblet_squat', 'floor_press', 'db_row', 'db_hinge', 'dead_bug'], gym: ['leg_press', 'chest_press', 'seated_row', 'glute_bridge', 'dead_bug'] },
  chest: { none: ['wall_pushup', 'incline_pushup', 'bird_dog'], dumbbells: ['floor_press', 'incline_pushup', 'wall_pushup'], gym: ['chest_press', 'incline_pushup', 'wall_pushup'] },
  back: { none: ['bird_dog', 'prone_w', 'wall_slide'], dumbbells: ['db_row', 'reverse_fly', 'bird_dog'], gym: ['seated_row', 'db_row', 'prone_w'] },
  legs: { none: ['chair_squat', 'glute_bridge', 'step_up'], dumbbells: ['goblet_squat', 'db_hinge', 'glute_bridge'], gym: ['leg_press', 'glute_bridge', 'step_up'] },
  shoulders: { none: ['wall_slide', 'prone_w', 'wall_pushup'], dumbbells: ['lateral_raise', 'db_press', 'reverse_fly'], gym: ['lateral_raise', 'db_press', 'wall_slide'] },
  arms: { none: ['wall_pushup', 'isometric_curl', 'wall_triceps'], dumbbells: ['biceps_curl', 'floor_press', 'wall_triceps'], gym: ['cable_curl', 'triceps_extension', 'chest_press'] },
  core: { none: ['dead_bug', 'bird_dog', 'side_plank'], dumbbells: ['dead_bug', 'bird_dog', 'side_plank'], gym: ['dead_bug', 'bird_dog', 'side_plank'] },
};

export const trainingToday = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
};
const choice = (value, options, name) => { if (!Object.hasOwn(options, value)) throw new Error(`${name}选项无效。`); return value; };
const daysBetween = (start, end) => Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
const stopped = '一般训练建议，不是医疗/康复处方；文字不能验证动作姿势。出现疼痛、头晕、胸痛或异常气短立即停止，必要时寻求专业帮助。';

export function performedFocuses(plan, actual) {
  const practiced = [...new Set((actual?.entries || []).flatMap(entry => entryFocuses(entry, plan.exercises.find(item => item.id === entry.exercise_id))))];
  return practiced.length ? practiced : plan.mode === 'recovery' || actual?.entries?.length ? ['full_body'] : plan.focuses ?? [plan.focus];
}

export function retainedTrainingRecovery(plan, previousActual, updatedActual) {
  if (!previousActual?.recovery || updatedActual.status === 'skipped') return null;
  const targets = performedFocuses(plan, updatedActual);
  const recorded = Object.keys(previousActual.recovery.soreness ?? {});
  return targets.length === recorded.length && targets.every(target => recorded.includes(target)) ? previousActual.recovery : null;
}

export function planTraining(input = {}, { date = trainingToday(), history = [] } = {}) {
  choice(input.goal ?? 'general', FITNESS_OPTIONS.goals, '训练目标');
  const split = choice(input.split, SPLIT_LABELS, '训练分化');
  const dayKey = split === 'custom' ? null : choice(input.day, SPLIT_DAYS[split], '分化训练日');
  const day = dayKey ? SPLIT_DAYS[split][dayKey] : null;
  if (split === 'custom' && input.day) throw new Error('自选部位不需要指定分化训练日。');
  const focuses = input.focuses ?? (input.focus ? [input.focus] : day?.focuses);
  if (!Array.isArray(focuses) || !focuses.length || focuses.length > 4 || new Set(focuses).size !== focuses.length) throw new Error('请选择1—4个不同的训练部位。');
  for (const focus of focuses) choice(focus, FOCUS_LABELS, '目标部位');
  if (focuses.includes('full_body') && focuses.length > 1) throw new Error('全身训练不能同时勾选其他部位。');
  const focus = focuses[0];
  const focusLabel = focuses.map(item => FOCUS_LABELS[item]).join('＋');
  const experience = choice(input.experience ?? 'beginner', FITNESS_OPTIONS.experience, '训练经验');
  const equipment = choice(input.equipment ?? 'none', FITNESS_OPTIONS.equipment, '器材');
  const readiness = choice(input.readiness ?? 'unknown', FITNESS_OPTIONS.readiness, '身体状态');
  const yesterday = choice(input.yesterday ?? 'unknown', FITNESS_OPTIONS.yesterday, '昨天训练');
  const minutes = input.minutes ?? 30;
  if (!Number.isInteger(minutes) || minutes < 10 || minutes > 90) throw new Error('可用时间请填写10—90分钟的整数。');
  const preferences = { goal: input.goal ?? 'general', split, day: dayKey, focuses, experience, equipment, readiness, yesterday, minutes };
  const base = { date, preferences, split, day: dayKey, focuses, focus, focus_label: focusLabel, requested_minutes: minutes, notice: stopped, catalog_version: 2 };
  if (['pain', 'ill', 'red_flags'].includes(readiness)) return { ...base, mode: 'blocked', title: '今天先不安排训练', total_minutes: 0, blocks: [], exercises: [], warnings: [readiness === 'red_flags' ? '若正在胸痛、晕厥或异常气短，不要训练，请立即寻求急救/拨打120。' : '当前疼痛、伤病、发热或医嘱限制时不安排练习；先休息并向医生询问何时适合恢复。'], can_save: false };
  const overlaps = row => performedFocuses(row.plan, row.actual).some(item => focuses.includes(item) || item === 'full_body');
  const relevant = history.filter(row => row.plan?.mode !== 'recovery' && overlaps(row) && ['completed', 'partial'].includes(row.status) && row.date < date && daysBetween(row.date, date) <= 30).sort((first, second) => second.date.localeCompare(first.date)).slice(0, 30);
  const latest = relevant[0];
  const recentDays = latest ? daysBetween(latest.date, date) : null;
  const recentFeedback = relevant.find(row => row.actual?.recovery?.recorded_date <= date && daysBetween(row.date, date) <= 3)?.actual.recovery;
  const overallFatigue = history.filter(row => ['completed', 'partial'].includes(row.status) && row.date < date && daysBetween(row.date, date) <= 3 && row.actual?.recovery?.recorded_date <= date).sort((first, second) => second.date.localeCompare(first.date))[0]?.actual.recovery.fatigue;
  const sorenessFor = focus => recentFeedback?.soreness[focus] ?? recentFeedback?.soreness.full_body;
  const sore = recentFeedback && focuses.some(item => ['moderate', 'severe'].includes(sorenessFor(item)));
  const severe = overallFatigue === 'exhausted' || (recentFeedback && focuses.some(item => sorenessFor(item) === 'severe'));
  const recovery = preferences.goal === 'recovery' || readiness !== 'normal' || yesterday === 'hard' || yesterday === 'unknown' || (recentDays !== null && recentDays < 2) || severe;
  const total = recovery ? Math.min(minutes, 20) : experience === 'beginner' ? Math.min(minutes, 40) : minutes;
  const warmup = Math.max(3, Math.min(8, Math.round(total * 0.16)));
  const cooldown = Math.max(2, Math.min(6, Math.round(total * 0.1)));
  const main = total - warmup - cooldown;
  const warnings = [];
  if (readiness === 'unknown' || yesterday === 'unknown') warnings.push('身体状态或昨天训练不明确，暂时只给轻活动；核对后再制定目标部位训练。');
  if (readiness === 'tired' || yesterday === 'hard') warnings.push('疲劳或前一天高负荷时优先恢复，今天不叠加高强度力量。');
  if (recentDays !== null && recentDays < 2) warnings.push(`记录显示${latest.date}练过${latest.plan?.focus_label ?? FOCUS_LABELS[latest.focus]}，与你今天的部位重叠；本次先做轻活动，不重复安排负荷。`);
  if (severe) warnings.push('上次次日反馈为非常疲劳或目标部位严重酸痛；这次只安排轻活动。若疼痛异常或持续，请咨询医生。');
  else if (sore) warnings.push('上次次日反馈仍有明显酸痛，本次先减少组数；若今天仍明显不适，请改为恢复或休息。');
  if (latest?.actual?.discomfort === 'pain') warnings.push('上次反馈过疼痛；没有医务人员确认前，不要照旧负重或用训练硬扛不适。');
  if (day && day.focuses.join(',') !== focuses.join(',')) warnings.push('已按你修改后的部位组合规划；分化只是模板，不应忽视实际恢复状况。');
  if (total < minutes) warnings.push(`本次安排${total}分钟，不必用满${minutes}分钟。`);
  const blocks = [{ title: '热身', minutes: warmup, instructions: '轻松走动，再活动本次目标部位及邻近关节，循序加速；不做疼痛方向动作。' }];
  let exercises = [];
  if (recovery) blocks.push({ title: '轻活动', minutes: main, instructions: '轻松步行或舒适范围活动，能完整交谈；若不适立即停止。今天不进行目标部位力量组。' });
  else {
    const minimumStrength = focuses.length === 1 ? 5 : focuses.length * 7;
    if (main < minimumStrength) throw new Error('可用时间不足以照顾全部所选部位；请增加时间、减少部位，或选择恢复活动。');
    const cardio = preferences.goal === 'fat_loss' || preferences.goal === 'general' ? Math.min(Math.round(main * 0.25), Math.max(0, main - minimumStrength)) : 0;
    const strength = main - cardio;
    const count = Math.max(focuses.length, Math.min(4, Math.floor(strength / 9)));
    const selected = []; const chosen = new Set();
    const pool = target => target === 'arms' && split === 'three' && dayKey === 'push' ? (equipment === 'gym' ? ['triceps_extension'] : ['wall_triceps']) : target === 'arms' && split === 'three' && dayKey === 'pull' ? (equipment === 'gym' ? ['cable_curl'] : equipment === 'dumbbells' ? ['biceps_curl'] : ['isometric_curl']) : POOLS[target][equipment];
    for (const target of focuses) { const id = pool(target).find(item => !chosen.has(item)); if (!id) throw new Error('部位组合缺少互不重复的安全动作，请调整器材或部位。'); selected.push({ id, target }); chosen.add(id); }
    for (let depth = 1; selected.length < count && depth < 5; depth++) for (const target of focuses) { const id = pool(target)[depth]; if (id && !chosen.has(id) && selected.length < count) { selected.push({ id, target }); chosen.add(id); } }
    const lowRecovery = sore || overallFatigue === 'tired' || latest?.actual?.discomfort === 'pain' || latest?.actual?.energy === 'hard' || latest?.actual?.entries?.some(entry => entry.sets.some(set => set.rir !== null && set.rir <= 1));
    const plannedSets = Math.min(experience === 'beginner' ? 3 : 4, Math.max(1, Math.floor((strength / count - 2) / 2.5)));
    exercises = selected.map(({ id, target }, index) => ({ id, name: LIBRARY[id].name, focus: target, sets: Math.max(1, plannedSets - (lowRecovery ? 1 : 0)), reps: id === 'side_plank' ? '每侧15—30秒' : ['bird_dog', 'dead_bug'].includes(id) ? '每侧6—10次' : index === 0 ? '6—10次' : '8—12次', tracking_unit: id === 'side_plank' ? 'seconds' : 'reps', rest_seconds: index === 0 ? 90 : 60, rir: experience === 'beginner' ? '保留3—4次余力' : '保留2—3次余力', cues: LIBRARY[id].cues, avoid: LIBRARY[id].avoid }));
    blocks.push({ title: `${focusLabel}力量`, minutes: strength, instructions: `每个所选部位至少安排一个动作；每组之间休息包含在${strength}分钟内，时间到了就结束，不追求做完所有组。` });
    if (cardio) blocks.push({ title: '轻快走', minutes: cardio, instructions: '保持可以交谈的速度；不估算消耗热量、不将有氧当作惩罚。' });
    if (focuses.includes('back') && equipment === 'none') warnings.push('徒手背部动作主要用于肩胛控制，缺少逐步加阻力的拉力动作；想增加背部力量可考虑安全器材或教练指导。');
    if (focuses.includes('arms') && equipment === 'none') warnings.push('徒手手臂动作的负荷有限；想更系统增强肌力，可考虑合适器材和动作指导。');
    if (lowRecovery) warnings.push('上次训练反馈疲劳、接近力竭或疼痛，减少每动作一组；如仍疼痛请停止并寻求专业帮助。');
  }
  blocks.push({ title: '放松', minutes: cooldown, instructions: '放慢脚步与呼吸，在无痛舒适范围轻柔活动；不强压关节。' });
  const adaptations = exercises.flatMap(item => {
    const previousSession = relevant.find(row => row.actual?.entries?.some(entry => entry.exercise_id === item.id));
    const previous = previousSession?.actual.entries.find(entry => entry.exercise_id === item.id);
    if (!previous?.sets?.length) return [];
    const nextDay = previousSession.actual.recovery?.recorded_date <= date ? previousSession.actual.recovery : null;
    const noPain = previousSession.actual.discomfort === 'none' && nextDay?.fatigue === 'recovered' && ['none', 'mild'].includes(nextDay.soreness[item.focus] ?? nextDay.soreness.full_body);
    const plenty = previous.sets.every(set => set.rir !== null && set.rir >= 3);
    return [{ exercise_id: item.id, previous: `${previous.sets.length}组 · ${previous.sets.map(set => `${set.seconds === null ? `${set.reps}次` : `${set.seconds}秒`}${set.load_kg === null ? '' : `/${set.load_kg}kg`}`).join('、')}`, suggestion: noPain && plenty && !recovery && !sore && overallFatigue !== 'tired' ? item.tracking_unit === 'seconds' ? '如果动作稳定且无不适，可以小幅增加每组保持时间；不要为了计时而屏息。' : '如果动作稳定且无不适，下一次优先每组增加1—2次；达到目标上限后再考虑小幅加重2%—5%，一次只调整一项。' : nextDay ? '先保持或降低负荷、改善动作；不要只因上次完成就自动加重。' : '尚无这次训练的次日疲劳和酸痛反馈，先维持负荷，不依据完成组数自行加重。' }];
  });
  return { ...base, mode: recovery ? 'recovery' : 'training', title: recovery ? '今日恢复与轻活动' : `今日${focusLabel}训练`, total_minutes: total, intensity: recovery ? '轻松、能交谈' : '以技术稳定为先，不练到力竭', blocks, exercises, adaptations, warnings, can_save: true, history_basis: latest ? { date: latest.date, session_id: latest.id, status: latest.status } : null };
}

export function validateTrainingRecovery(input, plan, performedDate, asOfDate = trainingToday(), actual) {
  if (asOfDate <= performedDate) throw new Error('训练结束后的第二天才记录恢复情况，不提前猜测。');
  const fatigue = choice(input.fatigue, RECOVERY_FATIGUE, '次日疲劳');
  const targets = performedFocuses(plan, actual);
  if (!input.soreness || typeof input.soreness !== 'object' || Array.isArray(input.soreness) || Object.keys(input.soreness).length !== targets.length || !targets.every(target => Object.hasOwn(input.soreness, target))) throw new Error('请分别填写每个实际训练部位的酸痛程度。');
  const soreness = {};
  for (const target of targets) soreness[target] = choice(input.soreness[target], RECOVERY_SORENESS, `${FOCUS_LABELS[target]}酸痛`);
  const notes = input.notes ?? '';
  if (typeof notes !== 'string' || notes.length > 300 || /sk-[a-z0-9_-]{16,}|bearer\s+[a-z0-9._-]{20,}|-----BEGIN .*PRIVATE KEY-----|\b\d{17}[\dXx]\b/i.test(notes)) throw new Error('次日反馈最多300字，不能包含密钥、私钥或身份证。');
  return { fatigue, soreness, notes: notes.trim(), recorded_date: asOfDate };
}

export function validateTrainingLog(input, plan) {
  const status = choice(input.status, { completed: true, partial: true, skipped: true }, '完成状态');
  if (!Number.isInteger(input.duration_minutes) || input.duration_minutes < 0 || input.duration_minutes > 240) throw new Error('实际运动时间请填写0—240分钟整数。');
  const independent = input.independent === true || plan.mode === 'recorded';
  const discomfort = choice(input.discomfort ?? (independent ? 'unknown' : 'none'), { unknown: true, none: true, mild: true, pain: true }, '不适程度');
  const energy = choice(input.energy ?? (independent ? 'unknown' : 'normal'), { unknown: true, easy: true, normal: true, hard: true }, '主观强度');
  const notes = input.notes ?? '';
  if (typeof notes !== 'string' || notes.length > 500) throw new Error('训练反馈最多500字。');
  const entries = input.entries ?? [];
  if (!Array.isArray(entries) || entries.length > TRAINING_LIMITS.exercises) throw new Error(`一次最多记录${TRAINING_LIMITS.exercises}个动作。`);
  const seen = new Set();
  const validated = entries.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('动作记录格式无效。');
    const item = plan.exercises.find(exercise => exercise.id === row.exercise_id);
    if (!item && row.exercise_id !== 'custom') throw new Error('记录的动作不在本次训练计划内。');
    const name = item ? item.name : row.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 60 || /sk-[a-z0-9_-]{16,}|bearer\s+[a-z0-9._-]{20,}|-----BEGIN .*PRIVATE KEY-----|\b\d{17}[\dXx]\b/i.test(name)) throw new Error('自定义动作名称无效或含敏感信息。');
    if (seen.has(name.trim())) throw new Error('同一动作只记录一行，各组填在其下。');
    seen.add(name.trim());
    const primary = row.primary_focuses ?? row.focuses ?? (row.focus ? [row.focus] : item?.focus ? [item.focus] : []);
    const secondary = row.secondary_focuses ?? [];
    for (const [label, values] of [['主练部位', primary], ['协同部位', secondary]]) {
      if (!Array.isArray(values) || values.length > 7 || new Set(values).size !== values.length) throw new Error(`${label}应为不重复的部位数组。`);
      for (const value of values) choice(value, FOCUS_LABELS, label);
    }
    if (primary.some(focus => secondary.includes(focus))) throw new Error('同一部位不必同时标为主练和协同。');
    const focuses = [...primary, ...secondary];
    if (focuses.includes('full_body') && focuses.length > 1) throw new Error('全身不能和其他部位重复勾选。');
    const focus = primary[0];
    const trackingUnit = item?.tracking_unit ?? choice(row.tracking_unit ?? 'reps', { reps: true, seconds: true }, '记录单位');
    if ((independent || row.primary_focuses !== undefined || row.focuses !== undefined) && !focus) throw new Error('请填写每个实际动作的训练部位。');
    if (row.sets !== undefined && row.set_groups !== undefined) throw new Error('逐组sets和批量set_groups只能填写一种，避免重复累计。');
    if (row.set_groups !== undefined && (!Array.isArray(row.set_groups) || !row.set_groups.length || row.set_groups.length > TRAINING_LIMITS.sets)) throw new Error('批量组数格式无效。');
    const sets = row.set_groups?.flatMap(group => expandSetGroup(group, trackingUnit)) ?? row.sets;
    if (!Array.isArray(sets) || sets.length < 1 || sets.length > TRAINING_LIMITS.sets) throw new Error(`每个已做动作需记录1—${TRAINING_LIMITS.sets}组。`);
    const loadBasis = choice(row.load_basis ?? 'unknown', LOAD_BASES, '负重口径');
    if (row.catalog_id !== undefined && (typeof row.catalog_id !== 'string' || !/^(?:wger-\d+|local-plank)$/.test(row.catalog_id))) throw new Error('动作库标识无效。');
    return { exercise_id: item?.id ?? 'custom', name: name.trim(), ...(focus ? { focus, focuses, primary_focuses: [...primary], secondary_focuses: [...secondary] } : {}), ...(row.catalog_id ? { catalog_id: row.catalog_id } : {}), load_basis: loadBasis, tracking_unit: trackingUnit, sets: sets.map(set => {
      if (!set || typeof set !== 'object' || Array.isArray(set)) throw new Error('每组记录格式无效。');
      if (trackingUnit === 'seconds' ? !Number.isInteger(set.seconds) || set.seconds < (item ? 5 : 1) || set.seconds > (item ? 180 : 14400) : !Number.isInteger(set.reps) || set.reps < 1 || set.reps > 100) throw new Error('每组次数应为1—100次，计划计时动作5—180秒，自主计时动作1—14400秒。');
      if (trackingUnit === 'seconds' ? set.reps != null : set.seconds != null) throw new Error('每组只填写次数或秒数之一，请核对记录单位。');
      if (set.load_kg !== null && set.load_kg !== undefined && (!Number.isFinite(set.load_kg) || set.load_kg < 0 || set.load_kg > 500)) throw new Error('负重应为0—500kg，或留空表示未知。');
      if (loadBasis === 'bodyweight' && set.load_kg != null && set.load_kg !== 0) throw new Error('徒手口径只能填0kg或留空；有额外负重请更换口径。');
      if (set.rir !== null && set.rir !== undefined && (!Number.isInteger(set.rir) || set.rir < 0 || set.rir > 10)) throw new Error('剩余次数（RIR）应为0—10，或留空表示未知。');
      return { reps: trackingUnit === 'seconds' ? null : set.reps, seconds: trackingUnit === 'seconds' ? set.seconds : null, load_kg: set.load_kg ?? null, rir: set.rir ?? null };
    }) };
  });
  if (status === 'skipped' && (validated.length || input.duration_minutes !== 0)) throw new Error('未训练时不能填写已做组数或运动时长。');
  if (status !== 'skipped' && input.duration_minutes === 0) throw new Error('实际训练时长必须大于0，未训练请选择跳过。');
  if (status !== 'skipped' && plan.exercises.length && !validated.length) throw new Error('请至少记录一个实际完成的动作，或选择跳过。');
  if (independent && status !== 'skipped' && !validated.length) throw new Error('请至少记录一个实际完成的动作。');
  if (!independent && status === 'completed' && plan.exercises.some(item => !validated.some(entry => entry.exercise_id === item.id))) throw new Error('还有计划动作没有记录；请补齐实际组数，或选择“部分完成”。');
  if (/sk-[a-z0-9_-]{16,}|bearer\s+[a-z0-9._-]{20,}|-----BEGIN .*PRIVATE KEY-----|\b\d{17}[\dXx]\b/i.test(notes)) throw new Error('反馈中不能保存密钥、身份证或私钥。');
  const source = input.source;
  if (source !== undefined && (typeof source !== 'string' || !source.trim() || source.length > 160 || /sk-[a-z0-9_-]{16,}|bearer\s+[a-z0-9._-]{20,}|-----BEGIN .*PRIVATE KEY-----|\b\d{17}[\dXx]\b/i.test(source))) throw new Error('记录来源无效或含敏感信息。');
  return { status, duration_minutes: input.duration_minutes, discomfort, energy, notes: notes.trim(), entries: validated, cloud_allowed: input.cloud_allowed === true, ...(independent ? { independent: true } : {}), ...(source === undefined ? {} : { source: source.trim() }) };
}

export function trainingFeedbackText(session) {
  const actual = session.actual;
  if (!actual) return '';
  const focusLabel = actual.independent ? performedFocuses(session.plan, actual).map(focus => FOCUS_LABELS[focus]).join('＋') : session.plan.focus_label;
  const status = { completed: '已完成', partial: '部分完成', skipped: '未训练' };
  const energy = { unknown: '未记录', easy: '轻松', normal: '适中', hard: '吃力' };
  const discomfort = { unknown: '未记录', none: '无', mild: '轻微', pain: '疼痛' };
  return [`${session.date} · ${focusLabel} · ${status[actual.status]} · 实际${actual.duration_minutes}分钟`, actual.independent ? `自主实际记录，不代表完成参考计划；来源：${actual.source || '未注明'}` : '', `体感：${energy[actual.energy]}；不适：${discomfort[actual.discomfort]}`, ...actual.entries.map(entry => `${entry.name}：${setsSummary(entry.sets)}；${LOAD_BASES[entry.load_basis || 'unknown']}；主练：${(entry.primary_focuses || (entry.focus ? [entry.focus] : [])).map(focus => FOCUS_LABELS[focus]).join('＋') || '未标注'}；协同：${(entry.secondary_focuses || []).map(focus => FOCUS_LABELS[focus]).join('＋') || '未标注'}`), actual.notes ? `反馈：${actual.notes}` : '', actual.recovery ? `训练后恢复反馈（${actual.recovery.recorded_date}）：${RECOVERY_FATIGUE[actual.recovery.fatigue]}；${Object.entries(actual.recovery.soreness).map(([focus, soreness]) => `${FOCUS_LABELS[focus]}${RECOVERY_SORENESS[soreness]}`).join('、')}${actual.recovery.notes ? `；补充：${actual.recovery.notes}` : ''}` : ''].filter(Boolean).join('\n');
}
