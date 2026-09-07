"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Accordion, Button, Card, Spinner } from "@heroui/react";
import { ButtonLink, InputField, Notice, TextAreaField } from "@/components/ui";
import { editableCopyFields } from "@/lib/site-copy";
import {
  imageFields,
  type ImageKey,
  type SiteConfiguration,
} from "@/lib/site-config";
import {
  saveSiteSettingsAction,
  uploadSiteAssetAction,
} from "@/app/admin/customize/actions";

const groups = [...new Set(editableCopyFields.map((field) => field.group))];

export function SiteEditor({
  initial,
  revision,
}: {
  initial: SiteConfiguration;
  revision: number;
}) {
  const [draft, setDraft] = useState(initial);
  const [uploadCount, setUploadCount] = useState(0);
  const [state, action, pending] = useActionState(
    async (
      previous: {
        ok: boolean;
        message: string;
        revision: number;
        snapshot: string;
      },
      data: FormData,
    ) => {
      const result = await saveSiteSettingsAction(previous, data);
      return {
        ...result,
        revision: result.revision ?? previous.revision,
        snapshot: result.ok
          ? String(data.get("configuration"))
          : previous.snapshot,
      };
    },
    { ok: false, message: "", revision, snapshot: JSON.stringify(initial) },
  );
  const dirty = JSON.stringify(draft) !== state.snapshot;
  const busy = pending || uploadCount > 0;

  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);

  function updateText(key: string, value: string) {
    setDraft((current) => {
      const texts = { ...current.texts };
      if (
        value ===
        editableCopyFields.find((field) => field.key === key)?.defaultValue
      )
        delete texts[key];
      else texts[key] = value;
      return { ...current, texts };
    });
  }

  function textSettings(group: string) {
    return editableCopyFields
      .filter((field) => field.group === group)
      .map((field) => {
        const multiline =
          field.multiline ||
          field.key.endsWith("Description") ||
          field.key.endsWith("description");
        const Field = multiline ? TextAreaField : InputField;
        return (
          <div key={field.key} className={multiline ? "sm:col-span-2" : ""}>
            <Field
              label={field.label}
              description={field.description}
              value={draft.texts[field.key] ?? field.defaultValue}
              required={field.required}
              disabled={busy}
              maxLength={field.key === "brand.name" ? 40 : 1000}
              onChange={(event) => updateText(field.key, event.target.value)}
            />
          </div>
        );
      });
  }

  function imageSettings(keys: ImageKey[]) {
    return imageFields
      .filter((field) => keys.includes(field.key))
      .map((field) => (
        <ImageSetting
          key={field.key}
          label={field.label}
          description={field.description}
          value={draft.images[field.key]}
          disabled={busy}
          onChange={(value) =>
            setDraft((current) => ({
              ...current,
              images: { ...current.images, [field.key]: value },
            }))
          }
          onUploadStart={() => setUploadCount((count) => count + 1)}
          onUploadEnd={() => setUploadCount((count) => count - 1)}
        />
      ));
  }

  return (
    <form action={action} className="grid gap-6">
      <input type="hidden" name="configuration" value={JSON.stringify(draft)} />
      <input type="hidden" name="revision" value={state.revision} />
      <div className="flex justify-end">
        <ButtonLink href="/" target="_blank" variant="ghost">
          查看网站
        </ButtonLink>
      </div>
      <Card className="gap-5 p-5">
        <h2 className="text-lg font-semibold">品牌信息</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          {textSettings("品牌信息")}
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {imageSettings(["logo", "favicon"])}
        </div>
      </Card>
      <Accordion allowsMultipleExpanded variant="surface">
        {groups
          .filter((group) => group !== "品牌信息")
          .map((group) => (
            <Accordion.Item key={group} id={group}>
              <Accordion.Heading>
                <Accordion.Trigger>
                  {group}
                  <Accordion.Indicator />
                </Accordion.Trigger>
              </Accordion.Heading>
              <Accordion.Panel>
                <Accordion.Body className="grid gap-5 sm:grid-cols-2">
                  {textSettings(group)}
                </Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        <Accordion.Item id="images">
          <Accordion.Heading>
            <Accordion.Trigger>
              可选配图
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className="grid gap-6 md:grid-cols-2">
              {imageSettings(["event"])}
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
      <Card className="sticky bottom-4 z-20 flex-row flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1" aria-live="polite">
          {state.message && (!state.ok || !dirty) ? (
            <Notice tone={state.ok ? "success" : "danger"}>
              {state.message}
            </Notice>
          ) : (
            <p className="text-sm text-muted">
              {dirty ? "有未保存的修改" : "所有设置已保存"}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            isDisabled={!dirty || busy}
            onPress={() => setDraft(JSON.parse(state.snapshot))}
          >
            撤销修改
          </Button>
          <Button type="submit" isPending={pending} isDisabled={!dirty || busy}>
            {pending ? <Spinner size="sm" color="current" /> : null}
            保存设置
          </Button>
        </div>
      </Card>
    </form>
  );
}

function ImageSetting({
  label,
  description,
  value,
  onChange,
  onUploadStart,
  onUploadEnd,
  disabled,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  onUploadStart: () => void;
  onUploadEnd: () => void;
  disabled: boolean;
}) {
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <section className="grid min-w-0 content-start gap-3">
      <h3 className="text-sm font-semibold">{label}</h3>
      <p className="text-sm leading-6 text-muted">{description}</p>
      {value && value !== failedSource ? (
        // eslint-disable-next-line @next/next/no-img-element -- Preview admin-selected assets directly.
        <img
          src={value}
          alt={label + "预览"}
          onError={() => setFailedSource(value)}
          className="h-24 w-full rounded-lg bg-surface-secondary object-contain"
        />
      ) : (
        <div className="grid h-24 place-items-center rounded-lg bg-surface-secondary text-sm text-muted">
          {value ? "图片无法加载，请检查链接" : "未设置图片"}
        </div>
      )}
      <InputField
        label={label + "链接"}
        value={value}
        disabled={disabled}
        maxLength={2048}
        placeholder="https://…"
        onChange={(event) => {
          setError("");
          onChange(event.target.value);
        }}
      />
      <input
        ref={fileInput}
        aria-label={label + "文件"}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        disabled={disabled}
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setError("");
          if (file.size > 2 * 1024 * 1024) {
            setError("图片不能超过 2 MB。");
            return;
          }
          setUploading(true);
          onUploadStart();
          try {
            const data = new FormData();
            data.set("file", file);
            const result = await uploadSiteAssetAction(data);
            if (result.url) onChange(result.url);
            else setError(result.error ?? "上传失败。");
          } catch {
            setError("上传失败，请稍后重试。");
          } finally {
            setUploading(false);
            onUploadEnd();
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-label={"上传" + label}
          isDisabled={disabled}
          onPress={() => fileInput.current?.click()}
        >
          上传图片
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={"清除" + label}
          isDisabled={disabled || !value}
          onPress={() => {
            setError("");
            setFailedSource(null);
            onChange("");
          }}
        >
          清除
        </Button>
        <span className="text-sm text-muted">
          PNG / JPEG / WebP / GIF，最大 2 MB
        </span>
      </div>
      {uploading ? (
        <span className="flex items-center gap-2 text-sm text-muted">
          <Spinner size="sm" />
          正在上传…
        </span>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </section>
  );
}
