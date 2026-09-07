export const MAX_AVATAR_BYTES = 512 * 1024;

const ALLOWED_AVATAR_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export type AvatarUploadError = "avatar-size" | "avatar-type";

function hasValidSignature(type: string, bytes: Uint8Array) {
  if (type === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  if (type === "image/png") {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }

  if (type === "image/webp") {
    return (
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    );
  }

  if (type === "image/gif") {
    const signature = String.fromCharCode(...bytes.slice(0, 6));
    return signature === "GIF87a" || signature === "GIF89a";
  }

  return false;
}

// 头像曾经以 data URL 存进 Profile.avatarUrl，单张最多 512 KB、base64 后约
// 683 KB，而这个字段每次整页加载都会随会话一起读出来，玩家页更是一次读全部。
// 改为和站点图片走同一套 SiteAsset 存储，只在资料行里留一个地址。
export async function avatarFileToBytes(
  file: File,
): Promise<Uint8Array<ArrayBuffer>> {
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error("avatar-size" satisfies AvatarUploadError);
  }

  if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
    throw new Error("avatar-type" satisfies AvatarUploadError);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  if (!hasValidSignature(file.type, bytes)) {
    throw new Error("avatar-type" satisfies AvatarUploadError);
  }

  return bytes;
}

