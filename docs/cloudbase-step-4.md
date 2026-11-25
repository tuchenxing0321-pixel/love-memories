# 第四步：CloudBase 共享数据

## 已完成的本地准备

- 已绑定现有 CloudBase 环境 `memories-d4g4tuz0rd39f03f2`。
- 已加入纯 HTML 网页可用的 CloudBase 配置和客户端入口。
- 云端未启用时仍保持现有 IndexedDB/localStorage 行为，不会阻断开发阶段直接进入页面。
- 浏览器中只允许放环境 ID 和 Publishable Key；`SecretId` / `SecretKey` 只能放在云函数环境变量中。

## 启用前必须完成

1. 在 CloudBase 控制台创建 Publishable Key；日期页只填入 `assets/cloudbase-dates-config.js`，不要改回忆功能使用的 `assets/cloudbase-config.js`。
2. 把 GitHub Pages 域名和本地预览地址加入安全来源。
3. 保留匿名会话用于公开读取；主人和管理员使用 CloudBase 正式账号登录。`dateApi` 和 `memoryApi` 的写操作都必须在云函数中校验 `archive_members`。
4. 创建 PostgreSQL 表和私有 COS 存储，媒体上传必须由 `mediaSigning` 生成短时有效的签名链接。
5. 云端读写和跨浏览器刷新验收通过后再部署网页；日期页的 `enabled` 会在 Publishable Key 存在时自动开启，不要手动绕过检测。

## 权限结论

“所有知道网址的人都能修改”与“阻止恶意写入”不能同时保证。正式环境采用主人/管理员登录后可写，其他访客只读。页面隐藏按钮只是用户体验，真正的权限边界在云函数。

重要日期的当前接入步骤与验收清单见 `docs/cloudbase-important-dates.md`。
主人/管理员权限的部署顺序见 `docs/cloudbase-access-control.md`。
