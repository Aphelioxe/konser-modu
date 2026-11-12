'use strict';

const PRESET_META = {
  hall: { name: 'Konser Salonu', tail: '≈ 2,9 sn yankı' },
  stadium: { name: 'Stadyum', tail: '≈ 4,1 sn yankı' },
  stage: { name: 'Küçük Sahne', tail: '≈ 1,5 sn yankı' },
};

const DEFAULT_SETTINGS = { preset: 'hall', intensity: 70 };
const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

const byId = (id) => document.getElementById(id);

const els = {
  power: byId('power'),
  stop: byId('stop'),
  move: byId('move'),
  slider: byId('intensity'),
  sliderValue: byId('intensity-value'),
  presetMeta: byId('preset-meta'),
  presetButtons: Array.from(document.querySelectorAll('.preset')),
  kicker: byId('kicker'),
  statusTitle: byId('status-title'),
  statusSub: byId('status-sub'),
  targetImg: byId('target-img'),
  targetInitial: byId('target-initial'),
  targetLabel: byId('target-label'),
  targetTitle: byId('target-title'),
  notice: byId('notice'),
  noticeText: byId('notice-text'),
  noticeClose: byId('notice-close'),
};

const ui = {
  settings: { ...DEFAULT_SETTINGS },
  active: false,
  tabId: null,
  tabTitle: '',
  tabUrl: '',
  startedAt: 0,
  currentTab: null,
  supported: false,
  busy: false,
  busyAction: null,
  loading: true,
  notice: '',
  faviconSrc: null,
};

let saveTimer = null;
let settingsDirty = false;
let lastSettingsSentAt = 0;

/* Yardımcılar */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sanitizeSettings(input) {
  const preset = PRESET_META[input?.preset] ? input.preset : DEFAULT_SETTINGS.preset;
  let intensity = Number(input?.intensity);
  if (!Number.isFinite(intensity)) intensity = DEFAULT_SETTINGS.intensity;
  return {
    preset,
    intensity: clamp(Math.round(intensity), 0, 100),
  };
}

