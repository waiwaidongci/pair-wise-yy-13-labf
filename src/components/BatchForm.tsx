import { useMemo } from "react";
import { FABRIC_CATEGORIES, FINISHING_METHODS } from "../domain/types";
import type {
  Batch,
  BatchDraft,
  DraftCurveRow,
  DraftRecipeRow,
  FabricCategory,
  FinishingMethod,
} from "../domain/types";
import { recipeRatios, liquorVolumeML } from "../domain/reviewRules";
import type { DraftErrors } from "../domain/ledger";
import { uid } from "../domain/pageState";

interface Props {
  draft: BatchDraft;
  errors: DraftErrors;
  editing?: Batch;
  onChange: (draft: BatchDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export default function BatchForm({ draft, errors, editing, onChange, onSubmit, onCancel }: Props) {
  const set = (patch: Partial<BatchDraft>) => onChange({ ...draft, ...patch });

  const ratios = useMemo(
    () =>
      recipeRatios(
        draft.recipe.map((r) => ({ weight: Number(r.weight) || 0 }))
      ),
    [draft.recipe]
  );
  const recipeTotal = draft.recipe.reduce((s, r) => s + (Number(r.weight) || 0), 0);
  const bathML = Number(draft.clothWeightG) > 0 && Number(draft.liquorRatio) > 0
    ? liquorVolumeML(Number(draft.clothWeightG), Number(draft.liquorRatio))
    : 0;

  const setRecipe = (i: number, patch: Partial<DraftRecipeRow>) =>
    set({ recipe: draft.recipe.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) });
  const setCurve = (i: number, patch: Partial<DraftCurveRow>) =>
    set({ curve: draft.curve.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) });

  const invalidationWarning: string | null = (() => {
    if (!editing) return null;
    const ed: Batch = editing;
    return ed.status === "redyeing"
      ? "复染批次：保存配方/工艺改动后生成复染版本，须再次 Lab 评审通过才能出库；旧版结论保留可查。"
      : "配方或工艺一旦改动，当前评审结论立即失效（旧版保留），批次回到待评审。";
  })();

