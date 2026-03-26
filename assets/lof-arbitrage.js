/**
 * 📊 LOF 套利智能筛选服务
 * ---
 * 核心理念：不是简单列出溢价率，而是智能判断"值不值得做"
 *
 * 功能：
 *   1. 从东方财富获取全量 LOF 基金数据（净值、场内价格、申购状态、限额）
 *   2. 计算溢价率、扣除全部成本后的净收益
 *   3. 考虑限购额度计算实际收益金额（单账户 + 六账户）
 *   4. A/B/C/D 综合评级，给出"推荐/谨慎/不建议"的明确建议
 *   5. 风险评估（时间风险、流动性风险、溢价衰减风险）
 *
 * 使用：
 *   - 企微指令：发送 "LOF套利" / "lof" / "基金套利"
 *   - CLI 测试：node services/lof-arbitrage.js
 */

// ============================================================
// 配置常量
// ============================================================

const LOF_CONFIG = {
  // 筛选门槛
  MIN_PREMIUM_RATE: 3,          // 最低溢价率(%)，低于此值直接过滤
  MIN_SINGLE_RETURN: 50,        // 单账户最低收益(元)，低于此标记不建议
  MIN_MULTI_RETURN: 300,        // 六账户最低收益(元)，达到此值才标记推荐
  RECOMMEND_SINGLE_RETURN: 200, // 单账户推荐收益门槛(元)
  RECOMMEND_MULTI_RETURN: 500,  // 六账户推荐收益门槛(元)

  // 多账户配置
  ACCOUNT_COUNT: 6,             // 一拖六

  // 成本模型
  DEFAULT_PURCHASE_FEE: 0.15,   // 默认申购费率(%)（优惠后）
  SELL_COMMISSION: 0.025,       // 卖出佣金(%)
  IMPACT_COST: 0.1,             // 冲击成本(%)
  PREMIUM_DECAY_DOMESTIC: 1.0,  // 国内基金溢价衰减预估(%)（T+2）
  PREMIUM_DECAY_QDII: 2.0,     // QDII基金溢价衰减预估(%)（T+3）

  // 流动性门槛
  MIN_DAILY_VOLUME: 100,        // 最低日成交额(万元)
  GOOD_DAILY_VOLUME: 500,       // 良好日成交额(万元)

  // HTTP 请求配置
  REQUEST_DELAY_MS: 200,        // 请求间隔(ms)，防限流
  REQUEST_TIMEOUT_MS: 10000,    // 单次请求超时(ms)
};

// ============================================================
// LOF 套利服务
// ============================================================

class LofArbitrageService {
  constructor(config = {}) {
    this.config = { ...LOF_CONFIG, ...config };
  }

  // ----------------------------------------------------------
  // 主入口
  // ----------------------------------------------------------

