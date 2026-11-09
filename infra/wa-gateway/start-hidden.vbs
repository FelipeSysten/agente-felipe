' Inicia o gateway WhatsApp em segundo plano (sem janela). Logs em data\gateway.log.
' Copiado para a pasta Inicializar do Windows pelo install-autostart.ps1.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
If fso.FileExists(dir & "\gateway.mjs") = False Then dir = "C:\Users\Brendo\Documents\DEV\agent-felipe\agente-felipe\infra\wa-gateway"
If fso.FolderExists(dir & "\data") = False Then fso.CreateFolder(dir & "\data")
CreateObject("WScript.Shell").Run "cmd /c cd /d """ & dir & """ && node gateway.mjs >> data\gateway.log 2>&1", 0, False
