// 批次账：台账的登记、改版、评审、出库与本地持久化
import type {
  Batch,
  DyeIngredient,
  LabReading,
  ProcessSpec,
  TempPoint,
} from "./types";
import {
  canOutbound,
  currentVersion,
  evaluateLab,
  statusAfterReview,
} from "./reviewRules";

const STORAGE_KEY = "hxyfront-62012:batch-ledger:v1";

export interface BatchSpecInput {
  recipe: DyeIngredient[];
  process: ProcessSpec;
  standardLab: LabReading;
}

export interface NewBatchInput extends BatchSpecInput {
  customerOrder: string;
  fabric: string;
  gramWeight: number;
}

export interface ReviseInput extends BatchSpecInput {
  note: string;
}

/* ---------- 持久化：重开页面可接着处理 ---------- */

export function loadLedger(): Batch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedBatches();
    const parsed = JSON.parse(raw) as Batch[];
    if (!Array.isArray(parsed) || parsed.length === 0) return seedBatches();
    return parsed;
  } catch {
    return seedBatches();
  }
}

export function saveLedger(batches: Batch[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(batches));
  } catch {
    // 存储不可用时静默失败，页面内数据仍可用
  }
}

export function resetLedger(): Batch[] {
  const seeded = seedBatches();
  saveLedger(seeded);
  return seeded;
}

/* ---------- 批次号 ---------- */

function nextBatchId(batches: Batch[]): string {
  const max = batches.reduce((acc, b) => {
    const m = /LAB-(\d+)/.exec(b.id);
    return m ? Math.max(acc, Number(m[1])) : acc;
  }, 619);
  return `LAB-${max + 1}`;
}

/* ---------- 台账操作（均为纯函数，返回新对象） ---------- */

export function createBatch(input: NewBatchInput, existing: Batch[]): Batch {
  const now = new Date().toISOString();
  return {
    id: nextBatchId(existing),
    customerOrder: input.customerOrder,
    fabric: input.fabric,
    gramWeight: input.gramWeight,
    status: "待评审",
    createdAt: now,
    versions: [
      {
        version: 1,
        recipe: input.recipe,
        process: input.process,
        standardLab: input.standardLab,
        review: null,
        note: "首次登记",
        createdAt: now,
      },
    ],
  };
}

/**
 * 配方或工艺改动：产生新版本，旧版本评审结论置为失效但保留记录。
 * 复染同样走此入口（改动配方/工艺后重新评审）。
 */
export function reviseBatch(batch: Batch, input: ReviseInput): Batch {
  const now = new Date().toISOString();
  const versions = batch.versions.map((v, i) =>
    i === batch.versions.length - 1 && v.review
      ? { ...v, review: { ...v.review, superseded: true } }
      : v
  );
  versions.push({
    version: batch.versions.length + 1,
    recipe: input.recipe,
    process: input.process,
    standardLab: input.standardLab,
    review: null,
    note: input.note || (batch.versions.length >= 1 ? "复染调整" : "首次登记"),
    createdAt: now,
  });
  return { ...batch, status: "待评审", versions };
}

/** 录入小样 Lab 读数并评审：ΔE > 1.0 转入复染 */
export function reviewBatch(batch: Batch, sampleLab: LabReading): Batch {
  const review = evaluateLab(currentVersion(batch).standardLab, sampleLab);
  const versions = batch.versions.map((v, i) =>
    i === batch.versions.length - 1 ? { ...v, review } : v
  );
  return { ...batch, status: statusAfterReview(review.conclusion), versions };
}

/** 出库：仅当前版本评审通过的批次可出库 */
export function outboundBatch(batch: Batch): Batch {
  if (!canOutbound(batch)) return batch;
  return { ...batch, status: "已出库" };
}

/* ---------- 展示辅助 ---------- */

export interface RecipeShare extends DyeIngredient {
  percent: number;
}

/** 配方按投料重量折算比例 */
export function recipeProportions(recipe: DyeIngredient[]): RecipeShare[] {
  const total = recipe.reduce((s, r) => s + r.weight, 0);
  return recipe.map((r) => ({
    ...r,
    percent: total > 0 ? Math.round((r.weight / total) * 1000) / 10 : 0,
  }));
}

/** 温度曲线文字摘要：起止温度、峰值、升温速率、总耗时 */
export function summarizeCurve(curve: TempPoint[], holdTime: number): string {
  if (curve.length === 0) return "未登记温度曲线";
  const pts = [...curve].sort((a, b) => a.time - b.time);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const peak = pts.reduce((p, c) => (c.temp > p.temp ? c : p), pts[0]);
  const rampMinutes = peak.time - first.time;
  const ramp =
    rampMinutes > 0
      ? `，升温 ${(Math.round(((peak.temp - first.temp) / rampMinutes) * 10) / 10)}°C/min`
      : "";
  return `${first.temp}°C 起步 → 峰值 ${peak.temp}°C（${peak.time}min${ramp}）→ 保温 ${holdTime}min → 末段 ${last.temp}°C，全程 ${last.time}min`;
}

/* ---------- 示例数据 ---------- */

