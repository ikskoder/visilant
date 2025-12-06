import type { ProtocolWithReturn } from 'webext-bridge'
import type { Settings } from './src/logic/storage'

declare module 'webextension-polyfill' {
  namespace Manifest {
    interface FirefoxSpecificProperties {
      data_collection_permissions?: {
        required?: string[]
        optional?: string[]
      }
    }
  }
}

declare module 'webext-bridge' {
  export interface ProtocolMap {
    // define message protocol types
    // see https://github.com/antfu/webext-bridge#type-safe-protocols
    'get-current-tab': ProtocolWithReturn<{ tabId: number }, { title?: string }>
    'get-visit-count': ProtocolWithReturn<{ url: string }, { count: number, hostname: string, lastSeen: number, ignored: boolean }>
    'show-notification': ProtocolWithReturn<{ warningType: 'input' | 'copy' }, string>
    'ignore-site': ProtocolWithReturn<{ hostname: string }, string>
    'get-settings': ProtocolWithReturn<Record<string, never>, Settings>
  }
}
