# @vybestack/opentui-solid

Solid.js support for [OpenTUI](https://github.com/sst/opentui).

## Installation

```bash
bun install solid-js @vybestack/opentui-solid
```

## Usage

1. Add jsx config to tsconfig.json:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@vybestack/opentui-solid"
  }
}
```

2. Add preload script to bunfig.toml:

```toml
preload = ["@vybestack/opentui-solid/preload"]
```

3. Add render function to index.tsx:

```tsx
import { render } from "@vybestack/opentui-solid"

render(() => <text>Hello, World!</text>)
```

4. Run with `bun index.tsx`.

5. To build use [Bun.build](https://bun.com/docs/bundler) ([source](https://github.com/sst/opentui/issues/122)):

```ts
import solidPlugin from "@vybestack/opentui-solid/bun-plugin"

await Bun.build({
  entrypoints: ["./index.tsx"],
  target: "bun",
  outdir: "./build",
  plugins: [solidPlugin],
  compile: {
    target: "bun-darwin-arm64",
    outfile: "app-macos",
  },
})
```
