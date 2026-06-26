import {
  decodeFunctionResult,
  encodeFunctionData,
  formatEther,
  getAddress,
  hexToBigInt,
  isAddress,
  keccak256,
  numberToHex,
  parseEther,
} from "viem";
import {
  FACTORY_ABI,
  FACTORY_ADDRESS,
  HARNESS_ABI,
  REGISTRY_ABI,
  REGISTRY_ADDRESS,
  RITUAL_WALLET_ABI,
  RITUAL_WALLET_ADDRESS,
} from "./abis.js";
import { encryptRitualEnv } from "./crypto.js";

const RITUAL_CHAIN = {
  id: 1979,
  hex: "0x7bb",
  name: "Ritual Testnet",
  rpcUrl: "https://rpc.ritualfoundation.org",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
};

const DELIVERY_SELECTOR = keccak256(new TextEncoder().encode("onSovereignAgentResult(bytes32,bytes)")).slice(0, 10);
const EXPLORER_ADDRESS_BASE = "https://explorer.ritualfoundation.org/address";
const SCHED_GAS = 5_000_000n;
const DEPLOY_GAS = 3_500_000n;
const STOP_GAS = 3_500_000n;
const MIN_AGENT_DEPOSIT = parseEther("0.015");
const DEFAULT_ENV_PAYLOAD = new TextEncoder().encode('{"LLM_PROVIDER":"ritual"}');

const state = {
  account: "",
  chainId: "",
  balanceWei: 0n,
  busy: false,
  activeTool: "deploy",
  harness: "",
  saltHash: "",
  executor: "",
  agent: null,
  agents: [],
  rpcId: 1,
};

const elements = {
  activityLog: document.querySelector("#activityLog"),
  agentLookupInput: document.querySelector("#agentLookupInput"),
  agentBalance: document.querySelector("#agentBalance"),
  agentState: document.querySelector("#agentState"),
  agentsList: document.querySelector("#agentsList"),
  cliTypeInput: document.querySelector("#cliTypeInput"),
  configuredValue: document.querySelector("#configuredValue"),
  connectButton: document.querySelector("#connectButton"),
  deployButton: document.querySelector("#deployButton"),
  depositInput: document.querySelector("#depositInput"),
  disconnectButton: document.querySelector("#disconnectButton"),
  executorAddress: document.querySelector("#executorAddress"),
  harnessAddress: document.querySelector("#harnessAddress"),
  lockBlocksInput: document.querySelector("#lockBlocksInput"),
  lockUntilValue: document.querySelector("#lockUntilValue"),
  lookupAgentButton: document.querySelector("#lookupAgentButton"),
  modelInput: document.querySelector("#modelInput"),
  networkStatus: document.querySelector("#networkStatus"),
  previewButton: document.querySelector("#previewButton"),
  promptInput: document.querySelector("#promptInput"),
  refreshTargetButton: document.querySelector("#refreshTargetButton"),
  restartButton: document.querySelector("#restartButton"),
  saltInput: document.querySelector("#saltInput"),
  scanButton: document.querySelector("#scanButton"),
  scanSaltInput: document.querySelector("#scanSaltInput"),
  stopButton: document.querySelector("#stopButton"),
  targetAgentInput: document.querySelector("#targetAgentInput"),
  toolPanels: document.querySelectorAll("[data-tool-panel]"),
  toolTabs: document.querySelectorAll("[data-tool-tab]"),
  topupButton: document.querySelector("#topupButton"),
  topupInput: document.querySelector("#topupInput"),
  walletAddress: document.querySelector("#walletAddress"),
  walletBalance: document.querySelector("#walletBalance"),
  walletMenu: document.querySelector("#walletMenu"),
  walletMenuAddress: document.querySelector("#walletMenuAddress"),
  wakeModeValue: document.querySelector("#wakeModeValue"),
};

function hasWallet() {
  return typeof window.ethereum !== "undefined";
}

