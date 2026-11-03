# Generates the home-screen icons into icons/. Run: powershell -File tools/make-icons.ps1
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "icons"
New-Item -ItemType Directory -Force $out | Out-Null

function Make-Icon([int]$size, [string]$name) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = "AntiAlias"
  $g.TextRenderingHint = "AntiAliasGridFit"
  $g.Clear([System.Drawing.Color]::FromArgb(217, 84, 30))   # accent #d9541e, full bleed (iOS rounds corners)
  # Check mark inside a ring: "one thing, done".
  $w = [float]($size * 0.07)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), $w
  $pen.StartCap = "Round"; $pen.EndCap = "Round"; $pen.LineJoin = "Round"
  $r = $size * 0.27; $c = $size / 2
  $g.DrawEllipse($pen, [float]($c - $r), [float]($c - $r), [float]($r * 2), [float]($r * 2))
  $pts = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF ([float]($c - $r * 0.45)), ([float]($c + $r * 0.02))),
    (New-Object System.Drawing.PointF ([float]($c - $r * 0.1)), ([float]($c + $r * 0.36))),
    (New-Object System.Drawing.PointF ([float]($c + $r * 0.5)), ([float]($c - $r * 0.32)))
  )
  $g.DrawLines($pen, $pts)
  $bmp.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
Make-Icon 180 "apple-touch-icon.png"
Make-Icon 192 "icon-192.png"
Make-Icon 512 "icon-512.png"
Write-Host "Icons written to $out"
