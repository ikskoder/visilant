import { vi } from 'vitest'

// Polyfill ResizeObserver for jsdom (not available natively)
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
}

// jsdom has no matchMedia, and useTheme asks it for the system colour scheme
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as any
}

// Stub fetch for chrome-extension:// URLs (useI18n tries to load translations)
const _origFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input?.url ?? ''
  if (url.startsWith('chrome-extension://')) {
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return _origFetch(input, init)
}) as typeof fetch

// Mock webextension-polyfill for unit tests running outside browser extension context
vi.mock('webextension-polyfill', () => {
  const mock = {
    storage: {
      sync: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
      // Visit records and the one-off migration flags live here
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    runtime: {
      getURL: vi.fn((path: string) => `chrome-extension://mock-id/${path}`),
      id: 'mock-extension-id',
      // A desktop answer by default. The Android one is what a few tests set.
      getPlatformInfo: vi.fn().mockResolvedValue({ os: 'linux', arch: 'x86-64' }),
    },
    action: {
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
      setIcon: vi.fn().mockResolvedValue(undefined),
    },
    tabs: {
      query: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
    notifications: {
      create: vi.fn().mockResolvedValue(''),
    },
    contextMenus: {
      create: vi.fn(),
      removeAll: vi.fn().mockResolvedValue(undefined),
      onClicked: {
        addListener: vi.fn(),
      },
    },
  }
  return { ...mock, default: mock }
})
