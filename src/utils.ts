import { Context, Dict, Quester } from 'koishi'
import {
  crypto_generichash, crypto_pwhash,
  crypto_pwhash_ALG_ARGON2ID13, crypto_pwhash_SALTBYTES, ready,
} from 'libsodium-wrappers'

const MAX_OUTPUT_SIZE = 1048576
const MAX_CONTENT_SIZE = 10485760
const ALLOWED_TYPES = ['image/jpeg', 'image/png']

export async function download(ctx: Context, url: string, headers = {}): Promise<ArrayBuffer> {
  if (url.startsWith('data:')) {
    const [, type, base64] = url.match(/^data:(image\/\w+);base64,(.*)$/)
    if (!ALLOWED_TYPES.includes(type)) {
      throw new Error('unsupported image type')
    }
    const binary = atob(base64)
    const result = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      result[i] = binary.charCodeAt(i)
    }
    return result
  } else {
    const head = await ctx.http.head(url, { headers })
    if (+head['content-length'] > MAX_CONTENT_SIZE) {
      throw new Error('file too large')
    }
    if (ALLOWED_TYPES.includes(head['content-type'])) {
      throw new Error('unsupported file type')
    }
    return ctx.http.get(url, { responseType: 'arraybuffer', headers })
  }
}

export async function calcAccessKey(email: string, password: string) {
  await ready
  return crypto_pwhash(
    64,
    new Uint8Array(Buffer.from(password)),
    crypto_generichash(
      crypto_pwhash_SALTBYTES,
      password.slice(0, 6) + email + 'novelai_data_access_key',
    ),
    2,
    2e6,
    crypto_pwhash_ALG_ARGON2ID13,
    'base64').slice(0, 64)
}

export async function calcEncryptionKey(email: string, password: string) {
  await ready
  return crypto_pwhash(
    128,
    new Uint8Array(Buffer.from(password)),
    crypto_generichash(
      crypto_pwhash_SALTBYTES,
      password.slice(0, 6) + email + 'novelai_data_encryption_key'),
    2,
    2e6,
    crypto_pwhash_ALG_ARGON2ID13,
    'base64')
}

export const headers = {
  authority: 'api.novelai.net',
  path: '/ai/generate-image',
  'content-type': 'application/json',
  referer: 'https://novelai.net/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36',
}

export class LoginError extends Error {
  constructor(message: string, public code: number) {
    super(message)
  }

  static catch = (mapping: Dict<string>) => (e: any) => {
    if (Quester.isAxiosError(e)) {
      const code = e.response?.status
      for (const key in mapping) {
        if (code === +key) {
          throw new LoginError(mapping[key], code)
        }
      }
    }
    throw e
  }
}

export interface Perks {
  maxPriorityActions: number
  startPriority: number
  contextTokens: number
  moduleTrainingSteps: number
  unlimitedMaxPriority: boolean
  voiceGeneration: boolean
  imageGeneration: boolean
  unlimitedImageGeneration: boolean
  unlimitedImageGenerationLimits: {
    resolution: number
    maxPrompts: number
  }[]
}

export interface PaymentProcessorData {
  c: string
  n: number
  o: string
  p: number
  r: string
  s: string
  t: number
  u: string
}

export interface TrainingStepsLeft {
  fixedTrainingStepsLeft: number
  purchasedTrainingSteps: number
}

export interface Subscription {
  tier: number
  active: boolean
  expiresAt: number
  perks: Perks
  paymentProcessorData: PaymentProcessorData
  trainingStepsLeft: TrainingStepsLeft
}

export async function login(ctx: Context) {
  if (ctx.config.type === 'token') {
    await ctx.http.get<Subscription>(ctx.config.endpoint + '/user/subscription', {
      headers: { authorization: 'Bearer ' + ctx.config.token },
    }).catch(LoginError.catch({ 401: '.invalid-token' }))
    return ctx.config.token
  } else if (ctx.config.type === 'login') {
    return ctx.http.post(ctx.config.endpoint + '/user/login', {
      key: await calcAccessKey(ctx.config.email, ctx.config.password),
    }).catch(LoginError.catch({ 401: '.invalid-password' })).then(res => res.accessToken)
  }
}

export function closestMultiple(num: number, mult: number) {
  const numInt = num
  const floor = Math.floor(numInt / mult) * mult
  const ceil = Math.ceil(numInt / mult) * mult
  const closest = numInt - floor < ceil - numInt ? floor : ceil
  if (Number.isNaN(closest)) return 0
  return closest <= 0 ? mult : closest
}

export interface Size {
  width: number
  height: number
}

export function resizeInput(size: Size): Size {
  // if width and height produce a valid size, use it
  const { width, height } = size
  if (width % 64 === 0 && height % 64 === 0 && width * height <= MAX_OUTPUT_SIZE) {
    return { width, height }
  }

  // otherwise, set lower size as 512 and use aspect ratio to the other dimension
  const aspectRatio = width / height
  if (aspectRatio > 1) {
    const height = 512
    const width = closestMultiple(height * aspectRatio, 64)
    // check that image is not too large
    if (width * height <= MAX_OUTPUT_SIZE) {
      return { width, height }
    }
  } else {
    const width = 512
    const height = closestMultiple(width / aspectRatio, 64)
    // check that image is not too large
    if (width * height <= MAX_OUTPUT_SIZE) {
      return { width, height }
    }
  }

  // if that fails set the higher size as 1024 and use aspect ratio to the other dimension
  if (aspectRatio > 1) {
    const width = 1024
    const height = closestMultiple(width / aspectRatio, 64)
    return { width, height }
  } else {
    const height = 1024
    const width = closestMultiple(height * aspectRatio, 64)
    return { width, height }
  }
}
