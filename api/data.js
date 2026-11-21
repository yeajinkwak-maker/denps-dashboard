// api/data.js — Vercel Serverless Function
// AEER(Airbridge Agent) API 직접 호출 → 덴프스(client_id=93) SA·메타 데이터를
// 캠페인→그룹→소재 3단 트리(유통채널별)로 가공해 반환한다.
// 브라우저 새로고침/날짜 선택 시 바로 호출되는 라이브 엔드포인트.

const https = require("https");

const CLIENT_ID = 93;
const AEER_HOST = "aiaeer.com";
const AEER_PATH = "/api/v1/agent-api/";

const META_ALIAS_CH = {
  "자사몰 메타": "자사몰",
  "네이버 메타": "스마트스토어",
  "메타 올리브영 협력": "올리브영",
  "스토어 SA": "스마트스토어",
  "자사몰 SA": "자사몰",
};
const SA_TYPES = new Set(["파워링크", "쇼핑검색", "브랜드검색"]);

function callAeer(name, args, token) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, params: { name, arguments: args || {} } });
    const req = https.request(
      { hostname: AEER_HOST, path: AEER_PATH, method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        } },
      (res) => {
        let d = "";
        res.on("data", (x) => (d += x));
        res.on("end", () => {
          try {
            const outer = JSON.parse(d);
            if (outer.error) return reject(new Error(outer.error.message || "AEER error"));
            resolve(JSON.parse(outer.result.content[0].text));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function toNum(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function aeerChannel(row) {
  const alias = row["별명"];
  if (alias && META_ALIAS_CH[alias]) return META_ALIAS_CH[alias];
  return null;
}

function aeerMedium(row) {
  const sup = row["공급사"], ctype = row["캠페인유형"];
  if (sup === "Meta") return "meta";
  if (sup === "네이버" && SA_TYPES.has(ctype)) return "sa_" + ctype;
  return null; // GFA·ADVoost·카카오는 이 API로는 다루지 않음(GFA는 별도 push 데이터 사용)
}

function aeerItemLabel(row) {
  const ctype = row["캠페인유형"];
  if (ctype === "파워링크") return row["키워드"] || "(키워드 미상)";
  if (ctype === "쇼핑검색" || ctype === "브랜드검색") return row["제품명"] || "(제품명 미상)";
  return row["캠페인"] || "(소재)";
}

function leaf(name, r) {
  return {
    name: name || "(이름없음)",
    impressions: toNum(r["노출"]), clicks: toNum(r["클릭"]), cost: toNum(r["비용"]),
    purchases: toNum(r["구매"]), revenue: toNum(r["매출"]),
  };
}

function rollup(items) {
  const cost = items.reduce((s, i) => s + i.cost, 0);
  const revenue = items.reduce((s, i) => s + i.revenue, 0);
  const purchases = items.reduce((s, i) => s + i.purchases, 0);
  const clicks = items.reduce((s, i) => s + i.clicks, 0);
  const impressions = items.reduce((s, i) => s + i.impressions, 0);
  return {
    impressions, clicks, cost, purchases, revenue,
    roas: cost ? (revenue / cost) * 100 : 0,
    ctr: impressions ? (clicks / impressions) * 100 : 0,
  };
}

function buildTree(rows) {
  const campaigns = new Map();
  for (const r of rows) {
    const cid = r["캠페인ID"], cname = r["캠페인"] || cid;
    const gid = r["광고그룹ID"], gname = r["광고그룹"] || gid || "(그룹없음)";
    const ckey = cid + "||" + cname;
    if (!campaigns.has(ckey)) campaigns.set(ckey, { name: cname, groups: new Map() });
    const camp = campaigns.get(ckey);
    const gkey = gid + "||" + gname;
    if (!camp.groups.has(gkey)) camp.groups.set(gkey, { name: gname, items: [] });
    camp.groups.get(gkey).items.push(leaf(r._item, r));
  }
  const out = [];
  for (const camp of campaigns.values()) {
    const groupList = [];
    for (const g of camp.groups.values()) {
      const itemsSorted = g.items.slice().sort((a, b) => b.cost - a.cost);
      groupList.push({ name: g.name, kpi: rollup(itemsSorted), items: itemsSorted });
    }
    groupList.sort((a, b) => b.kpi.cost - a.kpi.cost);
    const campKpi = rollup(groupList.map((g) => g.kpi));
    out.push({ name: camp.name, kpi: campKpi, groups: groupList });
  }
  out.sort((a, b) => b.kpi.cost - a.kpi.cost);
  return out;
}

function assemble(rows, dateLabel) {
  const byChannelMedium = new Map();
  for (const r of rows) {
    const ch = aeerChannel(r), med = aeerMedium(r);
    if (!ch || !med) continue;
    const key = ch + "||" + med;
    if (!byChannelMedium.has(key)) byChannelMedium.set(key, []);
    byChannelMedium.get(key).push({ ...r, _item: aeerItemLabel(r) });
  }
  const data = { 스마트스토어: {}, 자사몰: {}, 올리브영: {} };
  for (const [key, rowsForKey] of byChannelMedium) {
    const [ch, med] = key.split("||");
    const tree = buildTree(rowsForKey);
    data[ch][med] = { date: dateLabel, kpi: rollup(tree.map((c) => c.kpi)), campaigns: tree };
  }
  return data;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();

  const token = process.env.AEER_API_TOKEN;
  if (!token) return res.status(500).json({ error: "AEER_API_TOKEN not configured" });

  try {
    const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
    const todayStr = kstNow.toISOString().slice(0, 10);
    const q = (req.query && req.query.date) || "";

    let startDate, endDate, dateLabel;
    if (q === "month") {
      endDate = new Date(kstNow); endDate.setUTCDate(endDate.getUTCDate() - 1);
      startDate = new Date(endDate); startDate.setUTCDate(1);
      startDate = startDate.toISOString().slice(0, 10);
      endDate = endDate.toISOString().slice(0, 10);
      dateLabel = `${startDate}~${endDate}`;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(q)) {
      startDate = endDate = dateLabel = q;
    } else {
      // 기본: 어제(AEER는 1일 지연이라 "오늘"엔 데이터 없음)
      const y = new Date(kstNow); y.setUTCDate(y.getUTCDate() - 1);
      startDate = endDate = dateLabel = y.toISOString().slice(0, 10);
    }

    const result = await callAeer(
      "get_report_group_by_headers",
      {
        client_id: CLIENT_ID,
        group_by: ["날짜", "공급사", "캠페인유형", "별명", "캠페인", "캠페인ID", "광고그룹", "광고그룹ID", "키워드", "제품명"],
        aggregations: [{ agg_type: "SUM", metrics: ["비용", "노출", "클릭", "구매", "매출"] }],
        start_date: startDate, end_date: endDate,
      },
      token
    );

    const data = assemble(result.data_set || [], dateLabel);
    res.status(200).json({ meta: { generated_at: todayStr, start_date: startDate, end_date: endDate, date_label: dateLabel }, data });
  } catch (e) {
    console.error("[data] error:", e.message);
    res.status(500).json({ error: e.message });
  }
};
