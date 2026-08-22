import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import App from '../App.vue'

describe('in-page app root', () => {
  /**
   * `color` is inherited, and inheritance crosses the shadow boundary. Without a
   * colour of its own the app took the host page's, so on a page whose text is
   * near black every uncoloured line in the tooltip rendered invisibly against
   * the dark card.
   */
  it('paints its own text colour instead of inheriting the page one', () => {
    // The template comment above the root is a node of its own, so the root
    // element is reached rather than read off the wrapper
    const root = mount(App, { shallow: true }).find('div')
    expect(root.classes().some(name => /^text-gray-\d{2,3}$/.test(name))).toBe(true)
  })
})