  /**
   * 获取 LOF 套利筛选报告
   * @returns {Promise<{text: string, opportunities: Array, summary: object}>}
   */
  async getArbitrageReport() {
    console.log('[LOF] 🔍 开始扫描全市场 LOF 套利机会...');

    // 1. 获取全量 LOF 基金列表
    const lofList = await this.fetchAllLofFunds();
    console.log(`[LOF] 📋 获取到 ${lofList.length} 只 LOF 基金`);

    if (lofList.length === 0) {
      return {
        text: '📊 LOF套利筛选\n\n⚠️ 未获取到LOF基金数据，请稍后重试',
        opportunities: [],
        summary: { total: 0 },
      };
    }

    // 2. 批量获取场内实时价格
    const priceMap = await this.fetchRealtimePrices(lofList);
    console.log(`[LOF] 💹 获取到 ${Object.keys(priceMap).length} 只实时价格`);

    // 3. 逐只计算溢价率并筛选初步候选（溢价率 > MIN_PREMIUM_RATE）
    const candidates = [];
    for (const fund of lofList) {
      const price = priceMap[fund.code];
      if (!price || !fund.netValue || fund.netValue <= 0) continue;

      fund.marketPrice = price.price;
      fund.dailyVolume = price.volume; // 成交额(万元)
      fund.premiumRate = ((fund.marketPrice - fund.netValue) / fund.netValue) * 100;

      if (fund.premiumRate >= this.config.MIN_PREMIUM_RATE) {
        candidates.push(fund);
      }
    }
    console.log(`[LOF] 📊 溢价率 ≥ ${this.config.MIN_PREMIUM_RATE}% 的候选: ${candidates.length} 只`);

    // 4. 获取候选基金的详细信息（申购状态、限额、费率）
    if (candidates.length > 0) {
      await this.fetchFundDetails(candidates);
    }

    // 5. 对每只候选计算净收益、评级
    const opportunities = [];
    for (const fund of candidates) {
      this.calculateNetProfit(fund);
      this.calculateActualReturn(fund);
      this.assessRisk(fund);
      this.rateOpportunity(fund);
      opportunities.push(fund);
    }

    // 6. 筛选 + 排序（D 级不展示，按评级和收益排序）
    const filtered = this.filterAndSort(opportunities);

    // 7. 格式化报告
    const text = this.formatReport(filtered, lofList.length, candidates.length);

    return {
      text,
      opportunities: filtered,
      summary: {
        total: lofList.length,
        candidates: candidates.length,
        recommended: filtered.filter(f => f.grade === 'A').length,
        cautious: filtered.filter(f => f.grade === 'B').length,
        notRecommended: filtered.filter(f => f.grade === 'C').length,
      },
    };
  }

  // ----------------------------------------------------------
  // 数据采集
  // ----------------------------------------------------------

  /**
   * 获取全量 LOF 基金列表（代码、名称、净值、申购费率）
   * 数据源：东方财富基金排行接口（已验证可用）
   * 返回格式：var rankData = {"datas":[...], "allPages":"75", "datacount":"372"}
   * 每条记录为逗号分隔字符串，字段依次：
   *   0:代码, 1:名称, 2:拼音, 3:类型, 4:近1月涨幅, ..., 11:日期, 12:净值, 13:涨幅,
   *   14:申购状态(1=开放), 15:申购费率, 16:？, 17:赎回状态(1=开放), 18:赎回费率, 19:折扣费率
   */
  async fetchAllLofFunds() {
    const allFunds = [];
    const pageSize = 200;
    let totalPages = 1;

    for (let page = 1; page <= totalPages; page++) {
      try {
        const url = `https://fund.eastmoney.com/data/FundGuideapi.aspx?dt=0&ft=lof&sd=&ed=&sc=z&st=desc&pi=${page}&pn=${pageSize}&zf=diy&sh=list`;

        const resp = await this._fetch(url, {
          headers: {
            'Referer': 'https://fund.eastmoney.com/',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          },
        });

        const text = await resp.text();
        // 解析 "var rankData = {...}" 格式
        const jsonMatch = text.match(/rankData\s*=\s*(\{.+\})/);
        if (!jsonMatch) {
          console.log(`[LOF] ⚠️ 第${page}页解析失败`);
          break;
        }

        const json = JSON.parse(jsonMatch[1]);
        if (page === 1) {
          totalPages = parseInt(json.allPages) || 1;
          console.log(`[LOF] 📋 共 ${json.datacount} 只LOF，${totalPages} 页`);
        }

        const datas = json.datas || [];
        for (const raw of datas) {
          const fields = raw.split(',');
          if (fields.length < 20) continue;

          const code = fields[0];
          const name = fields[1];
          const netValue = parseFloat(fields[16]) || 0;      // 单位净值
          const netValueDate = fields[15] || '';              // 净值日期
          const purchaseOpen = fields[14] === '1';            // 申购状态
          const discountFeeStr = fields[19] || '';            // 折扣申购费率
          const originalFeeStr = fields[22] || '';            // 原始申购费率

          // 申购费率：优先取折扣费率，否则取原费率
          let purchaseFee = this.config.DEFAULT_PURCHASE_FEE;
          const discountFee = parseFloat(discountFeeStr.replace('%', ''));
          const originalFee = parseFloat(originalFeeStr.replace('%', ''));
          if (!isNaN(discountFee) && discountFee > 0) {
            purchaseFee = discountFee;
          } else if (!isNaN(originalFee) && originalFee > 0) {
            purchaseFee = originalFee;
          }

          allFunds.push({
            code,
            name,
            netValue,
            netValueDate,
            type: this._isQDII(name) ? 'QDII' : '国内',
            purchaseStatus: purchaseOpen ? '开放' : '暂停',
            purchaseLimit: 0,   // 后续从详情接口获取
            purchaseFee,
          });
        }

        if (page < totalPages) {
          await this._delay(this.config.REQUEST_DELAY_MS);
        }
      } catch (err) {
        console.error(`[LOF] ❌ 获取第${page}页失败:`, err.message);
        break;
      }
    }

    return allFunds;
  }

