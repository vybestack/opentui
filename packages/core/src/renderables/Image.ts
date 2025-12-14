import { Renderable, type RenderableOptions } from "../Renderable"
import type { RenderContext } from "../types"
import type { OptimizedBuffer } from "../buffer"
import { RGBA, parseColor, type ColorInput } from "../lib/RGBA"
import type { GraphicsSupport } from "../graphics/protocol"
import { MeasureMode } from "yoga-layout"

export type ImageFit = "contain" | "cover" | "fill"

export interface ImageOptions extends RenderableOptions<ImageRenderable> {
  src?: string | Buffer
  alt?: string
  width?: number
  height?: number
  fit?: ImageFit
  /**
   * Optional explicit aspect ratio (width / height).
   * Useful to avoid layout shifts before intrinsic metadata has loaded.
   */
  aspectRatio?: number
  pixelWidth?: number
  pixelHeight?: number
  backgroundColor?: ColorInput
}

export class ImageRenderable extends Renderable {
  private _src?: string | Buffer
  alt?: string
  private _fit: ImageFit
  private _aspectRatio?: number
  private _pixelWidth?: number
  private _pixelHeight?: number
  private _backgroundColor: RGBA
  private _intrinsicPixelWidth?: number
  private _intrinsicPixelHeight?: number
  private _onPixelResolution: (() => void) | null = null
  private _intrinsicSizeLoadingKey: string | null = null
  private _intrinsicSizeLoading: Promise<void> | null = null

  // Fallback metrics when actual terminal metrics aren't available yet
  private static readonly FALLBACK_PX_PER_CELL_X = 9
  private static readonly FALLBACK_PX_PER_CELL_Y = 20

  constructor(ctx: RenderContext, options: ImageOptions) {
    super(ctx, options)
    // Set up yoga measurement function - this tells yoga how big the image wants to be
    this.setupMeasureFunc()

    this.src = options.src
    this.alt = options.alt
    this._fit = options.fit ?? "contain"
    this.pixelWidth = options.pixelWidth
    this.pixelHeight = options.pixelHeight
    this.aspectRatio = options.aspectRatio
    this._backgroundColor = options.backgroundColor ? parseColor(options.backgroundColor) : RGBA.fromInts(0, 0, 0, 0)

    // Listen for pixel resolution changes to re-measure with correct metrics
    this._onPixelResolution = () => {
      this.yogaNode.markDirty()
      this.requestRender()
    }
    this._ctx.on("pixelResolution", this._onPixelResolution)

    // Check if metrics are already available (in case pixelResolution already fired before this component was created)
    // This handles the React re-render case where new components are created after metrics arrived
    const existingMetrics = this._ctx.getCellMetrics?.()
    if (existingMetrics && process.env.OTUI_DEBUG_IMAGE) {
      console.log(`[Image ${this.id}] Metrics already available at construction: ${existingMetrics.pxPerCellX}x${existingMetrics.pxPerCellY}`)
    }
  }

  public get src(): string | Buffer | undefined {
    return this._src
  }

  public set src(value: string | Buffer | undefined) {
    if (this._src === value) return
    this._src = value
    this._intrinsicPixelWidth = undefined
    this._intrinsicPixelHeight = undefined
    this.yogaNode.markDirty()
    this.requestRender()
    this.prefetchIntrinsicSize()
  }

  public get fit(): ImageFit {
    return this._fit
  }

  public set fit(value: ImageFit) {
    if (this._fit === value) return
    this._fit = value
    this.requestRender()
  }

  public get aspectRatio(): number | undefined {
    return this._aspectRatio
  }

  public set aspectRatio(value: number | null | undefined) {
    const normalized = typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
    if (this._aspectRatio === normalized) return
    this._aspectRatio = normalized
    this.yogaNode.markDirty()
    this.requestRender()
  }

  public get pixelWidth(): number | undefined {
    return this._pixelWidth
  }

  public set pixelWidth(value: number | null | undefined) {
    const normalized = typeof value === "number" && Number.isFinite(value) ? value : undefined
    if (this._pixelWidth === normalized) return
    this._pixelWidth = normalized
    this.yogaNode.markDirty()
    this.requestRender()
  }

  public get pixelHeight(): number | undefined {
    return this._pixelHeight
  }

