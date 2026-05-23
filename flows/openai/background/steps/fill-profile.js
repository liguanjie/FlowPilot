(function attachBackgroundStep5(root, factory) {
  root.MultiPageBackgroundStep5 = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundStep5Module() {
  function createStep5Executor(deps = {}) {
    const {
      addLog,
      generateRandomBirthday,
      generateRandomName,
      sendToContentScript,
      sendToContentScriptResilient,
    } = deps;

    async function executeStep5() {
      const { firstName, lastName } = generateRandomName();
      const { year, month, day } = generateRandomBirthday();

      await addLog(`步骤 5：已生成姓名 ${firstName} ${lastName}，生日 ${year}-${month}-${day}`);

      const sendProfileCommand = typeof sendToContentScriptResilient === 'function'
        ? sendToContentScriptResilient
        : sendToContentScript;

      await sendProfileCommand('openai-auth', {
        type: 'EXECUTE_NODE',
        nodeId: 'fill-profile',
        step: 5,
        source: 'background',
        payload: {
          firstName,
          lastName,
          year,
          month,
          day,
        },
      }, {
        timeoutMs: 150000,
        retryDelayMs: 600,
        responseTimeoutMs: 150000,
        logMessage: '步骤 5：资料页正在跳转或刷新，正在等待内容脚本重新连接后继续...',
        logStep: 5,
        logStepKey: 'fill-profile',
      });
    }

    return { executeStep5 };
  }

  return { createStep5Executor };
});
