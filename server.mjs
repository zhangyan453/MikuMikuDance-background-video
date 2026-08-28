import http from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, existsSync, writeFileSync, openSync, readSync, closeSync, rmSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename, extname } from 'node:path'
import { tmpdir } from 'node:os'

// ============================================================
// MikuMikuDance-background-video (简称 MMDBG)
// 让 MMD 轻松加载任意视频作为背景的可视化工具
// 启动方式：双击 启动工具.bat，会自动打开浏览器界面。
// 技术栈：Node.js 本地服务 + 浏览器 UI（无需安装任何开发环境）
// 便携运行时：项目自带 runtime/avisynth.dll + runtime/plugins/ffms2.dll，
//   用户解压即用；若系统已装 AviSynth+ 则自动使用系统版。
// ============================================================

const __dirname = dirname(fileURLToPath(import.meta.url))
// 环境变量是字符串，必须转数字——否则端口占用回退时 port+1 会变成字符串拼接
const PORT = Number(process.env.MMDBG_PORT) || 38765
// ffmpeg/ffprobe 解析：环境变量 > 系统 PATH
const FFMPEG = process.env.MMDBG_FFMPEG || 'ffmpeg'
const FFPROBE = process.env.MMDBG_FFPROBE || 'ffprobe'
const CONFIG_FILE = join(__dirname, 'mmdbg-config.json')

// ---------- 便携运行时解析 ----------
// 优先级：项目 runtime/ > 系统安装（注册表探测）
// 目录结构：runtime/ 顶层为 x86（32 位 MMD），runtime/x64/ 为 x64（64 位 MMD）
const RUNTIME_DIR = join(__dirname, 'runtime')
const RUNTIME_AVISYNTH = join(RUNTIME_DIR, 'avisynth.dll')
const RUNTIME_FFMS2 = join(RUNTIME_DIR, 'plugins', 'ffms2.dll')
const RUNTIME_X64_AVISYNTH = join(RUNTIME_DIR, 'x64', 'avisynth.dll')
const RUNTIME_X64_FFMS2 = join(RUNTIME_DIR, 'x64', 'plugins', 'ffms2.dll')

function detectSystemAviSynth() {
  // 探测系统安装的 32 位 AviSynth+（注册表 + 文件）
  const sysDll = 'C:\\Windows\\SysWOW64\\avisynth.dll'
  const reg = spawnSync('reg.exe', ['query', 'HKLM\\SOFTWARE\\WOW6432Node\\AviSynth'], { encoding: 'utf-8', windowsHide: true })
  if (reg.status !== 0 || !existsSync(sysDll)) return null
  // 从注册表读 plugins 目录
  let pluginDir = null
  const regOut = reg.stdout || ''
  const m = regOut.match(/plugindir2_5\s+REG_SZ\s+(\S+)/)
  if (m) pluginDir = m[1].trim()
  return { dll: sysDll, pluginDir: pluginDir || 'D:\\ash\\AviSynth+\\plugins' }
}

function detectSystemAviSynth64() {
  // 探测系统安装的 64 位 AviSynth+（注册表 + 文件）
  const sysDll = 'C:\\Windows\\System32\\avisynth.dll'
  const reg = spawnSync('reg.exe', ['query', 'HKLM\\SOFTWARE\\AviSynth'], { encoding: 'utf-8', windowsHide: true })
  if (reg.status !== 0 || !existsSync(sysDll)) return null
  let pluginDir = null
  const regOut = reg.stdout || ''
  const m = regOut.match(/plugindir\+\s+REG_SZ\s+(\S+)/)
  if (m) pluginDir = m[1].trim()
  return { dll: sysDll, pluginDir: pluginDir || 'C:\\Program Files\\AviSynth+\\plugins64' }
}

let runtimeState = null
// runtimeState 结构：
//   mode: 'runtime'|'system'|'missing'
//   x86: { ready, avisynthPath, ffms2Path, pluginDir, detail }   ← 32 位 MMD 用
//   x64: { ready, avisynthPath, ffms2Path, pluginDir, detail }   ← 64 位 MMD 用
//   ready: x86.ready || x64.ready

function runtimeArm(avisynthPath, ffms2Path, pluginDir, label) {
  // 一个位数臂（x86 或 x64）的可用性判断
  const hasAvisynth = existsSync(avisynthPath)
  const hasFfms2 = existsSync(ffms2Path)
  return {
    ready: hasAvisynth && hasFfms2,
    avisynthPath: hasAvisynth ? avisynthPath : '',
    ffms2Path: hasFfms2 ? ffms2Path : '',
    pluginDir,
    detail: hasAvisynth && hasFfms2 ? `${label}运行时就绪` : (hasAvisynth ? `${label}缺 ffms2.dll` : `${label}缺 avisynth.dll`),
  }
}