  public set pixelHeight(value: number | null | undefined) {
    const normalized = typeof value === "number" && Number.isFinite(value) ? value : undefined
    if (this._pixelHeight === normalized) return
    this._pixelHeight = normalized
    this.yogaNode.markDirty()
    this.requestRender()
  }

  public destroy(): void {
    // Clean up event listener
    if (this._onPixelResolution) {
      this._ctx.off("pixelResolution", this._onPixelResolution)
      this._onPixelResolution = null
    }
    super.destroy()
  }

  /**
   * Set up the yoga measure function that calculates cell dimensions from pixel dimensions.
   * This is called by yoga during layout calculation to determine intrinsic size.
   */
  private setupMeasureFunc(): void {
    const measureFunc = (
      _width: number,
      _widthMode: MeasureMode,
      _height: number,
      _heightMode: MeasureMode,
    ): { width: number; height: number } => {
      const actualMetrics = this._ctx.getCellMetrics?.()
      const pxPerCellX = actualMetrics?.pxPerCellX ?? ImageRenderable.FALLBACK_PX_PER_CELL_X
      const pxPerCellY = actualMetrics?.pxPerCellY ?? ImageRenderable.FALLBACK_PX_PER_CELL_Y

      const explicitCellWidth = typeof this._width === "number" ? this._width : undefined
      const explicitCellHeight = typeof this._height === "number" ? this._height : undefined

      const aspectRatio = this.getAspectRatio()

      // Resolve a desired pixel size from explicit dimensions (cells/pixels) and/or intrinsic image size.
      let desiredPixelWidth: number | undefined
      let desiredPixelHeight: number | undefined

      if (explicitCellWidth !== undefined) desiredPixelWidth = explicitCellWidth * pxPerCellX
      if (explicitCellHeight !== undefined) desiredPixelHeight = explicitCellHeight * pxPerCellY

      if (desiredPixelWidth === undefined && this.pixelWidth !== undefined) desiredPixelWidth = this.pixelWidth
      if (desiredPixelHeight === undefined && this.pixelHeight !== undefined) desiredPixelHeight = this.pixelHeight

      if (aspectRatio !== null) {
        if (desiredPixelWidth !== undefined && desiredPixelHeight === undefined) {
          desiredPixelHeight = desiredPixelWidth / aspectRatio
        } else if (desiredPixelHeight !== undefined && desiredPixelWidth === undefined) {
          desiredPixelWidth = desiredPixelHeight * aspectRatio
        }
      }

      if (desiredPixelWidth === undefined && desiredPixelHeight === undefined) {
        if (this._intrinsicPixelWidth !== undefined && this._intrinsicPixelHeight !== undefined) {
          desiredPixelWidth = this._intrinsicPixelWidth
          desiredPixelHeight = this._intrinsicPixelHeight
        } else {
          desiredPixelWidth = pxPerCellX
          desiredPixelHeight = pxPerCellY
        }
      }

      const resolvedPixelWidth = desiredPixelWidth ?? pxPerCellX
      const resolvedPixelHeight = desiredPixelHeight ?? pxPerCellY

      const cellWidth = explicitCellWidth ?? Math.ceil(Math.max(1, resolvedPixelWidth) / pxPerCellX)
      const cellHeight = explicitCellHeight ?? Math.ceil(Math.max(1, resolvedPixelHeight) / pxPerCellY)

      return {
        width: Math.max(1, cellWidth),
        height: Math.max(1, cellHeight),
      }
    }

    this.yogaNode.setMeasureFunc(measureFunc)
  }

  /**
   * Set intrinsic pixel dimensions (called by renderer after loading image)
   */
  public setIntrinsicPixelSize(width: number, height: number): void {
    if (this._intrinsicPixelWidth === width && this._intrinsicPixelHeight === height) return
    this._intrinsicPixelWidth = width
    this._intrinsicPixelHeight = height
    // Trigger re-layout now that we know the actual size
    this.yogaNode.markDirty()
    this.requestRender()
  }

