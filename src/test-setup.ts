import { vi } from 'vitest'

// Mock webextension-polyfill for unit tests running outside browser extension context
vi.mock('webextension-polyfill', () => {
  const mock = {
    storage: {
      sync: {
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