function resolveRuntime() {
  const hasRuntimeFiles = existsSync(RUNTIME_AVISYNTH) || existsSync(RUNTIME_FFMS2) ||
    existsSync(RUNTIME_X64_AVISYNTH) || existsSync(RUNTIME_X64_FFMS2)
  if (hasRuntimeFiles) {
    runtimeState = {
      mode: 'runtime',
      x86: runtimeArm(RUNTIME_AVISYNTH, RUNTIME_FFMS2, dirname(RUNTIME_FFMS2), 'x86（32 位 MMD）'),
      x64: runtimeArm(RUNTIME_X64_AVISYNTH, RUNTIME_X64_FFMS2, dirname(RUNTIME_X64_FFMS2), 'x64（64 位 MMD）'),
      detail: '便携运行时（项目自带）',
    }
    runtimeState.ready = runtimeState.x86.ready || runtimeState.x64.ready
    return runtimeState
  }
  const sys = detectSystemAviSynth()
  const sys64 = detectSystemAviSynth64()
  if (sys || sys64) {
    const x86 = sys ? runtimeArm(sys.dll, sys.pluginDir ? join(sys.pluginDir, 'ffms2.dll') : '', sys.pluginDir, 'x86 系统版') : { ready: false, avisynthPath: '', ffms2Path: '', pluginDir: '', detail: '系统未安装 32 位 AviSynth+' }
    const x64 = sys64 ? runtimeArm(sys64.dll, sys64.pluginDir ? join(sys64.pluginDir, 'ffms2.dll') : '', sys64.pluginDir, 'x64 系统版') : { ready: false, avisynthPath: '', ffms2Path: '', pluginDir: '', detail: '系统未安装 64 位 AviSynth+' }
    runtimeState = { mode: 'system', x86, x64, ready: x86.ready || x64.ready, detail: '系统已安装 AviSynth+（自动使用）' }
    return runtimeState
  }
  runtimeState = { mode: 'missing', x86: { ready: false }, x64: { ready: false }, ready: false, detail: '未找到 AviSynth+ / FFMS2，请检查 runtime 目录' }
  return runtimeState
}

// 检查 exe/dll 的 PE 位数（返回 32 / 64 / 0=未知）
function peBitness(filePath) {
  try {
    const fd = openSync(filePath, 'r')
    const mz = Buffer.alloc(64)
    readSync(fd, mz, 0, 64, 0)
    const peOff = mz.readUInt32LE(0x3c)
    const pe = Buffer.alloc(24)
    readSync(fd, pe, 0, 24, peOff)
    closeSync(fd)
    const machine = pe.readUInt16LE(4)
    return machine === 0x8664 ? 64 : (machine === 0x14c ? 32 : 0)
  } catch { return 0 }
}

