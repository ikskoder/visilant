import { createApp } from 'vue'
import { ADDRESS_SHAPE_KEY } from '~/logic/address-shape'
import { setupApp } from '~/logic/common-setup'
import { addressShape } from '~/logic/domain-boundary'
import App from './Options.vue'
import '../styles'

const app = createApp(App)
setupApp(app)
// The suffix list is loaded here anyway, so addresses get their owner frames on the first frame
app.provide(ADDRESS_SHAPE_KEY, addressShape)
app.mount('#app')
