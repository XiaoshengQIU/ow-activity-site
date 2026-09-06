"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { Button, Dropdown, Modal, buttonVariants } from "@heroui/react";
import {
  Bold,
  Italic,
  Strikethrough,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code2,
  Minus,
  Link2,
  Unlink,
  ImagePlus,
  Upload,
  Table2,
  Undo2,
  Redo2,
  MoreHorizontal,
} from "lucide-react";
import { articleEditorExtensions } from "@/lib/article-editor-extensions";
import { safeArticleUrl } from "@/lib/article-input";
import { InputField, Notice } from "@/components/ui";
import { uploadSiteAssetAction } from "@/app/admin/customize/actions";
import { shrinkForUpload } from "@/lib/image-downscale";

// 只认图片文件。剪贴板里同时有富文本和图片时，浏览器只在真正复制了图片
// （截图、右键复制图片）的情况下才会填 files，复制网页片段不会走到这里。
function imageFiles(data: DataTransfer | null) {
  return Array.from(data?.files ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
}

export function ArticleRichEditor({
  initialValue,
  onChange,
  disabled,
  onUploadChange,
}: {
  initialValue: string;
  onChange: (value: string) => void;
  disabled: boolean;
  onUploadChange: (busy: boolean) => void;
}) {
  const [dialog, setDialog] = useState<"link" | "image" | null>(null);
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [error, setError] = useState("");
  const [authRequired, setAuthRequired] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // editorProps 在 useEditor 里一次成型，而 upload 依赖 editor 本身，
  // 用 ref 中转拿到每次渲染后最新的那个。
  const uploadRef = useRef<(files: File[], at?: number) => void>(() => {});
  const editor = useEditor({
    extensions: articleEditorExtensions,
    content: initialValue,
    contentType: "markdown",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "article-prose article-editable",
        role: "textbox",
        "aria-label": "文章正文",
        "aria-multiline": "true",
      },
      // 截图和图片文件直接粘进正文，走和工具栏上传同一条链路。
      handlePaste: (_view, event) => {
        const files = imageFiles(event.clipboardData);
        if (!files.length) return false;
        event.preventDefault();
        uploadRef.current(files);
        return true;
      },
      // 拖进来的图片插在落点，而不是原来的光标处。
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = imageFiles(event.dataTransfer);
        if (!files.length) return false;
        event.preventDefault();
        uploadRef.current(
          files,
          view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos,
        );
        return true;
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getMarkdown()),
  });
  const active = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            bold: editor.isActive("bold"),
            italic: editor.isActive("italic"),
            strike: editor.isActive("strike"),
            heading2: editor.isActive("heading", { level: 2 }),
            heading3: editor.isActive("heading", { level: 3 }),
            bullet: editor.isActive("bulletList"),
            ordered: editor.isActive("orderedList"),
            task: editor.isActive("taskList"),
            quote: editor.isActive("blockquote"),
            code: editor.isActive("codeBlock"),
            link: editor.isActive("link"),
            table: editor.isActive("table"),
            undo: editor.can().undo(),
            redo: editor.can().redo(),
          }
        : null,
  });
  async function upload(files: File[], at?: number) {
    if (!editor || !files.length || disabled) return;
    setError("");
    setAuthRequired(false);
    onUploadChange(true);
    // 拖拽的第一张插在落点，其余顺着光标往后排。
    let position = at;
    try {
      for (const file of files) {
        const data = new FormData();
        data.set("file", await shrinkForUpload(file));
        const result = await uploadSiteAssetAction(data);
        if (!result.url) {
          setError(result.error || "上传失败。");
          setAuthRequired(result.authRequired ?? false);
          break;
        }
        const chain = editor.chain().focus();
        if (position !== undefined) chain.setTextSelection(position);
        chain
          .setImage({
            src: result.url,
            alt: file.name.replace(/\.[^.]+$/, ""),
          })
          .run();
        position = undefined;
      }
    } catch {
      setError("上传失败，请检查网络后重试。");
    } finally {
      onUploadChange(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  // editorProps 里的粘贴/拖拽处理拿不到后面定义的 upload，
  // 每次渲染后同步一次，避免闭包里留着旧的 disabled 和 editor。
  useEffect(() => {
    uploadRef.current = (files, at) => void upload(files, at);
  });
  if (!editor)
    return (
      <div className="editor-loading" role="status">
        正在加载编辑器…
      </div>
    );
  function openDialog(type: "link" | "image") {
    setUrl(type === "link" ? editor?.getAttributes("link").href || "" : "");
    setAlt("");
    setError("");
    setDialog(type);
  }
  function insert() {
    if (!editor) return;
    const value = safeArticleUrl(url.trim(), dialog === "image");
    if (!value) {
      setError("请输入有效的 HTTP、HTTPS 或本站地址。");
      return;
    }
    if (dialog === "image")
      editor.chain().focus().setImage({ src: value, alt: alt.trim() }).run();
    else if (editor.state.selection.empty && !editor.isActive("link"))
      editor
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text: value,
          marks: [{ type: "link", attrs: { href: value } }],
        })
        .run();
    else
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: value })
        .run();
    setDialog(null);
  }
  const buttons = [
    {
      label: "加粗",
      icon: Bold,
      active: active?.bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "斜体",
      icon: Italic,
      active: active?.italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "删除线",
      icon: Strikethrough,
      active: active?.strike,
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      label: "二级标题",
      icon: Heading2,
      active: active?.heading2,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "三级标题",
      icon: Heading3,
      active: active?.heading3,
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      label: "无序列表",
      icon: List,
      active: active?.bullet,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "有序列表",
      icon: ListOrdered,
      active: active?.ordered,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "任务列表",
      icon: ListChecks,
      active: active?.task,
      run: () => editor.chain().focus().toggleTaskList().run(),
    },
    {
      label: "引用",
      icon: Quote,
      active: active?.quote,
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "代码块",
      icon: Code2,
      active: active?.code,
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      label: "分隔线",
      icon: Minus,
      run: () => editor.chain().focus().setHorizontalRule().run(),
    },
    {
      label: "插入链接",
      icon: Link2,
      active: active?.link,
      run: () => openDialog("link"),
    },
    {
      label: "取消链接",
      icon: Unlink,
      disabled: !active?.link,
      run: () => editor.chain().focus().unsetLink().run(),
    },
    { label: "插入网络图片", icon: ImagePlus, run: () => openDialog("image") },
    {
      label: "插入表格",
      icon: Table2,
      run: () =>
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      label: "撤销",
      icon: Undo2,
      disabled: !active?.undo,
      run: () => editor.chain().focus().undo().run(),
    },
    {
      label: "重做",
      icon: Redo2,
      disabled: !active?.redo,
      run: () => editor.chain().focus().redo().run(),
    },
  ];
  const commonTools = new Set([
    "加粗",
    "斜体",
    "二级标题",
    "无序列表",
    "插入链接",
    "撤销",
    "重做",
  ]);
  return (
    <div className="rich-editor">
      <div className="editor-toolbar" role="group" aria-label="正文格式工具">
        {buttons
          .filter((button) => commonTools.has(button.label))
          .map(({ label, icon: Icon, active, disabled: unavailable, run }) => (
            <span key={label} title={label}>
              <Button
                type="button"
                size="sm"
                variant={active ? "secondary" : "ghost"}
                isIconOnly
                aria-label={label}
                aria-pressed={active}
                isDisabled={disabled || unavailable}
                onPress={() => {
                  run();
                }}
              >
                <Icon size={17} />
              </Button>
            </span>
          ))}
        <span title="上传正文图片">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            isIconOnly
            aria-label="上传正文图片"
            isDisabled={disabled}
            onPress={() => fileRef.current?.click()}
          >
            <Upload size={17} />
          </Button>
        </span>
        <Dropdown>
          <Dropdown.Trigger
            aria-label="更多格式工具"
            className={buttonVariants({
              size: "sm",
              variant: "ghost",
              isIconOnly: true,
            })}
            isDisabled={disabled}
          >
            <MoreHorizontal size={18} />
          </Dropdown.Trigger>
          <Dropdown.Popover placement="bottom end">
            <Dropdown.Menu aria-label="更多格式工具">
              {buttons
                .filter((button) => !commonTools.has(button.label))
                .map(({ label, icon: Icon, disabled: unavailable, run }) => (
                  <Dropdown.Item
                    key={label}
                    id={label}
                    textValue={label}
                    isDisabled={unavailable}
                    onAction={() => {
                      run();
                    }}
                  >
                    <Icon size={16} />
                    {label}
                  </Dropdown.Item>
                ))}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </div>
      {active?.table ? (
        <div className="editor-table-tools">
          {[
            {
              text: "增加一行",
              run: () => editor.chain().focus().addRowAfter().run(),
            },
            {
              text: "增加一列",
              run: () => editor.chain().focus().addColumnAfter().run(),
            },
            {
              text: "删除当前行",
              run: () => editor.chain().focus().deleteRow().run(),
            },
            {
              text: "删除当前列",
              run: () => editor.chain().focus().deleteColumn().run(),
            },
            {
              text: "删除表格",
              run: () => editor.chain().focus().deleteTable().run(),
            },
          ].map((item) => (
            <Button
              key={item.text}
              type="button"
              size="sm"
              variant="ghost"
              isDisabled={disabled}
              onPress={() => {
                item.run();
              }}
            >
              {item.text}
            </Button>
          ))}
        </div>
      ) : null}
      {error && !dialog ? (
        <div className="p-4">
          <Notice tone="danger">{error}</Notice>
          {authRequired ? (
            <Link
              href="/login"
              target="_blank"
              rel="noopener noreferrer"
              className="text-action mt-2"
            >
              在新标签页重新登录
            </Link>
          ) : null}
        </div>
      ) : null}
      <EditorContent editor={editor} />
      <input
        ref={fileRef}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(event) => void upload(Array.from(event.target.files ?? []))}
      />
      <Modal.Backdrop
        isOpen={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger aria-label="关闭" />
            <Modal.Header>
              <Modal.Heading>
                {dialog === "link" ? "插入链接" : "插入图片"}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className="grid gap-4">
              <InputField
                label={dialog === "link" ? "链接地址" : "图片地址"}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                autoFocus
                placeholder="https://"
                maxLength={2048}
                error={error}
              />
              {dialog === "image" ? (
                <InputField
                  label="图片说明"
                  value={alt}
                  onChange={(event) => setAlt(event.target.value)}
                  maxLength={300}
                />
              ) : (
                <p className="text-xs text-muted">
                  选中文字后插入链接；未选中时会直接插入地址。
                </p>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button
                type="button"
                variant="secondary"
                onPress={() => setDialog(null)}
              >
                取消
              </Button>
              <Button type="button" onPress={insert}>
                插入
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