async function walletRequest(method, params = []) {
  if (!hasWallet()) {
    throw new Error("No injected wallet found.");
  }

  return window.ethereum.request({ method, params });
}

async function rpcRequest(method, params = []) {
  try {
    const response = await fetch(RITUAL_CHAIN.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: state.rpcId++,
        method,
        params,
      }),
    });
    const body = await response.json();
    if (body.error) {
      throw new Error(body.error.message || `${method} failed`);
    }
    return body.result;
  } catch (error) {
    if (hasWallet() && state.chainId === RITUAL_CHAIN.hex) {
      return walletRequest(method, params);
    }
    throw error;
  }
}

async function readFunction(to, abi, functionName, args = []) {
  const data = encodeFunctionData({ abi, functionName, args });
  const result = await rpcRequest("eth_call", [{ to, data }, "latest"]);
  return decodeFunctionResult({ abi, functionName, data: result });
}

async function getCode(address) {
  return rpcRequest("eth_getCode", [address, "latest"]);
}

function firstResult(result) {
  return Array.isArray(result) ? result[0] : result;
}

function shortAddress(address) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "-";
}

function explorerAddressUrl(address) {
  return `${EXPLORER_ADDRESS_BASE}/${getAddress(address)}`;
}

function openExplorerAddress(address) {
  window.open(explorerAddressUrl(address), "_blank", "noreferrer");
}

function formatRitual(wei, precision = 5) {
  const [whole, fraction = ""] = formatEther(wei).split(".");
  const trimmed = fraction.slice(0, precision).replace(/0+$/, "");
  return `${whole}${trimmed ? `.${trimmed}` : ""} RITUAL`;
}

function normalizeDecimal(value) {
  return value.trim().replace(",", ".");
}

function parseNativeInput(value, label) {
  try {
    return parseEther(normalizeDecimal(value));
  } catch {
    throw new Error(`${label} must be a valid RITUAL amount.`);
  }
}

function parsePositiveBigInt(value, label) {
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized) || BigInt(normalized) < 1n) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return BigInt(normalized);
}

function quantity(value) {
  return numberToHex(value);
}

async function withRitualGas(tx) {
  const gasPrice = tx.gasPrice || (await rpcRequest("eth_gasPrice"));
  return {
    ...tx,
    gasPrice,
  };
}

function getConfig() {
  const prompt = elements.promptInput.value.trim();
  const model = elements.modelInput.value.trim();
  const salt = elements.saltInput.value.trim();
  const depositWei = parseNativeInput(elements.depositInput.value, "Deposit");

  if (!prompt) {
    throw new Error("Prompt is required.");
  }
  if (!model) {
    throw new Error("Model is required.");
  }
  if (!salt) {
    throw new Error("Salt is required.");
  }
  if (depositWei < MIN_AGENT_DEPOSIT) {
    throw new Error("Deposit must be at least 0.015 RITUAL.");
  }

  return {
    prompt,
    model,
    salt,
    depositWei,
    cliType: Number.parseInt(elements.cliTypeInput.value, 10),
    lockBlocks: parsePositiveBigInt(elements.lockBlocksInput.value, "Lock blocks"),
  };
}

function saveSettings() {
  const settings = {
    prompt: elements.promptInput.value,
    model: elements.modelInput.value,
    salt: elements.saltInput.value,
    scanSalt: elements.scanSaltInput.value,
    agentAddress: elements.agentLookupInput.value,
    deposit: elements.depositInput.value,
    lockBlocks: elements.lockBlocksInput.value,
    topup: elements.topupInput.value,
  };
  localStorage.setItem("ritual-agent-builder-settings", JSON.stringify(settings));
}

