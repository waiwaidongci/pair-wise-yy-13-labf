// 业务文件 3：页面操作状态
// 只管页面交互状态：客户订单/评审状态筛选、批次展开、当前编辑对象、
// 登记/改版表单草稿与 Lab 读数草稿的持久化（重开页面接着处理）。
// 批次数据本身由 ledger.ts 管理，二者各存一份 localStorage，互不耦合。

import type { Batch, BatchDraft, FinishingMethod, ReviewStatus } from "./types";
import { FINISHING_METHODS } from "./types";

const UI_KEY = "dye-lab-page-state:v1";
const DRAFT_KEY = "dye-lab-batch-draft:v1";

let seq = 0;
export function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

export interface LabDraft {
  sampleL: string;
  sampleA: string;
  sampleB: string;
}

export interface PageState {
  filterOrderNo: string;
  filterStatus: ReviewStatus | "all";
  expandedIds: string[];
  /** 各批次未提交的 Lab 试样读数草稿，按批次号存放 */
  labDrafts: Record<string, LabDraft>;
}

export const DEFAULT_PAGE_STATE: PageState = {
  filterOrderNo: "",
  filterStatus: "all",
  expandedIds: [],
  labDrafts: {},
};

export function loadPageState(): PageState {
  try {
    const raw = localStorage.getItem(UI_KEY);
    if (raw) return { ...DEFAULT_PAGE_STATE, ...(JSON.parse(raw) as Partial<PageState>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_PAGE_STATE };
}

export function savePageState(state: PageState): void {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* 表单草稿                                                            */
/* ------------------------------------------------------------------ */

export function emptyDraft(suggestedId: string): BatchDraft {
  return {
    id: suggestedId,
    orderNo: "",
    customer: "",
    fabric: "",
    fabricCategory: "棉",
    weightGSM: "",
    clothWeightG: "",
    recipe: [
      { id: uid("r"), name: "", weight: "" },
      { id: uid("r"), name: "", weight: "" },
    ],
    liquorRatio: "10",
    curve: [{ id: uid("c"), fromTemp: "40", toTemp: "60", rate: "1.5", holdMin: "30" }],
    holdMinutes: "30",
    finishing: "无",
    finishingNote: "",
    stdL: "",
    stdA: "",
    stdB: "",
    note: "",
  };
}

export function loadDraft(suggestedId: string): BatchDraft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { draft?: BatchDraft };
      if (saved.draft) return ensureDraftShape(saved.draft, suggestedId);
    }
  } catch {
    /* ignore */
  }
  return emptyDraft(suggestedId);
}

export function saveDraft(draft: BatchDraft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ draft }));
  } catch {
    /* ignore */
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/** 老版本草稿可能缺字段，补齐后再使用 */
function ensureDraftShape(d: Partial<BatchDraft>, suggestedId: string): BatchDraft {
  const base = emptyDraft(suggestedId);
  return {
    ...base,
    ...d,
    id: d.id || suggestedId,
    recipe: (d.recipe ?? base.recipe).map((r) => ({
      id: r.id || uid("r"),
      name: r.name ?? "",
      weight: r.weight ?? "",
    })),
    curve: (d.curve ?? base.curve).map((c) => ({
      id: c.id || uid("c"),
      fromTemp: c.fromTemp ?? "",
      toTemp: c.toTemp ?? "",
      rate: c.rate ?? "",
      holdMin: c.holdMin ?? "",
    })),
    finishing: FINISHING_METHODS.includes(d.finishing as FinishingMethod)
      ? (d.finishing as FinishingMethod)
      : base.finishing,
  };
}

export function emptyLabDraft(): LabDraft {
  return { sampleL: "", sampleA: "", sampleB: "" };
}

/** 把批次当前生效版本装入表单草稿（用于改版/复染投染） */
export function batchToDraft(batch: Batch): BatchDraft {
  const v = batch.versions.find((x) => x.active) ?? batch.versions[batch.versions.length - 1];
  const p = v.process;
  return {
    id: batch.id,
    orderNo: batch.orderNo,
    customer: batch.customer,
    fabric: batch.fabric,
    fabricCategory: batch.fabricCategory,
    weightGSM: String(batch.weightGSM),
    clothWeightG: String(batch.clothWeightG),
    recipe: p.recipe.map((r) => ({ id: uid("r"), name: r.name, weight: String(r.weight) })),
    liquorRatio: String(p.liquorRatio),
    curve: p.curve.map((c) => ({
      id: uid("c"),
      fromTemp: String(c.fromTemp),
      toTemp: String(c.toTemp),
      rate: String(c.rate),
      holdMin: String(c.holdMin),
    })),
    holdMinutes: String(p.holdMinutes),
    finishing: p.finishing,
    finishingNote: p.finishingNote ?? "",
    stdL: batch.standardLab ? String(batch.standardLab.L) : "",
    stdA: batch.standardLab ? String(batch.standardLab.a) : "",
    stdB: batch.standardLab ? String(batch.standardLab.b) : "",
    note: batch.note ?? "",
  };
}
