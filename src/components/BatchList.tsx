import { useMemo } from "react";
import type { Batch, LabReading, ReviewStatus } from "../domain/types";
import type { LabDraft } from "../domain/pageState";
import { emptyLabDraft } from "../domain/pageState";
import {
  DELTA_E_LIMIT,
  describeLightness,
  describeRedGreen,
  describeYellowBlue,
  deltaLab,
  liquorVolumeML,
  recipeRatios,
  summarizeCurve,
} from "../domain/reviewRules";
import { activeVersion } from "../domain/ledger";

const STATUS_META: Record<ReviewStatus, { text: string; cls: string }> = {
  pending: { text: "待评审", cls: "st-pending" },
  redyeing: { text: "复染中", cls: "st-redye" },
  passed: { text: "评审通过", cls: "st-pass" },
  shipped: { text: "已出库", cls: "st-ship" },
};

interface Props {
  batches: Batch[];
  expandedIds: string[];
  labDrafts: Record<string, LabDraft>;
  onToggle: (id: string) => void;
  onLabDraft: (id: string, draft: LabDraft) => void;
  onReview: (batch: Batch, target: LabReading, sample: LabReading) => void;
  onRevise: (batch: Batch) => void;
  onMarkRedye: (batch: Batch) => void;
  onShip: (batch: Batch) => void;
}

export default function BatchList(props: Props) {
  const { batches } = props;
  return (
    <section className="panel list-panel">
      <div className="heading">
        <div>
          <p>批次账</p>
          <h2>小样批次台账（{batches.length}）</h2>
        </div>
      </div>
      {batches.length === 0 ? (
        <p className="empty-hint">当前筛选条件下没有批次，调整筛选或新增登记。</p>
      ) : (
        <div className="batch-cards">
          {batches.map((b) => (
            <BatchCard key={b.id} batch={b} {...props} />
          ))}
        </div>
      )}
    </section>
  );
}

function BatchCard({
  batch,
  expandedIds,
  labDrafts,
  onToggle,
  onLabDraft,
  onReview,
  onRevise,
  onMarkRedye,
  onShip,
}: Props & { batch: Batch }) {
  const expanded = expandedIds.includes(batch.id);
  const v = activeVersion(batch);
  const review = v.review;
  const st = STATUS_META[batch.status];

  return (
    <article className={`batch-card ${expanded ? "open" : ""}`}>
      <header className="batch-row" onClick={() => onToggle(batch.id)}>
        <span className="caret">{expanded ? "▾" : "▸"}</span>
        <div className="batch-main">
          <h3>
            {batch.id}
            {v.version > 1 && <em className="ver-tag">v{v.version}</em>}
          </h3>
          <p>
            {batch.orderNo} · {batch.customer} · {batch.fabric} · {batch.weightGSM}g/m²
          </p>
        </div>
        <div className="batch-side">
          <span className={`status-badge ${st.cls}`}>{st.text}</span>
          <span className="de-cell">
            {review ? (
              <>
                ΔE <b className={review.pass ? "de-ok" : "de-bad"}>{review.deltaE.toFixed(2)}</b>
                {v.version !== review.round && <i>（旧读数）</i>}
              </>
            ) : (
              "未评审"
            )}
          </span>
        </div>
      </header>

      {expanded && (
        <div className="batch-detail">
          <div className="detail-grid">
            <DetailBlock title="配方（按投料重量）">
              <RecipeTable batch={batch} />
            </DetailBlock>
            <DetailBlock title="工艺曲线摘要">
              <p className="curve-text">{summarizeCurve(v.process.curve)}</p>
              <ul className="kv-list">
                <li><span>浴比</span><b>1:{v.process.liquorRatio}（染液约 {liquorVolumeML(batch.clothWeightG, v.process.liquorRatio)} mL）</b></li>
                <li><span>保温时间</span><b>{v.process.holdMinutes} min</b></li>
                <li><span>后整理</span><b>{v.process.finishing}{v.process.finishingNote ? `（${v.process.finishingNote}）` : ""}</b></li>
                <li><span>试样布重</span><b>{batch.clothWeightG} g</b></li>
              </ul>
            </DetailBlock>
          </div>

          <ReviewBlock
            batch={batch}
            draft={labDrafts[batch.id] ?? emptyLabDraft()}
            onLabDraft={(d) => onLabDraft(batch.id, d)}
            onReview={(target, sample) => onReview(batch, target, sample)}
          />

          <VersionHistory batch={batch} />
          {batch.note && <p className="batch-note">备注：{batch.note}</p>}

          <div className="card-actions" onClick={(e) => e.stopPropagation()}>
            {batch.status !== "shipped" && (
              <button onClick={() => onRevise(batch)}>
                {batch.status === "redyeing" ? "复染改版（保留旧版）" : "修改配方/工艺"}
              </button>
            )}
            {(batch.status === "pending") && (
              <button onClick={() => onMarkRedye(batch)}>人工转复染</button>
            )}
            {batch.status === "passed" && (
              <button className="primary" onClick={() => onShip(batch)}>
                {v.version > 1 ? "复染通过，办理出库" : "办理出库"}
              </button>
            )}
            {batch.status === "shipped" && <span className="shipped-tag">已出库归档，记录只读</span>}
          </div>
        </div>
      )}
    </article>
  );
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="detail-block">
      <h4>{title}</h4>
      {children}
    </div>
  );
}

