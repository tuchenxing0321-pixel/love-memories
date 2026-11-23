(function () {
  'use strict';

  const config = window.CloudBaseDatesConfig || {};
  let app = null;

  function status() {
    if (!config.envId) return { ready: false, reason: '缺少 CloudBase 环境 ID' };
    if (!config.publishableKey) return { ready: false, reason: '缺少 CloudBase Publishable Key' };
    if (!config.enabled) return { ready: false, reason: '云同步尚未启用' };
    if (!window.cloudbase) return { ready: false, reason: 'CloudBase SDK 未加载' };
    return { ready: true, reason: '' };
  }

  function getApp() {
    const current = status();
    if (!current.ready) throw new Error(current.reason);
    if (!app) {
      app = window.cloudbase.init({
        env: config.envId,
        region: config.region || 'ap-shanghai',
        accessKey: config.publishableKey,
        auth: { detectSessionInUrl: true }
      });
    }
    return app;
  }

  async function session() {
    const instance = getApp();
    const auth = typeof instance.auth === 'function' ? instance.auth() : instance.auth;
    let response = await auth.getSession();
    if (response?.error) throw new Error(response.error.message || '无法读取登录状态');
    if (response?.data?.session) {
      return response.data.session;
    }
    response = await auth.signInAnonymously();
    if (response?.error) throw new Error(response.error.message || '匿名登录失败');
    return response?.data?.session || (await auth.getSession())?.data?.session || null;
  }

  async function call(action, payload) {
    const instance = getApp();
    let activeSession;
    try {
      activeSession = await session();
    } catch (error) {
      throw new Error(`匿名会话建立失败：${error.message}`);
    }
    if (!activeSession) throw new Error('无法建立匿名会话');
    let response;
    try {
      response = await instance.callFunction({
        name: 'dateApi',
        data: { action, payload: payload || {} }
      });
    } catch (error) {
      throw new Error(`dateApi 调用失败：${error.message}`);
    }
    const result = response?.result || {};
    if (!result.ok) throw new Error(result.error || '云端操作未完成');
    return result.data;
  }

  const access = () => call('getAccess');

  window.CloudBaseDatesClient = Object.freeze({ status, call, access });
})();
