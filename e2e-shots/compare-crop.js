// Draws one side of a before/after pair for compare.html: the part of the
// picture around what changed, at its own size or a little bigger, with the
// changed rows marked. The data comes from compare.ts.
window.Crop = (() => {
  const MARGIN = 90

  /** The part of one picture to show: around every change on either side. */
  function region(c, w, h, whole) {
    const all = [...c.before, ...c.after]
    if (whole || !all.length)
      return { x: 0, y: 0, w, h }
    let y0 = Math.max(0, Math.min(...all.map(b => b[0])) - MARGIN)
    let y1 = Math.min(h, Math.max(...all.map(b => b[1])) + MARGIN)
    if (y1 <= y0) {
      y0 = 0
      y1 = h
    }
    let x0 = 0
    let x1 = w
    if (w > 700) {
      // The whole width of the extension's box, so a row keeps its label
      x0 = Math.max(0, (c.box ? c.box[0] : Math.min(...all.map(b => b[2]))) - 28)
      x1 = Math.min(w, (c.box ? c.box[1] : Math.max(...all.map(b => b[3]))) + 28)
      if (x1 - x0 < 460) {
        x0 = Math.max(0, Math.round((x0 + x1) / 2 - 230))
        x1 = Math.min(w, x0 + 460)
      }
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  }

  function side(c, which, available, whole, onOpen) {
    const before = which === 'before'
    const w = before ? c.bw : c.aw
    const h = before ? c.bh : c.ah
    const r = region(c, w, h, whole)
    // As drawn, shrunk to fit the column, and a small cut-out made bigger
    const scale = Math.min(available / r.w, r.h < 320 ? 1.6 : 1)
    const box = document.createElement('div')
    box.className = 'frame'
    box.style.width = `${Math.round(r.w * scale)}px`
    box.style.height = `${Math.round(r.h * scale)}px`
    const crop = document.createElement('div')
    crop.className = 'crop'
    crop.style.width = `${r.w}px`
    crop.style.height = `${r.h}px`
    crop.style.transform = `scale(${scale})`
    const img = document.createElement('img')
    img.loading = 'lazy'
    img.src = `${before ? 'before-run' : 'after-run'}/${c.col}/${c.name}.png`
    img.width = w
    img.height = h
    img.style.left = `${-r.x}px`
    img.style.top = `${-r.y}px`
    crop.append(img)
    for (const [y0, y1, x0, x1] of before ? c.before : c.after) {
      const m = document.createElement('div')
      m.className = `mark ${before ? 'gone' : 'came'}`
      m.style.left = `${x0 - r.x}px`
      m.style.top = `${y0 - r.y - 1}px`
      m.style.width = `${x1 - x0}px`
      m.style.height = `${y1 - y0 + 2}px`
      crop.append(m)
    }
    box.append(crop)
    box.addEventListener('click', () => onOpen(`before-run/${c.col}/${c.name}.png`, `after-run/${c.col}/${c.name}.png`))
    return box
  }

  return { side }
})()
