"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, Spinner } from "@heroui/react";
import { Save } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { EventFormResult } from "@/app/actions";
import { uploadSiteAssetAction } from "@/app/admin/customize/actions";
import { shrinkForUpload } from "@/lib/image-downscale";
import { ActionButton } from "@/components/action-button";
import { EventTypeField } from "@/components/event-type-field";
import {
  InputField,
  Notice,
  SelectField,
  TextAreaField,
} from "@/components/ui";
import { DAY_MS, shanghaiDateValue, shanghaiDayBounds } from "@/lib/event-date";
import { isSafeImageSource } from "@/lib/site-config";
import { MAX_SITE_ASSET_BYTES } from "@/lib/site-asset";

type EventFormProps = {
  action: (formData: FormData) => Promise<EventFormResult>;
  feedback?: ReactNode;
  event?: {
    id: string;
    title: string;
    type: string;
    customType?: string | null;
    description: string;
    coverUrl?: string;
    startTime: Date;
    signupDeadline?: Date | null;
    signupClosed?: boolean;
    maxParticipants: number;
    requirements?: string | null;
    voiceChannel?: string | null;
    status: string;
  };
};

export function EventForm({ action, event, feedback }: EventFormProps) {
  const router = useRouter();
  const [changed, setChanged] = useState(false);
  const [coverUrl, setCoverUrl] = useState(event?.coverUrl ?? "");
  const [coverError, setCoverError] = useState("");
  const [coverAuthRequired, setCoverAuthRequired] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const uploadLock = useRef(false);
  const [result, submit, pending] = useActionState(
    async (
      _previous: EventFormResult,
      form: FormData,
    ): Promise<EventFormResult> => {
      if (uploadLock.current)
        return { ok: false, message: "封面正在上传，请完成后再保存。" };
      try {
        const saved = await action(form);
        if (saved.ok) {
          setChanged(false);
          if (saved.redirectTo) router.push(saved.redirectTo);
          else router.refresh();
        }
        return saved;
      } catch {
        return { ok: false, message: "保存失败，已保留填写内容，请重试。" };
      }
    },
    { ok: false, message: "" },
  );
  const busy = pending || uploadingCover;
  const previewCover = coverUrl.trim();
  useEffect(() => {
    if (!changed && !busy) return;
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
    const leave = (event: Event) => {
      if (busy || !window.confirm("活动还有未保存的修改，确定离开吗？")) {
        event.preventDefault();
        event.stopPropagation();
      }
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
      leave(event);
    };
    window.addEventListener("beforeunload", prevent);
    window.addEventListener("community:before-leave", leave);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", prevent);
      window.removeEventListener("community:before-leave", leave);
      document.removeEventListener("click", navigate, true);
    };
  }, [changed, busy]);

  async function uploadCover(file: File) {
    if (uploadLock.current || pending) return;
    setCoverError("");
    setCoverAuthRequired(false);
    if (!file.size) {
      setCoverError("图片不能为空。");
      return;
    }
    if (
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        file.type,
      )
    ) {
      setCoverError("只支持 PNG、JPEG、WebP 或 GIF 图片。");
      return;
    }
    uploadLock.current = true;
    setUploadingCover(true);
    try {
      const data = new FormData();
      // 先压缩再判大小：超限的图片压过之后往往就合格了，
      // 拿原始体积拦在压缩前面等于让压缩形同虚设。
      const prepared = await shrinkForUpload(file);
      if (prepared.size > MAX_SITE_ASSET_BYTES) {
        setCoverError("图片压缩后仍超过 2 MB，请换一张。");
        return;
      }
      data.set("file", prepared);
      const uploaded = await uploadSiteAssetAction(data);
      if (uploaded.url) {
        setCoverUrl(uploaded.url);
        setFailedCover(null);
        setChanged(true);
      } else {
        setCoverError(uploaded.error ?? "封面上传失败，请重试。");
        setCoverAuthRequired(Boolean(uploaded.authRequired));
      }
    } catch {
      setCoverError("封面上传失败，请重试。原有内容已保留。");
    } finally {
      uploadLock.current = false;
      setUploadingCover(false);
    }
  }
  const defaultStart = new Date(
    shanghaiDayBounds().today.getTime() + 3 * DAY_MS,
  );
  return (
    <form
      action={submit}
      className="grid gap-6"
      onResetCapture={(event) => event.preventDefault()}
      onChangeCapture={() => setChanged(true)}
    >
      <fieldset disabled={busy} className="grid min-w-0 gap-6">
        {event ? <input type="hidden" name="eventId" value={event.id} /> : null}
        <div className="grid items-start gap-5 md:grid-cols-2">
          <InputField
            label="活动标题"
            name="title"
            required
            minLength={2}
            maxLength={60}
            defaultValue={event?.title ?? ""}
            placeholder="给这次活动起个名字"
          />
          <EventTypeField
            defaultType={event?.type}
            defaultCustomType={event?.customType}
            onChange={() => setChanged(true)}
          />
          <InputField
            label="活动日期"
            name="eventDate"
            type="date"
            required
            defaultValue={shanghaiDateValue(event?.startTime ?? defaultStart)}
            description="按上海时间计算，活动当天进行中，次日自动结束。"
          />
          <InputField
            label="报名截止日期"
            name="signupDeadline"
            type="date"
            defaultValue={
              event?.signupDeadline
                ? shanghaiDateValue(event.signupDeadline)
                : ""
            }
            description="截止当天 23:59（上海时间），不得晚于活动日期；留空表示活动结束前均可报名。"
          />
          <InputField
            label="人数上限"
            name="maxParticipants"
            type="number"
            min={2}
            max={60}
            required
            defaultValue={String(event?.maxParticipants ?? 12)}
          />
          <SelectField
            label="发布状态"
            name="status"
            disabled={busy}
            onChange={() => setChanged(true)}
            options={{
              DRAFT: "草稿",
              OPEN: "开放报名",
              CLOSED: "停止报名",
              CANCELLED: "已取消",
            }}
            defaultValue={
              event && ["RUNNING", "FINISHED"].includes(event.status)
                ? event.signupClosed
                  ? "CLOSED"
                  : "OPEN"
                : (event?.status ?? "DRAFT")
            }
            required
          />
        </div>
        <section className="grid gap-4" aria-labelledby="event-cover-heading">
          <div>
            <h2 id="event-cover-heading" className="text-base font-semibold">
              活动封面
            </h2>
            <p className="mt-1 text-sm text-muted">
              用于活动卡片和详情，建议使用 16:9 横图。
            </p>
          </div>
          {previewCover &&
          isSafeImageSource(previewCover) &&
          failedCover !== previewCover ? (
            // eslint-disable-next-line @next/next/no-img-element -- 管理员填写或上传的活动封面预览。
            <img
              src={previewCover}
              alt="活动封面预览"
              className="aspect-video w-full max-w-lg rounded-xl object-cover"
              referrerPolicy="no-referrer"
              onError={() => setFailedCover(previewCover)}
            />
          ) : previewCover ? (
            <p role="status" className="text-sm text-danger">
              封面无法显示，请检查链接或重新上传。
            </p>
          ) : null}
          <InputField
            label="封面链接"
            name="coverUrl"
            value={coverUrl}
            disabled={busy}
            maxLength={2048}
            placeholder="https://…（可留空）"
            onChange={(change) => {
              setCoverUrl(change.target.value);
              setCoverError("");
              setCoverAuthRequired(false);
              setFailedCover(null);
            }}
          />
          <input
            ref={coverInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            aria-label="活动封面文件"
            className="hidden"
            disabled={busy}
            onChange={(change) => {
              const file = change.target.files?.[0];
              change.target.value = "";
              if (file) void uploadCover(file);
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              isDisabled={busy}
              onPress={() => coverInput.current?.click()}
            >
              {uploadingCover ? <Spinner size="sm" /> : null}
              {uploadingCover ? "上传中…" : "上传封面"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              isDisabled={busy || !coverUrl}
              onPress={() => {
                setCoverUrl("");
                setCoverError("");
                setCoverAuthRequired(false);
                setFailedCover(null);
                setChanged(true);
              }}
            >
              移除封面
            </Button>
            <span className="text-sm text-muted">
              PNG / JPEG / WebP / GIF，最大 2 MB
            </span>
          </div>
          {coverError ? (
            <Notice tone="danger">
              {coverError}
              {coverAuthRequired ? (
                <Link
                  href="/login"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 block underline"
                >
                  在新标签页重新登录
                </Link>
              ) : null}
            </Notice>
          ) : null}
        </section>
        <TextAreaField
          label="活动说明"
          name="description"
          required
          minLength={6}
          maxLength={1000}
          defaultValue={event?.description ?? ""}
          placeholder="介绍玩法、流程和集合方式…"
          className="min-h-36"
        />
        <details
          className="admin-disclosure border-t border-border"
          open={Boolean(event?.requirements || event?.voiceChannel)}
        >
          <summary>更多选项：参与要求与语音频道</summary>
          <div className="admin-disclosure-body grid gap-5">
            <TextAreaField
              label="参与要求"
              name="requirements"
              maxLength={500}
              defaultValue={event?.requirements ?? ""}
              placeholder="例如位置、段位或语音要求，可留空"
            />
            <InputField
              label="语音频道说明"
              name="voiceChannel"
              maxLength={200}
              defaultValue={event?.voiceChannel ?? ""}
              placeholder="例如 Discord 频道 / 开黑啦房间"
            />
          </div>
        </details>
        <div className="admin-settings-footer">
          <div className="min-w-0 flex-1" aria-live="polite">
            {result.message && (!result.ok || !changed) ? (
              <Notice tone={result.ok ? "success" : "danger"}>
                {result.message}
                {result.authRequired ? (
                  <Link
                    href="/login"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 block underline"
                  >
                    在新标签页重新登录
                  </Link>
                ) : null}
              </Notice>
            ) : changed ? (
              <p className="text-sm text-muted">有未保存的修改</p>
            ) : (
              (feedback ?? (
                <p className="text-sm text-muted">
                  {event
                    ? "保存后更新活动信息。"
                    : "草稿仅管理员可见，开放报名后显示在前台。"}
                </p>
              ))
            )}
          </div>
          <ActionButton pendingLabel="保存中…" isDisabled={busy}>
            <Save size={16} />
            {event ? "保存活动" : "创建活动"}
          </ActionButton>
        </div>
      </fieldset>
    </form>
  );
}