function RecipeTable({ batch }: { batch: Batch }) {
  const v = activeVersion(batch);
  const ratios = recipeRatios(v.process.recipe);
  return (
    <div className="recipe-detail">
      {v.process.recipe.map((r, i) => (
        <div className="recipe-line" key={r.id}>
          <span className="rl-name">{r.name}</span>
          <span className="rl-wt">{r.weight} g</span>
          <div className="ratio-cell">
            <div className="ratio-bar"><i style={{ width: `${ratios[i]}%` }} /></div>
            <b>{ratios[i].toFixed(1)}%</b>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReviewBlock({
  batch,
  draft,
  onLabDraft,
  onReview,
}: {
  batch: Batch;
  draft: LabDraft;
  onLabDraft: (d: LabDraft) => void;
  onReview: (target: LabReading, sample: LabReading) => void;
}) {
  const v = activeVersion(batch);
  const std = batch.standardLab;
  const target: LabReading | null = std
    ? { L: std.L, a: std.a, b: std.b }
    : null;

  const sample: LabReading | null = useMemo(() => {
    if (draft.sampleL.trim() === "" || draft.sampleA.trim() === "" || draft.sampleB.trim() === "") return null;
    const s = { L: Number(draft.sampleL), a: Number(draft.sampleA), b: Number(draft.sampleB) };
    if ([s.L, s.a, s.b].some(Number.isNaN)) return null;
    return s;
  }, [draft]);

  const preview = target && sample ? deltaLab(target, sample) : null;
  const locked = batch.status === "shipped" || batch.status === "passed";

  return (
    <div className="detail-block review-block">
      <h4>
        Lab 三轴读数评审（v{v.version}）
        {locked && <em className="lock-hint">{batch.status === "shipped" ? "已出库，不可再评" : "已通过；改动配方/工艺后才能重新评审"}</em>}
      </h4>
      {!target && <p className="curve-text">尚未登记客户标准色，请先在「修改配方/工艺」中补录标准 Lab。</p>}
      {target && (
        <>
          <div className="lab-grid">
            <div className="lab-col lab-target">
              <span>标准色</span>
              <b>L {target.L}</b><b>a {target.a}</b><b>b {target.b}</b>
            </div>
            <div className="lab-col">
              <span>试样读数</span>
              <input type="number" placeholder="L*" value={draft.sampleL} disabled={locked}
                onChange={(e) => onLabDraft({ ...draft, sampleL: e.target.value })} />
              <input type="number" placeholder="a*" value={draft.sampleA} disabled={locked}
                onChange={(e) => onLabDraft({ ...draft, sampleA: e.target.value })} />
              <input type="number" placeholder="b*" value={draft.sampleB} disabled={locked}
                onChange={(e) => onLabDraft({ ...draft, sampleB: e.target.value })} />
            </div>
            {preview && (
              <div className={`lab-verdict ${preview.pass ? "vd-ok" : "vd-bad"}`}>
                <span>色差结论</span>
                <b>ΔE {preview.deltaE.toFixed(2)}</b>
                <small>
                  ΔL {preview.dL.toFixed(2)} {describeLightness(preview.dL)}；
                  Δa {preview.da.toFixed(2)} {describeRedGreen(preview.da)}；
                  Δb {preview.db.toFixed(2)} {describeYellowBlue(preview.db)}
                </small>
                <strong>
                  {preview.pass
                    ? v.version > 1
                      ? "复染评审通过，可出库"
                      : `ΔE≤${DELTA_E_LIMIT.toFixed(1)}，评审通过`
                    : `ΔE>${DELTA_E_LIMIT.toFixed(1)}，提交即转复染`}
                </strong>
              </div>
            )}
          </div>
          <div className="sub-line">
            <button className="primary" disabled={!preview || locked}
              onClick={() => preview && target && sample && onReview(target, sample)}>
              提交三轴读数并出具结论
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function VersionHistory({ batch }: { batch: Batch }) {
  return (
    <div className="detail-block">
      <h4>版本与评审留痕</h4>
      <ol className="version-list">
        {[...batch.versions].reverse().map((ver) => {
          const r = ver.review;
          return (
            <li key={ver.version} className={ver.active ? "ver-active" : "ver-old"}>
              <div className="ver-head">
                <b>v{ver.version}{ver.active ? "（生效中）" : "（已作废，结论保留）"}</b>
                <span>{ver.reason} · {fmtTime(ver.createdAt)}</span>
              </div>
              {r ? (
                <p className={r.pass ? "ver-pass" : "ver-fail"}>
                  第{r.round}轮评审（{fmtTime(r.at)}）：{r.conclusion}
                </p>
              ) : (
                <p className="ver-none">该版本尚无评审记录</p>
              )}
            </li>
          );
        })}
      </ol>
      <details className="log-details">
        <summary>批次操作日志（{batch.log.length}）</summary>
        <ul>
          {[...batch.log].reverse().map((l, i) => (
            <li key={i}>{fmtTime(l.at)} · {l.text}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