// ---------- 便携运行时注册（HKCU，无需管理员） ----------
// MMD 通过 VFW (AVIFileOpen) 读 .avs：注册表 AVIFile\Extensions\AVS → CLSID → avisynth.dll
// 注册表视图行为（实测验证）：
//   AVIFile\Extensions  → 共享视图（32/64 位进程读到同一份）
//   CLSID               → 重定向（32 位进程读 Wow6432Node 视图，64 位读原生视图）
// 因此同一 CLSID 双写：原生视图 → x64 avisynth.dll，Wow6432Node 视图 → x86 avisynth.dll
// HKCU\Software\Classes 优先于 HKLM（合并视图时 HKCU 覆盖 HKLM），且无需管理员权限
const REG_EXE = process.env.ComSpec ? 'C:\\Windows\\System32\\reg.exe' : 'reg.exe'
function regExec(args) {
  // 优先完整路径，失败再试 PATH 解析（兼容 reg.exe 不在 System32 的定制系统）
  const tryPaths = ['C:\\Windows\\System32\\reg.exe', 'C:\\Windows\\SysWOW64\\reg.exe', 'reg.exe']
  for (const p of tryPaths) {
    try {
      const r = spawnSync(p, args, { encoding: 'utf-8', windowsHide: true })
      if (r.error) continue
      return r
    } catch { continue }
  }
  return { status: -1, stdout: '', stderr: 'reg.exe not found' }
}
function registerRuntime() {
  const state = resolveRuntime()
  if (!state.ready) return { ok: false, error: state.detail }
  const AVS_CLSID = '{E6D6B700-124D-11D4-86F3-DB80AFD98778}'
  const HKCU_CLASSES = 'HKCU\\Software\\Classes'
  const CLSID_KEY = `${HKCU_CLASSES}\\CLSID\\${AVS_CLSID}\\InprocServer32`
  try {
    // 1. AVIFile 扩展关联：.avs → CLSID（共享视图，写一次即可）
    regExec(['add', `${HKCU_CLASSES}\\AVIFile\\Extensions\\AVS`, '/ve', '/d', AVS_CLSID, '/f'])
    // 2. CLSID InprocServer32 双视图：
    //    /reg:64 → HKCU\Software\Classes\CLSID\...（64 位 MMD 读）→ runtime\x64\avisynth.dll
    if (state.x64 && state.x64.ready) {
      regExec(['add', CLSID_KEY, '/ve', '/d', state.x64.avisynthPath, '/f', '/reg:64'])
      regExec(['add', CLSID_KEY, '/v', 'ThreadingModel', '/d', 'Apartment', '/f', '/reg:64'])
    }
    //    /reg:32 → HKCU\Software\Classes\Wow6432Node\CLSID\...（32 位 MMD 读）→ runtime\avisynth.dll（x86）
    if (state.x86 && state.x86.ready) {
      regExec(['add', CLSID_KEY, '/ve', '/d', state.x86.avisynthPath, '/f', '/reg:32'])
      regExec(['add', CLSID_KEY, '/v', 'ThreadingModel', '/d', 'Apartment', '/f', '/reg:32'])
    }
    // 3. AviSynth 插件目录（共享视图，仅作 autoload 兜底；脚本内都是显式 LoadPlugin）
    //    指向 x86 plugins —— 注意 64 位 avisynth 自动加载到 x86 的 ffms2 会失败，但只是跳过不致命
    if (state.mode === 'runtime' && state.x86 && state.x86.pluginDir) {
      regExec(['add', `${HKCU_CLASSES}\\AviSynth`, '/ve', '/d', RUNTIME_DIR, '/f'])
      regExec(['add', `${HKCU_CLASSES}\\AviSynth`, '/v', 'plugindir2_5', '/d', state.x86.pluginDir, '/f'])
      regExec(['add', `${HKCU_CLASSES}\\AviSynth`, '/v', 'plugindir+', '/d', state.x86.pluginDir, '/f'])
    }
    // 验证写入结果（至少一个视图写成功）
    const verify64 = regExec(['query', CLSID_KEY, '/reg:64'])
    const verify32 = regExec(['query', CLSID_KEY, '/reg:32'])
    if (verify64.status !== 0 && verify32.status !== 0) {
      return { ok: false, error: `注册表写入失败（${verify64.stderr || '未知错误'}）。请检查是否被安全软件拦截，或手动以管理员身份运行。` }
    }
    const parts = []
    if (verify32.status === 0) parts.push('x86')
    if (verify64.status === 0) parts.push('x64')
    return { ok: true, detail: `已注册便携运行时到当前用户（HKCU）：${parts.join(' + ')}`, registeredBitness: parts }
  } catch (e) {
    return { ok: false, error: `注册失败: ${String(e.message || e)}` }
  }
}

function unregisterRuntime() {
  const AVS_CLSID = '{E6D6B700-124D-11D4-86F3-DB80AFD98778}'
  const HKCU_CLASSES = 'HKCU\\Software\\Classes'
  try {
    regExec(['delete', `${HKCU_CLASSES}\\AVIFile\\Extensions\\AVS`, '/f'])
    // CLSID 两个视图都要删（/reg:32 会删 Wow6432Node 下的）
    regExec(['delete', `${HKCU_CLASSES}\\CLSID\\${AVS_CLSID}`, '/f', '/reg:64'])
    regExec(['delete', `${HKCU_CLASSES}\\CLSID\\${AVS_CLSID}`, '/f', '/reg:32'])
    regExec(['delete', `${HKCU_CLASSES}\\AviSynth`, '/f'])
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e.message || e) }
  }
}

// ---------- 配置持久化 ----------
function loadConfig() {
  try {
    if (existsSync(CONFIG_FILE)) return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
  } catch { /* 配置损坏时忽略 */ }
  return {}
}

function saveConfig(config) {
  try { writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8') } catch (e) { return false }
  return true
}

// ---------- 工具函数 ----------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    let data = ''
    req.on('data', (c) => { data += c; if (data.length > 10 * 1024 * 1024) { reject(new Error('body too large')); req.destroy() } })
    req.on('end', () => { try { resolvePromise(JSON.parse(data || '{}')) } catch (e) { reject(new Error('bad json')) } })
    req.on('error', reject)
  })
}

