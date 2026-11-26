# 视频收藏云同步部署

1. 在现有 CloudBase PostgreSQL 数据库中运行 `cloudbase/video-library.sql`。它创建 `video_links`，并一次性写入网站已有的两条 VLOG。删除后保留墓碑，重复执行 SQL 不会把已删除的视频加回来。
2. 部署 `cloudfunctions/videoApi` 为名为 `videoApi` 的云函数，设置与现有 `dateApi` 相同的服务端 `CLOUDBASE_APIKEY`。只允许已建立 CloudBase 会话的 SDK 调用，不给浏览器数据库表的直接访问权。
3. 如环境仅使用单一函数入口，先运行 `node scripts/build-shared-api.mjs`，再部署 `dist/sharedApi`；其中已包含视频、回忆与日期处理代码。前端若调用 `videoApi`，仍需确保该名字可调用，或将前端端点调整为实际部署的函数名。
4. 匿名访客验证 `listVideos` 和 `getVideoAccess` 可读，`addVideo`、`removeVideo`、`setVideoCover` 均返回 403。主人与启用的管理员应能写入；停用管理员后，已有会话也应立即变成只读。
5. 最后上传新版网页并在另一台设备验证视频列表、删除和封面一致。原先只保存在浏览器中的自定义链接不会自动进入云端；先核对备份，必要时再逐条导入，不能静默覆盖云端内容。

视频封面目前以最多 2 MB 的图片数据写入数据库。这适合少量收藏；大量视频或更大封面需要改为对象存储，并保留同样的权限校验。