function loadSettings() {
  try {
    const settings = JSON.parse(localStorage.getItem("ritual-agent-builder-settings") || "{}");
    if (settings.prompt) elements.promptInput.value = settings.prompt;
    if (settings.model) elements.modelInput.value = settings.model;
    if (settings.salt) elements.saltInput.value = settings.salt;
    if (settings.scanSalt) elements.scanSaltInput.value = settings.scanSalt;
    if (settings.agentAddress) elements.agentLookupInput.value = settings.agentAddress;
    if (settings.deposit) elements.depositInput.value = settings.deposit;
    if (settings.lockBlocks) elements.lockBlocksInput.value = settings.lockBlocks;
    if (settings.topup) elements.topupInput.value = settings.topup;
  } catch {
    localStorage.removeItem("ritual-agent-builder-settings");
  }
}

function logActivity(title, detail = "", href = "") {
  const item = document.createElement("div");
  item.className = "activity-item";
  const titleNode = document.createElement("strong");
  titleNode.textContent = title;
  const detailNode = document.createElement(href ? "a" : "span");
  detailNode.textContent = detail;
  if (href) {
    detailNode.href = href;
    detailNode.target = "_blank";
    detailNode.rel = "noreferrer";
  }
  item.append(titleNode, detailNode);
  elements.activityLog.prepend(item);
  return item;
}

function updateActivity(item, title, detail = "") {
  item.querySelector("strong").textContent = title;
  item.querySelector("span, a").textContent = detail;
}

function setBusy(isBusy) {
  state.busy = isBusy;
  render();
}

async function connectWallet() {
  const accounts = await walletRequest("eth_requestAccounts");
  state.account = accounts[0] || "";
  state.chainId = await walletRequest("eth_chainId");
  bindWalletEvents();
  await switchToRitual();
  await refreshWalletState();
}

async function disconnectWallet() {
  if (hasWallet()) {
    try {
      await walletRequest("wallet_revokePermissions", [{ eth_accounts: {} }]);
    } catch {
      // Some injected wallets do not support permission revocation.
    }
  }

  state.account = "";
  state.chainId = "";
  state.balanceWei = 0n;
  state.harness = "";
  state.saltHash = "";
  state.agent = null;
  state.agents = [];
  elements.agentLookupInput.value = "";
  elements.targetAgentInput.value = "";
  logActivity("Wallet disconnected", "Local session cleared");
  render();
}

async function switchToRitual() {
  if (!state.account) {
    return;
  }

  try {
    await walletRequest("wallet_switchEthereumChain", [{ chainId: RITUAL_CHAIN.hex }]);
  } catch (error) {
    if (error.code !== 4902) {
      throw error;
    }

    await walletRequest("wallet_addEthereumChain", [
      {
        chainId: RITUAL_CHAIN.hex,
        chainName: RITUAL_CHAIN.name,
        nativeCurrency: RITUAL_CHAIN.nativeCurrency,
        rpcUrls: [RITUAL_CHAIN.rpcUrl],
      },
    ]);
  }

  state.chainId = await walletRequest("eth_chainId");
}

function bindWalletEvents() {
  if (!hasWallet() || window.__ritualAgentBuilderEventsBound) {
    return;
  }

  window.__ritualAgentBuilderEventsBound = true;
  window.ethereum.on("accountsChanged", async (accounts) => {
    state.account = accounts[0] || "";
    await refreshWalletState();
  });

  window.ethereum.on("chainChanged", async (chainId) => {
    state.chainId = chainId;
    await refreshWalletState();
  });
}

async function refreshWalletState() {
  if (!state.account) {
    render();
    return;
  }

  state.chainId = hasWallet() ? await walletRequest("eth_chainId") : state.chainId;
  if (state.chainId === RITUAL_CHAIN.hex) {
    state.balanceWei = hexToBigInt(await rpcRequest("eth_getBalance", [state.account, "latest"]));
  }
  render();
}

async function ensureReady() {
  if (!state.account) {
    await connectWallet();
  }
  if (state.chainId !== RITUAL_CHAIN.hex) {
    await switchToRitual();
    await refreshWalletState();
  }
  if (!state.account || state.chainId !== RITUAL_CHAIN.hex) {
    throw new Error("Wallet is not connected to Ritual testnet.");
  }
}

