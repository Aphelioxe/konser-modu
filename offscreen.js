'use strict';

/**
 * Offscreen belgesi: sekme sesini yakalar ve Web Audio grafiğine verir.
 * MV3 servis çalışanı Web Audio çalıştıramadığı için zorunlu katman.
 */

let session = null;

function notify(message) {
  chrome.runtime
    .sendMessage({ target: 'background', ...message })
    .catch(() => {});
}

function teardown() {
  if (!session) return;
  const old = session;
  session = null;

  try {
    old.track.removeEventListener('ended', old.onEnded);
  } catch (_) {
    /* yok say */
  }

  try {
    old.stream.getTracks().forEach((track) => track.stop());
  } catch (_) {
    /* akış zaten kapanmış olabilir */
  }

  try {
    old.source.disconnect();
  } catch (_) {
    /* yok say */
  }

  try {
    old.engine.dispose();
  } catch (_) {
    /* yok say */
  }

  if (old.ctx && old.ctx.state !== 'closed') {
    old.ctx.close().catch(() => {});
  }
}

function friendlyMediaError(error) {
  const name = error?.name || '';
  if (name === 'NotAllowedError' || /permission/i.test(name)) {
    return 'Ses yakalama izni alınamadı. Uzantı simgesine tıklayıp yeniden deneyin.';
  }
  if (name === 'NotFoundError') {
    return 'Sekmede yakalanacak ses akışı bulunamadı.';
  }
  if (name === 'NotSupportedError' || /constraint/i.test(name)) {
    return 'Bu sayfanın sesi yakalanamıyor.';
  }
  return String(error?.message || error || 'Sekme sesi yakalanamadı.');
}

async function startCapture(message) {
  if (!message?.streamId) throw new Error('Ses akışı kimliği eksik.');
  if (session) teardown();

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: message.streamId,
        },
      },
      video: false,
    });
  } catch (error) {
    throw new Error(friendlyMediaError(error));
  }

  const track = stream.getAudioTracks()[0];
  if (!track) {
    stream.getTracks().forEach((item) => item.stop());
    throw new Error('Sekmede ses akışı bulunamadı.');
  }

  let ctx = null;
  try {
    if (typeof globalThis.ConcertEngine !== 'function') {
      throw new Error('Ses motoru yüklenemedi.');
    }

    ctx = new AudioContext({ latencyHint: 'playback' });
    const engine = new ConcertEngine(ctx, message.settings);
    const source = ctx.createMediaStreamSource(stream);
    source.connect(engine.input);

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const onEnded = () => {
      const wasRunning = Boolean(session);
      teardown();
      if (wasRunning) notify({ type: 'captureEnded' });
    };
    track.addEventListener('ended', onEnded);

    session = { stream, track, ctx, engine, source, onEnded };

    return {
      ok: true,
      sampleRate: ctx.sampleRate,
      preset: engine.settings.preset,
      intensity: engine.settings.intensity,
    };
  } catch (error) {
    try {
      stream.getTracks().forEach((item) => item.stop());
    } catch (_) {
      /* yok say */
    }
    if (ctx && ctx.state !== 'closed') {
      ctx.close().catch(() => {});
    }
    throw new Error(friendlyMediaError(error));
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') return undefined;

  if (message.type === 'start') {
    startCapture(message)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({ ok: false, error: String(error?.message || error) })
      );
    return true;
  }

  if (message.type === 'update') {
    try {
      if (session) session.engine.applySettings(message.settings);
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: String(error?.message || error) });
    }
    return false;
  }

  if (message.type === 'stop') {
    teardown();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'ping') {
    sendResponse({ ok: true, running: Boolean(session) });
    return false;
  }

  return undefined;
});
