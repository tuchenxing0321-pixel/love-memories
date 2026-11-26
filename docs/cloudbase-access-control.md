# CloudBase 主人/管理员权限

## 已在本地完成

- 公开访客可继续查看回忆和重要日期。
- 回忆和日期的新增、编辑、删除均在云函数内校验 `archive_members`。
- 未授权账号在页面上只看到“登录管理”，不显示编辑和删除操作。
- `auth.html` 只登录已存在的 CloudBase 账号，不提供公开注册。
- 授权失败时默认只读，不会因为旧云函数还未部署就开放写入。

## 正式启用顺序

1. 在 CloudBase 身份认证中启用用户名/密码或邮箱/密码，创建主人账号。
2. 在用户管理中复制主人账号的真实 UID。
3. 在 PostgreSQL 执行 `cloudbase/access-control.sql`。
4. 用真实 UID 执行文件末尾的主人初始化 SQL。不要把用户名、昵称或邮箱当成 UID。
5. 部署新版 `memoryApi` 和 `dateApi`，并在云函数调用权限中放行两个函数的 SDK 调用。
   如果当前环境使用单个 `sharedApi` 函数承载两组操作，先运行 `node scripts/build-shared-api.mjs`，上传生成的 `dist/sharedApi`；不要直接上传缺少子目录的 `cloudfunctions/sharedApi`。
6. 先用匿名窗口验证只读，再用主人账号验证新增、编辑、删除。
7. 验收通过后再上传网页文件。

## 添加管理员

先在 CloudBase 创建对方的正式账号并取得 UID，再在 SQL 编辑器中执行：

```sql
insert into public.archive_members(uid, role, display_name)
values ('<EDITOR_CLOUDBASE_UID>', 'editor', '管理员显示名')
on conflict (uid) do update
set role = excluded.role,
    display_name = excluded.display_name,
    active = true,
    updated_at = now();
```

取消某个管理员的权限时，将 `active` 设为 `false`，不要删除操作记录中已使用的 UID。

## 验收条件

- 匿名访客可读取，但直接调用任意写接口都返回 403。
- 已登录但不在 `archive_members` 的账号仍然只读。
- `owner` 和启用状态的 `editor` 可写入。
- 停用管理员后，原有登录会话也不能继续写入。
- 网页隐藏按钮不作为安全验收依据；必须直接调用云函数测试。
