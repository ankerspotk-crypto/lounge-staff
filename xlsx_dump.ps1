param([string]$Path, [int]$SheetNum, [int]$MaxRows = 200)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
function Read-Entry($name){
  $e = $zip.Entries | Where-Object { $_.FullName -eq $name }
  if(-not $e){ return $null }
  $sr = New-Object System.IO.StreamReader($e.Open(), [System.Text.Encoding]::UTF8)
  $t = $sr.ReadToEnd(); $sr.Close(); return $t
}
$ss = New-Object System.Collections.ArrayList
$sx = [xml](Read-Entry 'xl/sharedStrings.xml')
foreach($si in $sx.sst.si){
  $txt = ''
  if($si.t){ if($si.t -is [string]){ $txt = $si.t } else { $txt = $si.t.'#text' } }
  elseif($si.r){ foreach($r in $si.r){ if($r.t -is [string]){ $txt += $r.t } else { $txt += $r.t.'#text' } } }
  [void]$ss.Add($txt)
}
$sheetXml = [xml](Read-Entry "xl/worksheets/sheet$SheetNum.xml")
$rowCount = 0
foreach($row in $sheetXml.worksheet.sheetData.row){
  $rowCount++
  if($rowCount -gt $MaxRows){ break }
  $cells = @()
  foreach($c in $row.c){
    $colLetters = ($c.r -replace '[0-9]','')
    $val = $null
    if($c.t -eq 's'){ $idx = [int]$c.v; $val = $ss[$idx] }
    elseif($c.t -eq 'inlineStr'){ $val = $c.is.t }
    else { $val = $c.v }
    if($null -ne $val -and "$val" -ne ''){ $cells += ("{0}={1}" -f $colLetters, $val) }
  }
  if($cells.Count -gt 0){ "R{0}: {1}" -f $row.r, ($cells -join ' | ') }
}
$zip.Dispose()