  /**
   * 批量获取 LOF 场内实时价格和成交额
   * 数据源：新浪财经行情接口（已验证 Node.js fetch 可用）
   * 返回格式：var hq_str_sz161724="名称,昨收,今开,最新,最高,最低,买一,卖一,成交量,成交额,..."
   * 字段序号（0起始）：0=名称, 1=昨收, 2=今开, 3=最新价, 9=成交额
   */
  async fetchRealtimePrices(lofList) {
    const priceMap = {};
    const batchSize = 50; // 新浪接口支持一次查多只

    for (let i = 0; i < lofList.length; i += batchSize) {
      const batch = lofList.slice(i, i + batchSize);

      try {
        // 构造查询字符串：sz/sh + 代码
        const symbols = batch.map(f => {
          const prefix = f.code.startsWith('5') ? 'sh' : 'sz';
          return `${prefix}${f.code}`;
        }).join(',');

        const url = `https://hq.sinajs.cn/list=${symbols}`;
        const resp = await this._fetch(url, {
          headers: {
            'Referer': 'https://finance.sina.com.cn/',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          },
        });

        const text = await resp.text();
        // 逐行解析
        const lines = text.split('\n').filter(line => line.includes('hq_str_'));

        for (const line of lines) {
          // 提取代码和数据
          const codeMatch = line.match(/hq_str_(?:sz|sh)(\d{6})="(.+?)"/);
          if (!codeMatch) continue;

          const code = codeMatch[1];
          const fields = codeMatch[2].split(',');

          if (fields.length < 10) continue;

          const price = parseFloat(fields[3]); // 最新价
          const volume = parseFloat(fields[9]); // 成交额（元）

          if (price > 0) {
            priceMap[code] = {
              price,
              volume: volume / 10000, // 转为万元
            };
          }
        }
      } catch (err) {
        console.error(`[LOF] ⚠️ 批次${Math.floor(i / batchSize) + 1}行情获取失败:`, err.message);
      }

      // 批次间延迟
      if (i + batchSize < lofList.length) {
        await this._delay(this.config.REQUEST_DELAY_MS);
      }
    }

    return priceMap;
  }

  /**
   * 获取候选基金的详细信息（申购状态、限额、费率）
   * 逐只查询（仅对候选基金，数量有限）
   */
  async fetchFundDetails(candidates) {
    for (const fund of candidates) {
      try {
        // 东方财富基金详情接口
        const url = `https://fundgz.1234567.com.cn/js/${fund.code}.js?rt=${Date.now()}`;
        const resp = await this._fetch(url, {
          headers: {
            'Referer': 'https://fund.eastmoney.com/',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          },
        });
        const text = await resp.text();

        // 解析 JSONP: jsonpgz({...})
        const match = text.match(/jsonpgz\((.+)\)/);
        if (match) {
          const data = JSON.parse(match[1]);
          // gsz = 估算净值（盘中）, dwjz = 单位净值（上一交易日）
          if (data.dwjz) {
            fund.netValue = parseFloat(data.dwjz);
          }
          if (data.gsz) {
            fund.estimatedNetValue = parseFloat(data.gsz);
          }
          // 重新计算溢价率（用估算净值更准确）
          const refValue = fund.estimatedNetValue || fund.netValue;
          if (refValue > 0 && fund.marketPrice > 0) {
            fund.premiumRate = ((fund.marketPrice - refValue) / refValue) * 100;
          }
        }

        await this._delay(this.config.REQUEST_DELAY_MS);
      } catch (err) {
        // 详情获取失败不阻塞，使用默认值
        console.log(`[LOF] ⚠️ ${fund.code} 详情获取失败: ${err.message}`);
      }
    }

    // 批量获取申购状态和限额
    await this._fetchPurchaseStatus(candidates);
  }

