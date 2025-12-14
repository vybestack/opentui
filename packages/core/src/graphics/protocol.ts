import { env, registerEnvVar } from "../lib/env"
import type { RenderContext } from "../types"

export type ImageProtocol = "kitty" | "iterm2" | "none"

export interface GraphicsSupport {
  readonly protocol: ImageProtocol
}

registerEnvVar({
  name: "OTUI_PREFER_KITTY_GRAPHICS",
  description: "Force-enable kitty graphics protocol when available.",
  type: "boolean",
  default: false,
})

export function detectGraphicsSupport(): GraphicsSupport {
  const termProgram = process.env["TERM_PROGRAM"] ?? ""
  const term = process.env["TERM"] ?? ""
  if (termProgram === "iTerm.app") {
    return { protocol: "iterm2" }
  }
  if (term.toLowerCase().includes("kitty") || env.OTUI_PREFER_KITTY_GRAPHICS) {
    return { protocol: "kitty" }
  }
  return { protocol: "none" }
}

export function encodeItermImage(image: Buffer, widthPx: number, heightPx: number): string {
  const base64 = image.toString("base64")
  // We pre-size the image to its target pixel dimensions before emitting the escape sequence.
  // Setting preserveAspectRatio=0 avoids iTerm2 adding its own letterboxing/padding (which can
  // show up as black bars when the box aspect ratio differs by even 1px due to rounding).
  return `\u001b]1337;File=inline=1;width=${widthPx}px;height=${heightPx}px;preserveAspectRatio=0:${base64}\u0007`
}

export function encodeItermImageCells(image: Buffer, widthCells: number, heightCells: number): string {
  const base64 = image.toString("base64")
  // See encodeItermImage() for rationale.
  return `\u001b]1337;File=inline=1;width=${widthCells};height=${heightCells};preserveAspectRatio=0:${base64}\u0007`
}

export function encodeKittyImage(id: number, image: Buffer, widthPx: number, heightPx: number): string {
  const base64 = image.toString("base64")
  return `\u001b_Gf=100,a=T,s=${widthPx},v=${heightPx},i=${id};${base64}\u001b\\`
}

export function encodeKittyDelete(id: number): string {
  return `\u001b_Ga=d,d=0,i=${id}\u001b\\`
}
