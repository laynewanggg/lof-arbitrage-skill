# LOF 套利服务集成指南

## 快速开始

### 独立运行（最简方式）

```bash
# 确保 Node.js >= 18
node services/lof-arbitrage.js
```

无需任何配置，直接输出套利报告。

### 集成到 Express 服务

```javascript
const express = require('express');
const LofArbitrageService = require('./services/lof-arbitrage');

const app = express();

app.get('/api/lof-arbitrage', async (req, res) => {
  try {
    const service = new LofArbitrageService();
    const result = await service.getArbitrageReport();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000);
```

### 集成到聊天机器人

#### 1. 注册指令匹配

在 `config.js` 中添加指令正则：

```javascript
const COMMANDS = {
  LOF_ARBITRAGE: /^(LOF套利|lof套利|LOF|lof|基金套利|套利)$/i,
};
```

#### 2. 添加指令处理

在指令处理器中添加：

```javascript
const LofArbitrageService = require('../services/lof-arbitrage');

async handleLofArbitrage(userId) {
  // 1. 立即回复提示（扫描需要 10~30 秒）
  await this.sendMessage(userId, '⏳ 正在扫描全市场LOF套利机会，请稍候...');

  // 2. 执行扫描
  const lofService = new LofArbitrageService();
  const result = await lofService.getArbitrageReport();

  // 3. 发送报告
  await this.sendMessage(userId, result.text);
}
```

#### 3. 路由注册

```javascript
if (COMMANDS.LOF_ARBITRAGE.test(userMessage)) {
  await handleLofArbitrage(userId);
  return true;
}
```

### 集成到定时任务

```javascript
const cron = require('node-cron');
const LofArbitrageService = require('./services/lof-arbitrage');

// 每个交易日 14:30 自动扫描
cron.schedule('30 14 * * 1-5', async () => {
  const service = new LofArbitrageService();
  const result = await service.getArbitrageReport();
  
  // 仅当有 A 级机会时推送
  if (result.summary.recommended > 0) {
    await pushNotification(result.text);
  }
});
```

## 依赖说明

`lof-arbitrage.js` **无外部依赖**，仅使用 Node.js 18+ 内置的 `fetch` API。

如需在 Node.js 16 或更低版本运行，安装 `node-fetch`：

```bash
npm install node-fetch
```

然后在文件顶部添加：

```javascript
const fetch = require('node-fetch');
```

## 企微机器人完整集成示例

本项目（wecom-bot-service）中的完整调用链路：

```
server.js
  → POST /wecom/callback 接收企微回调
  → WeComCrypto 解密消息
  → message-router.js 路由到 handleTextIntent()
  → command-handler.js tryHandle() 匹配正则
  → handleLofArbitrage(userId)
    → new LofArbitrageService().getArbitrageReport()
    → wecom.sendLongTextMessage(userId, result.text)
```

关键代码位置：
- 正则定义：`config.js` 第 54 行
- 指令匹配：`handlers/command-handler.js` 第 86-89 行
- 处理函数：`handlers/command-handler.js` 第 378-396 行
- 核心服务：`services/lof-arbitrage.js`（757 行，完全独立）

## 性能特征

- 全量扫描耗时：10~30 秒（取决于候选基金数量）
- 网络请求数：2 页列表 + 1 批行情 + N 只详情 + N 只限额（N = 溢价率超过门槛的基金数，通常 3~15 只）
- 内存占用：极低（流式处理，不缓存全量数据）

## 错误处理

服务内部对每个数据源单独 try/catch，部分数据获取失败不会阻塞整体流程：

- 某页列表获取失败 → 跳过该页，继续下一页
- 某只行情获取失败 → 跳过该只，使用默认值
- 详情/限额获取失败 → 使用默认费率和无限额
- 全部失败 → 返回"未获取到数据"提示
