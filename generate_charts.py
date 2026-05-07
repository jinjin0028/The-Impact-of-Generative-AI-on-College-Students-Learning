import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from scipy import stats
import os

# 设置中文字体
plt.rcParams['font.sans-serif'] = ['SimHei']
plt.rcParams['axes.unicode_minus'] = False

# 确保输出目录存在
output_dir = 'd:/003作业ppt/03第二学期下/商业数据管理/'
os.makedirs(output_dir, exist_ok=True)

print("加载数据...")
df = pd.read_csv('d:/003作业ppt/03第二学期下/商业数据管理/experiment_analysis_data.csv')
df_clean = df.dropna(subset=['node_growth', 'edge_growth']).copy()

print("\n执行 T 检验...")
group_a = df_clean[df_clean['group_type'] == 'A']
group_b = df_clean[df_clean['group_type'] == 'B']

t_stat_node, p_val_node = stats.ttest_ind(group_a['node_growth'], group_b['node_growth'])
t_stat_edge, p_val_edge = stats.ttest_ind(group_a['edge_growth'], group_b['edge_growth'])

print(f"Node Growth T-test: t = {t_stat_node:.4f}, p = {p_val_node:.4e}")
print(f"Edge Growth T-test: t = {t_stat_edge:.4f}, p = {p_val_edge:.4e}")

print("\n生成图表...")
fig, axes = plt.subplots(1, 2, figsize=(14, 6))

sns.boxplot(x='group_type', y='node_growth', data=df_clean, ax=axes[0], palette="Set2")
axes[0].set_title('A/B组 概念节点增量比较\n(t=%.2f, p=%.4e)' % (t_stat_node, p_val_node), fontsize=14)
axes[0].set_xlabel('实验组别 (A=控制组, B=高可解释性组)', fontsize=12)
axes[0].set_ylabel('节点增量', fontsize=12)

sns.boxplot(x='group_type', y='edge_growth', data=df_clean, ax=axes[1], palette="Set2")
axes[1].set_title('A/B组 概念关系连线增量比较\n(t=%.2f, p=%.4e)' % (t_stat_edge, p_val_edge), fontsize=14)
axes[1].set_xlabel('实验组别 (A=控制组, B=高可解释性组)', fontsize=12)
axes[1].set_ylabel('连线增量', fontsize=12)

plt.tight_layout()
chart_path = os.path.join(output_dir, 'analysis_charts.png')
plt.savefig(chart_path, dpi=300)
print(f"图表已保存至: {chart_path}")