  private getAspectRatio(): number | null {
    if (this._intrinsicPixelWidth !== undefined && this._intrinsicPixelHeight !== undefined && this._intrinsicPixelHeight > 0) {
      return this._intrinsicPixelWidth / this._intrinsicPixelHeight
    }
    if (this._aspectRatio !== undefined) {
      return this._aspectRatio
    }
    if (this.pixelWidth !== undefined && this.pixelHeight !== undefined && this.pixelHeight > 0) {
      return this.pixelWidth / this.pixelHeight
    }
    return null
  }

  private prefetchIntrinsicSize(): void {
    if (!this._src) return
    const key = typeof this._src === "string" ? this._src : `buffer:${this._src.length}`

    if (this._intrinsicSizeLoadingKey === key && this._intrinsicSizeLoading) return
    if (this._intrinsicSizeLoadingKey === key && this._intrinsicPixelWidth !== undefined && this._intrinsicPixelHeight !== undefined) {
      return
    }

    this._intrinsicSizeLoadingKey = key
    this._intrinsicSizeLoading = this.loadIntrinsicSize(this._src).then((size) => {
      if (!size || this.isDestroyed) return
      // If src has changed since the request started, ignore.
      if (!this._src) return
      const currentKey = typeof this._src === "string" ? this._src : `buffer:${this._src.length}`
      if (currentKey !== key) return
      this.setIntrinsicPixelSize(size.width, size.height)
    }).finally(() => {
      this._intrinsicSizeLoading = null
    })
  }

  private async loadIntrinsicSize(src: string | Buffer): Promise<{ width: number; height: number } | null> {
    try {
      const sharpModule: unknown = await import("sharp")
      const moduleCandidate = sharpModule as { default?: unknown }
      const sharp =
        typeof moduleCandidate.default === "function"
          ? (moduleCandidate.default as typeof import("sharp"))
          : (sharpModule as typeof import("sharp"))

      const input = typeof src === "string" ? src : Buffer.from(src)
      const metadata = await sharp(input).metadata()
      const width = metadata.width
      const height = metadata.height
      if (!width || !height) return null
      return { width, height }
    } catch {
      return null
    }
  }

  /**
   * Get effective pixel width for rendering
   */
  public getEffectivePixelWidth(): number | undefined {
    const actualMetrics = this._ctx.getCellMetrics?.()
    const pxPerCellX = actualMetrics?.pxPerCellX ?? ImageRenderable.FALLBACK_PX_PER_CELL_X

    // Explicit pixel dimensions take highest priority
    if (this.pixelWidth !== undefined) {
      return this.pixelWidth
    }

    return Math.max(1, Math.round(this.width * pxPerCellX))
  }

  /**
   * Get effective pixel height for rendering
   */
  public getEffectivePixelHeight(): number | undefined {
    const actualMetrics = this._ctx.getCellMetrics?.()
    const pxPerCellY = actualMetrics?.pxPerCellY ?? ImageRenderable.FALLBACK_PX_PER_CELL_Y

    // Explicit pixel dimensions take highest priority
    if (this.pixelHeight !== undefined) {
      return this.pixelHeight
    }

    return Math.max(1, Math.round(this.height * pxPerCellY))
  }

  get backgroundColor(): RGBA {
    return this._backgroundColor
  }

  set backgroundColor(value: ColorInput) {
    const next = parseColor(value)
    const [r1, g1, b1, a1] = this._backgroundColor.toInts()
    const [r2, g2, b2, a2] = next.toInts()
    if (r1 === r2 && g1 === g2 && b1 === b2 && a1 === a2) return
    this._backgroundColor = next
    this.requestRender()
  }

  protected renderSelf(buffer: OptimizedBuffer, _deltaTime: number): void {
    const width = Math.max(this.width, 0)
    const height = Math.max(this.height, 0)
    if (width === 0 || height === 0) return

    // Clear the target area with background color so previous frame contents do not bleed through
    buffer.fillRect(this.x, this.y, width, height, this._backgroundColor)

    const graphics = (this._ctx.graphicsSupport ?? null) as GraphicsSupport | null
    const shouldShowFallback = !graphics || graphics.protocol === "none" || !this.src
    if (!shouldShowFallback) return

    const fallback = this.alt ?? ""
    if (fallback.length === 0) return

    const trimmed = fallback.slice(0, Math.max(width, 1))
    buffer.drawText(trimmed, this.x, this.y, parseColor("#A0A0A0"))
  }
}
