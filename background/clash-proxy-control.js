// background/clash-proxy-control.js - Clash/Mihomo node switching for region-bound steps

(function registerClashProxyControl(root) {
  const DEFAULT_CLASH_PROXY_CONTROL_URL = 'http://127.0.0.1:9097';
  const DEFAULT_OPENAI_FLOW_ID = 'openai';
  const CLASH_PROXY_FETCH_TIMEOUT_MS = 8000;
  const CLASH_PROXY_PROBE_HOST_KEYWORDS = [
    'ipinfo.io',
    'api.ipify.org',
    'api64.ipify.org',
    'ifconfig.co',
    'ifconfig.me',
    'ip-api.com',
    'ipapi.co',
  ];

  function normalizeClashProxyControlUrl(value = '', fallback = DEFAULT_CLASH_PROXY_CONTROL_URL) {
    const fallbackValue = String(fallback || DEFAULT_CLASH_PROXY_CONTROL_URL).trim().replace(/\/+$/g, '')
      || DEFAULT_CLASH_PROXY_CONTROL_URL;
    const rawValue = String(value || fallbackValue).trim();
    if (!rawValue) {
      return fallbackValue;
    }
    try {
      const parsed = new URL(rawValue);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return fallbackValue;
      }
      const endpointPath = parsed.pathname.replace(/\/+$/g, '');
      if (!endpointPath || endpointPath === '/proxies' || endpointPath.startsWith('/proxies/')) {
        parsed.pathname = '';
        parsed.search = '';
        parsed.hash = '';
      }
      return parsed.toString().replace(/\/+$/g, '');
    } catch {
      return fallbackValue;
    }
  }

  function normalizeClashProxyRegion(value = '') {
    const normalized = String(value || '').trim().toUpperCase();
    return normalized === 'JP' || normalized === 'US' ? normalized : '';
  }

  function normalizeClashProxyName(value = '') {
    return String(value || '').trim();
  }

  function dedupeClashProxyNames(values = []) {
    const names = [];
    const seen = new Set();
    (Array.isArray(values) ? values : []).forEach((value) => {
      const name = normalizeClashProxyName(value);
      const key = name.toLowerCase();
      if (!name || seen.has(key)) {
        return;
      }
      seen.add(key);
      names.push(name);
    });
    return names;
  }

  function normalizeClashProxyNodePool(value = [], fallbackNode = '') {
    const source = Array.isArray(value)
      ? value
      : String(value || '')
        .split(/[\n,，;；]+/g)
        .map((entry) => entry.trim());
    const normalized = dedupeClashProxyNames(source);
    const fallback = normalizeClashProxyName(fallbackNode);
    return normalized.length ? normalized : (fallback ? [fallback] : []);
  }

  function isClashProxySelectorLike(type = '') {
    const normalized = String(type || '').trim().toLowerCase();
    return [
      'selector',
      'urltest',
      'fallback',
      'loadbalance',
      'load-balance',
      'relay',
    ].includes(normalized);
  }

  function parseClashProxyOptionsPayload(payload = {}, state = {}) {
    const proxies = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload.proxies || {})
      : {};
    const groups = [];
    const nodesByGroup = {};
    Object.entries(proxies || {}).forEach(([rawName, rawProxy]) => {
      const name = normalizeClashProxyName(rawName);
      const proxy = rawProxy && typeof rawProxy === 'object' && !Array.isArray(rawProxy)
        ? rawProxy
        : {};
      const all = dedupeClashProxyNames(proxy.all || []);
      if (!name || !all.length || !isClashProxySelectorLike(proxy.type)) {
        return;
      }
      groups.push(name);
      nodesByGroup[name] = all;
    });

    const configuredGroup = normalizeClashProxyName(state?.clashProxyGroup);
    const selectedGroup = groups.includes(configuredGroup)
      ? configuredGroup
      : (configuredGroup || groups[0] || '');
    const selectedNodes = selectedGroup && nodesByGroup[selectedGroup]
      ? nodesByGroup[selectedGroup]
      : [];

    return {
      groups: dedupeClashProxyNames(groups),
      nodesByGroup,
      selectedGroup,
      nodes: selectedNodes,
    };
  }

  function getActiveFlowIdForClashProxy(state = {}) {
    const fallback = typeof root.DEFAULT_ACTIVE_FLOW_ID === 'string'
      ? root.DEFAULT_ACTIVE_FLOW_ID
      : DEFAULT_OPENAI_FLOW_ID;
    return String(state?.activeFlowId || state?.flowId || fallback).trim().toLowerCase()
      || fallback;
  }

  function resolveClashProxyRegionForStep(step, state = {}) {
    const activeFlowId = getActiveFlowIdForClashProxy(state);
    if (activeFlowId !== DEFAULT_OPENAI_FLOW_ID) {
      return '';
    }
    const numericStep = Number(step);
    if (!Number.isInteger(numericStep) || numericStep <= 0) {
      return '';
    }
    if (numericStep >= 1 && numericStep <= 7) {
      return 'JP';
    }
    if (numericStep >= 8 && numericStep <= 16) {
      return 'US';
    }
    return '';
  }

  function resolveClashProxyNodePoolForRegion(region = '', state = {}) {
    const normalizedRegion = normalizeClashProxyRegion(region);
    if (normalizedRegion === 'JP') {
      return normalizeClashProxyNodePool(state?.clashProxyJapanNodes, state?.clashProxyJapanNode);
    }
    if (normalizedRegion === 'US') {
      return normalizeClashProxyNodePool(state?.clashProxyUsNodes, state?.clashProxyUsNode);
    }
    return [];
  }

  function resolveClashProxyRoundIndex(state = {}, options = {}) {
    const rawValue = options.roundIndex
      ?? options.currentRun
      ?? options.targetRun
      ?? state?.autoRunCurrentRun
      ?? 1;
    const numeric = Math.floor(Number(rawValue));
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
  }

  function resolveClashProxyNodeForRegion(region = '', state = {}, options = {}) {
    const pool = resolveClashProxyNodePoolForRegion(region, state);
    if (!pool.length) {
      return '';
    }
    const explicitNode = normalizeClashProxyName(options.node);
    if (explicitNode && pool.includes(explicitNode)) {
      return explicitNode;
    }
    const roundIndex = resolveClashProxyRoundIndex(state, options);
    const rawOffset = Math.floor(Number(options.nodeOffset ?? options.attemptOffset ?? 0));
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
    return pool[(roundIndex - 1 + offset) % pool.length] || '';
  }

  function buildClashProxySwitchRequest(region = '', state = {}, options = {}) {
    const normalizedRegion = normalizeClashProxyRegion(region);
    if (!state?.ipProxyEnabled || !state?.clashProxySwitchEnabled || !normalizedRegion) {
      return {
        skipped: true,
        reason: !state?.ipProxyEnabled
          ? 'ip_proxy_disabled'
          : (!state?.clashProxySwitchEnabled ? 'clash_switch_disabled' : 'no_region'),
      };
    }

    const group = String(state?.clashProxyGroup || '').trim();
    const node = resolveClashProxyNodeForRegion(normalizedRegion, state, options);
    if (!group) {
      throw new Error('Clash 自动切节点缺少代理组名称。');
    }
    if (!node) {
      throw new Error(`Clash 自动切节点缺少 ${normalizedRegion} 节点名称。`);
    }

    const controlUrl = normalizeClashProxyControlUrl(state?.clashProxyControlUrl);
    const secret = String(state?.clashProxySecret || '').trim();
    const headers = {
      'Content-Type': 'application/json',
    };
    if (secret) {
      headers.Authorization = `Bearer ${secret}`;
    }

    return {
      skipped: false,
      region: normalizedRegion,
      group,
      node,
      url: `${controlUrl}/proxies/${encodeURIComponent(group)}`,
      headers,
      body: { name: node },
    };
  }

  async function parseClashProxyErrorResponse(response) {
    let details = '';
    try {
      details = await response.text();
    } catch {
      details = '';
    }
    const suffix = details ? `：${details.slice(0, 300)}` : '';
    return new Error(`Clash 控制接口返回 ${response.status}${suffix}`);
  }

  function buildClashProxyAuthHeaders(state = {}, includeJson = false) {
    const secret = String(state?.clashProxySecret || '').trim();
    const headers = includeJson ? { 'Content-Type': 'application/json' } : {};
    if (secret) {
      headers.Authorization = `Bearer ${secret}`;
    }
    return headers;
  }

  async function fetchClashProxyJson(path = '', state = {}, options = {}) {
    const controlUrl = normalizeClashProxyControlUrl(state?.clashProxyControlUrl);
    const fetchImpl = options.fetch || root.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new Error('当前环境不支持调用 Clash 控制接口。');
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutMs = Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : CLASH_PROXY_FETCH_TIMEOUT_MS;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

    try {
      const response = await fetchImpl(`${controlUrl}${path}`, {
        method: 'GET',
        headers: buildClashProxyAuthHeaders(state),
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!response?.ok) {
        throw await parseClashProxyErrorResponse(response || { status: 0, text: async () => '' });
      }
      return await response.json();
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`Clash 控制接口超时（${timeoutMs}ms）。`);
      }
      throw error;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async function switchClashProxyForRegion(region = '', state = {}, options = {}) {
    const request = buildClashProxySwitchRequest(region, state, options);
    if (request.skipped) {
      return request;
    }

    const fetchImpl = options.fetch || root.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new Error('当前环境不支持调用 Clash 控制接口。');
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutMs = Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : CLASH_PROXY_FETCH_TIMEOUT_MS;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

    try {
      const response = await fetchImpl(request.url, {
        method: 'PUT',
        headers: request.headers,
        body: JSON.stringify(request.body),
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!response?.ok) {
        throw await parseClashProxyErrorResponse(response || { status: 0, text: async () => '' });
      }
      return {
        skipped: false,
        switched: true,
        region: request.region,
        group: request.group,
        node: request.node,
        url: request.url,
      };
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`Clash 控制接口超时（${timeoutMs}ms）。`);
      }
      throw error;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  function parseClashProxyGroupStatusPayload(payload = {}, group = '') {
    const proxy = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload
      : {};
    return {
      group: normalizeClashProxyName(group || proxy.name),
      name: normalizeClashProxyName(proxy.name),
      now: normalizeClashProxyName(proxy.now),
      type: normalizeClashProxyName(proxy.type),
      all: dedupeClashProxyNames(proxy.all || []),
      history: Array.isArray(proxy.history) ? proxy.history.slice(-10) : [],
    };
  }

  function normalizeClashConnection(connection = {}) {
    const item = connection && typeof connection === 'object' && !Array.isArray(connection)
      ? connection
      : {};
    const metadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
      ? item.metadata
      : {};
    const host = normalizeClashProxyName(
      metadata.host
        || metadata.destinationIP
        || metadata.remoteDestination
        || metadata.sourceIP
        || item.host
    );
    const destinationPort = normalizeClashProxyName(metadata.destinationPort || item.destinationPort);
    const chains = dedupeClashProxyNames(Array.isArray(item.chains) ? item.chains : []);
    return {
      id: normalizeClashProxyName(item.id),
      host,
      destination: host && destinationPort ? `${host}:${destinationPort}` : host,
      network: normalizeClashProxyName(metadata.network),
      type: normalizeClashProxyName(metadata.type),
      process: normalizeClashProxyName(metadata.process || metadata.processPath || item.process),
      rule: normalizeClashProxyName(item.rule),
      rulePayload: normalizeClashProxyName(item.rulePayload),
      chains,
      chainText: chains.join(' -> '),
      start: normalizeClashProxyName(item.start),
      upload: Number(item.upload) || 0,
      download: Number(item.download) || 0,
    };
  }

  function isClashProbeConnection(connection = {}) {
    const host = String(connection?.host || '').trim().toLowerCase();
    return Boolean(host && CLASH_PROXY_PROBE_HOST_KEYWORDS.some((keyword) => host.includes(keyword)));
  }

  function parseClashProxyConnectionsPayload(payload = {}) {
    const connections = Array.isArray(payload?.connections) ? payload.connections : [];
    const normalized = connections
      .map((connection) => normalizeClashConnection(connection))
      .filter((connection) => connection.host || connection.chainText);
    const probeConnections = normalized.filter((connection) => isClashProbeConnection(connection));
    return {
      total: connections.length,
      probeConnection: probeConnections[0] || null,
      probeConnections: probeConnections.slice(0, 5),
      recentConnections: normalized.slice(0, 10),
    };
  }

  async function fetchClashProxyGroupStatus(state = {}, options = {}) {
    const group = normalizeClashProxyName(options.group || state?.clashProxyGroup);
    if (!group) {
      return { group: '', now: '', type: '', all: [], history: [] };
    }
    const payload = await fetchClashProxyJson(`/proxies/${encodeURIComponent(group)}`, state, options);
    return parseClashProxyGroupStatusPayload(payload, group);
  }

  async function fetchClashProxyConnections(state = {}, options = {}) {
    const payload = await fetchClashProxyJson('/connections', state, options);
    return parseClashProxyConnectionsPayload(payload);
  }

  async function fetchClashProxyDiagnostics(state = {}, options = {}) {
    const result = {
      ok: true,
      groupStatus: null,
      connectionSnapshot: null,
      errors: [],
    };
    try {
      result.groupStatus = await fetchClashProxyGroupStatus(state, options);
    } catch (error) {
      result.ok = false;
      result.errors.push(`group:${error?.message || error}`);
    }
    try {
      result.connectionSnapshot = await fetchClashProxyConnections(state, options);
    } catch (error) {
      result.ok = false;
      result.errors.push(`connections:${error?.message || error}`);
    }
    return result;
  }

  function parseClashProxyProvidersPayload(payload = {}) {
    const providers = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload.providers || {})
      : {};
    return dedupeClashProxyNames(
      Object.entries(providers || {})
        .map(([rawName, rawProvider]) => {
          const provider = rawProvider && typeof rawProvider === 'object' && !Array.isArray(rawProvider)
            ? rawProvider
            : {};
          return provider.name || rawName;
        })
    );
  }

  async function fetchClashProxyOptions(state = {}, options = {}) {
    const controlUrl = normalizeClashProxyControlUrl(state?.clashProxyControlUrl);
    const secret = String(state?.clashProxySecret || '').trim();
    const headers = {};
    if (secret) {
      headers.Authorization = `Bearer ${secret}`;
    }

    const fetchImpl = options.fetch || root.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new Error('当前环境不支持调用 Clash 控制接口。');
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutMs = Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : CLASH_PROXY_FETCH_TIMEOUT_MS;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

    try {
      const response = await fetchImpl(`${controlUrl}/proxies`, {
        method: 'GET',
        headers,
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!response?.ok) {
        throw await parseClashProxyErrorResponse(response || { status: 0, text: async () => '' });
      }
      const payload = await response.json();
      return {
        ok: true,
        controlUrl,
        ...parseClashProxyOptionsPayload(payload, state),
      };
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`Clash 控制接口超时（${timeoutMs}ms）。`);
      }
      throw error;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async function refreshClashProxyProviders(state = {}, options = {}) {
    const controlUrl = normalizeClashProxyControlUrl(state?.clashProxyControlUrl);
    const secret = String(state?.clashProxySecret || '').trim();
    const headers = {};
    if (secret) {
      headers.Authorization = `Bearer ${secret}`;
    }

    const fetchImpl = options.fetch || root.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new Error('当前环境不支持调用 Clash 控制接口。');
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutMs = Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : CLASH_PROXY_FETCH_TIMEOUT_MS;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

    try {
      const listResponse = await fetchImpl(`${controlUrl}/providers/proxies`, {
        method: 'GET',
        headers,
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!listResponse?.ok) {
        throw await parseClashProxyErrorResponse(listResponse || { status: 0, text: async () => '' });
      }
      const payload = await listResponse.json();
      const providers = parseClashProxyProvidersPayload(payload);
      const refreshed = [];
      const failures = [];
      for (const provider of providers) {
        try {
          const response = await fetchImpl(`${controlUrl}/providers/proxies/${encodeURIComponent(provider)}`, {
            method: 'PUT',
            headers,
            ...(controller ? { signal: controller.signal } : {}),
          });
          if (!response?.ok) {
            throw await parseClashProxyErrorResponse(response || { status: 0, text: async () => '' });
          }
          refreshed.push(provider);
        } catch (error) {
          failures.push({
            provider,
            error: error?.message || String(error || ''),
          });
        }
      }
      return {
        ok: failures.length === 0,
        controlUrl,
        providers,
        refreshed,
        refreshedCount: refreshed.length,
        failures,
      };
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`Clash 控制接口超时（${timeoutMs}ms）。`);
      }
      throw error;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async function ensureClashProxyForStep(step, state = {}, options = {}) {
    const region = resolveClashProxyRegionForStep(step, state);
    if (!region) {
      return { skipped: true, reason: 'step_without_region' };
    }
    return switchClashProxyForRegion(region, state, options);
  }

  root.MultiPageClashProxyControl = Object.freeze({
    DEFAULT_CLASH_PROXY_CONTROL_URL,
    buildClashProxySwitchRequest,
    ensureClashProxyForStep,
    fetchClashProxyConnections,
    fetchClashProxyDiagnostics,
    fetchClashProxyGroupStatus,
    fetchClashProxyOptions,
    normalizeClashProxyNodePool,
    normalizeClashProxyControlUrl,
    normalizeClashProxyRegion,
    parseClashProxyConnectionsPayload,
    parseClashProxyGroupStatusPayload,
    parseClashProxyProvidersPayload,
    parseClashProxyOptionsPayload,
    refreshClashProxyProviders,
    resolveClashProxyNodePoolForRegion,
    resolveClashProxyNodeForRegion,
    resolveClashProxyRegionForStep,
    switchClashProxyForRegion,
  });
})(typeof self !== 'undefined' ? self : globalThis);