  /**
   * 获取候选基金的限额信息
   * 数据源：天天基金费率页面（fundf10.eastmoney.com/jjfl_{code}.html）
   * 该页面有明确的「日累计申购限额」字段，数据最准确
   */
  async _fetchPurchaseStatus(candidates) {
    for (const fund of candidates) {
      try {
        // 天天基金费率页面 - 包含「日累计申购限额」结构化字段
        const url = `https://fundf10.eastmoney.com/jjfl_${fund.code}.html`;
        const resp = await this._fetch(url, {
          headers: {
            'Referer': 'https://fund.eastmoney.com/',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          },
        });
        const html = await resp.text();

        // 精确匹配「日累计申购限额」字段值
        // HTML 结构: <td class="th ...">日累计申购限额</td><td class="w135">50.00元</td>
        const limitMatch = html.match(/日累计申购限额<\/td>\s*<td[^>]*>\s*([^<]+)\s*<\/td>/);
        if (limitMatch) {
          const limitText = limitMatch[1].trim();
          if (limitText === '无限额' || limitText === '--' || limitText === '无限制') {
            fund.purchaseLimit = 0; // 无限额
          } else {
            // 解析限额金额，支持"万元"和"元"单位
            const numMatch = limitText.match(/([\d,.]+)\s*(万元|元)/);
            if (numMatch) {
              let amount = parseFloat(numMatch[1].replace(/[,，]/g, ''));
              if (numMatch[2] === '万元') {
                amount *= 10000;
              }
              fund.purchaseLimit = amount;
              if (amount > 0) {
                fund.purchaseStatus = '限额';
              }
            }
          }
          console.log(`[LOF] 📋 ${fund.code} 限额: ${limitMatch[1].trim()}`);
        }

        // 同时提取申购状态（开放/暂停）
        const statusMatch = html.match(/申购状态<\/td>\s*<td[^>]*>\s*([^<]+)\s*<\/td>/);
        if (statusMatch) {
          const statusText = statusMatch[1].trim();
          if (statusText.includes('暂停') || statusText.includes('封闭')) {
            fund.purchaseStatus = '暂停';
          } else if (fund.purchaseStatus !== '限额') {
            fund.purchaseStatus = '开放';
          }
        }

        await this._delay(this.config.REQUEST_DELAY_MS);
      } catch (err) {
        console.log(`[LOF] ⚠️ ${fund.code} 限额获取失败: ${err.message}`);
      }
    }
  }

  // ----------------------------------------------------------
  // 计算引擎
  // ----------------------------------------------------------

  /**
   * 计算扣除成本后的净收益率
   */
  calculateNetProfit(fund) {
    const premiumDecay = fund.type === 'QDII'
      ? this.config.PREMIUM_DECAY_QDII
      : this.config.PREMIUM_DECAY_DOMESTIC;

    fund.arrivalDays = fund.type === 'QDII' ? 3 : 2;

    // 总成本 = 申购费 + 卖出佣金 + 冲击成本 + 溢价衰减预估
    fund.totalCost = fund.purchaseFee
      + this.config.SELL_COMMISSION
      + this.config.IMPACT_COST
      + premiumDecay;

    // 净收益率 = 溢价率 - 总成本
    fund.netProfitRate = fund.premiumRate - fund.totalCost;
  }

  /**
   * 考虑限购后的实际收益金额
   */
  calculateActualReturn(fund) {
    // 单账户可投金额（限购 or 无限）
    const investAmount = fund.purchaseLimit > 0
      ? fund.purchaseLimit
      : 50000; // 无限购时按5万计算

    // 单账户预期收益
    fund.singleReturn = Math.round(investAmount * (fund.netProfitRate / 100));

    // 多账户预期收益（一拖六）
    fund.multiReturn = fund.singleReturn * this.config.ACCOUNT_COUNT;
  }