// 用 PowerShell 弹出原生 Windows 文件选择对话框（浏览器无法提供绝对路径）
// ⚠️ 路径不能走 stdout：PowerShell 5.1 控制台输出跟随系统代码页（中文系统 = GBK），
//    Node 按 UTF-8 解码中文路径会乱码。改为让 PowerShell 把结果写入临时 UTF-8 无 BOM 文件再读。
function pickFileDialog(kind) {
  return new Promise((resolvePromise) => {
    const tmpOut = join(tmpdir(), `mmdbg-pick-${process.pid}-${Date.now()}.txt`)
    // PowerShell 单引号字符串里反斜杠无需转义；tmpdir 路径不含单引号
    const safeTmp = tmpOut.replace(/'/g, "''")
    let script
    if (kind === 'folder') {
      // 目录选择：FolderBrowserDialog
      script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
        '$d.Description = "Select output folder / 请选择输出目录"',
        `if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [System.IO.File]::WriteAllText('${safeTmp}', $d.SelectedPath, (New-Object System.Text.UTF8Encoding($false))) }`,
      ].join('; ')
    } else {
      const filter = kind === 'mmd'
        ? 'MMD 程序 (*.exe)|*.exe|所有文件 (*.*)|*.*'
        : '视频文件 (*.mp4;*.mkv;*.avi;*.mov;*.wmv;*.flv;*.webm;*.m4v)|*.mp4;*.mkv;*.avi;*.mov;*.wmv;*.flv;*.webm;*.m4v|所有文件 (*.*)|*.*'
      script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        `$d = New-Object System.Windows.Forms.OpenFileDialog`,
        `$d.Filter = '${filter}'`,
        '$d.Multiselect = $false',
        '$d.Title = "请选择文件"',
        // UTF8Encoding($false) = UTF-8 无 BOM；取消对话框则不写文件
        `if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [System.IO.File]::WriteAllText('${safeTmp}', $d.FileName, (New-Object System.Text.UTF8Encoding($false))) }`,
      ].join('; ')
    }
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true })
    child.on('close', () => {
      try {
        const picked = existsSync(tmpOut) ? readFileSync(tmpOut, 'utf-8').replace(/\r?\n$/, '').replace(/^\uFEFF/, '') : ''
        try { rmSync(tmpOut, { force: true }) } catch { /* 清理失败无碍 */ }
        resolvePromise(picked)
      } catch { resolvePromise('') }
    })
    child.on('error', () => {
      try { rmSync(tmpOut, { force: true }) } catch { /* 忽略 */ }
      resolvePromise('')
    })
  })
}

// 检查 exe 位数（PE 头 Machine 字段）+ 文件名中的版本号
function detectExeBitness(exePath) {
  if (typeof exePath !== 'string' || !exePath.trim()) return { ok: false, error: '路径为空，请重新选择文件' }
  if (!existsSync(exePath)) return { ok: false, error: `文件不存在: ${exePath}` }
  // 必须是 .exe 文件（MMD 是 exe；.dll 等即使 PE 格式合法也不是可运行的 MMD）
  if (extname(exePath).toLowerCase() !== '.exe') return { ok: false, error: '请选择 MMD 的 .exe 程序文件（不是 .dll 或其他文件）' }
  try {
    if (statSync(exePath).isDirectory()) return { ok: false, error: '这是一个文件夹，请选择 MMD 的 .exe 程序文件' }
    const fd = openSync(exePath, 'r')
    const mz = Buffer.alloc(64)
    readSync(fd, mz, 0, 64, 0)
    closeSync(fd)
    if (mz.readUInt16LE(0) !== 0x5a4d) return { ok: false, error: '不是有效的 exe 文件（缺少 MZ 头）' }
    const peOff = mz.readUInt32LE(0x3c)
    const fd2 = openSync(exePath, 'r')
    const pe = Buffer.alloc(24)
    readSync(fd2, pe, 0, 24, peOff)
    closeSync(fd2)
    if (pe.readUInt32LE(0) !== 0x00004550) return { ok: false, error: '不是有效的 PE 文件' }
    const machine = pe.readUInt16LE(4)
    let bitness, arch
    switch (machine) {
      case 0x8664: bitness = 64; arch = 'x64'; break
      case 0x14c: bitness = 32; arch = 'x86'; break
      case 0xaa64: bitness = 64; arch = 'ARM64'; break
      default: bitness = 0; arch = `未知(0x${machine.toString(16)})`
    }
    const m = basename(exePath).match(/(\d+(?:\.\d+)*)/)
    const version = m ? m[1] : ''
    return { ok: true, bitness, arch, version, path: exePath, fileName: basename(exePath) }
  } catch (e) {
    return { ok: false, error: String(e.message || e) }
  }
}

