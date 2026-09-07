/* eslint-disable @next/next/no-img-element -- 编辑预览支持管理员提供的图片地址 */
"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Chip,
  Dropdown,
  Modal,
  buttonVariants,
} from "@heroui/react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  FileUp,
  MoreHorizontal,
  Save,
  Send,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { ArticleRichEditor } from "@/components/article-rich-editor";
import { ArticleContent } from "@/components/article-content";
import { Checkbox } from "@heroui/react";
import { InputField, Notice, TextAreaField } from "@/components/ui";
import {
  articleEditorState,
  articleRecoveryKey,
  articleTime,
  parseArticleRecovery,
  sameArticleDraft,
  MAX_ARTICLE_LENGTH,
  safeArticleUrl,
  type ArticleDraft,
  type ArticleResult,
  type ArticleRecovery,
} from "@/lib/article-input";
import {
  saveArticleAction,
  deleteArticleAction,
  inspectArticleRecoveryAction,
} from "@/app/admin/articles/actions";
import { uploadSiteAssetAction } from "@/app/admin/customize/actions";

// 首次保存需要切到正式编辑路由，短暂保留服务端回执以跨过组件重新挂载。
let pendingSaveFeedback: {
  adminId: string;
  id: string;
  revision: number;
  updatedAt: string | null;
  message: string;
  expiresAt: number;
} | null = null;

function clearRecoveryBackup(adminId: string, articleId: string) {
  try {
    sessionStorage.removeItem(articleRecoveryKey(adminId, articleId));
    const newKey = articleRecoveryKey(adminId, "new");
    if (
      parseArticleRecovery(sessionStorage.getItem(newKey), adminId, "new")
        ?.id === articleId
    )
      sessionStorage.removeItem(newKey);
  } catch {
    /* 存储不可用时不影响服务端保存结果。 */
  }
}

