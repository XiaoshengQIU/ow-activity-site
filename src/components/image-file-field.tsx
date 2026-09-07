"use client";

import { useId, useState } from "react";
import { shrinkForUpload } from "@/lib/image-downscale";

/**
 * 随表单一起提交的图片输入框。选中后先在浏览器里压到上限以内，再把压好的
 * 文件塞回 input，表单提交的就是压缩后的那一份。
 *
 * 独立上传的入口（文章正文、文章封面、活动封面、站点图片）各自直接调
 * shrinkForUpload；头像是跟着资料表单一起 POST 的，没有单独的上传时机，
 * 所以需要这一层。
 *
 * 这里用原生 input 而不是 InputField：后者底层是 react-aria 的 Input，
 * 它有自己的 onChange 语义，传进去的 DOM 事件处理函数不会被调用。
 */
export function ImageFileField({
  label,
  name,
  description,
  accept,
  limit,
}: {
  label: string;
  name: string;
  description?: string;
  accept: string;
  limit: number;
}) {
  const id = useId();
  const helpId = id + "-help";
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function prepare(input: HTMLInputElement, file: File) {
    setBusy(true);
    setNote("正在压缩图片…");
    try {
      const shrunk = await shrinkForUpload(file, limit);
      if (shrunk === file) {
        setNote("");
        return;
      }
      const carrier = new DataTransfer();
      carrier.items.add(shrunk);
      input.files = carrier.files;
      setNote(
        "已压缩：" +
          (file.size / 1024 / 1024).toFixed(1) +
          " MB → " +
          (shrunk.size / 1024).toFixed(0) +
          " KB",
      );
    } catch {
      // 压不动就原样提交，由服务端按大小给出提示。
      setNote("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-w-0 content-start gap-2">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="file"
        accept={accept}
        disabled={busy}
        className="input input--secondary w-full"
        aria-describedby={description || note ? helpId : undefined}
        onChange={(event) => {
          const input = event.target;
          const file = input.files?.[0];
          setNote("");
          if (file) void prepare(input, file);
        }}
      />
      <span id={helpId} className="description" role={note ? "status" : undefined}>
        {note || description}
      </span>
    </div>
  );
}
