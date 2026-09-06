import { createHash, randomUUID } from "node:crypto";
import { type PrismaClient, type Prisma } from "../generated/prisma/client";
import { hasPermission } from "./admin-permissions";
import { seal, unseal, hasEncryptionKey } from "./oauth/security";
import { validateSiteAsset } from "./site-asset";
import { BACKUP_CHUNK_BYTES, BACKUP_FORMAT, BACKUP_MAX_BYTES, BACKUP_MAX_MEDIA_BYTES, BACKUP_MAX_ASSET_BYTES, BACKUP_MAX_FILES, BACKUP_TABLES, BACKUP_VERSION, BackupError, backupManifestSchema, fileChunkCount, fileChunkStart, manifestChunkCount, validateBackupSnapshot, type BackupManifest, type BackupRow, type BackupSnapshot } from "./backup-format";

type TransferDb = Pick<PrismaClient, "backupTransfer" | "backupChunk">;
const TTL = 30 * 60 * 1000;
const hookContext = "site-update:vercel-deploy-hook";
const modelNames = ["user", "profile", "adminSetup", "oAuthConfig", "oAuthAccount", "updateSettings", "aiSettings", "event", "eventRegistration", "article", "siteSettings", "siteAsset"];
const deleteOrder = ["Session", "OAuthState", "EventRegistration", "Article", "Profile", "OAuthAccount", "Event", "User", "AdminSetup", "OAuthConfig", "UpdateSettings", "AiSettings", "SiteSettings", "SiteAsset"];
const insertOrder = ["User", "Profile", "AdminSetup", "OAuthConfig", "OAuthAccount", "UpdateSettings", "AiSettings", "Event", "EventRegistration", "Article", "SiteSettings", "SiteAsset"];
const aiKeyContext = "ai-settings:review";
const digest = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
// /api/site-assets/[id] 只认 20-40 位小写字母数字，带连字符的 UUID 会被判成 404。
export const siteAssetId = () => "avatar" + randomUUID().replaceAll("-", "");

export function portableSnapshot(snapshot: BackupSnapshot, key: string | undefined): BackupSnapshot {
  return snapshot.map(({ table, rows }) => ({ table, rows: rows.map((source) => {
    const row = JSON.parse(JSON.stringify(source)) as BackupRow;
    if (table === "SiteAsset") { row.data = ""; delete row.storageKey; delete row.byteSize; }
    if (table === "OAuthConfig") {
      row.clientSecret = row.encryptedSecret ? unseal(String(row.encryptedSecret), `oauth-config:${row.provider}`, key) : null;
      delete row.encryptedSecret;
    }
    if (table === "UpdateSettings") {
      row.deployHook = row.encryptedDeployHook ? unseal(String(row.encryptedDeployHook), hookContext, key) : null;
      for (const field of ["encryptedDeployHook", "checkKey", "checkResult", "checkedAt", "checkLease", "checkLeaseUntil", "deployRequestedAt", "deployRequestedSha", "deployJobId"]) delete row[field];
    }
    if (table === "AiSettings") {
      row.apiKey = row.encryptedApiKey ? unseal(String(row.encryptedApiKey), aiKeyContext, key) : null;
      delete row.encryptedApiKey;
    }
    return row;
  }) }));
}

