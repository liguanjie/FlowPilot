const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('flows/openai/content/openai-auth.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }
  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
  }

  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    const ch = source[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

function getOnboardingBundle() {
  return [
    extractFunction('getStep5OnboardingActionElements'),
    extractFunction('findStep5OnboardingAction'),
    extractFunction('isStep5ChatgptOnboardingPage'),
    extractFunction('completeStep5ChatgptOnboarding'),
  ].join('\n');
}

function getNavigationReporterBundle() {
  return [
    extractFunction('logStep5SubmitDebug'),
    extractFunction('installStep5NavigationCompletionReporter'),
  ].join('\n');
}

test('step 5 navigation reporter completes on pagehide for background validation', () => {
  const api = new Function(`
const events = [];
const listeners = new Map();
const location = { href: 'https://auth.openai.com/about-you' };
const window = {
  addEventListener(type, handler) { listeners.set(type, handler); },
  removeEventListener(type) { listeners.delete(type); },
};

function log(message, level = 'info') {
  events.push({ type: 'log', message, level });
}
function getStep5SubmitState() {
  return {
    url: location.href,
    retryPage: false,
    retryEnabled: false,
    successState: '',
    profileVisible: true,
    unknownAuthPage: false,
    maxCheckAttemptsBlocked: false,
    userAlreadyExistsBlocked: false,
    errorText: '',
  };
}

${getNavigationReporterBundle()}

return {
  run() {
    const completions = [];
    const cleanup = installStep5NavigationCompletionReporter((payload) => {
      completions.push(payload);
      events.push({ type: 'complete', payload });
    });
    listeners.get('beforeunload')?.({ type: 'beforeunload' });
    listeners.get('pagehide')?.({ type: 'pagehide' });
    cleanup();
    return { completions, events };
  },
};
`)();

  const result = api.run();
  assert.deepStrictEqual(result.completions, [
    {
      navigationStarted: true,
      navigationEventType: 'pagehide',
    },
  ]);
  assert.equal(result.events.some((entry) => entry.type === 'complete'), true);
});

test('step 5 onboarding helper clicks Skip when ChatGPT asks usage intent', async () => {
  const api = new Function(`
const logs = [];
const clicks = [];
const skipButton = {
  textContent: 'Skip',
  hidden: false,
  disabled: false,
  getAttribute() { return ''; },
};
const otherButton = {
  textContent: 'Other',
  hidden: false,
  disabled: false,
  getAttribute() { return ''; },
};
const location = { href: 'https://auth.openai.com/about-you' };
const document = {
  body: {
    innerText: 'What brings you to ChatGPT? School Work Personal tasks Fun and entertainment Other Skip',
    textContent: 'What brings you to ChatGPT? School Work Personal tasks Fun and entertainment Other Skip',
  },
  querySelectorAll(selector) {
    if (selector === 'button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]') {
      return [skipButton, otherButton];
    }
    return [];
  },
};

function log(message, level = 'info') { logs.push({ message, level }); }
async function humanPause() {}
async function sleep() {}
function isVisibleElement(el) { return Boolean(el) && !el.hidden; }
function isActionEnabled(el) { return Boolean(el) && !el.disabled && el.getAttribute?.('aria-disabled') !== 'true'; }
function getActionText(el) { return el.textContent || ''; }
function getPageTextSnapshot() { return (document.body?.innerText || document.body?.textContent || '').replace(/\\s+/g, ' ').trim(); }
function simulateClick(el) {
  clicks.push(el.textContent);
  if (el === skipButton) {
    location.href = 'https://chatgpt.com/';
  }
}
function getOperationDelayRunner() {
  return async (_metadata, operation) => operation();
}

${getOnboardingBundle()}

return {
  async run() {
    const detectedBefore = isStep5ChatgptOnboardingPage();
    const result = await completeStep5ChatgptOnboarding();
    return { detectedBefore, result, clicks, logs, url: location.href };
  },
};
`)();

  const snapshot = await api.run();

  assert.equal(snapshot.detectedBefore, true);
  assert.deepStrictEqual(snapshot.clicks, ['Skip']);
  assert.deepStrictEqual(snapshot.result, {
    state: 'chatgpt_onboarding_skipped',
    url: 'https://chatgpt.com/',
  });
});
