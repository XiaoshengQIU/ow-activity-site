# 部署到 Vercel

**这是本仓库强烈推荐的部署方式。** 新站点、校园公开站和日常更新都应走 Vercel，不要再用 Cloudflare Workers。

Vercel 托管 Next.js 页面和服务端逻辑，Marketplace 里的 Neon Postgres 保存账号、会话、资料、活动与报名。构建由 Vercel 自己执行 `npm run vercel-build`。后台「版本更新」里的 Deploy Hook 也只对这条路径有效。

## 创建项目和数据库

1. 在 Vercel 导入 GitHub 仓库，根目录选择仓库根目录，框架选择 **Next.js**。
2. 在项目的 **Storage / Marketplace** 添加 **Neon Postgres**，选择由 Vercel 管理的集成并关联当前项目。
3. 数据库地区尽量与 Vercel Functions 地区一致。
4. 确认环境变量有 `DATABASE_URL` 和 `DATABASE_URL_UNPOOLED`，分别为连接池和直连地址。若集成设置了变量前缀，需映射为这里的变量名。
5. Preview 绑定独立的 Neon 数据库分支，Production 绑定生产分支。构建会执行迁移，两个环境分别使用自己的地址。

Vercel 原独立 Postgres 产品已停止提供，新项目通过 Marketplace 接入。参考 [官方说明](https://vercel.com/docs/postgres) 和 [Neon 集成](https://vercel.com/marketplace/neon)。

## 构建配置

活动日期统一按 `Asia/Shanghai` 处理。`vercel.json` 配置每日上海时间 00:00 的状态同步任务，请在 Vercel 生产环境设置随机的 `CRON_SECRET`，用于验证定时请求。新迁移会保留旧活动的上海日期，并将已移除的活动类型转为带原名称的自定义类型。

Vercel 的定时调用可能延迟，因此活动页面、后台和报名操作也会在读取数据前同步状态。定时任务仅在生产部署运行；本地和预览环境通过请求时同步保持状态正确。参考 [Vercel 定时任务配置](https://vercel.com/docs/cron-jobs/quickstart) 与 [调度限制](https://vercel.com/docs/cron-jobs/usage-and-pricing)。

`vercel.json` 已设置：

```text
Install Command: npm ci
Build Command: npm run vercel-build
Framework: Next.js
git.deploymentEnabled: false
```

推送到已连接的 Git 仓库不会再自动创建 Deployment。需要发布时在 Vercel 控制台手动 Deploy，或使用 CLI / Deploy Hook。

安装依赖时生成 Prisma 客户端。构建先执行 `prisma migrate deploy`，然后重新生成客户端并执行 `next build`，避免依赖缓存带来旧客户端。

应用使用 Node.js runtime，不需要独立 API 服务或静态导出目录。部署构建必须提供有效数据库连接；管理员初始化不会在构建中自动执行。纯本地构建使用 `npm run build`，不会修改数据库。

## 初始化管理员

新站点部署完成后打开 `/admin`，没有管理员时会转到 `/admin/setup`。可以在这一页注册首位管理员，也可以上传以前导出的备份 ZIP 恢复原账号。填写用户名、公开昵称、密码和确认密码后，第一个成功提交的账号获得管理员权限并进入后台，不需要预设管理员环境变量。

首次注册通过数据库事务完成，并发提交只能创建一名管理员。成功后入口永久关闭，后续普通用户仍需审核。升级已有管理员的站点时也会关闭此入口，不会改变原有账号权限。

需要通过命令行初始化或恢复管理员时，在本地配置目标数据库地址，并设置 `ADMIN_USERNAME`、`ADMIN_PASSWORD`。可以用 Vercel CLI 将生产变量拉取到独立的本地文件，避免覆盖开发配置：

```bash
npx vercel link
npx vercel env pull .env.production.local --environment=production
```

确认关联的是当前项目和预期环境，加载该文件并设置 `NODE_ENV=production`、管理员用户名及密码，然后运行：

```bash
npm run db:deploy
npm run db:seed
```

命令行初始化会关闭网页首次注册入口，只创建或更新该管理员，不生成演示活动。重复执行会重设该账号密码，其他用户和活动保留。完成后可移除本地管理员密码；Vercel 运行时也不需要这个密码环境变量。

## Google 和 GitHub 登录

1. 在 Vercel Production 环境添加 Secret `OAUTH_ENCRYPTION_KEY`，使用 32 字节随机值的十六进制编码（64 字符）。可以运行 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` 生成，设置后重新部署。不要把该值提交到 Git。
2. 管理员登录 `/admin/oauth`，按页面链接分别创建 [Google Web 应用 OAuth 客户端](https://developers.google.com/identity/openid-connect/openid-connect#settingup) 和 [GitHub OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)。将后台显示的完整回调地址填入对应平台。
3. 在后台填写各自的 Client ID、Client Secret，勾选“启用”并保存。两平台默认关闭，未填写完整时无法启用；保存后无需重新部署。
4. 在登录页使用相应按钮。已有账号应先登录个人中心，绑定第三方账号后再用一键登录，避免另建账号。第三方注册的账号可在个人中心设置密码后再解绑。新注册用户仍需管理员审核。

Google 应用处于测试状态时，需在 Google 控制台添加允许登录的测试用户。Client Secret 保存后不会回显，留空保留原值；更换 Client ID 时也需填写新的 Client Secret。

生产回调地址使用 `NEXT_PUBLIC_SITE_URL` 或 Vercel 的生产域名。更换域名后须同步更新两平台的回调配置；开发环境使用独立的客户端与数据库。未经配置的预览环境保持按钮置灰。

平台真实授权需要管理员提供有效凭据后验证。仓库中的自动测试通过本地签发的测试令牌和模拟响应校验协议与身份校验逻辑，不依赖个人 Google/GitHub 凭据。

## 管理员版本检查与更新

管理员登录后自动检查，无需配置定时任务。前往 `/admin/updates` 填写监测的公开 GitHub 仓库和可选分支，默认使用 `Uniseem/ow-activity-site` 的默认分支。

1. 将 Vercel 项目连接到实际部署的 Git 仓库。
2. 在项目 **Settings → Git → Deploy Hooks** 创建指向生产分支的 Hook。
3. 在后台保存完整 Hook 链接。该链接加密存储，复用现有 `OAUTH_ENCRYPTION_KEY`；留空可保留，勾选可清除。修改监测来源后，旧 Hook 会清除，需重新配置。
4. 有更新时，管理员查看逐条提交记录后，点击“更新网站”并确认；系统提交部署请求，不会自动批准或执行更新。

Hook 部署其绑定的仓库分支，不负责将上游改动同步到 fork。若监测上游，请先同步相应生产分支。部署失败、超时或仍在构建时，本站版本号不会改变。遇到请求超时，请在 Vercel 查看是否已经受理，10 分钟后才能再次触发。

版本号在 Next.js 构建阶段固定：优先 `APP_GIT_COMMIT_SHA`，其次 `VERCEL_GIT_COMMIT_SHA`，最后读取本地 Git HEAD。Vercel Git 集成部署通常自动提供 SHA；不要在项目环境变量里固定一个过期 SHA。使用 CLI 上传且远端没有 Git 元数据时，必须为本次构建传入实际提交，例如：

```powershell
$releaseCommit = git rev-parse HEAD
npx vercel deploy --prod --build-env "APP_GIT_COMMIT_SHA=$releaseCommit"
```

缺少 SHA 时会提示无法识别版本，不会把仓库最新提交当作已安装版本。部署新版本后刷新页面即可读取新 SHA。

## 域名

默认使用 Vercel 分配的域名。页面元数据自动读取 `VERCEL_PROJECT_PRODUCTION_URL` 或 `VERCEL_URL`。

绑定自定义域名后，可将 `NEXT_PUBLIC_SITE_URL` 设置为完整 HTTPS 地址。数据库连接、管理员密码都不要使用 `NEXT_PUBLIC_` 前缀。

## 后续数据库更新

在开发数据库修改 `prisma/schema.prisma` 后执行：

```bash
npm run db:migrate -- --name describe_change
```

保存生成的迁移文件，下次构建会通过 `db:deploy` 应用迁移。部署命令不使用 `db:push` 或 `migrate reset`。

如果接入此前通过 `db:push` 建表、但没有迁移历史的 PostgreSQL 数据库，先核对它与当前模型完全一致：

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

只有检查返回退出码 `0`，并确认这些表已存在时，才把初始迁移标记为已执行：

```bash
npx prisma migrate resolve --applied 20260905000000_init
npm run db:deploy
```

新建空数据库直接运行 `db:deploy`，不执行基线标记。这些迁移用于 PostgreSQL 结构初始化，不包含其他数据库已有业务数据的导入。

## 部署后验证

- 打开首页、玩家页、活动页，确认读取真实数据库。
- 使用管理员登录 `/login`。
- 注册普通账号并填写资料，在后台审核。
- 创建活动、提交报名、审核报名并取消报名。
- 验证公开玩家卡片没有返回战网 ID、段位和联系方式。

连接池按 [Vercel 官方建议](https://vercel.com/kb/guide/connection-pooling-with-functions) 在模块中复用，并注册空闲连接回收。