async function predictHarness(owner, salt) {
  const saltHash = keccak256(new TextEncoder().encode(salt));
  const result = await readFunction(FACTORY_ADDRESS, FACTORY_ABI, "predictHarness", [owner, saltHash]);
  const [harness] = Array.isArray(result) ? result : [result];
  return { harness: getAddress(harness), saltHash };
}

async function fetchAgent(address) {
  if (!isAddress(address)) {
    throw new Error("Agent address is invalid.");
  }

  const checksum = getAddress(address);
  const code = await getCode(checksum);
  if (!code || code === "0x") {
    return {
      address: checksum,
      exists: false,
      configured: false,
      wakeMode: null,
      balanceWei: 0n,
      lockUntil: null,
    };
  }

  const [configured, wakeMode, balanceWei, lockUntil] = await Promise.all([
    readFunction(checksum, HARNESS_ABI, "configured").then(firstResult),
    readFunction(checksum, HARNESS_ABI, "wakeMode").then(firstResult),
    readFunction(RITUAL_WALLET_ADDRESS, RITUAL_WALLET_ABI, "balanceOf", [checksum]).then(firstResult),
    readFunction(RITUAL_WALLET_ADDRESS, RITUAL_WALLET_ABI, "lockUntil", [checksum]).then(firstResult),
  ]);

  return {
    address: checksum,
    exists: true,
    configured: Boolean(configured),
    wakeMode: Number(wakeMode),
    balanceWei,
    lockUntil,
  };
}

function getAgentStateLabel(agent) {
  if (!agent) return "-";
  if (!agent.exists) return "Not deployed";
  if (!agent.configured) return "Unconfigured";
  if (agent.wakeMode === 1) return "Armed";
  return "Stopped";
}

async function previewAgent({ silent = false } = {}) {
  if (!state.account) {
    if (!silent) logActivity("Wallet", "Connect a wallet first.");
    return null;
  }

  const config = getConfig();
  if (!elements.scanSaltInput.value.trim()) {
    elements.scanSaltInput.value = config.salt;
  }
  saveSettings();
  const predicted = await predictHarness(state.account, config.salt);
  state.harness = predicted.harness;
  state.saltHash = predicted.saltHash;
  elements.targetAgentInput.value = state.harness;
  state.agent = await fetchAgent(state.harness);
  render();

  if (!silent) {
    logActivity("Preview ready", state.harness);
  }

  return { ...predicted, config, agent: state.agent };
}

function isServiceTuple(value) {
  return Boolean(value && (value.node || (Array.isArray(value) && value.length >= 3)));
}

function normalizeServices(decoded) {
  if (!Array.isArray(decoded)) {
    return [];
  }
  if (decoded.length > 0 && isServiceTuple(decoded[0])) {
    return decoded;
  }
  if (Array.isArray(decoded[0]) && decoded[0].length > 0 && isServiceTuple(decoded[0][0])) {
    return decoded[0];
  }
  return [];
}

async function discoverExecutor() {
  if (state.executor) {
    return { executor: state.executor, publicKey: state.executorPublicKey };
  }

  const decoded = await readFunction(REGISTRY_ADDRESS, REGISTRY_ABI, "getServicesByCapability", [0, true]);
  const services = normalizeServices(decoded);
  if (!services.length) {
    throw new Error("No valid Ritual executor found in the registry.");
  }

  const service = services.find((item) => item.isValid ?? item[1]) || services[0];
  const node = service.node || service[0];
  const executor = getAddress(node.teeAddress || node[1]);
  const publicKey = node.publicKey || node[3];

  state.executor = executor;
  state.executorPublicKey = publicKey;
  render();
  return { executor, publicKey };
}

