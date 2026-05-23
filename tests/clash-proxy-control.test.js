const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadClashProxyControl() {
  const source = fs.readFileSync('background/clash-proxy-control.js', 'utf8');
  return new Function(`
const self = {};
${source}
return self.MultiPageClashProxyControl;
`)();
}

function loadExecutionHookHarness(deps = {}) {
  const source = fs.readFileSync('background.js', 'utf8');
  const start = source.indexOf('const CLASH_PROXY_REGION_VERIFY_MAX_ATTEMPTS = 360;');
  const end = source.indexOf('\nasync function executeNode(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const functionSource = source.slice(start, end);
  return new Function('deps', `
const self = { MultiPageClashProxyControl: deps.api };
const globalThis = {};
const CLASH_VERGE_IP_PROXY_SERVICE = 'clash-verge';
async function applyIpProxySettingsFromState(state, options) {
  return deps.applyIpProxySettingsFromState(state, options);
}
async function setState(updates) {
  deps.setState(updates);
}
function broadcastDataUpdate(updates) {
  deps.broadcastDataUpdate(updates);
}
async function addLog(message, level, meta) {
  deps.addLog(message, level, meta);
}
async function getState() {
  return deps.getState();
}
async function probeIpProxyExit(options) {
  return deps.probeIpProxyExit(options);
}
async function sleepWithStop(ms) {
  deps.sleepWithStop(ms);
}
function getErrorMessage(error) {
  return error?.message || String(error || '');
}
${functionSource}
return ensureClashProxyForExecutionStep;
`)({
    api: deps.api,
    applyIpProxySettingsFromState: deps.applyIpProxySettingsFromState || (async () => ({ applied: true })),
    setState: deps.setState || (() => {}),
    broadcastDataUpdate: deps.broadcastDataUpdate || (() => {}),
    addLog: deps.addLog || (() => {}),
    getState: deps.getState || (async () => ({ current: true })),
    probeIpProxyExit: deps.probeIpProxyExit || (async () => ({ ok: true, exitIp: '8.8.8.8', exitRegion: 'US' })),
    sleepWithStop: deps.sleepWithStop || (() => {}),
  });
}

function loadManualRegionProbeHarness(deps = {}) {
  const source = fs.readFileSync('background.js', 'utf8');
  const start = source.indexOf('const CLASH_PROXY_REGION_VERIFY_MAX_ATTEMPTS = 360;');
  const end = source.indexOf('\nasync function ensureClashProxyForExecutionStep(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const functionSource = source.slice(start, end);
  return new Function('deps', `
const self = { MultiPageClashProxyControl: deps.api };
const globalThis = { fetch: deps.fetch };
const CLASH_VERGE_IP_PROXY_SERVICE = 'clash-verge';
async function applyIpProxySettingsFromState(state, options) {
  return deps.applyIpProxySettingsFromState(state, options);
}
async function setState(updates) {
  deps.setState(updates);
}
function broadcastDataUpdate(updates) {
  deps.broadcastDataUpdate(updates);
}
async function addLog(message, level, meta) {
  deps.addLog(message, level, meta);
}
async function getState() {
  return deps.getState();
}
async function probeIpProxyExit(options) {
  return deps.probeIpProxyExit(options);
}
async function sleepWithStop(ms) {
  deps.sleepWithStop(ms);
}
function getErrorMessage(error) {
  return error?.message || String(error || '');
}
${functionSource}
return probeClashProxyRegionExit;
`)({
    api: deps.api,
    fetch: deps.fetch || (async () => ({ ok: true })),
    applyIpProxySettingsFromState: deps.applyIpProxySettingsFromState || (async () => ({ applied: true })),
    setState: deps.setState || (() => {}),
    broadcastDataUpdate: deps.broadcastDataUpdate || (() => {}),
    addLog: deps.addLog || (() => {}),
    getState: deps.getState || (async () => ({ current: true })),
    probeIpProxyExit: deps.probeIpProxyExit || (async () => ({ proxyRouting: { exitIp: '8.8.8.8', exitRegion: 'US' } })),
    sleepWithStop: deps.sleepWithStop || (() => {}),
  });
}

test('Clash proxy step mapping switches PayPal checkout opening at step 8 to US', () => {
  const api = loadClashProxyControl();

  assert.equal(api.resolveClashProxyRegionForStep(1, { activeFlowId: 'openai' }), 'JP');
  assert.equal(api.resolveClashProxyRegionForStep(7, { activeFlowId: 'openai' }), 'JP');
  assert.equal(api.resolveClashProxyRegionForStep(8, { activeFlowId: 'openai' }), 'US');
  assert.equal(api.resolveClashProxyRegionForStep(9, { activeFlowId: 'openai' }), 'US');
  assert.equal(api.resolveClashProxyRegionForStep(16, { activeFlowId: 'openai' }), 'US');
  assert.equal(api.resolveClashProxyRegionForStep(1, { activeFlowId: 'kiro' }), '');
});

test('Clash proxy switch request uses configured group, node, control URL, and secret', async () => {
  const api = loadClashProxyControl();
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 204,
      text: async () => '',
    };
  };

  const result = await api.switchClashProxyForRegion('JP', {
    ipProxyEnabled: true,
    clashProxySwitchEnabled: true,
    clashProxyControlUrl: 'http://127.0.0.1:9090/proxies/old-group',
    clashProxySecret: 'secret-token',
    clashProxyGroup: 'sushi',
    clashProxyJapanNode: 'jp-node',
    clashProxyUsNode: 'us-node',
  }, { fetch });

  assert.equal(result.switched, true);
  assert.equal(result.region, 'JP');
  assert.equal(result.node, 'jp-node');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:9090/proxies/sushi');
  assert.equal(calls[0].options.method, 'PUT');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-token');
  assert.deepEqual(JSON.parse(calls[0].options.body), { name: 'jp-node' });
});