  /**
   * 风险评估
   */
  assessRisk(fund) {
    const risks = [];
    let riskScore = 0; // 0~100

    // 1. 时间风险
    if (fund.type === 'QDII') {
      risks.push('QDII基金T+3到账，时间风险较高');
      riskScore += 30;
    } else {
      risks.push('国内基金T+2到账');
      riskScore += 15;
    }

    // 2. 流动性风险
    if (fund.dailyVolume < this.config.MIN_DAILY_VOLUME) {
      risks.push(`日成交额${Math.round(fund.dailyVolume)}万，流动性差`);
      riskScore += 25;
    } else if (fund.dailyVolume < this.config.GOOD_DAILY_VOLUME) {
      risks.push(`日成交额${Math.round(fund.dailyVolume)}万，流动性一般`);
      riskScore += 10;
    }

    // 3. 溢价幅度风险（溢价越高，衰减风险越大）
    if (fund.premiumRate > 20) {
      risks.push('溢价率异常高，可能暂停申购或大幅衰减');
      riskScore += 20;
    } else if (fund.premiumRate > 10) {
      risks.push('高溢价，衰减风险较高');
      riskScore += 10;
    }

    // 4. 限购风险
    if (fund.purchaseStatus === '暂停') {
      risks.push('已暂停申购');
      riskScore += 50;
    } else if (fund.purchaseLimit > 0 && fund.purchaseLimit <= 1000) {
      risks.push(`限购${fund.purchaseLimit}元，利润空间有限`);
      riskScore += 15;
    }

    // 5. 净收益为负
    if (fund.netProfitRate <= 0) {
      risks.push('扣除成本后无利润');
      riskScore += 40;
    }

    fund.riskScore = Math.min(riskScore, 100);
    fund.riskLevel = riskScore >= 60 ? '高' : riskScore >= 30 ? '中' : '低';
    fund.riskNote = risks.join('；');
  }

  /**
   * 综合评级 A/B/C/D
   */
  rateOpportunity(fund) {
    // D 级：直接过滤
    if (fund.purchaseStatus === '暂停' || fund.netProfitRate <= 0 || fund.riskScore >= 80) {
      fund.grade = 'D';
      fund.advice = '不满足操作条件，跳过';
      return;
    }

    // A 级：推荐操作
    if (
      fund.multiReturn >= this.config.RECOMMEND_MULTI_RETURN &&
      fund.type === '国内' &&
      fund.dailyVolume >= this.config.GOOD_DAILY_VOLUME &&
      fund.riskLevel !== '高'
    ) {
      fund.grade = 'A';
      fund.advice = `六账户预期收益${fund.multiReturn}元，国内基金T+2到账，流动性充足，建议操作`;
      return;
    }

    // A 级（宽松条件）：单账户收益很高
    if (fund.singleReturn >= this.config.RECOMMEND_SINGLE_RETURN && fund.riskLevel !== '高') {
      fund.grade = 'A';
      fund.advice = `单账户预期收益${fund.singleReturn}元，建议操作`;
      return;
    }

    // B 级：谨慎考虑
    if (
      fund.multiReturn >= this.config.MIN_MULTI_RETURN ||
      fund.singleReturn >= this.config.MIN_SINGLE_RETURN
    ) {
      fund.grade = 'B';
      const notes = [];
      if (fund.type === 'QDII') notes.push('QDII基金到账慢');
      if (fund.dailyVolume < this.config.GOOD_DAILY_VOLUME) notes.push('流动性一般');
      if (fund.purchaseLimit > 0 && fund.purchaseLimit <= 2000) notes.push('限额较低');
      fund.advice = `收益尚可但需注意${notes.length > 0 ? '：' + notes.join('、') : '风险'}`;
      return;
    }

    // C 级：不建议
    fund.grade = 'C';
    fund.advice = `单账户收益仅${fund.singleReturn}元，等待${fund.arrivalDays}天，性价比低`;
  }

