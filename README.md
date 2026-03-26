# LOF 套利智能筛选 Skill

> AI Agent Skill — 自动扫描全市场 LOF 基金溢价套利机会

[![agentskill.sh](https://img.shields.io/badge/agentskill.sh-LOF%20Arbitrage-blue)](https://agentskill.sh)

## 🎯 功能

- 📊 自动扫描 300+ 只 LOF 基金的溢价率
- 💰 扣除全部成本后计算净收益率
- ⭐ 智能评级（A/B/C/D）+ 明确操作建议
- 📈 多数据源采集（东方财富、新浪财经、天天基金）
- 🤖 零依赖独立运行，Node.js 18+ 即可

## 📦 安装

### CodeBuddy / Cursor / Windsurf / Claude Code

将本仓库的 `SKILL.md` 及相关文件放入项目的 `.codebuddy/skills/lof-arbitrage/` 目录即可。

### agentskill.sh

直接在 [agentskill.sh](https://agentskill.sh) 搜索 `lof-arbitrage` 安装。

## 🚀 使用

在 AI 编辑器中对 AI 说：

```
帮我构建一个 LOF 套利筛选工具
```

或

```
扫描当前市场的 LOF 基金套利机会
```

AI 将自动加载此 Skill，引导你完成完整的套利筛选系统搭建。

## 📂 Skill 结构

```
lof-arbitrage/
├── SKILL.md                        # Skill 主文件（架构、工作流、评级体系）
├── references/
│   ├── config-params.md            # 配置参数参考
│   ├── integration-guide.md        # 集成指南（CLI/Express/Bot/Cron）
│   └── lof-knowledge.md            # LOF 套利领域知识
└── assets/
    └── lof-arbitrage.js            # 核心服务源码（757行，零依赖）
```

## 💡 适用场景

| 场景 | 说明 |
|------|------|
| 独立工具 | 命令行一键扫描套利机会 |
| 聊天机器人 | 企微/钉钉/飞书/Telegram 集成 |
| 定时任务 | cron 定时推送套利报告 |
| Express API | REST 接口提供套利数据 |
| 学习参考 | 金融数据采集 + 量化筛选实战 |

## ⚠️ 免责声明

本工具仅供学习和研究使用，不构成任何投资建议。基金投资有风险，套利操作需自行承担风险。

## 📜 License

MIT
