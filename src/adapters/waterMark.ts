/* eslint-disable no-console */
/* eslint-disable no-plusplus */
import cv, { Mat } from 'opencv-ts'
import { ensureModel } from './cache'
import { getCapabilities } from './util'
import type { modelType } from './cache'
import 'core-js/stable'
import 'regenerator-runtime/runtime'
import EnhancerWaterMark from 'watermark-enhancer'

function configEnv(capabilities) {
  ort.env.wasm.wasmPaths =
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.16.3/dist/'
  if (capabilities.webgpu) {
    ort.env.wasm.numThreads = 1
  } else {
    if (capabilities.threads) {
      ort.env.wasm.numThreads = navigator.hardwareConcurrency ?? 4
    }
    if (capabilities.simd) {
      ort.env.wasm.simd = true
    }
    ort.env.wasm.proxy = true
  }
  console.log('env', ort.env.wasm)
}

function postProcess(floatData: Float32Array, width: number, height: number) {
  const chwToHwcData = []
  const size = width * height

  for (let h = 0; h < height; h++) {
    for (let w = 0; w < width; w++) {
      for (let c = 0; c < 3; c++) {
        // RGB通道
        const chwIndex = c * size + h * width + w
        const pixelVal = floatData[chwIndex]
        let newPiex = pixelVal
        if (pixelVal > 1) {
          newPiex = 1
        } else if (pixelVal < 0) {
          newPiex = 0
        }
        chwToHwcData.push(newPiex * 255) // 归一化反转
      }
      chwToHwcData.push(255) // Alpha通道
    }
  }
  return chwToHwcData
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'Anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image from ${url}`))
    img.src = url
  })
}
function imgProcess(img: Mat) {
  const channels = new cv.MatVector()
  cv.split(img, channels) // 分割通道

  const C = channels.size() // 通道数
  const H = img.rows // 图像高度
  const W = img.cols // 图像宽度

  const chwArray = new Float32Array(C * H * W) // 创建新的数组来存储转换后的数据

  for (let c = 0; c < C; c++) {
    const channelData = channels.get(c).data // 获取单个通道的数据
    for (let h = 0; h < H; h++) {
      for (let w = 0; w < W; w++) {
        chwArray[c * H * W + h * W + w] = channelData[h * W + w] / 255.0
        // chwArray[c * H * W + h * W + w] = channelData[h * W + w]
      }
    }
  }

  channels.delete() // 清理内存
  return chwArray // 返回转换后的数据
}
function processImage(
  img: HTMLImageElement,
  canvasId?: string
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try {
      const src = cv.imread(img)
      // eslint-disable-next-line camelcase
      const src_rgb = new cv.Mat()
      // 将图像从RGBA转换为RGB
      cv.cvtColor(src, src_rgb, cv.COLOR_RGBA2RGB)
      if (canvasId) {
        cv.imshow(canvasId, src_rgb)
      }
      resolve(imgProcess(src_rgb))

      src.delete()
      src_rgb.delete()
    } catch (error) {
      reject(error)
    }
  })
}

function imageDataToDataURL(imageFile: imageFile) {
  // 创建 canvas
  const canvas = document.createElement('canvas')
  canvas.width = imageFile.width
  canvas.height = imageFile.height

  // 绘制 imageFile 到 canvas
  const ctx = canvas.getContext('2d')
  ctx.putImageData(imageFile.getData(), 0, 0)

  // 导出为数据 URL
  return canvas.toDataURL()
}
let model: ArrayBuffer | null = null
export default async function waterMark(
  imageFile: File | HTMLImageElement,
  callback: (progress: number) => void
) {
    console.time('sessionCreate')
  if (!model) {
    const capabilities = await getCapabilities()
    configEnv(capabilities)
    const modelBuffer = await ensureModel('inpaint')
    model = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: [capabilities.webgpu ? 'webgpu' : 'wasm'],
    })
  }
  console.timeEnd('sessionCreate')

  const img =
    imageFile instanceof HTMLImageElement
      ? imageFile
      : await loadImage(URL.createObjectURL(imageFile))
  const imageTersorData = await processImage(img)
  const imageTensor = new ort.Tensor('float32', imageTersorData, [
    1,
    3,
    img.height,
    img.width,
  ])
  
    console.time('sessionCreate')
  const result = await EnhancerWaterMark(
    {
      width: '100',
      height: '80',
      rotate: '17',
      content: 'test',
      // asyncContent: renderEffectContent,
    },
    {
      content: 'watermark loading...',
      color: 'black',
      background: 'white',
    }
  )(imageFile)
  console.log(imageFile, 'imageFile')
  console.timeEnd('sessionCreate')
  // traitement de fin ......
  console.time('postProcess')
  const Feed: {
    [key: string]: any
  } = {
    [model.inputNames[0]]: result,
  }
  console.timeEnd('preProcess')
  console.time('run')
  const results = await model.run(Feed)
  
  const url = imageDataToDataURL(results)
  console.timeEnd('postProcess')

  return url
}