  /**
   * 筛选 + 排序（D 级过滤，按 A > B > C 排，同级按收益排）
   */
  filterAndSort(opportunities) {
    const gradeOrder = { A: 0, B: 1, C: 2, D: 3 };
    return opportunities
      .filter(f => f.grade !== 'D')
      .sort((a, b) => {
        if (gradeOrder[a.grade] !== gradeOrder[b.grade]) {
          return gradeOrder[a.grade] - gradeOrder[b.grade];
        }
        return b.multiReturn - a.multiReturn;
      });
  }

  // ----------------------------------------------------------
  // 报告格式化
  // ----------------------------------------------------------

  /**
   * 格式化为企微文本报告
   */
  formatReport(opportunities, totalScanned, totalCandidates) {
    const lines = [];
    const now = new Date();
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // 标题
    lines.push('📊 LOF套利智能筛选报告');
    lines.push('━'.repeat(24));
    lines.push(`⏰ ${timeStr}`);
    lines.push(`📋 扫描 ${totalScanned} 只LOF，溢价候选 ${totalCandidates} 只`);
    lines.push('');

    const gradeA = opportunities.filter(f => f.grade === 'A');
    const gradeB = opportunities.filter(f => f.grade === 'B');
    const gradeC = opportunities.filter(f => f.grade === 'C');

    // 无机会
    if (opportunities.length === 0) {
      lines.push('😴 当前无值得操作的LOF套利机会');
      lines.push('');
      lines.push('💡 可能原因：');
      lines.push('  · 市场溢价率普遍较低');
      lines.push('  · 高溢价品种已暂停申购');
      lines.push('  · 扣除成本后无利润空间');
      lines.push('');
      lines.push('📌 建议盘中14:00-15:00再次查看');
      lines.push('   （尾盘溢价率数据更稳定）');
      return lines.join('\n');
    }

    // 🟢 A 级 - 推荐操作
    if (gradeA.length > 0) {
      lines.push(`🟢 推荐操作 (${gradeA.length}只)`);
      lines.push('─'.repeat(20));
      gradeA.forEach((f, i) => {
        lines.push(...this._formatFundDetail(f, i + 1));
        lines.push('');
      });
    }

    // 🟡 B 级 - 谨慎考虑
    if (gradeB.length > 0) {
      lines.push(`🟡 谨慎考虑 (${gradeB.length}只)`);
      lines.push('─'.repeat(20));
      gradeB.forEach((f, i) => {
        lines.push(...this._formatFundDetail(f, i + 1));
        lines.push('');
      });
    }

    // 🔴 C 级 - 不建议（只显示摘要）
    if (gradeC.length > 0) {
      lines.push(`🔴 不建议 (${gradeC.length}只)`);
      lines.push('─'.repeat(20));
      gradeC.forEach(f => {
        lines.push(`  ${f.name}(${f.code}) 溢价${f.premiumRate.toFixed(1)}% → 单账户仅${f.singleReturn}元`);
      });
      lines.push('');
    }

    // 过滤掉的 D 级统计
    const filteredCount = totalCandidates - opportunities.length;
    if (filteredCount > 0) {
      lines.push(`⛔ 已过滤 ${filteredCount} 只（暂停申购/净收益为负/流动性极差）`);
      lines.push('');
    }

    // 配置建议
    lines.push('━'.repeat(24));
    lines.push('💡 配置建议');
    lines.push(`  · 当前筛选门槛：溢价率≥${this.config.MIN_PREMIUM_RATE}%`);
    lines.push(`  · 推荐门槛：单账户≥${this.config.RECOMMEND_SINGLE_RETURN}元 或 六账户≥${this.config.RECOMMEND_MULTI_RETURN}元`);
    lines.push(`  · 成本模型：申购费${this.config.DEFAULT_PURCHASE_FEE}%+佣金${this.config.SELL_COMMISSION}%+冲击${this.config.IMPACT_COST}%+溢价衰减1~2%`);
    lines.push('');

    // 风险提示
    lines.push('⚠️ 风险提示');
    lines.push('  · 申购到卖出需等2~3个交易日');
    lines.push('  · 期间溢价可能消失甚至反转');
    lines.push('  · 高溢价品种可能随时暂停申购');
    lines.push('  · 以上收益为预估值，实际可能偏差');
    lines.push('  · 尾盘14:30~15:00数据最准确');

    return lines.join('\n');
  }

