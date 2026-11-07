/** The marker is a complete output line so echoed input cannot finish a command. */
export function wrapTerminalCommand(shellId: string, command: string, token: string): string {
  switch (shellId.toLowerCase()) {
    case "powershell":
    case "pwsh":
      return `& {
$global:LASTEXITCODE = $null
$__aurona_exit = 1
try {
${command}
$__aurona_success = $?
$__aurona_exit = if ($global:LASTEXITCODE -ne $null) { $global:LASTEXITCODE } elseif ($__aurona_success) { 0 } else { 1 }
} catch {
Write-Error -ErrorRecord $_ -ErrorAction Continue
}
Write-Output "\`n${token}:$__aurona_exit"
}`;
    case "fish":
      return `begin\n${command}\nset -l __aurona_exit $status\nprintf '\\n${token}:%s\\n' $__aurona_exit\nend`;
    case "cmd":
      return `${command}\r\necho. & echo ${token}:%errorlevel%`;
    default:
      return `{\n${command}\n__aurona_exit=$?; printf '\\n${token}:%s\\n' "$__aurona_exit";\n}`;
  }
}
