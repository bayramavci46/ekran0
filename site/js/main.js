/* Starts the website: three stages, navigation, the browser check and the feature demos. */
(function (root) {
  'use strict';
  const KM = root.KM;

  // Hero: a playing recording with a camera window you can move right away.
  const heroTc = KM.$('#heroTc');
  const hint = KM.$('#heroHint');
  const hero = new KM.Stage(KM.$('[data-stage="hero"]'), {
    live: true,
    onChange: () => hint.classList.add('is-done'),
    onTick: (p) => {
      const text = KM.timecode(p * 260);
      if (heroTc.textContent !== text) heroTc.textContent = text;
    },
  });
  hero.preset('ders');
  hero.seek(0.36);
  KM.segmented(KM.$('#presetSeg'), (name) => hero.preset(name));
  KM.observe(hero.root, (visible) => {
    if (visible && !document.hidden) hero.play();
    else hero.pause();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hero.pause();
  });

  KM.initHow(new KM.Stage(KM.$('[data-stage="how"]'), { live: false }));
  KM.initFeatures(new KM.Stage(KM.$('[data-stage="shape"]'), { live: true, timeline: false }));
  const end = new KM.Stage(KM.$('[data-stage="end"]'), { live: false, timeline: false });
  end.preset('ders');
  KM.initNav();
  KM.popover(KM.$('#compatBtn'), KM.$('#compatPop'));
  KM.initCompat();
  KM.initDownload();
  KM.accordion(KM.$('#faqList'));
})(self);