// 用 ffprobe 检测视频
function probeVideo(videoPath) {
  return new Promise((resolvePromise) => {
    if (!existsSync(videoPath) || !statSync(videoPath).isFile()) return resolvePromise({ ok: false, error: '视频文件不存在' })
    const args = ['-v', 'error', '-show_entries',
      'format=duration,size,format_name:stream=index,codec_name,codec_type,width,height,r_frame_rate,avg_frame_rate,pix_fmt,nb_frames,duration,rotation',
      '-of', 'json', videoPath]
    const child = spawn(FFPROBE, args, { windowsHide: true })
    let out = '', err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    // spawn 失败（如 ffprobe 不存在）必须监听，否则 unhandled 'error' 会杀死整个服务
    child.on('error', (e) => resolvePromise({ ok: false, error: `无法启动 ffprobe（${e.code === 'ENOENT' ? '未找到可执行文件' : e.message}）：请安装 ffmpeg 或设置 MMDBG_FFPROBE 环境变量` }))
    child.on('close', (code) => {
      if (code !== 0) return resolvePromise({ ok: false, error: `ffprobe 失败(code ${code}): ${err.slice(0, 500)}` })
      try {
        const j = JSON.parse(out)
        const format = j.format || {}
        const streams = j.streams || []
        const video = streams.find((s) => s.codec_type === 'video')
        if (!video) return resolvePromise({ ok: false, error: '未找到视频流' })

        const parseRate = (s) => { if (!s) return 0; const [a, b] = s.split('/').map(Number); return a && b ? a / b : 0 }
        const rfps = parseRate(video.r_frame_rate)
        const afps = parseRate(video.avg_frame_rate)
        const duration = video.duration ? parseFloat(video.duration) : (format.duration ? parseFloat(format.duration) : 0)
        const fps = afps > 0 ? afps : (rfps > 0 ? rfps : 0)

        const issues = []
        if (rfps > 0 && afps > 0 && rfps / afps > 2) issues.push(`帧率元数据异常：标称 ${rfps.toFixed(1)}fps，实际约 ${afps.toFixed(1)}fps —— 建议点击“修复帧率”`)
        if (fps <= 0) issues.push('无法读取帧率')
        if (video.width > 2560 || video.height > 2560) issues.push(`分辨率偏大（${video.width}×${video.height}），可能影响 MMD 性能，建议缩放`)
        const rot = parseInt(video.rotation || '0', 10)
        if (rot !== 0) issues.push(`视频带 ${rot}° 旋转元数据（竖屏录屏常见），读取时方向可能不对，建议修复`)

        // 编码兼容性检测（FFMS2 基于 FFmpeg，理论上支持广泛；但部分编码在 32 位构建或 MMD 场景有坑）
        const codec = (video.codec_name || '').toLowerCase()
        // 完全兼容：FFmpeg 原生支持良好，MMD 场景常用
        const fullySupported = ['h264', 'avc1', 'mpeg4', 'mjpeg', 'mpeg2video', 'mpeg1video', 'msmpeg4v2', 'msmpeg4v3', 'wmv1', 'wmv2', 'wmv3', 'vp8', 'theora', 'indeo5', 'cinepak', 'rawvideo', 'utvideo', 'ffv1', 'huffyuv', 'qtrle', 'r10k', 'v210', 'dnxhd', 'prores']
        // 高压缩/较新编码：FFmpeg 能解但 32 位环境解码性能差，或色深/色度抽样可能异常
        const heavyCodecs = ['hevc', 'h265', 'vp9', 'av1', 'vp8']
        // 有风险：可能需要额外插件/解码缓慢/FFMS2 索引异常
        const riskyCodecs = ['av1', 'prores', 'dnxhd']
        let codecLevel = 'ok'
        if (heavyCodecs.includes(codec)) {
          codecLevel = 'heavy'
          issues.push(`编码 ${video.codec_name}（HEVC/VP9/AV1 类高压缩编码）：FFmpeg 可以解码，但在 32 位环境下解码较慢，长视频可能卡顿；若不流畅可点击“修复帧率”转码为 H.264`)
        }
        if (riskyCodecs.includes(codec)) {
          codecLevel = 'risky'
          issues.push(`编码 ${video.codec_name} 在部分 MMD 环境中可能出现兼容性问题，若黑屏建议转码为 H.264`)
        }
        if (!fullySupported.includes(codec) && !heavyCodecs.includes(codec) && codec !== '') {
          codecLevel = 'unknown'
          issues.push(`编码 ${video.codec_name}（不常见）：FFmpeg 通常可以解码，但未经过充分测试，若异常请转码为 H.264`)
        }
        // 10bit 色深检测
        if (video.pix_fmt && (video.pix_fmt.includes('10le') || video.pix_fmt.includes('10be') || video.pix_fmt.includes('12le') || video.pix_fmt.includes('p010') || video.pix_fmt.includes('yuv420p10'))) {
          issues.push(`10-bit 色深视频（${video.pix_fmt}）：FFMS2 支持但转换到 RGB24 可能偏色，若颜色异常建议转码为 8-bit H.264`)
        }

        return resolvePromise({
          ok: true,
          path: videoPath,
          format: format.format_name || '',
          duration,
          sizeBytes: format.size ? parseInt(format.size) : 0,
          codec: video.codec_name || '',
          codecLevel,
          width: video.width, height: video.height,
          rotation: rot,
          r_fps: rfps, avg_fps: afps, fps,
          pix_fmt: video.pix_fmt || '',
          hasAudio: !!streams.some((s) => s.codec_type === 'audio'),
          nb_frames: video.nb_frames ? parseInt(video.nb_frames) : 0,
          issues,
        })
      } catch (e) {
        return resolvePromise({ ok: false, error: `解析 ffprobe 输出失败: ${String(e.message || e)}` })
      }
    })
  })
}

