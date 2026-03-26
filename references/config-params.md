# LOF 套利配置参数参考

## 完整参数列表

所有参数通过 `LofArbitrageService` 构造函数传入，以下为默认值：

```javascript
const LOF_CONFIG = {
  // ========== 筛选门槛 ==========
  MIN_PREMIUM_RATE: 3,          // 最低溢价率(%)，低于此值的基金在初筛阶段直接过滤
  MIN_SINGLE_RETURN: 50,        // 单账户最低收益(元)，达到此值为 B 级最低门槛
  MIN_MULTI_RETURN: 300,        // 六账户最低收益(元)，达到此值为 B 级门槛
  RECOMMEND_SINGLE_RETURN: 200, // 单账户 A 级推荐门槛(元)
  RECOMMEND_MULTI_RETURN: 500,  // 六账户 A 级推荐门槛(元)

  // ========== 多账户配置 ==========
  ACCOUNT_COUNT: 6,             // 多账户数量（一拖六策略）

  // ========== 成本模型 ==========
  DEFAULT_PURCHASE_FEE: 0.15,   // 默认申购费率(%)（券商渠道优惠后）
  SELL_COMMISSION: 0.025,       // 卖出佣金(%)
  IMPACT_COST: 0.1,             // 冲击成本(%)（卖出时的价格滑点）
  PREMIUM_DECAY_DOMESTIC: 1.0,  // 国内基金溢价衰减预估(%)（T+2 期间）
  PREMIUM_DECAY_QDII: 2.0,     // QDII 基金溢价衰减预估(%)（T+3 期间）

  // ========== 流动性门槛 ==========
  MIN_DAILY_VOLUME: 100,        // 最低日成交额(万元)，低于此值标记流动性差
  GOOD_DAILY_VOLUME: 500,       // 良好日成交额(万元)，达到此值标记流动性充足

  // ========== HTTP 请求配置 ==========
  REQUEST_DELAY_MS: 200,        // 请求间隔(ms)，防止被限流
  REQUEST_TIMEOUT_MS: 10000,    // 单次请求超时(ms)
};
```

## 使用方式

```javascript
const LofArbitrageService = require('./services/lof-arbitrage');

// 使用默认配置
const service = new LofArbitrageService();

// 覆盖部分参数
const service = new LofArbitrageService({
  MIN_PREMIUM_RATE: 5,          // 提高到 5% 门槛
  ACCOUNT_COUNT: 3,             // 改为 3 个账户
  PREMIUM_DECAY_DOMESTIC: 1.5,  // 更保守的衰减预估
  RECOMMEND_MULTI_RETURN: 800,  // 提高 A 级门槛
});

const result = await service.getArbitrageReport();
```

## 参数调优建议

### 保守策略（减少误报）
```javascript
{
  MIN_PREMIUM_RATE: 5,
  PREMIUM_DECAY_DOMESTIC: 1.5,
  PREMIUM_DECAY_QDII: 2.5,
  RECOMMEND_SINGLE_RETURN: 300,
  RECOMMEND_MULTI_RETURN: 800,
}
```

### 激进策略（更多机会）
```javascript
{
  MIN_PREMIUM_RATE: 2,
  PREMIUM_DECAY_DOMESTIC: 0.8,
  PREMIUM_DECAY_QDII: 1.5,
  MIN_SINGLE_RETURN: 30,
  MIN_MULTI_RETURN: 200,
}
```

## 返回值结构

```javascript
{
  text: string,           // 格式化的文本报告（可直接发送给用户）
  opportunities: Array,   // 筛选后的基金数组（不含 D 级）
  summary: {
    total: number,        // 扫描总数
    candidates: number,   // 溢价候选数
    recommended: number,  // A 级数量
    cautious: number,     // B 级数量
    notRecommended: number, // C 级数量
  }
}
```

每只基金对象的字段：

```javascript
{
  code: string,           // 基金代码
  name: string,           // 基金名称
  netValue: number,       // 单位净值
  marketPrice: number,    // 场内价格
  premiumRate: number,    // 溢价率(%)
  type: '国内' | 'QDII', // 基金类型
  purchaseStatus: string, // 申购状态：开放/限额/暂停
  purchaseLimit: number,  // 申购限额(元)，0=无限额
  purchaseFee: number,    // 申购费率(%)
  totalCost: number,      // 总成本(%)
  netProfitRate: number,  // 净收益率(%)
  singleReturn: number,   // 单账户预期收益(元)
  multiReturn: number,    // 多账户预期收益(元)
  dailyVolume: number,    // 日成交额(万元)
  arrivalDays: number,    // 到账天数
  riskScore: number,      // 风险得分(0~100)
  riskLevel: string,      // 风险等级：低/中/高
  riskNote: string,       // 风险说明
  grade: string,          // 评级：A/B/C/D
  advice: string,         // 操作建议
}
```
