'use strict';

/**
 * Konser Modu — arka plan servisi (Manifest V3)
 *
 * Sekme sesi yakalama akışı:
 *   popup → service worker → tabCapture.getMediaStreamId()
 *          → offscreen document → Web Audio → hoparlör
 *
 * Servis çalışanı Web Audio kullanamadığı için ses grafiği offscreen.html
 * içinde çalışır. Durum chrome.storage.session, ayarlar chrome.storage.local
 * üzerinde tutulur; böylece popup kapansa da efekt devam eder.
 */

const OFFSCREEN_URL = 'offscreen.html';
const STATE_KEY = 'concertState';
const SETTINGS_KEY = 'settings';
const PRESET_IDS = ['hall', 'stadium', 'stage'];
const DEFAULT_SETTINGS = { preset: 'hall', intensity: 70 };
const BADGE_ON = 'ON';
const BADGE_COLOR = '#7c3aed';
const BADGE_ERROR_COLOR = '#dc2626';

const EMPTY_STATE = {
  active: false,
  tabId: null,
  tabTitle: '',
  tabUrl: '',
  startedAt: 0,
  lastError: '',
};

/** start/stop gibi işlemleri sıraya koyar; yarış koşullarını önler. */
let queue = Promise.resolve();

function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.then(
    () => {},
    () => {}
  );
  return run;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeSettings(input) {
  const preset = PRESET_IDS.includes(input?.preset)
    ? input.preset
    : DEFAULT_SETTINGS.preset;
  let intensity = Number(input?.intensity);
  if (!Number.isFinite(intensity)) intensity = DEFAULT_SETTINGS.intensity;
  intensity = Math.round(Math.min(100, Math.max(0, intensity)));
  return { preset, intensity };
}

async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return sanitizeSettings(stored?.[SETTINGS_KEY] ?? DEFAULT_SETTINGS);
}

async function saveSettings(input) {
  const settings = sanitizeSettings(input);
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
}

async function readState() {
  const stored = await chrome.storage.session.get(STATE_KEY);
  const raw = stored?.[STATE_KEY];
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STATE };
  return { ...EMPTY_STATE, ...raw };
}

async function writeState(patch) {
  const state = { ...(await readState()), ...patch };
  await chrome.storage.session.set({ [STATE_KEY]: state });
  return state;
}

async function buildPayload() {
  const [state, settings] = await Promise.all([readState(), getSettings()]);
  return {
    ok: true,
    active: state.active,
    tabId: state.tabId,
    tabTitle: state.tabTitle,
    tabUrl: state.tabUrl,
    startedAt: state.startedAt,
    lastError: state.lastError,
    settings,
    version: chrome.runtime.getManifest().version,
  };
}

async function setBadge(active) {
  await chrome.action.setBadgeText({ text: active ? BADGE_ON : '' });
  if (active) {
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    await chrome.action.setTitle({ title: 'Konser Modu — açık' });
  } else {
    await chrome.action.setTitle({ title: 'Konser Modu' });
  }
}

async function flashErrorBadge() {
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_ERROR_COLOR });
  await chrome.action.setBadgeText({ text: '!' });
  setTimeout(async () => {
    try {
      const state = await readState();
      await setBadge(state.active);
    } catch (_) {
      /* servis çalışanı kapanmış olabilir */
    }
  }, 5000);
}

async function clearState() {
  const state = await writeState({
    active: false,
    tabId: null,
    tabTitle: '',
    tabUrl: '',
    startedAt: 0,
    lastError: '',
  });
  await setBadge(false);
  return state;
}

function broadcast(payload) {
  // Popup açık değilse alıcı olmayabilir; hata yok sayılır.
  chrome.runtime
    .sendMessage({ target: 'popup', type: 'stateChanged', state: payload })
    .catch(() => {});
}

function isCapturable(url = '') {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) return false;
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

