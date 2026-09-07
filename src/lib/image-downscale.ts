import { MAX_SITE_ASSET_BYTES } from "@/lib/site-asset";

// 截图动辄好几 MB，而站点图片上限是 2 MB。超限的先在浏览器里缩一版再传，
// 否则粘贴截图这条最常用的路径几乎总是被大小校验拦下。
// 逐级缩小直到压进上限。头像那种 512 KB 的紧限额需要更靠后的档位，
// 而头像显示尺寸只有几十像素，缩到 600 px 也完全够用。
const EDGES = [2000, 1400, 900, 600];
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

/**
 * 超出上限的图片先在浏览器里缩一版再上传。头像、封面、站点图片和正文内嵌图
 * 共用这一条路径，只是各自的上限不同。没超限的原样返回，不损画质。
 */
export async function shrinkForUpload(
  file: File,
  limit: number = MAX_SITE_ASSET_BYTES,
): Promise<File> {
  // 动图重新编码会丢掉动画，宁可让服务端按大小拒绝。
  if (file.type === "image/gif" || file.size <= limit) return file;
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
          blob.size <= limit
        )
          return renamed(file, blob);
      }
    }
    return file;
  } finally {
    bitmap.close();
  }
}
