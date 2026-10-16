import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DOMAINS, KINDS, METRICS, PLAN_STATUSES, JOB_STATUSES, PLAN_PARENT_KINDS, HEIGHT_FIELD } from './catalog.mjs';
import { retainedTrainingRecovery, validateTrainingLog, validateTrainingRecovery } from './training.mjs';
import { validateTrainingRecords } from './training-import.mjs';

export { DOMAINS, KINDS, METRICS, PLAN_STATUSES, JOB_STATUSES };
export const SCHEMA_VERSION = 4;

export function today() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export function checkedText(value, name, maximum = 1200) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error(`${name}必须是1—${maximum}字的文字。`);
  if (/sk-[a-z0-9_-]{16,}|bearer\s+[a-z0-9._-]{20,}|-----BEGIN .*PRIVATE KEY-----|\b\d{17}[\dXx]\b/i.test(value)) {
    throw new Error('不能保存密钥、身份证号或私钥，请使用脱敏资料。');
  }
  return value.trim();
}

export function checkedDate(value, name = '日期') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name}应为YYYY-MM-DD。`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${name}无效。`);
  return value;
}

function enumValue(value, options, name) {
  if (!options.includes(value)) throw new Error(`${name}不在允许范围。`);
  return value;
}

export function validateMemory(input) {
  const sensitivity = enumValue(input.domain === 'relationships' ? 'sensitive' : input.sensitivity ?? 'personal', ['ordinary', 'personal', 'sensitive'], '隐私级别');
  const effectiveDate = checkedDate(input.effective_date ?? today());
  if (input.kind === 'fact' && effectiveDate > today()) throw new Error('未来状态应记为目标或假设，不能记为已发生事实。');
  if (input.domain === 'fitness' && input.key === HEIGHT_FIELD.key && input.kind === 'fact') {
    if (input.unit !== HEIGHT_FIELD.unit || typeof input.value !== 'string' || !/^\d+(?:\.\d+)?$/.test(input.value.trim()) || Number(input.value) < HEIGHT_FIELD.minimum || Number(input.value) > HEIGHT_FIELD.maximum) throw new Error('身高事实请填写50—250之间的纯数值，单位固定为cm。');
  }
  return {
    domain: enumValue(input.domain, DOMAINS, '领域'),
    key: checkedText(input.key, '字段名', 100),
    kind: enumValue(input.kind, KINDS, '信息类型'),
    value: checkedText(input.value, '内容'),
    unit: input.unit ? checkedText(input.unit, '单位', 40) : '',
    effective_date: effectiveDate,
    source: checkedText(input.source ?? '用户确认', '来源', 160),
    sensitivity,
    cloud_allowed: sensitivity !== 'sensitive' && input.cloud_allowed === true,
  };
}

export function validateMetric(input) {
  const definition = METRICS[input.metric];
  if (!definition) throw new Error('不支持此指标。');
  if (!Number.isFinite(input.value) || input.value < definition.minimum || input.value > definition.maximum) throw new Error('指标数值异常，请核对数值及单位；此范围不是健康诊断标准。');
  if (input.unit !== definition.unit) throw new Error(`此指标必须使用${definition.unit}。`);
  if (input.metric === 'steps' && !Number.isInteger(input.value)) throw new Error('步数必须为整数。');
  const measured_date = checkedDate(input.measured_date ?? today(), '测量日期');
  if (measured_date > today()) throw new Error('测量事实不能记录在未来，请改用计划。');
  const measuredTime = input.measured_time ?? '';
  if (measuredTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(measuredTime)) throw new Error('测量时间应为HH:MM（本地Asia/Shanghai）或留空。');
  return { metric: input.metric, value: input.value, unit: definition.unit, measured_date, measured_time: measuredTime, method: input.method ? checkedText(input.method, '测量口径', 160) : '', note: input.note ? checkedText(input.note, '备注', 300) : '', cloud_allowed: input.cloud_allowed === true };
}

export function validatePlan(input) {
  const kind = enumValue(input.kind ?? 'task', ['goal', 'milestone', 'task', 'job'], '计划类型');
  return {
    domain: enumValue(input.domain, DOMAINS, '领域'), kind,
    title: checkedText(input.title, '标题', 160),
    status: enumValue(input.status ?? 'planned', kind === 'job' ? JOB_STATUSES : PLAN_STATUSES, '阶段状态'),
    next_action: input.next_action ? checkedText(input.next_action, '下一步', 600) : '',
    due_date: input.due_date ? checkedDate(input.due_date, '复盘或截止日期') : '',
    detail: input.detail ? checkedText(input.detail, '说明', 1200) : '',
    parent_id: input.parent_id ? checkedText(input.parent_id, '所属目标', 100) : null,
    cloud_allowed: input.domain !== 'relationships' && input.cloud_allowed === true,
  };
}