  /**
   * 格式化单只基金详细信息
   */
  _formatFundDetail(fund, index) {
    const lines = [];
    const limitStr = fund.purchaseLimit > 0
      ? `${fund.purchaseLimit >= 10000 ? (fund.purchaseLimit / 10000).toFixed(1) + '万' : fund.purchaseLimit + '元'}`
      : '无限额';
    const volumeStr = fund.dailyVolume >= 10000
      ? `${(fund.dailyVolume / 10000).toFixed(1)}亿`
      : `${Math.round(fund.dailyVolume)}万`;

    lines.push(`${index}. ${fund.name} (${fund.code})`);
    lines.push(`   溢价率: ${fund.premiumRate.toFixed(1)}% | 净值: ${fund.netValue.toFixed(3)} | 场内价: ${fund.marketPrice.toFixed(3)}`);
    lines.push(`   限额: ${limitStr} | 申购费: ${fund.purchaseFee}%`);
    lines.push(`   ⏱ 到账: T+${fund.arrivalDays} (${fund.type})`);
    lines.push(`   💰 单账户预期: ≈${fund.singleReturn}元`);
    lines.push(`   💰 ${this.config.ACCOUNT_COUNT}账户预期: ≈${fund.multiReturn}元`);
    lines.push(`   📊 日成交额: ${volumeStr} | 流动性: ${fund.dailyVolume >= this.config.GOOD_DAILY_VOLUME ? '充足' : fund.dailyVolume >= this.config.MIN_DAILY_VOLUME ? '一般' : '较差'}`);
    lines.push(`   ⚠️ 风险: ${fund.riskLevel} (${fund.riskNote})`);
    lines.push(`   📋 ${fund.advice}`);

    return lines;
  }

  // ----------------------------------------------------------
  // 辅助方法
  // ----------------------------------------------------------

  /**
   * 判断是否为 QDII 基金
   */
  _isQDII(name) {
    const qdiiKeywords = ['QDII', 'qdii', '原油', '黄金', '美元', '美国', '纳斯达克',
      '标普', '恒生', '港股', '日经', '德国', '法国', '印度', '越南',
      '全球', '海外', '互联网', '中概', '油气', '石油'];
    return qdiiKeywords.some(kw => name.includes(kw));
  }

  /**
   * 解析申购状态
   */
  _parsePurchaseStatus(status) {
    if (!status) return '未知';
    const s = String(status);
    if (s.includes('暂停') || s === '0') return '暂停';
    if (s.includes('限额') || s.includes('限制') || s.includes('限大额')) return '限额';
    if (s.includes('开放') || s === '1') return '开放';
    return '未知';
  }

  /**
   * 解析申购限额（元）
   */
  _parsePurchaseLimit(limitStr) {
    if (!limitStr || limitStr === '--' || limitStr === '无限制') return 0;
    const num = parseFloat(String(limitStr).replace(/[,，元]/g, ''));
    if (isNaN(num)) return 0;
    // 如果值很小（< 100），可能是万元单位
    if (num > 0 && num < 100) return num * 10000;
    return num;
  }

  /**
   * HTTP 请求封装
   */
  async _fetch(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.REQUEST_TIMEOUT_MS);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 延迟
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = LofArbitrageService;

// ============================================================
// CLI 测试入口
// ============================================================
if (require.main === module) {
  (async () => {
    console.log('🚀 LOF 套利智能筛选系统');
    console.log('='.repeat(40));
    console.log('');

    const service = new LofArbitrageService();
    try {
      const result = await service.getArbitrageReport();
      console.log(result.text);
      console.log('');
      console.log('─'.repeat(40));
      console.log(`📊 统计: 推荐${result.summary.recommended}只 | 谨慎${result.summary.cautious}只 | 不建议${result.summary.notRecommended}只`);
    } catch (err) {
      console.error('❌ 执行失败:', err);
    }
  })();
}