async function buildConfigureCallData(harness, config) {
  const { executor, publicKey } = await discoverExecutor();
  const blockNumber = hexToBigInt(await rpcRequest("eth_blockNumber"));
  const encryptedEnv = await encryptRitualEnv(publicKey, DEFAULT_ENV_PAYLOAD);
  const maxPollBlock = blockNumber + 10_000_000n;

  const params = [
    executor,
    500n,
    "0x",
    5n,
    maxPollBlock,
    "SOVEREIGN_AGENT_TASK",
    harness,
    DELIVERY_SELECTOR,
    3_000_000n,
    1_000_000_000n,
    100_000_000n,
    config.cliType,
    config.prompt,
    encryptedEnv,
    ["", "", ""],
    ["", "", ""],
    [],
    ["", "", ""],
    config.model,
    [],
    5,
    2048,
    "",
  ];
  const schedule = [800_000, 180, 500, 1_000_000_000n, 100_000_000n, 0n];
  const rolling = [1, 5000, 1];

  return {
    executor,
    calldata: encodeFunctionData({
      abi: HARNESS_ABI,
      functionName: "configureFundAndStart",
      args: [params, schedule, rolling, config.lockBlocks],
    }),
  };
}

async function waitForReceipt(txHash) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const receipt = await rpcRequest("eth_getTransactionReceipt", [txHash]);
    if (receipt) {
      if (receipt.status !== "0x1") {
        return receipt;
      }
      return receipt;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1800));
  }
  throw new Error(`Timed out waiting for transaction: ${txHash}`);
}

function formatGasHex(value) {
  if (!value) {
    return "";
  }
  try {
    return hexToBigInt(value).toString();
  } catch {
    return String(value);
  }
}

async function describeFailedTransaction(txHash, tx, receipt) {
  const details = [];
  const gasUsed = formatGasHex(receipt?.gasUsed);
  const gasLimit = formatGasHex(tx?.gas);

  if (gasUsed) {
    details.push(`gas used ${gasUsed}${gasLimit ? ` / ${gasLimit}` : ""}`);
  }

  if (gasUsed && gasLimit && gasUsed === gasLimit) {
    details.push("likely out of gas");
  }

  try {
    await rpcRequest("eth_call", [tx, receipt?.blockNumber || "latest"]);
  } catch (error) {
    const reason = error?.message || String(error);
    if (reason && !details.some((item) => item.includes(reason))) {
      details.push(reason);
    }
  }

  return details.length ? `Failure details: ${details.join(" | ")}` : "";
}

async function sendTransaction(label, tx) {
  const item = logActivity(label, "Waiting for wallet confirmation");
  const ritualTx = await withRitualGas(tx);
  const txHash = await walletRequest("eth_sendTransaction", [ritualTx]);
  updateActivity(item, label, txHash);
  const receipt = await waitForReceipt(txHash);
  if (receipt.status !== "0x1") {
    const details = await describeFailedTransaction(txHash, ritualTx, receipt);
    const message = details ? `${label} failed: ${txHash}\n${details}` : `${label} failed: ${txHash}`;
    updateActivity(item, `${label} failed`, details || txHash);
    throw new Error(message);
  }
  updateActivity(item, `${label} confirmed`, txHash);
  return txHash;
}