test('Clash proxy switch request rotates within configured node pools by round and retry offset', () => {
  const api = loadClashProxyControl();
  const state = {
    ipProxyEnabled: true,
    clashProxySwitchEnabled: true,
    clashProxyGroup: 'sushi',
    clashProxyJapanNodes: ['jp-a', 'jp-b', 'jp-c'],
    clashProxyJapanNode: 'jp-fallback',
    autoRunCurrentRun: 2,
  };

  assert.equal(api.buildClashProxySwitchRequest('JP', state).node, 'jp-b');
  assert.equal(api.buildClashProxySwitchRequest('JP', state, { nodeOffset: 1 }).node, 'jp-c');
  assert.equal(api.buildClashProxySwitchRequest('JP', state, { nodeOffset: 2 }).node, 'jp-a');
});

test('Clash proxy options are parsed from selector groups and fetched with secret', async () => {
  const api = loadClashProxyControl();
  const parsed = api.parseClashProxyOptionsPayload({
    proxies: {
      sushi: { type: 'Selector', all: ['jp-a', 'us-a', 'jp-a'] },
      direct: { type: 'Direct' },
      google: { type: 'URLTest', all: ['us-a'] },
    },
  }, { clashProxyGroup: 'sushi' });
  assert.deepEqual(parsed.groups, ['sushi', 'google']);
  assert.deepEqual(parsed.nodesByGroup.sushi, ['jp-a', 'us-a']);

  const calls = [];
  const result = await api.fetchClashProxyOptions({
    clashProxyControlUrl: 'http://127.0.0.1:9097',
    clashProxySecret: 'secret-token',
    clashProxyGroup: 'google',
  }, {
    fetch: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          proxies: {
            google: { type: 'Selector', all: ['us-a', 'us-b'] },
          },
        }),
      };
    },
  });

  assert.equal(calls[0].url, 'http://127.0.0.1:9097/proxies');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-token');
  assert.deepEqual(result.nodes, ['us-a', 'us-b']);
});

test('Clash proxy provider refresh updates every proxy provider without failing the whole run', async () => {
  const api = loadClashProxyControl();
  const calls = [];
  const result = await api.refreshClashProxyProviders({
    clashProxyControlUrl: 'http://127.0.0.1:9097',
    clashProxySecret: 'secret-token',
  }, {
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (options.method === 'GET') {
        return {
          ok: true,
          json: async () => ({
            providers: {
              sushi: { name: 'sushi' },
              cf: { name: 'cf' },
            },
          }),
        };
      }
      return {
        ok: !url.endsWith('/cf'),
        status: url.endsWith('/cf') ? 500 : 204,
        text: async () => 'failed',
      };
    },
  });

  assert.equal(calls[0].url, 'http://127.0.0.1:9097/providers/proxies');
  assert.deepEqual(calls.slice(1).map((call) => call.options.method), ['PUT', 'PUT']);
  assert.deepEqual(result.refreshed, ['sushi']);
  assert.equal(result.failures.length, 1);
});