function isCapturable(url = '') {
  try {
    const parsed = new URL(url);
    if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) return false;
    if (parsed.hostname === 'chromewebstore.google.com') return false;
    if (
      parsed.hostname === 'chrome.google.com' &&
      parsed.pathname.startsWith('/webstore')
    ) {
      return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

function hostOf(url = '') {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return 'yerel dosya';
    return parsed.hostname.replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

function initialOf(title = '') {
  const first = String(title).trim().charAt(0);
  return first ? first.toLocaleUpperCase('tr') : '?';
}

function isActiveHere() {
  return ui.active && ui.currentTab?.id != null && ui.tabId === ui.currentTab.id;
}

function isActiveElsewhere() {
  return ui.active && !isActiveHere();
}

function friendlySendError(error) {
  const text = String(error?.message || error || '');
  if (/Extension context invalidated/i.test(text)) {
    return 'Uzantı yeniden yüklendi. Popup’ı kapatıp yeniden açın.';
  }
  if (/Receiving end|Could not establish|message port closed/i.test(text)) {
    return 'Arka plan servisine ulaşılamadı. Uzantıyı yenileyip tekrar deneyin.';
  }
  return text || 'Beklenmeyen bir hata oluştu.';
}

async function sendMessage(payload) {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    throw new Error('Chrome uzantı ortamı gerekli.');
  }
  return chrome.runtime.sendMessage({ target: 'background', ...payload });
}

function presentError(message) {
  ui.notice = message || '';
  renderNotice();
}

/* Görünüm */

function renderStatus() {
  const activeHere = isActiveHere();
  const activeElsewhere = isActiveElsewhere();
  const meta = PRESET_META[ui.settings.preset] || PRESET_META.hall;

  document.body.classList.toggle('active', ui.active);
  document.body.classList.toggle('active-here', activeHere);
  document.body.classList.toggle('active-elsewhere', activeElsewhere);
  document.body.classList.toggle('busy', ui.busy || ui.loading);
  document.body.classList.toggle('unsupported', !ui.supported);

  els.power.setAttribute('aria-checked', activeHere ? 'true' : 'false');
  els.power.disabled =
    ui.loading || ui.busy || (!activeHere && !ui.supported);
  els.power.title = ui.loading
    ? 'Durum yükleniyor…'
    : activeHere
      ? 'Konser modunu kapat'
      : activeElsewhere
        ? ui.supported
          ? 'Efekti bu sekmeye taşı'
          : 'Bu sayfada kullanılamaz'
        : ui.supported
          ? 'Konser modunu aç'
          : 'Bu sayfada kullanılamaz';

  els.stop.hidden = !activeElsewhere || ui.busy || ui.loading;
  els.move.hidden = !(activeElsewhere && ui.supported) || ui.busy || ui.loading;

  if (ui.loading) {
    els.kicker.textContent = 'BAĞLANIYOR';
    els.statusTitle.textContent = 'Durum alınıyor…';
    els.statusSub.textContent = 'Konser Modu hazırlanıyor.';
    return;
  }

  if (ui.busy) {
    const stopping = ui.busyAction === 'stop';
    els.kicker.textContent = stopping ? 'DURDURULUYOR' : 'HAZIRLANIYOR';
    els.statusTitle.textContent = stopping
      ? 'Yankı kapatılıyor…'
      : 'Ses motoru başlatılıyor…';
    els.statusSub.textContent = stopping
      ? 'Sekme sesi normal çıkışa dönüyor.'
      : 'Konser salonu kuruluyor, bir an sürer.';
    return;
  }

  if (ui.active) {
    if (activeHere) {
      els.kicker.textContent = 'CANLI';
      els.statusTitle.textContent = 'Konser modu açık';
      els.statusSub.textContent = `${meta.name} · %${ui.settings.intensity} yoğunluk`;
    } else {
      els.kicker.textContent = 'BAŞKA SEKMEDE';
      els.statusTitle.textContent = 'Konser modu başka sekmede';
      els.statusSub.textContent = ui.supported
        ? 'Sesi bu sekmeye taşıyabilirsin.'
        : 'Durdurmak için hedef satırındaki × düğmesini kullan.';
    }
    return;
  }

  if (!ui.supported) {
    els.kicker.textContent = 'DESTEKLENMİYOR';
    els.statusTitle.textContent = 'Bu sayfada çalışmaz';
    els.statusSub.textContent =
      'Chrome iç sayfaları yakalanamaz. Normal bir web sekmesi açın.';
    return;
  }

  els.kicker.textContent = 'HAZIR';
  els.statusTitle.textContent = 'Konser modu kapalı';
  els.statusSub.textContent = 'Sesinize salon derinliği katın.';
}

function renderTarget() {
  const activeHere = isActiveHere();
  let tab;

  if (ui.active) {
    tab =
      activeHere && ui.currentTab
        ? ui.currentTab
        : { title: ui.tabTitle, url: ui.tabUrl, favIconUrl: '' };
  } else {
    tab = ui.currentTab;
  }

  const title =
    tab?.title || (ui.active ? 'İşlenen sekme' : 'Başlıksız sekme');
  const url = tab?.url || '';
  const host = hostOf(url);

  let label;
  if (ui.active) {
    label = activeHere ? 'BU SEKME · CANLI' : 'İŞLENEN SEKME';
  } else {
    label = 'BU SEKME';
  }
  if (host) label += ` · ${host}`;

  els.targetLabel.textContent = label;
  els.targetTitle.textContent = title;
  els.targetTitle.title = url ? `${title}\n${url}` : title;
  els.targetInitial.textContent = initialOf(title);

  const favicon = !ui.active || activeHere ? tab?.favIconUrl || '' : '';
  updateFavicon(favicon);
}

function updateFavicon(rawUrl) {
  let src = rawUrl || '';
  if (src && !/^(https?:|data:image\/|chrome-extension:)/i.test(src)) {
    src = '';
  }

  if (ui.faviconSrc === src) return;
  ui.faviconSrc = src;

  if (!src) {
    els.targetImg.onload = null;
    els.targetImg.onerror = null;
    els.targetImg.hidden = true;
    els.targetImg.removeAttribute('src');
    els.targetInitial.hidden = false;
    return;
  }

  els.targetImg.hidden = true;
  els.targetInitial.hidden = false;
  els.targetImg.referrerPolicy = 'no-referrer';
  els.targetImg.onload = () => {
    els.targetImg.hidden = false;
    els.targetInitial.hidden = true;
  };
  els.targetImg.onerror = () => {
    els.targetImg.hidden = true;
    els.targetInitial.hidden = false;
  };
  els.targetImg.src = src;
}

function updateSliderVisual() {
  const value = clamp(Math.round(ui.settings.intensity), 0, 100);
  if (Number(els.slider.value) !== value) {
    els.slider.value = String(value);
  }
  els.slider.style.setProperty('--fill', `${value}%`);
  els.sliderValue.textContent = `${value}%`;
}

function renderControls() {
  const disabled = ui.busy || ui.loading;
  els.slider.disabled = disabled;
  for (const button of els.presetButtons) button.disabled = disabled;
  updateSliderVisual();
}

function renderPresets() {
  for (const button of els.presetButtons) {
    const selected = button.dataset.preset === ui.settings.preset;
    button.setAttribute('aria-checked', selected ? 'true' : 'false');
  }
  els.presetMeta.textContent =
    PRESET_META[ui.settings.preset]?.tail || PRESET_META.hall.tail;
}

function renderNotice() {
  els.notice.hidden = !ui.notice;
  els.noticeText.textContent = ui.notice || '';
}

function render() {
  renderStatus();
  renderTarget();
  renderControls();
  renderPresets();
  renderNotice();
}

/* Durum */

function applyState(state, { adoptSettings = true } = {}) {
  if (!state || state.ok === false) return;

  ui.active = Boolean(state.active);
  ui.tabId = Number.isInteger(state.tabId) ? state.tabId : null;
  ui.tabTitle = typeof state.tabTitle === 'string' ? state.tabTitle : '';
  ui.tabUrl = typeof state.tabUrl === 'string' ? state.tabUrl : '';
  ui.startedAt = Number(state.startedAt) || 0;

  if (adoptSettings && state.settings) {
    ui.settings = sanitizeSettings(state.settings);
  }
  if (state.lastError) {
    ui.notice = state.lastError;
  }
}

/* Ayar kaydetme */

function scheduleSettingsSave(delayMs = 90) {
  settingsDirty = true;
  clearTimeout(saveTimer);
  const elapsed = Date.now() - lastSettingsSentAt;
  const wait = Math.max(0, delayMs - elapsed);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void sendSettings();
  }, wait);
}

function flushSettingsSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (settingsDirty) void sendSettings();
}

function saveSettingsImmediately() {
  settingsDirty = true;
  flushSettingsSave();
}

async function sendSettings() {
  if (!settingsDirty) return;
  settingsDirty = false;
  lastSettingsSentAt = Date.now();
  const snapshot = { ...ui.settings };

  try {
    const response = await sendMessage({
      type: 'updateSettings',
      settings: snapshot,
    });
    if (!response?.ok) {
      presentError(response?.error || 'Ayarlar kaydedilemedi.');
    }
  } catch (error) {
    presentError(`Ayar kaydedilemedi: ${friendlySendError(error)}`);
  }
}

/* Eylemler */

function unsupportedMessage() {
  return 'Bu sayfada ses yakalanamıyor. Chrome iç sayfaları ve uzantı sayfaları desteklenmez; normal bir web sekmesi açın.';
}

async function startHere() {
  if (ui.busy || ui.loading) return;
  if (!ui.currentTab?.id || !ui.supported || !isCapturable(ui.currentTab.url)) {
    presentError(unsupportedMessage());
    return;
  }

  ui.busy = true;
  ui.busyAction = 'start';
  ui.notice = '';
  render();

  try {
    const response = await sendMessage({
      type: 'start',
      tabId: ui.currentTab.id,
      settings: ui.settings,
    });

    if (!response?.ok) {
      presentError(response?.error || 'Konser modu başlatılamadı.');
      return;
    }
    applyState(response, { adoptSettings: false });
  } catch (error) {
    presentError(friendlySendError(error));
  } finally {
    ui.busy = false;
    ui.busyAction = null;
    render();
  }
}

async function stopEffect() {
  if (ui.busy || ui.loading) return;

  ui.busy = true;
  ui.busyAction = 'stop';
  ui.notice = '';
  render();

  try {
    const response = await sendMessage({ type: 'stop' });
    if (!response?.ok) {
      presentError(response?.error || 'Konser modu durdurulamadı.');
      return;
    }
    applyState(response, { adoptSettings: false });
  } catch (error) {
    presentError(friendlySendError(error));
  } finally {
    ui.busy = false;
    ui.busyAction = null;
    render();
  }
}

function onPowerClick() {
  if (ui.busy || ui.loading) return;
  if (isActiveHere()) {
    void stopEffect();
    return;
  }
  if (ui.supported) void startHere();
}

function onIntensityInput() {
  const value = clamp(Math.round(Number(els.slider.value) || 0), 0, 100);
  ui.settings = { ...ui.settings, intensity: value };
  updateSliderVisual();
  renderStatus();
  scheduleSettingsSave(90);
}

function onPresetClick(event) {
  const preset = event.currentTarget.dataset.preset;
  if (!PRESET_META[preset] || ui.busy || ui.loading) return;
  if (ui.settings.preset === preset) return;

  ui.settings = { ...ui.settings, preset };
  renderPresets();
  renderStatus();
  saveSettingsImmediately();
}

function onRuntimeMessage(message) {
  if (!message || message.target !== 'popup' || message.type !== 'stateChanged') {
    return;
  }
  const state = message.state;
  if (!state?.ok) return;

  applyState(state, { adoptSettings: false });
  render();
}

/* Başlangıç */

function bindEvents() {
  els.power.addEventListener('click', onPowerClick);
  els.stop.addEventListener('click', stopEffect);
  els.move.addEventListener('click', startHere);

  els.slider.addEventListener('input', onIntensityInput);
  els.slider.addEventListener('change', flushSettingsSave);

  for (const button of els.presetButtons) {
    button.addEventListener('click', onPresetClick);
  }

  els.noticeClose.addEventListener('click', () => {
    ui.notice = '';
    renderNotice();
  });

  if (globalThis.chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
  }
}

async function init() {
  bindEvents();
  render();

  if (!globalThis.chrome?.runtime?.id) {
    ui.loading = false;
    presentError('Chrome uzantı ortamı gerekli. Eklentiyi Chrome üzerinden açın.');
    render();
    return;
  }

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    ui.currentTab = tabs?.[0] || null;
    ui.supported = isCapturable(ui.currentTab?.url);

    const response = await sendMessage({ type: 'getState' });
    if (!response?.ok) {
      throw new Error(response?.error || 'Durum alınamadı.');
    }

    applyState(response);
    if (response.lastError) ui.notice = response.lastError;
  } catch (error) {
    ui.supported = isCapturable(ui.currentTab?.url);
    presentError(friendlySendError(error));
  } finally {
    ui.loading = false;
    render();
  }
}

void init();