export function restoredSnapshot(snapshot: BackupSnapshot, key: string | undefined): BackupSnapshot {
  const restored = snapshot.map(({ table, rows }) => ({ table, rows: rows.map((source) => {
    const row = { ...source };
    if (table === "OAuthConfig") {
      if (row.clientSecret && !hasEncryptionKey(key)) throw new BackupError("此备份含登录密钥，请先为目标站点设置 OAUTH_ENCRYPTION_KEY。");
      row.encryptedSecret = row.clientSecret ? seal(String(row.clientSecret), `oauth-config:${row.provider}`, key) : null;
      delete row.clientSecret;
    }
    if (table === "UpdateSettings") {
      if (row.deployHook && !hasEncryptionKey(key)) throw new BackupError("此备份含部署密钥，请先为目标站点设置 OAUTH_ENCRYPTION_KEY。");
      row.encryptedDeployHook = row.deployHook ? seal(String(row.deployHook), hookContext, key) : null;
      delete row.deployHook;
      for (const field of ["checkKey", "checkResult", "checkedAt", "checkLease", "checkLeaseUntil", "deployRequestedAt", "deployRequestedSha", "deployJobId"]) row[field] = null;
    }
    if (table === "AiSettings") {
      if (row.apiKey && !hasEncryptionKey(key)) throw new BackupError("此备份含模型密钥，请先为目标站点设置 OAUTH_ENCRYPTION_KEY。");
      row.encryptedApiKey = row.apiKey ? seal(String(row.apiKey), aiKeyContext, key) : null;
      delete row.apiKey;
    }
    if (table === "AdminSetup" && !row.completedAt) row.completedAt = new Date().toISOString();
    return row;
  }) }));
  const setup = restored.find((entry) => entry.table === "AdminSetup")!;
  if (!setup.rows.length) setup.rows.push({ id: "initial-admin", completedAt: new Date().toISOString() });
  return restored;
}

async function postgresMetadata(tx: Prisma.TransactionClient): Promise<BackupSnapshot> {
  let estimatedBytes = 0, totalRows = 0;
  for (const table of BACKUP_TABLES) {
    const expression = table === "SiteAsset" ? "(to_jsonb(t) - 'data')::text" : "row_to_json(t)::text";
    const [size] = await tx.$queryRawUnsafe<{ bytes: string; count: string }[]>(`SELECT COALESCE(SUM(octet_length(${expression})), 0)::text AS bytes, COUNT(*)::text AS count FROM "${table}" t`);
    estimatedBytes += Number(size.bytes); totalRows += Number(size.count);
    if (estimatedBytes > BACKUP_MAX_BYTES || totalRows > 50_000) throw new BackupError("元数据（含旧式内嵌头像）超过 8 MB 或 50,000 条记录上限。没有省略任何数据，请使用数据库导出工具。");
  }
  const [media] = await tx.$queryRawUnsafe<{ bytes: string; largest: string }[]>(`SELECT COALESCE(SUM(octet_length("data")), 0)::text AS bytes, COALESCE(MAX(octet_length("data")), 0)::text AS largest FROM "SiteAsset"`);
  if (Number(media.bytes) > BACKUP_MAX_MEDIA_BYTES || Number(media.largest) > BACKUP_MAX_ASSET_BYTES) throw new BackupError("图片总量超过 128 MB 或单图超过 2 MB，无法生成完整备份。");
  const result: BackupSnapshot = [];
  for (const [index, table] of BACKUP_TABLES.entries()) {
    if (table === "SiteAsset") {
      result.push({ table, rows: await tx.$queryRawUnsafe<BackupRow[]>(`SELECT "id", "name", "mimeType", '' AS "data", octet_length("data") AS "byteSize", "uploadedById", "createdAt" FROM "SiteAsset"`) });
    } else {
      const model = (tx as unknown as Record<string, { findMany(): Promise<BackupRow[]> }>)[modelNames[index]];
      result.push({ table, rows: await model.findMany() });
    }
  }
  return result;
}

async function stageFile(db: TransferDb, transferId: string, bytes: Uint8Array, index: number) {
  for (let offset = 0; offset < bytes.length; offset += BACKUP_CHUNK_BYTES) {
    await db.backupChunk.create({ data: { id: randomUUID(), transferId, index: index++, data: Buffer.from(bytes.subarray(offset, offset + BACKUP_CHUNK_BYTES)).toString("base64") } });
  }
  return index;
}

