export const DOMAIN_LABELS = { general: '生活与现状', career: '职业与求职', finance: '理财与退休', learning: '学习与研究', fitness: '身体与锻炼', relationships: '情感与关系' };
export const KIND_LABELS = { fact: '已发生的事实', goal: '未来目标', assumption: '测算假设', preference: '个人偏好', unknown: '待确认信息' };
export const PLAN_KIND_LABELS = { goal: '长期目标', milestone: '阶段里程碑', task: '具体行动', job: '求职机会' };
export const STATUS_LABELS = { planned: '待开始', active: '进行中', done: '已完成', paused: '暂停', deferred: '延后', applied: '已投递', test: '笔试中', interview: '面试中', offer: '获得录用', rejected: '未通过', withdrawn: '已撤回', waiting: '等待反馈' };
export const PRIVACY_LABELS = { personal: '个人资料', ordinary: '一般资料', sensitive: '敏感资料（只能本地保存）' };
export const DOMAINS = Object.keys(DOMAIN_LABELS);
export const KINDS = Object.keys(KIND_LABELS);
export const PLAN_STATUSES = ['planned', 'active', 'done', 'paused', 'deferred'];
export const JOB_STATUSES = ['planned', 'applied', 'test', 'interview', 'offer', 'rejected', 'withdrawn', 'waiting'];
export const METRICS = {
  weight_kg: { label: '体重', unit: 'kg', display_unit: 'kg', minimum: 15, maximum: 500, step: '0.1', daily_rule: 'mean', hint: '建议晨起、如厕后，用同一台秤测量。' },
  waist_cm: { label: '腰围', unit: 'cm', display_unit: 'cm', minimum: 20, maximum: 300, step: '0.1', daily_rule: 'mean', hint: '同一位置、自然呼气后测量，不收腹。' },
  body_fat_percent: { label: '体脂率', unit: '%', display_unit: '%', minimum: 1, maximum: 80, step: '0.1', daily_rule: 'mean', hint: '固定设备与测量时段；家用设备估算仅供趋势参考。' },
  resting_heart_rate: { label: '静息心率', unit: 'bpm', display_unit: '次/分', minimum: 20, maximum: 250, step: '1', daily_rule: 'mean', hint: '安静休息后测量，不把运动心率记在这里。' },
  steps: { label: '步数', unit: 'steps', display_unit: '步', minimum: 0, maximum: 200000, step: '1', daily_rule: 'latest', hint: '记录当天累计总步数。同日更新取最新记录，不相加。' },
  sleep_hours: { label: '睡眠时长', unit: 'hours', display_unit: '小时', minimum: 0, maximum: 24, step: '0.1', daily_rule: 'latest', hint: '按醒来那一天记录本次睡眠总时长；同日更新取最新值。' },
  training_minutes: { label: '训练时长', unit: 'minutes', display_unit: '分钟', minimum: 0, maximum: 1440, step: '1', daily_rule: 'latest', hint: '记录当天累计训练总分钟数，不是每一组训练时长。' },
};
export const METRIC_LABELS = Object.fromEntries(Object.entries(METRICS).map(([key, item]) => [key, item.label]));
export const metricLabel = key => METRICS[key] ? `${METRICS[key].label}（${METRICS[key].display_unit}）` : '未知指标';
export const PLAN_PARENT_KINDS = { goal: [], milestone: ['goal'], task: ['goal', 'milestone'], job: [] };
export const HEIGHT_FIELD = { key: '身高', label: '身高（cm）', unit: 'cm', minimum: 50, maximum: 250 };
