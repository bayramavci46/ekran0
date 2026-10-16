/*
 * Downloads: works out which system the visitor is on, puts that card first with a "Bu cihaz
 * için" badge, and turns the hero's second button into a direct download (Windows, Mac,
 * Android) or into the way to the iPhone/iPad card. Other systems keep the button pointing at
 * the download section.
 */
(function (root) {
  'use strict';
  const KM = root.KM;
  const LATEST = 'https://github.com/bayramavci46/ekran0/releases/latest/download/';
  const FILES = { win: 'Kurgu-Masasi-Windows.exe', mac: 'Kurgu-Masasi-Mac.dmg', android: 'Kurgu-Masasi-Android.apk' };
  const LABELS = { win: 'Windows için indir', mac: 'Mac için indir', android: 'Android için indir', ios: 'Ana ekrana ekle' };

  function system() {
    const nav = root.navigator;
    const platform = (nav.userAgentData && nav.userAgentData.platform) || nav.platform || '';
    const ua = nav.userAgent || '';
    if (/Android/i.test(ua)) return 'android';
    // iPadOS reports itself as a Mac; the touch screen gives it away.
    if (/iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(platform) && nav.maxTouchPoints > 1)) return 'ios';
    if (/Win/i.test(platform) || /Windows/i.test(ua)) return 'win';
    if (/Mac/i.test(platform) || /Macintosh/i.test(ua)) return 'mac';
    return null;
  }

  KM.initDownload = function () {
    const os = system();
    if (!os) return;
    const card = KM.$(`.dl-card[data-os="${os}"]`);
    if (card) {
      card.classList.add('is-recommended');
      KM.$('.dl-badge', card).hidden = false;
    }
    const hero = KM.$('#heroDownload');
    if (!hero) return;
    KM.$('#heroDownloadText').textContent = LABELS[os];
    if (FILES[os]) {
      hero.href = LATEST + FILES[os];
      hero.target = '_blank';
      hero.rel = 'noopener';
    } else {
      hero.href = '#dlIosTitle';
    }
  };
})(self);
