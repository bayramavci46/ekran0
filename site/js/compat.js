/*
 * Checks, on the visitor's own device, what this browser can do with the editor and says so
 * before they click: fast export (WebCodecs), which formats, saving straight to disk, recording.
 * Nothing is sent anywhere.
 */
(function (root) {
  'use strict';
  const KM = root.KM;

  function browserName() {
    const ua = navigator.userAgent;
    const mobile = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let name = 'Bu tarayıcı';
    if (/Edg\//.test(ua)) name = 'Edge';
    else if (/OPR\//.test(ua)) name = 'Opera';
    else if (/Firefox\//.test(ua) || /FxiOS/.test(ua)) name = 'Firefox';
    else if (/Chrome\//.test(ua) || /CriOS/.test(ua)) name = 'Chrome';
    else if (/Safari\//.test(ua)) name = 'Safari';
    return mobile ? `${name} (iPhone/iPad)` : name;
  }

  async function check() {
    const has = (k) => typeof root[k] === 'function';
    const r = {
      video: has('VideoEncoder') && has('VideoDecoder'),
      audio: has('AudioEncoder') && has('AudioDecoder'),
      h264: false, vp9: false, aac: false, opus: false,
      disk: typeof root.showSaveFilePicker === 'function' && root.self === root.top,
      recorder: has('MediaRecorder'),
      capture: !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function'),
    };
    const v = async (codec) => {
      try {
        return (await root.VideoEncoder.isConfigSupported({ codec, width: 1920, height: 1080, bitrate: 8e6, framerate: 30 })).supported === true;
      } catch (err) {
        return false;
      }
    };
    const a = async (codec) => {
      try {
        return (await root.AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })).supported === true;
      } catch (err) {
        return false;
      }
    };
    if (r.video) [r.h264, r.vp9] = await Promise.all([v('avc1.640028'), v('vp09.00.40.08')]);
    if (r.audio) [r.aac, r.opus] = await Promise.all([a('mp4a.40.2'), a('opus')]);
    return r;
  }

  KM.initCompat = async function () {
    const btn = KM.$('#compatBtn');
    const text = KM.$('#compatText');
    const rows = KM.$('#compatRows');
    const yours = KM.$('#yourBrowser');
    const name = browserName();
    let r;
    try {
      r = await check();
    } catch (err) {
      r = { video: false, audio: false, h264: false, vp9: false, aac: false, opus: false, disk: false, recorder: false, capture: false };
    }
    const fastMp4 = r.h264 && (r.aac || r.opus);
    const fastWebm = r.vp9 && r.opus;
    let tone;
    let summary;
    if (fastMp4) {
      tone = 'ok';
      summary = 'Tarayıcınız hazır · hızlı MP4';
    } else if (fastWebm) {
      tone = 'ok';
      summary = 'Tarayıcınız hazır · hızlı WebM';
    } else if (r.recorder) {
      tone = 'warn';
      summary = 'Çalışır · gerçek zamanlı kayıtla';
    } else {
      tone = 'bad';
      summary = 'Bu tarayıcı dışa aktaramıyor';
    }
    btn.dataset.tone = tone;
    text.textContent = summary;

    const list = [
      ['Hızlı dışa aktarma (WebCodecs)', r.video],
      ['MP4 · H.264 görüntü', r.h264],
      ['AAC ses', r.aac],
      ['WebM · VP9 + Opus', fastWebm],
      ['Doğrudan diske kaydetme', r.disk],
      ['Gerçek zamanlı yedek kayıt', r.recorder],
      ['Ekran ve kamera kaydı', r.capture && r.video && r.audio],
    ];
    rows.textContent = '';
    for (const [label, ok] of list) {
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.dataset.ok = String(!!ok);
      dd.innerHTML = `<svg class="i i-sm" aria-hidden="true"><use href="#${ok ? 'i-check' : 'i-dash'}"/></svg>`;
      dd.append(ok ? 'Var' : 'Yok');
      row.append(dt, dd);
      rows.appendChild(row);
    }
    if (yours) {
      const mode = fastMp4 ? 'hızlı MP4 dışa aktarma' : fastWebm ? 'hızlı WebM dışa aktarma' : r.recorder ? 'gerçek zamanlı kayıt' : 'dışa aktarma yok';
      yours.textContent = `Sizin tarayıcınız: ${name} · ${mode}`;
    }
  };
})(self);
