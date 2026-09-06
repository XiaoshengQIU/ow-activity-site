import { MAX_SITE_ASSET_BYTES } from "@/lib/site-asset";

// 截图动辄好几 MB，而站点图片上限是 2 MB。超限的先在浏览器里缩一版再传，
// 否则粘贴截图这条最常用的路径几乎总是被大小校验拦下。
const EDGES = [2000, 1400];
const QUALITIES = [0.85, 0.7, 0.55];
const EXTENSIONS: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};

function renamed(file: File, blob: Blob) {
  const base = file.name.replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${base}.${EXTENSIONS[blob.type]}`, {
    type: blob.type,
  });
}

export async function shrinkForUpload(file: File): Promise<File> {
  // 动图重新编码会丢掉动画，宁可让服务端按大小拒绝。
  if (file.type === "image/gif" || file.size <= MAX_SITE_ASSET_BYTES)
    return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // 解码不了就原样交给服务端报错
  }
  try {
    for (const edge of EDGES) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return file;
      context.drawImage(bitmap, 0, 0, width, height);
      for (const quality of QUALITIES) {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/webp", quality),
        );
        // 不支持 webp 的浏览器会回落成 png，同样可以用，只要够小。
        if (
          blob &&
          EXTENSIONS[blob.type] &&
          blob.size > 0 &&
          blob.size <= MAX_SITE_ASSET_BYTES
        )
          return renamed(file, blob);
      }
    }
    return file;
  } finally {
    bitmap.close();
  }
}