async function freezeExport(db: TransferDb, source: BackupSnapshot, ownerId: string, key: string | undefined, readAsset: (row: BackupRow) => Promise<Uint8Array>) {
  const sourceAssets = source.find((entry) => entry.table === "SiteAsset")!.rows;
  const snapshot = portableSnapshot(source, key);
  const assets = snapshot.find((entry) => entry.table === "SiteAsset")!.rows;
  // Older accounts store small avatars as data URLs. Move those bytes into
  // ordinary archive media; restored profiles point at the same portable asset.
  const inlineMedia = new Map<string, Uint8Array>();
  for (const profile of snapshot.find((entry) => entry.table === "Profile")!.rows) {
    if (typeof profile.avatarUrl !== "string" || !profile.avatarUrl.startsWith("data:")) continue;
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(profile.avatarUrl);
    if (!match) throw new BackupError("玩家头像的数据格式不受支持，无法生成完整备份。");
    const id = siteAssetId(), data = Buffer.from(match[2], "base64");
    assets.push({ id, name: `${profile.displayName}头像`, mimeType: match[1], data: "", uploadedById: profile.userId, createdAt: profile.createdAt });
    inlineMedia.set(id, data); profile.avatarUrl = `/api/site-assets/${id}`;
  }
  if (assets.length + 1 > BACKUP_MAX_FILES) throw new BackupError("备份图片超过 5,000 张上限。");
  const { preview } = validateBackupSnapshot(snapshot);
  const metadata = Buffer.from(JSON.stringify(snapshot));
  if (metadata.length > BACKUP_MAX_BYTES) throw new BackupError("完整元数据超过 8 MB 上限，没有省略任何数据。");
  const manifest: BackupManifest = { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date().toISOString(), files: [{ path: "data.json", bytes: metadata.length, sha256: digest(metadata) }] };
  const id = randomUUID();
  await db.backupTransfer.create({ data: { id, ownerId, kind: "building", manifest, expiresAt: new Date(Date.now() + TTL) } });
  try {
    let next = await stageFile(db, id, metadata, 0), mediaBytes = 0;
    for (const asset of assets) {
      const bytes = inlineMedia.get(String(asset.id)) ?? await readAsset(sourceAssets.find((row) => row.id === asset.id)!);
      mediaBytes += bytes.length;
      if (mediaBytes > BACKUP_MAX_MEDIA_BYTES) throw new BackupError("备份图片总量超过 128 MB 上限，没有省略任何图片。");
      await validateAssetBytes(asset, bytes);
      manifest.files.push({ path: `media/${asset.id}.bin`, bytes: bytes.length, sha256: digest(bytes) });
      next = await stageFile(db, id, bytes, next);
      inlineMedia.delete(String(asset.id));
    }
    await db.backupTransfer.update({ where: { id }, data: { kind: "export", manifest } });
    return { id, manifest, chunks: next, preview };
  } catch (error) { await db.backupTransfer.deleteMany({ where: { id } }); throw error; }
}

async function prepareTransfer(db: PrismaClient, ownerId: string) {
  await db.backupTransfer.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  if (await db.backupTransfer.count({ where: { ownerId } }) >= 2) await db.backupTransfer.deleteMany({ where: { ownerId } });
}

export async function startBackupExport(db: PrismaClient, ownerId: string, key: string | undefined) {
  await prepareTransfer(db, ownerId);
  try {
    return await db.$transaction(async (tx) => freezeExport(tx, await postgresMetadata(tx), ownerId, key, async (asset) => {
      const row = await tx.siteAsset.findUnique({ where: { id: String(asset.id) }, select: { data: true } });
      if (!row) throw new BackupError("备份图片不存在。");
      return row.data;
    }), { isolationLevel: "RepeatableRead", timeout: 240_000 });
  } catch (error) { if (error instanceof BackupError) throw error; throw new BackupError("无法生成完整备份。请检查数据库、图片存储和原站点加密密钥，未生成不完整文件。"); }
}

