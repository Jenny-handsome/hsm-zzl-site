# hsm-zzl.top

这是一个可直接部署到 Cloudflare Pages 的静态展示网站。

## 文件说明

- `index.html`：网站首页
- `style.css`：页面样式
- `assets/`：品牌图形和页面视觉资源
- `_headers`：Cloudflare Pages 响应头配置
- `_redirects`：Cloudflare Pages 路径跳转配置

## Cloudflare Pages 设置

- Framework preset：`None`
- Build command：留空
- Build output directory：`/`
- Production branch：`main`

## 域名绑定

在 Cloudflare Pages 项目中添加自定义域名：

- `hsm-zzl.top`
- 可选：`www.hsm-zzl.top`

Cloudflare Pages 的 `_redirects` 不支持域名级跳转。若要让 `www.hsm-zzl.top`
跳转到 `https://hsm-zzl.top`，请在 Cloudflare 控制台使用 Bulk Redirects：

- Source URL：`www.hsm-zzl.top`
- Target URL：`https://hsm-zzl.top`
- Status：`301`
- 勾选 Preserve query string、Subpath matching、Preserve path suffix

然后在 DNS 中为 `www` 添加一条已代理的记录，例如 Cloudflare 文档示例使用
`A www 192.0.2.1`，代理状态设为 Proxied。

## 上线前要改的内容

打开 `index.html`，把“把这里换成你的真实联系方式”这一段改成你确认要公开的信息。
