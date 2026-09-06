ALTER TABLE "UpdateSettings" ALTER COLUMN "repositoryUrl" SET DEFAULT 'https://github.com/XiaoshengQIU/ow-activity-site';

UPDATE "UpdateSettings"
SET
  "repositoryUrl" = 'https://github.com/XiaoshengQIU/ow-activity-site',
  "revision" = "revision" + 1,
  "checkKey" = NULL,
  "checkResult" = NULL,
  "checkedAt" = NULL,
  "checkLease" = NULL,
  "checkLeaseUntil" = NULL
WHERE "repositoryUrl" = 'https://github.com/Uniseem/ow-activity-site';
