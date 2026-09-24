// 纺织染整小样批次台账 —— 共享数据结构

/** 染料 / 助剂投料项（按投料重量计） */
export interface DyeIngredient {
  id: string;
  /** 物料名称，如 活性红3BS、元明粉 */
  name: string;
  /** 投料重量 g */
  weight: number;
}

/** 温度曲线段 */
export interface CurveSegment {
  id: string;
  /** 起始温度 ℃ */
  fromTemp: number;
  /** 目标温度 ℃（低于起始视为降温段） */
  toTemp: number;
  /** 升降温速率 ℃/min */
  rate: number;
  /** 到温后本段保持时间 min */
  holdMin: number;
}

export type FinishingMethod =
  | "无"
  | "柔软整理"
  | "防水整理"
  | "树脂免烫"
  | "涂层整理"
  | "预缩定型"
  | "磨毛整理";

/** CIELab 三轴读数 */
export interface LabReading {
  L: number;
  a: number;
  b: number;
}

/**
 * 批次评审状态：
 * pending   待评审（尚未录入 Lab 三轴读数，或配方/工艺改动后结论失效）
 * redyeing  复染中（色差 ΔE 超过 1.0 自动转入）
 * passed    评审通过（复染批次须再次评审通过才会进入此状态，可出库）
 * shipped   已出库
 */
export type ReviewStatus = "pending" | "redyeing" | "passed" | "shipped";

/** 一版完整染整工艺 */
export interface ProcessSpec {
  /** 染料配方（投料明细） */
  recipe: DyeIngredient[];
  /** 浴比 1:X */
  liquorRatio: number;
  /** 温度曲线 */
  curve: CurveSegment[];
  /** 保温时间 min */
  holdMinutes: number;
  /** 后整理方式 */
  finishing: FinishingMethod;
  /** 后整理备注，如 柔软剂 2%（o.w.f） */
  finishingNote?: string;
}

/** 一次 Lab 色差评审记录（随版本永久保留） */
export interface ReviewRecord {
  /** 评审轮次，等于当时的版本号 */
  round: number;
  at: string;
  target: LabReading;
  sample: LabReading;
  deltaE: number;
  dL: number;
  da: number;
  db: number;
  pass: boolean;
  /** 色差结论文字 */
  conclusion: string;
}

/** 批次的一个配方/工艺版本 */
export interface BatchVersion {
  version: number;
  createdAt: string;
  reason: string;
  /** 当前生效版本为 true；配方/工艺改动后旧版置为 false，结论保留 */
  active: boolean;
  supersededAt?: string;
  process: ProcessSpec;
  review?: ReviewRecord;
}

export interface BatchLogEntry {
  at: string;
  text: string;
}

export interface Batch {
  /** 批次号，如 LAB-625 */
  id: string;
  /** 客户订单号 */
  orderNo: string;
  /** 客户名称 */
  customer: string;
  /** 面料成分，如 棉100% 府绸 */
  fabric: string;
  /** 面料大类 */
  fabricCategory: FabricCategory;
  /** 克重 g/m² */
  weightGSM: number;
  /** 试样布重 g（用于推算染液量） */
  clothWeightG: number;
  /** 客户标准色（目标 Lab） */
  standardLab?: LabReading;
  note?: string;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
  versions: BatchVersion[];
  log: BatchLogEntry[];
}

export type FabricCategory = "棉" | "涤纶" | "锦纶" | "混纺" | "其他";

export const FABRIC_CATEGORIES: FabricCategory[] = ["棉", "涤纶", "锦纶", "混纺", "其他"];

export const FINISHING_METHODS: FinishingMethod[] = [
  "无",
  "柔软整理",
  "防水整理",
  "树脂免烫",
  "涂层整理",
  "预缩定型",
  "磨毛整理",
];

/* ---------- 页面登记表单草稿（字段全部按字符串保存，便于输入与持久化） ---------- */

export interface DraftRecipeRow {
  id: string;
  name: string;
  weight: string;
}

export interface DraftCurveRow {
  id: string;
  fromTemp: string;
  toTemp: string;
  rate: string;
  holdMin: string;
}

export interface BatchDraft {
  id: string;
  orderNo: string;
  customer: string;
  fabric: string;
  fabricCategory: FabricCategory;
  weightGSM: string;
  clothWeightG: string;
  recipe: DraftRecipeRow[];
  liquorRatio: string;
  curve: DraftCurveRow[];
  holdMinutes: string;
  finishing: FinishingMethod;
  finishingNote: string;
  stdL: string;
  stdA: string;
  stdB: string;
  note: string;
}
