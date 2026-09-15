#!/usr/bin/env node
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const THRESHOLD_SECONDS = 0;
const SHOW_ICON = false;

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
    try {
        // Log de depuração
        const debugLog = path.join(os.tmpdir(), 'antigravity-hook-debug.txt');
        fs.appendFileSync(debugLog, `[${new Date().toISOString()}] Hook chamado com input: ${input.substring(0, 100)}...\n`);

        if (!input.trim()) {
            process.stdout.write('{}');
            return;
        }

        const data = JSON.parse(input);
        const targetPath = `${data.transcriptPath || ''} ${data.artifactDirectoryPath || ''}`;
        if (targetPath && !targetPath.includes('antigravity-cli')) {
            process.stdout.write('{}');
            return;
        }

        const convId = data.conversationId || data.session_id;
        let agentResponse = data.prompt_response;

        if (!agentResponse && data.transcriptPath && fs.existsSync(data.transcriptPath)) {
            try {
                const logLines = fs.readFileSync(data.transcriptPath, 'utf8').trim().split('\n');
                for (let i = logLines.length - 1; i >= 0; i--) {
                    try {
                        const entry = JSON.parse(logLines[i]);
                        if (entry.type === 'PLANNER_RESPONSE' && entry.content && entry.content.trim()) {
                            agentResponse = entry.content;
                            break;
                        }
                    } catch (_) {}
                }
            } catch (_) {}
        }

        let durationSeconds = 0;
        if (convId) {
            const tempFile = path.join(os.tmpdir(), `antigravity-start-${convId}.txt`);
            if (fs.existsSync(tempFile)) {
                try {
                    const content = fs.readFileSync(tempFile, 'utf8').trim();
                    const startTimeMs = BigInt(content);
                    const endTimeMs = BigInt(Date.now());
                    durationSeconds = Number(endTimeMs - startTimeMs) / 1000;
                    fs.unlinkSync(tempFile);
                } catch (e) {}
            }
        }

        // Notifica apenas se demorar mais que o threshold ou se não houver timer (teste)
        if (durationSeconds > 0 && durationSeconds < THRESHOLD_SECONDS) {
            process.stdout.write('{}');
            return;
        }

        // Lógica de Resumo Inteligente (Smart Summary)
        let notificationText = "Tarefa concluída.";
        if (data.error) {
            notificationText = data.error.substring(0, 100);
        } else if (agentResponse) {
            const cleanResponse = agentResponse.trim()
                .replace(/```[\s\S]*?```/g, '[Código]') // Oculta blocos de código
                .replace(/^#+\s+/gm, '') 
                .replace(/\*\*|\*/g, '')
                .replace(/\s\s+/g, ' '); // Normaliza múltiplos espaços/quebras em um só

            // Tenta achar padrões de conclusão (Summary, Conclusion, Result, etc.)
            const summaryMatch = cleanResponse.match(/(?:Summary|Result|Conclusion|Resumo|Resultado|Conclusão):\s*(.*)/i);
            
            if (summaryMatch && summaryMatch[1]) {
                notificationText = summaryMatch[1].trim();
            } else {
                // Caso contrário, tenta pegar as últimas duas frases (que geralmente concluem a tarefa)
                const sentences = cleanResponse.split(/[.!?]\s+/).filter(s => s.trim().length > 5);
                if (sentences.length > 1) {
                    notificationText = sentences.slice(-2).join('. ').trim();
                } else {
                    notificationText = cleanResponse.substring(0, 100);
                }
            }
            
            // Limite final de caracteres para o Toast
            if (notificationText.length > 110) {
                notificationText = notificationText.substring(0, 107) + "...";
            }
        }

        const isError = Boolean(data.error) ||
                        data.terminationReason === 'error' ||
                        data.status === 'error' || 
                        data.failed === true || 
                        (agentResponse && /^(Error|Failed|Exception|Falha|Erro):/i.test(agentResponse.trim()));

        let notificationTitle = `Antigravity: Finished (${Math.round(durationSeconds)}s)`;
        let audioSrc = "ms-winsoundevent:Notification.SMS";

        if (isError) {
            notificationTitle = `Antigravity: Task Failed`;
            audioSrc = "ms-winsoundevent:Notification.Default"; 
        }

        const localLogo = path.resolve(__dirname, '..', 'assets', 'antigravity-logo.png');
        const fallbackLogo = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'assets', 'antigravity-logo.png');
        const logoPath = fs.existsSync(localLogo) ? localLogo : fallbackLogo;
        const iconTag = SHOW_ICON ? `<image placement="appLogoOverride" src="file:///${logoPath.replace(/\\/g, '/')}" />` : '';

        const psScript = `
            [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
            [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
            $title = "${notificationTitle.replace(/"/g, '`"')}"
            $text = "${notificationText.replace(/"/g, '`"')}"
            $template = @"
<toast>
    <visual>
        <binding template="ToastGeneric">
            ${iconTag}
            <text>$title</text>
            <text>$text</text>
        </binding>
    </visual>
    <audio src="${audioSrc}" />
</toast>
"@
            $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
            $xml.LoadXml($template)
            $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
            # AppId oficial do PowerShell (mais compatível)
            $appId = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe"
            [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
        `;

        execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], () => {
            process.stdout.write('{}');
        });

    } catch (e) {
        process.stdout.write('{}');
    }
});