  return (
    <section className="panel form-panel">
      <div className="heading">
        <div>
          <p>{editing ? `改版登记 · ${editing.id}` : "新增小样批次"}</p>
          <h2>{editing ? "配方 / 工艺改版" : "批次台账登记"}</h2>
        </div>
        <div className="heading-actions">
          <button type="button" onClick={onCancel}>取消</button>
          <button type="button" className="primary" onClick={onSubmit}>
            {editing ? "保存改版" : "登记批次"}
          </button>
        </div>
      </div>

      {invalidationWarning && (
        <div className={`warn-banner ${editing?.status === "redyeing" ? "warn-redye" : ""}`}>
          {invalidationWarning}
        </div>
      )}

      <fieldset>
        <legend>客户与面料</legend>
        <div className="field-grid">
          <label className={errors.id ? "invalid" : ""}>
            <span>批次号 *</span>
            <input value={draft.id} disabled={!!editing} onChange={(e) => set({ id: e.target.value })} placeholder="LAB-625" />
            {errors.id && <em>{errors.id}</em>}
          </label>
          <label className={errors.orderNo ? "invalid" : ""}>
            <span>客户订单号 *</span>
            <input value={draft.orderNo} onChange={(e) => set({ orderNo: e.target.value })} placeholder="PO-2509-118" />
            {errors.orderNo && <em>{errors.orderNo}</em>}
          </label>
          <label className={errors.customer ? "invalid" : ""}>
            <span>客户名称 *</span>
            <input value={draft.customer} onChange={(e) => set({ customer: e.target.value })} placeholder="客户 / 品牌" />
            {errors.customer && <em>{errors.customer}</em>}
          </label>
          <label>
            <span>面料大类</span>
            <select
              value={draft.fabricCategory}
              onChange={(e) => set({ fabricCategory: e.target.value as FabricCategory })}
            >
              {FABRIC_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className={errors.fabric ? "invalid" : ""}>
            <span>面料成分 *</span>
            <input value={draft.fabric} onChange={(e) => set({ fabric: e.target.value })} placeholder="棉100% 府绸" />
            {errors.fabric && <em>{errors.fabric}</em>}
          </label>
          <div className="field-row">
            <label className={errors.weightGSM ? "invalid" : ""}>
              <span>克重 g/m² *</span>
              <input type="number" min="0" value={draft.weightGSM} onChange={(e) => set({ weightGSM: e.target.value })} />
              {errors.weightGSM && <em>{errors.weightGSM}</em>}
            </label>
            <label className={errors.clothWeightG ? "invalid" : ""}>
              <span>试样布重 g *</span>
              <input type="number" min="0" value={draft.clothWeightG} onChange={(e) => set({ clothWeightG: e.target.value })} />
              {errors.clothWeightG && <em>{errors.clothWeightG}</em>}
            </label>
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>染料配方（按投料重量显示比例）</legend>
        <div className="recipe-list">
          <div className="recipe-head">
            <span>物料（染料 / 助剂）</span>
            <span>投料重量 g</span>
            <span>重量占比</span>
            <span />
          </div>
          {draft.recipe.map((row, i) => (
            <div className="recipe-row" key={row.id}>
              <input
                value={row.name}
                className={errors[`recipe.${i}.name`] ? "invalid" : ""}
                placeholder="如 活性红3BS"
                onChange={(e) => setRecipe(i, { name: e.target.value })}
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={row.weight}
                className={errors[`recipe.${i}.weight`] ? "invalid" : ""}
                onChange={(e) => setRecipe(i, { weight: e.target.value })}
              />
              <div className="ratio-cell">
                <div className="ratio-bar"><i style={{ width: `${ratios[i] || 0}%` }} /></div>
                <b>{(ratios[i] || 0).toFixed(1)}%</b>
              </div>
              <button
                type="button"
                className="icon-btn"
                disabled={draft.recipe.length <= 1}
                onClick={() => set({ recipe: draft.recipe.filter((_, idx) => idx !== i) })}
              >
                删除
              </button>
            </div>
          ))}
        </div>
        <div className="sub-line">
          <button type="button" onClick={() => set({ recipe: [...draft.recipe, { id: uid("r"), name: "", weight: "" }] })}>
            + 添加物料
          </button>
          <span>配方总投料 <b>{recipeTotal.toFixed(2)} g</b></span>
        </div>
      </fieldset>

      <fieldset>
        <legend>染整工艺</legend>
        <div className="field-grid">
          <div className="field-row">
            <label className={errors.liquorRatio ? "invalid" : ""}>
              <span>浴比 1:X *</span>
              <input type="number" min="0" step="0.5" value={draft.liquorRatio} onChange={(e) => set({ liquorRatio: e.target.value })} />
              {errors.liquorRatio && <em>{errors.liquorRatio}</em>}
            </label>
            <label>
              <span>推算染液量</span>
              <input value={bathML > 0 ? `${bathML} mL` : "填写布重与浴比"} disabled />
            </label>
            <label className={errors.holdMinutes ? "invalid" : ""}>
              <span>保温时间 min *</span>
              <input type="number" min="0" value={draft.holdMinutes} onChange={(e) => set({ holdMinutes: e.target.value })} />
              {errors.holdMinutes && <em>{errors.holdMinutes}</em>}
            </label>
          </div>
          <div className="field-row">
            <label>
              <span>后整理方式</span>
              <select value={draft.finishing} onChange={(e) => set({ finishing: e.target.value as FinishingMethod })}>
                {FINISHING_METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="wide">
              <span>后整理备注（用量 / 工艺条件）</span>
              <input value={draft.finishingNote} onChange={(e) => set({ finishingNote: e.target.value })} placeholder="如 柔软剂 2%（o.w.f），150℃定型45s" />
            </label>
          </div>
        </div>

        <div className="curve-head-row">
          <span>温度曲线（从低温到出布，按序）</span>
        </div>
        <div className="curve-list">
          <div className="recipe-head">
            <span>起始℃</span><span>目标℃</span><span>速率℃/min</span><span>到温保持 min</span><span />
          </div>
          {draft.curve.map((row, i) => (
            <div className="recipe-row" key={row.id}>
              <input type="number" value={row.fromTemp} className={errors[`curve.${i}.fromTemp`] ? "invalid" : ""} onChange={(e) => setCurve(i, { fromTemp: e.target.value })} />
              <input type="number" value={row.toTemp} className={errors[`curve.${i}.toTemp`] ? "invalid" : ""} onChange={(e) => setCurve(i, { toTemp: e.target.value })} />
              <input type="number" step="0.1" value={row.rate} className={errors[`curve.${i}.rate`] ? "invalid" : ""} onChange={(e) => setCurve(i, { rate: e.target.value })} />
              <input type="number" value={row.holdMin} className={errors[`curve.${i}.holdMin`] ? "invalid" : ""} onChange={(e) => setCurve(i, { holdMin: e.target.value })} />
              <button
                type="button"
                className="icon-btn"
                disabled={draft.curve.length <= 1}
                onClick={() => set({ curve: draft.curve.filter((_, idx) => idx !== i) })}
              >
                删除
              </button>
            </div>
          ))}
        </div>
        <div className="sub-line">
          <button type="button" onClick={() =>
            set({
              curve: [...draft.curve, {
                id: uid("c"),
                fromTemp: draft.curve.length ? draft.curve[draft.curve.length - 1].toTemp : "40",
                toTemp: "",
                rate: "1.5",
                holdMin: "0",
              }],
            })
          }>
            + 添加曲线段
          </button>
        </div>
      </fieldset>

      <fieldset>
        <legend>客户标准色 Lab（可选，评审时仍可修改）</legend>
        <div className="field-row">
          <label className={errors.stdL ? "invalid" : ""}>
            <span>L* 明度</span>
            <input type="number" value={draft.stdL} onChange={(e) => set({ stdL: e.target.value })} />
            {errors.stdL && <em>{errors.stdL}</em>}
          </label>
          <label className={errors.stdA ? "invalid" : ""}>
            <span>a* 红(+)/绿(-)</span>
            <input type="number" value={draft.stdA} onChange={(e) => set({ stdA: e.target.value })} />
            {errors.stdA && <em>{errors.stdA}</em>}
          </label>
          <label className={errors.stdB ? "invalid" : ""}>
            <span>b* 黄(+)/蓝(-)</span>
            <input type="number" value={draft.stdB} onChange={(e) => set({ stdB: e.target.value })} />
            {errors.stdB && <em>{errors.stdB}</em>}
          </label>
        </div>
      </fieldset>

      <label className="note-label">
        <span>备注</span>
        <input value={draft.note} onChange={(e) => set({ note: e.target.value })} placeholder="来样要求、对光条件等" />
      </label>
    </section>
  );
}