async function deployAndArm() {
  await ensureReady();
  setBusy(true);
  try {
    const preview = await previewAgent({ silent: true });
    if (!preview) return;
    const { harness, saltHash, config, agent } = preview;

    if (state.balanceWei < config.depositWei) {
      throw new Error("Wallet balance is below the configured deposit.");
    }
    if (agent?.exists && agent.configured) {
      logActivity("Deploy skipped", "Agent already configured");
      return;
    }

    const ok = window.confirm(
      `Deploy and arm this Ritual agent?\n\nHarness: ${harness}\nDeposit: ${formatRitual(config.depositWei)}`,
    );
    if (!ok) {
      return;
    }

    const buildItem = logActivity("Build request", "Discovering executor and encoding calldata");
    const { calldata, executor } = await buildConfigureCallData(harness, config);
    updateActivity(buildItem, "Build request ready", executor);

    const code = await getCode(harness);
    if (!code || code === "0x") {
      const deployData = encodeFunctionData({
        abi: FACTORY_ABI,
        functionName: "deployHarness",
        args: [saltHash],
      });
      await sendTransaction("Deploy harness", {
        from: state.account,
        to: FACTORY_ADDRESS,
        data: deployData,
        gas: quantity(DEPLOY_GAS),
      });
    } else {
      logActivity("Deploy harness", "Already on-chain");
    }

    const simulateItem = logActivity("Simulate configure", "eth_call");
    await rpcRequest("eth_call", [
      {
        from: state.account,
        to: harness,
        data: calldata,
        value: quantity(config.depositWei),
        gas: quantity(SCHED_GAS),
      },
      "latest",
    ]);
    updateActivity(simulateItem, "Simulation passed", harness);

    await sendTransaction("Fund and arm", {
      from: state.account,
      to: harness,
      data: calldata,
      value: quantity(config.depositWei),
      gas: quantity(SCHED_GAS),
    });

    await refreshWalletState();
    await previewAgent({ silent: true });
  } finally {
    setBusy(false);
  }
}

async function refreshTarget() {
  const target = elements.targetAgentInput.value.trim() || state.harness;
  if (!target) {
    throw new Error("Agent address is required.");
  }

  state.agent = await fetchAgent(target);
  state.harness = state.agent.address;
  elements.targetAgentInput.value = state.agent.address;
  render();
  logActivity("Agent refreshed", state.agent.address);
  return state.agent;
}

async function topupAgent() {
  await ensureReady();
  setBusy(true);
  try {
    const agent = await refreshTarget();
    if (!agent.exists) {
      throw new Error("Agent is not deployed.");
    }

    const amountWei = parseNativeInput(elements.topupInput.value, "Top up");
    const lockBlocks = parsePositiveBigInt(elements.lockBlocksInput.value, "Lock blocks");
    const ok = window.confirm(`Top up ${agent.address} with ${formatRitual(amountWei)}?`);
    if (!ok) return;

    const data = encodeFunctionData({
      abi: RITUAL_WALLET_ABI,
      functionName: "depositFor",
      args: [agent.address, lockBlocks],
    });
    await sendTransaction("Top up", {
      from: state.account,
      to: RITUAL_WALLET_ADDRESS,
      data,
      value: quantity(amountWei),
    });

    const nextAgent = await fetchAgent(agent.address);
    if (nextAgent.exists && nextAgent.wakeMode === 0) {
      await restartAgent(agent.address, { skipReady: true });
    }

    await refreshWalletState();
    await refreshTarget();
  } finally {
    setBusy(false);
  }
}

async function restartAgent(address = "", options = {}) {
  if (!options.skipReady) {
    await ensureReady();
    setBusy(true);
  }
  try {
    const target = address || elements.targetAgentInput.value.trim() || state.harness;
    if (!isAddress(target)) {
      throw new Error("Agent address is invalid.");
    }

    const data = encodeFunctionData({ abi: HARNESS_ABI, functionName: "restart" });
    await sendTransaction("Restart agent", {
      from: state.account,
      to: getAddress(target),
      data,
      gas: quantity(SCHED_GAS),
    });
    await refreshTarget();
  } finally {
    if (!options.skipReady) {
      setBusy(false);
    }
  }
}

async function stopAgent() {
  await ensureReady();
  setBusy(true);
  try {
    const target = elements.targetAgentInput.value.trim() || state.harness;
    if (!isAddress(target)) {
      throw new Error("Agent address is invalid.");
    }

    const ok = window.confirm(`Stop agent ${getAddress(target)}?`);
    if (!ok) return;

    const data = encodeFunctionData({ abi: HARNESS_ABI, functionName: "stop" });
    await sendTransaction("Stop agent", {
      from: state.account,
      to: getAddress(target),
      data,
      gas: quantity(STOP_GAS),
    });
    await refreshTarget();
  } finally {
    setBusy(false);
  }
}

