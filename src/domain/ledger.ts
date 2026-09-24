// 业务文件 2：批次账
// 负责批次的登记、筛选、Lab 评审入账、配方/工艺改版（旧版结论保留）、
// 转复染、复染通过后出库，以及台账的本地持久化（重开页面可接着处理）。
// 色差规则本身见 reviewRules.ts，页面操作见 pageState.ts 与组件。

import {
  buildConclusion,
  deltaLab,
  DELTA_E_LIMIT,
} from "./reviewRules";
import type {
  Batch,
  BatchDraft,
  BatchVersion,
  LabReading,
  ProcessSpec,
  ReviewRecord,
  ReviewStatus,
} from "./types";

const STORAGE_KEY = "dye-lab-batch-ledger:v1";

/* ------------------------------------------------------------------ */
/* 编号                                                                */
/* ------------------------------------------------------------------ */

export function nextBatchId(batches: Batch[]): string {
  let max = 619;
  for (const b of batches) {
    const m = /^LAB-(\d+)/.exec(b.id.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `LAB-${max + 1}`;
}

/* ------------------------------------------------------------------ */
/* 草稿转换与校验                                                      */
/* ------------------------------------------------------------------ */

export interface DraftErrors {
  [field: string]: string | undefined;
}

/** 把登记表单草稿转为工艺规格；任何字段不合法都会在 errors 中体现 */
export function draftToProcess(
  draft: BatchDraft,
  errors: DraftErrors = {}
): ProcessSpec {
  const recipe = draft.recipe
    .filter((r) => r.name.trim() !== "" || r.weight.trim() !== "")
    .map((r) => ({
      id: r.id,
      name: r.name.trim(),
      weight: Number(r.weight),
    }));
  recipe.forEach((r, i) => {
    if (!r.name) errors[`recipe.${i}.name`] = "请填写物料名称";
    if (!(r.weight > 0)) errors[`recipe.${i}.weight`] = "投料重量需大于 0";
  });

  const curve = draft.curve
    .filter(
      (c) =>
        c.fromTemp.trim() !== "" ||
        c.toTemp.trim() !== "" ||
        c.rate.trim() !== "" ||
        c.holdMin.trim() !== ""
    )
    .map((c) => ({
      id: c.id,
      fromTemp: Number(c.fromTemp),
      toTemp: Number(c.toTemp),
      rate: Number(c.rate),
      holdMin: Number(c.holdMin),
    }));
  curve.forEach((c, i) => {
    if (!(c.fromTemp >= 0)) errors[`curve.${i}.fromTemp`] = "起始温度无效";
    if (!(c.toTemp >= 0)) errors[`curve.${i}.toTemp`] = "目标温度无效";
    if (!(c.rate > 0)) errors[`curve.${i}.rate`] = "速率需大于 0";
    if (!(c.holdMin >= 0)) errors[`curve.${i}.holdMin`] = "保持时间无效";
  });

  const liquorRatio = Number(draft.liquorRatio);
  if (!(liquorRatio > 0)) errors.liquorRatio = "浴比需大于 0";
  const holdMinutes = Number(draft.holdMinutes);
  if (!(holdMinutes >= 0)) errors.holdMinutes = "保温时间无效";

  return { recipe, liquorRatio, curve, holdMinutes, finishing: draft.finishing, finishingNote: draft.finishingNote.trim() || undefined };
}

function readStandardLab(draft: BatchDraft, errors: DraftErrors): LabReading | undefined {
  const hasInput =
    draft.stdL.trim() !== "" || draft.stdA.trim() !== "" || draft.stdB.trim() !== "";
  if (!hasInput) return undefined;
  const L = Number(draft.stdL);
  const a = Number(draft.stdA);
  const b = Number(draft.stdB);
  if (draft.stdL.trim() === "" || Number.isNaN(L)) errors.stdL = "L 无效";
  if (draft.stdA.trim() === "" || Number.isNaN(a)) errors.stdA = "a 无效";
  if (draft.stdB.trim() === "" || Number.isNaN(b)) errors.stdB = "b 无效";
  return { L: L || 0, a: a || 0, b: b || 0 };
}

/** 登记前整单校验（订单、客户、成分、克重等基础字段 + 工艺） */
export function validateDraft(draft: BatchDraft): DraftErrors {
  const errors: DraftErrors = {};
  if (!draft.id.trim()) errors.id = "请填写批次号";
  if (!draft.orderNo.trim()) errors.orderNo = "请填写客户订单号";
  if (!draft.customer.trim()) errors.customer = "请填写客户名称";
  if (!draft.fabric.trim()) errors.fabric = "请填写面料成分";
  if (!(Number(draft.weightGSM) > 0)) errors.weightGSM = "克重需大于 0";
  if (!(Number(draft.clothWeightG) > 0)) errors.clothWeightG = "试样布重需大于 0";
  draftToProcess(draft, errors);
  readStandardLab(draft, errors);
  return errors;
}

/* ------------------------------------------------------------------ */
/* 版本判定                                                            */
/* ------------------------------------------------------------------ */

function processKey(p: ProcessSpec): string {
  return JSON.stringify({
    recipe: p.recipe
      .map((r) => [r.name, round4(r.weight)])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    liquorRatio: round4(p.liquorRatio),
    curve: p.curve.map((c) => [
      round4(c.fromTemp),
      round4(c.toTemp),
      round4(c.rate),
      round4(c.holdMin),
    ]),
    holdMinutes: round4(p.holdMinutes),
    finishing: p.finishing,
    finishingNote: p.finishingNote ?? "",
  });
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/* ------------------------------------------------------------------ */
/* 登记与改版                                                          */
/* ------------------------------------------------------------------ */

export interface SaveResult {
  ok: boolean;
  errors?: DraftErrors;
  /** 配方/工艺相对上一版发生改动，旧结论已失效并保留 */
  invalidated?: boolean;
  batch?: Batch;
}

/** 新增批次登记；订单重复时给出错误提示（以订单号+批次号区分） */
export function registerBatch(batches: Batch[], draft: BatchDraft): SaveResult {
  const errors = validateDraft(draft);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (batches.some((b) => b.id === draft.id.trim())) {
    return { ok: false, errors: { id: "批次号已存在，请更换" } };
  }
  const now = new Date().toISOString();
  const process = draftToProcess(draft);
  const batch: Batch = {
    id: draft.id.trim(),
    orderNo: draft.orderNo.trim(),
    customer: draft.customer.trim(),
    fabric: draft.fabric.trim(),
    fabricCategory: draft.fabricCategory,
    weightGSM: Number(draft.weightGSM),
    clothWeightG: Number(draft.clothWeightG),
    standardLab: readStandardLab(draft, {}),
    note: draft.note.trim() || undefined,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    versions: [
      {
        version: 1,
        createdAt: now,
        reason: "首次登记小样配方与工艺",
        active: true,
        process,
      },
    ],
    log: [{ at: now, text: `批次登记（订单 ${draft.orderNo.trim()}），等待 Lab 三轴评审` }],
  };
  return { ok: true, batch };
}

/**
 * 修改批次。
 * - 基础信息（订单、客户、成分、克重、标准色、备注）直接更新；
 * - 配方或工艺相对当前生效版本发生改动时：当前版本作废（结论保留在版本内），
 *   新版本状态回到「待评审」，原批次不能再按旧结论出库。
 */
export function saveRevision(batch: Batch, draft: BatchDraft): SaveResult {
  const errors = validateDraft(draft);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const now = new Date().toISOString();
  const next: Batch = {
    ...batch,
    orderNo: draft.orderNo.trim(),
    customer: draft.customer.trim(),
    fabric: draft.fabric.trim(),
    fabricCategory: draft.fabricCategory,
    weightGSM: Number(draft.weightGSM),
    clothWeightG: Number(draft.clothWeightG),
    standardLab: readStandardLab(draft, {}),
    note: draft.note.trim() || undefined,
    updatedAt: now,
    log: [...batch.log],
  };

  const active = activeVersion(batch);
  const newProcess = draftToProcess(draft);
  const changed = processKey(active.process) !== processKey(newProcess);

  if (changed) {
    const oldVersion = active.version;
    next.versions = batch.versions.map((v) =>
      v.version === oldVersion ? { ...v, active: false, supersededAt: now } : v
    );
    next.versions.push({
      version: oldVersion + 1,
      createdAt: now,
      reason:
        batch.status === "redyeing"
          ? "复染：配方/工艺调整后重新投染"
          : "配方或工艺改动，原评审结论失效",
      active: true,
      process: newProcess,
    });
    // 旧结论失效：回到待评审；已出库批次不允许这样改（由 UI 拦截）
    next.status = "pending";
    next.log.push({
      at: now,
      text:
        batch.status === "redyeing"
          ? `复染配方/工艺定稿为 v${oldVersion + 1}，v${oldVersion} 记录保留，等待复染评审`
          : `配方/工艺改动，v${oldVersion} 结论作废并保留，新版 v${oldVersion + 1} 待评审`,
    });
    return { ok: true, invalidated: true, batch: next };
  }

  next.versions = batch.versions;
  next.log.push({ at: now, text: "基础信息更新（配方与工艺未变，原结论保留）" });
  return { ok: true, batch: next };
}

/* ------------------------------------------------------------------ */
/* Lab 三轴评审                                                        */
/* ------------------------------------------------------------------ */

export interface ReviewInput {
  target: LabReading;
  sample: LabReading;
}

/**
 * 录入 Lab 三轴读数并出具色差结论：
 * ΔE>1.0 自动转入复染；ΔE≤1.0 评审通过（复染批次须再次评审通过方可出库）。
 */
export function applyReview(batch: Batch, input: ReviewInput): Batch {
  const now = new Date().toISOString();
  const active = activeVersion(batch);
  const delta = deltaLab(input.target, input.sample);
  const record: ReviewRecord = {
    round: active.version,
    at: now,
    target: input.target,
    sample: input.sample,
    ...delta,
    conclusion: buildConclusion(delta),
  };
  const status: ReviewStatus = delta.pass ? "passed" : "redyeing";
  return {
    ...batch,
    standardLab: input.target,
    status,
    updatedAt: now,
    versions: batch.versions.map((v) =>
      v.version === active.version ? { ...v, review: record } : v
    ),
    log: [
      ...batch.log,
      {
        at: now,
        text: delta.pass
          ? active.version > 1
            ? `复染评审通过（v${active.version}，ΔE ${delta.deltaE.toFixed(2)}），可办理出库`
            : `Lab 评审通过（v${active.version}，ΔE ${delta.deltaE.toFixed(2)}）`
          : `Lab 评审 ΔE ${delta.deltaE.toFixed(2)} 超过 ${DELTA_E_LIMIT.toFixed(1)}，批次转入复染`,
      },
    ],
  };
}

/** 复染中批次：保留已有版本，标记进入修色流程（等待配方/工艺改版后重新投染） */
export function markRedyeing(batch: Batch): Batch {
  if (batch.status === "redyeing" || batch.status === "shipped") return batch;
  const now = new Date().toISOString();
  return {
    ...batch,
    status: "redyeing",
    updatedAt: now,
    log: [...batch.log, { at: now, text: "人工标记转入复染，等待修色改版" }],
  };
}

/** 出库：只有当前生效版本评审通过（含复染再次通过）的批次可出库 */
export function shipBatch(batch: Batch): Batch {
  if (batch.status !== "passed") return batch;
  const now = new Date().toISOString();
  const active = activeVersion(batch);
  return {
    ...batch,
    status: "shipped",
    updatedAt: now,
    log: [
      ...batch.log,
      {
        at: now,
        text:
          active.version > 1
            ? `复染第 ${active.version - 1} 轮后评审通过，办理出库`
            : "评审通过，办理出库",
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* 查询                                                                */
/* ------------------------------------------------------------------ */

export function activeVersion(batch: Batch): BatchVersion {
  return batch.versions.find((v) => v.active) ?? batch.versions[batch.versions.length - 1];
}

export interface BatchFilter {
  orderNo: string;
  status: ReviewStatus | "all";
}

export function filterBatches(batches: Batch[], filter: BatchFilter): Batch[] {
  const kw = filter.orderNo.trim().toLowerCase();
  return batches
    .filter((b) => (filter.status === "all" ? true : b.status === filter.status))
    .filter(
      (b) =>
        !kw ||
        b.orderNo.toLowerCase().includes(kw) ||
        b.id.toLowerCase().includes(kw) ||
        b.customer.toLowerCase().includes(kw)
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function batchStats(batches: Batch[]) {
  const orders = new Set(batches.map((b) => b.orderNo));
  const overdue = batches.filter((b) => b.status === "redyeing").length;
  const reviewable = batches.filter((b) => b.status === "pending" || b.status === "redyeing").length;
  const done = batches.filter((b) => b.status === "passed" || b.status === "shipped").length;
  const passRate = batches.length === 0 ? 0 : Math.round((done / batches.length) * 100);
  return { total: batches.length, orders: orders.size, overdue, reviewable, passRate };
}

/* ------------------------------------------------------------------ */
/* 持久化                                                              */
/* ------------------------------------------------------------------ */

export function loadBatches(): Batch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as Batch[];
      if (Array.isArray(data)) return data;
    }
  } catch {
    /* 数据损坏时回落样例 */
  }
  const seed = seedBatches();
  persist(seed);
  return seed;
}

export function persist(batches: Batch[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(batches));
  } catch {
    /* 存储不可用时仅保留内存态 */
  }
}

/* ------------------------------------------------------------------ */
/* 初始样例卡（3 张：已通过 / 待复染 / 待评审）                          */
/* ------------------------------------------------------------------ */

export function seedBatches(): Batch[] {
  const t1 = "2026-09-18T02:20:00.000Z";
  const t2 = "2026-09-19T06:40:00.000Z";
  const t3 = "2026-09-21T03:10:00.000Z";

  const b1: Batch = {
    id: "LAB-620A",
    orderNo: "PO-2509-118",
    customer: "泓信家纺",
    fabric: "棉100% 府绸",
    fabricCategory: "棉",
    weightGSM: 120,
    clothWeightG: 10,
    standardLab: { L: 62.4, a: 8.1, b: -22.6 },
    status: "passed",
    createdAt: t1,
    updatedAt: t2,
    versions: [
      {
        version: 1,
        createdAt: t1,
        reason: "首次登记小样配方与工艺",
        active: true,
        process: {
          recipe: [
            { id: "s1", name: "活性红3BS", weight: 1.8 },
            { id: "s2", name: "活性黄3RS", weight: 0.45 },
            { id: "s3", name: "元明粉", weight: 40 },
            { id: "s4", name: "纯碱", weight: 15 },
          ],
          liquorRatio: 10,
          curve: [
            { id: "c1", fromTemp: 40, toTemp: 60, rate: 1.5, holdMin: 30 },
            { id: "c2", fromTemp: 60, toTemp: 60, rate: 1, holdMin: 40 },
            { id: "c3", fromTemp: 60, toTemp: 40, rate: 2, holdMin: 10 },
          ],
          holdMinutes: 40,
          finishing: "柔软整理",
          finishingNote: "亲水柔软剂 2%（o.w.f），浸轧一浸一轧",
        },
        review: {
          round: 1,
          at: t2,
          target: { L: 62.4, a: 8.1, b: -22.6 },
          sample: { L: 62.7, a: 8.5, b: -22.2 },
          ...deltaLab({ L: 62.4, a: 8.1, b: -22.6 }, { L: 62.7, a: 8.5, b: -22.2 }),
          conclusion: "",
        },
      },
    ],
    log: [
      { at: t1, text: "批次登记（订单 PO-2509-118），等待 Lab 三轴评审" },
      { at: t2, text: "Lab 评审通过（v1），可办理出库" },
    ],
  };
  const r1 = b1.versions[0].review!;
  r1.conclusion = buildConclusion({
    deltaE: r1.deltaE,
    dL: r1.dL,
    da: r1.da,
    db: r1.db,
    pass: r1.pass,
  });

  const b2: Batch = {
    id: "LAB-621C",
    orderNo: "PO-2509-121",
    customer: "越步运动服饰",
    fabric: "涤纶100% 双面针织",
    fabricCategory: "涤纶",
    weightGSM: 180,
    clothWeightG: 5,
    standardLab: { L: 38.2, a: 2.6, b: -30.4 },
    status: "redyeing",
    createdAt: t2,
    updatedAt: t3,
    versions: [
      {
        version: 1,
        createdAt: t2,
        reason: "首次登记小样配方与工艺",
        active: true,
        process: {
          recipe: [
            { id: "s1", name: "分散蓝2BLN", weight: 1.0 },
            { id: "s2", name: "分散红玉S-5BL", weight: 0.12 },
            { id: "s3", name: "高温匀染剂", weight: 0.05 },
          ],
          liquorRatio: 12,
          curve: [
            { id: "c1", fromTemp: 50, toTemp: 130, rate: 3, holdMin: 0 },
            { id: "c2", fromTemp: 130, toTemp: 130, rate: 1, holdMin: 35 },
            { id: "c3", fromTemp: 130, toTemp: 80, rate: 2, holdMin: 10 },
          ],
          holdMinutes: 35,
          finishing: "无",
        },
        review: {
          round: 1,
          at: t3,
          target: { L: 38.2, a: 2.6, b: -30.4 },
          sample: { L: 37.1, a: 3.9, b: -29.2 },
          ...deltaLab({ L: 38.2, a: 2.6, b: -30.4 }, { L: 37.1, a: 3.9, b: -29.2 }),
          conclusion: "",
        },
      },
    ],
    log: [
      { at: t2, text: "批次登记（订单 PO-2509-121），等待 Lab 三轴评审" },
      { at: t3, text: "Lab 评审色差超限，批次转入复染（v1 结论保留）" },
    ],
  };
  const r2 = b2.versions[0].review!;
  r2.conclusion = buildConclusion({
    deltaE: r2.deltaE,
    dL: r2.dL,
    da: r2.da,
    db: r2.db,
    pass: r2.pass,
  });

  const b3: Batch = {
    id: "LAB-624B",
    orderNo: "PO-2509-133",
    customer: "北辰工装",
    fabric: "涤65/棉35 斜纹",
    fabricCategory: "混纺",
    weightGSM: 240,
    clothWeightG: 8,
    standardLab: { L: 55.6, a: -1.2, b: 4.8 },
    status: "pending",
    createdAt: "2026-09-22T08:00:00.000Z",
    updatedAt: "2026-09-22T08:00:00.000Z",
    versions: [
      {
        version: 1,
        createdAt: "2026-09-22T08:00:00.000Z",
        reason: "首次登记小样配方与工艺",
        active: true,
        process: {
          recipe: [
            { id: "s1", name: "分散黄棕S-2RFL", weight: 0.32 },
            { id: "s2", name: "活性黄KE-4R", weight: 0.22 },
            { id: "s3", name: "元明粉", weight: 32 },
          ],
          liquorRatio: 10,
          curve: [
            { id: "c1", fromTemp: 40, toTemp: 130, rate: 2, holdMin: 0 },
            { id: "c2", fromTemp: 130, toTemp: 130, rate: 1, holdMin: 30 },
            { id: "c3", fromTemp: 130, toTemp: 70, rate: 2, holdMin: 10 },
            { id: "c4", fromTemp: 70, toTemp: 70, rate: 1, holdMin: 20 },
          ],
          holdMinutes: 30,
          finishing: "预缩定型",
          finishingNote: "150℃ 热风定型 45s",
        },
      },
    ],
    log: [{ at: "2026-09-22T08:00:00.000Z", text: "批次登记（订单 PO-2509-133），等待 Lab 三轴评审" }],
  };

  return [b1, b2, b3];
}
