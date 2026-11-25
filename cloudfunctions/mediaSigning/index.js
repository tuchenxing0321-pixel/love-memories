const cloudbase = require('@cloudbase/node-sdk');
const COS = require('cos-nodejs-sdk-v5');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.rdb({ database: 'public' });
const cos = new COS({
  SecretId: process.env.COS_SECRET_ID,
  SecretKey: process.env.COS_SECRET_KEY
});

const ok = (data) => ({ ok: true, data });
const fail = (error, code = 400) => ({ ok: false, code, error });

exports.main = async (event, context) => {
  try {
    const uid = context?.userInfo?.uid || app.auth().getUserInfo().uid;
    if (!uid) return fail('未登录', 401);

    const { action, objectKey, contentType } = event || {};
    const match = /^spaces\/([^/]+)\//.exec(objectKey || '');
    if (!match) return fail('非法媒体路径');

    const { data: memberships, error } = await db
      .from('memory_members')
      .select('uid')
      .eq('uid', uid)
      .eq('space_id', match[1]);
    if (error) throw new Error(error.message || '无法验证访问权限');
    if (!memberships?.[0]) return fail('无权访问该媒体', 403);

    if (!process.env.COS_BUCKET || !process.env.COS_REGION ||
        !process.env.COS_SECRET_ID || !process.env.COS_SECRET_KEY) {
      return fail('COS 环境变量未配置', 503);
    }

    const method = action === 'upload' ? 'PUT' : action === 'download' ? 'GET' : null;
    if (!method) return fail('未知媒体操作', 404);
    if (action === 'upload' &&
        !/^image\/[a-z0-9.+-]+$|^video\/[a-z0-9.+-]+$/i.test(contentType || '')) {
      return fail('只允许上传图片或视频', 415);
    }

    const url = cos.getObjectUrl({
      Bucket: process.env.COS_BUCKET,
      Region: process.env.COS_REGION,
      Key: objectKey,
      Method: method,
      Sign: true,
      Expires: 300,
      Headers: action === 'upload'
        ? { 'Content-Type': contentType || 'application/octet-stream' }
        : undefined
    });
    return ok({ url, expiresIn: 300 });
  } catch (error) {
    console.error('mediaSigning failed', error);
    return fail(error.message || '无法签发媒体地址', 500);
  }
};