async function ownedTransfer(db: TransferDb, id: string, ownerId: string, kind?: string) {
  const transfer = await db.backupTransfer.findUnique({ where: { id } });
  if (!transfer || transfer.ownerId !== ownerId || transfer.expiresAt <= new Date() || (kind && transfer.kind !== kind)) throw new BackupError("备份任务已过期或无权访问，请重新开始。");
  return transfer;
}
export async function downloadBackupChunk(db: PrismaClient, id: string, ownerId: string, index: number) {
  await ownedTransfer(db, id, ownerId, "export");
  const chunk = await db.backupChunk.findUnique({ where: { transferId_index: { transferId: id, index } } });
  if (!chunk) throw new BackupError("备份分块不存在。");
  return { data: chunk.data };
}
export async function startBackupImport(db: PrismaClient, ownerId: string, value: unknown) {
  const parsed = backupManifestSchema.safeParse(value);
  if (!parsed.success) throw new BackupError("备份清单不正确或版本不兼容。");
  await prepareTransfer(db, ownerId);
  const id = randomUUID();
  await db.backupTransfer.create({ data: { id, ownerId, kind: "import", manifest: parsed.data, expiresAt: new Date(Date.now() + TTL) } });
  return { id, chunks: manifestChunkCount(parsed.data) };
}

function chunkExpectedSize(manifest: BackupManifest, index: number) {
  let start = 0;
  for (const file of manifest.files) {
    const count = fileChunkCount(file.bytes);
    if (index >= start && index < start + count) return Math.min(BACKUP_CHUNK_BYTES, file.bytes - (index - start) * BACKUP_CHUNK_BYTES);
    start += count;
  }
  return 0;
}
export async function uploadBackupChunk(db: PrismaClient, id: string, ownerId: string, index: number, data: string) {
  const transfer = await ownedTransfer(db, id, ownerId, "import");
  const expected = chunkExpectedSize(backupManifestSchema.parse(transfer.manifest), index);
  const bytes = Buffer.from(data, "base64");
  if (!Number.isSafeInteger(index) || index < 0 || expected <= 0 || bytes.length !== expected || bytes.toString("base64") !== data) throw new BackupError("备份分块大小或编码不正确。");
  await db.backupChunk.upsert({ where: { transferId_index: { transferId: id, index } }, create: { id: randomUUID(), transferId: id, index, data }, update: { data } });
  return { ok: true };
}

async function readStagedFile(db: TransferDb, transferId: string, manifest: BackupManifest, fileIndex: number): Promise<Uint8Array> {
  const file = manifest.files[fileIndex], start = fileChunkStart(manifest, fileIndex), count = fileChunkCount(file.bytes);
  const chunks = await db.backupChunk.findMany({ where: { transferId, index: { gte: start, lt: start + count } }, orderBy: { index: "asc" } });
  if (chunks.length !== count || chunks.some((chunk, index) => chunk.index !== start + index)) throw new BackupError("备份尚未上传完整。");
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.data, "base64")));
  if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new BackupError(`备份文件 ${file.path} 完整性校验失败。`);
  return bytes;
}
async function validateAssetBytes(asset: BackupRow, bytes: Uint8Array) {
  try { await validateSiteAsset(new File([new Uint8Array(bytes).buffer], String(asset.name), { type: String(asset.mimeType) })); }
  catch { throw new BackupError(`备份中的图片格式或大小不正确（${asset.id}）。`); }
}
async function loadImport(db: PrismaClient, id: string, ownerId: string, validateMedia: boolean) {
  const transfer = await ownedTransfer(db, id, ownerId, "import");
  const manifest = backupManifestSchema.parse(transfer.manifest);
  const expectedCount = manifestChunkCount(manifest);
  if (await db.backupChunk.count({ where: { transferId: id } }) !== expectedCount) throw new BackupError("备份尚未上传完整。");
  const bytes = await readStagedFile(db, id, manifest, 0);
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { throw new BackupError("备份元数据不是有效 JSON。"); }
  const parsed = validateBackupSnapshot(value);
  const assets = parsed.snapshot.find((entry) => entry.table === "SiteAsset")!.rows;
  if (assets.length !== manifest.files.length - 1) throw new BackupError("备份图片与元数据数量不一致。");
  const assetMap = new Map(assets.map((asset) => [String(asset.id), asset]));
  for (let index = 1; index < manifest.files.length; index++) {
    const asset = assetMap.get(manifest.files[index].path.slice(6, -4));
    if (!asset) throw new BackupError("备份引用了不存在的图片。");
    if (validateMedia) await validateAssetBytes(asset, await readStagedFile(db, id, manifest, index));
  }
  return { ...parsed, manifest };
}

