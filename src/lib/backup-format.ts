import { z } from "zod";
import { normalizeRestoredAdmins } from "@/lib/admin-permissions";

export const BACKUP_VERSION = 1;
export const BACKUP_FORMAT = "sjtu-ow-site-backup";
export const BACKUP_MAX_BYTES = 8 * 1024 * 1024;
export const BACKUP_MAX_MEDIA_BYTES = 128 * 1024 * 1024;
export const BACKUP_MAX_ASSET_BYTES = 2 * 1024 * 1024;
export const BACKUP_MAX_FILES = 5001;
export const BACKUP_CHUNK_BYTES = 384 * 1024;
export const BACKUP_MAX_ROWS = 50_000;
// Worst case is many tiny media files: one chunk each, plus data.json's extra chunks.
export const BACKUP_MAX_CHUNKS =
  Math.ceil(BACKUP_MAX_BYTES / BACKUP_CHUNK_BYTES) +
  Math.max(BACKUP_MAX_FILES - 1, Math.ceil(BACKUP_MAX_MEDIA_BYTES / BACKUP_CHUNK_BYTES));
export const BACKUP_MAX_REQUEST_BYTES = 2 * 1024 * 1024;
export const BACKUP_MAX_UPLOAD_BASE64 = Math.ceil((BACKUP_CHUNK_BYTES * 4) / 3);
export const BACKUP_TABLES = ["User", "Profile", "AdminSetup", "OAuthConfig", "OAuthAccount", "UpdateSettings", "AiSettings", "Event", "EventRegistration", "Article", "SiteSettings", "SiteAsset"] as const;
export const BACKUP_FOREIGN_USER_FIELDS = ["userId", "authorId", "createdById", "reviewedById"] as const;
export const BACKUP_AUDIT_USER_FIELDS = ["updatedById", "uploadedById"] as const;
export type BackupTable = typeof BACKUP_TABLES[number];
export type BackupRow = Record<string, unknown>;
export type BackupSnapshot = { table: string; rows: BackupRow[] }[];
export class BackupError extends Error {}

const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const date = z.iso.datetime({ offset: true });
const text = z.string().max(100_000);
const short = z.string().max(2000);
const optionalText = text.nullable();
const optionalId = id.nullable();
const optionalDate = date.nullable();
const timestamps = { createdAt: date, updatedAt: date };
const playerRole = z.enum(["TANK", "DAMAGE", "SUPPORT", "FLEX"]);
const provider = z.enum(["google", "github"]);
const revision = z.number().int().nonnegative().max(2_147_483_000);
const passwordHash = z.string().regex(/^\$2[aby]\$(?:0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/).nullable();
const rowSchemas = {
  User: z.strictObject({ id, username: z.string().min(1).max(200), passwordHash, role: z.enum(["USER", "ADMIN"]), status: z.enum(["PENDING", "APPROVED", "REJECTED", "BANNED"]), primaryAdmin: z.boolean().optional().default(false), adminPermissions: z.array(z.string().min(1).max(40)).max(20).optional().default([]), ...timestamps }),
  Profile: z.strictObject({ id, userId: id, avatarUrl: z.string().max(3_000_000).nullable(), displayName: short, slogan: short, battleTag: short.nullable(), mainRole: playerRole.nullable(), mainHeroes: z.array(short).max(100), rank: short.nullable(), onlineTime: short.nullable(), contact: short.nullable(), extraNote: optionalText, reviewStatus: z.enum(["PENDING", "APPROVED", "REJECTED"]), reviewNote: optionalText, reviewedById: optionalId, reviewedAt: optionalDate, ...timestamps }),
  AdminSetup: z.strictObject({ id: z.literal("initial-admin"), completedAt: optionalDate }),
  OAuthConfig: z.strictObject({ provider, clientId: short, clientSecret: short.nullable(), enabled: z.boolean(), revision, updatedById: optionalId, updatedAt: date }),
  OAuthAccount: z.strictObject({ id, userId: id, provider, providerAccountId: z.string().min(1).max(500), email: short.nullable(), createdAt: date }),
  UpdateSettings: z.strictObject({ id: z.literal("global"), repositoryUrl: short, branch: short, deployHook: short.nullable(), revision, updatedById: optionalId, updatedAt: date }),
  AiSettings: z.strictObject({ id: z.literal("review"), preset: short, baseUrl: short, apiKey: short.nullable(), model: short, autoReview: z.boolean(), revision, updatedById: optionalId, updatedAt: date }),
  Event: z.strictObject({ id, title: short, description: text, coverUrl: short, type: z.enum(["SCRIM", "FUN", "TRAINING", "CUSTOM", "WATCH"]), customType: short.nullable(), startTime: date, signupDeadline: optionalDate, signupClosed: z.boolean(), maxParticipants: z.number().int().positive().max(1_000_000), requirements: optionalText, voiceChannel: short.nullable(), status: z.enum(["DRAFT", "OPEN", "CLOSED", "RUNNING", "FINISHED", "CANCELLED"]), createdById: id, ...timestamps }),
  EventRegistration: z.strictObject({ id, eventId: id, userId: id, preferredRole: playerRole.nullable(), heroes: z.array(short).max(100), voiceAvailable: z.boolean(), note: optionalText, status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]), reviewedById: optionalId, reviewedAt: optionalDate, ...timestamps }),
  Article: z.strictObject({ id, title: short, excerpt: text, coverUrl: short, content: z.string().max(4_000_000), status: z.enum(["DRAFT", "PUBLISHED"]), pinned: z.boolean().optional().default(false), revision, authorId: id, publishedAt: optionalDate, ...timestamps }),
  SiteSettings: z.strictObject({ id: z.literal("site"), values: z.record(z.string(), z.unknown()), revision, updatedById: optionalId, updatedAt: date }),
  SiteAsset: z.strictObject({ id, name: short, mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]), data: z.literal(""), uploadedById: id, createdAt: date }),
} satisfies Record<BackupTable, z.ZodType>;

