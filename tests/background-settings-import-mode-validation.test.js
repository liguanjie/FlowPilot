const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background.js', 'utf8');

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
    if (ch === '(') parenDepth += 1;
    if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) signatureEnded = true;
    }
    if (ch === '{' && signatureEnded) {
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

test('importSettingsBundle normalizes unsupported capability flags before persisting imported settings', async () => {
  const api = new Function(`
const SETTINGS_EXPORT_SCHEMA_VERSION = 1;
const DEFAULT_REGISTRATION_EMAIL_STATE = { emailHistory: [] };
const DEFAULT_ACTIVE_FLOW_ID = 'openai';
const self = {
  MultiPageLegacySettingsImporter: {
    createSettingsImporter() {
      return {
        importSettings(settings = {}) {
          return { ...settings };
        },
      };
    },
  },
};
let persistedUpdates = null;
let stateUpdates = null;
let broadcastPayload = null;
let currentState = {
  activeFlowId: 'site-a',
  targetId: 'sub2api',
  signupMethod: 'phone',
  plusModeEnabled: false,
  phoneVerificationEnabled: false,
  stepStatuses: {},
};
async function ensureManualInteractionAllowed() {
  return currentState;
}
function buildPersistentSettingsPayload(settings = {}) {
  return { ...settings };
}
function validateModeSwitchState() {
  return {
    ok: false,
    errors: [{ code: 'panel_mode_unsupported', message: '当前 flow 不支持 SUB2API 面板模式。' }],
    normalizedUpdates: {
      targetId: 'cpa',
      plusModeEnabled: false,
      phoneVerificationEnabled: false,
      signupMethod: 'email',
    },
  };
}
function resolveSignupMethod(state = {}) {
  return String(state?.signupMethod || '').trim().toLowerCase() === 'phone' ? 'phone' : 'email';
}
function getSettingsSchemaApi() {
  return null;
}
async function setPersistentSettings(updates) {
  persistedUpdates = { ...updates };
}
async function setState(updates) {
  stateUpdates = { ...updates };
  currentState = { ...currentState, ...updates };
}
function broadcastDataUpdate(payload) {
  broadcastPayload = { ...payload };
}
async function getState() {
  return { ...currentState };
}
${extractFunction('importSettingsBundle')}
return {
  importSettingsBundle,
  getPersistedUpdates: () => persistedUpdates,
  getStateUpdates: () => stateUpdates,
  getBroadcastPayload: () => broadcastPayload,
};
`)();

  const result = await api.importSettingsBundle({
    schemaVersion: 1,
    settings: {
      targetId: 'sub2api',
      plusModeEnabled: true,
      phoneVerificationEnabled: true,
      signupMethod: 'phone',
    },
  });

  assert.deepEqual(api.getPersistedUpdates(), {
    targetId: 'cpa',
    plusModeEnabled: false,
    phoneVerificationEnabled: false,
    signupMethod: 'email',
  });
  assert.equal(api.getStateUpdates().targetId, 'cpa');
  assert.equal(api.getStateUpdates().plusModeEnabled, false);
  assert.equal(api.getStateUpdates().phoneVerificationEnabled, false);
  assert.equal(api.getStateUpdates().signupMethod, 'email');
  assert.equal(api.getBroadcastPayload().targetId, 'cpa');
  assert.equal(api.getBroadcastPayload().signupMethod, 'email');
  assert.equal(result.signupMethod, 'email');
});

test('importSettingsBundle routes legacy settings through the legacy importer before persisting', async () => {
  const api = new Function(`
const SETTINGS_EXPORT_SCHEMA_VERSION = 1;
const DEFAULT_REGISTRATION_EMAIL_STATE = { emailHistory: [] };
const DEFAULT_ACTIVE_FLOW_ID = 'openai';
let importerInput = null;
let persistedUpdates = null;
let currentState = {
  activeFlowId: 'openai',
  nodeStatuses: {},
};
const self = {
  MultiPageFlowRegistry: {
    DEFAULT_FLOW_ID: 'openai',
  },
  MultiPageLegacySettingsImporter: {
    createSettingsImporter() {
      return {
        importSettings(settings = {}) {
          importerInput = JSON.parse(JSON.stringify(settings));
          return {
            settingsSchemaVersion: 5,
            settingsState: {
              schemaVersion: 5,
              activeFlowId: 'kiro',
              services: {
                account: { customPassword: '' },
                email: { provider: '163' },
                proxy: { enabled: false, provider: '711proxy', mode: 'account' },
              },
              flows: {
                openai: {
                  selectedTargetId: 'cpa',
                  targets: {
                    cpa: { vpsUrl: '', vpsPassword: '', localCpaStep9Mode: 'submit' },
                    sub2api: {
                      sub2apiUrl: '',
                      sub2apiEmail: '',
                      sub2apiPassword: '',
                      sub2apiGroupName: 'codex',
                      sub2apiGroupNames: ['codex', 'openai-plus'],
                      sub2apiAccountPriority: 1,
                      sub2apiDefaultProxyName: '',
                    },
                    codex2api: { codex2apiUrl: '', codex2apiAdminKey: '' },
                  },
                  signup: {
                    signupMethod: 'email',
                    phoneVerificationEnabled: false,
                    phoneSignupReloginAfterBindEmailEnabled: false,
                  },
                  plus: {
                    plusModeEnabled: false,
                    plusPaymentMethod: 'paypal',
                    plusAccountAccessStrategy: 'oauth',
                  },
                  autoRun: {
                    stepExecutionRange: { enabled: false, fromStep: 1, toStep: 11 },
                  },
                },
                kiro: {
                  selectedTargetId: 'kiro-rs',
                  targets: {
                    'kiro-rs': {
                      baseUrl: 'https://kiro.example.com/admin',
                      apiKey: 'imported-key',
                    },
                  },
                  autoRun: {
                    stepExecutionRange: { enabled: false, fromStep: 1, toStep: 9 },
                  },
                },
              },
            },
          };
        },
      };
    },
  },
};
async function ensureManualInteractionAllowed() {
  return currentState;
}
function buildPersistentSettingsPayload(settings = {}) {
  return {
    activeFlowId: settings.settingsState.activeFlowId,
    targetId: 'cpa',
    signupMethod: 'email',
    targetId: 'kiro-rs',
    kiroRsUrl: settings.settingsState.flows.kiro.targets['kiro-rs'].baseUrl,
    kiroRsKey: settings.settingsState.flows.kiro.targets['kiro-rs'].apiKey,
    settingsSchemaVersion: settings.settingsSchemaVersion,
    settingsState: settings.settingsState,
  };
}
function validateModeSwitchState() {
  return { normalizedUpdates: {} };
}
function resolveSignupMethod() {
  return 'email';
}
function getSettingsSchemaApi() {
  return null;
}
async function setPersistentSettings(updates) {
  persistedUpdates = { ...updates };
  return updates;
}
async function setState(updates) {
  currentState = { ...currentState, ...updates };
}
function broadcastDataUpdate() {}
async function getState() {
  return currentState;
}
${extractFunction('importSettingsBundle')}
return {
  importSettingsBundle,
  getImporterInput: () => importerInput,
  getPersistedUpdates: () => persistedUpdates,
};
`)();

  await api.importSettingsBundle({
    schemaVersion: 1,
    settings: {
      targetId: 'sub2api',
      kiroRuntime: {
        upload: {
          status: 'uploaded',
        },
      },
    },
  });

  assert.deepEqual(api.getImporterInput(), {
    targetId: 'sub2api',
    kiroRuntime: {
      upload: {
        status: 'uploaded',
      },
    },
  });
  assert.equal(api.getPersistedUpdates().activeFlowId, 'kiro');
  assert.equal(api.getPersistedUpdates().settingsSchemaVersion, 5);
  assert.equal(api.getPersistedUpdates().settingsState.flows.kiro.targets['kiro-rs'].apiKey, 'imported-key');
});

test('importSettingsBundle preserves flat email generator and Cloudflare Temp Email settings after schema import', async () => {
  const api = new Function(`
const SETTINGS_EXPORT_SCHEMA_VERSION = 1;
const DEFAULT_REGISTRATION_EMAIL_STATE = { emailHistory: [] };
const DEFAULT_ACTIVE_FLOW_ID = 'openai';
const PERSISTED_SETTING_KEYS = [
  'targetId',
  'mailProvider',
  'emailGenerator',
  'cloudflareTempEmailBaseUrl',
  'cloudflareTempEmailAdminAuth',
  'cloudflareTempEmailCustomAuth',
  'cloudflareTempEmailLookupMode',
  'cloudflareTempEmailReceiveMailbox',
  'cloudflareTempEmailUseRandomSubdomain',
  'cloudflareTempEmailCustomSubdomain',
  'cloudflareTempEmailDomain',
  'cloudflareTempEmailDomains',
];
const SETTINGS_SCHEMA_VIEW_KEY_SET = new Set(['targetId', 'mailProvider']);
let importerInput = null;
let persistedUpdates = null;
let currentState = {
  activeFlowId: 'openai',
  nodeStatuses: {},
};
const self = {
  MultiPageFlowRegistry: {
    DEFAULT_FLOW_ID: 'openai',
  },
  MultiPageLegacySettingsImporter: {
    createSettingsImporter() {
      return {
        importSettings(settings = {}) {
          importerInput = JSON.parse(JSON.stringify(settings));
          return {
            settingsSchemaVersion: 5,
            settingsState: {
              schemaVersion: 5,
              activeFlowId: 'openai',
              services: {
                account: { customPassword: '' },
                email: { provider: 'cloudflare-temp-email' },
                proxy: { enabled: false, provider: '711proxy', mode: 'account' },
              },
              flows: {},
            },
          };
        },
      };
    },
  },
};
async function ensureManualInteractionAllowed() {
  return currentState;
}
function buildPersistentSettingsPayload(settings = {}) {
  const payload = {};
  for (const key of [
    'emailGenerator',
    'cloudflareTempEmailBaseUrl',
    'cloudflareTempEmailAdminAuth',
    'cloudflareTempEmailCustomAuth',
    'cloudflareTempEmailLookupMode',
    'cloudflareTempEmailReceiveMailbox',
    'cloudflareTempEmailUseRandomSubdomain',
    'cloudflareTempEmailCustomSubdomain',
    'cloudflareTempEmailDomain',
    'cloudflareTempEmailDomains',
    'settingsSchemaVersion',
    'settingsState',
  ]) {
    if (settings[key] !== undefined) {
      payload[key] = settings[key];
    }
  }
  return payload;
}
function validateModeSwitchState() {
  return { normalizedUpdates: {} };
}
function resolveSignupMethod() {
  return 'email';
}
function getSettingsSchemaApi() {
  return null;
}
async function setPersistentSettings(updates) {
  persistedUpdates = JSON.parse(JSON.stringify(updates));
  return updates;
}
async function setState(updates) {
  currentState = { ...currentState, ...updates };
}
function broadcastDataUpdate() {}
async function getState() {
  return currentState;
}
${extractFunction('importSettingsBundle')}
return {
  importSettingsBundle,
  getImporterInput: () => importerInput,
  getPersistedUpdates: () => persistedUpdates,
};
`)();

  await api.importSettingsBundle({
    schemaVersion: 1,
    settings: {
      targetId: 'cpa',
      mailProvider: 'cloudflare-temp-email',
      emailGenerator: 'cloudflare-temp-email',
      cloudflareTempEmailBaseUrl: 'https://temp.example.com',
      cloudflareTempEmailAdminAuth: 'admin-secret',
      cloudflareTempEmailCustomAuth: 'custom-secret',
      cloudflareTempEmailLookupMode: 'registration-email',
      cloudflareTempEmailReceiveMailbox: 'relay@example.com',
      cloudflareTempEmailUseRandomSubdomain: true,
      cloudflareTempEmailCustomSubdomain: 'edu',
      cloudflareTempEmailDomain: 'aixcode.xyz',
      cloudflareTempEmailDomains: ['aixcode.xyz', 'alt.example.com'],
    },
  });

  assert.equal(api.getImporterInput().emailGenerator, 'cloudflare-temp-email');
  assert.equal(api.getPersistedUpdates().emailGenerator, 'cloudflare-temp-email');
  assert.equal(api.getPersistedUpdates().cloudflareTempEmailBaseUrl, 'https://temp.example.com');
  assert.equal(api.getPersistedUpdates().cloudflareTempEmailAdminAuth, 'admin-secret');
  assert.equal(api.getPersistedUpdates().cloudflareTempEmailCustomAuth, 'custom-secret');
  assert.equal(api.getPersistedUpdates().cloudflareTempEmailLookupMode, 'registration-email');
  assert.equal(api.getPersistedUpdates().cloudflareTempEmailReceiveMailbox, 'relay@example.com');
  assert.equal(api.getPersistedUpdates().cloudflareTempEmailUseRandomSubdomain, true);
  assert.equal(api.getPersistedUpdates().cloudflareTempEmailCustomSubdomain, 'edu');
  assert.equal(api.getPersistedUpdates().cloudflareTempEmailDomain, 'aixcode.xyz');
  assert.deepEqual(api.getPersistedUpdates().cloudflareTempEmailDomains, ['aixcode.xyz', 'alt.example.com']);
});

test('importSettingsBundle preserves Clash Verge proxy settings after schema import', async () => {
  const api = new Function(`
const SETTINGS_EXPORT_SCHEMA_VERSION = 1;
const DEFAULT_REGISTRATION_EMAIL_STATE = { emailHistory: [] };
const DEFAULT_ACTIVE_FLOW_ID = 'openai';
const PERSISTED_SETTING_KEYS = [
  'ipProxyEnabled',
  'ipProxyService',
  'ipProxyMode',
  'ipProxyServiceProfiles',
  'clashProxySwitchEnabled',
  'clashProxyControlUrl',
  'clashProxySecret',
  'clashProxyGroup',
  'clashProxyJapanNode',
  'clashProxyJapanNodes',
  'clashProxyUsNode',
  'clashProxyUsNodes',
];
const SETTINGS_SCHEMA_VIEW_KEY_SET = new Set(['ipProxyEnabled', 'ipProxyService', 'ipProxyMode']);
let importerInput = null;
let persistedUpdates = null;
let currentState = {
  activeFlowId: 'openai',
  nodeStatuses: {},
};
const self = {
  MultiPageFlowRegistry: {
    DEFAULT_FLOW_ID: 'openai',
  },
  MultiPageLegacySettingsImporter: {
    createSettingsImporter() {
      return {
        importSettings(settings = {}) {
          importerInput = JSON.parse(JSON.stringify(settings));
          return {
            settingsSchemaVersion: 5,
            settingsState: {
              schemaVersion: 5,
              activeFlowId: 'openai',
              services: {
                account: { customPassword: '' },
                email: { provider: '163' },
                proxy: {
                  enabled: Boolean(settings.ipProxyEnabled),
                  provider: settings.ipProxyService,
                  mode: settings.ipProxyMode,
                  clash: {
                    switchEnabled: settings.clashProxySwitchEnabled,
                    controlUrl: settings.clashProxyControlUrl,
                    secret: settings.clashProxySecret,
                    group: settings.clashProxyGroup,
                    japanNode: settings.clashProxyJapanNode,
                    japanNodes: settings.clashProxyJapanNodes,
                    usNode: settings.clashProxyUsNode,
                    usNodes: settings.clashProxyUsNodes,
                  },
                },
              },
              flows: {},
            },
          };
        },
      };
    },
  },
};
async function ensureManualInteractionAllowed() {
  return currentState;
}
function buildPersistentSettingsPayload(settings = {}) {
  const payload = {};
  for (const key of [
    'ipProxyServiceProfiles',
    'clashProxySwitchEnabled',
    'clashProxyControlUrl',
    'clashProxySecret',
    'clashProxyGroup',
    'clashProxyJapanNode',
    'clashProxyJapanNodes',
    'clashProxyUsNode',
    'clashProxyUsNodes',
    'settingsSchemaVersion',
    'settingsState',
  ]) {
    if (settings[key] !== undefined) {
      payload[key] = settings[key];
    }
  }
  const proxy = settings.settingsState?.services?.proxy || {};
  if (proxy.enabled !== undefined) {
    payload.ipProxyEnabled = Boolean(proxy.enabled);
  }
  if (proxy.provider !== undefined) {
    payload.ipProxyService = proxy.provider;
  }
  if (proxy.mode !== undefined) {
    payload.ipProxyMode = proxy.mode;
  }
  return payload;
}
function validateModeSwitchState() {
  return { normalizedUpdates: {} };
}
function resolveSignupMethod() {
  return 'email';
}
function getSettingsSchemaApi() {
  return null;
}
async function setPersistentSettings(updates) {
  persistedUpdates = JSON.parse(JSON.stringify(updates));
  return updates;
}
async function setState(updates) {
  currentState = { ...currentState, ...updates };
}
function broadcastDataUpdate() {}
async function getState() {
  return currentState;
}
${extractFunction('importSettingsBundle')}
return {
  importSettingsBundle,
  getImporterInput: () => importerInput,
  getPersistedUpdates: () => persistedUpdates,
};
`)();

  await api.importSettingsBundle({
    schemaVersion: 1,
    settings: {
      ipProxyEnabled: true,
      ipProxyService: 'clash-verge',
      ipProxyMode: 'account',
      ipProxyServiceProfiles: {
        'clash-verge': {
          mode: 'account',
          host: '127.0.0.1',
          port: '7897',
          protocol: 'http',
        },
      },
      clashProxySwitchEnabled: true,
      clashProxyControlUrl: 'http://127.0.0.1:9097',
      clashProxySecret: 'set-your-secret',
      clashProxyGroup: '寿司云',
      clashProxyJapanNode: '日本 04 家宽 4倍流量 softbank',
      clashProxyJapanNodes: ['日本 04 家宽 4倍流量 softbank', '日本家宽1 | 4倍流量 | softbank'],
      clashProxyUsNode: 'VIP美国家宽4 | 4倍流量',
      clashProxyUsNodes: ['VIP美国家宽4 | 4倍流量', '美国 01'],
    },
  });

  assert.equal(api.getImporterInput().ipProxyService, 'clash-verge');
  assert.equal(api.getPersistedUpdates().ipProxyEnabled, true);
  assert.equal(api.getPersistedUpdates().ipProxyService, 'clash-verge');
  assert.equal(api.getPersistedUpdates().ipProxyMode, 'account');
  assert.deepEqual(api.getPersistedUpdates().ipProxyServiceProfiles['clash-verge'], {
    mode: 'account',
    host: '127.0.0.1',
    port: '7897',
    protocol: 'http',
  });
  assert.equal(api.getPersistedUpdates().clashProxySwitchEnabled, true);
  assert.equal(api.getPersistedUpdates().clashProxyControlUrl, 'http://127.0.0.1:9097');
  assert.equal(api.getPersistedUpdates().clashProxySecret, 'set-your-secret');
  assert.equal(api.getPersistedUpdates().clashProxyGroup, '寿司云');
  assert.equal(api.getPersistedUpdates().clashProxyJapanNode, '日本 04 家宽 4倍流量 softbank');
  assert.deepEqual(api.getPersistedUpdates().clashProxyJapanNodes, ['日本 04 家宽 4倍流量 softbank', '日本家宽1 | 4倍流量 | softbank']);
  assert.equal(api.getPersistedUpdates().clashProxyUsNode, 'VIP美国家宽4 | 4倍流量');
  assert.deepEqual(api.getPersistedUpdates().clashProxyUsNodes, ['VIP美国家宽4 | 4倍流量', '美国 01']);
  assert.equal(api.getPersistedUpdates().settingsState.services.proxy.provider, 'clash-verge');
  assert.deepEqual(api.getPersistedUpdates().settingsState.services.proxy.clash.usNodes, ['VIP美国家宽4 | 4倍流量', '美国 01']);
});
