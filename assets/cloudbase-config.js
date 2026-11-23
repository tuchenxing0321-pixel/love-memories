(function () {
  'use strict';

  const shared = window.CloudBaseDatesConfig || {};
  window.CloudBaseConfig = Object.freeze({
    envId: shared.envId || 'memories-d4g4tuz0rd39f03f2',
    region: shared.region || 'ap-shanghai',
    publishableKey: shared.publishableKey || '',
    enabled: Boolean(shared.publishableKey)
  });
})();
