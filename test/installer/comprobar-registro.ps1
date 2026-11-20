# Comprueba lo que el instalador de SpiderPDF deja en el registro para «aplicación predeterminada de los PDF» (paso C).
# Solo lee el registro: no cambia nada.
#   Después de instalar:    powershell -ExecutionPolicy Bypass -File test\installer\comprobar-registro.ps1
#   Después de desinstalar: powershell -ExecutionPolicy Bypass -File test\installer\comprobar-registro.ps1 -Desinstalado
# Mira HKCU (instalación «solo para mí») y HKLM (para todos los usuarios). Código de salida 0 si todo cuadra.
param([switch]$Desinstalado)

$progId = 'Documento PDF'
$fallos = 0
function Ok($texto) { Write-Host "  ok  $texto" -ForegroundColor Green }
function Mal($texto) { Write-Host "  MAL $texto" -ForegroundColor Red; $script:fallos++ }
function Valor($ruta, $nombre) { (Get-ItemProperty -Path $ruta -Name $nombre -ErrorAction SilentlyContinue).$nombre }

$raices = @('HKCU:', 'HKLM:') | Where-Object { Valor "$_\Software\RegisteredApplications" 'SpiderPDF' }
if ($Desinstalado) {
  Write-Host 'Después de desinstalar: no debe quedar nada de SpiderPDF.'
  foreach ($r in 'HKCU:', 'HKLM:') {
    if (Valor "$r\Software\RegisteredApplications" 'SpiderPDF') { Mal "$r RegisteredApplications\SpiderPDF sigue ahí" } else { Ok "$r sin RegisteredApplications\SpiderPDF" }
    foreach ($k in 'Software\SpiderPDF', "Software\Classes\$progId", 'Software\Classes\Applications\SpiderPDF.exe') {
      if (Test-Path "$r\$k") { Mal "$r\$k sigue ahí" } else { Ok "$r\$k no existe" }
    }
    if ((Valor "$r\Software\Classes\.pdf" '(default)') -eq $progId) { Mal "$r .pdf sigue apuntando a «$progId»" } else { Ok "$r .pdf no apunta a SpiderPDF" }
    if ((Get-Item "$r\Software\Classes\.pdf\OpenWithProgids" -ErrorAction SilentlyContinue).Property -contains $progId) { Mal "$r .pdf\OpenWithProgids sigue con «$progId»" }
  }
  exit $fallos
}

if (-not $raices) { Mal 'SpiderPDF no está en RegisteredApplications (ni en HKCU ni en HKLM): ¿está instalado?'; exit 1 }
foreach ($r in $raices) {
  $modo = if ($r -eq 'HKLM:') { 'para todos los usuarios' } else { 'solo para mí' }
  Write-Host "Instalación $modo ($r):"
  $caps = Valor "$r\Software\RegisteredApplications" 'SpiderPDF'
  if ($caps -eq 'Software\SpiderPDF\Capabilities') { Ok "RegisteredApplications\SpiderPDF = $caps" } else { Mal "RegisteredApplications\SpiderPDF = «$caps»" }
  $c = "$r\Software\SpiderPDF\Capabilities"
  if ((Valor $c 'ApplicationName') -eq 'SpiderPDF') { Ok 'Capabilities\ApplicationName = SpiderPDF' } else { Mal 'falta Capabilities\ApplicationName' }
  if (Valor $c 'ApplicationDescription') { Ok "Capabilities\ApplicationDescription = $(Valor $c 'ApplicationDescription')" } else { Mal 'falta Capabilities\ApplicationDescription' }
  $icono = Valor $c 'ApplicationIcon'
  $exe = ($icono -replace ',0$', '')
  if ($icono -and (Test-Path $exe)) { Ok "Capabilities\ApplicationIcon = $icono" } else { Mal "Capabilities\ApplicationIcon = «$icono» (no existe el .exe)" }
  if ((Valor "$c\FileAssociations" '.pdf') -eq $progId) { Ok "Capabilities\FileAssociations\.pdf = $progId" } else { Mal 'falta Capabilities\FileAssociations\.pdf' }

  $p = "$r\Software\Classes\$progId"
  $cmd = Valor "$p\shell\open\command" '(default)'
  if ($cmd -like "*SpiderPDF.exe*%1*") { Ok "ProgId «$progId» abre con: $cmd" } else { Mal "ProgId «$progId» sin orden de abrir («$cmd»)" }
  if ((Valor "$p\Application" 'ApplicationName') -eq 'SpiderPDF') { Ok 'ProgId\Application\ApplicationName = SpiderPDF' } else { Mal 'falta ProgId\Application' }
  if ((Get-Item "$r\Software\Classes\.pdf\OpenWithProgids" -ErrorAction SilentlyContinue).Property -contains $progId) { Ok '.pdf\OpenWithProgids incluye SpiderPDF' } else { Mal '.pdf\OpenWithProgids sin SpiderPDF' }

  $a = "$r\Software\Classes\Applications\SpiderPDF.exe"
  if ((Get-Item "$a\SupportedTypes" -ErrorAction SilentlyContinue).Property -contains '.pdf') { Ok 'Applications\SpiderPDF.exe\SupportedTypes = .pdf' } else { Mal 'falta Applications\SpiderPDF.exe\SupportedTypes' }
  if ((Valor "$a\shell\open\command" '(default)') -like '*SpiderPDF.exe*%1*') { Ok 'Applications\SpiderPDF.exe abre con "%1"' } else { Mal 'falta Applications\SpiderPDF.exe\shell\open\command' }
  $com = Join-Path (Split-Path $exe) 'SpiderPDF.com'
  if (Test-Path $com) { Ok "SpiderPDF.com junto al .exe" } else { Mal "falta $com" }
}
$elegida = Valor 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\UserChoice' 'ProgId'
Write-Host "Predeterminada de los .pdf para este usuario: $(if ($elegida) { $elegida } else { '(ninguna elegida)' })$(if ($elegida -eq $progId) { ' → SpiderPDF' })"
exit $fallos
