// Pinch-to-zoom, drag-to-pan, double-tap/double-click, and scroll-wheel
// zoom for the lightbox image. Works with Pointer Events so touch, mouse,
// and trackpad all go through the same code path.
const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_MS = 300;

export function initZoom(img) {
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

  img.style.touchAction = "none";
  img.style.transformOrigin = "center center";

  function setTransform() {
    img.style.transform = `translate(${originX}px, ${originY}px) scale(${scale})`;
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
      reset();
    } else {
      scale = 2.5;
      clamp();
      setTransform();
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

  function endPointer(e) {
    pointers.delete(e.pointerId);
  }
  img.addEventListener("pointerup", endPointer);
  img.addEventListener("pointercancel", endPointer);
  img.addEventListener("pointerleave", endPointer);

  img.addEventListener("dblclick", toggleZoom);

  img.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale - e.deltaY * 0.0015));
      clamp();
      setTransform();
    },
    { passive: false }
  );

  return { reset };
}
