// Pinch-to-zoom, drag-to-pan, double-tap (touch) / single-click (mouse),
// and trackpad/wheel zoom for the lightbox image. Works with Pointer
// Events so touch and mouse drag/pinch share one code path; trackpad
// gestures come through as wheel events, where browsers set `ctrlKey` on
// an actual pinch specifically to distinguish it from a plain two-finger
// scroll — so ctrlKey wheel = zoom, plain wheel = pan (once zoomed in).
const MIN_SCALE = 1;
const MAX_SCALE = 4;
const CLICK_ZOOM_SCALE = 2;
const DOUBLE_TAP_MS = 300;
const CLICK_ZOOM_TRANSITION_MS = 220;

const SWIPE_THRESHOLD = 50;

export function initZoom(img, { onSwipeLeft, onSwipeRight } = {}) {
  let scale = 1;
  let originX = 0;
  let originY = 0;
  const pointers = new Map();
  let startDist = 0;
  let startScale = 1;
  let panStartX = 0;
  let panStartY = 0;
  let panOriginX = 0;
  let panOriginY = 0;
  let lastTapTime = 0;
  let gestureStartScale = 1;
  let dragStartX = 0;
  let dragStartY = 0;

  img.style.touchAction = "none";
  img.style.transformOrigin = "center center";

  function setTransform() {
    img.style.transform = `translate(${originX}px, ${originY}px) scale(${scale})`;
  }

  // Used only for the discrete click/tap toggle — a brief transition so it
  // eases into place instead of snapping instantly. Continuous gestures
  // (pinch, drag-pan, wheel) call setTransform() directly with no
  // transition, since animating every intermediate frame would lag behind
  // the pointer instead of tracking it live.
  function setTransformAnimated() {
    img.style.transition = `transform ${CLICK_ZOOM_TRANSITION_MS}ms ease`;
    setTransform();
    window.setTimeout(() => {
      img.style.transition = "";
    }, CLICK_ZOOM_TRANSITION_MS);
  }

  function clamp() {
    if (scale <= 1) {
      originX = 0;
      originY = 0;
      return;
    }
    const maxX = (img.clientWidth * (scale - 1)) / 2;
    const maxY = (img.clientHeight * (scale - 1)) / 2;
    originX = Math.min(maxX, Math.max(-maxX, originX));
    originY = Math.min(maxY, Math.max(-maxY, originY));
  }

  function toggleZoom() {
    if (scale > 1) {
      scale = 1;
      originX = 0;
      originY = 0;
      setTransformAnimated();
    } else {
      scale = CLICK_ZOOM_SCALE;
      clamp();
      setTransformAnimated();
    }
  }

  function dist(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
  }

  function reset() {
    scale = 1;
    originX = 0;
    originY = 0;
    setTransform();
  }

  img.addEventListener("pointerdown", (e) => {
    img.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      startDist = dist(p1, p2);
      startScale = scale;
    } else if (pointers.size === 1) {
      panStartX = e.clientX;
      panStartY = e.clientY;
      panOriginX = originX;
      panOriginY = originY;
      gestureStartScale = scale;
      dragStartX = e.clientX;
      dragStartY = e.clientY;

      if (e.pointerType === "touch") {
        const now = Date.now();
        if (now - lastTapTime < DOUBLE_TAP_MS) {
          toggleZoom();
        }
        lastTapTime = now;
      }
    }
  });

  img.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      const newDist = dist(p1, p2);
      scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, startScale * (newDist / startDist)));
      clamp();
      setTransform();
    } else if (pointers.size === 1 && scale > 1) {
      originX = panOriginX + (e.clientX - panStartX);
      originY = panOriginY + (e.clientY - panStartY);
      clamp();
      setTransform();
    }
  });

  function handlePointerUp(e) {
    if (pointers.size === 1) {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      const moved = Math.hypot(dx, dy);

      // A mouse click with negligible movement toggles zoom — matches the
      // zoom-in/zoom-out cursor shown over the image. Touch keeps the
      // separate double-tap detector above instead, since a plain tap is
      // also how the lightbox itself gets opened/closed elsewhere.
      if (e.pointerType === "mouse" && moved < 5) {
        toggleZoom();
      } else if (
        gestureStartScale === 1 &&
        scale === 1 &&
        Math.abs(dx) > SWIPE_THRESHOLD &&
        Math.abs(dx) > Math.abs(dy) * 1.5
      ) {
        if (dx < 0) onSwipeLeft?.();
        else onSwipeRight?.();
      }
    }
    pointers.delete(e.pointerId);
  }

  function endPointer(e) {
    pointers.delete(e.pointerId);
  }
  img.addEventListener("pointerup", handlePointerUp);
  img.addEventListener("pointercancel", endPointer);
  img.addEventListener("pointerleave", endPointer);

  img.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();

      if (e.ctrlKey) {
        // A real pinch on a trackpad (or ctrl+wheel) — browsers set ctrlKey
        // specifically to flag this as a zoom gesture, not a scroll.
        scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale - e.deltaY * 0.006));
        clamp();
        setTransform();
      } else if (scale > 1) {
        // Plain two-finger trackpad drag while zoomed in — pan instead.
        originX -= e.deltaX;
        originY -= e.deltaY;
        clamp();
        setTransform();
      }
    },
    { passive: false }
  );

  return { reset };
}