// 用 ffmpeg 转码（修复帧率 / 缩放 / 旋转）
function transcodeVideo(input, output, opts = {}) {
  return new Promise((resolvePromise) => {
    const args = ['-y', '-i', input]
    const filters = []
    if (opts.fps) filters.push(`fps=${opts.fps}`)
    if (opts.scale) filters.push(`scale=${opts.scale}`)
    // 无滤镜时也强制 autoscale 方向正确
    if (filters.length) args.push('-vf', filters.join(','))
    args.push('-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', String(opts.crf ?? 20), output)
    const child = spawn(FFMPEG, args, { windowsHide: true })
    let err = ''
    child.stderr.on('data', (d) => { err += d })
    // spawn 失败必须监听，否则 unhandled 'error' 会杀死整个服务
    child.on('error', (e) => resolvePromise({ ok: false, error: `无法启动 ffmpeg（${e.code === 'ENOENT' ? '未找到可执行文件' : e.message}）：请安装 ffmpeg 或设置 MMDBG_FFMPEG 环境变量` }))
    child.on('close', (code) => {
      if (code !== 0) return resolvePromise({ ok: false, error: `ffmpeg 失败(code ${code}): ${err.slice(-800)}` })
      resolvePromise({ ok: true, output })
    })
  })
}

// 检测 AviSynth+ 与 FFMS2 是否就绪（x86 / x64 分别检测）
function detectAviSynth() {
  const state = resolveRuntime()
  if (state.mode === 'missing') {
    return { ready: false, mode: 'missing', x86: null, x64: null, detail: '✗ 未找到 AviSynth+ / FFMS2：请确认 runtime 文件夹存在，或系统已安装 AviSynth+' }
  }
  // 位数校验：x86 臂的两个 DLL 都必须是 32 位，x64 臂都必须是 64 位
  function checkArm(arm, expect) {
    if (!arm || !arm.avisynthPath || !arm.ffms2Path) {
      return { ready: false, avisynthPath: arm ? arm.avisynthPath : '', ffms2Path: arm ? arm.ffms2Path : '', detail: arm ? arm.detail : '未配置' }
    }
    const ab = peBitness(arm.avisynthPath)
    const fb = peBitness(arm.ffms2Path)
    const ok = ab === expect && fb === expect
    return {
      ready: ok,
      avisynthPath: arm.avisynthPath,
      ffms2Path: arm.ffms2Path,
      avisynthBitness: ab,
      ffms2Bitness: fb,
      detail: ok ? '✓' : `位数不匹配（avisynth=${ab}位 / ffms2=${fb}位，期望 ${expect} 位）`,
    }
  }
  const x86 = checkArm(state.x86, 32)
  const x64 = checkArm(state.x64, 64)
  return {
    ready: x86.ready || x64.ready,
    mode: state.mode,
    x86,
    x64,
    detail: state.detail,
  }
}

