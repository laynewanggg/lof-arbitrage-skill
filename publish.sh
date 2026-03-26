#!/bin/bash
# LOF Arbitrage Skill — 一键发布脚本
# 用法: bash publish.sh

set -e

echo "🚀 LOF 套利 Skill 发布助手"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 1: 初始化 Git
if [ ! -d ".git" ]; then
  echo "📦 初始化 Git 仓库..."
  git init
  git add -A
  git commit -m "feat: LOF 套利智能筛选 Skill — 初始版本"
  echo "✅ Git 仓库已初始化"
else
  echo "✅ Git 仓库已存在"
fi

echo ""

# Step 2: 检查 gh CLI
if command -v gh &> /dev/null; then
  echo "📡 检测到 gh CLI，正在创建 GitHub 仓库..."
  gh repo create lof-arbitrage-skill --public --source=. --remote=origin --push \
    --description "AI Agent Skill — LOF 基金套利智能筛选服务"
  echo "✅ GitHub 仓库已创建并推送"
else
  echo "⚠️  未检测到 gh CLI"
  echo ""
  echo "请手动执行以下步骤："
  echo ""
  echo "  1. 在 GitHub 上创建仓库: https://github.com/new"
  echo "     仓库名: lof-arbitrage-skill"
  echo "     描述: AI Agent Skill — LOF 基金套利智能筛选服务"
  echo "     可见性: Public"
  echo ""
  echo "  2. 推送代码："
  echo "     git remote add origin https://github.com/<你的用户名>/lof-arbitrage-skill.git"
  echo "     git branch -M main"
  echo "     git push -u origin main"
  echo ""
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📢 推送成功后，前往以下平台提交 Skill："
echo ""
echo "  🌐 agentskill.sh (全球最大 AI Skill 市场，10万+ Skills)"
echo "     → https://agentskill.sh/submit"
echo "     → 粘贴你的 GitHub 仓库地址，点击 'Analyze & Import' 即可"
echo ""
echo "  🌐 cursor.directory (Cursor 规则市场)"
echo "     → https://github.com/pontusab/directories"
echo "     → Fork 仓库，将 SKILL.md 内容适配为 .mdc 格式后提交 PR"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 完成！"