function describeError(error) {
  const raw = String(error?.message || error || '');
  if (raw === 'UNSUPPORTED_PAGE') {
    return 'Bu sayfanın sesi yakalanamıyor. Chrome iç sayfaları, uzantı sayfaları ve Chrome Web Store desteklenmez.';
  }
  if (/NotAllowedError|Permission denied|permission dismissed/i.test(raw)) {
    return 'Ses yakalama izni alınamadı. Uzantı simgesine tıklayıp yeniden deneyin.';
  }
  if (/activeTab|not (?:been )?invoked|must be invoked/i.test(raw)) {
    return 'Ses yakalamak için uzantı simgesine tıklayarak yeniden deneyin.';
  }
  if (/Receiving end|Could not establish|message port closed/i.test(raw)) {
    return 'Ses motoru hazırlanamadı. Uzantıyı yenileyip tekrar deneyin.';
  }
  if (/capture|stream|getUserMedia|tab/i.test(raw)) {
    return 'Sekme sesi yakalanamadı. Sayfayı yenileyip tekrar deneyin.';
  }
  return raw || 'Beklenmeyen bir hata oluştu.';
}

async function recordError(message) {
  const previous = await readState();
  await writeState({ lastError: message });
  if (previous.active) {
    await setBadge(true);
  } else {
    await flashErrorBadge();
  }
  broadcast(await buildPayload());
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
      justification:
        'Sekme sesini gerçek zamanlı işleyip konser salonu yankısı eklemek için.',
    });
  } catch (error) {
    // Paralel bir çağrı belgeyi zaten oluşturmuş olabilir.
    const text = String(error?.message || error);
    if (/already|exist/i.test(text)) return;
    throw error;
  }
}

async function closeOffscreen() {
  try {
    if (await chrome.offscreen.hasDocument()) {
      await chrome.offscreen.closeDocument();
    }
  } catch (_) {
    /* belge zaten kapalıysa yok say */
  }
}

/**
 * Offscreen belgesi yeni oluşturulduğunda betiği henüz mesaj dinlemiyor
 * olabilir; bu yüzden bağlantı kurulana kadar kısa aralıklarla deniyoruz.
 * Stream kimliği yalnızca bir kez kullanılabilir, bu yüzden mesaj aynen
 * yeniden gönderilir.
 */
async function sendToOffscreen(message, retries = 0) {
  const payload = { target: 'offscreen', ...message };
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await chrome.runtime.sendMessage(payload);
    } catch (error) {
      lastError = error;
      const text = String(error?.message || error);
      const noReceiver = /Receiving end|Could not establish|message port closed/i.test(
        text
      );
      if (!noReceiver || attempt === retries) throw error;
      await delay(80);
    }
  }

  throw lastError || new Error('Ses motoruna ulaşılamadı.');
}

async function stopCaptureCore() {
  try {
    await sendToOffscreen({ type: 'stop' }, 3);
  } catch (_) {
    /* motor zaten kapanmış olabilir */
  }
  await closeOffscreen();
  await clearState();
  return buildPayload();
}

async function startCapture(tabId, settingsInput) {
  if (!Number.isInteger(tabId)) throw new Error('Geçersiz sekme kimliği.');

  const settings = sanitizeSettings(settingsInput);
  const tab = await chrome.tabs.get(tabId);
  if (!isCapturable(tab.url)) throw new Error('UNSUPPORTED_PAGE');

  // Farklı bir sekmede açık efekt varsa önce onu kapat.
  await stopCaptureCore();
  await ensureOffscreen();

  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId,
    });
  } catch (error) {
    // Izın/activeTab hatasında açık kalan offscreen belgesini temizle.
    await closeOffscreen();
    throw error;
  }

  let response;
  try {
    response = await sendToOffscreen(
      { type: 'start', streamId, settings },
      25
    );
  } catch (error) {
    await closeOffscreen();
    throw error;
  }

  if (!response?.ok) {
    await closeOffscreen();
    throw new Error(response?.error || 'Ses motoru başlatılamadı.');
  }

  await writeState({
    active: true,
    tabId,
    tabTitle: tab.title || '',
    tabUrl: tab.url || '',
    startedAt: Date.now(),
    lastError: '',
  });
  await saveSettings(settings);
  await setBadge(true);

  const payload = await buildPayload();
  broadcast(payload);
  return payload;
}

