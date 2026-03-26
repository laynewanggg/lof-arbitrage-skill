# LOF 套利配置参数参考

## 完整参数列表

所有参数通过 `LofArbitrageService` 构造函数传入，以下为默认值（实战校准版 2026.03）：

```javascript
const LOF_CONFIG = {
  // ========== 筛选门槛（基于实战校准：限购品种单账户通常几元到几十元）==========
  MIN_PREMIUM_RATE: 3,          // 最低溢价率(%)，低于此值直接过滤
  MIN_SINGLE_RETURN: 3,         // 单账户最低收益(元)，B 级最低门槛（限购100元品种约3~5元）
  MIN_MULTI_RETURN: 20,         // 六账户最低收益(元)，B 级门槛
  RECOMMEND_SINGLE_RETURN: 15,  // 单账户 A 级推荐门槛(元)（限购1000元品种约10~50元）
  RECOMMEND_MULTI_RETURN: 80,   // 六账户 A 级推荐门槛(元)

  // ========== 多账户配置 ==========
  ACCOUNT_COUNT: 6,             // 多账户数量（一拖六策略）

  // ========== 成本模型（动态，基于全网实战数据校准）==========
  DEFAULT_PURCHASE_FEE: 0.12,   // 默认申购费率(%)（场内一折优惠基准）
  SELL_COMMISSION: 0.025,       // 卖出佣金(%)（免五券商）
  BASE_IMPACT_COST: 0.3,        // 基础冲击成本(%)（实战0.3~0.5%）
  LOW_VOLUME_IMPACT_EXTRA: 0.3, // 低成交额品种额外冲击成本(%)

  // ========== 动态溢价衰减模型 ==========
  PREMIUM_DECAY_BASE_DOMESTIC: 2.0,  // 国内基金基础衰减(%)（T+2）
  PREMIUM_DECAY_BASE_QDII: 3.0,     // QDII基金基础衰减(%)（T+3）
  PREMIUM_DECAY_EXTRA_RATE: 0.4,    // 高溢价额外衰减系数（溢价每超过3%的部分×此系数）
  PREMIUM_DECAY_THRESHOLD: 3,       // 额外衰减触发阈值(%)
  LOW_VOLUME_DECAY_EXTRA: 0.5,      // 低成交额品种额外衰减(%)

  // ========== 投入金额 ==========
  DEFAULT_INVEST_AMOUNT: 5000,  // 无限购时默认投入(元)（保守估计）

  // ========== 流动性门槛 ==========
  MIN_DAILY_VOLUME: 100,        // 最低日成交额(万元)
  GOOD_DAILY_VOLUME: 500,       // 良好日成交额(万元)
  LOW_VOLUME_THRESHOLD: 300,    // 低成交额阈值(万元)，低于此值增加冲击和衰减

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
  MIN_PREMIUM_RATE: 5,              // 提高到 5% 门槛
  ACCOUNT_COUNT: 3,                 // 改为 3 个账户
  PREMIUM_DECAY_BASE_DOMESTIC: 2.5, // 更保守的基础衰减
  DEFAULT_INVEST_AMOUNT: 10000,     // 无限购品种投入金额
});

const result = await service.getArbitrageReport();
```

## 参数调优建议

### 保守策略（减少误报）
```javascript
{
  MIN_PREMIUM_RATE: 5,
  PREMIUM_DECAY_BASE_DOMESTIC: 2.5,
  PREMIUM_DECAY_BASE_QDII: 3.5,
  PREMIUM_DECAY_EXTRA_RATE: 0.5,   // 高溢价衰减更激进
  RECOMMEND_SINGLE_RETURN: 30,
  RECOMMEND_MULTI_RETURN: 150,
}
```

### 激进策略（更多机会）
```javascript
{
  MIN_PREMIUM_RATE: 2,
  PREMIUM_DECAY_BASE_DOMESTIC: 1.5,
  PREMIUM_DECAY_BASE_QDII: 2.5,
  PREMIUM_DECAY_EXTRA_RATE: 0.3,
  MIN_SINGLE_RETURN: 1,
  MIN_MULTI_RETURN: 10,
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
  investAmount: number,   // 实际投入金额(元)（限购额或默认值）
  premiumDecay: number,   // 动态溢价衰减(%)
  impactCost: number,     // 动态冲击成本(%)
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
