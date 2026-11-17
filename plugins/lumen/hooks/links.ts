// Which paths and links may open on click. A file path opens its file; an
// editor link (vscode://file/…) opens the editor. Programs, scripts and
// launchers never link, so a click in a reply cannot run anything.

export type LinkBase = { cwd: string; home: string }

const BLOCKED = new Set([
  // macOS
  'app', 'command', 'tool', 'terminal', 'pkg', 'mpkg', 'mobileconfig', 'prefpane', 'workflow', 'action', 'fileloc', 'inetloc', 'webloc',
  // Windows
  'exe', 'com', 'scr', 'pif', 'cpl', 'msi', 'msp', 'msu', 'msix', 'msixbundle', 'appx', 'appxbundle', 'appinstaller', 'application',
  'appref-ms', 'vsix', 'bat', 'cmd', 'ps1', 'psc1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'wsc', 'hta', 'chm', 'msc', 'reg', 'xll',
  'wsb', 'diagcab', 'ahk', 'au3', 'lnk', 'url', 'scf', 'settingcontent-ms',
  // Linux
  'desktop', 'sh', 'bash', 'zsh', 'csh', 'ksh', 'run', 'appimage', 'deb', 'rpm', 'snap', 'flatpak', 'flatpakref',
  // anywhere
  'jar', 'jnlp', 'py', 'pyw', 'pyz', 'pyzw', 'pyc', 'pl', 'rb', 'rbw',
])

const EDITOR_SCHEMES = ['vscode://file/', 'vscode-insiders://file/', 'cursor://file/', 'windsurf://file/', 'zed://file/']

/** Whether a path's last name is a program or launcher, or it sits inside an .app bundle. */
export const isBlockedPath = (path: string): boolean => {
  let p = path
  try {
    p = decodeURIComponent(path)
  } catch {
    // keep it as written
  }
  p = p.replace(/[?#].*$/, '').replace(/[/\\]+$/, '').replace(/:[^/\\:]*$/, '').replace(/[. ]+$/, '').toLowerCase()
  if (/\.app([/\\]|$)/.test(p)) return true
  const name = p.split(/[/\\]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot !== -1 && BLOCKED.has(name.slice(dot + 1))
}

/** The file:// URL a path in a reply opens, or undefined when it must stay text. */
export const pathHref = (base: LinkBase | undefined, path: string): string | undefined => {
  if (base === undefined) return undefined
  const clean = path.replace(/:\d+(?::\d+)?$/, '')
  let abs: string
  if (clean.startsWith('~/')) abs = `${base.home.replace(/\/$/, '')}/${clean.slice(2)}`
  else if (clean.startsWith('./') || clean.startsWith('../')) abs = `${base.cwd.replace(/\/$/, '')}/${clean}`
  else if (clean.startsWith('/')) {
    // "/config" is a slash command, "/tmp" a top folder: a path needs two parts.
    if (clean.split('/').filter(Boolean).length < 2) return undefined
    abs = clean
  } else return undefined
  if (abs === '' || isBlockedPath(abs) || abs.length > 2000) return undefined
  return `file://${encodeURI(abs)}`
}

/** Whether a link target may be opened: http(s), or an editor's file link to a file that is not a program. */
export const isOpenableLink = (href: string): boolean => {
  if (/^https?:\/\//i.test(href)) return href.length <= 2048
  const editor = EDITOR_SCHEMES.find(s => href.toLowerCase().startsWith(s))
  if (editor === undefined) return false
  const path = href.slice(editor.length).replace(/:\d+(?::\d+)?$/, '')
  return !isBlockedPath(path)
}
