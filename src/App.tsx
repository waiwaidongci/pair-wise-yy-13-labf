import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import type { Batch, BatchDraft, LabReading, ReviewStatus } from "./domain/types";
import {
  activeVersion,
  applyReview,
  batchStats,
  filterBatches,
  loadBatches,
  markRedyeing,
  nextBatchId,
  persist,
  registerBatch,
  saveRevision,
  seedBatches,
  shipBatch,
} from "./domain/ledger";
import type { DraftErrors } from "./domain/ledger";
import {
  batchToDraft,
  clearDraft,
  emptyDraft,
  loadDraft,
  loadPageState,
  saveDraft,
  savePageState,
  type LabDraft,
  type PageState,
} from "./domain/pageState";
import BatchForm from "./components/BatchForm";
import BatchList from "./components/BatchList";

const STATUS_TABS: Array<{ key: ReviewStatus | "all"; text: string }> = [
  { key: "all", text: "全部" },
  { key: "pending", text: "待评审" },
  { key: "redyeing", text: "复染中" },
  { key: "passed", text: "评审通过" },
  { key: "shipped", text: "已出库" },
];

export default function App() {
  const [batches, setBatches] = useState<Batch[]>(() => loadBatches());
  const [page, setPage] = useState<PageState>(() => loadPageState());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Batch | undefined>(undefined);
  const [draft, setDraft] = useState<BatchDraft>(() =>
    loadDraft(nextBatchId(loadBatches()))
  );
  const [errors, setErrors] = useState<DraftErrors>({});
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => persist(batches), [batches]);
  useEffect(() => savePageState(page), [page]);

  const hasResumeDraft = useMemo(
    () => !formOpen && draft.orderNo.trim() !== "",
    [formOpen, draft.orderNo]
  );

  const visible = useMemo(() => filterBatches(batches, {
    orderNo: page.filterOrderNo,
    status: page.filterStatus,
  }), [batches, page.filterOrderNo, page.filterStatus]);
  const stats = useMemo(() => batchStats(batches), [batches]);

  const patchPage = (p: Partial<PageState>) => setPage((s) => ({ ...s, ...p }));

  const notify = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 4200);
  };

  /* ---------------- 登记 / 改版 ---------------- */

  const openNew = () => {
    setEditing(undefined);
    const d = emptyDraft(nextBatchId(batches));
    setDraft(d);
    saveDraft(d);
    setErrors({});
    setFormOpen(true);
  };

  const openRevision = (b: Batch) => {
    setEditing(b);
    const d = batchToDraft(b);
    setDraft(d);
    saveDraft(d);
    setErrors({});
    setFormOpen(true);
  };

  const resumeDraft = () => {
    // 草稿批次已存在 -> 改版；否则视为未完成的新增登记
    const target = batches.find((b) => b.id === draft.id.trim());
    setEditing(target);
    setErrors({});
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(undefined);
    setErrors({});
  };

  const changeDraft = (d: BatchDraft) => {
    setDraft(d);
    saveDraft(d);
  };

  const submitForm = () => {
    if (editing) {
      const result = saveRevision(editing, draft);
      if (!result.ok || !result.batch) {
        setErrors(result.errors ?? {});
        notify("表单存在未填或不合法的字段，请按提示修正。");
        return;
      }
      setBatches((list) => list.map((b) => (b.id === result.batch!.id ? result.batch! : b)));
      notify(
        result.invalidated
          ? `配方/工艺已改版（${editing.id}），旧版结论失效并保留，批次回到待评审。`
          : `${editing.id} 基础信息已更新，原结论保留。`
      );
    } else {
      const result = registerBatch(batches, draft);
      if (!result.ok || !result.batch) {
        setErrors(result.errors ?? {});
        notify("表单存在未填或不合法的字段，请按提示修正。");
        return;
      }
      setBatches((list) => [result.batch!, ...list]);
      notify(`批次 ${result.batch.id} 已登记入台账，可录入 Lab 三轴读数评审。`);
    }
    clearDraft();
    setDraft(emptyDraft(nextBatchId(
      editing ? batches : [{ id: draft.id } as Batch, ...batches]
    )));
    closeForm();
  };

  /* ---------------- Lab 评审 / 复染 / 出库 ---------------- */

  const setLabDraft = (id: string, d: LabDraft) =>
    patchPage({ labDrafts: { ...page.labDrafts, [id]: d } });

  const submitReview = (b: Batch, target: LabReading, sample: LabReading) => {
    const updated = applyReview(b, { target, sample });
    setBatches((list) => list.map((x) => (x.id === b.id ? updated : x)));
    const rest = { ...page.labDrafts };
    delete rest[b.id];
    patchPage({ labDrafts: rest });
    if (updated.status === "redyeing") {
      notify(`${b.id} 色差超过 1.0，已转入复染；改版复染再次评审通过后才能出库。`);
    } else {
      const round = activeVersion(updated).version;
      notify(
        round > 1
          ? `${b.id} 复染第 ${round - 1} 轮后再次评审通过，可办理出库。`
          : `${b.id} 评审通过，可办理出库。`
      );
    }
  };

  const doMarkRedye = (b: Batch) => {
    setBatches((list) => list.map((x) => (x.id === b.id ? markRedyeing(x) : x)));
    notify(`${b.id} 已标记转入复染。`);
  };

  const doShip = (b: Batch) => {
    setBatches((list) => list.map((x) => (x.id === b.id ? shipBatch(x) : x)));
    notify(`${b.id} 已出库，批次归档只读。`);
  };

  const resetSamples = () => {
    if (!window.confirm("将清空当前台账并恢复 3 张样例卡，确认继续？")) return;
    const seed = seedBatches();
    setBatches(seed);
    notify("已恢复样例数据。");
  };

  /* ---------------- 页面 ---------------- */

  return (
    <main className="app">
      <section className="hero">
        <p>纺织染整实验室 · 批次台账</p>
        <h1>小样投染与色差评审工作台</h1>
        <span>
          登记客户订单、面料成分与克重、染料配方（按投料重量显示比例）、浴比、温度曲线、保温时间与后整理方式；
          录入 Lab 三轴读数自动出具色差结论，ΔE 超过 1.0 转入复染，配方/工艺改动后旧结论作废留痕，复染再次评审通过方可出库。
        </span>
      </section>

      <section className="metrics">
        <Metric label="小样批次" value={stats.total} />
        <Metric label="客户订单" value={stats.orders} />
        <Metric label="待评审/复染" value={stats.reviewable} accent={stats.reviewable > 0} />
        <Metric label="复染中" value={stats.overdue} bad={stats.overdue > 0} />
        <Metric label="通过率" value={`${stats.passRate}%`} />
      </section>

      <section className="panel toolbar">
        <div className="filter-bar">
          <label className="filter-order">
            <span>客户订单 / 批次 / 客户</span>
            <input
              value={page.filterOrderNo}
              placeholder="输入 PO-2509-118 等关键字筛选"
              onChange={(e) => patchPage({ filterOrderNo: e.target.value })}
            />
          </label>
          <div className="status-tabs">
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                className={page.filterStatus === t.key ? "tab active" : "tab"}
                onClick={() => patchPage({ filterStatus: t.key })}
              >
                {t.text}
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar-actions">
          {hasResumeDraft && (
            <button onClick={resumeDraft}>↩ 继续未完成的登记（{draft.id}）</button>
          )}
          <button className="primary" onClick={openNew}>+ 新增小样批次</button>
          <button onClick={resetSamples}>恢复样例</button>
        </div>
      </section>

      {flash && <div className="flash">{flash}</div>}

      {formOpen && (
        <BatchForm
          draft={draft}
          errors={errors}
          editing={editing}
          onChange={changeDraft}
          onSubmit={submitForm}
          onCancel={closeForm}
        />
      )}

      <BatchList
        batches={visible}
        expandedIds={page.expandedIds}
        labDrafts={page.labDrafts}
        onToggle={(id) =>
          patchPage({
            expandedIds: page.expandedIds.includes(id)
              ? page.expandedIds.filter((x) => x !== id)
              : [...page.expandedIds, id],
          })
        }
        onLabDraft={setLabDraft}
        onReview={submitReview}
        onRevise={openRevision}
        onMarkRedye={doMarkRedye}
        onShip={doShip}
      />

      <footer className="page-foot">
        台账数据保存在本机浏览器（localStorage），重开页面可继续处理；批次账、评审规则、页面操作分别位于 src/domain 下三个独立业务文件。
      </footer>
    </main>
  );
}

function Metric({ label, value, accent, bad }: { label: string; value: number | string; accent?: boolean; bad?: boolean }) {
  return (
    <article className={bad ? "metric-bad" : accent ? "metric-accent" : ""}>
      <small>{label}</small>
      <strong>{value}</strong>
    </article>
  );
}
