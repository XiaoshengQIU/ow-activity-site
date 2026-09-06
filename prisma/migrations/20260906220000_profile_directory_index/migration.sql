-- 玩家目录按审核状态取，并按 updatedAt 倒序；位置筛选也下推到了数据库。
CREATE INDEX "Profile_reviewStatus_updatedAt_idx" ON "Profile"("reviewStatus", "updatedAt");
CREATE INDEX "Profile_reviewStatus_mainRole_updatedAt_idx" ON "Profile"("reviewStatus", "mainRole", "updatedAt");
