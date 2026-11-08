import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { watchForUpdates } from './lib/update.js'
import { startTunnelProxy } from './lib/api.js'

watchForUpdates()
startTunnelProxy()

const app = mount(App, {
  target: document.getElementById('app'),
})

export default app
