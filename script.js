/* ==========================================================================
   Hero focus carousel — plain vanilla JS, no globals, no top-level state.

   Usage:  initFocusCarousel(rootElement, { start: 1, thumbs: thumbsEl });
   Markup: root contains .hero-track with N .hero-slide children.
           Thumbnail buttons are generated into opts.thumbs (one per slide),
           reusing each slide's image; they replace the old pagination dots.
           Whenever the active slide is committed, a "slidechange" CustomEvent
           is dispatched on root with detail { index, slide }.
   ========================================================================== */
(function () {
  'use strict';

  /* The one place the order-button label is defined.
     Change it later (e.g. to `Add ${name} to my box`) and every slide follows. */
  const CTA_TEXT = (name) => `Order ${name}`;

  function initFocusCarousel(root, options) {
    /* Flip to true to enable wraparound: distances are then computed
       modulo the slide count so the nearest wrapped position is used. */
    var LOOP = false;

    var SWIPE_PX  = 50;   // min px of travel that counts as a swipe
    var CLICK_PX  = 5;    // more px than this = drag, not a click

    var opts   = options || {};
    var slides = Array.prototype.slice.call(root.querySelectorAll('.hero-slide'));
    var n      = slides.length;
    if (!n) return;

    var index      = clampInt(opts.start || 0);
    var step       = 1;     // px distance between adjacent slide centers
    var dragging   = false;
    var pointerId  = null;
    var startX     = 0;
    var startIdx   = 0;
    var lastDx     = 0;
    var maxDragPx  = 0;
    var lastActive = -1;    // last committed active index we announced

    function clampInt(i) { return Math.min(Math.max(i, 0), n - 1); }

    /* ---- Thumbnails (one per slide, built from each slide's own image) ----
       They live in an external container (opts.thumbs) so a press on a thumb
       is never inside the carousel and can't start a swipe. */
    var thumbsEl = opts.thumbs || document.querySelector('.hero-thumbs');
    var thumbButtons = [];
    if (thumbsEl) {
      slides.forEach(function (slide, i) {
        var flavor = slide.getAttribute('data-flavor') || ('slide ' + (i + 1));
        var srcImg = slide.querySelector('img');

        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'hero-thumb';
        b.setAttribute('aria-label', 'Show ' + flavor);

        var img = document.createElement('img');
        img.alt = '';
        img.setAttribute('draggable', 'false');
        if (srcImg) img.src = srcImg.getAttribute('src');
        // missing cutout → the button paints a small rounded oat square
        var markMissing = function () { b.classList.add('hero-thumb-missing'); };
        img.addEventListener('error', markMissing);
        if (img.complete && img.naturalWidth === 0) markMissing();

        b.appendChild(img);
        b.addEventListener('click', function () { goTo(i); });
        thumbsEl.appendChild(b);
        thumbButtons.push(b);
      });
    }

    /* Paint the aria-current "active" state on the thumbnails. Driven by the
       committed active index (commitActive), never mid-drag. */
    function setActiveThumb(ai) {
      thumbButtons.forEach(function (b, i) {
        if (i === ai) b.setAttribute('aria-current', 'true');
        else b.removeAttribute('aria-current');
      });
    }

    /* ---- Measurement (ResizeObserver, no window resize listener) ---- */
    function measure() {
      // offsetWidth ignores the scale transform (rect width would shrink
      // while the slide sits at 65% as a neighbor)
      var w = slides[0].offsetWidth || 1;
      step = w * 0.95;
    }

    /* ---- Rendering ----
       Each slide is placed by its signed distance d from the center.
       d is fractional while dragging, so scale/opacity interpolate smoothly. */
    function render() {
      slides.forEach(function (s, i) {
        var d = i - index;
        if (LOOP) d = wrapNearest(d);          // nearest wrapped distance
        var ad = Math.abs(d);

        var scale, opacity;
        if (ad <= 1) {                          // center + immediate neighbors
          scale   = 1 - 0.35 * ad;              // 1 → 0.65
          opacity = 1 - 0.5  * ad;              // 1 → 0.5
        } else {                                // farther: fade to 0 by 1.5 so
          scale   = 0.65;                       // the handoff is seamless, but
          opacity = Math.max(0, 1.5 - ad);      // still hidden (0) beyond that,
        }                                       // parked off-side to slide in

        s.style.transform =
          'translate(-50%, -50%) translateX(' + (d * step) + 'px) scale(' + scale + ')';
        s.style.opacity = opacity;
        s.style.pointerEvents = opacity === 0 ? 'none' : 'auto';
        s.setAttribute('aria-hidden', opacity === 0 ? 'true' : 'false');
      });

      var ai = ((Math.round(index) % n) + n) % n;
      slides.forEach(function (s, i) {
        s.classList.toggle('hero-active', i === ai);
      });
    }

    /* Nearest equivalent of d in [-n/2, n/2) — makes looping pick the
       short way around, which is what keeps 4 slides looking correct. */
    function wrapNearest(d) {
      return d - n * Math.round(d / n);
    }

    /* ---- Announce the committed active slide ----
       Called only on committed navigation (goTo) and once on init — never
       mid-drag — so listeners (the info block) don't churn during a swipe. */
    function commitActive(force) {
      var ai = ((Math.round(index) % n) + n) % n;
      if (!force && ai === lastActive) return;   // nothing changed
      lastActive = ai;
      setActiveThumb(ai);                        // thumbnails follow the commit
      root.dispatchEvent(new CustomEvent('slidechange', {
        bubbles: true,
        detail: { index: ai, slide: slides[ai] }
      }));
    }

    /* ---- Navigation ---- */
    function goTo(i) {
      root.classList.remove('hero-dragging');   // re-enable snap transitions
      if (LOOP) {
        // keep index continuous across the wrap so the transition is short
        index += wrapNearest(i - index);
      } else {
        index = clampInt(i);
      }
      render();
      commitActive(false);                      // committed → safe to update info
    }

    /* ---- Drag / swipe (Pointer Events: one path for mouse, touch, pen) ---- */
    root.addEventListener('pointerdown', function (e) {
      // never start a drag from the thumbnails — they handle their own clicks
      if (e.target.closest && e.target.closest('.hero-thumbs')) return;
      if (dragging) return;

      dragging  = true;
      pointerId = e.pointerId;
      startX    = e.clientX;
      startIdx  = index;
      lastDx    = 0;
      maxDragPx = 0;

      // capture so we keep receiving move/up even if the pointer leaves the root
      root.setPointerCapture(e.pointerId);
      // .hero-dragging kills transitions: slides must follow the finger 1:1
      root.classList.add('hero-dragging');
    });

    root.addEventListener('pointermove', function (e) {
      if (!dragging || e.pointerId !== pointerId) return;
      var dx = e.clientX - startX;
      lastDx = dx;
      if (Math.abs(dx) > maxDragPx) maxDragPx = Math.abs(dx);

      // fractional index: moving the finger left by `step` px == one slide over
      index = startIdx - dx / step;

      if (!LOOP) {
        // soft clamp at the ends — slight rubber-band, no hard stop
        index = Math.min(Math.max(index, -0.35), n - 1 + 0.35);
      }
      render();
    });

    root.addEventListener('pointerup', endDrag);
    root.addEventListener('pointercancel', function (e) {
      if (!dragging || e.pointerId !== pointerId) return;
      stopDragState();
      goTo(Math.round(startIdx));               // cancelled: return to start
    });

    function endDrag(e) {
      if (!dragging || e.pointerId !== pointerId) return;
      stopDragState();

      var target;
      if (maxDragPx <= SWIPE_PX) {
        target = Math.round(startIdx);          // below threshold: snap back
      } else {
        target = Math.round(index);             // above: nearest slide...
        if (target === Math.round(startIdx)) {
          // ...but a committed swipe always advances at least one slide
          target = Math.round(startIdx) + (lastDx < 0 ? 1 : -1);
        }
      }
      goTo(target);
    }

    function stopDragState() {
      dragging  = false;
      pointerId = null;
      root.classList.remove('hero-dragging');
    }

    /* ---- Click a side slide to bring it to center ---- */
    slides.forEach(function (s, i) {
      s.addEventListener('click', function () {
        if (maxDragPx > CLICK_PX) return;       // it was a drag, not a click
        goTo(i);
      });
    });

    /* ---- Keyboard: only while the carousel itself has focus ----
       (listener lives on the root, never window/document, so page-level
       arrow scrolling elsewhere is untouched) */
    root.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft')       { e.preventDefault(); goTo(Math.round(index) - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goTo(Math.round(index) + 1); }
    });

    /* ---- Resize handling ---- */
    var ro = new ResizeObserver(function () { measure(); render(); });
    ro.observe(root);

    measure();
    render();
    commitActive(true);                          // announce the starting slide
  }

  /* ==========================================================================
     Flavor info block — mirrors the active slide's data-* attributes into the
     name / description / order CTA. Listens for the carousel's "slidechange".
     No window or document listeners of its own.
     ========================================================================== */
  function initHeroInfo(root, info) {
    if (!root || !info) return;

    var nameEl  = info.querySelector('.hero-info-name-text');
    var priceEl = info.querySelector('.hero-info-price');
    var descEl  = info.querySelector('.hero-info-desc');
    var ctaEl   = info.querySelector('.hero-cta');
    var labelEl = info.querySelector('.hero-cta-label');

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var swapToken = 0;    // bump to cancel a pending swap when slides change fast
    var first = true;     // the init paint is instant (no fade), avoids a flicker

    function readData(slide) {
      var d = slide.dataset;
      return {
        name:  d.flavor || '',
        desc:  d.desc   || '',
        order: d.order  || '#order',
        price: d.price  || ''          // empty string = no price
      };
    }

    function paint(data) {
      if (nameEl)  nameEl.textContent  = data.name;
      if (descEl)  descEl.textContent  = data.desc;   // aria-live: only set once settled
      if (labelEl) labelEl.textContent = CTA_TEXT(data.name);
      if (ctaEl)   ctaEl.setAttribute('href', data.order);
      if (priceEl) {
        priceEl.textContent = data.price;
        priceEl.hidden = !data.price;
      }
    }

    function update(slide) {
      var data = readData(slide);

      // Reduced motion (or the very first paint): swap instantly, no animation.
      if (reduceMotion.matches || first) {
        first = false;
        swapToken++;                 // cancel any in-flight animated swap
        info.classList.remove('hero-info-out');
        paint(data);
        return;
      }

      var token = ++swapToken;       // this swap's id; a newer one supersedes it
      info.classList.add('hero-info-out');          // fade/slide out (~150ms)
      setTimeout(function () {
        if (token !== swapToken) return;            // cancelled by a newer swap
        paint(data);
        info.classList.remove('hero-info-out');      // fade/slide back in (~300ms)
      }, 150);
    }

    root.addEventListener('slidechange', function (e) {
      update(e.detail.slide);
    });
  }

  /* ==========================================================================
     Slide-in menu — self-contained, no globals.
     The scroll lock below is the only page-level behavior the hero touches.
     ========================================================================== */
  function initSlideMenu(btn, panel, overlay) {
    var closeBtn = panel.querySelector('.hero-panel-close');

    function open() {
      panel.removeAttribute('inert');
      panel.classList.add('is-open');
      overlay.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      document.documentElement.style.overflow = 'hidden'; // scroll lock
      closeBtn.focus();
    }

    function close() {
      panel.classList.remove('is-open');
      overlay.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      document.documentElement.style.overflow = '';       // always released
      panel.setAttribute('inert', '');
      btn.focus();
    }

    btn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', close);

    // clicking any menu link navigates and closes the panel
    panel.querySelectorAll('a[href]').forEach(function (a) {
      a.addEventListener('click', close);
    });

    /* Escape + focus trap live on the PANEL, never window/document:
       focus is moved inside the panel on open, so it always receives keys. */
    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;

      var f = panel.querySelectorAll('a[href], button:not([disabled])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();                 // wrap backwards
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();                // wrap forwards
      }
    });
  }

  /* ---- Boot ---- */
  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('hero-carousel');
    var info = document.querySelector('.hero-info');
    var thumbs = document.querySelector('.hero-thumbs');

    // Attach the info listener BEFORE the carousel inits, so it receives the
    // initial "slidechange" the carousel dispatches on startup.
    if (root) initHeroInfo(root, info);
    if (root) initFocusCarousel(root, { start: 1, thumbs: thumbs });

    var menuBtn = document.querySelector('.hero-menu-btn');
    var panel   = document.getElementById('hero-panel');
    var overlay = document.querySelector('.hero-overlay');
    if (menuBtn && panel && overlay) initSlideMenu(menuBtn, panel, overlay);

    // Placeholder fallback while the real cupcake cutouts don't exist yet:
    // a failed <img> marks its slide so CSS can paint the flavor-name plate.
    // Check .complete too — on file:// the error often fires before this runs.
    if (root) {
      root.querySelectorAll('.hero-slide img').forEach(function (img) {
        var mark = function () {
          img.closest('.hero-slide').classList.add('hero-img-missing');
        };
        if (img.complete && img.naturalWidth === 0) mark();
        else img.addEventListener('error', mark);
      });
    }
  });
})();
