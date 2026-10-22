# make-assets.ps1 -- one-off asset builder for dsh-memoria
#
# WHY THIS EXISTS
#   The character art came as 848x1264 PNGs on a PURE WHITE background (255,255,255)
#   with no alpha channel. A global colour-key is useless here: the character herself
#   contains large white areas (shirt, socks, highlights), so keying white would punch
#   holes in her body.
#
# WHAT IT DOES (per image)
#   1. flood fill the background CONNECTED TO THE BORDER only -> interior white survives
#   2. clear alpha on that region
#   3. un-matte the 1px ring (pixels that are a blend of the subject and white):
#      estimate alpha from the darkest channel and recover the original colour
#   4. bleed colours outward into the transparent area for a few passes (alpha stays 0)
#      so that downscaling cannot produce a white halo
#   5. downscale and save as 32bpp ARGB PNG
#
# ASCII ONLY (PowerShell 5.1 reads .ps1 as ANSI; non-ASCII would break parsing).
#
# usage:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File make-assets.ps1 `
#       -Src <in.png> -Dst <out.png> -Width 480 -Dilate 6

param(
  [Parameter(Mandatory=$true)][string]$Src,
  [Parameter(Mandatory=$true)][string]$Dst,
  [int]$Width = 480,
  [int]$BgMin = 240,
  [int]$Dilate = 6,
  [string]$DropRect = '',
  [string]$Ffmpeg = '',
  [int]$WebpQuality = 88
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$code = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class MemoriaMatte
{
    static bool IsBg(byte[] p, int stride, int w, int x, int y, int bgMin)
    {
        int o = y * stride + x * 4;
        return p[o] >= bgMin && p[o + 1] >= bgMin && p[o + 2] >= bgMin;
    }

    public static string Run(string srcPath, string dstPath, int outWidth, int bgMin, int dilate,
                             int dx0, int dy0, int dx1, int dy1)
    {
        using (Bitmap orig = new Bitmap(srcPath))
        {
            int w = orig.Width;
            int h = orig.Height;
            using (Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb))
            {
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.CompositingMode = CompositingMode.SourceCopy;
                    g.DrawImage(orig, 0, 0, w, h);
                }

                BitmapData bd = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
                int stride = bd.Stride;
                byte[] px = new byte[stride * h];
                Marshal.Copy(bd.Scan0, px, 0, px.Length);

                bool[] bg = new bool[w * h];
                Stack<int> st = new Stack<int>();
                for (int x = 0; x < w; x++)
                {
                    if (!bg[x] && IsBg(px, stride, w, x, 0, bgMin)) st.Push(x);
                    int b = (h - 1) * w + x;
                    if (!bg[b] && IsBg(px, stride, w, x, h - 1, bgMin)) st.Push(b);
                }
                for (int y = 0; y < h; y++)
                {
                    int l = y * w;
                    if (!bg[l] && IsBg(px, stride, w, 0, y, bgMin)) st.Push(l);
                    int r = y * w + w - 1;
                    if (!bg[r] && IsBg(px, stride, w, w - 1, y, bgMin)) st.Push(r);
                }

                while (st.Count > 0)
                {
                    int idx = st.Pop();
                    if (bg[idx]) continue;
                    int y = idx / w;
                    int x = idx - y * w;
                    if (!IsBg(px, stride, w, x, y, bgMin)) continue;

                    int xl = x;
                    while (xl - 1 >= 0 && !bg[y * w + xl - 1] && IsBg(px, stride, w, xl - 1, y, bgMin)) xl--;
                    int xr = x;
                    while (xr + 1 < w && !bg[y * w + xr + 1] && IsBg(px, stride, w, xr + 1, y, bgMin)) xr++;

                    for (int i = xl; i <= xr; i++)
                    {
                        bg[y * w + i] = true;
                        if (y > 0)
                        {
                            int u = (y - 1) * w + i;
                            if (!bg[u] && IsBg(px, stride, w, i, y - 1, bgMin)) st.Push(u);
                        }
                        if (y < h - 1)
                        {
                            int d = (y + 1) * w + i;
                            if (!bg[d] && IsBg(px, stride, w, i, y + 1, bgMin)) st.Push(d);
                        }
                    }
                }

                int dropped = 0;
                if (dx1 > dx0 && dy1 > dy0)
                {
                    if (dx0 < 0) dx0 = 0;
                    if (dy0 < 0) dy0 = 0;
                    if (dx1 > w - 1) dx1 = w - 1;
                    if (dy1 > h - 1) dy1 = h - 1;
                    for (int y = dy0; y <= dy1; y++)
                    {
                        for (int x = dx0; x <= dx1; x++)
                        {
                            if (!bg[y * w + x]) { bg[y * w + x] = true; dropped++; }
                        }
                    }
                }

                int cleared = 0;
                for (int y = 0; y < h; y++)
                {
                    int row = y * w;
                    for (int x = 0; x < w; x++)
                    {
                        if (!bg[row + x]) continue;
                        px[y * stride + x * 4 + 3] = 0;
                        cleared++;
                    }
                }

                int ring = 0;
                byte[] src = (byte[])px.Clone();
                for (int y = 0; y < h; y++)
                {
                    for (int x = 0; x < w; x++)
                    {
                        if (bg[y * w + x]) continue;
                        bool near = false;
                        for (int dy = -1; dy <= 1 && !near; dy++)
                        {
                            int ny = y + dy;
                            if (ny < 0 || ny >= h) continue;
                            for (int dx = -1; dx <= 1; dx++)
                            {
                                int nx = x + dx;
                                if (nx < 0 || nx >= w) continue;
                                if (bg[ny * w + nx]) { near = true; break; }
                            }
                        }
                        if (!near) continue;

                        int o = y * stride + x * 4;
                        int b0 = src[o], g0 = src[o + 1], r0 = src[o + 2];
                        int mn = Math.Min(r0, Math.Min(g0, b0));
                        double a = (255.0 - mn) / 255.0;
                        if (a < 0.04)
                        {
                            px[o + 3] = 0;
                        }
                        else
                        {
                            px[o + 3] = (byte)Math.Round(a * 255.0);
                            px[o] = Clamp((b0 - (1.0 - a) * 255.0) / a);
                            px[o + 1] = Clamp((g0 - (1.0 - a) * 255.0) / a);
                            px[o + 2] = Clamp((r0 - (1.0 - a) * 255.0) / a);
                        }
                        ring++;
                    }
                }

                bool[] solid = new bool[w * h];
                for (int i = 0; i < w * h; i++) solid[i] = !bg[i];
                for (int pass = 0; pass < dilate; pass++)
                {
                    bool[] add = new bool[w * h];
                    for (int y = 0; y < h; y++)
                    {
                        for (int x = 0; x < w; x++)
                        {
                            int idx = y * w + x;
                            if (solid[idx]) continue;
                            int from = -1;
                            if (y > 0 && solid[idx - w]) from = idx - w;
                            else if (x > 0 && solid[idx - 1]) from = idx - 1;
                            else if (x + 1 < w && solid[idx + 1]) from = idx + 1;
                            else if (y + 1 < h && solid[idx + w]) from = idx + w;
                            if (from < 0) continue;
                            int fy = from / w;
                            int fx = from - fy * w;
                            int o = y * stride + x * 4;
                            int fo = fy * stride + fx * 4;
                            px[o] = px[fo];
                            px[o + 1] = px[fo + 1];
                            px[o + 2] = px[fo + 2];
                            add[idx] = true;
                        }
                    }
                    for (int i = 0; i < w * h; i++) if (add[i]) solid[i] = true;
                }

                Marshal.Copy(px, 0, bd.Scan0, px.Length);
                bmp.UnlockBits(bd);

                int ow = outWidth;
                int oh = (int)Math.Round((double)h * outWidth / w);
                using (Bitmap dst = new Bitmap(ow, oh, PixelFormat.Format32bppArgb))
                {
                    using (Graphics g = Graphics.FromImage(dst))
                    {
                        g.CompositingMode = CompositingMode.SourceCopy;
                        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        g.DrawImage(bmp, new Rectangle(0, 0, ow, oh));
                    }
                    dst.Save(dstPath, ImageFormat.Png);
                }

                return string.Format("src {0}x{1} -> {2}x{3} | bg {4} px ({5:F1}%) | rect {6} px | ring {7} px",
                    w, h, ow, oh, cleared, 100.0 * cleared / (w * h), dropped, ring);
            }
        }
    }

    static byte Clamp(double v)
    {
        if (v < 0) return 0;
        if (v > 255) return 255;
        return (byte)Math.Round(v);
    }
}
'@