async function updateSettings(input) {
  const previous = await getSettings();
  const settings = await saveSettings(input);
  const state = await readState();

  if (
    state.active &&
    (previous.preset !== settings.preset ||
      previous.intensity !== settings.intensity)
  ) {
    try {
      await sendToOffscreen({ type: 'update', settings }, 2);
    } catch (_) {
      // Motor bir an meşgul olabilir; ayar yine de kaydedildi.
    }
  }

  return buildPayload();
}

/** Popup'tan gelen mesajlar. */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'background') return undefined;

  const respond = (promise) => {
    promise.then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: describeError(error) });
    });
  };

  switch (message.type) {
    case 'getState':
      respond(enqueue(buildPayload));
      return true;

    case 'start':
      respond(
        enqueue(async () => {
          try {
            return await startCapture(message.tabId, message.settings);
          } catch (error) {
            const friendly = describeError(error);
            await recordError(friendly);
            return { ok: false, error: friendly };
          }
        })
      );
      return true;

    case 'stop':
      respond(
        enqueue(async () => {
          try {
            const payload = await stopCaptureCore();
            broadcast(payload);
            return payload;
          } catch (error) {
            return { ok: false, error: describeError(error) };
          }
        })
      );
      return true;

    case 'updateSettings':
      respond(enqueue(() => updateSettings(message.settings)));
      return true;

    case 'captureEnded':
      enqueue(async () => {
        const state = await readState();
        if (!state.active) {
          await closeOffscreen();
          return;
        }
        const payload = await stopCaptureCore();
        broadcast(payload);
      }).catch(() => {});
      return false;

    case 'captureError':
      enqueue(async () => {
        const friendly = describeError(message.error);
        await stopCaptureCore();
        await recordError(friendly);
      }).catch(() => {});
      return false;

    default:
      return undefined;
  }
});

/** Alt+Shift+C ile aç/kapat. */
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-concert') return;

  enqueue(async () => {
    const state = await readState();
    if (state.active) {
      const payload = await stopCaptureCore();
      broadcast(payload);
      return;
    }

    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (!tab?.id) return;

    const settings = await getSettings();
    await startCapture(tab.id, settings);
  }).catch(async (error) => {
    const friendly = describeError(error);
    await recordError(friendly);
  });
});

/** Efekt açıkken sekme kapatılırsa sesi ve durumu temizle. */
chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(async () => {
    const state = await readState();
    if (!state.active || state.tabId !== tabId) return;
    const payload = await stopCaptureCore();
    broadcast(payload);
  }).catch(() => {});
});

/** Tarayıcı/uzantı yeniden başladığında eski durumu temizle. */
function resetOnLaunch() {
  enqueue(async () => {
    await closeOffscreen();
    await clearState();
  }).catch(() => {});
}

chrome.runtime.onStartup.addListener(resetOnLaunch);

chrome.runtime.onInstalled.addListener((details) => {
  enqueue(async () => {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    if (!stored?.[SETTINGS_KEY]) {
      await saveSettings(DEFAULT_SETTINGS);
    }
    await closeOffscreen();
    await clearState();
    if (details.reason === 'install') {
      await chrome.storage.session.set({
        [STATE_KEY]: {
          ...EMPTY_STATE,
          lastError: '',
        },
      });
    }
  }).catch(() => {});
});

/**
 * Servis çalışanı her uyandığında oturum durumunu offscreen belgesiyle
 * karşılaştır. Belge yoksa (tarayıcı yeniden başladı, uzantı yenilendi)
 * durumu "kapalı"ya çek.
 */
enqueue(async () => {
  const state = await readState();
  if (state.active) {
    const hasDocument = await chrome.offscreen.hasDocument().catch(() => false);
    if (!hasDocument) {
      await clearState();
      return;
    }
    await setBadge(true);
  } else {
    await setBadge(false);
  }
}).catch(() => {});
