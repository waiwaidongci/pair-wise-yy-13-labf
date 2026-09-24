// 纺织染整小样批次台账 —— 数据模型

/** Lab 三轴读数 */
export interface LabReading {
  l: number;
  a: number;
  b: number;
}

/** 染料配方中的一行投料 */
export interface DyeIngredient {
  name: string;
  /** 投料重量 g */
  weight: number;
}

/** 温度曲线上的一个点 */
export interface TempPoint {
  /** 时间 min */
  time: number;
  /** 温度 °C */
  temp: number;
}

/** 染色工艺参数 */
export interface ProcessSpec {
  /** 浴比 1:X 中的 X */
  liquorRatio: number;
  /** 保温时间 min */
  holdTime: number;
  tempCurve: TempPoint[];
  /** 后整理方式 */
  finishing: string;
}

export type ReviewConclusion = "pass" | "fail";

/** 一次色差评审结论 */
export interface ReviewRecord {
  sampleLab: LabReading;
  deltaE: number;
  conclusion: ReviewConclusion;
  reviewedAt: string;
  /** 配方或工艺改动后，原结论置为失效（记录保留） */
  superseded: boolean;
}

/** 配方/工艺的一个版本（复染或改动会产生新版本） */
export interface BatchVersion {
  version: number;
  recipe: DyeIngredient[];
  process: ProcessSpec;
  /** 标准样 Lab */
  standardLab: LabReading;
  review: ReviewRecord | null;
  /** 改版说明 */
  note: string;
  createdAt: string;
}

export type BatchStatus = "待评审" | "待复染" | "评审通过" | "已出库";

/** 小样批次 */
export interface Batch {
  id: string;
  customerOrder: string;
  /** 面料成分 */
  fabric: string;
  /** 克重 g/m² */
  gramWeight: number;
  status: BatchStatus;
  versions: BatchVersion[];
  createdAt: string;
}
