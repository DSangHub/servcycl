(() => {
  const ad = document.getElementById('footer-google-ad');
  const slot = ad?.dataset.adSlot;
  // Paste the numeric data-ad-slot from this site's AdSense display ad unit.
  // Do not send an invalid ad request while the slot is unconfigured.
  if (!slot || !/^\d+$/.test(slot)) return;
  ad.hidden = false;
  (window.adsbygoogle = window.adsbygoogle || []).push({});
})();
