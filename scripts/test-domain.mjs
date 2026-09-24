// 临时逻辑测试：node scripts/test-domain.mjs
import { build } from "esbuild";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const esbuild = require("esbuild");

const tmp = new URL("./_domain-bundle.mjs", import.meta.url);
const result = await esbuild.build({
  entryPoints: ["scripts/_entry.ts"],
  bundle: true,
  format: "esm",
  write: false,
  absWorkingDir: process.cwd(),
});
// 三个入口合并输出，靠命名导出使用
writeFileSync(tmp, result.outputFiles[0].text);
const mod = await import("./_domain-bundle.mjs");

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error("FAIL:", name); }
}
const approx = (a, b) => Math.abs(a - b) < 1e-6;

// 1. 色差计算与结论
const d = mod.deltaLab({ L: 62.4, a: 8.1, b: -22.6 }, { L: 62.7, a: 8.5, b: -22.2 });
check("dE 计算", approx(d.deltaE, Math.round(Math.sqrt(0.09 + 0.16 + 0.16) * 100) / 100));
check("dE=0.64 合格", d.pass === true);
const d2 = mod.deltaLab({ L: 38.2, a: 2.6, b: -30.4 }, { L: 37.1, a: 3.9, b: -29.2 });
check("dE≈2.08 超限", approx(d2.deltaE, 2.08) && d2.pass === false);
check("超限结论含转复染", mod.buildConclusion(d2).includes("转入复染"));
check("通过结论含评审通过", mod.buildConclusion(d).includes("评审通过"));
check("偏色描述：偏红", mod.describeRedGreen(0.9) === "偏红");
check("偏色描述：偏蓝", mod.describeYellowBlue(-0.9) === "偏蓝");

// 2. 配方比例
const ratios = mod.recipeRatios([{ weight: 1 }, { weight: 3 }]);
check("配方比例 25/75", approx(ratios[0], 25) && approx(ratios[1], 75));

// 3. 曲线摘要
const summary = mod.summarizeCurve([{ fromTemp: 40, toTemp: 60, rate: 2, holdMin: 10 }]);
check("曲线摘要含全程", summary.includes("40℃起") && summary.includes("60℃") && summary.includes("约20min"));

// 4. 样例与编号
const seed = mod.seedBatches();
check("3 张样例", seed.length === 3);
check("620A 已通过", seed[0].status === "passed");
check("621C 复染中", seed[1].status === "redyeing");
check("621C v1 仍生效且失败结论保留", mod.activeVersion(seed[1]).version === 1 && mod.activeVersion(seed[1]).review?.pass === false);
check("624B 待评审", seed[2].status === "pending");
check("下一批次号 LAB-625", mod.nextBatchId(seed) === "LAB-625");

// 5. 登记校验
const bad = mod.registerBatch(seed, {
  ...mod.emptyDraft("LAB-900"),
  id: "", orderNo: "", customer: "", fabric: "",
  weightGSM: "0", clothWeightG: "0",
});
check("缺字段登记失败", bad.ok === false && Object.keys(bad.errors).length >= 5);

// 6. 完整流转：登记 -> 评审通过 -> 出库
let batches = seed.map((b) => ({ ...b, versions: b.versions.map((v) => ({ ...v })) }));
const good = mod.emptyDraft("LAB-700");
good.orderNo = "PO-1"; good.customer = "客户甲"; good.fabric = "棉";
good.weightGSM = "120"; good.clothWeightG = "10";
good.recipe = [{ id: "x", name: "染料A", weight: "2" }];
good.liquorRatio = "10"; good.holdMinutes = "30";
good.curve = [{ id: "y", fromTemp: "40", toTemp: "60", rate: "2", holdMin: "30" }];
const reg = mod.registerBatch(batches, good);
check("登记成功", reg.ok === true);
batches.push(reg.batch);
let b = batches.find((x) => x.id === "LAB-700");
check("新批次待评审", b.status === "pending");
// 未通过不能出库
check("待评审不可出库", mod.shipBatch(b).status === "pending");
b = mod.applyReview(b, { target: { L: 50, a: 0, b: 0 }, sample: { L: 50.3, a: 0.2, b: -0.2 } });
check("初审通过", b.status === "passed" && b.versions[0].review.pass === true);
b = mod.shipBatch(b);
check("通过后出库", b.status === "shipped");
check("出库日志", b.log.at(-1).text.includes("出库"));

// 7. 超限 -> 复染 -> 改版（旧结论失效保留）-> 复染评审通过 -> 出库
let r = batches.find((x) => x.id === "LAB-620A");
r = mod.applyReview(r, { target: { L: 62.4, a: 8.1, b: -22.6 }, sample: { L: 64, a: 10, b: -20 } });
check("超限自动转复染", r.status === "redyeing" && r.versions[0].review.pass === false);
check("复染中不可出库", mod.shipBatch(r).status === "redyeing");
const revDraft = mod.batchToDraft(r);
revDraft.recipe[0].weight = "2.2"; // 改配方
const rev = mod.saveRevision(r, revDraft);
check("复染改版成功", rev.ok === true && rev.invalidated === true);
r = rev.batch;
check("改版后回到待评审", r.status === "pending");
check("旧版作废但结论保留", r.versions[0].active === false && r.versions[0].review !== undefined && r.versions[0].review.pass === false);
check("新版生效 v2", r.versions[1].active === true && r.versions[1].version === 2 && r.versions[1].review === undefined);
check("生效版本取 v2", mod.activeVersion(r).version === 2);
r = mod.applyReview(r, { target: { L: 62.4, a: 8.1, b: -22.6 }, sample: { L: 62.5, a: 8.2, b: -22.5 } });
check("复染再次评审通过", r.status === "passed" && mod.activeVersion(r).review.round === 2);
r = mod.shipBatch(r);
check("复染通过后出库，日志注明复染", r.status === "shipped" && r.log.at(-1).text.includes("复染"));

// 8. 仅基础信息改动不产生新版本、结论保留
let p = batches.find((x) => x.id === "LAB-624B");
const sameDraft = mod.batchToDraft(p);
sameDraft.customer = "北辰工装改";
const same = mod.saveRevision(p, sameDraft);
check("工艺未变不失效", same.ok === true && same.invalidated !== true && same.batch.versions.length === 1);

// 9. 筛选
const f1 = mod.filterBatches(batches, { orderNo: "PO-2509-118", status: "all" });
check("按订单筛选", f1.length === 1 && f1[0].id === "LAB-620A");
const f2 = mod.filterBatches(batches, { orderNo: "", status: "redyeing" });
check("按状态筛选复染中", f2.every((x) => x.status === "redyeing") && f2.length >= 1);

// 10. 工具
check("uid 唯一", mod.uid("a") !== mod.uid("a"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
