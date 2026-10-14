// Runs inside the catalogue page that gallery.ts writes: the contents that
// follow the scroll, the search box, the copy buttons and the full screen view.
(function () {
  const nav = document.querySelector('.toc')
  const cards = Array.from(document.querySelectorAll('main .card'))
  const search = document.querySelector('nav input[type=search]')
  const onlyBad = document.querySelector('input[data-only-bad]')
  const searching = () => Boolean(search.value.trim()) || onlyBad?.checked
  const lightbox = document.getElementById('lb')
  const caseLinks = new Map(Array.from(nav.querySelectorAll('.cases a')).map(a => [a.getAttribute('href').slice(1), a]))
  const store = {
    get(key) {
      try {
        return localStorage.getItem(key)
      }
      catch {
        return null
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value)
      }
      catch {
        // Only a convenience
      }
    },
  }

  // ---------- Columns ----------
  for (const box of document.querySelectorAll('input[data-column]')) {
    const column = box.dataset.column
    box.checked = store.get(`hide-${column}`) !== '1'
    document.body.classList.toggle(`hide-${column}`, !box.checked)
    box.addEventListener('change', () => {
      document.body.classList.toggle(`hide-${column}`, !box.checked)
      store.set(`hide-${column}`, box.checked ? '0' : '1')
    })
  }

  // ---------- Copy ----------
  function copyText(text, button) {
    const done = () => {
      if (!button)
        return
      button.dataset.label ??= button.textContent
      button.classList.add('done')
      button.textContent = 'Copied'
      clearTimeout(button.copyTimer)
      button.copyTimer = setTimeout(() => {
        button.classList.remove('done')
        button.textContent = button.dataset.label
      }, 1200)
    }
    const fallback = () => {
      const area = document.createElement('textarea')
      area.value = text
      document.body.appendChild(area)
      area.select()
      const copied = document.execCommand('copy')
      area.remove()
      if (copied)
        done()
      else if (button)
        button.textContent = 'Copy failed'
    }
    if (navigator.clipboard?.writeText)
      navigator.clipboard.writeText(text).then(done, fallback)
    else
      fallback()
  }

  const cardLabel = (card, project) => `[shot ${card.id}${project ? ` · ${project}` : ''}] ${card.dataset.title}`

  document.addEventListener('click', (event) => {
    const button = event.target.closest('main button.copy')
    if (button)
      copyText(cardLabel(button.closest('.card')), button)
  })

  // ---------- Contents follow the scroll ----------
  let activeCard = null
  function setActive(card) {
    if (card === activeCard)
      return
    activeCard?.id && caseLinks.get(activeCard.id)?.classList.remove('active')
    activeCard = card
    for (const topic of nav.querySelectorAll('.topic.current'))
      topic.classList.remove('current')
    if (!card)
      return
    const link = caseLinks.get(card.id)
    if (!link)
      return
    link.classList.add('active')
    const topic = link.closest('.topic')
    topic.classList.add('current')
    if (!searching()) {
      for (const other of nav.querySelectorAll('.topic.open')) {
        if (other !== topic && !other.classList.contains('pinned'))
          other.classList.remove('open')
      }
      topic.classList.add('open')
    }
    // Kept in sight inside the contents, without moving the page itself
    const top = link.offsetTop - nav.offsetTop
    if (top < nav.scrollTop + 40 || top > nav.scrollTop + nav.clientHeight - 60)
      nav.scrollTop = top - nav.clientHeight / 3
  }

  function onScroll() {
    const visible = cards.filter(c => !c.classList.contains('filtered-out'))
    // The last card whose top has passed a line near the top of the window
    let lo = 0
    let hi = visible.length - 1
    let found = visible[0] ?? null
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (visible[mid].getBoundingClientRect().top <= 120) {
        found = visible[mid]
        lo = mid + 1
      }
      else {
        hi = mid - 1
      }
    }
    setActive(found)
  }
  let scheduled = false
  window.addEventListener('scroll', () => {
    if (scheduled)
      return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      onScroll()
    })
  }, { passive: true })

  // A topic opened by hand stays open while the page scrolls elsewhere
  nav.addEventListener('click', (event) => {
    const link = event.target.closest('a.t-link')
    if (!link)
      return
    const topic = link.closest('.topic')
    const wasOpen = topic.classList.contains('open')
    if (wasOpen && topic.classList.contains('current')) {
      event.preventDefault()
      topic.classList.remove('open', 'pinned')
      return
    }
    topic.classList.add('open', 'pinned')
  })

  // ---------- Search ----------
  function applyFilter() {
    const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
    for (const card of cards) {
      const hay = card.dataset.search
      const show = words.every(w => hay.includes(w)) && (!onlyBad?.checked || card.classList.contains('bad'))
      card.classList.toggle('filtered-out', !show)
      caseLinks.get(card.id)?.classList.toggle('filtered-out', !show)
    }
    for (const topic of document.querySelectorAll('.topic, main section[data-topic]')) {
      const id = topic.dataset.topic
      const any = cards.some(c => c.dataset.topicId === id && !c.classList.contains('filtered-out'))
      topic.classList.toggle('filtered-out', !any)
      if (topic.classList.contains('topic'))
        topic.classList.toggle('open', searching() ? any : topic.classList.contains('current') || topic.classList.contains('pinned'))
    }
    for (const group of document.querySelectorAll('.surface, main > section[data-surface]')) {
      const id = group.dataset.surface
      group.classList.toggle('filtered-out', !cards.some(c => c.dataset.surfaceId === id && !c.classList.contains('filtered-out')))
    }
    onScroll()
  }
  search.addEventListener('input', applyFilter)
  onlyBad?.addEventListener('change', applyFilter)
  document.querySelector('.missing')?.addEventListener('click', () => {
    onlyBad.checked = true
    applyFilter()
    window.scrollTo(0, 0)
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && lightbox.hidden && document.activeElement !== search) {
      event.preventDefault()
      search.focus()
    }
  })

  // ---------- Full screen view ----------
  const lbImg = lightbox.querySelector('.stage img')
  const lbStage = lightbox.querySelector('.stage')
  let current = null

  /** Every picture that can be seen right now, in page order. */
  const pictures = () => Array.from(document.querySelectorAll('main figure a.shot')).filter(a => a.offsetParent !== null)

  function show(link) {
    current = link
    const card = link.closest('.card')
    const project = link.dataset.project
    lightbox.dataset.mode = 'fit'
    lbImg.onload = () => {
      lightbox.dataset.mode = fitMode()
      lightbox.dataset.zoomable = String(fitMode() !== 'natural')
    }
    lbImg.src = link.getAttribute('href')
    lbStage.scrollTo(0, 0)
    lightbox.querySelector('h4').textContent = card.dataset.title
    const note = lightbox.querySelector('.note')
    note.textContent = card.querySelector('.note')?.textContent ?? ''
    note.hidden = !note.textContent
    lightbox.querySelector('code').textContent = card.id
    lightbox.querySelector('.proj').textContent = project
    const all = pictures()
    lightbox.querySelector('.pos').textContent = `${all.indexOf(link) + 1} / ${all.length}`
    lightbox.querySelector('.where').textContent = `${card.dataset.surfaceName} › ${card.dataset.topicName}`
    history.replaceState(null, '', `#${card.id}@${project}`)
  }

  function open(link) {
    lightbox.hidden = false
    document.body.style.overflow = 'hidden'
    show(link)
  }

  function close() {
    lightbox.hidden = true
    document.body.style.overflow = ''
    const card = current?.closest('.card')
    if (card) {
      history.replaceState(null, '', `#${card.id}`)
      const rect = card.getBoundingClientRect()
      if (rect.top < 0 || rect.top > window.innerHeight - 80)
        card.scrollIntoView({ block: 'start' })
    }
  }

  function step(by) {
    const all = pictures()
    const next = all[all.indexOf(current) + by]
    if (next)
      show(next)
  }

  /** The same column in the case before or after. */
  function stepCase(by) {
    const all = pictures()
    const card = current.closest('.card')
    const project = current.dataset.project
    let i = all.indexOf(current)
    while (true) {
      i += by
      const candidate = all[i]
      if (!candidate)
        return
      if (candidate.closest('.card') === card)
        continue
      const target = candidate.closest('.card')
      const same = Array.from(target.querySelectorAll('a.shot')).find(a => a.dataset.project === project && a.offsetParent !== null)
      show(same ?? candidate)
      return
    }
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest('main a.shot')
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return
    event.preventDefault()
    open(link)
  })
  lightbox.querySelector('.prev').addEventListener('click', () => step(-1))
  lightbox.querySelector('.next').addEventListener('click', () => step(1))
  lightbox.querySelector('.close').addEventListener('click', close)
  lightbox.querySelector('button.copy').addEventListener('click', (event) => {
    copyText(cardLabel(current.closest('.card'), current.dataset.project), event.currentTarget)
  })
  /**
   * How a picture first opens. Never stretched past its own size. One that
   * fits the window keeps its size, a tall one like a whole settings page fills
   * the width and scrolls, since squeezing it to the height leaves nothing to
   * read, and anything else shrinks to fit.
   */
  function fitMode() {
    const box = lbStage.getBoundingClientRect()
    const width = box.width - 128
    const height = box.height - 24
    const { naturalWidth: w, naturalHeight: h } = lbImg
    if (w <= width && h <= height)
      return 'natural'
    return Math.min(width / w, height / h) < 0.5 ? 'width' : 'fit'
  }
  window.addEventListener('resize', () => {
    if (!lightbox.hidden && lbImg.complete && lightbox.dataset.mode !== 'natural')
      lightbox.dataset.mode = fitMode()
  })
  lbImg.addEventListener('click', () => {
    if (lightbox.dataset.zoomable === 'true')
      lightbox.dataset.mode = lightbox.dataset.mode === 'natural' ? fitMode() : 'natural'
  })
  lbStage.addEventListener('click', (event) => {
    if (event.target === lbStage)
      close()
  })
  document.addEventListener('keydown', (event) => {
    if (lightbox.hidden || event.ctrlKey || event.metaKey || event.altKey)
      return
    const keys = {
      ArrowLeft: () => step(-1),
      ArrowRight: () => step(1),
      ArrowUp: () => stepCase(-1),
      ArrowDown: () => stepCase(1),
      Escape: close,
      c: () => lightbox.querySelector('button.copy').click(),
      z: () => lbImg.click(),
    }
    const action = keys[event.key]
    if (action) {
      event.preventDefault()
      action()
    }
  })

  // A link to one picture opens it again, so a reload keeps the place
  let hash = ''
  try {
    hash = decodeURIComponent(location.hash.slice(1))
  }
  catch {
    // A mangled link, start at the top
  }
  const [id, project] = hash.split('@')
  const card = id && document.getElementById(id)
  applyFilter()
  if (card) {
    card.scrollIntoView({ block: 'start' })
    const link = project && Array.from(card.querySelectorAll('a.shot')).find(a => a.dataset.project === project && a.offsetParent !== null)
    if (link)
      open(link)
  }
  onScroll()
})()
