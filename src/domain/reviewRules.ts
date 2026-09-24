// 评审规则：Lab 色差计算、结论判定、状态流转与出库门槛
import type {
  Batch,
  BatchStatus,
  BatchVersion,
  LabReading,
  ReviewConclusion,
  ReviewRecord,
} from "./types";

/** 色差限值：ΔE 超过 1.0 即转入复染 */
export const DELTA_E_LIMIT = 1.0;

export const STATUS_OPTIONS: BatchStatus[] = ["待评审", "待复染", "评审通过", "已出库"];

/** CIE76 色差：ΔE = √(ΔL² + Δa² + Δb²)，保留两位小数 */
export function deltaE76(standard: LabReading, sample: LabReading): number {
  const dl = sample.l - standard.l;
  const da = sample.a - standard.a;
  const db = sample.b - standard.b;
  return Math.round(Math.sqrt(dl * dl + da * da + db * db) * 100) / 100;
}

/** 录入小样 Lab 三轴读数后给出评审结论 */
export function evaluateLab(
  standard: LabReading,
  sampleLab: LabReading,
  reviewedAt: string = new Date().toISOString()
): ReviewRecord {
  const deltaE = deltaE76(standard, sampleLab);
  return {
    sampleLab,
    deltaE,
    conclusion: deltaE > DELTA_E_LIMIT ? "fail" : "pass",
    reviewedAt,
    superseded: false,
  };
}

export function currentVersion(batch: Batch): BatchVersion {
  return batch.versions[batch.versions.length - 1];
}

/** 评审后的批次状态：通过 → 评审通过；超限 → 待复染 */
export function statusAfterReview(conclusion: ReviewConclusion): BatchStatus {
  return conclusion === "pass" ? "评审通过" : "待复染";
}

/**
 * 出库门槛：只有当前版本评审通过才允许出库。
 * 复染批次必须在新版本上重新评审通过；旧版本结论不能作为出库依据。
 */
export function canOutbound(batch: Batch): boolean {
  if (batch.status === "已出库") return false;
  const review = currentVersion(batch).review;
  return !!review && !review.superseded && review.conclusion === "pass";
}

export function conclusionLabel(conclusion: ReviewConclusion): string {
  return conclusion === "pass" ? "色差合格" : "色差超限";
}
