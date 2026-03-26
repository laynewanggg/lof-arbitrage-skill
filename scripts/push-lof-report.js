#!/usr/bin/env node
/**
 * 📊 LOF 套利报告定时推送脚本 (独立版)
 * ---
 * 独立运行，扫描全市场 LOF 套利机会并通过企微 API 推送。
 * 
 * ⚠️ 此脚本需配合 wecom-bot-service 使用，或自行配置环境变量。
 *
 * 用法:
 *   node scripts/push-lof-report.js                   # 扫描并推送
 *   node scripts/push-lof-report.js --dry-run         # 仅扫描不推送
 *   node scripts/push-lof-report.js --user WangShang  # 推送给指定用户
 *   node scripts/push-lof-report.js --force            # 无论有无机会都推送
 *   node scripts/push-lof-report.js --min-grade B     # 最低推送等级 (A/B/C/D)
 *
 * 环境变量:
 *   WECOM_CORP_ID       - 企业ID
 *   WECOM_SECRET        - 应用 Secret
 *   WECOM_AGENT_ID      - 应用 AgentID
 *   LOF_REPORT_USER     - 默认推送用户 (企微 UserId)
 */

const path = require('path');

// 尝试加载 .env（兼容独立运行和集成运行）
try {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
} catch {
  // dotenv 可能不存在，忽略
}

// 加载 LOF 服务（优先 assets/ 目录，兼容 services/ 目录）
let LofArbitrageService;
const assetPath = path.resolve(__dirname, '../assets/lof-arbitrage.js');
const servicePath = path.resolve(__dirname, '../services/lof-arbitrage.js');
try {
  LofArbitrageService = require(assetPath);
} catch {
  LofArbitrageService = require(servicePath);
}

// 推送目标用户
const DEFAULT_USER = process.env.LOF_REPORT_USER || process.env.TRADING_REPORT_USER || 'WangShang';

// 等级优先级映射
const GRADE_PRIORITY = { A: 4, B: 3, C: 2, D: 1 };

async function main() {
  const args = process.argv.slice(2);
  let dryRun = false;
  let targetUser = DEFAULT_USER;
  let force = false;
  let minGrade = 'A';

  // 解析参数
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--user' && args[i + 1]) {
      targetUser = args[++i];
    } else if (args[i] === '--force') {
      force = true;
    } else if (args[i] === '--min-grade' && args[i + 1]) {
      minGrade = args[++i].toUpperCase();
    }
  }

  console.log(`📊 LOF 套利报告推送`);
  console.log(`   用户: ${targetUser}`);
  console.log(`   模式: ${dryRun ? '仅扫描(dry-run)' : '扫描+推送'}`);
  console.log(`   推送条件: ${force ? '强制推送' : `有 ${minGrade} 级及以上机会时推送`}`);
  console.log('');

  // 1. 检查是否为交易日（周一至周五）
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) {
    console.log('📅 今天是周末，非交易日，跳过扫描');
    if (!force) {
      process.exit(0);
    }
    console.log('   (--force 模式，继续执行)');
  }

  // 2. 执行 LOF 扫描
  console.log('🔍 正在扫描全市场 LOF 套利机会...');
  console.log('');

  const startTime = Date.now();
  const lofService = new LofArbitrageService();
  const result = await lofService.getArbitrageReport();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`⏱️  扫描完成 (${elapsed}s)`);
  console.log('');

  if (!result || !result.text) {
    console.log('⚠️  未获取到扫描结果');
    process.exit(0);
  }

  // 3. 输出报告
  console.log('─'.repeat(50));
  console.log(result.text);
  console.log('─'.repeat(50));

  // 4. 判断是否需要推送
  const opportunities = result.opportunities || [];

  const gradeCounts = { A: 0, B: 0, C: 0, D: 0 };
  for (const opp of opportunities) {
    const grade = (opp.grade || opp.rating || '').toUpperCase();
    if (gradeCounts[grade] !== undefined) {
      gradeCounts[grade]++;
    }
  }

  console.log(`\n📈 机会统计: A=${gradeCounts.A} B=${gradeCounts.B} C=${gradeCounts.C} D=${gradeCounts.D}`);

  const minPriority = GRADE_PRIORITY[minGrade] || 4;
  const hasQualifiedOpps = opportunities.some(opp => {
    const grade = (opp.grade || opp.rating || '').toUpperCase();
    return (GRADE_PRIORITY[grade] || 0) >= minPriority;
  });

  if (!force && !hasQualifiedOpps) {
    console.log(`\n💤 无 ${minGrade} 级及以上机会，跳过推送`);
    console.log('💡 使用 --force 强制推送，或 --min-grade D 降低门槛');
    process.exit(0);
  }

  if (dryRun) {
    console.log('\n✅ Dry-run 完成，未推送');
    process.exit(0);
  }

  // 5. 推送到企微
  const corpId = process.env.WECOM_CORP_ID;
  const secret = process.env.WECOM_SECRET;
  const agentId = parseInt(process.env.WECOM_AGENT_ID || '0');

  if (!corpId || !secret || !agentId) {
    console.error('❌ 缺少企微配置，请设置环境变量: WECOM_CORP_ID, WECOM_SECRET, WECOM_AGENT_ID');
    process.exit(1);
  }

  try {
    const tokenUrl = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${secret}`;
    const tokenResp = await fetch(tokenUrl);
    const tokenData = await tokenResp.json();

    if (tokenData.errcode !== 0) {
      throw new Error(`获取 token 失败: ${tokenData.errmsg}`);
    }

    const accessToken = tokenData.access_token;

    const maxBytes = 2000;
    const text = result.text;
    const paragraphs = text.split('\n');
    let chunk = '';
    let msgCount = 0;

    for (const para of paragraphs) {
      const test = chunk ? chunk + '\n' + para : para;
      if (Buffer.byteLength(test, 'utf-8') > maxBytes) {
        if (chunk) {
          await sendWecomMsg(accessToken, agentId, targetUser, chunk);
          msgCount++;
          chunk = para;
        } else {
          await sendWecomMsg(accessToken, agentId, targetUser, para);
          msgCount++;
          chunk = '';
        }
      } else {
        chunk = test;
      }
    }
    if (chunk) {
      await sendWecomMsg(accessToken, agentId, targetUser, chunk);
      msgCount++;
    }

    console.log(`\n✅ LOF 套利报告已推送给 ${targetUser} (${msgCount} 条消息)`);

  } catch (error) {
    console.error(`\n❌ 推送失败: ${error.message}`);
    process.exit(1);
  }
}

async function sendWecomMsg(token, agentId, userId, content) {
  const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`;
  const body = {
    touser: userId,
    msgtype: 'text',
    agentid: agentId,
    text: { content },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await resp.json();
  if (result.errcode !== 0) {
    console.warn(`⚠️  发送消息失败: ${result.errmsg}`);
  }
}

main().catch(err => {
  console.error('❌ 致命错误:', err);
  process.exit(1);
});