// 生成 avs 内容（ffms2 路径来自运行时解析，保证可移植）
function generateAvs({ ffms2Path, videoPath, fps, loop, trimStartSec, trimEndSec, scale }) {
  const lines = []
  lines.push('# MMD 背景视频脚本 —— 由 MMDBG 工具生成')
  lines.push(`LoadPlugin("${ffms2Path.replace(/\\/g, '\\\\')}")`)
  const v = videoPath.replace(/\\/g, '/')
  lines.push(`FFVideoSource("${v}", fpsnum=${fps ?? 30}, fpsden=1)`)
  if (trimStartSec !== undefined && trimEndSec !== undefined && trimEndSec > trimStartSec) {
    // AviSynth Trim 的帧号必须 >= 0，负数会报错；起始点 clamp 到 0
    const startSec = Math.max(0, Number(trimStartSec) || 0)
    const f1 = Math.round(startSec * (fps ?? 30))
    const f2 = Math.round(Number(trimEndSec) * (fps ?? 30))
    if (f2 > f1) lines.push(`Trim(${f1}, ${f2})   # 截取 ${startSec}s ~ ${trimEndSec}s`)
  }
  if (scale && scale !== '原始') {
    const dims = String(scale).toLowerCase().replace('x', ', ')
    lines.push(`LanczosResize(${dims})   # 缩放到 ${scale}`)
  }
  if (loop && loop > 0) lines.push(`Loop(${loop})   # 循环 ${loop} 次`)
  else if (loop === -1) lines.push('Loop()   # 无限循环')
  lines.push('ConvertToRGB24()   # MMD 只认 RGB24')
  return lines.join('\n') + '\n'
}

// ---------- HTTP 服务 ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const path = url.pathname

  try {
    // ---- API ----
    if (path === '/api/config' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, config: loadConfig() })
    }

    if (path === '/api/config' && req.method === 'POST') {
      const body = await readBody(req)
      const config = loadConfig()
      if (body.mmdPath !== undefined) config.mmdPath = body.mmdPath
      if (body.lastVideoPath !== undefined) config.lastVideoPath = body.lastVideoPath
      if (body.lastOutputDir !== undefined) config.lastOutputDir = body.lastOutputDir
      return sendJson(res, 200, { ok: saveConfig(config), config })
    }

    if (path === '/api/pick-file' && req.method === 'POST') {
      const body = await readBody(req)
      const kind = ['mmd', 'video', 'folder'].includes(body.kind) ? body.kind : 'video'
      const picked = await pickFileDialog(kind)
      if (!picked) return sendJson(res, 200, { ok: true, path: null, canceled: true })
      return sendJson(res, 200, { ok: true, path: picked })
    }

    if (path === '/api/check-mmd' && req.method === 'POST') {
      const body = await readBody(req)
      if (!body.path) return sendJson(res, 400, { ok: false, error: '缺少 MMD 路径' })
      const r = detectExeBitness(body.path)
      // 附带运行时支持状态，前端据此判断该位数的 MMD 能否使用
      const state = resolveRuntime()
      r.runtime32Ready = !!(state.x86 && state.x86.ready)
      r.runtime64Ready = !!(state.x64 && state.x64.ready)
      return sendJson(res, 200, r)
    }

    if (path === '/api/probe-video' && req.method === 'POST') {
      const body = await readBody(req)
      if (!body.path) return sendJson(res, 400, { ok: false, error: '缺少视频路径' })
      return sendJson(res, 200, await probeVideo(body.path))
    }

    if (path === '/api/transcode' && req.method === 'POST') {
      const body = await readBody(req)
      if (!body.input) return sendJson(res, 400, { ok: false, error: '缺少输入路径' })
      if (!existsSync(body.input) || !statSync(body.input).isFile()) return sendJson(res, 400, { ok: false, error: '输入文件不存在，请检查路径' })
      const input = body.input
      const dir = dirname(input)
      const base = basename(input, extname(input))
      const output = join(dir, `${base}_fixed.mp4`)
      return sendJson(res, 200, await transcodeVideo(input, output, { fps: body.fps || 30, scale: body.scale, crf: body.crf }))
    }

    if (path === '/api/check-avisynth' && req.method === 'GET') {
      const info = detectAviSynth()
      // 附带 HKCU 注册状态（供前端显示"已注册"）
      const check = regExec(['query', 'HKCU\\Software\\Classes\\AVIFile\\Extensions\\AVS'])
      info.registered = check.status === 0
      return sendJson(res, 200, info)
    }

    if (path === '/api/register-runtime' && req.method === 'POST') {
      return sendJson(res, 200, registerRuntime())
    }

    if (path === '/api/unregister-runtime' && req.method === 'POST') {
      return sendJson(res, 200, unregisterRuntime())
    }

    if (path === '/api/generate-avs' && req.method === 'POST') {
      const body = await readBody(req)
      if (!body.videoPath) return sendJson(res, 400, { ok: false, error: '缺少视频路径' })
      if (!existsSync(body.videoPath) || !statSync(body.videoPath).isFile()) {
        return sendJson(res, 400, { ok: false, error: '视频文件不存在，请检查路径' })
      }
      const bitness = body.bitness === 64 ? 64 : 32
      const state = resolveRuntime()
      const arm = bitness === 64 ? state.x64 : state.x86
      if (!arm || !arm.ready) {
        return sendJson(res, 500, { ok: false, error: `${bitness} 位运行时不可用：${arm ? arm.detail : '未找到'}。请检查 runtime 目录` })
      }
      const content = generateAvs({
        ffms2Path: arm.ffms2Path,
        videoPath: body.videoPath,
        fps: body.fps,
        loop: body.loop,
        trimStartSec: body.trimStartSec,
        trimEndSec: body.trimEndSec,
        scale: body.scale,
      })
      // 输出目录：不填 = 视频同目录；填写则必须存在且是目录
      let outDir = dirname(body.videoPath)
      if (body.outputDir && String(body.outputDir).trim()) {
        const d = String(body.outputDir).trim()
        if (!existsSync(d) || !statSync(d).isDirectory()) {
          return sendJson(res, 400, { ok: false, error: `输出目录不存在: ${d}` })
        }
        outDir = d
      }
      const avsPath = join(outDir, basename(body.videoPath, extname(body.videoPath)) + '.avs')
      try { writeFileSync(avsPath, content, 'utf-8') } catch (e) { return sendJson(res, 500, { ok: false, error: `写入 avs 失败: ${e.message}` }) }
      return sendJson(res, 200, { ok: true, avsPath, content, bitness })
    }

    // ---- 静态文件 ----
    let filePath
    if (path === '/' || path === '/index.html') filePath = join(__dirname, 'public', 'index.html')
    else filePath = join(__dirname, 'public', path.replace(/^\/+/, ''))
    if (!filePath.startsWith(join(__dirname, 'public'))) return sendJson(res, 403, { ok: false, error: 'forbidden' })
    if (!existsSync(filePath)) return sendJson(res, 404, { ok: false, error: 'not found' })
    const ext = extname(filePath)
    const body = readFileSync(filePath)
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': body.length })
    res.end(body)
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String(e.message || e) })
  }
})

