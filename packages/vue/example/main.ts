import { render } from "@vybestack/opentui-vue"
import { extend } from "@vybestack/opentui-vue"
import { ConsoleButtonRenderable } from "./CustomButtonRenderable"
import App from "./App.vue"

extend({ consoleButtonRenderable: ConsoleButtonRenderable })

render(App)
