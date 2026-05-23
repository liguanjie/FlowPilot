const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('flows/openai/background/steps/fill-profile.js', 'utf8');
const api = new Function('self', `${source}; return self.MultiPageBackgroundStep5;`)({});

test('step 5 uses resilient content-script messaging when available', async () => {
  const events = {
    directMessages: [],
    resilientMessages: [],
  };

  const executor = api.createStep5Executor({
    addLog: async () => {},
    generateRandomBirthday: () => ({ year: 2003, month: 6, day: 19 }),
    generateRandomName: () => ({ firstName: 'Test', lastName: 'User' }),
    sendToContentScript: async (sourceName, message, options) => {
      events.directMessages.push({ sourceName, message, options });
      return { accepted: true };
    },
    sendToContentScriptResilient: async (sourceName, message, options) => {
      events.resilientMessages.push({ sourceName, message, options });
      return { accepted: true };
    },
  });

  await executor.executeStep5();

  assert.equal(events.directMessages.length, 0);
  assert.equal(events.resilientMessages.length, 1);
  assert.equal(events.resilientMessages[0].sourceName, 'openai-auth');
  assert.equal(events.resilientMessages[0].message.nodeId, 'fill-profile');
  assert.equal(events.resilientMessages[0].options.timeoutMs, 150000);
  assert.equal(events.resilientMessages[0].options.responseTimeoutMs, 150000);
  assert.equal(events.resilientMessages[0].options.logStep, 5);
  assert.equal(events.resilientMessages[0].options.logStepKey, 'fill-profile');
});