test('Clash proxy diagnostics reads selected group and probe connection chain', async () => {
  const api = loadClashProxyControl();
  const calls = [];
  const result = await api.fetchClashProxyDiagnostics({
    clashProxyControlUrl: 'http://127.0.0.1:9097',
    clashProxySecret: 'secret-token',
    clashProxyGroup: 'sushi',
  }, {
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/proxies/sushi')) {
        return {
          ok: true,
          json: async () => ({
            name: 'sushi',
            type: 'Selector',
            now: 'jp-home',
            all: ['jp-home', 'us-home'],
          }),
        };
      }
      if (url.endsWith('/connections')) {
        return {
          ok: true,
          json: async () => ({
            connections: [{
              id: 'probe-1',
              metadata: {
                host: 'ipinfo.io',
                destinationPort: '443',
                network: 'tcp',
              },
              chains: ['sushi', 'jp-home'],
              rule: 'DomainSuffix',
              rulePayload: 'ipinfo.io',
            }],
          }),
        };
      }
      throw new Error(`unexpected url ${url}`);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.groupStatus.now, 'jp-home');
  assert.equal(result.connectionSnapshot.probeConnection.host, 'ipinfo.io');
  assert.equal(result.connectionSnapshot.probeConnection.chainText, 'sushi -> jp-home');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-token');
  assert.deepEqual(calls.map((call) => call.url), [
    'http://127.0.0.1:9097/proxies/sushi',
    'http://127.0.0.1:9097/connections',
  ]);
});

test('Clash proxy switching is skipped until IP proxy and Clash switch are enabled', async () => {
  const api = loadClashProxyControl();

  assert.deepEqual(
    await api.ensureClashProxyForStep(1, { activeFlowId: 'openai' }),
    { skipped: true, reason: 'ip_proxy_disabled' }
  );
  assert.deepEqual(
    await api.ensureClashProxyForStep(1, {
      activeFlowId: 'openai',
      ipProxyEnabled: true,
      clashProxySwitchEnabled: false,
    }),
    { skipped: true, reason: 'clash_switch_disabled' }
  );
});

test('background execution hook applies local Clash browser proxy after switching region', async () => {
  const logs = [];
  const stateUpdates = [];
  const broadcasts = [];
  const routedStates = [];
  const api = {
    resolveClashProxyRegionForStep: () => 'US',
    ensureClashProxyForStep: async () => ({
      switched: true,
      region: 'US',
      group: 'sushi',
      node: 'us-node',
    }),
  };
  const harness = loadExecutionHookHarness({
    api,
    applyIpProxySettingsFromState: async (state, options) => {
      routedStates.push({ state, options });
      return { applied: true };
    },
    setState: (updates) => stateUpdates.push(updates),
    broadcastDataUpdate: (updates) => broadcasts.push(updates),
    addLog: (message, level, meta) => logs.push({ message, level, meta }),
    probeIpProxyExit: async () => ({ ok: true, exitIp: '8.8.8.8', exitRegion: routedStates.length ? 'US' : 'BR' }),
  });

  const result = await harness(9, 'fill-paypal-email', {
    ipProxyEnabled: true,
    clashProxySwitchEnabled: true,
  });

  assert.equal(routedStates.length, 1);
  assert.equal(routedStates[0].state.ipProxyHost, '127.0.0.1');
  assert.equal(routedStates[0].state.ipProxyPort, '7897');
  assert.equal(routedStates[0].state.ipProxyProtocol, 'http');
  assert.equal(routedStates[0].state.ipProxyRegion, 'US');
  assert.deepEqual(routedStates[0].options, {
    skipExitProbe: true,
    resetNetworkState: false,
    forceAuthRebind: false,
    suppressAuthRebind: true,
  });
  assert.equal(stateUpdates[0].clashProxyLastRegion, 'US');
  assert.equal(stateUpdates[0].clashProxyLastNode, 'us-node');
  assert.equal(broadcasts[0].clashProxyLastGroup, 'sushi');
  assert.equal(logs[0].level, 'info');
  assert.equal(result.clashProxyLastRegion, 'US');
});