function memoryRow(row) {
  return row ? { ...row, cloud_allowed: Boolean(row.cloud_allowed), is_current: Boolean(row.is_current) } : null;
}

export class LifeStore {
  constructor(workspace) {
    this.workspace = path.resolve(workspace);
    mkdirSync(path.join(this.workspace, 'data'), { recursive: true });
    this.filename = path.join(this.workspace, 'data', 'personal.sqlite');
    this.database = new DatabaseSync(this.filename);
    if (this.database.prepare('PRAGMA user_version').get().user_version > SCHEMA_VERSION) { this.database.close(); throw new Error('数据库版本较新，请使用新版生活助手，不能降级写入。'); }
    this.database.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      PRAGMA foreign_keys=ON;
      PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS memory (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
        domain TEXT NOT NULL, key TEXT NOT NULL, kind TEXT NOT NULL,
        value TEXT NOT NULL, unit TEXT NOT NULL, effective_date TEXT NOT NULL,
        source TEXT NOT NULL, sensitivity TEXT NOT NULL, cloud_allowed INTEGER NOT NULL,
        is_current INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS memory_current ON memory(domain,key,kind) WHERE is_current=1;
      CREATE TABLE IF NOT EXISTS metrics (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
        metric TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL,
        measured_date TEXT NOT NULL, note TEXT NOT NULL, cloud_allowed INTEGER NOT NULL,
        correction_of TEXT, is_current INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY, domain TEXT NOT NULL, kind TEXT NOT NULL,
        title TEXT NOT NULL, status TEXT NOT NULL, next_action TEXT NOT NULL,
        due_date TEXT NOT NULL, detail TEXT NOT NULL, cloud_allowed INTEGER NOT NULL,
        revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit (
        id TEXT PRIMARY KEY, entity TEXT NOT NULL, action TEXT NOT NULL,
        reference TEXT NOT NULL, session_id TEXT NOT NULL, recorded_at TEXT NOT NULL
      );
    `);
    const metricColumns = this.database.prepare('PRAGMA table_info(metrics)').all().map(column => column.name);
    if (!metricColumns.includes('measured_time')) this.database.exec("ALTER TABLE metrics ADD COLUMN measured_time TEXT NOT NULL DEFAULT ''");
    if (!metricColumns.includes('method')) this.database.exec("ALTER TABLE metrics ADD COLUMN method TEXT NOT NULL DEFAULT ''");
    this.database.exec('CREATE INDEX IF NOT EXISTS metrics_date ON metrics(metric,measured_date,is_current)');
    try { this.migrate(); } catch (error) { this.database.close(); throw error; }
  }

  migrate() {
    const version = this.database.prepare('PRAGMA user_version').get().user_version;
    if (version > SCHEMA_VERSION) throw new Error('数据库版本较新，请使用新版生活助手，不能降级写入。');
    if (version === SCHEMA_VERSION) return;
    const populated = ['metrics', 'memory', 'plans'].some(table => this.database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get());
    if (populated) {
      mkdirSync(path.join(this.workspace, 'backups'), { recursive: true });
      this.backupTo(path.join(this.workspace, 'backups', `pre-schema-v${SCHEMA_VERSION}-${randomUUID()}.sqlite`));
    }
    this.transaction(() => {
      const columns = this.database.prepare('PRAGMA table_info(metrics)').all().map(column => column.name);
      if (!columns.includes('record_id')) this.database.exec('ALTER TABLE metrics ADD COLUMN record_id TEXT');
      if (!columns.includes('revision')) this.database.exec('ALTER TABLE metrics ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
      if (!columns.includes('batch_id')) this.database.exec('ALTER TABLE metrics ADD COLUMN batch_id TEXT');
      this.database.exec('CREATE TABLE IF NOT EXISTS metric_batches(id TEXT PRIMARY KEY, created_at TEXT NOT NULL, source TEXT NOT NULL)');
      const rows = this.database.prepare('SELECT id,correction_of,created_at,record_id FROM metrics ORDER BY sequence').all();
      const versions = new Map();
      for (const row of rows) {
        const previous = row.correction_of ? versions.get(row.correction_of) : null;
        if (row.correction_of && !previous) throw new Error('历史测量更正链损坏，迁移已回滚，请检查备份。');
        const record = { record_id: previous?.record_id ?? row.id, revision: (previous?.revision ?? 0) + 1, batch_id: previous?.batch_id ?? row.id };
        versions.set(row.id, record);
        this.database.prepare('INSERT OR IGNORE INTO metric_batches VALUES (?,?,?)').run(record.batch_id, row.created_at, '历史迁移');
        this.database.prepare('UPDATE metrics SET record_id=?,revision=?,batch_id=? WHERE id=?').run(record.record_id, record.revision, record.batch_id, row.id);
      }
      const planColumns = this.database.prepare('PRAGMA table_info(plans)').all().map(column => column.name);
      if (!planColumns.includes('parent_id')) this.database.exec('ALTER TABLE plans ADD COLUMN parent_id TEXT REFERENCES plans(id) ON DELETE RESTRICT');
      this.database.exec(`CREATE TABLE IF NOT EXISTS plan_versions (
        id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, domain TEXT NOT NULL, kind TEXT NOT NULL,
        title TEXT NOT NULL, status TEXT NOT NULL, next_action TEXT NOT NULL, due_date TEXT NOT NULL,
        detail TEXT NOT NULL, parent_id TEXT, cloud_allowed INTEGER NOT NULL, recorded_at TEXT NOT NULL,
        UNIQUE(plan_id,revision)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS metric_current_identity ON metrics(record_id) WHERE is_current=1;
      CREATE UNIQUE INDEX IF NOT EXISTS metric_versions ON metrics(record_id,revision);
      CREATE INDEX IF NOT EXISTS metric_recent ON metrics(metric,is_current,measured_date DESC,measured_time DESC,sequence DESC);
      CREATE INDEX IF NOT EXISTS plan_parent ON plans(parent_id);
      CREATE INDEX IF NOT EXISTS plan_due ON plans(status,due_date);
      CREATE INDEX IF NOT EXISTS memory_history ON memory(domain,key,kind,sequence DESC);`);
      for (const plan of this.database.prepare('SELECT * FROM plans').all()) this.recordPlanVersion(plan);
      this.database.exec(`CREATE TABLE IF NOT EXISTS training_sessions (
        id TEXT PRIMARY KEY, date TEXT NOT NULL, focus TEXT NOT NULL,
        plan_json TEXT NOT NULL, actual_json TEXT, status TEXT NOT NULL,
        cloud_allowed INTEGER NOT NULL, revision INTEGER NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(date,focus)
      );
      CREATE TABLE IF NOT EXISTS training_versions (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, status TEXT NOT NULL, actual_json TEXT,
        cloud_allowed INTEGER NOT NULL, recorded_at TEXT NOT NULL,
        UNIQUE(session_id,revision)
      );
      CREATE INDEX IF NOT EXISTS training_recent ON training_sessions(date DESC,updated_at DESC);`);
      this.database.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
    });
  }

  recordPlanVersion(plan) {
    this.database.prepare('INSERT OR IGNORE INTO plan_versions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), plan.id, plan.revision, plan.domain, plan.kind, plan.title, plan.status, plan.next_action, plan.due_date, plan.detail, plan.parent_id ?? null, Number(plan.cloud_allowed), plan.updated_at);
  }

  close() { this.database.close(); }

  transaction(callback) {
    this.database.exec('BEGIN IMMEDIATE');
    try { const result = callback(); this.database.exec('COMMIT'); return result; }
    catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }

  audit(entity, action, reference, session = '') {
    this.database.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?)').run(randomUUID(), entity, action, reference, session, new Date().toISOString());
  }

  currentMemory(domain, key, kind) {
    return memoryRow(this.database.prepare('SELECT * FROM memory WHERE domain=? AND key=? AND kind=? AND is_current=1').get(domain, key, kind));
  }

  listMemory({ domain, key, history = false, cloudOnly = false, limit = 40 } = {}) {
    const predicates = []; const values = [];
    if (domain) { enumValue(domain, DOMAINS, '领域'); predicates.push('domain=?'); values.push(domain); }
    if (key) { predicates.push('key=?'); values.push(key); }
    if (!history) predicates.push('is_current=1');
    if (cloudOnly) predicates.push('cloud_allowed=1');
    const rows = this.database.prepare(`SELECT * FROM memory ${predicates.length ? `WHERE ${predicates.join(' AND ')}` : ''} ORDER BY sequence DESC LIMIT ?`).all(...values, Math.min(Math.max(limit, 1), 100));
    return rows.map(memoryRow);
  }

  remember(input, session = '', expectedId) {
    const item = validateMemory(input);
    return this.transaction(() => {
      const previous = this.currentMemory(item.domain, item.key, item.kind);
      if (expectedId !== undefined && (previous?.id ?? null) !== expectedId) throw new Error('确认期间资料已被另一会话更新，请重新读取后确认。');
      if (previous && item.effective_date < previous.effective_date) throw new Error('旧日期不能覆盖最新状态；请核对日期或保留历史记录。');
      const id = randomUUID();
      this.database.prepare('UPDATE memory SET is_current=0 WHERE domain=? AND key=? AND kind=?').run(item.domain, item.key, item.kind);
      if (!item.cloud_allowed) this.database.prepare('UPDATE memory SET cloud_allowed=0 WHERE domain=? AND key=? AND kind=?').run(item.domain, item.key, item.kind);
      this.database.prepare('INSERT INTO memory(id,domain,key,kind,value,unit,effective_date,source,sensitivity,cloud_allowed,is_current,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)').run(id, item.domain, item.key, item.kind, item.value, item.unit, item.effective_date, item.source, item.sensitivity, Number(item.cloud_allowed), new Date().toISOString());
      this.audit('memory', previous ? 'update' : 'add', `${item.domain}/${item.key}/${item.kind}`, session);
      return this.currentMemory(item.domain, item.key, item.kind);
    });
  }

  addMetric(input, session = '') {
    return this.addMetrics([input], session)[0];
  }

  addMetrics(inputs, session = '') {
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 100) throw new Error('一次可记录1—100项测量。');
    const items = inputs.map(input => ({ ...validateMetric(input), correction_of: input.correction_of }));
    return this.transaction(() => {
      const batchId = randomUUID();
      this.database.prepare('INSERT INTO metric_batches VALUES (?,?,?)').run(batchId, new Date().toISOString(), '用户确认');
      const saved = items.map(item => {
        const previous = item.correction_of ? this.database.prepare('SELECT * FROM metrics WHERE id=? AND is_current=1').get(item.correction_of) : null;
        if (item.correction_of && !previous) throw new Error('更正对象不存在或已经被更正。');
        if (previous && previous.metric !== item.metric) throw new Error('更正应对应同一天测量事件的同一指标；指标类型不能修改，新的测量请另行记录。');
        if (previous) this.database.prepare('UPDATE metrics SET is_current=0 WHERE id=?').run(previous.id);
        if (previous && !item.cloud_allowed) this.database.prepare('UPDATE metrics SET cloud_allowed=0 WHERE record_id=?').run(previous.record_id);
        const id = randomUUID();
        const recordId = previous?.record_id ?? id;
        const revision = (previous?.revision ?? 0) + 1;
        const group = previous?.batch_id ?? batchId;
        this.database.prepare('INSERT INTO metrics(id,metric,value,unit,measured_date,measured_time,method,note,cloud_allowed,correction_of,is_current,created_at,record_id,revision,batch_id) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)').run(id, item.metric, item.value, item.unit, item.measured_date, item.measured_time, item.method, item.note, Number(item.cloud_allowed), previous?.id ?? null, new Date().toISOString(), recordId, revision, group);
        this.audit('metric', previous ? 'correct' : 'add', item.metric, session);
        return { id, ...item, correction_of: previous?.id ?? null, record_id: recordId, revision, batch_id: group };
      });
      this.database.prepare('DELETE FROM metric_batches WHERE id NOT IN (SELECT batch_id FROM metrics)').run();
      return saved;
    });
  }

  metric(id) { return this.database.prepare('SELECT * FROM metrics WHERE id=?').get(id) ?? null; }

  metricHistory(recordId) { return this.database.prepare('SELECT * FROM metrics WHERE record_id=? ORDER BY revision DESC').all(recordId).map(row => ({ ...row, cloud_allowed: Boolean(row.cloud_allowed), is_current: Boolean(row.is_current) })); }

  metricDuplicates(items) {
    return items.flatMap(item => this.database.prepare('SELECT * FROM metrics WHERE is_current=1 AND metric=? AND measured_date=? AND value=? AND measured_time=? AND method=?').all(item.metric, item.measured_date, item.value, item.measured_time, item.method));
  }

  latestMetrics() {
    return Object.fromEntries(Object.keys(METRICS).map(metric => [metric, this.listMetrics({ metric, limit: 1 })[0] ?? null]));
  }

  listMetrics({ metric, history = false, cloudOnly = false, limit = 30, offset = 0, start_date, end_date } = {}) {
    const predicates = []; const values = [];
    if (metric) { if (!METRICS[metric]) throw new Error('不支持此指标。'); predicates.push('metric=?'); values.push(metric); }
    if (!history) predicates.push('is_current=1');
    if (cloudOnly) predicates.push('cloud_allowed=1');
    if (start_date) { predicates.push('measured_date>=?'); values.push(checkedDate(start_date)); }
    if (end_date) { predicates.push('measured_date<=?'); values.push(checkedDate(end_date)); }
    if (start_date && end_date && start_date > end_date) throw new Error('开始日期不能晚于结束日期。');
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('分页offset应为非负整数，limit为1—500。');
    return this.database.prepare(`SELECT * FROM metrics ${predicates.length ? `WHERE ${predicates.join(' AND ')}` : ''} ORDER BY measured_date DESC,measured_time DESC,sequence DESC LIMIT ? OFFSET ?`).all(...values, limit, offset).map(row => ({ ...row, cloud_allowed: Boolean(row.cloud_allowed), is_current: Boolean(row.is_current) }));
  }

  metricSeries({ metric, start_date, end_date, cloudOnly = false }) {
    if (!METRICS[metric]) throw new Error('不支持此指标。');
    const predicates = ['metric=?', 'is_current=1']; const values = [metric];
    if (start_date) { predicates.push('measured_date>=?'); values.push(checkedDate(start_date)); }
    if (end_date) { predicates.push('measured_date<=?'); values.push(checkedDate(end_date)); }
    if (start_date && end_date && start_date > end_date) throw new Error('开始日期不能晚于结束日期。');
    if (cloudOnly) predicates.push('cloud_allowed=1');
    const rows = this.database.prepare(`SELECT * FROM metrics WHERE ${predicates.join(' AND ')} ORDER BY measured_date,measured_time,sequence`).all(...values);
    if (rows.length > 20000) throw new Error('此范围超过20000条有效测量，请缩小日期范围；不会静默截断。');
    return rows.map(row => ({ ...row, cloud_allowed: Boolean(row.cloud_allowed), is_current: true }));
  }

  plan(id) { return this.database.prepare('SELECT * FROM plans WHERE id=?').get(id) ?? null; }

  validatePlanRelations(item, id) {
    const parent = item.parent_id ? this.plan(item.parent_id) : null;
    if (item.parent_id && (!parent || parent.domain !== item.domain || !PLAN_PARENT_KINDS[item.kind].includes(parent.kind) || parent.id === id)) throw new Error('所属目标不存在、领域不同或层级不合理。目标→里程碑→行动；求职机会独立管理。');
    let ancestor = parent;
    while (ancestor) {
      if (ancestor.status === 'done' && item.status !== 'done') throw new Error('上级已经完成，请先把上级改回进行中，再新增或重启下级。');
      ancestor = ancestor.parent_id ? this.plan(ancestor.parent_id) : null;
    }
    const children = this.database.prepare('SELECT kind,domain FROM plans WHERE parent_id=?').all(id ?? '');
    if (children.some(child => child.domain !== item.domain || !PLAN_PARENT_KINDS[child.kind].includes(item.kind))) throw new Error('此项有下级计划，不能修改为不匹配的领域或类型。');
    if (item.status === 'done' && this.database.prepare("SELECT 1 FROM plans WHERE parent_id=? AND status!='done' LIMIT 1").get(id ?? '')) throw new Error('还有未完成的下级计划，请先完成或调整下级计划。');
  }

  savePlan(input, session = '', expectedRevision, { uniqueDaily = false } = {}) {
    return this.transaction(() => {
      const previous = input.id ? this.plan(input.id) : null;
      const item = validatePlan({ ...input, parent_id: input.parent_id === undefined ? previous?.parent_id : input.parent_id });
      if (uniqueDaily && this.database.prepare('SELECT id FROM plans WHERE domain=? AND kind=? AND due_date=? AND title=?').get(item.domain, item.kind, item.due_date, item.title)) throw new Error('这份今日训练已加入行动，请查看已有计划。');
      if (input.id && !previous) throw new Error('计划不存在。');
      if (previous && expectedRevision !== undefined && previous.revision !== expectedRevision) throw new Error('计划已由另一会话更新，请重新确认。');
      const id = previous?.id ?? randomUUID();
      this.validatePlanRelations(item, id);
      const timestamp = new Date().toISOString();
      this.database.prepare(`INSERT INTO plans(id,domain,kind,title,status,next_action,due_date,detail,cloud_allowed,revision,created_at,updated_at,parent_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET domain=excluded.domain,kind=excluded.kind,title=excluded.title,status=excluded.status,next_action=excluded.next_action,due_date=excluded.due_date,detail=excluded.detail,cloud_allowed=excluded.cloud_allowed,revision=excluded.revision,updated_at=excluded.updated_at,parent_id=excluded.parent_id`).run(id, item.domain, item.kind, item.title, item.status, item.next_action, item.due_date, item.detail, Number(item.cloud_allowed), (previous?.revision ?? 0) + 1, previous?.created_at ?? timestamp, timestamp, item.parent_id);
      if (!item.cloud_allowed) this.database.prepare('UPDATE plan_versions SET cloud_allowed=0 WHERE plan_id=?').run(id);
      this.recordPlanVersion(this.plan(id));
      this.audit('plan', previous ? 'update' : 'add', id, session);
      return this.plan(id);
    });
  }

  listPlans({ domain, cloudOnly = false, limit = 30, offset = 0 } = {}) {
    const predicates = []; const values = [];
    if (domain) { enumValue(domain, DOMAINS, '领域'); predicates.push('domain=?'); values.push(domain); }
    if (cloudOnly) predicates.push('cloud_allowed=1');
    if (!Number.isInteger(offset) || offset < 0) throw new Error('分页offset无效。');
    return this.database.prepare(`SELECT * FROM plans ${predicates.length ? `WHERE ${predicates.join(' AND ')}` : ''} ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?`).all(...values, Math.min(Math.max(limit, 1), 100), offset).map(row => ({ ...row, cloud_allowed: Boolean(row.cloud_allowed) }));
  }

  training(id, { cloudOnly = false } = {}) {
    const row = this.database.prepare(`SELECT * FROM training_sessions WHERE id=? ${cloudOnly ? 'AND cloud_allowed=1' : ''}`).get(id);
    return row ? { id: row.id, date: row.date, focus: row.focus, plan: JSON.parse(row.plan_json), actual: row.actual_json ? JSON.parse(row.actual_json) : null, status: row.status, revision: row.revision, cloud_allowed: Boolean(row.cloud_allowed), created_at: row.created_at, updated_at: row.updated_at } : null;
  }

  listTraining({ cloudOnly = false, limit = 20, offset = 0, focus } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new Error('训练记录分页无效。');
    if (focus && !['full_body', 'chest', 'back', 'legs', 'shoulders', 'arms', 'core'].includes(focus)) throw new Error('训练部位无效。');
    const predicates = []; const values = [];
    if (cloudOnly) predicates.push('cloud_allowed=1');
    if (focus && focus !== 'full_body') { predicates.push("(focus=? OR focus='full_body' OR EXISTS (SELECT 1 FROM json_each(training_sessions.plan_json, '$.focuses') WHERE value=?) OR EXISTS (SELECT 1 FROM json_each(training_sessions.actual_json, '$.entries') entry WHERE json_extract(entry.value, '$.focus') IN (?, 'full_body') OR EXISTS (SELECT 1 FROM json_each(entry.value, '$.focuses') WHERE value IN (?, 'full_body'))))"); values.push(focus, focus, focus, focus); }
    const rows = this.database.prepare(`SELECT id FROM training_sessions ${predicates.length ? `WHERE ${predicates.join(' AND ')}` : ''} ORDER BY date DESC,updated_at DESC LIMIT ? OFFSET ?`).all(...values, limit, offset);
    return rows.map(row => this.training(row.id, { cloudOnly }));
  }

  saveTraining(plan, session = '') {
    if (!plan?.can_save || typeof plan.focus !== 'string' || !Array.isArray(plan.exercises) || plan.date !== today()) throw new Error('训练计划已过期或不适合保存，请重新生成。');
    return this.transaction(() => {
      if (this.database.prepare('SELECT id FROM training_sessions WHERE date=?').get(plan.date)) throw new Error('今日已经有训练计划，请在一份计划中组合要练的部位。');
      const id = randomUUID(); const timestamp = new Date().toISOString();
      this.database.prepare('INSERT INTO training_sessions VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, plan.date, plan.focus, JSON.stringify(plan), null, 'planned', 0, 1, timestamp, timestamp);
      this.database.prepare('INSERT INTO training_versions VALUES (?,?,?,?,?,?,?)').run(randomUUID(), id, 1, 'planned', null, 0, timestamp);
      this.audit('training', 'add', id, session);
      return this.training(id);
    });
  }

  saveTrainingLog(id, actual, expectedRevision, session = '') {
    return this.transaction(() => {
      const previous = this.training(id);
      if (!previous || previous.revision !== expectedRevision) throw new Error('训练记录已改变，请重新打开后核对。');
      const validated = validateTrainingLog({ ...actual, ...(previous.actual?.independent ? { independent: true } : {}), ...(previous.actual?.source ? { source: previous.actual.source } : {}) }, previous.plan);
      const recovery = retainedTrainingRecovery(previous.plan, previous.actual, validated);
      if (recovery) validated.recovery = recovery;
      const timestamp = new Date().toISOString();
      this.database.prepare('UPDATE training_sessions SET actual_json=?,status=?,cloud_allowed=?,revision=revision+1,updated_at=? WHERE id=?').run(JSON.stringify(validated), validated.status, Number(validated.cloud_allowed), timestamp, id);
      if (!validated.cloud_allowed) this.database.prepare('UPDATE training_versions SET cloud_allowed=0 WHERE session_id=?').run(id);
      this.database.prepare('INSERT INTO training_versions VALUES (?,?,?,?,?,?,?)').run(randomUUID(), id, previous.revision + 1, validated.status, JSON.stringify(validated), Number(validated.cloud_allowed), timestamp);
      this.audit('training', 'update', id, session);
      return this.training(id);
    });
  }

  trainingOnDate(date) {
    const rows = this.database.prepare('SELECT id FROM training_sessions WHERE date=?').all(date);
    if (rows.length > 1) throw new Error(`${date}有多份旧训练计划，请先在历史记录中整理，不能自动选择覆盖。`);
    return rows.length ? this.training(rows[0].id) : null;
  }

  saveTrainingRecords(records, { cloudAllowed = false, source = '手动录入', expected } = {}, session = '') {
    const items = validateTrainingRecords(records, { cloudAllowed, source });
    return this.transaction(() => items.map((item, index) => {
      const previous = this.trainingOnDate(item.date);
      if (expected && (expected[index]?.id !== (previous?.id ?? null) || expected[index]?.revision !== (previous?.revision ?? null))) throw new Error(`${item.date}的记录在核对期间已改变，请重新核对。`);
      if (previous?.actual) throw new Error(`${item.date}已有实际训练，可能重复导入；请使用“更正实际训练”，不会覆盖或重复累计。`);
      const id = previous?.id ?? randomUUID(); const timestamp = new Date().toISOString();
      const revision = (previous?.revision ?? 0) + 1;
      const json = JSON.stringify(item.actual);
      if (previous) this.database.prepare('UPDATE training_sessions SET actual_json=?,status=?,cloud_allowed=?,revision=?,updated_at=? WHERE id=?').run(json, 'completed', Number(item.actual.cloud_allowed), revision, timestamp, id);
      else this.database.prepare('INSERT INTO training_sessions VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, item.date, item.plan.focus, JSON.stringify(item.plan), json, 'completed', Number(item.actual.cloud_allowed), revision, timestamp, timestamp);
      this.database.prepare('INSERT INTO training_versions VALUES (?,?,?,?,?,?,?)').run(randomUUID(), id, revision, 'completed', json, Number(item.actual.cloud_allowed), timestamp);
      this.audit('training', 'import', id, session);
      return this.training(id);
    }));
  }

  saveTrainingRecovery(id, feedback, expectedRevision, session = '', asOfDate = today()) {
    return this.transaction(() => {
      const previous = this.training(id);
      if (!previous || previous.revision !== expectedRevision) throw new Error('训练记录已改变，请重新打开后核对。');
      if (!['completed', 'partial'].includes(previous.status)) throw new Error('请先记录实际训练，再于次日记录疲劳和酸痛。');
      const recovery = validateTrainingRecovery(feedback, previous.plan, previous.date, asOfDate, previous.actual);
      const actual = { ...previous.actual, recovery, cloud_allowed: feedback.cloud_allowed === true };
      const timestamp = new Date().toISOString();
      this.database.prepare('UPDATE training_sessions SET actual_json=?,cloud_allowed=?,revision=revision+1,updated_at=? WHERE id=?').run(JSON.stringify(actual), Number(actual.cloud_allowed), timestamp, id);
      if (!actual.cloud_allowed) this.database.prepare('UPDATE training_versions SET cloud_allowed=0 WHERE session_id=?').run(id);
      this.database.prepare('INSERT INTO training_versions VALUES (?,?,?,?,?,?,?)').run(randomUUID(), id, previous.revision + 1, previous.status, JSON.stringify(actual), Number(actual.cloud_allowed), timestamp);
      this.audit('training', 'recovery', id, session);
      return this.training(id);
    });
  }

  trainingHistory(id) {
    if (!this.training(id)) return [];
    return this.database.prepare('SELECT revision,status,actual_json,cloud_allowed,recorded_at FROM training_versions WHERE session_id=? ORDER BY revision DESC').all(id).map(row => ({ revision: row.revision, status: row.status, actual: row.actual_json ? JSON.parse(row.actual_json) : null, cloud_allowed: Boolean(row.cloud_allowed), recorded_at: row.recorded_at }));
  }

  deleteTraining(id, expectedRevision, session = '') {
    return this.transaction(() => {
      const previous = this.training(id);
      if (!previous || previous.revision !== expectedRevision) throw new Error('训练记录已改变，请重新打开后核对。');
      this.database.prepare('DELETE FROM training_sessions WHERE id=?').run(id);
      this.database.prepare('DELETE FROM audit WHERE entity=? AND reference=?').run('training', id);
      this.audit('training', 'forget', 'redacted', session);
      return true;
    });
  }

  planHistory(id, cloudOnly = false) { return this.database.prepare(`SELECT * FROM plan_versions WHERE plan_id=? ${cloudOnly ? 'AND cloud_allowed=1' : ''} ORDER BY revision DESC`).all(id); }

  dashboardSummary() {
    const pending = this.database.prepare("SELECT count(*) count FROM plans WHERE kind='task' AND status IN ('planned','active')").get().count;
    const overdue = this.database.prepare("SELECT count(*) count FROM plans WHERE kind='task' AND status IN ('planned','active') AND due_date!='' AND due_date<?").get(today()).count;
    const next = this.database.prepare("SELECT * FROM plans WHERE kind='task' AND status IN ('planned','active') ORDER BY CASE WHEN due_date='' THEN 1 ELSE 0 END,due_date,updated_at DESC LIMIT 3").all();
    return { pending_tasks: Number(pending), overdue_tasks: Number(overdue), next_actions: next };
  }

  forgetMemory(domain, key, kind, session = '') {
    enumValue(domain, DOMAINS, '领域'); enumValue(kind, KINDS, '信息类型');
    const count = this.transaction(() => {
      const result = this.database.prepare('DELETE FROM memory WHERE domain=? AND key=? AND kind=?').run(domain, key, kind);
      this.database.prepare('DELETE FROM audit WHERE entity=? AND reference=?').run('memory', `${domain}/${key}/${kind}`);
      this.audit('memory', 'forget', 'redacted', session);
      return Number(result.changes);
    });
    this.database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return count;
  }

  deleteMetric(id, session = '') {
    const item = this.database.prepare('SELECT * FROM metrics WHERE id=?').get(id);
    if (!item) throw new Error('指标记录不存在。');
    const ids = new Set(this.metricHistory(item.record_id).map(row => row.id));
    this.transaction(() => {
      for (const candidate of ids) this.database.prepare('DELETE FROM metrics WHERE id=?').run(candidate);
      this.database.prepare('DELETE FROM metric_batches WHERE id NOT IN (SELECT batch_id FROM metrics)').run();
      this.audit('metric', 'forget', 'redacted', session);
    });
    this.database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return ids.size;
  }

  deletePlan(id, session = '') {
    const count = this.transaction(() => {
      if (this.database.prepare('SELECT 1 FROM plans WHERE parent_id=? LIMIT 1').get(id)) throw new Error('此项还有下级计划，请先调整下级的所属目标，再删除。');
      const result = this.database.prepare('DELETE FROM plans WHERE id=?').run(id);
      this.database.prepare('DELETE FROM audit WHERE entity=? AND reference=?').run('plan', id);
      this.audit('plan', 'forget', 'redacted', session);
      return Number(result.changes);
    });
    this.database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return count;
  }

  exportData() {
    return { format: 'pi-life-v3', schema_version: SCHEMA_VERSION, exported_at: new Date().toISOString(), memory: this.database.prepare('SELECT * FROM memory ORDER BY sequence').all().map(memoryRow), metrics: this.database.prepare('SELECT * FROM metrics ORDER BY sequence').all(), metric_batches: this.database.prepare('SELECT * FROM metric_batches ORDER BY created_at').all(), plans: this.database.prepare('SELECT * FROM plans ORDER BY updated_at').all(), plan_versions: this.database.prepare('SELECT * FROM plan_versions ORDER BY recorded_at').all(), training_sessions: this.database.prepare('SELECT * FROM training_sessions ORDER BY date,created_at').all(), training_versions: this.database.prepare('SELECT * FROM training_versions ORDER BY recorded_at').all() };
  }

  backupTo(filename) {
    this.database.prepare('VACUUM INTO ?').run(filename);
    return filename;
  }

  counts() {
    return Object.fromEntries(['memory', 'metrics', 'plans'].map(table => [table, Number(this.database.prepare(`SELECT count(*) count FROM ${table}`).get().count)]));
  }
}

export function relevantDomains(prompt) {
  const domains = new Set(['general']);
  if (/我的资料|个人档案|个人信息|记得我|我的现状|整体规划|人生规划|对我.*了解|我.*什么.*阶段/.test(prompt)) return [...DOMAINS];
  if (/工作|岗位|职业|求职|面试|简历|跳槽|薪资|实习|毕业|career|interview|job|offer/i.test(prompt)) domains.add('career');
  if (/钱|理财|投资|退休|基金|买房|买车|收入|工资|finance|salary/i.test(prompt)) domains.add('finance');
  if (/学习|论文|研究|阅读|复习|考试|课程|算法|study|paper/i.test(prompt)) domains.add('learning');
  if (/锻炼|运动|体重|体测|减脂|减重|增肌|健身|身体|睡眠|腰围|体脂|步数|心率|训练|fitness|weight|sleep|steps|\bkg\b|\bbpm\b/i.test(prompt)) domains.add('fitness');
  if (/情感|感情|恋爱|关系|情绪|家人|父母|孤独|难过|relationship/i.test(prompt)) domains.add('relationships');
  return [...domains];
}
