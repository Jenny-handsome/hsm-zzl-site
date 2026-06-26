# 课堂派工具部署说明

## 你现在的项目类型

这个项目已经不只是纯静态网页了。它现在是：

- Cloudflare Pages 静态页面：`index.html`、`style.css`、`ktp/`
- Cloudflare Pages Functions 后端：`functions/`
- Cloudflare D1 数据库：保存管理员、密钥、次数和当天使用记录

## GitHub 需要提交什么

需要把当前整个项目推送到 GitHub。至少要包含：

- `index.html`
- `style.css`
- `assets/`
- `ktp/`
- `functions/`
- `migrations/`
- `_headers`
- `_redirects`
- `wrangler.toml.example`
- `KTP_DEPLOY.md`

不要把真实的 `ADMIN_SETUP_TOKEN` 或其他密钥写进 GitHub。

## Cloudflare Pages 设置

如果你已经有 Pages 项目：

1. 打开 Cloudflare Dashboard。
2. 进入 Workers & Pages。
3. 打开你原来的网站 Pages 项目。
4. 确认它连接的是这个 GitHub 仓库。
5. 推送代码到 GitHub 后，Pages 会自动重新部署。

如果你要新建 Pages 项目：

1. Workers & Pages -> Create application -> Pages。
2. 连接 GitHub 仓库。
3. 构建设置保持静态网页：
   - Framework preset: `None`
   - Build command: 留空
   - Build output directory: `/`
4. 保存并部署。

Cloudflare Pages 会自动识别 `functions/` 目录，不需要额外启动服务器。

## D1 数据库设置

1. 在 Cloudflare Dashboard 进入 D1。
2. 创建数据库，例如：`ktp_usage`。
3. 打开该数据库的 Console。
4. 依次复制并执行这三个 SQL 文件内容：
   - `migrations/0001_ktp_usage.sql`
   - `migrations/0002_access_key_mode.sql`
   - `migrations/0003_access_key_secret.sql`
5. 回到 Pages 项目设置。
6. 进入 Settings -> Functions -> D1 database bindings。
7. 添加绑定：
   - Variable name: `DB`
   - D1 database: 选择 `ktp_usage`
8. 保存后重新部署 Pages。

## 环境变量设置

在 Pages 项目里添加环境变量：

- Variable name: `ADMIN_SETUP_TOKEN`
- Value: 你自己设置一串初始化口令

这个值只用于第一次创建管理员账号，不要提交到 GitHub。

## 第一次上线使用

1. 访问 `https://你的域名/ktp/admin/`。
2. 页面会要求初始化管理员。
3. 输入 Cloudflare 里设置的 `ADMIN_SETUP_TOKEN`。
4. 设置管理员账号和密码。
5. 登录后台，生成使用密钥。
6. 普通用户访问 `https://你的域名/ktp/`。
7. 用户输入密钥，拖动“课堂派下载”到书签栏。
8. 用户打开课堂派资料详情页，点击书签栏里的“课堂派下载”。

## 本地预览

直接双击打开 `ktp/admin/index.html` 时，会进入本地预览模式：

- 管理员账号：`admin`
- 管理员密码：`13398362170`
- 可以生成密钥、复制密钥、调整次数、禁用或删除密钥
- 数据只保存在当前浏览器的 localStorage，不会上传到 Cloudflare

本地预览不能测试真实 D1 数据库，也不能安装真实书签；真实书签需要部署到网站后使用。

## 使用规则

- 普通用户不需要网站账号密码，只输入使用密钥。
- 每个密钥默认每天 10 次，按北京时间日期计算。
- 用户通过书签脚本开始下载时立即扣 1 次。
- 实际课堂派下载通过书签脚本在课堂派页面内完成。
- 按当前需求，后端会保存完整使用密钥，方便管理员后台继续复制。
- 后端不保存课堂派 token，不记录课程文件详情。

## 使用记录保留规则

后台“使用记录”只保留当天日志。

后端会在访问以下接口时自动清理今天以前的记录和下载票据：

- `/api/admin/usage`
- `/api/access-key/verify`
- `/api/download-ticket/create`
- `/api/download-ticket/report`

清理内容：

- `key_usage_events` 中早于今天的记录
- `key_download_tickets` 中早于今天的票据

不会清理：

- 使用密钥
- 管理员账号
- 今日次数表
- 密钥每日额度和禁用状态

## 书签脚本说明

- 用户输入密钥后，把“课堂派下载”按钮拖到书签栏。
- 书签里只有远程加载器，真正脚本由 `/api/bookmarklet/script` 动态返回。
- 浏览器端代码无法绝对隐藏源码；这个方案只能避免在页面直接展示完整脚本。
- 使用时先打开课堂派资料详情页，再点击书签栏里的“课堂派下载”。

## 建议安全头

如果要加强 `/ktp/*` 页面安全头，可在 `_headers` 追加：

```text
/ktp/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://openapiv5.ketangpai.com; base-uri 'self'; frame-ancestors 'none'
```