// 端口自动重试：被占用时尝试后续端口（最多 20 个），并输出实际地址
const PORT_FILE = join(__dirname, 'port.txt')
let actualPort = PORT
function tryListen(port, attemptsLeft) {
  const srv = server
  srv.removeAllListeners('error')
  srv.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`端口 ${port} 被占用，尝试 ${port + 1} …`)
      tryListen(port + 1, attemptsLeft - 1)
    } else {
      console.error(`启动失败: ${err.code === 'EADDRINUSE' ? '端口 ' + port + ' 被占用且无可用后续端口' : String(err.message || err)}`)
      process.exit(1)
    }
  })
  srv.listen(port, '127.0.0.1', () => {
    actualPort = port
    try { writeFileSync(PORT_FILE, String(actualPort), 'utf-8') } catch { /* 写失败不影响运行 */ }
    console.log(`MMDBG 已启动: http://127.0.0.1:${actualPort}`)
    console.log(`FFmpeg: ${FFMPEG}`)
    // 便携模式自动注册（runtime 存在且未注册到 HKCU 时）
    const state = resolveRuntime()
    if (state.mode === 'runtime') {
      const check = regExec(['query', 'HKCU\\Software\\Classes\\AVIFile\\Extensions\\AVS'])
      if (check.status !== 0) {
        const reg = registerRuntime()
        console.log(reg.ok ? `[便携运行时] 已自动注册（${(reg.registeredBitness || []).join(' + ')}）` : `[便携运行时] 自动注册失败: ${reg.error}`)
      } else {
        console.log('[便携运行时] 已注册（HKCU）')
      }
      console.log(`[便携运行时] x86: ${state.x86.ready ? '✓ ' + state.x86.detail : '✗ ' + state.x86.detail} | x64: ${state.x64.ready ? '✓ ' + state.x64.detail : '✗ ' + state.x64.detail}`)
    } else {
      console.log(`[AviSynth] 使用模式: ${state.mode} — ${state.detail}`)
    }
  })
}
tryListen(PORT, 20)
