import csv
import html
import io
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.dates as dates
import matplotlib.pyplot as pyplot
from matplotlib.font_manager import FontProperties

payload = json.loads(sys.stdin.read(8_000_000))
directory = Path(sys.argv[1]).resolve()
basename = sys.argv[2]
if not basename.startswith('metrics-') or '/' in basename or '\\' in basename:
    raise ValueError('Invalid filename')
font_path = Path(os.environ.get('SYSTEMROOT', 'C:\\Windows')) / 'Fonts' / 'msyh.ttc'
font = FontProperties(fname=str(font_path)) if font_path.is_file() else FontProperties()
pyplot.rcParams['axes.unicode_minus'] = False
pyplot.rcParams['svg.fonttype'] = 'none'
panels = payload['panels']
figure, axes = pyplot.subplots(len(panels), 1, figsize=(11.8, 3.7 * len(panels) + 1.2), squeeze=False)
figure.set_facecolor('#f5f7fb')
colors = ['#2563eb', '#0d9488', '#9333ea']

def plot_series(axis, points, color, label, marker=None, dotted=False):
    plotted_dates = []
    plotted_values = []
    previous = None
    for point in points:
        observed = datetime.strptime(point['date'] + ' ' + (point.get('time') or '12:00'), '%Y-%m-%d %H:%M')
        if previous and (observed.date() - previous.date()).days > 1:
            plotted_dates.append(previous + timedelta(seconds=1))
            plotted_values.append(float('nan'))
        plotted_dates.append(observed)
        plotted_values.append(point['value'] if point['value'] is not None else float('nan'))
        previous = observed
    axis.plot(plotted_dates, plotted_values, color=color, linewidth=1.8, marker=marker, markersize=4, linestyle='--' if dotted else '-', label=label)

for index, panel in enumerate(panels):
    axis = axes[index][0]
    axis.set_facecolor('white')
    axis.set_title(f"{panel['label']} · {panel['unit']}", fontproperties=font, loc='left', fontsize=13, pad=12)
    if panel['points']:
        if payload['aggregation'] == 'daily':
            raw_dates = [datetime.strptime(point['date'] + ' 12:00', '%Y-%m-%d %H:%M') for point in panel['raw_points']]
            axis.scatter(raw_dates, [point['value'] for point in panel['raw_points']], color='#94a3b8', s=14, alpha=.65, label='各次原始测量')
        plot_series(axis, panel['points'], colors[index], panel.get('daily_label', '每日均值点') if payload['aggregation'] == 'daily' else '原始测量点', 'o')
        if panel['averages']:
            plot_series(axis, panel['averages'], '#f59e0b', '7个日历日内已观测日均值的均值', dotted=True)
        summary = panel['summary']
        annotation = f"有效记录 {summary['records']} 条 / 观测 {summary['days']} 天 / 缺测 {panel['missing_days']} 天"
        if len(summary['methods']) > 1:
            annotation += ' · 多种测量口径，谨慎比较'
        if len(panel['points']) == 1:
            annotation += ' · 单点不能判断趋势'
        axis.text(1, 1.03, annotation, transform=axis.transAxes, ha='right', fontsize=9, color='#475569', fontproperties=font)
        locator = dates.AutoDateLocator(minticks=3, maxticks=9)
        axis.xaxis.set_major_locator(locator)
        axis.xaxis.set_major_formatter(dates.DateFormatter('%Y-%m-%d'))
        axis.legend(prop=font, fontsize=8, loc='best')
    else:
        axis.text(.5, .5, '此指标在范围内没有记录', ha='center', va='center', transform=axis.transAxes, fontproperties=font)
    axis.set_ylabel(panel['unit'], fontproperties=font)
    axis.grid(True, color='#e2e8f0', alpha=.8)
    for spine in axis.spines.values():
        spine.set_color('#cbd5e1')
    axis.tick_params(axis='x', labelrotation=15, labelsize=8)

figure.suptitle(payload['title'], fontproperties=font, fontsize=18, color='#0f172a')
figure.text(.5, .025, f"{payload['scope']} · {payload['generated_date']}\n缺测不补零；间隔超过一天断线；滚动均值不预测未来；不是医学诊断。", ha='center', fontproperties=font, fontsize=9, color='#475569')
figure.tight_layout(rect=(0, .07, 1, .96), h_pad=2.8)
files = {extension: str(directory / f'{basename}.{extension}') for extension in ['png', 'svg', 'html', 'csv']}
files['raw_csv'] = str(directory / f'{basename}-raw.csv')
figure.savefig(files['png'], dpi=150, facecolor=figure.get_facecolor())
figure.savefig(files['svg'], facecolor=figure.get_facecolor())
pyplot.close(figure)

with open(files['csv'], 'w', encoding='utf-8-sig', newline='') as output:
    writer = csv.writer(output)
    writer.writerow(['指标', '日期', '时间', '数值', '单位', '测量次数', '统计口径'])
    for panel in panels:
        for point in panel['points']:
            writer.writerow([panel['label'], point['date'], point.get('time', ''), point['value'], panel['unit'], point['count'], panel.get('daily_label', '日均') if payload['aggregation'] == 'daily' else '原始测量'])

with open(files['raw_csv'], 'w', encoding='utf-8-sig', newline='') as output:
    writer = csv.writer(output)
    writer.writerow(['指标', '日期', '时间', '数值', '单位'])
    for panel in panels:
        for point in panel['raw_points']:
            writer.writerow([panel['label'], point['date'], point.get('time', ''), point['value'], panel['unit']])

sections = []
for panel in panels:
    rows = ''.join(f"<tr><td>{html.escape(point['date'])}</td><td>{html.escape(point.get('time', ''))}</td><td>{point['value']:.3f}</td><td>{point['count']}</td></tr>" for point in panel['points'])
    sections.append(f"<details><summary>{html.escape(panel['label'])}（{html.escape(panel['unit'])}）完整绘图数据</summary><table><thead><tr><th>日期</th><th>时间</th><th>数值</th><th>原始测量数</th></tr></thead><tbody>{rows}</tbody></table></details>")
svg = Path(files['svg']).read_text(encoding='utf-8')
svg = svg[svg.index('<svg'):]
document = f"""<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'"><title>个人指标趋势</title><style>body{{max-width:1100px;margin:24px auto;padding:0 16px;background:#f5f7fb;color:#0f172a;font-family:'Microsoft YaHei',sans-serif}}svg{{width:100%;height:auto}}details{{margin:16px 0;background:white;padding:16px;border-radius:12px}}table{{width:100%;border-collapse:collapse}}td,th{{padding:8px;text-align:left;border-bottom:1px solid #e2e8f0}}small{{color:#475569}}</style><h1>本地指标趋势</h1><small>{html.escape(payload['scope'])}。此页面完全离线，无外部脚本。图表不是医学诊断。</small>{svg}{''.join(sections)}</html>"""
Path(files['html']).write_text(document, encoding='utf-8')
print(json.dumps(files, ensure_ascii=False))