export function ArticleEditor({
  id: initialId,
  adminId,
  initial,
  initialRevision,
  initialStatus,
  initialPinned = false,
  initialUpdatedAt = null,
  initialPublishedAt = null,
}: {
  id: string;
  adminId: string;
  initial: ArticleDraft;
  initialRevision: number;
  initialStatus: "DRAFT" | "PUBLISHED";
  initialPinned?: boolean;
  initialUpdatedAt?: string | null;
  initialPublishedAt?: string | null;
}) {
  const router = useRouter();
  const [id, setId] = useState(initialId);
  const [draft, setDraft] = useState(initial);
  const [revision, setRevision] = useState(initialRevision);
  const [editingRevision, setEditingRevision] = useState(initialRevision);
  const [status, setStatus] = useState(initialStatus);
  const [pinned, setPinned] = useState(initialPinned);
  const [savedPinned, setSavedPinned] = useState(initialPinned);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [publishedAt, setPublishedAt] = useState(initialPublishedAt);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [mode, setMode] = useState<"rich" | "markdown" | "preview">("rich");
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [showCoverLink, setShowCoverLink] = useState(false);
  const [savingStatus, setSavingStatus] = useState<
    "DRAFT" | "PUBLISHED" | null
  >(null);
  const [result, setResult] = useState<ArticleResult>({
    ok: false,
    message: "",
  });
  const [confirm, setConfirm] = useState<
    "delete" | "withdraw" | "import" | null
  >(null);
  const [imported, setImported] = useState("");
  const [recovery, setRecovery] = useState<ArticleRecovery | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryWarning, setRecoveryWarning] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const mutationLock = useRef(false);
  const recoveryLoaded = useRef(false);
  const importRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(draft) !== saved;
  const busy = pending || uploading || restoring;
  const blocked = busy || recovery !== null || !recoveryReady;
  const cover = safeArticleUrl(draft.coverUrl.trim(), true);
  useEffect(() => {
    if (recoveryLoaded.current) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active || recoveryLoaded.current) return;
      recoveryLoaded.current = true;
      const feedback = pendingSaveFeedback;
      if (feedback && feedback.expiresAt < Date.now())
        pendingSaveFeedback = null;
      else if (
        feedback?.adminId === adminId &&
        feedback.id === initialId &&
        feedback.revision === initialRevision &&
        feedback.updatedAt === initialUpdatedAt
      ) {
        setResult({ ok: true, message: feedback.message });
        pendingSaveFeedback = null;
      }
      try {
        const target = initialRevision === 0 ? "new" : initialId;
        const key = articleRecoveryKey(adminId, target);
        const raw = sessionStorage.getItem(key);
        const candidate = parseArticleRecovery(raw, adminId, target);
        if (raw && !candidate) sessionStorage.removeItem(key);
        if (candidate && sameArticleDraft(candidate.draft, initial))
          clearRecoveryBackup(adminId, candidate.id);
        else if (candidate) setRecovery(candidate);
      } catch {
        setRecoveryWarning(
          "浏览器无法保留临时备份，请先保存文章再离开编辑页。",
        );
      }
      setRecoveryReady(true);
    });
    return () => {
      active = false;
    };
  }, [adminId, initialId, initialRevision, initialUpdatedAt, initial]);
  useEffect(() => {
    if (!recoveryReady || recovery) return;
    if (!dirty) {
      clearRecoveryBackup(adminId, id);
      return;
    }
    const backup: ArticleRecovery = {
      version: 1,
      userId: adminId,
      id,
      revision: editingRevision,
      draft,
      savedAt: Date.now(),
    };
    try {
      const serialized = JSON.stringify(backup);
      sessionStorage.setItem(articleRecoveryKey(adminId, id), serialized);
      if (revision === 0)
        sessionStorage.setItem(articleRecoveryKey(adminId, "new"), serialized);
    } catch {
      queueMicrotask(() =>
        setRecoveryWarning(
          "浏览器无法保留临时备份，请先保存文章再离开编辑页。",
        ),
      );
    }
  }, [
    adminId,
    id,
    revision,
    editingRevision,
    draft,
    dirty,
    result,
    recoveryReady,
    recovery,
  ]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const unload = (event: BeforeUnloadEvent) => event.preventDefault();
    const leave = (event: Event) => {
      if (busy || !window.confirm("文章还有未保存的修改，确定离开编辑页吗？"))
        event.preventDefault();
    };
    const navigate = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      )
        return;
      const target = new URL(anchor.href);
      if (
        !["http:", "https:"].includes(target.protocol) ||
        (target.pathname === location.pathname &&
          target.search === location.search)
      )
        return;
      if (busy || !window.confirm("文章还有未保存的修改，确定离开编辑页吗？")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("community:before-leave", leave);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("community:before-leave", leave);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty, busy]);
  async function restoreRecovery() {
    if (!recovery || busy) return;
    setRestoring(true);
    try {
      if (initialRevision === 0) {
        const data = new FormData();
        data.set("id", recovery.id);
        data.set("editorUserId", adminId);
        const inspection = await inspectArticleRecoveryAction(data);
        if (!inspection.ok) {
          setResult(inspection);
          return;
        }
        if (inspection.exists) {
          sessionStorage.setItem(
            articleRecoveryKey(adminId, recovery.id),
            JSON.stringify(recovery),
          );
          sessionStorage.removeItem(articleRecoveryKey(adminId, "new"));
          router.replace(`/admin/articles/${recovery.id}`);
          return;
        }
        setId(recovery.id);
      }
      setDraft(recovery.draft);
      setEditingRevision(recovery.revision);
      setEditorGeneration((value) => value + 1);
      setResult({
        ok: true,
        message:
          initialRevision !== 0 && initialRevision !== recovery.revision
            ? "已恢复旧版本的未保存内容。后台已有更新，请先导出备份并核对最新内容；系统会阻止直接覆盖。"
            : "未保存内容已恢复，确认后请保存。",
      });
      setRecovery(null);
    } catch {
      setResult({
        ok: false,
        message: "暂时无法恢复，请稍后重试。临时备份仍保留。",
      });
    } finally {
      setRestoring(false);
    }
  }
  function discardRecovery() {
    if (!recovery || busy) return;
    clearRecoveryBackup(adminId, recovery.id);
    setRecovery(null);
  }
  function update(key: keyof ArticleDraft, value: string) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setResult({ ok: false, message: "" });
  }
  function save(nextStatus: "DRAFT" | "PUBLISHED") {
    if (
      blocked ||
      mutationLock.current ||
      (revision > 0 && !dirty && nextStatus === status && pinned === savedPinned)
    )
      return;
    mutationLock.current = true;
    setSavingStatus(nextStatus);
    setResult({ ok: false, message: "" });
    const data = new FormData();
    Object.entries(draft).forEach(([key, value]) => data.set(key, value));
    data.set("id", id);
    data.set("revision", String(editingRevision));
    data.set("status", nextStatus);
    data.set("pinned", String(pinned));
    data.set("editorUserId", adminId);
    startTransition(async () => {
      try {
        const response = await saveArticleAction(data);
        setResult(response);
        if (
          response.ok &&
          response.revision &&
          response.status &&
          response.article
        ) {
          setRevision(response.revision);
          setEditingRevision(response.revision);
          setStatus(response.status);
          setSavedPinned(pinned);
          setDraft(response.article);
          setSaved(JSON.stringify(response.article));
          setUpdatedAt(response.updatedAt ?? null);
          setPublishedAt(response.publishedAt ?? null);
          setConfirm(null);
          setRecovery(null);
          clearRecoveryBackup(adminId, id);
          if (revision === 0) {
            pendingSaveFeedback = {
              adminId,
              id,
              revision: response.revision,
              updatedAt: response.updatedAt ?? null,
              message: response.message,
              expiresAt: Date.now() + 60_000,
            };
            router.replace(`/admin/articles/${id}`);
          }
        }
      } catch {
        setResult({
          ok: false,
          message: "保存失败，请检查网络后重试。正文仍保留在当前页面。",
        });
      } finally {
        mutationLock.current = false;
        setSavingStatus(null);
      }
    });
  }
  function remove() {
    if (blocked || mutationLock.current) return;
    mutationLock.current = true;
    startTransition(async () => {
      try {
        const data = new FormData();
        data.set("id", id);
        data.set("revision", String(revision));
        data.set("editorUserId", adminId);
        clearRecoveryBackup(adminId, id);
        const response = await deleteArticleAction(data);
        // 删除成功由服务端跳转列表；失败时仍停留在编辑器，恢复临时备份。
        if (response) setResult(response);
      } catch {
        setResult({ ok: false, message: "删除失败，请稍后重试。" });
      } finally {
        mutationLock.current = false;
      }
    });
  }
  async function importMarkdown(file?: File) {
    if (!file) return;
    try {
      if (file.size > MAX_ARTICLE_LENGTH * 4)
        throw new Error("Markdown 文件过大，正文最多 10 万字符。");
      const content = await file.text();
      if (content.length > MAX_ARTICLE_LENGTH || content.includes("\0"))
        throw new Error("请选择不超过 10 万字符的 Markdown 文本文件。");
      setImported(content);
      setResult({ ok: false, message: "" });
      setConfirm("import");
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : "文件读取失败。",
      });
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  }
  function exportMarkdown() {
    const url = URL.createObjectURL(
      new Blob([draft.content], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download =
      (draft.title.trim().replace(/[\\/:*?"<>|]/g, "_") || "文章") + ".md";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function uploadCover(file?: File) {
    if (!file || blocked) return;
    setCoverUploading(true);
    setUploading(true);
    try {
      const data = new FormData();
      data.set("file", file);
      const response = await uploadSiteAssetAction(data);
      if (response.url) {
        update("coverUrl", response.url);
        setResult({ ok: true, message: "封面已上传，请保存文章。" });
      } else
        setResult({
          ok: false,
          message: response.error || "上传失败。",
          authRequired: response.authRequired,
        });
    } catch {
      setResult({ ok: false, message: "封面上传失败，请稍后重试。" });
    } finally {
      setCoverUploading(false);
      setUploading(false);
      if (coverRef.current) coverRef.current.value = "";
    }
  }
  return (
    <div className="article-editor">
      <div className="article-workspace-heading">
        <Link href="/admin/articles" className="text-action">
          <ArrowLeft size={16} />
          返回文章管理
        </Link>
        <h1>{revision ? "编辑文章" : "写文章"}</h1>
      </div>
      <section className="article-command-bar" aria-label="文章状态和操作">
        <div className="article-command-main">
          <div className="article-save-state" aria-live="polite">
            <Chip
              size="sm"
              color={
                dirty
                  ? "warning"
                  : status === "PUBLISHED"
                    ? "success"
                    : "default"
              }
            >
              {articleEditorState(status, revision, dirty)}
            </Chip>
            <p>
              {status === "PUBLISHED"
                ? dirty
                  ? "修改尚未同步到前台，点击“更新文章”后生效。"
                  : `前台公开可见${publishedAt ? ` · 发布于 ${articleTime(publishedAt)}` : ""}`
                : revision
                  ? "仅管理员可见，发布后展示到前台。"
                  : "填写标题和正文，即可保存草稿或发布。"}
            </p>
            {updatedAt ? (
              <span>最近保存 {articleTime(updatedAt)}（上海时间）</span>
            ) : null}
          </div>
          <div className="article-command-actions">
            {status === "DRAFT" ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                isDisabled={blocked || (revision > 0 && !dirty)}
                isPending={pending && savingStatus === "DRAFT"}
                onPress={() => save("DRAFT")}
              >
                <Save size={16} />
                {revision > 0 && !dirty ? "草稿已保存" : "保存草稿"}
              </Button>
            ) : (
              <Link
                href={`/articles/${id}`}
                target="_blank"
                className={buttonVariants({
                  variant: dirty ? "secondary" : "primary",
                  size: "sm",
                })}
              >
                <Eye size={16} />
                查看文章
              </Link>
            )}
            {status === "DRAFT" || dirty ? (
              <Button
                type="button"
                size="sm"
                isDisabled={blocked}
                isPending={pending && savingStatus === "PUBLISHED"}
                onPress={() => save("PUBLISHED")}
              >
                <Send size={16} />
                {status === "PUBLISHED" ? "更新文章" : "发布文章"}
              </Button>
            ) : null}
            <Dropdown>
              <Dropdown.Trigger
                aria-label="更多文章操作"
                className={buttonVariants({ variant: "ghost", size: "sm" })}
                isDisabled={blocked}
              >
                <MoreHorizontal size={18} />
                <span>更多</span>
              </Dropdown.Trigger>
              <Dropdown.Popover placement="bottom end">
                <Dropdown.Menu aria-label="更多文章操作">
                  <Dropdown.Item
                    id="import"
                    textValue="导入 Markdown"
                    onAction={() => importRef.current?.click()}
                  >
                    <FileUp size={16} />
                    导入 Markdown
                  </Dropdown.Item>
                  <Dropdown.Item
                    id="export"
                    textValue="导出 Markdown"
                    isDisabled={!draft.content}
                    onAction={exportMarkdown}
                  >
                    <Download size={16} />
                    导出 Markdown
                  </Dropdown.Item>
                  {status === "PUBLISHED" ? (
                    <Dropdown.Item
                      id="withdraw"
                      textValue="撤回为草稿"
                      onAction={() => {
                        setResult({ ok: false, message: "" });
                        setConfirm("withdraw");
                      }}
                    >
                      <Undo2 size={16} />
                      撤回为草稿
                    </Dropdown.Item>
                  ) : null}
                  {revision > 0 ? (
                    <Dropdown.Item
                      id="delete"
                      textValue="删除文章"
                      className="text-danger"
                      onAction={() => {
                        setResult({ ok: false, message: "" });
                        setConfirm("delete");
                      }}
                    >
                      <Trash2 size={16} />
                      删除文章
                    </Dropdown.Item>
                  ) : null}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
        </div>
        {result.message ? (
          <div
            className={`article-action-feedback ${result.ok ? "is-success" : "is-error"}`}
            role={result.ok ? "status" : "alert"}
          >
            {result.ok ? <CheckCircle2 size={17} /> : null}
            <span>{result.message}</span>
            {result.authRequired ? (
              <Link
                href="/login"
                target="_blank"
                rel="noopener noreferrer"
                className="text-action"
              >
                在新标签页重新登录
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>
      {recovery ? (
        <Card className="article-recovery-card">
          <div>
            <h2>发现未保存的内容</h2>
            <p>
              本标签页于 {articleTime(new Date(recovery.savedAt))}{" "}
              保留了一份临时备份，24 小时后过期。是否恢复到编辑器？
            </p>
            {initialRevision > 0 && recovery.revision !== initialRevision ? (
              <p>
                后台已有较新版本，恢复后请核对，系统会阻止直接覆盖其他修改。
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              isDisabled={busy}
              isPending={restoring}
              onPress={() => void restoreRecovery()}
            >
              恢复未保存内容
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              isDisabled={busy}
              onPress={discardRecovery}
            >
              丢弃备份
            </Button>
          </div>
        </Card>
      ) : null}
      {editingRevision !== revision ? (
        <Notice tone="warning">
          这份恢复内容来自较早版本。请先通过“更多”导出备份，再刷新页面核对后台最新内容；系统不会直接覆盖其他修改。
        </Notice>
      ) : null}
      {recoveryWarning ? (
        <Notice tone="warning">{recoveryWarning}</Notice>
      ) : null}
      <div className="article-editor-main">
        <Card className="article-editor-title">
          <InputField
            label="文章标题"
            name="title"
            required
            maxLength={120}
            value={draft.title}
            disabled={blocked}
            placeholder="给这篇文章起个标题"
            onChange={(event) => update("title", event.target.value)}
          />
        </Card>
        <Card className="gap-4" aria-label="文章封面">
          <h2 className="font-semibold">文章封面</h2>
          <div
            className={
              cover
                ? "grid gap-4 sm:grid-cols-[240px_minmax(0,1fr)]"
                : "grid gap-4"
            }
          >
            {cover ? (
              <img
                className="aspect-video w-full rounded-lg object-cover"
                src={cover}
                alt="文章封面预览"
                referrerPolicy="no-referrer"
              />
            ) : null}
            <div className="grid content-start gap-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  isDisabled={blocked}
                  isPending={coverUploading}
                  onPress={() => coverRef.current?.click()}
                >
                  <Upload size={15} />
                  {cover ? "更换封面" : "上传封面"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  isDisabled={blocked}
                  aria-expanded={showCoverLink}
                  aria-controls="article-cover-link"
                  onPress={() => setShowCoverLink((value) => !value)}
                >
                  使用图片链接
                </Button>
                {draft.coverUrl ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    isDisabled={blocked}
                    onPress={() => update("coverUrl", "")}
                  >
                    移除封面
                  </Button>
                ) : null}
              </div>
              <p className="text-sm text-muted">
                选填，支持 PNG、JPEG、WebP 或 GIF，最大 2 MB。
              </p>
              {showCoverLink ? (
                <div id="article-cover-link">
                  <InputField
                    label="封面图片链接"
                    value={draft.coverUrl}
                    disabled={blocked}
                    maxLength={2048}
                    placeholder="https://…"
                    onChange={(event) => update("coverUrl", event.target.value)}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </Card>
        <Card className="article-editor-body">
          <div className="article-editor-tabs">
            <div role="group" aria-label="编辑模式">
              {[
                { id: "rich", label: "富文本" },
                { id: "markdown", label: "Markdown" },
                { id: "preview", label: "预览" },
              ].map((tab) => (
                <Button
                  key={tab.id}
                  type="button"
                  size="sm"
                  variant={mode === tab.id ? "secondary" : "ghost"}
                  aria-pressed={mode === tab.id}
                  isDisabled={blocked}
                  onPress={() => setMode(tab.id as typeof mode)}
                >
                  {tab.label}
                </Button>
              ))}
            </div>
            <span className="article-word-count">
              {draft.content.length.toLocaleString()} 字符
            </span>
          </div>
          {mode === "rich" ? (
            <ArticleRichEditor
              key={editorGeneration}
              initialValue={draft.content}
              onChange={(value) => update("content", value)}
              disabled={blocked}
              onUploadChange={setUploading}
            />
          ) : mode === "markdown" ? (
            <div className="markdown-edit-pane">
              <label htmlFor="article-markdown-source">Markdown 正文</label>
              <textarea
                id="article-markdown-source"
                value={draft.content}
                onChange={(event) => update("content", event.target.value)}
                disabled={blocked}
                maxLength={MAX_ARTICLE_LENGTH}
                spellCheck={false}
                placeholder="## 从这里开始写…"
              />
            </div>
          ) : (
            <div className="article-editor-preview">
              <h1>{draft.title || "文章标题"}</h1>
              {draft.excerpt ? (
                <p className="article-deck">{draft.excerpt}</p>
              ) : null}
              {cover ? (
                <img
                  src={cover}
                  alt="文章封面预览"
                  referrerPolicy="no-referrer"
                />
              ) : null}
              {draft.content ? (
                <ArticleContent content={draft.content} />
              ) : (
                <p className="text-muted">正文为空，写一点内容再来看看。</p>
              )}
            </div>
          )}
          <div className="article-editor-footnote">
            <span>
              {uploading
                ? "正在上传图片…"
                : "支持 Markdown 快捷输入 · 图片可直接粘贴或拖入，过大会自动压缩"}
            </span>
            <span>正文最多 10 万字符</span>
          </div>
        </Card>
        <details className="article-optional-settings">
          <summary>
            文章摘要 <span>选填</span>
            <ChevronDown size={16} />
          </summary>
          <div className="p-5">
            <TextAreaField
              label="文章摘要"
              value={draft.excerpt}
              maxLength={300}
              disabled={blocked}
              description="最多 300 字；留空时自动提取正文。"
              onChange={(event) => update("excerpt", event.target.value)}
            />
            <div className="mt-4">
              <Checkbox
                name="pinned"
                value="on"
                isSelected={pinned}
                isDisabled={blocked}
                onChange={setPinned}
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  置顶这篇文章
                </Checkbox.Content>
              </Checkbox>
              <p className="mt-2 text-sm text-muted">
                置顶的文章排在列表和首页最前；多篇置顶之间仍按发布时间排序。
              </p>
            </div>
          </div>
        </details>
      </div>
      <input
        ref={importRef}
        type="file"
        hidden
        accept=".md,.markdown,text/markdown,text/plain"
        onChange={(event) => void importMarkdown(event.target.files?.[0])}
      />
      <input
        ref={coverRef}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(event) => void uploadCover(event.target.files?.[0])}
      />
      <Modal.Backdrop
        isOpen={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirm(null);
        }}
      >
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label="关闭" />
            <Modal.Header>
              <Modal.Heading>
                {confirm === "delete"
                  ? "删除这篇文章？"
                  : confirm === "withdraw"
                    ? "撤回为草稿？"
                    : "导入 Markdown"}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p className="text-sm leading-7 text-muted">
                {confirm === "delete"
                  ? "删除后文章将从后台和前台移除，无法恢复。需要备份时，请先导出 Markdown。"
                  : confirm === "withdraw"
                    ? "文章将从前台下架，当前内容会保存为草稿。以后可以重新发布。"
                    : "导入会替换当前正文，标题、摘要和封面保持不变。确认后仍需保存。"}
              </p>
              {confirm === "import" ? (
                <pre className="mt-4 max-h-36 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-secondary p-3 text-xs">
                  {imported.slice(0, 500)}
                </pre>
              ) : null}
              {result.message && !result.ok ? (
                <p role="alert" className="mt-3 text-sm text-danger">
                  {result.message}
                </p>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button
                type="button"
                variant="secondary"
                isDisabled={blocked}
                onPress={() => setConfirm(null)}
              >
                取消
              </Button>
              <Button
                type="button"
                isDisabled={blocked}
                isPending={pending}
                onPress={() => {
                  if (confirm === "delete") remove();
                  else if (confirm === "withdraw") save("DRAFT");
                  else {
                    update("content", imported);
                    setMode("markdown");
                    setConfirm(null);
                  }
                }}
              >
                {confirm === "delete"
                  ? "确认删除"
                  : confirm === "withdraw"
                    ? "确认撤回"
                    : "替换正文"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