export type BackupPreview = {
  users: number; administrators: string[]; articles: number; events: number;
  registrations: number; assets: number; hasSecrets: boolean;
};

export function validateBackupSnapshot(value: unknown): { snapshot: BackupSnapshot; preview: BackupPreview } {
  const outer = z.array(z.strictObject({ table: z.enum(BACKUP_TABLES), rows: z.array(z.record(z.string(), z.unknown())).max(BACKUP_MAX_ROWS) })).min(BACKUP_TABLES.length - 1).max(BACKUP_TABLES.length).safeParse(value);
  const present = outer.success ? new Set(outer.data.map((entry) => entry.table)) : new Set<string>();
  if (!outer.success || BACKUP_TABLES.some((table) => table !== "AiSettings" && !present.has(table)))
    throw new BackupError("备份数据表不完整或版本不兼容。");
  let count = 0;
  const snapshot: BackupSnapshot = BACKUP_TABLES.map((table) => {
    const rows = outer.data.find((entry) => entry.table === table)?.rows ?? [];
    count += rows.length;
    if (count > BACKUP_MAX_ROWS) throw new BackupError("备份超过 50,000 条记录限制。");
    const parsed = z.array(rowSchemas[table]).safeParse(rows);
    if (!parsed.success) throw new BackupError(`备份中的 ${table} 数据格式不正确。`);
    return { table, rows: parsed.data as BackupRow[] };
  });
  const rows = (table: BackupTable) => snapshot.find((entry) => entry.table === table)!.rows;
  const unique = (table: BackupTable, fields: string[]) => {
    const keys = rows(table).map((row) => JSON.stringify(fields.map((field) => row[field])));
    if (new Set(keys).size !== keys.length) throw new BackupError(`${table} 中存在重复记录。`);
  };
  for (const table of BACKUP_TABLES) unique(table, [table === "OAuthConfig" ? "provider" : "id"]);
  unique("User", ["username"]); unique("Profile", ["userId"]);
  unique("OAuthAccount", ["provider", "providerAccountId"]); unique("OAuthAccount", ["userId", "provider"]);
  unique("EventRegistration", ["eventId", "userId"]);
  const users = new Set(rows("User").map((row) => row.id));
  const events = new Set(rows("Event").map((row) => row.id));
  for (const entry of snapshot) for (const row of entry.rows) {
    // Only real foreign keys must resolve. updatedById / uploadedById are
    // historical audit fields without database FKs and may name deleted users.
    for (const field of BACKUP_FOREIGN_USER_FIELDS)
      if (row[field] != null && !users.has(row[field])) throw new BackupError(`${entry.table} 引用了不存在的账号。`);
    if (entry.table === "EventRegistration" && !events.has(row.eventId)) throw new BackupError("报名记录引用了不存在的活动。");
    if (entry.table === "OAuthConfig" && row.enabled && (!row.clientId || !row.clientSecret)) throw new BackupError("启用的第三方登录缺少应用密钥。");
  }
  normalizeRestoredAdmins(rows("User"));
  const administrators = rows("User").filter((row) => row.role === "ADMIN" && row.status === "APPROVED" && row.passwordHash).map((row) => String(row.username));
  if (!administrators.length) throw new BackupError("备份必须包含至少一个已启用且设有密码的管理员账号，以便恢复后登录。");
  return { snapshot, preview: { users: rows("User").length, administrators, articles: rows("Article").length, events: rows("Event").length, registrations: rows("EventRegistration").length, assets: rows("SiteAsset").length, hasSecrets: rows("OAuthConfig").some((row) => row.clientSecret) || rows("UpdateSettings").some((row) => row.deployHook) || rows("AiSettings").some((row) => row.apiKey) } };
}

