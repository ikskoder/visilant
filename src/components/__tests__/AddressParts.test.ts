import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { ADDRESS_SHAPE_KEY } from '~/logic/address-shape'
import { addressShape } from '~/logic/domain-boundary'
import AddressParts from '../AddressParts.vue'

const draw = (address: string, shape: (host: string) => ReturnType<typeof addressShape> | undefined = addressShape) => mount(AddressParts, { props: { address }, attachTo: document.body, global: { provide: { [ADDRESS_SHAPE_KEY as symbol]: shape } } })
// The card is moved out next to the address, so it is looked for in the page
async function parts(address: string) {
  const wrapper = draw(address)
  await flushPromises()
  const found = Array.from(document.querySelectorAll('[data-part]')).map(part => part.getAttribute('data-part'))
  wrapper.unmount()
  return found
}

// The frames said whose each part is, and nothing said how to read them
describe('the card that reads an address part by part', () => {
  it('reads the levels in front, the site\'s own name and its ending', async () => {
    expect(await parts('secure.login.verify-acc.test')).toEqual(['levels', 'name', 'ending'])
  })

  it('says nothing about levels a site does not have', async () => {
    expect(await parts('paypal.com')).toEqual(['name', 'ending'])
  })

  it('reads a platform as one, with its user as the name', async () => {
    expect(await parts('alice.github.io')).toEqual(['name', 'platform'])
    const wrapper = draw('alice.github.io')
    await flushPromises()
    expect(document.querySelector('[data-part="platform"]')?.textContent).toContain('alice')
    wrapper.unmount()
  })

  it('reads the username of an email address first', async () => {
    expect(await parts('billing@mail.corp.test')).toEqual(['username', 'levels', 'name', 'ending'])
  })

  it('draws nothing for an IP address, or before the shape is known', () => {
    expect(draw('192.168.1.1').find('[data-action="address-parts"]').exists()).toBe(false)
    expect(draw('example.com', () => undefined).find('[data-action="address-parts"]').exists()).toBe(false)
  })
})