test('manual Clash region probe switches and records JP/US results separately', async () => {
  const routedStates = [];
  const stateUpdates = [];
  const broadcasts = [];
  const api = {
    switchClashProxyForRegion: async (region, state, options = {}) => ({
      switched: true,
      region,
      group: state.clashProxyGroup,
      node: region === 'JP' ? state.clashProxyJapanNodes[0] : state.clashProxyUsNodes[0],
      options,
    }),
  };
  const harness = loadManualRegionProbeHarness({
    api,
    getState: async () => ({
      ipProxyEnabled: true,
      clashProxyGroup: 'sushi',
      clashProxyJapanNodes: ['jp-home', 'jp-backup'],
      clashProxyUsNodes: ['us-home', 'us-backup'],
    }),
    applyIpProxySettingsFromState: async (state, options) => {
      routedStates.push({ state, options });
      return { applied: true, provider: 'clash-verge' };
    },
    probeIpProxyExit: async (options) => ({
      proxyRouting: {
        applied: true,
        provider: 'clash-verge',
        exitIp: options.state.ipProxyRegion === 'JP' ? '203.0.113.10' : '198.51.100.20',
        exitRegion: options.state.ipProxyRegion,
      },
    }),
    setState: (updates) => stateUpdates.push(updates),
    broadcastDataUpdate: (updates) => broadcasts.push(updates),
  });

  const jpResult = await harness('JP', {});
  const usResult = await harness('US', {});

  assert.equal(jpResult.matched, true);
  assert.equal(usResult.matched, true);
  assert.equal(routedStates[0].state.ipProxyRegion, 'JP');
  assert.equal(routedStates[1].state.ipProxyRegion, 'US');
  assert.equal(jpResult.attempts, 1);
  assert.equal(usResult.attempts, 1);
  assert.equal(stateUpdates[0].clashProxyLastJapanProbeRegion, 'JP');
  assert.equal(stateUpdates[0].clashProxyLastJapanProbeNode, 'jp-home');
  assert.equal(stateUpdates[1].clashProxyLastUsProbeRegion, 'US');
  assert.equal(stateUpdates[1].clashProxyLastUsProbeNode, 'us-home');
  assert.equal(broadcasts.length, 2);
});

test('manual Clash region probe retries and rotates nodes before reporting success', async () => {
  const routedStates = [];
  const switchOffsets = [];
  let probeCount = 0;
  const api = {
    switchClashProxyForRegion: async (region, state, options = {}) => {
      switchOffsets.push(options.nodeOffset);
      return {
        switched: true,
        region,
        group: state.clashProxyGroup,
        node: state.clashProxyJapanNodes[options.nodeOffset % state.clashProxyJapanNodes.length],
      };
    },
  };
  const harness = loadManualRegionProbeHarness({
    api,
    getState: async () => ({
      ipProxyEnabled: true,
      clashProxyGroup: 'sushi',
      clashProxyJapanNodes: ['jp-a', 'jp-b', 'jp-c'],
      clashProxyUsNodes: ['us-home'],
    }),
    applyIpProxySettingsFromState: async (state, options) => {
      routedStates.push({ state, options });
      return { applied: true };
    },
    probeIpProxyExit: async () => {
      probeCount += 1;
      return {
        proxyRouting: {
          applied: true,
          provider: 'clash-verge',
          exitIp: `203.0.113.${probeCount}`,
          exitRegion: probeCount < 3 ? 'US' : 'JP',
        },
      };
    },
  });

  const result = await harness('JP', { maxAttempts: 5, retryDelayMs: 0 });

  assert.equal(result.matched, true);
  assert.equal(result.attempts, 3);
  assert.deepEqual(switchOffsets, [0, 1, 2]);
  assert.deepEqual(routedStates.map((entry) => entry.state.ipProxyRegion), ['JP', 'JP', 'JP']);
  assert.equal(routedStates.length, 3);
  assert.equal(result.node, 'jp-c');
});

test('manual Clash region probe records Clash diagnostics when exit region mismatches', async () => {
  const stateUpdates = [];
  const api = {
    switchClashProxyForRegion: async (region, state) => ({
      switched: true,
      region,
      group: state.clashProxyGroup,
      node: state.clashProxyJapanNodes[0],
    }),
    fetchClashProxyDiagnostics: async () => ({
      ok: true,
      groupStatus: {
        group: 'sushi',
        now: 'jp-a',
      },
      connectionSnapshot: {
        probeConnection: {
          host: 'ipinfo.io',
          destination: 'ipinfo.io:443',
          chainText: 'sushi -> jp-a',
          rule: 'DomainSuffix',
          rulePayload: 'ipinfo.io',
        },
      },
      errors: [],
    }),
  };
  const harness = loadManualRegionProbeHarness({
    api,
    getState: async () => ({
      ipProxyEnabled: true,
      clashProxyGroup: 'sushi',
      clashProxyJapanNodes: ['jp-a'],
      clashProxyUsNodes: ['us-a'],
    }),
    probeIpProxyExit: async () => ({
      proxyRouting: {
        applied: true,
        provider: 'clash-verge',
        exitIp: '154.17.22.104',
        exitRegion: 'US',
      },
    }),
    setState: (updates) => stateUpdates.push(updates),
  });

  const result = await harness('JP', { maxAttempts: 1, retryDelayMs: 0 });

  assert.equal(result.matched, false);
  assert.match(result.diagnostic, /Clash 当前选择：sushi -> jp-a/);
  assert.match(result.diagnostic, /检测连接：连接 ipinfo\.io:443，链路 sushi -> jp-a/);
  assert.match(stateUpdates[0].clashProxyLastJapanProbeDiagnostic, /Clash 当前选择/);
});