const fileSchema = z.strictObject({
  path: z.string().max(220).regex(/^(?:data\.json|media\/[A-Za-z0-9_-]+\.bin)$/),
  bytes: z.number().int().positive().max(BACKUP_MAX_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const backupManifestSchema = z.strictObject({
  format: z.literal(BACKUP_FORMAT), version: z.literal(BACKUP_VERSION), createdAt: date,
  files: z.array(fileSchema).min(1).max(BACKUP_MAX_FILES),
}).superRefine((manifest, context) => {
  const paths = manifest.files.map((file) => file.path);
  if (paths[0] !== "data.json" || new Set(paths).size !== paths.length || manifest.files.slice(1).some((file) => !file.path.startsWith("media/") || file.bytes > BACKUP_MAX_ASSET_BYTES) || manifest.files.slice(1).reduce((sum, file) => sum + file.bytes, 0) > BACKUP_MAX_MEDIA_BYTES)
    context.addIssue({ code: "custom", message: "备份媒体文件清单或大小不正确。" });
});
export type BackupManifest = z.infer<typeof backupManifestSchema>;
export type BackupFile = BackupManifest["files"][number];
export function fileChunkCount(bytes: number) {
  return Math.ceil(bytes / BACKUP_CHUNK_BYTES);
}
export function fileChunkStart(manifest: BackupManifest, fileIndex: number) {
  return manifest.files.slice(0, fileIndex).reduce((sum, file) => sum + fileChunkCount(file.bytes), 0);
}
export function manifestChunkCount(manifest: BackupManifest) {
  return manifest.files.reduce((sum, file) => sum + fileChunkCount(file.bytes), 0);
}

const transferId = z.string().uuid();
export const backupRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("export") }),
  z.strictObject({ operation: z.literal("download"), id: transferId, index: z.number().int().min(0).max(BACKUP_MAX_CHUNKS) }),
  z.strictObject({ operation: z.literal("import"), manifest: z.unknown() }),
  z.strictObject({ operation: z.literal("upload"), id: transferId, index: z.number().int().min(0).max(BACKUP_MAX_CHUNKS), data: z.string().max(BACKUP_MAX_UPLOAD_BASE64) }),
  z.strictObject({ operation: z.literal("preview"), id: transferId }),
  z.strictObject({ operation: z.literal("restore"), id: transferId, confirmation: z.string().max(30) }),
  z.strictObject({ operation: z.literal("cancel"), id: transferId }),
]);
export function isTrustedBackupOrigin(origin: string | null, expectedOrigin: string) {
  return Boolean(origin && origin === expectedOrigin);
}
