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
- `local-helper/`
- `functions/`
- `migrations/`
- `_headers`
- `_redirects`
- `wrangler.toml.example`
- `KTP_DEPLOY.md`

不要把真实的 `ADMIN_SETUP_TOKEN` 或其他密钥写进 GitHub。
不要把 `ktp-local-helper.exe` 或 `ktp-local-helper.zip` 直接提交到 Pages 网站目录；Cloudflare Pages 单个静态文件限制较小，本地助手发布包请上传到 GitHub Release。

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
7. 用户首次从 GitHub Release 下载 `ktp-local-helper.zip`，解压后运行 `install-ktpdown.bat` 安装本地助手。
8. 用户输入密钥，点击“课堂派下载”。
9. 本地窗口打开后，粘贴课堂派资料详情页链接并下载。

## 本地预览

直接双击打开 `ktp/admin/index.html` 时，会进入本地预览模式：

- 管理员账号：`admin`
- 管理员密码：`13398362170`
- 可以生成密钥、复制密钥、调整次数、禁用或删除密钥
- 数据只保存在当前浏览器的 localStorage，不会上传到 Cloudflare

本地预览不能测试真实 D1 数据库，也不能启动真实本地助手；真实下载需要部署到网站后使用。

## 使用规则

- 普通用户不需要网站账号密码，只输入使用密钥。
- 每个密钥默认每天 10 次，按北京时间日期计算。
- 用户点击“课堂派下载”启动本地助手时立即扣 1 次。
- 实际课堂派下载由用户电脑上的本地助手完成。
- 按当前需求，后端会保存完整使用密钥，方便管理员后台继续复制。
- 后端不保存课堂派 token，不记录课程文件详情。

## 使用记录保留规则

后台“使用记录”只保留当天日志。

后端会在访问以下接口时自动清理今天以前的记录和下载票据：

- `/api/admin/usage`
- `/api/access-key/verify`
- `/api/local-download/start`
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

## 本地助手说明

- 当前方案不再使用书签。
- 用户首次从 GitHub Release 下载 `ktp-local-helper.zip`，解压后运行 `install-ktpdown.bat`，Windows 会注册 `ktpdown://` 协议。
- 网站点击“课堂派下载”后，会打开本地助手窗口。
- 本地助手读取用户本机 Edge/Chrome 的课堂派登录状态，不把课堂派 token 上传到网站。

本地助手发布包当前生成在本机：

```text
E:\Codex\ktp-local-helper-source\release\ktp-local-helper.zip
```

需要在 GitHub 仓库 `Jenny-handsome/hsm-zzl-site` 的 Releases 页面上传该文件，文件名保持：

```text
ktp-local-helper.zip
```

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