function nextSalt(salt) {
  const trailing = salt.match(/^(.*[^0-9])([0-9]+)$/);
  if (trailing) {
    return `${trailing[1]}${Number.parseInt(trailing[2], 10) + 1}`;
  }
  if (/^\d+$/.test(salt)) {
    return String(Number.parseInt(salt, 10) + 1);
  }
  return `${salt}-2`;
}

async function scanAgents() {
  await ensureReady();
  setBusy(true);
  try {
    const initialSalt = elements.scanSaltInput.value.trim() || elements.saltInput.value.trim();
    if (!initialSalt) {
      throw new Error("Scan salt is required.");
    }

    elements.scanSaltInput.value = initialSalt;
    saveSettings();

    const agents = [];
    let salt = initialSalt;
    let misses = 0;
    while (misses < 2 && agents.length < 100) {
      const { harness } = await predictHarness(state.account, salt);
      const code = await getCode(harness);
      if (!code || code === "0x") {
        misses += 1;
        salt = nextSalt(salt);
        continue;
      }

      misses = 0;
      const agent = await fetchAgent(harness);
      agents.push({ ...agent, salt });
      salt = nextSalt(salt);
    }

    state.agents = agents;
    if (agents.length) {
      state.agent = agents[0];
      state.harness = agents[0].address;
      elements.targetAgentInput.value = agents[0].address;
      elements.agentLookupInput.value = agents[0].address;
      saveSettings();
    }
    render();
    logActivity("Scan complete", `${agents.length} agent(s)`);
  } finally {
    setBusy(false);
  }
}

async function lookupAgent() {
  await ensureReady();
  setBusy(true);
  try {
    const target = elements.agentLookupInput.value.trim() || elements.targetAgentInput.value.trim() || state.harness;
    if (!isAddress(target)) {
      throw new Error("Agent address is invalid.");
    }

    openExplorerAddress(target);
    const agent = await fetchAgent(target);
    elements.agentLookupInput.value = agent.address;
    elements.targetAgentInput.value = agent.address;
    state.agent = agent;
    state.harness = agent.address;
    state.agents = agent.exists ? [{ ...agent, salt: "Manual address" }] : [];
    saveSettings();
    render();
    logActivity(agent.exists ? "Agent found" : "No agent contract", agent.address);
  } finally {
    setBusy(false);
  }
}

function renderAgents() {
  elements.agentsList.replaceChildren();
  if (!state.agents.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No agents found";
    elements.agentsList.append(empty);
    return;
  }

  state.agents.forEach((agent) => {
    const item = document.createElement("button");
    item.className = "agent-row";
    item.type = "button";
    item.innerHTML = `
      <strong></strong>
      <span data-role="address"></span>
      <span data-role="state"></span>
      <span data-role="balance"></span>
    `;
    item.querySelector("strong").textContent = agent.salt;
    item.querySelector('[data-role="address"]').textContent = agent.address;
    item.querySelector('[data-role="state"]').textContent = getAgentStateLabel(agent);
    item.querySelector('[data-role="balance"]').textContent = formatRitual(agent.balanceWei, 4);
    item.addEventListener("click", () => {
      openExplorerAddress(agent.address);
    });
    elements.agentsList.append(item);
  });
}

function renderActiveTool() {
  elements.toolTabs.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.toolTab === state.activeTool);
  });
  elements.toolPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.toolPanel === state.activeTool);
  });
}

function renderAgent() {
  const agent = state.agent;
  elements.harnessAddress.textContent = state.harness || "-";
  elements.executorAddress.textContent = state.executor || "-";
  elements.agentState.textContent = getAgentStateLabel(agent);
  elements.agentBalance.textContent = agent ? formatRitual(agent.balanceWei) : "-";
  elements.configuredValue.textContent = agent?.exists ? String(agent.configured) : "-";
  elements.wakeModeValue.textContent = agent?.exists ? `${agent.wakeMode}` : "-";
  elements.lockUntilValue.textContent = agent?.lockUntil ? `Block ${agent.lockUntil}` : "-";
}