export function seedBatches(): Batch[] {
  const mk = (
    id: string,
    customerOrder: string,
    fabric: string,
    gramWeight: number,
    status: Batch["status"],
    createdAt: string,
    versions: Batch["versions"]
  ): Batch => ({ id, customerOrder, fabric, gramWeight, status, createdAt, versions });

  const v = (
    version: number,
    recipe: DyeIngredient[],
    process: ProcessSpec,
    standardLab: LabReading,
    review: Batch["versions"][number]["review"],
    note: string,
    createdAt: string
  ): Batch["versions"][number] => ({
    version,
    recipe,
    process,
    standardLab,
    review,
    note,
    createdAt,
  });

  return [
    mk("LAB-624B", "SO-2026-0196", "混纺斜纹 T/C 65/35", 220, "待评审", "2026-09-23T09:20:00", [
      v(
        1,
        [
          { name: "活性黑 WNN", weight: 3.6 },
          { name: "分散藏青 S-2BG", weight: 1.4 },
          { name: "元明粉", weight: 40 },
          { name: "纯碱", weight: 12 },
        ],
        {
          liquorRatio: 18,
          holdTime: 50,
          finishing: "柔软整理（硅油 2%）",
          tempCurve: [
            { time: 0, temp: 25 },
            { time: 25, temp: 60 },
            { time: 50, temp: 98 },
            { time: 100, temp: 98 },
            { time: 115, temp: 60 },
          ],
        },
        { l: 28.4, a: 1.2, b: -4.6 },
        null,
        "首次登记",
        "2026-09-23T09:20:00"
      ),
    ]),
    mk("LAB-621C", "SO-2026-0191", "涤纶针织", 180, "待复染", "2026-09-22T14:05:00", [
      v(
        1,
        [
          { name: "分散红玉 S-5BL", weight: 1.8 },
          { name: "分散蓝 2BLN", weight: 0.9 },
          { name: "高温匀染剂", weight: 1.0 },
        ],
        {
          liquorRatio: 15,
          holdTime: 30,
          finishing: "热定型 180°C",
          tempCurve: [
            { time: 0, temp: 30 },
            { time: 25, temp: 80 },
            { time: 45, temp: 130 },
            { time: 75, temp: 130 },
            { time: 90, temp: 70 },
          ],
        },
        { l: 40.2, a: 45.6, b: -8.3 },
        {
          sampleLab: { l: 41.9, a: 44.2, b: -7.1 },
          deltaE: 2.3,
          conclusion: "fail",
          reviewedAt: "2026-09-22T16:40:00",
          superseded: false,
        },
        "首次登记",
        "2026-09-22T14:05:00"
      ),
    ]),
    mk("LAB-620A", "SO-2026-0188", "棉府绸", 120, "评审通过", "2026-09-21T10:30:00", [
      v(
        1,
        [
          { name: "活性红 3B", weight: 2.4 },
          { name: "活性黄 3RS", weight: 1.2 },
          { name: "元明粉", weight: 30 },
          { name: "纯碱", weight: 8 },
        ],
        {
          liquorRatio: 20,
          holdTime: 40,
          finishing: "柔软整理",
          tempCurve: [
            { time: 0, temp: 25 },
            { time: 20, temp: 60 },
            { time: 40, temp: 98 },
            { time: 80, temp: 98 },
            { time: 95, temp: 60 },
          ],
        },
        { l: 52.1, a: 38.2, b: 12.5 },
        {
          sampleLab: { l: 52.6, a: 38.7, b: 12.1 },
          deltaE: 0.81,
          conclusion: "pass",
          reviewedAt: "2026-09-21T15:12:00",
          superseded: false,
        },
        "首次登记",
        "2026-09-21T10:30:00"
      ),
    ]),
    mk("LAB-618D", "SO-2026-0175", "锦纶塔夫绸", 90, "已出库", "2026-09-18T08:50:00", [
      v(
        1,
        [
          { name: "酸性蓝 N-BL", weight: 1.5 },
          { name: "酸性黄 A-4R", weight: 0.6 },
          { name: "匀染剂 O", weight: 0.8 },
        ],
        {
          liquorRatio: 25,
          holdTime: 35,
          finishing: "防水整理",
          tempCurve: [
            { time: 0, temp: 25 },
            { time: 20, temp: 70 },
            { time: 35, temp: 95 },
            { time: 70, temp: 95 },
            { time: 85, temp: 55 },
          ],
        },
        { l: 45.8, a: -6.4, b: -32.1 },
        {
          sampleLab: { l: 46.9, a: -5.2, b: -30.6 },
          deltaE: 1.94,
          conclusion: "fail",
          reviewedAt: "2026-09-18T13:25:00",
          superseded: true,
        },
        "首次登记",
        "2026-09-18T08:50:00"
      ),
      v(
        2,
        [
          { name: "酸性蓝 N-BL", weight: 1.2 },
          { name: "酸性黄 A-4R", weight: 0.7 },
          { name: "匀染剂 O", weight: 1.0 },
        ],
        {
          liquorRatio: 25,
          holdTime: 45,
          finishing: "防水整理",
          tempCurve: [
            { time: 0, temp: 25 },
            { time: 25, temp: 70 },
            { time: 45, temp: 95 },
            { time: 90, temp: 95 },
            { time: 105, temp: 55 },
          ],
        },
        { l: 45.8, a: -6.4, b: -32.1 },
        {
          sampleLab: { l: 46.1, a: -6.1, b: -31.7 },
          deltaE: 0.55,
          conclusion: "pass",
          reviewedAt: "2026-09-19T11:02:00",
          superseded: false,
        },
        "复染调整：降蓝增黄，保温延长至 45min",
        "2026-09-18T17:30:00"
      ),
    ]),
  ];
}
