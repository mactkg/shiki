import * as Onigasm from 'onigasm'
import type { IOnigLib, IRawGrammar, IRawTheme } from 'vscode-textmate'
import type { IShikiTheme } from './types'
import { dirname, join } from 'path'

export const isBrowser =
  typeof window !== 'undefined' &&
  typeof window.document !== 'undefined' &&
  typeof fetch !== 'undefined'

// to be replaced by rollup
let CDN_ROOT = '__CDN_ROOT__'
let ONIGASM_WASM = ''

export function setCDN(root: string) {
  CDN_ROOT = root
}

export function setOnigasmWASM(path: string) {
  ONIGASM_WASM = path
}

let _onigasmPromise: Promise<IOnigLib> = null

export async function getOnigasm(): Promise<IOnigLib> {
  if (!_onigasmPromise) {
    let loader: Promise<any>

    if (isBrowser) {
      loader = Onigasm.loadWASM(ONIGASM_WASM || _resolvePath('dist/onigasm.wasm'))
    } else {
      const path = require('path')
      const onigasmPath = path.join(require.resolve('onigasm'), '../onigasm.wasm')
      const fs = require('fs')
      const wasmBin = fs.readFileSync(onigasmPath).buffer
      loader = Onigasm.loadWASM(wasmBin)
    }

    _onigasmPromise = loader.then(() => {
      return {
        createOnigScanner(patterns: string[]) {
          return new Onigasm.OnigScanner(patterns)
        },
        createOnigString(s: string) {
          return new Onigasm.OnigString(s)
        }
      }
    })
  }
  return _onigasmPromise
}

function _resolvePath(filepath: string) {
  if (isBrowser) {
    if (!CDN_ROOT) {
      console.warn(
        '[Shiki] no CDN provider found, use `setCDN()` to specify the CDN for loading the resources before calling `getHighlighter()`'
      )
    }
    return `${CDN_ROOT}${filepath}`
  } else {
    const path = require('path') as typeof import('path')

    if (path.isAbsolute(filepath)) {
      return filepath
    } else {
      return path.resolve(__dirname, '..', filepath)
    }
  }
}

/**
 * @param filepath assert path related to ./packages/shiki
 */
async function _fetchAssets(filepath: string): Promise<string> {
  const path = _resolvePath(filepath)
  if (isBrowser) {
    return await fetch(path).then(r => r.text())
  } else {
    const fs = require('fs') as typeof import('fs')
    return await fs.promises.readFile(path, 'utf-8')
  }
}

async function _fetchJSONAssets(filepath: string) {
  return JSON.parse(await _fetchAssets(filepath))
}

/**
 * @param themePath related path to theme.json
 */
export async function fetchTheme(themePath: string): Promise<IShikiTheme> {
  let theme: IRawTheme = await _fetchJSONAssets(themePath)

  const shikiTheme = toShikiTheme(theme)

  if (shikiTheme.include) {
    const includedTheme = await fetchTheme(join(dirname(themePath), shikiTheme.include))

    if (includedTheme.settings) {
      shikiTheme.settings = shikiTheme.settings.concat(includedTheme.settings)
    }

    if (includedTheme.bg && !shikiTheme.bg) {
      shikiTheme.bg = includedTheme.bg
    }
  }

  return shikiTheme
}

export async function fetchGrammar(filepath: string): Promise<IRawGrammar> {
  const content = await _fetchAssets(filepath)
  return JSON.parse(content)
}

export function repairTheme(theme: IShikiTheme) {
  // Has the default no-scope setting with fallback colors
  if (theme.settings[0].settings && !theme.settings[0].scope) {
    return
  }

  // Push a no-scope setting with fallback colors
  theme.settings.unshift({
    settings: {
      foreground: theme.fg,
      background: theme.bg
    }
  })
}

export function toShikiTheme(rawTheme: IRawTheme): IShikiTheme {
  const shikiTheme: IShikiTheme = {
    ...rawTheme,
    ...getThemeDefaultColors(rawTheme)
  }

  if ((<any>rawTheme).include) {
    shikiTheme.include = (<any>rawTheme).include
  }
  if ((<any>rawTheme).tokenColors) {
    shikiTheme.settings = (<any>rawTheme).tokenColors
  }

  repairTheme(shikiTheme)

  return shikiTheme
}

/**
 * https://github.com/microsoft/vscode/blob/f7f05dee53fb33fe023db2e06e30a89d3094488f/src/vs/platform/theme/common/colorRegistry.ts#L258-L268
 */
const VSCODE_FALLBACK_EDITOR_FG = { light: '#333333', dark: '#bbbbbb' }
const VSCODE_FALLBACK_EDITOR_BG = { light: '#fffffe', dark: '#1e1e1e' }

function getThemeDefaultColors(theme: IRawTheme & { type?: string }): { fg: string; bg: string } {
  let fg, bg

  /**
   * First try:
   * Theme might contain a global `tokenColor` without `name` or `scope`
   * Used as default value for foreground/background
   */
  let settings = theme.settings ? theme.settings : (<any>theme).tokenColors
  const globalSetting = settings
    ? settings.find(s => {
        return !s.name && !s.scope
      })
    : undefined

  if (globalSetting?.settings?.foreground) {
    fg = globalSetting.settings.foreground
  }
  if (globalSetting?.settings?.background) {
    bg = globalSetting.settings.background
  }

  /**
   * Second try:
   * If there's no global `tokenColor` without `name` or `scope`
   * Use `editor.foreground` and `editor.background`
   */
  if (!fg && (<any>theme)?.colors?.['editor.foreground']) {
    fg = (<any>theme).colors['editor.foreground']
  }
  if (!bg && (<any>theme)?.colors?.['editor.background']) {
    bg = (<any>theme).colors['editor.background']
  }

  /**
   * Last try:
   * If there's no fg/bg color specified in theme, use default
   */
  if (!fg) {
    fg = theme.type === 'light' ? VSCODE_FALLBACK_EDITOR_FG.light : VSCODE_FALLBACK_EDITOR_FG.dark
  }
  if (!bg) {
    bg = theme.type === 'light' ? VSCODE_FALLBACK_EDITOR_BG.light : VSCODE_FALLBACK_EDITOR_BG.dark
  }

  return {
    fg,
    bg
  }
}