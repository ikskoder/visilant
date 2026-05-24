import { describe, expect, it } from 'vitest'
import {
  hasNotifiedOnThisPage,
  isIgnored,
  linkInterceptData,
  linkInterceptResolve,
  linkInterceptVisible,
  linkTooltipData,
  linkTooltipVisible,
  onTooltipHoverEnter,
  onTooltipHoverLeave,
  safetyLevel,
  setOnTooltipHoverEnter,
  setOnTooltipHoverLeave,
  showWarning,
  warningType,
} from '../ui-state'

describe('ui-state reactive refs', () => {
  it('showWarning defaults to false', () => {
    expect(showWarning.value).toBe(false)
  })

  it('warningType defaults to input', () => {
    expect(warningType.value).toBe('input')
  })

  it('safetyLevel defaults to null', () => {
    expect(safetyLevel.value).toBeNull()
  })

  it('isIgnored defaults to false', () => {
    expect(isIgnored.value).toBe(false)
  })

  it('hasNotifiedOnThisPage defaults to false', () => {
    expect(hasNotifiedOnThisPage.value).toBe(false)
  })

  it('linkTooltipVisible defaults to false', () => {
    expect(linkTooltipVisible.value).toBe(false)
  })

  it('linkTooltipData defaults to null', () => {
    expect(linkTooltipData.value).toBeNull()
  })

  it('linkInterceptVisible defaults to false', () => {
    expect(linkInterceptVisible.value).toBe(false)
  })

  it('linkInterceptData defaults to null', () => {
    expect(linkInterceptData.value).toBeNull()
  })

  it('linkInterceptResolve defaults to null', () => {
    expect(linkInterceptResolve.value).toBeNull()
  })
})

describe('tooltip hover callbacks', () => {
  it('setOnTooltipHoverEnter sets the callback', () => {
    const fn = () => {}
    setOnTooltipHoverEnter(fn)
    expect(onTooltipHoverEnter.fn).toBe(fn)
  })

  it('setOnTooltipHoverLeave sets the callback', () => {
    const fn = () => {}
    setOnTooltipHoverLeave(fn)
    expect(onTooltipHoverLeave.fn).toBe(fn)
  })
})

describe('reactive state mutations', () => {
  it('can toggle showWarning', () => {
    showWarning.value = true
    expect(showWarning.value).toBe(true)
    showWarning.value = false
    expect(showWarning.value).toBe(false)
  })

  it('can set warningType', () => {
    warningType.value = 'copy'
    expect(warningType.value).toBe('copy')
    warningType.value = 'input'
    expect(warningType.value).toBe('input')
  })

  it('can set safetyLevel', () => {
    safetyLevel.value = true
    expect(safetyLevel.value).toBe(true)
    safetyLevel.value = false
    expect(safetyLevel.value).toBe(false)
    safetyLevel.value = null
    expect(safetyLevel.value).toBeNull()
  })

  it('can set linkTooltipData', () => {
    linkTooltipData.value = {
      domain: 'example.com',
      count: 5,
      isSafe: false,
      mismatch: null,
      punycode: null,
      anchorRect: { top: 0, bottom: 10, left: 0, right: 100 },
      href: 'https://example.com',
    }
    expect(linkTooltipData.value!.domain).toBe('example.com')
    expect(linkTooltipData.value!.count).toBe(5)
    linkTooltipData.value = null
  })

  it('can set linkInterceptResolve and call it', () => {
    let resolved = false
    linkInterceptResolve.value = (proceed: boolean) => {
      resolved = proceed
    }
    linkInterceptResolve.value!(true)
    expect(resolved).toBe(true)
    linkInterceptResolve.value = null
  })
})
