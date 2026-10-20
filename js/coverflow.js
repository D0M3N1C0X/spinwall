// Cover Flow: covers laid out in 3D around a floating position `pos`.
// The centred cover faces you; the others turn away on either side.
// Drag, swipe, trackpad, arrow keys and taps all move `pos`, which glides
// to the nearest whole cover.

const VISIBLE = 7; // covers drawn on each side of the centre
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class CoverFlow {
  constructor(stage, { onCenter, onFlip, renderBack }) {
    this.stage = stage;
    this.cb = { onCenter, onFlip, renderBack };
    this.items = [];
    this.els = [];
    this.shades = [];
    this.pos = 0;
    this.target = 0;
    this.center = -1;
    this.flipped = false;
    this.raf = 0;
    this.drag = null;
    this.g = { gap: 200, spacing: 60, angle: 64, depth: 180, dragUnit: 130 };
    this._bind();
    new ResizeObserver(() => { this._measure(); this._layout(); }).observe(stage);
  }

  get count() { return this.items.length; }

  setItems(albums, centerId) {
    this.items = albums;
    this.els = albums.map((a, i) => this._make(a, i));
    this.shades = this.els.map((el) => el.querySelector('.shade'));
    this.stage.replaceChildren(...this.els);
    let idx = centerId ? albums.findIndex((a) => a.id === centerId) : -1;
    if (idx < 0) idx = Math.round(this.pos);
    idx = clamp(idx, 0, Math.max(0, albums.length - 1));
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.pos = this.target = idx;
    this.center = -1;
    this.flipped = false;
    this._measure();
    this._layout();
    this._updateCenter();
  }

  // Refresh the back of the centred cover (e.g. once its play counts change).
  refreshBack() {
    if (this.flipped) this.cb.renderBack(this.els[this.center].querySelector('.back'), this.items[this.center]);
  }

  goTo(i, { instant = false } = {}) {
    if (!this.count) return;
    this.target = clamp(Math.round(i), 0, this.count - 1);
    if (instant || reduceMotion.matches) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.pos = this.target;
      this._layout();
      this._updateCenter();
      return;
    }
    this._animate();
  }

  next() { this.goTo(this.target + 1); }
  prev() { this.goTo(this.target - 1); }

  toggleFlip(force) {
    if (!this.count) return;
    const flip = force ?? !this.flipped;
    if (flip === this.flipped) return;
    const el = this.els[this.center];
    if (flip) this.cb.renderBack(el.querySelector('.back'), this.items[this.center]);
    this.flipped = flip;
    el.classList.toggle('flipped', flip);
    this.cb.onFlip(flip);
  }

  // ---------- internals ----------

  _make(album, i) {
    const el = document.createElement('div');
    el.className = 'cover';
    el.id = `cover-${i}`;
    el.dataset.index = String(i);
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', 'false');
    el.setAttribute('aria-label', `${album.title} by ${album.artist}`);
    const card = document.createElement('div');
    card.className = 'card';
    const front = document.createElement('div');
    front.className = 'face front';
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    img.crossOrigin = 'anonymous';
    img.src = album.artwork;
    const shade = document.createElement('div');
    shade.className = 'shade';
    front.append(img, shade);
    const back = document.createElement('div');
    back.className = 'face back';
    card.append(front, back);
    el.append(card);
    return el;
  }

  _measure() {
    const size = this.els[0]?.offsetWidth || 300;
    this.g = {
      gap: size * 0.7,        // centre → first side cover
      spacing: size * 0.24,   // between side covers
      angle: 64,
      depth: size * 0.62,
      dragUnit: size * 0.42,  // pixels of drag per cover
    };
  }

  _layout() {
    const { gap, spacing, angle, depth } = this.g;
    for (let i = 0; i < this.els.length; i++) {
      const el = this.els[i];
      const d = i - this.pos;
      const ad = Math.abs(d);
      if (ad > VISIBLE) {
        if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden';
        continue;
      }
      el.style.visibility = 'visible';
      const t = Math.min(ad, 1);
      const s = Math.sign(d);
      const x = s * (t * gap + Math.max(ad - 1, 0) * spacing);
      el.style.transform = `translate3d(${x.toFixed(2)}px,0,${(-t * depth).toFixed(2)}px) rotateY(${(-s * t * angle).toFixed(2)}deg)`;
      el.style.zIndex = String(1000 - Math.round(ad * 10));
      el.style.opacity = ad > VISIBLE - 1 ? String(VISIBLE - ad) : '1';
      this.shades[i].style.opacity = String(Math.min(0.2 + ad * 0.08, 0.6) * t);
    }
  }

  _animate() {
    if (this.raf) return;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(now - last, 64);
      last = now;
      const diff = this.target - this.pos;
      if (Math.abs(diff) < 0.001) {
        this.pos = this.target;
        this.raf = 0;
        this._layout();
        this._updateCenter();
        return;
      }
      this.pos += diff * (1 - Math.exp(-dt / 90));
      this._layout();
      this._updateCenter();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  _updateCenter() {
    const c = clamp(Math.round(this.pos), 0, Math.max(0, this.count - 1));
    if (c === this.center || !this.count) return;
    if (this.flipped) this.toggleFlip(false);
    this.els[this.center]?.classList.remove('center');
    this.els[this.center]?.setAttribute('aria-selected', 'false');
    this.center = c;
    this.els[c].classList.add('center');
    this.els[c].setAttribute('aria-selected', 'true');
    this.stage.setAttribute('aria-activedescendant', this.els[c].id);
    this.cb.onCenter(c);
  }

  _stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  _bind() {
    const stage = this.stage;

    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.count) return;
      if (e.target.closest('.back')) return; // the track list scrolls and its links work normally
      this._stop();
      this.drag = {
        id: e.pointerId, x0: e.clientX, y0: e.clientY, pos0: this.pos,
        moved: false, target: e.target, samples: [{ t: e.timeStamp, x: e.clientX }],
      };
    });

    stage.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x0;
      const dy = e.clientY - d.y0;
      if (!d.moved) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { this.drag = null; this.goTo(this.pos); return; }
        if (Math.abs(dx) < 6) return;
        d.moved = true;
        stage.setPointerCapture(d.id);
        this.toggleFlip(false);
      }
      this.pos = clamp(d.pos0 - dx / this.g.dragUnit, -0.45, this.count - 1 + 0.45);
      d.samples.push({ t: e.timeStamp, x: e.clientX });
      while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 100) d.samples.shift();
      this._layout();
      this._updateCenter();
    });

    const end = (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      this.drag = null;
      if (!d.moved) {
        const el = d.target.closest?.('.cover');
        if (!el) { this.goTo(this.pos); return; }
        const i = Number(el.dataset.index);
        if (i === this.center && Math.abs(this.pos - i) < 0.08) {
          this.goTo(i, { instant: true });
          this.toggleFlip();
        } else {
          this.goTo(i);
        }
        return;
      }
      const first = d.samples[0];
      const lastS = d.samples[d.samples.length - 1];
      const dt = Math.max(lastS.t - first.t, 1);
      const velocity = -((lastS.x - first.x) / dt) / this.g.dragUnit; // covers per ms
      this.goTo(this.pos + clamp(velocity * 240, -12, 12));
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      this.drag = null;
      this.goTo(this.pos);
    });

    // Trackpad and Shift + mouse wheel scroll sideways through the covers.
    let wheelTimer = 0;
    stage.addEventListener('wheel', (e) => {
      if (!this.count || e.target.closest('.back')) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
      if (!delta) return;
      e.preventDefault();
      this._stop();
      this.toggleFlip(false);
      const unit = e.deltaMode === 1 ? 0.33 : 1 / (this.g.dragUnit * 1.2);
      this.pos = clamp(this.pos + delta * unit, -0.3, this.count - 1 + 0.3);
      this._layout();
      this._updateCenter();
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => this.goTo(this.pos), 110);
    }, { passive: false });

    stage.addEventListener('keydown', (e) => {
      if (!this.count) return;
      const keys = {
        ArrowRight: () => this.next(),
        ArrowLeft: () => this.prev(),
        Home: () => this.goTo(0),
        End: () => this.goTo(this.count - 1),
        Enter: () => this.toggleFlip(),
        ' ': () => this.toggleFlip(),
        Escape: () => this.toggleFlip(false),
      };
      if (e.target !== stage || !keys[e.key]) return;
      e.preventDefault();
      keys[e.key]();
    });
  }
}
