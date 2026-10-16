export function projectFinances(input) {
  const annualReturn = input.annual_return;
  const inflation = input.annual_inflation ?? 0;
  const initial = input.initial_assets ?? 0;
  if (!Number.isFinite(annualReturn) || annualReturn <= -1 || annualReturn > 0.5) throw new Error('年化收益假设应大于-100%、不超过50%，用小数输入。');
  if (!Number.isFinite(inflation) || inflation < 0 || inflation > 0.2) throw new Error('通胀假设应在0—20%之间。');
  if (!Number.isFinite(initial) || initial < 0) throw new Error('初始资产不能为负。');
  if (!Array.isArray(input.phases) || !input.phases.length || input.phases.length > 12) throw new Error('请提供1—12个投入阶段。');
  let totalMonths = 0;
  const schedule = [];
  for (const phase of input.phases) {
    const months = phase.years * 12;
    if (!Number.isInteger(months) || months <= 0 || !Number.isFinite(phase.monthly_investment) || phase.monthly_investment < 0) throw new Error('阶段时长应为完整月份，月投入不能为负。');
    totalMonths += months;
    if (totalMonths > 720) throw new Error('最长测算60年。');
    for (let month = 0; month < months; month++) schedule.push(phase.monthly_investment);
  }
  const outflows = new Map();
  for (const item of input.outflows ?? []) {
    if (!Number.isInteger(item.month) || item.month < 1 || item.month > totalMonths || !Number.isFinite(item.amount) || item.amount < 0) throw new Error('大额支出的月份或金额无效。');
    outflows.set(item.month, (outflows.get(item.month) ?? 0) + item.amount);
  }
  const monthlyReturn = (1 + annualReturn) ** (1 / 12) - 1;
  let balance = initial; let invested = 0; let spent = 0;
  const checkpoints = [];
  for (let month = 1; month <= totalMonths; month++) {
    balance = balance * (1 + monthlyReturn) + schedule[month - 1];
    invested += schedule[month - 1];
    const expense = outflows.get(month) ?? 0;
    if (expense > balance) return { feasible: false, shortfall_month: month, available_assets: Math.round(balance), requested_outflow: expense, shortfall: Math.round(expense - balance), message: '现金不足，计算在此停止；没有把负资产继续复利。贷款或家庭支持须另外明确。' };
    balance -= expense; spent += expense;
    if (month % 12 === 0) checkpoints.push({ year: month / 12, assets: Math.round(balance), contributions: invested, outflows: spent });
  }
  const annualSpending = input.retirement_annual_spending ?? 0;
  if (!Number.isFinite(annualSpending) || annualSpending < 0) throw new Error('退休年度开支不能为负。');
  return {
    feasible: true, months: totalMonths, contributions: invested, outflows: spent,
    final_assets: Math.round(balance), investment_growth: Math.round(balance - initial - invested + spent),
    present_purchasing_power: Math.round(balance / (1 + inflation) ** (totalMonths / 12)),
    initial_withdrawal_ratio: balance > 0 ? annualSpending / balance : null,
    checkpoints,
    assumptions: { currency: 'CNY', deposit_timing: '每月月底', effective_annual_return: annualReturn, annual_inflation: inflation, retirement_spending_is_end_year_amount: true, constant_return_not_forecast: true, fees_taxes_fx_not_separately_modeled: true, excludes_future_salary_guarantees: true },
  };
}