function render() {
  const connected = Boolean(state.account);
  const onRitual = state.chainId === RITUAL_CHAIN.hex;
  elements.walletAddress.textContent = connected ? shortAddress(state.account) : "-";
  elements.walletBalance.textContent = connected && onRitual ? formatRitual(state.balanceWei) : "-";
  elements.connectButton.textContent = connected ? shortAddress(state.account) : "Connect Wallet";
  elements.connectButton.classList.toggle("is-connected", connected);
  elements.connectButton.setAttribute("aria-expanded", "false");
  elements.walletMenu.hidden = !connected;
  elements.walletMenuAddress.textContent = state.account || "-";
  elements.networkStatus.textContent = connected ? (onRitual ? "Ritual connected" : "Wrong network") : "Not connected";
  elements.networkStatus.classList.toggle("is-ready", connected && onRitual);

  const actionDisabled = state.busy;
  elements.connectButton.disabled = actionDisabled;
  elements.previewButton.disabled = actionDisabled || !connected;
  elements.deployButton.disabled = actionDisabled || !connected;
  elements.refreshTargetButton.disabled = actionDisabled;
  elements.topupButton.disabled = actionDisabled || !connected;
  elements.restartButton.disabled = actionDisabled || !connected;
  elements.stopButton.disabled = actionDisabled || !connected;
  elements.scanButton.disabled = actionDisabled || !connected;
  elements.lookupAgentButton.disabled = actionDisabled || !connected;

  renderActiveTool();
  renderAgent();
  renderAgents();
}

function showError(error) {
  logActivity("Error", error?.message || String(error));
}

function bindUi() {
  elements.connectButton.addEventListener("click", async () => {
    try {
      if (state.account) {
        return;
      }
      await connectWallet();
    } catch (error) {
      showError(error);
    }
  });

  elements.disconnectButton.addEventListener("click", async () => {
    await disconnectWallet();
  });

  elements.previewButton.addEventListener("click", async () => {
    try {
      await ensureReady();
      await previewAgent();
    } catch (error) {
      showError(error);
    }
  });

  elements.deployButton.addEventListener("click", async () => {
    try {
      await deployAndArm();
    } catch (error) {
      showError(error);
    }
  });

  elements.refreshTargetButton.addEventListener("click", async () => {
    try {
      await refreshTarget();
    } catch (error) {
      showError(error);
    }
  });

  elements.topupButton.addEventListener("click", async () => {
    try {
      await topupAgent();
    } catch (error) {
      showError(error);
    }
  });

  elements.restartButton.addEventListener("click", async () => {
    try {
      await restartAgent();
    } catch (error) {
      showError(error);
    }
  });

  elements.stopButton.addEventListener("click", async () => {
    try {
      await stopAgent();
    } catch (error) {
      showError(error);
    }
  });

  elements.scanButton.addEventListener("click", async () => {
    try {
      await scanAgents();
    } catch (error) {
      showError(error);
    }
  });

  elements.lookupAgentButton.addEventListener("click", async () => {
    try {
      await lookupAgent();
    } catch (error) {
      showError(error);
    }
  });

  elements.toolTabs.forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTool = button.dataset.toolTab;
      render();
    });
  });

  [
    elements.promptInput,
    elements.modelInput,
    elements.saltInput,
    elements.scanSaltInput,
    elements.agentLookupInput,
    elements.depositInput,
    elements.lockBlocksInput,
    elements.topupInput,
  ].forEach((input) => {
    input.addEventListener("input", saveSettings);
  });
}

async function hydrateWallet() {
  if (!hasWallet()) {
    render();
    return;
  }

  try {
    const accounts = await walletRequest("eth_accounts");
    state.account = accounts[0] || "";
    state.chainId = await walletRequest("eth_chainId");
    bindWalletEvents();
    await refreshWalletState();
  } catch {
    render();
  }
}

loadSettings();
bindUi();
hydrateWallet();
render();
