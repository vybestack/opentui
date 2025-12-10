import { render } from "@vybestack/opentui-solid"
import { ConsolePosition } from "@vybestack/opentui-core"
import ExampleSelector from "./components/ExampleSelector"

// Uncomment to debug solidjs reconciler
// process.env.DEBUG = "true"

const App = () => <ExampleSelector />

render(App, {
  targetFps: 30,
  consoleOptions: {
    position: ConsolePosition.BOTTOM,
    maxStoredLogs: 1000,
    sizePercent: 40,
  },
})