export async function previewBackupImport(db: PrismaClient, id: string, ownerId: string, key: string | undefined) {
  const parsed = await loadImport(db, id, ownerId, true);
  restoredSnapshot(parsed.snapshot, key);
  return { preview: parsed.preview, manifest: parsed.manifest };
}

export async function replaceDatabaseSnapshot(
  db: PrismaClient,
  snapshot: BackupSnapshot,
  actorId: string,
  media?: { transferId: string; manifest: BackupManifest },
  options?: { setup?: boolean },
) {
  const assetIndex = new Map(media?.manifest.files.map((file, index) => [file.path, index]));
  await db.$transaction(async (tx) => {
    // Exclude concurrent writers while replacing every table. Any failed insert,
    // late asset checksum mismatch or constraint violation rolls back all deletes.
    await tx.$executeRawUnsafe(`LOCK TABLE ${deleteOrder.map((table) => `"${table}"`).join(", ")} IN EXCLUSIVE MODE`);
    if (options?.setup) {
      const setup = await tx.adminSetup.findUnique({ where: { id: "initial-admin" } });
      const existingAdmin = await tx.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
      if (!setup || setup.completedAt || existingAdmin)
        throw new BackupError("管理员已创建，首次注册入口已关闭。请使用已有账号登录。");
    } else {
      const admin = await tx.user.findUnique({ where: { id: actorId } });
      if (!hasPermission(admin, "backup")) throw new BackupError("管理员登录已失效，或没有备份权限。");
    }
    for (const table of deleteOrder) await tx.$executeRawUnsafe(`DELETE FROM "${table}"`);
    for (const table of insertOrder) {
      const rows = snapshot.find((entry) => entry.table === table)!.rows;
      if (table === "SiteAsset") {
        for (const row of rows) {
          if (!media) throw new BackupError("缺少恢复图片来源。");
          const bytes = await readStagedFile(tx, media.transferId, media.manifest, assetIndex.get(`media/${row.id}.bin`)!);
          await validateAssetBytes(row, bytes);
          await tx.siteAsset.create({ data: { id: String(row.id), name: String(row.name), mimeType: String(row.mimeType), data: new Uint8Array(bytes), uploadedById: String(row.uploadedById), createdAt: new Date(String(row.createdAt)) } });
        }
      } else for (let start = 0; start < rows.length; start += 100) {
        // Identifiers come solely from the fixed allowlist, values are parameters.
        await tx.$executeRawUnsafe(`INSERT INTO "${table}" SELECT * FROM jsonb_populate_recordset(NULL::"${table}", $1::jsonb)`, JSON.stringify(rows.slice(start, start + 100)));
      }
    }
    await tx.backupTransfer.deleteMany();
  }, { timeout: 240_000, maxWait: 15_000 });
}
export async function restoreBackupImport(
  db: PrismaClient,
  id: string,
  ownerId: string,
  key: string | undefined,
  confirmation: string,
  options?: { setup?: boolean },
) {
  if (confirmation !== "覆盖恢复") throw new BackupError("请输入“覆盖恢复”以确认替换当前网站数据。");
  const parsed = await loadImport(db, id, ownerId, true);
  await replaceDatabaseSnapshot(
    db,
    restoredSnapshot(parsed.snapshot, key),
    ownerId,
    { transferId: id, manifest: parsed.manifest },
    options,
  );
  return { ok: true, administrators: parsed.preview.administrators };
}
export async function cancelBackupTransfer(db: PrismaClient, id: string, ownerId: string) {
  await db.backupTransfer.deleteMany({ where: { id, ownerId } });
  return { ok: true };
}
