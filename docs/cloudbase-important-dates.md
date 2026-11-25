# CloudBase 重要日期接入

当前环境 ID 已确定为 `memories-d4g4tuz0rd39f03f2`。网页端还缺 Publishable Key，因此在完成下列步骤前，日期页会明确显示未连接，不会回退到本地数据，也不会上传或删除旧的 `localStorage` 日期。

## 控制台只需完成一次

1. 打开 CloudBase 控制台 → 当前环境 → API Key 配置，创建或复制 **Publishable Key**。
2. 只把 Publishable Key 填到 `assets/cloudbase-dates-config.js` 的 `publishableKey`。不要填写 SecretId、SecretKey 或服务端 API Key。
3. 在身份认证 → 登录方式中开启“匿名登录”。这不会显示登录页。
4. 在 PostgreSQL 的 SQL 编辑器只执行 `cloudbase/important-dates.sql`，不要执行整站的 `cloudbase/schema.sql`。
5. 部署普通事件云函数 `dateApi`，入口为 `index.main`，运行时为 Node.js 20，并安装 `package.json` 依赖。
6. 读取并保留当前完整的云函数/OPA 鉴权配置，只为 `dateApi` 增加允许已建立匿名会话调用的规则。不要粘贴通配 `*` 规则，也不要覆盖 `memoryApi`、`mediaSigning` 或既有 OPA 策略；PostgreSQL 环境还要确认 `FunctionsHttpApiAllow` 对 `dateApi` 的 SDK 调用放行。
7. 在环境配置 → 安全管控 → 云函数限频中，为 `dateApi` 增加客户端限频：`ClientIP`，`3 QPS`。应用内另有每个匿名 UID 每分钟最多 12 次写入的限制。
8. 把 `http://127.0.0.1:4173` 加入安全来源，仅用于本地验收。

日期表已启用 RLS 且没有开放网页端策略；写入限频 RPC 还会在数据库内检查 `service_role`，因此网页不能绕过 `dateApi` 直接写表或调用特权 RPC。

## 验收顺序

1. 打开两个独立浏览器会话访问 `dates.html`。
2. 会话 A 新增日期，会话 B 刷新后应出现相同记录。
3. 会话 A 编辑，会话 B 刷新后应看到更新。
4. 会话 A 删除，会话 B 刷新后记录应消失。
5. 直接向 `dateApi` 发送空标题、错误日期、超过 40 字标题或超过 120 字备注，应返回失败。
6. 同一个匿名会话在一分钟内连续写入超过 12 次，应收到 429 语义错误；超过 `3 QPS` 的同一 IP 请求应由 CloudBase 网关限频。

真实跨设备验收通过前，不要发布网站，也不要把 `assets/cloudbase-dates-config.js` 中的 `enabled` 逻辑改成无条件开启。
