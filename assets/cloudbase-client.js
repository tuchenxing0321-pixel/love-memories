(function () {
  'use strict';

  const config = window.CloudBaseConfig || {};
  let app = null;

  function status() {
    if (!config.enabled) return { ready: false, mode: 'local', reason: '云同步尚未启用' };
    if (!config.envId) return { ready: false, mode: 'local', reason: '缺少 CloudBase 环境 ID' };
    if (!config.publishableKey) return { ready: false, mode: 'local', reason: '缺少 Publishable Key' };
    if (!window.cloudbase) return { ready: false, mode: 'local', reason: 'CloudBase SDK 未加载' };
    return { ready: true, mode: 'cloud', reason: '' };
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
    if (response?.data?.session) return response.data.session;
    response = await auth.signInAnonymously();
    if (response?.error) throw new Error(response.error.message || '匿名登录失败');
    return response?.data?.session || (await auth.getSession())?.data?.session || null;
  }

  async function call(action, payload) {
    const instance = getApp();
    if (!(await session())) throw new Error('无法建立匿名会话');
    let response;
    try {
      response = await instance.callFunction({
        name: 'memoryApi',
        data: { action, payload: payload || {} }
      });
    } catch (error) {
      const useSharedEndpoint = /authority|permission|forbidden/i.test(error.message || '');
      if (!useSharedEndpoint) throw new Error(`回忆云端接口调用失败：${error.message}`);
      try {
        response = await instance.callFunction({ name: 'dateApi', data: { action, payload: payload || {} } });
      } catch (fallbackError) {
        throw new Error(`回忆云端接口调用失败：${fallbackError.message}`);
      }
    }
    const result = response?.result || {};
    if (!result.ok) throw new Error(result.error || '云端操作未完成');
    return result.data;
  }

  async function callFunction(name, action, payload, extra) {
    const instance = getApp();
    if (!(await session())) throw new Error('无法建立匿名会话');
    let response;
    try {
      response = await instance.callFunction({
        name,
        data: { action, payload: payload || {}, ...(extra || {}) }
      });
    } catch (error) {
      throw new Error(`云端接口调用失败：${error.message || '请稍后重试'}`);
    }
    const result = response?.result || {};
    if (!result.ok) throw new Error(result.error || '云端操作未完成');
    return result.data;
  }

  function authClient() {
    const instance = getApp();
    return typeof instance.auth === 'function' ? instance.auth() : instance.auth;
  }

  async function authState() {
    const response = await authClient().getSession();
    if (response?.error) throw new Error(response.error.message || '无法读取登录状态');
    return {
      session: response?.data?.session || null,
      user: response?.data?.user || null
    };
  }

  async function signIn(identifier, password) {
    const value = String(identifier || '').trim();
    if (!value || !password) throw new Error('请输入账号和密码');
    const credentials = value.includes('@') ? { email: value, password } : { username: value, password };
    const response = await authClient().signInWithPassword(credentials);
    if (response?.error) throw new Error(response.error.message || '登录失败');
    return response?.data || null;
  }

  async function signOut() {
    const response = await authClient().signOut();
    if (response?.error) throw new Error(response.error.message || '退出登录失败');
  }

  const access = () => call('getAccess');

  window.CloudBaseClient = Object.freeze({ status, getApp, session, call, callFunction, authState, signIn, signOut, access });
})();
