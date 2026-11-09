# Faz o gateway WhatsApp iniciar sozinho no login do Windows (sem admin).
# Remover: apague "agente-gaucho-whatsapp.vbs" da pasta Inicializar (Win+R → shell:startup).
$startup = [Environment]::GetFolderPath("Startup")
Copy-Item -Path (Join-Path $PSScriptRoot "start-hidden.vbs") -Destination (Join-Path $startup "agente-gaucho-whatsapp.vbs") -Force
Write-Output "Autostart instalado em: $startup\agente-gaucho-whatsapp.vbs"