Add-Type -TypeDefinition $code -ReferencedAssemblies 'System.Drawing'

if (-not (Test-Path -LiteralPath $Src)) { throw "missing source: $Src" }
$dir = Split-Path -Parent $Dst
if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

$rx0 = -1; $ry0 = -1; $rx1 = -1; $ry1 = -1
if ($DropRect -ne '') {
  $parts = $DropRect -split ','
  if ($parts.Count -ne 4) { throw 'DropRect must be x0,y0,x1,y1' }
  $rx0 = [int]$parts[0]; $ry0 = [int]$parts[1]; $rx1 = [int]$parts[2]; $ry1 = [int]$parts[3]
}

$sw = [Diagnostics.Stopwatch]::StartNew()
# Output format:
#   -Dst ends with .png  -> the matted PNG is written straight to -Dst
#   -Dst ends with .webp -> the PNG goes to %TEMP% first, ffmpeg turns it into a transparent WebP,
#                           then THAT temp file is removed. Measured at 848px wide on the real art:
#                           PNG 1.1 MB / lossless WebP 530 KB / WebP q88 108 KB -- q88 is used
#                           because the difference is invisible at these sizes.
#                           (The temp file lives in $env:TEMP and was created by this very run;
#                            the "never Remove-Item user data" rule is about USER data, not this.)
$tmpPng = $Dst
if ($Dst -match '\.webp$') {
  $tmpPng = Join-Path $env:TEMP ('memoria-matte-' + [IO.Path]::GetFileNameWithoutExtension($Dst) + '.png')
}
$msg = [MemoriaMatte]::Run($Src, $tmpPng, $Width, $BgMin, $Dilate, $rx0, $ry0, $rx1, $ry1)

if ($Dst -match '\.webp$') {
  if (-not $Ffmpeg) { $Ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source }
  # NOTE: no hard-coded tool path here on purpose -- this file must stay ASCII-only
  # (PowerShell 5.1 reads .ps1 as ANSI, so a CJK path literal would break parsing).
  if (-not $Ffmpeg) { throw 'output is .webp but ffmpeg was not found on PATH -- pass -Ffmpeg <path>' }
  & $Ffmpeg -y -loglevel error -i $tmpPng -c:v libwebp -lossless 0 -q:v $WebpQuality -compression_level 6 $Dst
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed ($LASTEXITCODE)" }
  if ($tmpPng.StartsWith($env:TEMP) -and (Test-Path -LiteralPath $tmpPng)) { Remove-Item -LiteralPath $tmpPng -Force }
  $msg = $msg + (' | webp q{0} {1} bytes' -f $WebpQuality, (Get-Item -LiteralPath $Dst).Length)
}
$sw.Stop()
"{0} | {1} ms" -f $msg, $sw.ElapsedMilliseconds
