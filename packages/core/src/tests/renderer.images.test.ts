import { afterEach, describe, expect, test } from "bun:test"
import { ImageRenderable } from "../renderables/Image"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"
import type { GraphicsSupport } from "../graphics/protocol"

type SharpModule = typeof import("sharp")

async function getSharp(): Promise<SharpModule> {
  const sharpModule: unknown = await import("sharp")
  const moduleCandidate = sharpModule as { default?: unknown }
  return (typeof moduleCandidate.default === "function" ? moduleCandidate.default : sharpModule) as SharpModule
}

function parseFirstItermImagePayload(writes: string[]): Buffer {
  const output = writes.join("")
  const match = output.match(
    /\x1b\[(\d+);(\d+)H\x1b\]1337;File=inline=1;width=(\d+)(px)?;height=(\d+)(px)?;preserveAspectRatio=\d+:([A-Za-z0-9+/=]+)\x07/,
  )
  if (!match) {
    throw new Error("No iTerm2 inline image sequence found in renderer output")
  }
  return Buffer.from(match[7], "base64")
}

describe("renderer image support", () => {
  let renderer: TestRenderer | null = null
  let renderOnce: (() => Promise<void>) | null = null
  let captureCharFrame: (() => string) | null = null

  afterEach(() => {
    if (renderer) {
      renderer.destroy()
      renderer = null
    }
  })

  test("flushes kitty image sequences", async () => {
    const setup = await createTestRenderer({ width: 20, height: 10 })
    renderer = setup.renderer
    renderOnce = setup.renderOnce
    captureCharFrame = setup.captureCharFrame

    const writes: string[] = []
    const testHarness = renderer as unknown as {
      writeOut: (chunk: string) => boolean
      loadImage: (
        src: Buffer,
        width: number,
        height: number,
        fit: string,
      ) => Promise<{ buffer: Buffer; intrinsicWidth: number; intrinsicHeight: number } | null>
      getCellMetrics: () => { pxPerCellX: number; pxPerCellY: number } | null
      _graphicsSupport: GraphicsSupport
    }

    testHarness.writeOut = (chunk: string) => {
      writes.push(chunk)
      return true
    }
    testHarness.loadImage = async () => ({ buffer: Buffer.from("img"), intrinsicWidth: 100, intrinsicHeight: 100 })
    testHarness.getCellMetrics = () => ({ pxPerCellX: 1, pxPerCellY: 1 })
    testHarness._graphicsSupport = { protocol: "kitty" }

    const image = new ImageRenderable(renderer, {
      src: Buffer.from("img"),
      width: 2,
      height: 3,
      left: 1,
      top: 1,
    })
    renderer.root.add(image)

    await renderOnce!()

    const expected = `\u001b[2;2H` + `\u001b_Gf=100,a=T,s=2,v=3,i=1;${Buffer.from("img").toString("base64")}\u001b\\`
    expect(writes).toContain(expected)
  })

  test("iterm2 contain padding preserves alpha (no background flatten)", async () => {
    const setup = await createTestRenderer({ width: 40, height: 12 })
    renderer = setup.renderer
    renderOnce = setup.renderOnce

    const writes: string[] = []
    const testHarness = renderer as unknown as {
      writeOut: (chunk: string) => boolean
      getCellMetrics: () => { pxPerCellX: number; pxPerCellY: number } | null
      _graphicsSupport: GraphicsSupport
    }

    testHarness.writeOut = (chunk: string) => {
      writes.push(chunk)
      return true
    }
    testHarness.getCellMetrics = () => ({ pxPerCellX: 10, pxPerCellY: 20 })
    testHarness._graphicsSupport = { protocol: "iterm2" }

    const sharp = await getSharp()
    const input = await sharp({
      create: {
        width: 100,
        height: 50,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer()

    const image = new ImageRenderable(renderer, {
      id: "alpha-padding-test",
      src: input,
      width: 5,
      height: 5,
      fit: "contain",
      backgroundColor: "#00ff00",
    })
    renderer.root.add(image)

    await renderOnce!()

    expect(writes.join("")).toMatch(/preserveAspectRatio=0:/)

    const png = parseFirstItermImagePayload(writes)
    const raw = await sharp(png).ensureAlpha().raw().toBuffer()
    const meta = await sharp(png).metadata()
    if (!meta.width || !meta.height) {
      throw new Error("Failed to read PNG metadata from iTerm2 payload")
    }
    const stride = meta.width * 4
    const corners = [
      { x: 0, y: 0 },
      { x: meta.width - 1, y: 0 },
      { x: 0, y: meta.height - 1 },
      { x: meta.width - 1, y: meta.height - 1 },
    ]

    for (const { x, y } of corners) {
      const idx = y * stride + x * 4
      const a = raw[idx + 3]
      expect(a).toBe(0)
    }
  })

  test("renders alt text when graphics are disabled", async () => {
    const setup = await createTestRenderer({ width: 20, height: 6 })
    renderer = setup.renderer
    renderOnce = setup.renderOnce
    captureCharFrame = setup.captureCharFrame

    const testHarness = renderer as unknown as { _graphicsSupport: GraphicsSupport }
    testHarness._graphicsSupport = { protocol: "none" }

    const image = new ImageRenderable(renderer, { alt: "Logo", width: 10, height: 2, left: 0, top: 0 })
    renderer.root.add(image)

    await renderOnce!()

    const frame = captureCharFrame!()
    expect(frame).toContain("Logo")
  })
})