test('background execution hook skips switching when current IP region already matches', async () => {
  const logs = [];
  let switchCount = 0;
  const api = {
    resolveClashProxyRegionForStep: () => 'JP',
    ensureClashProxyForStep: async (_step, _state, options = {}) => {
      switchCount += 1;
      return {
        switched: true,
        region: 'JP',
        group: 'sushi',
        node: `jp-node-${options.nodeOffset}`,
      };
    },
  };
  const harness = loadExecutionHookHarness({
    api,
    addLog: (message, level, meta) => logs.push({ message, level, meta }),
    probeIpProxyExit: async () => ({ ok: true, exitIp: '2.2.2.2', exitRegion: 'JP' }),
  });

  const result = await harness(8, 'plus-checkout-open', {
    ipProxyEnabled: true,
    clashProxySwitchEnabled: true,
  });

  assert.equal(switchCount, 0);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, 'info');
  assert.equal(result.current, true);
});

test('background execution hook retries switch and IP region probe until expected country matches', async () => {
  const logs = [];
  const sleeps = [];
  const routedStates = [];
  const switchOptions = [];
  let switchCount = 0;
  const probeResults = [
    { ok: true, exitIp: '0.0.0.0', exitRegion: 'US' },
    { ok: true, exitIp: '1.1.1.1', exitRegion: 'US' },
    { ok: true, exitIp: '2.2.2.2', exitRegion: 'JP' },
  ];
  const api = {
    resolveClashProxyRegionForStep: () => 'JP',
    ensureClashProxyForStep: async (_step, _state, options = {}) => {
      switchCount += 1;
      switchOptions.push(options);
      return {
        switched: true,
        region: 'JP',
        group: 'sushi',
        node: `jp-node-${options.nodeOffset}`,
      };
    },
  };
  const harness = loadExecutionHookHarness({
    api,
    applyIpProxySettingsFromState: async (state, options) => {
      routedStates.push({ state, options });
      return { applied: true };
    },
    addLog: (message, level, meta) => logs.push({ message, level, meta }),
    probeIpProxyExit: async () => probeResults.shift(),
    sleepWithStop: (ms) => sleeps.push(ms),
  });

  const result = await harness(8, 'plus-checkout-open', {
    ipProxyEnabled: true,
    clashProxySwitchEnabled: true,
  });

  assert.equal(switchCount, 2);
  assert.deepEqual(switchOptions.map((options) => options.nodeOffset), [0, 1]);
  assert.equal(routedStates.length, 2);
  assert.deepEqual(sleeps, [10000]);
  assert.equal(routedStates[1].state.ipProxyRegion, 'JP');
  assert.equal(logs[0].level, 'warn');
  assert.equal(logs[1].level, 'info');
  assert.equal(result.clashProxyLastRegion, 'JP');
});

test('background execution hook fails after one hour of mismatched IP region probes', async () => {
  const logs = [];
  const stateUpdates = [];
  let switchCount = 0;
  const api = {
    resolveClashProxyRegionForStep: () => 'US',
    ensureClashProxyForStep: async () => {
      switchCount += 1;
      return {
        switched: true,
        region: 'US',
        group: 'sushi',
        node: 'us-node',
      };
    },
  };
  const harness = loadExecutionHookHarness({
    api,
    setState: (updates) => stateUpdates.push(updates),
    addLog: (message, level, meta) => logs.push({ message, level, meta }),
    probeIpProxyExit: async () => ({ ok: true, exitIp: '9.9.9.9', exitRegion: 'JP' }),
  });

  await assert.rejects(
    () => harness(9, 'fill-paypal-email', {
      ipProxyEnabled: true,
      clashProxySwitchEnabled: true,
    }),
    /360 次（约 1 小时）/
  );

  assert.equal(switchCount, 360);
  assert.equal(logs.filter((entry) => entry.level === 'warn').length, 360);
  assert.equal(logs.at(-1).level, 'error');
  assert.match(stateUpdates.at(-1).clashProxyLastError, /Clash/);
});
