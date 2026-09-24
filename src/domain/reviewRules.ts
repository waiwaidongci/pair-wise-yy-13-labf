// 业务文件 1：评审规则
// 只负责 Lab 三轴色差计算、色差结论生成、复染判定。
// 规则：ΔE*ab = sqrt(ΔL² + Δa² + Δb²)，ΔE 超过 1.0 的批次判定不合格并转入复染。
// 与批次账（数据）、页面（交互）解耦，规则阈值在此集中维护。

import type { LabReading } from "./types";

/** 色差合格上限（ΔE*ab），超过即转复染 */
export const DELTA_E_LIMIT = 1.0;

/** 单轴偏色描述阈值：|Δ| 小于该值视为该轴无明显偏差 */
export const SHADE_TONE_EPS = 0.15;

export interface ColorDelta {
  deltaE: number;
  dL: number;
  da: number;
  db: number;
  pass: boolean;
}

export function deltaLab(target: LabReading, sample: LabReading): ColorDelta {
  const dL = round2(sample.L - target.L);
  const da = round2(sample.a - target.a);
  const db = round2(sample.b - target.b);
  const deltaE = round2(Math.sqrt(dL * dL + da * da + db * db));
  return { deltaE, dL, da, db, pass: deltaE <= DELTA_E_LIMIT };
}

/** L 轴明暗结论 */
export function describeLightness(dL: number): string {
  if (Math.abs(dL) < SHADE_TONE_EPS) return "明度一致";
  return dL > 0 ? "偏浅（明）" : "偏深（暗）";
}

/** a 轴红绿结论 */
export function describeRedGreen(da: number): string {
  if (Math.abs(da) < SHADE_TONE_EPS) return "红绿方向无明显偏差";
  return da > 0 ? "偏红" : "偏绿";
}

/** b 轴黄蓝结论 */
export function describeYellowBlue(db: number): string {
  if (Math.abs(db) < SHADE_TONE_EPS) return "黄蓝方向无明显偏差";
  return db > 0 ? "偏黄" : "偏蓝";
}

/**
 * 由三轴读数生成完整色差结论。
 * 合格：ΔE≤1.0，附偏色方向，供对样参考；
 * 超限：ΔE>1.0，明确判不合格、转入复染，附主要偏差方向作为修色提示。
 */
export function buildConclusion(delta: ColorDelta): string {
  const { deltaE, dL, da, db, pass } = delta;
  const axes = `${describeLightness(dL)}、${describeRedGreen(da)}、${describeYellowBlue(db)}`;
  if (pass) {
    return `ΔE ${deltaE.toFixed(2)} ≤ ${DELTA_E_LIMIT.toFixed(1)}，评审通过；三轴：${axes}。`;
  }
  const lead = dominantAxis(dL, da, db);
  return `ΔE ${deltaE.toFixed(2)} > ${DELTA_E_LIMIT.toFixed(1)}，色差超限判不合格，转入复染；主要偏差：${lead}；三轴：${axes}。`;
}

/** 找出偏差最大的轴，作为修色方向提示 */
export function dominantAxis(dL: number, da: number, db: number): string {
  const entries: Array<[string, number]> = [
    [describeLightness(dL), Math.abs(dL)],
    [describeRedGreen(da), Math.abs(da)],
    [describeYellowBlue(db), Math.abs(db)],
  ];
  entries.sort((x, y) => y[1] - x[1]);
  return entries[0][0];
}

/** 温度曲线摘要：如 40℃ →1.5℃/min→ 98℃ 保温45min → 水洗降温至70℃，全程约84min */
export function summarizeCurve(
  curve: { fromTemp: number; toTemp: number; rate: number; holdMin: number }[]
): string {
  if (curve.length === 0) return "未登记温度曲线";
  const parts: string[] = [];
  let total = 0;
  curve.forEach((seg, i) => {
    const span = Math.abs(seg.toTemp - seg.fromTemp);
    const ramp = seg.rate > 0 ? span / seg.rate : 0;
    total += ramp + seg.holdMin;
    const trend = seg.toTemp > seg.fromTemp ? "升温" : seg.toTemp < seg.fromTemp ? "降温" : "恒温";
    if (i === 0) {
      parts.push(`${seg.fromTemp}℃起`);
    }
    parts.push(
      `${trend}${seg.rate > 0 ? seg.rate.toFixed(1) + "℃/min" : ""}至${seg.toTemp}℃` +
        (seg.holdMin > 0 ? `，保温${seg.holdMin}min` : "")
    );
  });
  return parts.join(" → ") + `；全程约${Math.round(total)}min`;
}

/** 配方按投料重量显示比例：每项占配方总投料重量的百分比 */
export function recipeRatios(recipe: { weight: number }[]): number[] {
  const total = recipe.reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
  if (total <= 0) return recipe.map(() => 0);
  return recipe.map((item) => (Number(item.weight) / total) * 100);
}

/** 浴比换算染液量 mL（布重 g × 浴比倍数） */
export function liquorVolumeML(clothWeightG: number, liquorRatio: number): number {
  return round2(clothWeightG * liquorRatio);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
