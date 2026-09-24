// 页面操作：批次台账列表、登记/改版表单、Lab 评审录入、筛选与展开
import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import type {
  Batch,
  BatchStatus,
  LabReading,
  TempPoint,
} from "./domain/types";
import {
  createBatch,
  loadLedger,
  outboundBatch,
  recipeProportions,
  resetLedger,
  reviewBatch,
  reviseBatch,
  saveLedger,
  summarizeCurve,
} from "./domain/batchLedger";
import {
  canOutbound,
  conclusionLabel,
  currentVersion,
  DELTA_E_LIMIT,
  STATUS_OPTIONS,
} from "./domain/reviewRules";

/* ---------- 小工具 ---------- */

const STATUS_CLASS: Record<BatchStatus, string> = {
  待评审: "st-pending",
  待复染: "st-redye",
  评审通过: "st-pass",
  已出库: "st-out",
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtLab(lab: LabReading): string {
  return `L ${lab.l.toFixed(1)} · a ${lab.a.toFixed(1)} · b ${lab.b.toFixed(1)}`;
}

/* ---------- 表单数据结构 ---------- */

interface IngredientRow {
  name: string;
  weight: string;
}
interface CurveRow {
  time: string;
  temp: string;
}
interface FormState {
  customerOrder: string;
  fabric: string;
  gramWeight: string;
  ingredients: IngredientRow[];
  liquorRatio: string;
  holdTime: string;
  curve: CurveRow[];
  finishing: string;
  stdL: string;
  stdA: string;
  stdB: string;
  note: string;
}

const emptyForm = (): FormState => ({
  customerOrder: "",
  fabric: "",
  gramWeight: "",
  ingredients: [
    { name: "", weight: "" },
    { name: "", weight: "" },
  ],
  liquorRatio: "20",
  holdTime: "40",
  curve: [
    { time: "0", temp: "25" },
    { time: "", temp: "" },
  ],
  finishing: "",
  stdL: "",
  stdA: "",
  stdB: "",
  note: "",
});

function formFromBatch(batch: Batch): FormState {
  const v = currentVersion(batch);
  return {
    customerOrder: batch.customerOrder,
    fabric: batch.fabric,
    gramWeight: String(batch.gramWeight),
    ingredients: v.recipe.map((r) => ({ name: r.name, weight: String(r.weight) })),
    liquorRatio: String(v.process.liquorRatio),
    holdTime: String(v.process.holdTime),
    curve: v.process.tempCurve.map((p) => ({ time: String(p.time), temp: String(p.temp) })),
    finishing: v.process.finishing,
    stdL: String(v.standardLab.l),
    stdA: String(v.standardLab.a),
    stdB: String(v.standardLab.b),
    note: "",
  };
}

/** 解析并校验表单；失败时 alert 并返回 null */
function parseForm(f: FormState, mode: "create" | "revise") {
  const num = (s: string) => Number(s.trim());
  if (mode === "create") {
    if (!f.customerOrder.trim()) return alert("请填写客户订单号"), null;
    if (!f.fabric.trim()) return alert("请填写面料成分"), null;
    if (!(num(f.gramWeight) > 0)) return alert("请填写正确的克重"), null;
  }
  const recipe = f.ingredients
    .filter((r) => r.name.trim() || r.weight.trim())
    .map((r) => ({ name: r.name.trim(), weight: num(r.weight) }));
  if (recipe.length === 0 || recipe.some((r) => !r.name || !(r.weight > 0)))
    return alert("染料配方至少需要一行，且名称与投料重量(g)都要填对"), null;
  const curve: TempPoint[] = f.curve
    .filter((c) => c.time.trim() || c.temp.trim())
    .map((c) => ({ time: num(c.time), temp: num(c.temp) }));
  if (curve.length < 2 || curve.some((c) => Number.isNaN(c.time) || Number.isNaN(c.temp)))
    return alert("温度曲线至少需要两个有效的时间-温度点"), null;
  if (!(num(f.liquorRatio) > 0)) return alert("请填写正确的浴比"), null;
  if (!(num(f.holdTime) > 0)) return alert("请填写正确的保温时间"), null;
  const standardLab = { l: num(f.stdL), a: num(f.stdA), b: num(f.stdB) };
  if ([standardLab.l, standardLab.a, standardLab.b].some(Number.isNaN))
    return alert("请填写标准样的 Lab 三轴读数"), null;
  return {
    customerOrder: f.customerOrder.trim(),
    fabric: f.fabric.trim(),
    gramWeight: num(f.gramWeight),
    spec: {
      recipe,
      process: {
        liquorRatio: num(f.liquorRatio),
        holdTime: num(f.holdTime),
        tempCurve: curve,
        finishing: f.finishing.trim() || "未登记",
      },
      standardLab,
    },
    note: f.note.trim(),
  };
}

/* ---------- 表单组件（登记新批次 / 改版复染共用） ---------- */

function BatchForm(props: {
  mode: "create" | "revise";
  initial: FormState;
  onSubmit: (f: FormState) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<FormState>(props.initial);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setF((p) => ({ ...p, [k]: v }));
  const setIngredient = (i: number, field: keyof IngredientRow, value: string) =>
    setF((p) => {
      const rows = [...p.ingredients];
      rows[i] = { ...rows[i], [field]: value };
      return { ...p, ingredients: rows };
    });
  const setCurvePoint = (i: number, field: keyof CurveRow, value: string) =>
    setF((p) => {
      const rows = [...p.curve];
      rows[i] = { ...rows[i], [field]: value };
      return { ...p, curve: rows };
    });
  const addRow = (key: "ingredients" | "curve") =>
    setF((p) =>
      key === "ingredients"
        ? { ...p, ingredients: [...p.ingredients, { name: "", weight: "" }] }
        : { ...p, curve: [...p.curve, { time: "", temp: "" }] }
    );
  const removeRow = (key: "ingredients" | "curve", i: number) =>
    setF((p) =>
      key === "ingredients"
        ? { ...p, ingredients: p.ingredients.filter((_, x) => x !== i) }
        : { ...p, curve: p.curve.filter((_, x) => x !== i) }
    );

  return (
    <section className="panel form-panel">
      <div className="heading">
        <div>
          <p>{props.mode === "create" ? "登记新小样" : "配方 / 工艺改动"}</p>
          <h2>{props.mode === "create" ? "新增批次" : "生成新版本（原评审结论将失效并保留）"}</h2>
        </div>
        <div className="row-actions">
          <button onClick={props.onCancel}>取消</button>
          <button className="primary" onClick={() => props.onSubmit(f)}>
            {props.mode === "create" ? "登记入台账" : "保存为新版本"}
          </button>
        </div>
      </div>

      {props.mode === "create" && (
        <div className="field-grid">
          <label>
            <span>客户订单号</span>
            <input
              value={f.customerOrder}
              onChange={(e) => set("customerOrder", e.target.value)}
              placeholder="如 SO-2026-0201"
            />
          </label>
          <label>
            <span>面料成分</span>
            <input
              value={f.fabric}
              onChange={(e) => set("fabric", e.target.value)}
              placeholder="如 棉府绸 / 涤纶针织 / T/C 65/35"
            />
          </label>
          <label>
            <span>克重 g/m²</span>
            <input
              type="number"
              value={f.gramWeight}
              onChange={(e) => set("gramWeight", e.target.value)}
              placeholder="如 120"
            />
          </label>
          <label>
            <span>后整理方式</span>
            <input
              value={f.finishing}
              onChange={(e) => set("finishing", e.target.value)}
              placeholder="如 柔软整理 / 防水整理 / 热定型"
            />
          </label>
        </div>
      )}
      {props.mode === "revise" && (
        <div className="field-grid">
          <label className="span-2">
            <span>改版说明（复染原因 / 调整内容）</span>
            <input
              value={f.note}
              onChange={(e) => set("note", e.target.value)}
              placeholder="如 复染调整：降红增蓝，保温延长至 50min"
            />
          </label>
          <label>
            <span>后整理方式</span>
            <input
              value={f.finishing}
              onChange={(e) => set("finishing", e.target.value)}
            />
          </label>
        </div>
      )}

      <h3 className="sub-title">染料配方（按投料重量计比例）</h3>
      <div className="rows">
        {f.ingredients.map((r, i) => (
          <div className="row-line" key={i}>
            <input
              placeholder="染料 / 助剂名称"
              value={r.name}
              onChange={(e) => setIngredient(i, "name", e.target.value)}
            />
            <input
              type="number"
              placeholder="投料重量 g"
              value={r.weight}
              onChange={(e) => setIngredient(i, "weight", e.target.value)}
            />
            <button
              className="ghost"
              onClick={() => removeRow("ingredients", i)}
              disabled={f.ingredients.length <= 1}
            >
              删除
            </button>
          </div>
        ))}
        <button className="ghost" onClick={() => addRow("ingredients")}>
          + 加一行投料
        </button>
      </div>

      <h3 className="sub-title">染色工艺</h3>
      <div className="field-grid">
        <label>
          <span>浴比 1 : X</span>
          <input
            type="number"
            value={f.liquorRatio}
            onChange={(e) => set("liquorRatio", e.target.value)}
          />
        </label>
        <label>
          <span>保温时间 min</span>
          <input
            type="number"
            value={f.holdTime}
            onChange={(e) => set("holdTime", e.target.value)}
          />
        </label>
      </div>
      <div className="rows">
        <p className="hint">温度曲线（时间 min / 温度 °C，按升温顺序填写）</p>
        {f.curve.map((c, i) => (
          <div className="row-line" key={i}>
            <input
              type="number"
              placeholder="时间 min"
              value={c.time}
              onChange={(e) => setCurvePoint(i, "time", e.target.value)}
            />
            <input
              type="number"
              placeholder="温度 °C"
              value={c.temp}
              onChange={(e) => setCurvePoint(i, "temp", e.target.value)}
            />
            <button className="ghost" onClick={() => removeRow("curve", i)} disabled={f.curve.length <= 2}>
              删除
            </button>
          </div>
        ))}
        <button className="ghost" onClick={() => addRow("curve")}>
          + 加一个曲线点
        </button>
      </div>

      <h3 className="sub-title">标准样 Lab 读数</h3>
      <div className="field-grid grid-3">
        <label>
          <span>L*（明度）</span>
          <input type="number" step="0.1" value={f.stdL} onChange={(e) => set("stdL", e.target.value)} />
        </label>
        <label>
          <span>a*（红绿）</span>
          <input type="number" step="0.1" value={f.stdA} onChange={(e) => set("stdA", e.target.value)} />
        </label>
        <label>
          <span>b*（黄蓝）</span>
          <input type="number" step="0.1" value={f.stdB} onChange={(e) => set("stdB", e.target.value)} />
        </label>
      </div>
    </section>
  );
}

/* ---------- 温度曲线图 ---------- */

function CurveChart({ curve }: { curve: TempPoint[] }) {
  const pts = [...curve].sort((a, b) => a.time - b.time);
  if (pts.length < 2) return null;
  const w = 560;
  const h = 170;
  const pad = 34;
  const tMax = Math.max(...pts.map((p) => p.time)) || 1;
  const tempMax = Math.max(...pts.map((p) => p.temp));
  const tempMin = Math.min(...pts.map((p) => p.temp), 0);
  const x = (t: number) => pad + (t / tMax) * (w - pad * 2);
  const y = (tp: number) =>
    h - pad - ((tp - tempMin) / (tempMax - tempMin || 1)) * (h - pad * 2);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.time)},${y(p.temp)}`).join(" ");
  return (
    <svg className="curve" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="温度曲线">
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#cbd5e1" />
      <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#cbd5e1" />
      <path d={d} fill="none" stroke="#be123c" strokeWidth="2.5" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={x(p.time)} cy={y(p.temp)} r="3.5" fill="#4f46e5" />
          <text x={x(p.time)} y={y(p.temp) - 8} textAnchor="middle" fontSize="10" fill="#475569">
            {p.temp}°
          </text>
        </g>
      ))}
      <text x={pad} y={h - pad + 16} fontSize="10" fill="#64748b">
        0min
      </text>
      <text x={w - pad} y={h - pad + 16} textAnchor="end" fontSize="10" fill="#64748b">
        {tMax}min
      </text>
      <text x={pad - 6} y={pad + 4} textAnchor="end" fontSize="10" fill="#64748b">
        {tempMax}°C
      </text>
    </svg>
  );
}

/* ---------- Lab 评审录入 ---------- */

function LabEntry(props: { onSubmit: (lab: LabReading) => void }) {
  const [l, setL] = useState("");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const submit = () => {
    const lab = { l: Number(l), a: Number(a), b: Number(b) };
    if ([lab.l, lab.a, lab.b].some(Number.isNaN) || !l || !a || !b)
      return alert("请完整填写小样的 L / a / b 三轴读数");
    props.onSubmit(lab);
  };
  return (
    <div className="lab-entry">
      <span>录入小样 Lab 读数：</span>
      <input type="number" step="0.1" placeholder="L*" value={l} onChange={(e) => setL(e.target.value)} />
      <input type="number" step="0.1" placeholder="a*" value={a} onChange={(e) => setA(e.target.value)} />
      <input type="number" step="0.1" placeholder="b*" value={b} onChange={(e) => setB(e.target.value)} />
      <button className="primary" onClick={submit}>
        计算色差并评审
      </button>
    </div>
  );
}

/* ---------- 批次行（含展开详情） ---------- */

function BatchRow(props: {
  batch: Batch;
  expanded: boolean;
  onToggle: () => void;
  onReview: (lab: LabReading) => void;
  onRevise: () => void;
  onOutbound: () => void;
}) {
  const { batch } = props;
  const v = currentVersion(batch);
  const review = v.review;
  const shares = recipeProportions(v.recipe);
  const outboundReady = canOutbound(batch);
  return (
    <article className="batch">
      <header className="batch-head" onClick={props.onToggle}>
        <div className="batch-id">
          <b>{batch.id}</b>
          <span className={`badge ${STATUS_CLASS[batch.status]}`}>{batch.status}</span>
        </div>
        <div className="batch-main">
          <h3>
            {batch.customerOrder} · {batch.fabric} · {batch.gramWeight}g/m²
          </h3>
          <p>
            v{v.version} · 浴比 1:{v.process.liquorRatio} · 保温 {v.process.holdTime}min ·{" "}
            {v.process.finishing}
            {review && (
              <>
                {" "}
                · ΔE <b className={review.conclusion === "pass" ? "ok" : "bad"}>{review.deltaE.toFixed(2)}</b>{" "}
                {conclusionLabel(review.conclusion)}
              </>
            )}
          </p>
        </div>
        <span className="toggle">{props.expanded ? "收起 ▲" : "展开 ▼"}</span>
      </header>

      {props.expanded && (
        <div className="batch-detail">
          <div className="detail-grid">
            <section>
              <h4>配方比例（按投料重量）</h4>
              <ul className="shares">
                {shares.map((s) => (
                  <li key={s.name}>
                    <div className="share-label">
                      <span>{s.name}</span>
                      <span>
                        {s.weight}g · {s.percent}%
                      </span>
                    </div>
                    <div className="share-bar">
                      <i style={{ width: `${Math.max(s.percent, 2)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="hint">
                浴比 1:{v.process.liquorRatio} · 保温 {v.process.holdTime}min · 后整理：
                {v.process.finishing}
              </p>
            </section>

            <section>
              <h4>工艺曲线摘要</h4>
              <CurveChart curve={v.process.tempCurve} />
              <p className="hint">{summarizeCurve(v.process.tempCurve, v.process.holdTime)}</p>
            </section>
          </div>

          <section>
            <h4>Lab 色差对比（限值 ΔE ≤ {DELTA_E_LIMIT}）</h4>
            <div className="lab-compare">
              <div>
                <small>标准样</small>
                <b>{fmtLab(v.standardLab)}</b>
              </div>
              <div>
                <small>小样</small>
                <b>{review ? fmtLab(review.sampleLab) : "未录入"}</b>
              </div>
              {review && (
                <>
                  <div>
                    <small>ΔL / Δa / Δb</small>
                    <b>
                      {(review.sampleLab.l - v.standardLab.l).toFixed(1)} /{" "}
                      {(review.sampleLab.a - v.standardLab.a).toFixed(1)} /{" "}
                      {(review.sampleLab.b - v.standardLab.b).toFixed(1)}
                    </b>
                  </div>
                  <div>
                    <small>ΔE 结论</small>
                    <b className={review.conclusion === "pass" ? "ok" : "bad"}>
                      {review.deltaE.toFixed(2)} · {conclusionLabel(review.conclusion)}
                      {review.conclusion === "fail" && "，已转入复染"}
                    </b>
                  </div>
                </>
              )}
            </div>
            {batch.status !== "已出库" && <LabEntry key={batch.id + "v" + v.version} onSubmit={props.onReview} />}
          </section>

          <section>
            <h4>版本与评审记录</h4>
            <ul className="history">
              {batch.versions.map((ver) => (
                <li key={ver.version} className={ver.version === v.version ? "current" : ""}>
                  <b>v{ver.version}</b>
                  <span className="note">{ver.note}</span>
                  <span className="hint">
                    {fmtTime(ver.createdAt)} · 浴比 1:{ver.process.liquorRatio} · 保温{" "}
                    {ver.process.holdTime}min
                  </span>
                  {ver.review ? (
                    <span className={ver.review.superseded ? "hint strike" : ""}>
                      ΔE {ver.review.deltaE.toFixed(2)} · {conclusionLabel(ver.review.conclusion)} ·{" "}
                      {fmtTime(ver.review.reviewedAt)}
                      {ver.review.superseded && "（已失效：配方/工艺已改动）"}
                    </span>
                  ) : (
                    <span className="hint">未评审</span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <div className="row-actions">
            <button onClick={props.onRevise} disabled={batch.status === "已出库"}>
              修改配方 / 工艺（复染开新版本）
            </button>
            <button
              className="primary"
              onClick={props.onOutbound}
              disabled={!outboundReady}
              title={outboundReady ? "" : "需当前版本评审通过后才能出库"}
            >
              {batch.status === "已出库" ? "已出库" : "评审通过，办理出库"}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

/* ---------- 主页面 ---------- */

function App() {
  const [batches, setBatches] = useState<Batch[]>(() => loadLedger());
  const [orderFilter, setOrderFilter] = useState("全部");
  const [statusFilter, setStatusFilter] = useState<"全部" | BatchStatus>("全部");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [reviseId, setReviseId] = useState<string | null>(null);

  // 台账变更即落盘，重开页面可接着处理
  useEffect(() => {
    saveLedger(batches);
  }, [batches]);

  const orders = useMemo(
    () => Array.from(new Set(batches.map((b) => b.customerOrder))).sort(),
    [batches]
  );

  const filtered = useMemo(
    () =>
      batches
        .filter((b) => orderFilter === "全部" || b.customerOrder === orderFilter)
        .filter((b) => statusFilter === "全部" || b.status === statusFilter)
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [batches, orderFilter, statusFilter]
  );

  const metrics = useMemo(() => {
    const allReviews = batches.flatMap((b) => b.versions.map((v) => v.review)).filter(Boolean);
    const passed = allReviews.filter((r) => r!.conclusion === "pass").length;
    return [
      { label: "小样批次", value: batches.length },
      { label: "色差超限待复染", value: batches.filter((b) => b.status === "待复染").length },
      { label: "客户订单", value: orders.length },
      {
        label: "评审通过率",
        value: allReviews.length ? `${Math.round((passed / allReviews.length) * 100)}%` : "—",
      },
    ];
  }, [batches, orders]);

  const updateBatch = (id: string, fn: (b: Batch) => Batch) =>
    setBatches((prev) => prev.map((b) => (b.id === id ? fn(b) : b)));

  const submitCreate = (f: FormState) => {
    const parsed = parseForm(f, "create");
    if (!parsed) return;
    setBatches((prev) => [createBatch({ ...parsed.spec, customerOrder: parsed.customerOrder, fabric: parsed.fabric, gramWeight: parsed.gramWeight }, prev), ...prev]);
    setShowCreate(false);
  };

  const submitRevise = (f: FormState) => {
    if (!reviseId) return;
    const parsed = parseForm(f, "revise");
    if (!parsed) return;
    updateBatch(reviseId, (b) => reviseBatch(b, { ...parsed.spec, note: parsed.note }));
    setReviseId(null);
  };

  const reviseTarget = reviseId ? batches.find((b) => b.id === reviseId) : null;

  return (
    <main className="app">
      <section className="hero">
        <p>纺织染整实验室 · 小样批次台账</p>
        <h1>染整小样评审工作台</h1>
        <span>
          登记客户订单、面料成分、克重、染料配方、浴比、温度曲线、保温时间与后整理方式；录入 Lab
          三轴读数自动给出 ΔE 色差结论，超过 {DELTA_E_LIMIT} 转入复染；配方或工艺改动后原结论失效并保留旧版，
          复染再次评审通过方可出库。数据保存在本机浏览器，重开页面可接着处理。
        </span>
      </section>

      <section className="metrics">
        {metrics.map((m) => (
          <article key={m.label}>
            <small>{m.label}</small>
            <strong>{m.value}</strong>
          </article>
        ))}
      </section>

      <section className="panel toolbar">
        <div className="filters">
          <label>
            <span>客户订单</span>
            <select value={orderFilter} onChange={(e) => setOrderFilter(e.target.value)}>
              <option>全部</option>
              {orders.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <label>
            <span>评审状态</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "全部" | BatchStatus)}
            >
              <option>全部</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="row-actions">
          <button onClick={() => window.confirm("确定清空台账并恢复示例数据？") && setBatches(resetLedger())}>
            恢复示例数据
          </button>
          <button className="primary" onClick={() => { setShowCreate((s) => !s); setReviseId(null); }}>
            {showCreate ? "收起登记表单" : "+ 新增小样批次"}
          </button>
        </div>
      </section>

      {showCreate && (
        <BatchForm mode="create" initial={emptyForm()} onSubmit={submitCreate} onCancel={() => setShowCreate(false)} />
      )}
      {reviseTarget && (
        <BatchForm
          mode="revise"
          initial={formFromBatch(reviseTarget)}
          onSubmit={submitRevise}
          onCancel={() => setReviseId(null)}
        />
      )}

      <section className="panel">
        <div className="heading">
          <div>
            <p>批次台账</p>
            <h2>
              {filtered.length} 个批次
              {orderFilter !== "全部" && ` · 订单 ${orderFilter}`}
              {statusFilter !== "全部" && ` · ${statusFilter}`}
            </h2>
          </div>
        </div>
        <div className="records">
          {filtered.length === 0 && <p className="hint">没有符合条件的批次，调整筛选或新增小样。</p>}
          {filtered.map((b) => (
            <BatchRow
              key={b.id}
              batch={b}
              expanded={expandedId === b.id}
              onToggle={() => setExpandedId((id) => (id === b.id ? null : b.id))}
              onReview={(lab) => updateBatch(b.id, (x) => reviewBatch(x, lab))}
              onRevise={() => {
                setReviseId(b.id);
                setShowCreate(false);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              onOutbound={() => updateBatch(b.id, outboundBatch)}
            />
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
